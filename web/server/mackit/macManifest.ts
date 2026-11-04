/**
 * Moteur Mac commun (mORTEX, mABBAJACK, mO2FLATTENER) : journal des fichiers modifiés par les correctifs.
 * Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh. Pur : aucune dépendance
 * à l'interface ni au journal de l'appli.
 *
 * Chaque fichier remplacé, créé ou retiré est d'abord copié dans `<jeu>/_MAC_BACKUP/files/`, puis
 * inscrit dans `<jeu>/_MAC_BACKUP/manifest.json` avec son empreinte avant et après. L'annulation
 * ne restaure un fichier que s'il porte encore l'empreinte « après » : jamais par-dessus un changement
 * fait entre-temps.
 *
 * Interface :
 *  - fileHash(file): Promise<string | null>          empreinte SHA-256, null si le fichier n'existe pas
 *  - backupDir(gamePath) / manifestPath(gamePath)
 *  - readManifest(gamePath): Promise<IMacManifest>   manifeste vide si absent ou illisible
 *  - backupAndWrite(gamePath, fix, file, write): Promise<void>
 *                                                     sauvegarde, écrit, inscrit au manifeste
 *  - addRegistryEntry(gamePath, entry)                 inscrit un correctif qui n'a pas de fichier
 *  - checkFileEntry / restoreFileEntry(gamePath, entry): Promise<IRefusal | undefined>
 *                                                     vérifie / restaure un fichier, ou dit pourquoi pas
 *  - forgetEntries(gamePath, entries)                 retire des entrées du manifeste (et le dossier s'il est vide)
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, rmdir, stat, utimes, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { IBottle } from "./bottlesCore";

export const BACKUP_DIR_NAME = "_MAC_BACKUP";
const MANIFEST_NAME = "manifest.json";
const FILES_DIR = "files";

/** identifiant d'un correctif (voir macFixes) ; une chaîne ici pour ne pas dépendre de ce module */
export type MacFixKey = string;

interface IEntryBase {
  /** numéro d'ordre, jamais réutilisé tant que le manifeste existe */
  id: number;
  /** correctif d'origine */
  fix: MacFixKey;
  /** horodatage ISO de l'application */
  at: string;
}

/** un fichier remplacé, créé (before = null) ou retiré (after = null) */
export interface IFileEntry extends IEntryBase {
  kind: "file";
  /** chemin absolu du fichier modifié */
  file: string;
  /** empreinte avant ; null si le fichier n'existait pas */
  before: string | null;
  /** empreinte après ; null si le fichier a été retiré */
  after: string | null;
  /** copie de l'original, relative à _MAC_BACKUP ; null si le fichier n'existait pas */
  backup: string | null;
}

/** overrides DLL posés dans le registre de la bouteille : rien à copier, on retire ceux-là */
export interface IRegistryEntry extends IEntryBase {
  kind: "registry";
  bottle: IBottle;
  dlls: string[];
}

export type MacEntry = IFileEntry | IRegistryEntry;

export interface IMacManifest {
  version: 1;
  game: string;
  entries: MacEntry[];
}

/** pourquoi un fichier n'a pas été restauré */
export interface IRefusal {
  file: string;
  /** « changed » : le fichier ne porte plus l'empreinte d'après le correctif ; « backupMissing » : copie perdue */
  reason: "changed" | "backupMissing";
}

export const backupDir = (gamePath: string) => path.join(gamePath, BACKUP_DIR_NAME);
export const manifestPath = (gamePath: string) => path.join(backupDir(gamePath), MANIFEST_NAME);

export async function fileHash(file: string): Promise<string | null> {
  const content = await readFile(file).catch(() => undefined);
  return content === undefined ? null : createHash("sha256").update(content).digest("hex");
}

export async function readManifest(gamePath: string): Promise<IMacManifest> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath(gamePath), "utf8"));
    if (manifest?.version === 1 && Array.isArray(manifest.entries)) return manifest;
  } catch {
    /* pas de manifeste, ou illisible : on repart d'un manifeste vide */
  }
  return { version: 1, game: gamePath, entries: [] };
}

async function writeManifest(gamePath: string, manifest: IMacManifest): Promise<void> {
  await mkdir(backupDir(gamePath), { recursive: true });
  await writeFile(manifestPath(gamePath), JSON.stringify(manifest, null, 2) + "\n");
}

const nextId = (manifest: IMacManifest) =>
  manifest.entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;

