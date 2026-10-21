// Nettoyage du dossier DOWNLOADS : archives qu'aucune liste installée n'utilise.
// Les listes installées sont lues dans READY TO PLAY (état enregistré .mabbajack/ de chaque installation).
// Rien n'est supprimé définitivement : les fichiers retenus partent à la Corbeille (/usr/bin/trash).

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readSnapshot, SNAPSHOT_DIR } from './update.js';

const KEEP_EXT = /\.(wabbajack|part)$/i;

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(dir, e.name)); }
  catch { return []; }
}

/** Installations trouvées dans READY TO PLAY : avec état enregistré, ou anciennes (sans état). */
export function scanInstalls(readyRoot) {
  const installs = [], legacy = [];
  for (const dir of subdirs(readyRoot)) {
    const snap = readSnapshot(dir);
    if (snap) installs.push({ dir, name: snap.name, version: snap.version, archives: snap.archives || [] });
    else if (fs.existsSync(path.join(dir, SNAPSHOT_DIR)) || fs.existsSync(path.join(dir, 'README_READY_TO_PLAY.txt'))) legacy.push(dir);
  }
  return { installs, legacy };
}

/**
 * Archives de DOWNLOADS (racine + un niveau de sous-dossiers : organisation Vortex, dossiers dédiés)
 * absentes de toutes les listes installées. Un « .meta » (Vortex / MO2) suit son archive.
 * Les .wabbajack et les téléchargements en cours (.part) ne sont jamais proposés.
 */
export function findUnusedDownloads(downloadsRoot, readyRoot) {
  const { installs, legacy } = scanInstalls(readyRoot);
  const used = new Set();
  for (const inst of installs) for (const a of inst.archives) if (a[1]) used.add(String(a[1]).toLowerCase());

  const unused = [];
  const visit = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.') || KEEP_EXT.test(e.name)) continue;
      const base = e.name.replace(/\.meta$/i, '');
      if (used.has(base.toLowerCase())) continue;
      // .meta dont l'archive est encore là : traité avec elle
      if (base !== e.name && entries.some((x) => x.name === base)) continue;
      const p = path.join(dir, e.name);
      let size = 0;
      try { size = fs.statSync(p).size; } catch { continue; }
      const meta = `${p}.meta`;
      unused.push({ path: p, name: e.name, size, meta: fs.existsSync(meta) ? meta : null });
    }
  };
  visit(downloadsRoot);
  for (const d of subdirs(downloadsRoot)) visit(d);
  unused.sort((a, b) => b.size - a.size);
  return {
    installs: installs.map(({ dir, name, version, archives }) => ({ dir, name, version, archives: archives.length })),
    legacy,
    unused,
    totalSize: unused.reduce((s, u) => s + u.size, 0),
  };
}

/** Place des fichiers dans la Corbeille macOS (récupérables depuis le Finder). */
export function moveToTrash(paths) {
  return new Promise((resolve, reject) => {
    if (!paths.length) return resolve();
    execFile('/usr/bin/trash', paths, { timeout: 120000 }, (err, _stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });
}
