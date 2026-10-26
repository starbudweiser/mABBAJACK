// MergedPatch : concaténation des sources installées + delta OctoDiff (fabriqué ici octet par octet).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMergedPatch } from '../web/server/mergedpatch.js';
import { resolveDirectivePath } from '../web/server/paths.js';

/** Delta OctoDiff : en-tête SHA1 du résultat, puis commandes Copy (0x60) et Data (0x80). */
function octoDelta(result, commands) {
  const int64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const hash = crypto.createHash('sha1').update(result).digest();
  const head = [Buffer.from('OCTODELTA'), Buffer.from([1, 4]), Buffer.from('SHA1'), Buffer.alloc(4), hash, Buffer.from('>>>')];
  head[3].writeInt32LE(hash.length);
  const body = commands.map((c) => (c.copy
    ? Buffer.concat([Buffer.from([0x60]), int64(c.copy[0]), int64(c.copy[1])])
    : Buffer.concat([Buffer.from([0x80]), int64(c.data.length), c.data])));
  return Buffer.concat([...head, ...body]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_merge_'));
try {
  const dest = path.join(tmp, 'install');
  // Emplacement réel des fichiers dans l'installation (mods\X\… est aplati dans Data)
  const at = (rel) => { const f = resolveDirectivePath(rel, dest); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  fs.writeFileSync(at('mods\\A\\a.esp'), 'AAAA');
  fs.writeFileSync(at('mods\\B\\b.esp'), 'BBBB');
  const merged = at('mods\\Merge\\merged.esp');
  // Résultat attendu : « AA » de a.esp + « -merged- » + « BB » de b.esp (offsets dans la concaténation AAAABBBB)
  const result = Buffer.from('AA-merged-BB');
  const delta = octoDelta(result, [{ copy: [0, 2] }, { data: Buffer.from('-merged-') }, { copy: [6, 2] }]);
  const d = {
    $type: 'MergedPatch, Wabbajack.Lib', To: 'mods\\Merge\\merged.esp', PatchID: 'p1',
    Sources: [{ RelativePath: 'mods\\A\\a.esp' }, { RelativePath: 'mods\\B\\b.esp' }],
  };
  const r = buildMergedPatch(d, dest, delta);
  assert.equal(r.sources, 2);
  assert.equal(fs.readFileSync(merged, 'utf8'), 'AA-merged-BB');

  // Source d'une autre version : le résultat ne correspond plus au hash → refus, rien n'est écrit
  fs.writeFileSync(at('mods\\A\\a.esp'), 'XXXX');
  fs.rmSync(merged);
  assert.throws(() => buildMergedPatch(d, dest, delta), /autre version/);
  assert.equal(fs.existsSync(merged), false);

  assert.throws(() => buildMergedPatch({ ...d, Sources: [{ RelativePath: 'mods\\C\\c.esp' }] }, dest, delta), /source absente/);
  assert.throws(() => buildMergedPatch(d, dest, null), /patch absent/);
  assert.throws(() => buildMergedPatch({ ...d, To: '..\\..\\evil.esp' }, dest, delta), /destination/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('OK mergedpatch');
