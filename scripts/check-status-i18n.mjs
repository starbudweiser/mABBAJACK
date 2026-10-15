// Vérifie que les stageName / currentTask / errorMessage / json({error}) du serveur sont couverts par logCatalog.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { translateLog } from '../web/src/locales/logCatalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(`${root}/web/server/server.js`, 'utf8');
const re = /(?:stageName|currentTask|errorMessage|error):\s*(`(?:[^`\\]|\\.|\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*`|'(?:[^'\\]|\\.)*')/g;
const missing = new Set();
let m;
while ((m = re.exec(src)) !== null) {
  const lit = m[1].slice(1, -1)
    .replace(/\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, 'X1')
    .replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1');
  const t = lit.trim();
  if (!t || t === 'X1' || !/[A-Za-zÀ-ÿ]{3,}/.test(t.replace(/X1/g, ''))) continue;
  if (translateLog(lit, 'en') === lit) missing.add(lit);
}
console.log(missing.size ? [...missing].join('\n') : 'ALL COVERED');
