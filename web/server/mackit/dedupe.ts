/**
 * mORTEX (macOS) : dédoublonnage par clones APFS. Les fichiers identiques entre mods (mêmes
 * textures dans deux versions d'un mod, packs qui se recoupent) deviennent des clones d'une seule
 * copie : même contenu, place prise une fois, et une modification ultérieure sépare les copies.
 *
 * Interface :
 *  - findDuplicates(root, minSize?): Promise<IDuplicates>   groupes de fichiers identiques
 *  - cloneDuplicates(groups): Promise<number>               octets regagnés
 *
 * Comparaison : taille, puis empreinte SHA-256 du contenu. Les fichiers déjà liés entre eux (même
 * inode) ne comptent qu'une fois.
 *
 * Un clone APFS a son propre inode et le même contenu : rien ne le distingue d'une vraie copie. Les
 * fichiers clonés sont donc notés dans un registre (`.mortex-clones.json` à la racine, avec taille
 * et date de modification) ; tant qu'un fichier n'a pas changé, il n'est plus proposé au clonage.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const MIN_SIZE = 64 * 1024;
export const LEDGER_NAME = ".mortex-clones.json";

/** fichier relatif -> [taille, date de modification] au moment du clonage */
type Ledger = { [file: string]: [number, number] };

async function readLedger(root: string): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(path.join(root, LEDGER_NAME), "utf8")) as Ledger;
  } catch {
    return {};
  }
}

export interface IDuplicates {
  /** fichiers identiques, le premier est gardé */
  groups: string[][];
  /** octets regagnables */
  savings: number;
  files: number;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const hashOf = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

export async function findDuplicates(root: string, minSize = MIN_SIZE): Promise<IDuplicates> {
  // par taille d'abord : seules les tailles partagées valent une empreinte
  const ledger = await readLedger(root);
  const cloned = new Set<string>();
  const bySize = new Map<number, string[]>();
  const seenInodes = new Set<string>();
  for await (const file of walk(root)) {
    const info = await stat(file).catch(() => undefined);
    if (info === undefined || info.size < minSize) continue;
    const inode = `${info.dev}:${info.ino}`;
    if (seenInodes.has(inode)) continue;
    seenInodes.add(inode);
    const noted = ledger[path.relative(root, file)];
    if (noted !== undefined && noted[0] === info.size && noted[1] === info.mtimeMs) {
      cloned.add(file);
    }
    bySize.set(info.size, [...(bySize.get(info.size) ?? []), file]);
  }

  const groups: string[][] = [];
  let savings = 0;
  let files = 0;
  for (const [size, candidates] of bySize) {
    if (candidates.length < 2) continue;
    const byHash = new Map<string, string[]>();
    for (const file of candidates) {
      const hash = await hashOf(file).catch(() => undefined);
      if (hash !== undefined) byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }
    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      // les fichiers déjà clonés partagent leur place : seuls les autres sont à regagner, et ils
      // se clonent sur un fichier déjà cloné s'il y en a un
      const done = group.filter((file) => cloned.has(file)).sort();
      const fresh = group.filter((file) => !cloned.has(file)).sort();
      if (fresh.length === 0) continue;
      const ordered = done.length > 0 ? [done[0], ...fresh] : fresh;
      if (ordered.length < 2) continue;
      groups.push(ordered);
      savings += size * (ordered.length - 1);
      files += ordered.length - 1;
    }
  }
  return { groups, savings, files };
}

const cp = (args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile("/bin/cp", args, (err, _out, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    ),
  );

/**
 * remplace chaque doublon par un clone du premier fichier du groupe ; renvoie les octets regagnés.
 * `root` : dossier analysé, où le registre des fichiers clonés est tenu à jour.
 */
export async function cloneDuplicates(groups: string[][], root?: string): Promise<number> {
  const ledger = root === undefined ? {} : await readLedger(root);
  const note = async (file: string) => {
    if (root === undefined) return;
    const info = await stat(file).catch(() => undefined);
    if (info !== undefined) ledger[path.relative(root, file)] = [info.size, info.mtimeMs];
  };
  let saved = 0;
  for (const [keep, ...others] of groups) {
    const { size } = await stat(keep);
    for (const file of others) {
      const temp = `${file}.mortex-clone`;
      try {
        // -p garde dates et droits du fichier gardé, identiques en contenu
        await cp(["-cp", keep, temp]);
        await rename(temp, file);
        saved += size;
        await note(file);
      } catch {
        await rm(temp, { force: true });
      }
    }
    await note(keep);
  }
  if (root !== undefined && saved > 0) {
    await writeFile(path.join(root, LEDGER_NAME), JSON.stringify(ledger));
  }
  return saved;
}
