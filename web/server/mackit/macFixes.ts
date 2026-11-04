/**
 * Moteur Mac commun (mORTEX, mABBAJACK, mO2FLATTENER) : adaptation d'un dossier de jeu et de sa
 * bouteille au rendu moderne sous DXMT, annoncée avant et réversible après.
 * Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh.
 *
 * Point d'entrée unique (l'outil en ligne de commande `mackit`, le serveur de mABBAJACK, l'Atelier de
 * mORTEX) :
 *  - plan(gamePath, bottle?, options?)       simulation : rien n'est écrit            (macPlan)
 *  - apply(plan, options?)                    applique, sauvegarde, écrit le manifeste (macApply)
 *  - undo(gamePath, fixId | "all", options?)  restaure depuis le manifeste             (macApply)
 *  - appliedFixes(gamePath)                   ce que le manifeste dit être appliqué    (macApply)
 *  - MAC_TEXT_KEYS                            les clés de traduction que le moteur renvoie (macTexts)
 *  - MAC_FIX_IDS                              les identifiants de correctifs (macPlan)
 */
export { appliedFixes, apply, undo } from "./macApply";
export type {
  IAppliedFix,
  IApplyOptions,
  IApplyResult,
  IFixOutcome,
  IUndoOptions,
  IUndoOutcome,
  IUndoResult,
} from "./macApply";
export { BACKUP_DIR_NAME, backupDir, manifestPath, readManifest } from "./macManifest";
export type { IFileEntry, IMacManifest, IRefusal, IRegistryEntry, MacEntry } from "./macManifest";
export { MAC_FIX_IDS, plan } from "./macPlan";
export type {
  IDiscardedFile,
  IMacPlan,
  IPlanOptions,
  IPlannedFix,
  ISkippedFix,
  MacFixId,
  MacOperation,
} from "./macPlan";
export { MAC_TEXT_KEYS } from "./macTexts";
export type { IMacText, MacTextKey } from "./macTexts";
export { BOTTLED_MIN_VERSION, bottledStatus, compareVersions } from "./bottledVersion";
export type { BottledState, IBottledStatus } from "./bottledVersion";
