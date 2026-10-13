// Contrôle de l'espace disque avant installation.
import fs from 'node:fs';
import path from 'node:path';

/** Plus proche ancêtre existant d'un chemin (le dossier peut ne pas exister encore). */
function nearestExisting(p) {
  let cur = path.resolve(p);
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(cur)) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

/** { free, dev } pour le volume contenant p, ou null si indéterminable. */
export function volumeInfo(p) {
  try {
    const base = nearestExisting(p);
    if (!base) return null;
    const s = fs.statfsSync(base);
    return { free: Number(s.bavail) * Number(s.bsize), dev: fs.statSync(base).dev };
  } catch {
    return null;
  }
}

export function fmtBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  const gb = v / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(v / 1024 ** 2)} MB`;
}

/**
 * Évalue l'espace nécessaire.
 * @returns {{level:'ok'|'warn'|'error'|'unknown', need:number, free:number, shortBy:number, sameVolume:boolean, needDownloads:number, needInstall:number}}
 *   error : il manque plus de 10 % ; warn : il manque jusqu'à 10 % ; ok sinon.
 */
export function checkDiskSpace({ downloadDir, destDir, downloadBytes = 0, installBytes = 0 }) {
  const dl = volumeInfo(downloadDir);
  const dest = volumeInfo(destDir);
  const need = downloadBytes + installBytes;
  if (!dl || !dest) return { level: 'unknown', need, free: 0, shortBy: 0, sameVolume: false, needDownloads: downloadBytes, needInstall: installBytes };

  const sameVolume = dl.dev === dest.dev;
  const checks = sameVolume
    ? [{ need, free: dest.free }]
    : [{ need: downloadBytes, free: dl.free }, { need: installBytes, free: dest.free }];

  let level = 'ok';
  let shortBy = 0;
  let worst = checks[0];
  for (const c of checks) {
    const missing = c.need - c.free;
    if (missing > shortBy) { shortBy = missing; worst = c; }
    if (c.free < c.need * 0.9) level = 'error';
    else if (c.free < c.need && level !== 'error') level = 'warn';
  }
  return { level, need, free: worst.free, shortBy, sameVolume, needDownloads: downloadBytes, needInstall: installBytes };
}
