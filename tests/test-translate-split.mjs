// Test : le découpage de traduction respecte la limite d'octets et ne perd aucun caractère.
// Usage : node scripts/test-translate-split.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../web/server/server.js', import.meta.url), 'utf8');
const m = /function splitForTranslation[\s\S]*?\n}\n/.exec(src);
assert.ok(m, 'splitForTranslation introuvable');
const split = new Function('Buffer', `const TRANSLATE_CHUNK_BYTES = 400; ${m[0]}; return splitForTranslation;`)(Buffer);

const samples = [
  'Hello world. This is a test!\nSecond line… with ellipsis...',
  '. leading dot and ?! marks',
  'é'.repeat(900),                                  // multi-octets, sans espace
  'word '.repeat(2000),                              // long, sans ponctuation
  ('Une phrase très accentuée : été, à, ç. ').repeat(300),
  '\n\n\n',
  'x',
];
for (const s of samples) {
  const parts = split(s);
  assert.equal(parts.map((p) => p.text).join(''), s, 'aucune perte de texte');
  for (const p of parts) assert.ok(Buffer.byteLength(p.text) <= 400 || !p.translate, `bloc trop gros : ${Buffer.byteLength(p.text)}`);
}
console.log('OK : découpage traduction');
