import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTexconv, readDdsInfo, matchesState, TextureQueue } from '../web/server/textures.js';

// DDS RGBA 8 bits non compressé (en-tête « legacy », sans DX10), une seule mip
function rgbaDds(w, h) {
  const head = Buffer.alloc(128);
  head.write('DDS ', 0, 'latin1');
  head.writeUInt32LE(124, 4);
  head.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x8, 8);
  head.writeUInt32LE(h, 12); head.writeUInt32LE(w, 16); head.writeUInt32LE(w * 4, 20);
  head.writeUInt32LE(1, 28);
  head.writeUInt32LE(32, 76); head.writeUInt32LE(0x40 | 0x1, 80); head.writeUInt32LE(32, 88);
  head.writeUInt32LE(0xff, 92); head.writeUInt32LE(0xff00, 96); head.writeUInt32LE(0xff0000, 100); head.writeUInt32LE(0xff000000, 104);
  head.writeUInt32LE(0x1000, 108);
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = i % 251; px[i * 4 + 1] = (i * 7) % 256; px[i * 4 + 2] = 128; px[i * 4 + 3] = 255; }
  return Buffer.concat([head, px]);
}

// Taille attendue d'un DDS BC (bloc 4x4 de `bytes` octets), en-tête DX10 si `dx10`
function bcSize(w, h, mips, bytes, dx10) {
  let s = dx10 ? 148 : 128;
  for (let i = 0; i < mips; i++) {
    s += Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * bytes;
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  return s;
}

// En-têtes
const src = rgbaDds(64, 64);
assert.deepEqual(readDdsInfo(src), { width: 64, height: 64, mips: 1, format: 'R8G8B8A8_UNORM' });
assert.equal(readDdsInfo(Buffer.from('PNG nope')), null);
const dxt5 = Buffer.from(src); dxt5.writeUInt32LE(0x4, 80); dxt5.write('DXT5', 84, 'latin1');
assert.equal(readDdsInfo(dxt5).format, 'BC3_UNORM');
const dx10 = Buffer.concat([Buffer.from(src.subarray(0, 128)), Buffer.alloc(20)]);
dx10.writeUInt32LE(0x4, 80); dx10.write('DX10', 84, 'latin1'); dx10.writeUInt32LE(99, 128);
assert.equal(readDdsInfo(dx10).format, 'BC7_UNORM_SRGB');
const rgb24 = Buffer.from(src.subarray(0, 128));
rgb24.writeUInt32LE(24, 88); rgb24.writeUInt32LE(0xff0000, 92); rgb24.writeUInt32LE(0xff, 100); rgb24.writeUInt32LE(0, 104);
assert.equal(readDdsInfo(rgb24).format, 'R8G8B8A8_UNORM');
assert.equal(matchesState(readDdsInfo(src), { Width: 64, Height: 64, MipLevels: 1, Format: 'R8G8B8A8_UNORM' }), true);
assert.equal(matchesState(readDdsInfo(src), { Width: 64, Height: 64, MipLevels: 7, Format: 'R8G8B8A8_UNORM' }), false);

const bin = findTexconv();
if (!bin) {
  console.log('test-textures : en-têtes OK — conversion ignorée (texconv absent)');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_tex_'));
try {
  const srcFile = path.join(dir, 'src.dds');
  fs.writeFileSync(srcFile, src);
  const q = new TextureQueue({ bin, stageRoot: path.join(dir, 'stage') });
  const cases = [
    { st: { Width: 32, Height: 32, MipLevels: 6, Format: 'BC1_UNORM' }, size: bcSize(32, 32, 6, 8, false), to: 'a\\bc1.dds' },
    { st: { Width: 16, Height: 16, MipLevels: 1, Format: 'BC7_UNORM_SRGB' }, size: bcSize(16, 16, 1, 16, true), to: 'b\\bc7.dds' },
    { st: { Width: 32, Height: 32, MipLevels: 6, Format: 'BC1_UNORM' }, size: bcSize(32, 32, 6, 8, false), to: 'a\\bc1_bis.dds' },
  ];
  for (const c of cases) {
    const out = path.join(dir, 'dest', c.to.replace(/\\/g, '/'));
    assert.equal(q.add({ ImageState: c.st, Size: c.size, To: c.to }, out, c.to.includes('bis') ? { buffer: src } : { file: srcFile }), true);
  }
  // Source déjà à l'état demandé : pas de conversion
  assert.equal(q.add({ ImageState: { Width: 64, Height: 64, MipLevels: 1, Format: 'R8G8B8A8_UNORM' }, Size: src.length, To: 'c.dds' }, path.join(dir, 'c.dds'), { file: srcFile }), false);
  assert.equal(q.size, 3);
  assert.equal(q.groups.size, 2);

  let last = 0;
  const r = await q.run({ jobs: 2, onProgress: (d) => { last = d; } });
  assert.equal(last, 3);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.sizeMismatch, []);
  assert.equal(r.converted, 3);
  for (const c of cases) {
    const out = path.join(dir, 'dest', c.to.replace(/\\/g, '/'));
    const info = readDdsInfo(fs.readFileSync(out));
    assert.equal(fs.statSync(out).size, c.size);
    assert.equal(info.width, c.st.Width);
    assert.equal(info.mips, c.st.MipLevels);
    assert.equal(info.format, c.st.Format);
  }
  assert.equal(fs.existsSync(path.join(dir, 'stage')), false);
  console.log('test-textures : OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
