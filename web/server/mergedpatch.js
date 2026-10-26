// MergedPatch (fusions zEdit) : Wabbajack concatène les fichiers sources DÉJÀ installés, dans l'ordre de la
// liste, puis applique un delta OctoDiff pour obtenir le plugin fusionné (Wabbajack.Installer, StandardInstaller
// « Generating ZEdit Merges »). À faire après les autres directives, qui installent les sources.
import fs from 'fs';
import path from 'path';
import { resolveDirectivePath } from './paths.js';
import { applyOctoDiff, octoDiffResultMatches } from './octodiff.js';

/**
 * Écrit le fichier fusionné d'une directive MergedPatch.
 * @param {object} d directive { To, PatchID, Sources: [{ RelativePath, Hash }] }
 * @param {string} destRoot dossier d'installation
 * @param {Buffer|null} delta patch lu dans le .wabbajack
 * @returns {{ file:string, sources:number }}
 */
export function buildMergedPatch(d, destRoot, delta) {
  const outFile = resolveDirectivePath(d.To, destRoot);
  if (!outFile) throw new Error('chemin de destination invalide');
  if (!delta) throw new Error('patch absent du .wabbajack');
  const sources = Array.isArray(d.Sources) ? d.Sources : [];
  if (sources.length === 0) throw new Error('aucune source');
  const parts = sources.map((s) => {
    const file = resolveDirectivePath(s.RelativePath, destRoot);
    if (!file || !fs.existsSync(file)) throw new Error(`source absente : ${s.RelativePath}`);
    return fs.readFileSync(file);
  });
  const out = applyOctoDiff(Buffer.concat(parts), delta);
  if (octoDiffResultMatches(out, delta) === false) throw new Error('résultat différent de celui attendu (sources d\'une autre version)');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  return { file: outFile, sources: sources.length };
}
