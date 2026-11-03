#!/usr/bin/env node
/**
 * Cache disque des traductions : une traduction obtenue est relue au lancement suivant,
 * et le message de quota épuisé de MyMemory suspend les appels jusqu'à l'heure annoncée.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'txcache-'));
const mod = new URL('../web/server/translatecache.js', import.meta.url).href;
const env = { ...process.env, MABBAJACK_DATA_DIR: tmp };
const run = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
try {
  let r = run(`import { cacheSet } from '${mod}'; cacheSet('fr:Hello', 'Bonjour'); setTimeout(() => {}, 2500);`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'translations.json'), 'utf8')), { 'fr:Hello': 'Bonjour' });

  r = run(`import { translateCache, quotaExhausted, noteQuotaMessage } from '${mod}';
    if (translateCache.get('fr:Hello') !== 'Bonjour') process.exit(2);
    if (quotaExhausted()) process.exit(3);
    if (noteQuotaMessage('QUERY LENGTH LIMIT EXCEEDED')) process.exit(4);
    if (!noteQuotaMessage('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN  18 HOURS 20 MINUTES 49 SECONDS')) process.exit(5);
    if (!quotaExhausted()) process.exit(6);`);
  assert.equal(r.status, 0, `code ${r.status} ${r.stderr}`);
  console.log('test-translatecache : OK');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