/** nom de la copie : numéro de l'entrée + nom du fichier, pour que deux fichiers du même nom cohabitent */
const backupName = (id: number, file: string) =>
  path.join(FILES_DIR, `${String(id).padStart(3, "0")}-${path.basename(file)}`);

/**
 * Sauvegarde `file` s'il existe, appelle `write` (qui le crée, le remplace ou le retire), puis
 * inscrit l'entrée au manifeste. Le manifeste n'est écrit qu'après l'écriture réussie ; si `write`
 * échoue, la copie sans entrée est retirée et le fichier d'origine reste tel quel.
 */
export async function backupAndWrite(
  gamePath: string,
  fix: MacFixKey,
  file: string,
  write: () => Promise<void>,
): Promise<void> {
  const manifest = await readManifest(gamePath);
  const before = await fileHash(file);
  const id = nextId(manifest);
  let backup: string | null = null;
  if (before !== null) {
    backup = backupName(id, file);
    await mkdir(path.dirname(path.join(backupDir(gamePath), backup)), { recursive: true });
    const copy = path.join(backupDir(gamePath), backup);
    await copyFile(file, copy);
    // la copie garde la date du fichier d'origine : l'annulation la rend telle quelle (état identique, dates comprises)
    const info = await stat(file);
    await utimes(copy, info.atime, info.mtime);
  }
  try {
    await write();
  } catch (err) {
    if (backup !== null) await rm(path.join(backupDir(gamePath), backup), { force: true });
    throw err;
  }
  manifest.entries.push({
    id,
    kind: "file",
    fix,
    file,
    before,
    after: await fileHash(file),
    backup,
    at: new Date().toISOString(),
  });
  await writeManifest(gamePath, manifest);
}

export async function addRegistryEntry(
  gamePath: string,
  entry: Omit<IRegistryEntry, "id" | "kind" | "at">,
): Promise<void> {
  const manifest = await readManifest(gamePath);
  const id = nextId(manifest);
  manifest.entries.push({ ...entry, id, kind: "registry", at: new Date().toISOString() });
  await writeManifest(gamePath, manifest);
}

/** Le fichier porte-t-il encore l'empreinte d'après le correctif, et sa copie est-elle intacte ? */
export async function checkFileEntry(
  gamePath: string,
  entry: IFileEntry,
): Promise<IRefusal | undefined> {
  if ((await fileHash(entry.file)) !== entry.after) {
    return { file: entry.file, reason: "changed" };
  }
  if (entry.backup === null) return undefined;
  const copy = path.join(backupDir(gamePath), entry.backup);
  return (await fileHash(copy)) === entry.before
    ? undefined
    : { file: entry.file, reason: "backupMissing" };
}

/** Restaure un fichier si, et seulement si checkFileEntry n'a rien à redire. */
export async function restoreFileEntry(
  gamePath: string,
  entry: IFileEntry,
): Promise<IRefusal | undefined> {
  const refusal = await checkFileEntry(gamePath, entry);
  if (refusal !== undefined) return refusal;
  if (entry.backup === null) {
    // le correctif l'avait créé : l'annuler le retire
    await rm(entry.file, { force: true });
    return undefined;
  }
  // writeFile et non rename : l'écriture traverse les liens (dossier de préparation)
  const copy = path.join(backupDir(gamePath), entry.backup);
  await writeFile(entry.file, await readFile(copy));
  const info = await stat(copy);
  await utimes(entry.file, info.atime, info.mtime);
  return undefined;
}

/** Retire des entrées du manifeste, avec leurs copies ; sans entrée restante, plus rien ne traîne. */
export async function forgetEntries(gamePath: string, entries: MacEntry[]): Promise<void> {
  const manifest = await readManifest(gamePath);
  for (const entry of entries) {
    if (entry.kind === "file" && entry.backup !== null) {
      await rm(path.join(backupDir(gamePath), entry.backup), { force: true });
    }
  }
  const gone = new Set(entries.map((entry) => entry.id));
  manifest.entries = manifest.entries.filter((entry) => !gone.has(entry.id));
  if (manifest.entries.length === 0) {
    await rm(manifestPath(gamePath), { force: true });
    await rmdir(path.join(backupDir(gamePath), FILES_DIR)).catch(() => undefined);
    await rmdir(backupDir(gamePath)).catch(() => undefined);
    return;
  }
  await writeManifest(gamePath, manifest);
}
