#!/usr/bin/env node
/**
 * Test de l'écrivain BSA : node scripts/test-bsawriter.mjs <fichier.bsa>
 *  1. vérifie que tes5Hash() redonne les hashes stockés dans un vrai BSA ;
 *  2. ré-empaquette ~200 fichiers puis relit l'archive et compare le contenu.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBsa } from '../web/server/bsa.js';
import { tes5Hash, createBsa } from '../web/server/bsawriter.js';

const bsaPath = process.argv[2];
if (!bsaPath || !fs.existsSync(bsaPath)) { console.error('Usage: node scripts/test-bsawriter.mjs <fichier.bsa>'); process.exit(2); }

const fd = fs.openSync(bsaPath, 'r');
const h = Buffer.alloc(36); fs.readSync(fd, h, 0, 36, 0);
const version = h.readUInt32LE(4);
const flags = h.readUInt32LE(12);
const folderCount = h.readUInt32LE(16);
const fileCount = h.readUInt32LE(20);
const tfn = h.readUInt32LE(24);
const tfl = h.readUInt32LE(28);
const recSize = version === 105 ? 24 : 16;
const dirBuf = Buffer.alloc(folderCount * recSize + tfn + folderCount + fileCount * 16 + tfl);
fs.readSync(fd, dirBuf, 0, dirBuf.length, 36);
fs.closeSync(fd);

let p = folderCount * recSize;
const files = [];
let okF = 0, badF = 0, okFi = 0, badFi = 0;
for (let i = 0; i < folderCount; i++) {
  const fh = dirBuf.readBigUInt64LE(i * recSize);
  const cnt = dirBuf.readUInt32LE(i * recSize + 8);
  const len = dirBuf[p++];
  const name = dirBuf.toString('latin1', p, p + len - 1); p += len;
  if (tes5Hash(name, true) === fh) okF++; else { badF++; if (badF < 4) console.log('folder KO', name); }
  for (let j = 0; j < cnt; j++) { files.push({ folder: name, hash: dirBuf.readBigUInt64LE(p) }); p += 16; }
}
for (const f of files) {
  let end = p; while (dirBuf[end] !== 0) end++;
  f.name = dirBuf.toString('latin1', p, end); p = end + 1;
  if (tes5Hash(f.name, false) === f.hash) okFi++; else { badFi++; if (badFi < 4) console.log('file KO', f.name, f.hash.toString(16), tes5Hash(f.name).toString(16)); }
}
console.log(`BSA v${version} flags=0x${flags.toString(16)} — hash dossiers ${okF}/${folderCount}, fichiers ${okFi}/${fileCount}`);

// Aller-retour
const src = openBsa(bsaPath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsaw-'));
try {
  const keys = [...src.entries.keys()].slice(0, 200);
  for (const k of keys) {
    const dest = path.join(tmp, 'in', ...k.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src.readFile(k));
  }
  const out = path.join(tmp, 'out.bsa');
  const r = createBsa(path.join(tmp, 'in'), out, { Version: version, ArchiveFlags: flags, FileFlags: h.readUInt32LE(32) });
  const re = openBsa(out);
  let same = 0;
  for (const k of keys) if (Buffer.compare(re.readFile(k) ?? Buffer.alloc(0), src.readFile(k)) === 0) same++;
  re.close();
  console.log(`Aller-retour : ${same}/${keys.length} identiques (${r.files} fichiers, ${r.bytes} octets)`);
  process.exitCode = (badF || badFi || same !== keys.length) ? 1 : 0;
} finally {
  src.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
