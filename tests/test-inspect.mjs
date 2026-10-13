import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWabbajack, DIRECTIVES_SAMPLE } from '../web/server/inspect.js';
import { openLazyZip } from '../web/server/lazyzip.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(root, 'tests', 'Authoria - Requiem Reforged.wabbajack');
if (!fs.existsSync(file)) { console.log('SKIP : fichier de test absent', file); process.exit(0); }

const steps = [];
const t0 = Date.now();
const r = await inspectWabbajack(file, undefined, { onStep: (s) => steps.push(s) });
const ms = Date.now() - t0;

assert.ok(r.name && r.numberOfArchives > 0 && r.numberOfDirectives > 0, 'totaux');
assert.ok(r.directives.length <= DIRECTIVES_SAMPLE, 'échantillon borné');
assert.equal(r.directivesTruncated, r.numberOfDirectives > DIRECTIVES_SAMPLE);
assert.deepEqual(steps, ['index', 'manifest', 'directives', 'plugins']);
const payload = Buffer.byteLength(JSON.stringify(r));
assert.ok(payload < 50 * 1024 * 1024, `réponse trop lourde : ${payload}`);

const z = await openLazyZip(file);
assert.equal(z.file('n-existe-pas'), null);
assert.ok(z.file('modlist'));

console.log(`${r.name} v${r.version} | ${r.numberOfArchives} archives | ${r.numberOfDirectives} directives (${r.directives.length} renvoyées)`);
console.log(`plugins ${r.loadOrder.length} | réponse ${(payload / 1048576).toFixed(1)} Mo | ${ms} ms`);
console.log('inspect OK');
