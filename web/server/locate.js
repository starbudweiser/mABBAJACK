// Retrouve le vrai fichier .wabbajack à partir de son nom et de sa taille.
// L'API File du navigateur ne donne pas le chemin d'un fichier déposé : sans cela, le fichier
// serait recopié (plusieurs Go) dans un dossier temporaire, et le dossier dédié à la liste perdu.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

const UPLOAD_DIR_NAME = 'mabbajack-uploads';
const realTmp = (() => { try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); } })();

/** Chemin temporaire (copie envoyée par le navigateur, /tmp, /var/folders…) : jamais un dossier de travail. */
export function isTempPath(p) {
  if (typeof p !== 'string' || !p) return false;
  let r = p;
  try { r = fs.realpathSync(p); } catch { /* absent */ }
  return r.split(path.sep).includes(UPLOAD_DIR_NAME) || r.startsWith(realTmp + path.sep)
    || /^\/(private\/)?(tmp|var\/folders)\//.test(r);
}

const sizeOf = (p) => { try { const st = fs.statSync(p); return st.isFile() ? st.size : -1; } catch { return -1; } };

function spotlight(name, timeoutMs) {
  return new Promise((resolve) => {
    execFile('mdfind', ['-name', name], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? [] : String(stdout || '').split('\n').filter(Boolean));
    });
  });
}

/** Parcours limité (profondeur, nombre de dossiers) des volumes et dossiers usuels. */
async function scan(name, size, roots, { maxDepth = 5, maxDirs = 30000 } = {}) {
  const queue = roots.filter((r) => fs.existsSync(r)).map((r) => [r, 0]);
  let seen = 0;
  while (queue.length && seen < maxDirs) {
    const [dir, depth] = queue.shift();
    seen++;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === name && sizeOf(full) === size) return full;
      if (e.isDirectory() && depth < maxDepth && !/\.app$/i.test(e.name)) queue.push([full, depth + 1]);
    }
  }
  return null;
}

/** Chemin réel d'un .wabbajack (même nom, même taille), hors dossiers temporaires ; null sinon. */
export async function locateWabbajack(name, size, { roots } = {}) {
  if (typeof name !== 'string' || !/\.wabbajack$/i.test(name) || !(size > 0)) return null;
  const base = path.basename(name);
  for (const p of await spotlight(base, 5000)) {
    if (path.basename(p) === base && sizeOf(p) === size && !isTempPath(p)) return p;
  }
  const defaults = [
    ...(() => { try { return fs.readdirSync('/Volumes').map((v) => path.join('/Volumes', v)); } catch { return []; } })(),
    ...['Downloads', 'Desktop', 'Documents'].map((d) => path.join(os.homedir(), d)),
  ];
  const found = await scan(base, size, roots || defaults);
  return found && !isTempPath(found) ? found : null;
}
