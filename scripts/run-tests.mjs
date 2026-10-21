// Lance tous les tests unitaires (tests/test-*.mjs) ; s'arrête en échec au premier test qui échoue.
// test-bsawriter et test-octodiff demandent des fichiers réels en argument : à lancer à la main.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const TESTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const MANUAL = new Set(['test-bsawriter.mjs', 'test-octodiff.mjs']);

const files = readdirSync(TESTS_DIR).filter((f) => /^test-.*\.mjs$/.test(f) && !MANUAL.has(f)).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(TESTS_DIR, f)], { encoding: 'utf8' });
  if (r.status === 0) console.log(`OK   ${f}`);
  else { failed++; console.log(`FAIL ${f}\n${(r.stdout + r.stderr).trim().split('\n').slice(-10).join('\n')}`); }
}
console.log(`\n${files.length - failed}/${files.length} réussi(s)`);
process.exit(failed ? 1 : 0);
