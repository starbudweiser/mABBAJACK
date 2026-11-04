/**
 * Moteur Mac commun (mORTEX, mABBAJACK, mO2FLATTENER) : application et annulation des correctifs
 * simulés par `plan`. Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh.
 * Pur : aucune dépendance à l'interface ; journal facultatif ; textes sous forme de clés (macTexts).
 *
 * Interface :
 *  - apply(plan, options?): Promise<IApplyResult>      applique le plan, correctif par correctif
 *  - undo(gamePath, fixId | "all", options?): Promise<IUndoResult>
 *  - appliedFixes(gamePath): Promise<IAppliedFix[]>     ce que le manifeste dit être appliqué
 *
 * Chaque fichier remplacé, créé ou retiré est copié dans `<jeu>/_MAC_BACKUP/` et inscrit dans
 * `_MAC_BACKUP/manifest.json` (macManifest). Un correctif est tout ou rien : s'il échoue en route,
 * ce qu'il avait déjà écrit est remis. L'annulation d'un correctif refuse d'y toucher si l'un de ses
 * fichiers a changé depuis, et le dit ; elle ne laisse aucune trace quand tout est annulé.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { BottlesLog } from "./bottlesCore";
import { readRegString } from "./bottlesCore";
import {
  type WineRunner,
  OVERRIDES_KEY,
  addDllOverrides,
  prefersNative,
  removeDllOverrides,
} from "./dllOverrides";
import { applyChanges } from "./iniEdit";
import {
  type IFileEntry,
  type IRefusal,
  type IRegistryEntry,
  type MacEntry,
  addRegistryEntry,
  backupAndWrite,
  checkFileEntry,
  fileHash,
  forgetEntries,
  readManifest,
  restoreFileEntry,
} from "./macManifest";
import type { IMacPlan, IPlannedFix, MacFixId, MacOperation } from "./macPlan";
import { type IMacText, macText } from "./macTexts";

export interface IApplyOptions {
  /** n'appliquer que ces correctifs (cases décochées dans l'annonce) */
  only?: MacFixId[];
  /** lance wine pour les overrides DLL ; par défaut celui de la bouteille */
  run?: WineRunner;
  log?: BottlesLog;
}

export interface IFixOutcome {
  id: MacFixId;
  status: "applied" | "failed";
  text: IMacText;
  /** message technique d'une erreur, pour le journal ; jamais à afficher tel quel */
  detail?: string;
}

export interface IApplyResult {
  outcomes: IFixOutcome[];
}

export interface IUndoOptions {
  run?: WineRunner;
  log?: BottlesLog;
}

export interface IUndoOutcome {
  id: MacFixId;
  /** « absent » : le manifeste ne connaît pas ce correctif */
  status: "restored" | "refused" | "absent";
  text: IMacText;
  refusals?: IRefusal[];
}

export interface IUndoResult {
  fixes: IUndoOutcome[];
}

export interface IAppliedFix {
  id: MacFixId;
  /** fichiers modifiés (chemins absolus) ; vide pour les overrides DLL */
  files: string[];
  /** overrides DLL posés */
  dlls: string[];
  at: string;
}

/** un fichier a changé depuis la simulation */
class ChangedSincePlan extends Error {
  constructor(readonly file: string) {
    super(`${file} a changé depuis la simulation`);
  }
}

async function guard(file: string, expected: string | null): Promise<void> {
  if ((await fileHash(file)) !== expected) throw new ChangedSincePlan(file);
}

async function applyOperation(
  plan: IMacPlan,
  fix: IPlannedFix,
  op: MacOperation,
  run?: WineRunner,
) {
  const id = fix.id;
  if (op.kind === "overrides") {
    await addDllOverrides(op.bottle, op.dlls, run);
    await addRegistryEntry(plan.gamePath, { fix: id, bottle: op.bottle, dlls: op.dlls });
    return;
  }
  await guard(op.file, op.baseHash);
  if (op.kind === "copy") await guard(op.source, op.sourceHash);
  await backupAndWrite(plan.gamePath, id, op.file, async () => {
    switch (op.kind) {
      case "write":
        await mkdir(path.dirname(op.file), { recursive: true });
        return writeFile(op.file, op.content);
      case "copy":
        // writeFile et non copyFile : l'écriture traverse les liens (dossier de préparation)
        return writeFile(op.file, await readFile(op.source));
      case "ini":
        await applyChanges(op.plan);
        return;
      case "remove":
        return rm(op.file);
    }
  });
}

/** remet ce qu'un correctif a déjà écrit quand il échoue en route */
async function rollback(gamePath: string, id: MacFixId, firstId: number, run?: WineRunner) {
  const manifest = await readManifest(gamePath);
  const written = manifest.entries.filter((entry) => entry.fix === id && entry.id >= firstId);
  for (const entry of [...written].reverse()) await restoreEntry(gamePath, entry, run);
  await forgetEntries(gamePath, written);
}

