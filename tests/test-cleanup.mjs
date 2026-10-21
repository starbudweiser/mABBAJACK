// Test hors ligne : archives de DOWNLOADS inutilisées par les listes installées.
// Usage : node tests/test-cleanup.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { findUnusedDownloads } from '../web/server/cleanup.js';
import { snapshotPath } from '../web/server/update.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab-cleanup-'));
const dl = path.join(root, 'DOWNLOADS'), ready = path.join(root, 'READY');
const write = (p, n = 10) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(n)); };
const snapshot = (dir, archives) => {
  fs.mkdirSync(path.dirname(snapshotPath(dir)), { recursive: true });
  fs.writeFileSync(snapshotPath(dir), zlib.gzipSync(JSON.stringify({ format: 1, name: path.basename(dir), version: '1', archives, manifest: [], files: [] })));
};

try {
  write(path.join(dl, 'skyrimse', 'Used.7z'));
  write(path.join(dl, 'skyrimse', 'Old.zip'), 100);
  write(path.join(dl, 'skyrimse', 'Old.zip.meta'), 1);
  write(path.join(dl, 'skyrimse', 'Orphan.rar.meta'), 1);
  write(path.join(dl, 'skyrimse', 'InProgress.7z.part'));
  write(path.join(dl, 'List.wabbajack'));
  write(path.join(dl, 'LIST_A', 'Dedicated.7z'));

  // Aucune liste installée : tout paraîtrait inutilisé
  assert.equal(findUnusedDownloads(dl, ready).installs.length, 0);

  snapshot(path.join(ready, 'LIST_A'), [['h1', 'Used.7z', 10], ['h2', 'dedicated.7z', 10]]);
  const r = findUnusedDownloads(dl, ready);
  assert.equal(r.installs.length, 1);
  assert.deepEqual(r.legacy, []);
  assert.deepEqual(r.unused.map((u) => u.name), ['Old.zip', 'Orphan.rar.meta']);
  assert.equal(r.unused[0].meta, path.join(dl, 'skyrimse', 'Old.zip.meta'));
  assert.equal(r.totalSize, 101);

  // Installation sans état enregistré : signalée
  write(path.join(ready, 'LIST_B', 'README_READY_TO_PLAY.txt'));
  assert.deepEqual(findUnusedDownloads(dl, ready).legacy, [path.join(ready, 'LIST_B')]);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('cleanup OK');
