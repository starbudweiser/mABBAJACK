/**
 * mORTEX (macOS) : fichiers que le Finder dépose tout seul dans les dossiers qu'on ouvre.
 *
 * Interface :
 *  - isFinderJunk(filePath): boolean   `.DS_Store` (réglages d'affichage du dossier)
 *
 * Au retrait des mods, un dossier qui ne contient plus que ces fichiers compte comme vide :
 * sinon un simple passage dans le Finder empêchait de supprimer les dossiers créés par mORTEX.
 */
import * as path from "path";

export const FINDER_JUNK = [".DS_Store"];

export function isFinderJunk(filePath: string): boolean {
  return FINDER_JUNK.includes(path.basename(filePath));
}