async function applyFix(
  plan: IMacPlan,
  fix: IPlannedFix,
  options: IApplyOptions,
): Promise<IFixOutcome> {
  const before = await readManifest(plan.gamePath);
  const firstId = before.entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
  try {
    for (const op of fix.ops) await applyOperation(plan, fix, op, options.run);
    options.log?.("debug", "mackit applied", { fix: fix.id });
    return { id: fix.id, status: "applied", text: macText("mackit.apply.ok") };
  } catch (err) {
    await rollback(plan.gamePath, fix.id, firstId, options.run).catch(() => undefined);
    const detail = err instanceof Error ? err.message : "unknown error";
    options.log?.("warn", "mackit fix failed", { fix: fix.id, detail });
    return {
      id: fix.id,
      status: "failed",
      text:
        err instanceof ChangedSincePlan
          ? macText("mackit.apply.changed", { file: path.basename(err.file) })
          : macText("mackit.apply.error"),
      detail,
    };
  }
}

export async function apply(plan: IMacPlan, options: IApplyOptions = {}): Promise<IApplyResult> {
  const outcomes: IFixOutcome[] = [];
  for (const fix of plan.fixes) {
    if (options.only !== undefined && !options.only.includes(fix.id)) continue;
    outcomes.push(await applyFix(plan, fix, options));
  }
  return { outcomes };
}

// --- annulation -------------------------------------------------------------------------------

/** les overrides sont-ils encore ceux que nous avons posés (ou déjà partis) ? */
function checkRegistryEntry(entry: IRegistryEntry): IRefusal | undefined {
  for (const dll of entry.dlls) {
    const current = readRegString(entry.bottle, "HKEY_CURRENT_USER", OVERRIDES_KEY, dll);
    if (current !== undefined && !prefersNative(current)) {
      return { file: `${dll}.dll`, reason: "changed" };
    }
  }
  return undefined;
}

const checkEntry = (gamePath: string, entry: MacEntry) =>
  entry.kind === "file" ? checkFileEntry(gamePath, entry) : checkRegistryEntry(entry);

async function restoreEntry(gamePath: string, entry: MacEntry, run?: WineRunner) {
  if (entry.kind === "registry") return removeDllOverrides(entry.bottle, entry.dlls, run);
  return restoreFileEntry(gamePath, entry as IFileEntry);
}

async function undoFix(
  gamePath: string,
  id: MacFixId,
  entries: MacEntry[],
  options: IUndoOptions,
): Promise<IUndoOutcome> {
  if (entries.length === 0) return { id, status: "absent", text: macText("mackit.undo.absent") };
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  const refusals: IRefusal[] = [];
  for (const entry of newestFirst) {
    const refusal = await checkEntry(gamePath, entry);
    if (refusal !== undefined) refusals.push(refusal);
  }
  if (refusals.length > 0) {
    options.log?.("warn", "mackit undo refused", { fix: id, refusals });
    const [first] = refusals;
    return {
      id,
      status: "refused",
      text: macText(
        first.reason === "changed" ? "mackit.undo.changed" : "mackit.undo.backupMissing",
        { file: path.basename(first.file) },
      ),
      refusals,
    };
  }
  for (const entry of newestFirst) await restoreEntry(gamePath, entry, options.run);
  await forgetEntries(gamePath, entries);
  options.log?.("debug", "mackit undone", { fix: id });
  return { id, status: "restored", text: macText("mackit.undo.ok") };
}

/** les correctifs du manifeste, le plus récent d'abord */
function appliedOrder(entries: MacEntry[]): MacFixId[] {
  const last = new Map<MacFixId, number>();
  for (const entry of entries) last.set(entry.fix as MacFixId, entry.id);
  return [...last].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Annule un correctif, ou tous (le plus récent d'abord). Un correctif dont un fichier a changé
 * depuis n'est pas touché du tout : il reste au manifeste, et le résultat dit lequel.
 */
export async function undo(
  gamePath: string,
  target: MacFixId | "all",
  options: IUndoOptions = {},
): Promise<IUndoResult> {
  const { entries } = await readManifest(gamePath);
  const ids = target === "all" ? appliedOrder(entries) : [target];
  const fixes: IUndoOutcome[] = [];
  for (const id of ids) {
    fixes.push(
      await undoFix(
        gamePath,
        id,
        entries.filter((entry) => entry.fix === id),
        options,
      ),
    );
  }
  return { fixes };
}

/** Ce que le manifeste dit être appliqué : le bilan, le plus ancien d'abord. */
export async function appliedFixes(gamePath: string): Promise<IAppliedFix[]> {
  const { entries } = await readManifest(gamePath);
  const byFix = new Map<MacFixId, IAppliedFix>();
  for (const entry of entries) {
    const id = entry.fix as MacFixId;
    const applied = byFix.get(id) ?? { id, files: [], dlls: [], at: entry.at };
    if (entry.kind === "file") applied.files.push(entry.file);
    else applied.dlls.push(...entry.dlls);
    byFix.set(id, applied);
  }
  return [...byFix.values()];
}
