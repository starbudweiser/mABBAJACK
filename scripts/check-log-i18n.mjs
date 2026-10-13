// Coverage check: every log template in server.js / App.tsx should be translated by logCatalog.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { translateLog } from '../web/src/locales/logCatalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [`${root}/server/server.js`, `${root}/src/App.tsx`];
const missing = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:broadcastLog|addLog)\('(?:info|warn|error|success|debug)',\s*(`(?:[^`\\]|\\.|\$\{(?:[^{}]|\{[^{}]*\})*\})*`|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let lit = m[1].slice(1, -1);
    // replace ${...} (with one nesting level) by a sample value
    lit = lit.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'X1').replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1');
    const trimmed = lit.trim();
    if (!trimmed || /^[═─┌└│\s]*$/.test(trimmed) || trimmed === 'X1' || /^[\p{Emoji}\s]*X1$/u.test(trimmed)) continue;
    if (translateLog(lit, 'en') === lit) missing.push(`${f.split('/').pop()}: ${lit}`);
  }
}
console.log(missing.length ? missing.join('\n') : 'ALL COVERED');
