// Point d'entrée du moteur Mac commun pour le serveur : scripts/build-mackit.mjs l'empaquette en mackit/engine.mjs
// (le serveur est en JavaScript, le moteur en TypeScript). Les fichiers de mackit/ viennent de _tools/shared/mackit/src
// (recopiés par _tools/sync_shared.sh) : on ne les modifie jamais ici. API du moteur utilisée : plan, apply, undo,
// appliedFixes, MAC_TEXT_KEYS et les types ; bottlesCore sert à trouver la bouteille et à ranger son fichier d'état.
export { MAC_TEXT_KEYS, appliedFixes, apply, plan, undo } from "./mackit/macFixes";
export type {
  IAppliedFix,
  IFixOutcome,
  IMacPlan,
  IMacText,
  IUndoOutcome,
  MacFixId,
} from "./mackit/macFixes";
export { bottleForPath, configureBottles, listBottles } from "./mackit/bottlesCore";
export type { IBottle } from "./mackit/bottlesCore";
