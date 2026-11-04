#!/usr/bin/env node
// Empaquette le moteur Mac commun (web/server/mackit/*.ts, recopié depuis _tools/shared/mackit/src) en un seul module
// ES lisible par le serveur Node : web/server/mackit/engine.mjs (ignoré par git, regénéré avant start, test et build).
// Usage : node scripts/build-mackit.mjs [--if-missing]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'web/server/macengine.ts');
const outfile = path.join(root, 'web/server/mackit/engine.mjs');

export async function buildMackit({ ifMissing = false } = {}) {
  if (ifMissing && fs.existsSync(outfile)) return outfile;
  if (!fs.existsSync(path.join(root, 'web/server/mackit/macFixes.ts'))) {
    throw new Error('web/server/mackit absent : lancer _tools/sync_shared.sh');
  }
  const { build } = createRequire(path.join(root, 'web/package.json'))('esbuild');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile, logLevel: 'warning' });
  return outfile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildMackit({ ifMissing: process.argv.includes('--if-missing') })
    .then((f) => console.log(`Moteur Mac : ${path.relative(root, f)}`))
    .catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
