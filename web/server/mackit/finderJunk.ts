/**
 * mORTEX (macOS) : fichiers que macOS dépose tout seul, jamais des fichiers de mod.
 *
 * Interface :
 *  - isFinderJunk(filePath): boolean     `.DS_Store` (réglages d'affichage du dossier) et `._nom`
 *  - isMacMetadata(filePath): boolean    idem, plus tout ce qui est sous un dossier `__MACOSX`
 *
 * `._nom` : sur un disque sans attributs étendus natifs (exFAT, FAT, partage réseau), macOS range les
 * attributs de « nom » dans un fichier visible « ._nom ». Déployé dans Data, Wine le voit comme un vrai
 * fichier : SKSE essayait de charger « ._EngineFixes.dll » comme plugin et le jeu plantait (constaté par
 * SkyrimMT, ticket GitHub #16). `__MACOSX` : dossier ajouté par l'outil de compression de macOS.
 * Ces fichiers ne sont donc jamais déployés, et au retrait des mods un dossier qui ne contient plus
 * qu'eux compte comme vide.
 */
import * as path from "path";

export const FINDER_JUNK = [".DS_Store"];

export function isFinderJunk(filePath: string): boolean {
  const name = path.basename(filePath);
  return FINDER_JUNK.includes(name) || name.startsWith("._");
}

export function isMacMetadata(filePath: string): boolean {
  return isFinderJunk(filePath) || filePath.split(/[\\/]/).includes("__MACOSX");
}
