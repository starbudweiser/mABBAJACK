// Choix du dossier du jeu source : celui dont les fichiers originaux (GameFileSource)
// correspondent à la version attendue par le manifeste. Les patchs du manifeste
// s'appliquent sur ces fichiers : une autre version donne des fichiers faux.
import fs from 'fs';
import path from 'path';

const relOf = (a) => String(a?.State?.GameFile || '').replace(/\\/g, '/');

/** Chemin du fichier du jeu dans root s'il a la taille attendue, sinon null. */
export function matchInRoot(root, a) {
  const rel = relOf(a);
  if (!rel) return null;
  for (const p of [path.join(root, rel), path.join(root, rel.replace(/^data\//i, ''))]) {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0 && (!a.Size || st.size === a.Size)) return p;
    } catch { /* suivant */ }
  }
  return null;
}

/**
 * Classe les dossiers candidats selon le nombre de fichiers du jeu conformes.
 * À égalité, le dossier choisi par l'utilisateur passe en premier, puis l'ordre des candidats.
 * @returns {{ root:string, matched:number }[]} du meilleur au moins bon
 */
export function rankGameRoots(roots, games, preferred = null) {
  const pref = preferred ? path.resolve(preferred) : null;
  return [...new Set(roots.map((r) => path.resolve(r)))]
    .map((root, i) => ({ root, i, matched: games.filter((a) => matchInRoot(root, a)).length }))
    .sort((x, y) => (y.matched - x.matched) || ((y.root === pref) - (x.root === pref)) || (x.i - y.i))
    .map(({ root, matched }) => ({ root, matched }));
}

/**
 * Dossiers du jeu voisins d'un dossier donné (ex. autres versions rangées côte à côte :
 * « 2 - SKYRIM 1.6.1170/Skyrim Special Edition », « 3 - SKYRIM 1.7.104/Skyrim Special Edition »).
 * Remonte jusqu'à `levels` parents et explore leurs sous-dossiers sur `depth` niveaux.
 */
export function siblingGameRoots(start, isRoot, levels = 2, depth = 2) {
  const found = [];
  if (!start) return found;
  let base = path.resolve(start);
  for (let l = 0; l < levels; l++) {
    base = path.dirname(base);
    if (base === '/' || base === '/Volumes') break;
    let level = [base];
    for (let d = 0; d < depth && level.length; d++) {
      const next = [];
      for (const dir of level) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          const p = path.join(dir, e.name);
          if (isRoot(p)) { if (!found.includes(p)) found.push(p); } else next.push(p);
        }
      }
      level = next;
    }
  }
  return found;
}
