// Test : applique les patchs OctoDiff des fichiers du jeu d'une modlist.
// Usage : node scripts/test-octodiff.mjs <fichier.wabbajack> <dossier du jeu>
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { patchFile } from '../web/server/octodiff.js';

const [wj, gameDir] = process.argv.slice(2);
if (!wj || !gameDir) { console.error('Usage : node scripts/test-octodiff.mjs <fichier.wabbajack> <dossier du jeu>'); process.exit(2); }
const zip = await JSZip.loadAsync(fs.readFileSync(wj));
const m = JSON.parse(await zip.file('modlist').async('string'));
const gf = new Map(m.Archives.filter((a) => /GameFileSource/.test(a.State.$type)).map((a) => [a.Hash, a]));
const stats = { patched: 0, already: 0, fallback: 0, absent: 0, sizeMismatch: 0 };
for (const d of m.Directives) {
  if (!d.$type.startsWith('PatchedFromArchive')) continue;
  const a = gf.get(d.ArchiveHashPath[0]);
  if (!a || d.ArchiveHashPath.length !== 1) continue;
  const p = path.join(gameDir, a.State.GameFile.replace(/\\/g, '/'));
  if (!fs.existsSync(p)) { stats.absent++; console.log('ABSENT', p); continue; }
  const r = patchFile(fs.readFileSync(p), await zip.file(d.PatchID).async('nodebuffer'));
  stats[r.status]++;
  if (r.status === 'fallback') console.log('FALLBACK', path.basename(p), r.reason);
  else if (r.data.length !== d.Size) { stats.sizeMismatch++; console.log('TAILLE', path.basename(p), r.data.length, d.Size); }
}
console.log(stats);
process.exit(stats.sizeMismatch ? 1 : 0);
