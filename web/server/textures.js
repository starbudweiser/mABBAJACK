// Directives TransformedTexture : redimensionnement / recompression DDS avec texconv (DirectXTex).
// Les textures sont collectées pendant l'extraction, regroupées par état cible
// (Width, Height, MipLevels, Format), puis converties en lot à la fin de l'extraction.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trackedSpawn } from './jobcontrol.js';

const TOOLS_TEXCONV = '/Volumes/SKYRIM/TOOLS/MAC/_tools/texconv/texconv-mac';

/** Binaire texconv : embarqué (BUNDLED_BIN_DIR), MABBAJACK_TEXCONV, puis dossier _tools. */
export function findTexconv(bundledDir = '') {
  const candidates = [
    bundledDir ? path.join(bundledDir, 'texconv') : '',
    process.env.MABBAJACK_TEXCONV || '',
    TOOLS_TEXCONV,
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* */ }
  }
  return null;
}

const DXGI = {
  2: 'R32G32B32A32_FLOAT', 10: 'R16G16B16A16_FLOAT', 24: 'R10G10B10A2_UNORM',
  28: 'R8G8B8A8_UNORM', 29: 'R8G8B8A8_UNORM_SRGB', 49: 'R8G8_UNORM', 61: 'R8_UNORM', 65: 'A8_UNORM',
  71: 'BC1_UNORM', 72: 'BC1_UNORM_SRGB', 74: 'BC2_UNORM', 75: 'BC2_UNORM_SRGB',
  77: 'BC3_UNORM', 78: 'BC3_UNORM_SRGB', 80: 'BC4_UNORM', 81: 'BC4_SNORM',
  83: 'BC5_UNORM', 84: 'BC5_SNORM', 85: 'B5G6R5_UNORM', 86: 'B5G5R5A1_UNORM',
  87: 'B8G8R8A8_UNORM', 88: 'B8G8R8X8_UNORM', 91: 'B8G8R8A8_UNORM_SRGB', 93: 'B8G8R8X8_UNORM_SRGB',
  95: 'BC6H_UF16', 96: 'BC6H_SF16', 98: 'BC7_UNORM', 99: 'BC7_UNORM_SRGB',
};
const FOURCC = {
  DXT1: 'BC1_UNORM', DXT2: 'BC2_UNORM', DXT3: 'BC2_UNORM', DXT4: 'BC3_UNORM', DXT5: 'BC3_UNORM',
  ATI1: 'BC4_UNORM', BC4U: 'BC4_UNORM', BC4S: 'BC4_SNORM', ATI2: 'BC5_UNORM', BC5U: 'BC5_UNORM', BC5S: 'BC5_SNORM',
};

/** En-tête DDS → { width, height, mips, format } (format null si non reconnu), ou null. */
export function readDdsInfo(buf) {
  if (!buf || buf.length < 128 || buf.toString('latin1', 0, 4) !== 'DDS ') return null;
  const height = buf.readUInt32LE(12), width = buf.readUInt32LE(16);
  const mips = Math.max(1, buf.readUInt32LE(28));
  const pfFlags = buf.readUInt32LE(80);
  const fourcc = buf.toString('latin1', 84, 88);
  let format = null;
  if (pfFlags & 0x4) {
    if (fourcc === 'DX10') format = buf.length >= 132 ? (DXGI[buf.readUInt32LE(128)] || null) : null;
    else format = FOURCC[fourcc] || null;
  } else {
    const bits = buf.readUInt32LE(88);
    const [r, g, b, a] = [92, 96, 100, 104].map((o) => buf.readUInt32LE(o));
    if (bits === 32 && r === 0xff && g === 0xff00 && b === 0xff0000) format = 'R8G8B8A8_UNORM';
    else if (bits === 32 && r === 0xff0000 && g === 0xff00 && b === 0xff) format = a ? 'B8G8R8A8_UNORM' : 'B8G8R8X8_UNORM';
    // RVB 24 bits : DirectXTex (et donc Wabbajack) le lit comme du R8G8B8A8_UNORM
    else if (bits === 24 && g === 0xff00 && ((r === 0xff0000 && b === 0xff) || (r === 0xff && b === 0xff0000))) format = 'R8G8B8A8_UNORM';
    else if (bits === 8 && r === 0xff && !g && !b) format = 'R8_UNORM';
    else if (bits === 8 && !r && a === 0xff) format = 'A8_UNORM';
  }
  return { width, height, mips, format };
}

function readHead(src) {
  if (src.buffer) return src.buffer.subarray(0, 148);
  const fd = fs.openSync(src.file, 'r');
  try { const b = Buffer.alloc(148); const n = fs.readSync(fd, b, 0, 148, 0); return b.subarray(0, n); }
  finally { fs.closeSync(fd); }
}

/** La source a-t-elle déjà l'état demandé ? Une conversion ne changerait alors ni taille ni format. */
export function matchesState(info, st) {
  return !!info && !!info.format && info.width === st.Width && info.height === st.Height
    && info.mips === Math.max(1, st.MipLevels || 1) && info.format === st.Format;
}

export class TextureQueue {
  constructor({ bin, stageRoot }) {
    this.bin = bin;
    this.stageRoot = stageRoot;
    this.groups = new Map();   // clé → { state, dir, items: [{ n, input, outputPath, size, to }] }
    this.count = 0;
    this.alreadyOk = 0;
  }

  /**
   * Met la texture de côté pour conversion. Retourne false si la source a déjà l'état
   * demandé (l'appelant la copie telle quelle) ou si l'état est inexploitable.
   */
  add(d, outputPath, src) {
    const st = d.ImageState || {};
    if (!st.Width || !st.Height || !st.Format) return false;
    if (matchesState(readDdsInfo(readHead(src)), st)) { this.alreadyOk++; return false; }
    const mips = Math.max(1, st.MipLevels || 1);
    const key = `${st.Width}x${st.Height}_m${mips}_${st.Format}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { state: { ...st, MipLevels: mips }, dir: path.join(this.stageRoot, key), items: [] };
      fs.mkdirSync(path.join(g.dir, 'out'), { recursive: true });
      this.groups.set(key, g);
    }
    const n = this.count++;
    const input = path.join(g.dir, `${n}.dds`);
    if (src.buffer) fs.writeFileSync(input, src.buffer);
    else fs.copyFileSync(src.file, input, fs.constants.COPYFILE_FICLONE);
    g.items.push({ n, input, outputPath, size: d.Size || 0, to: d.To || '' });
    return true;
  }

  get size() { return this.count; }

  /**
   * Convertit toutes les textures puis les renomme vers leurs destinations.
   * - BC6H / BC7 (compression lente) : un seul processus texconv à la fois, sans -singleproc
   *   (la compression utilise alors tous les cœurs) ;
   * - autres formats : environ un processus texconv -singleproc par cœur, par lots limités
   *   en pixels, en parallèle de la file BC6H/BC7.
   * Retourne { converted, sizeMismatch: [...], failed: [...] } ; une texture en échec
   * reçoit la source telle quelle.
   */
  async run({ onProgress, signal, jobs = os.cpus().length } = {}) {
    const heavy = [], light = [];
    const PIXEL_BUDGET = 4 * 1024 * 1024, MAX_FILES = 32;
    for (const g of this.groups.values()) {
      const isHeavy = /^BC(6H|7)_/i.test(g.state.Format);
      const px = g.state.Width * g.state.Height;
      const per = Math.max(1, Math.min(MAX_FILES, Math.floor(PIXEL_BUDGET / px)));
      for (let i = 0; i < g.items.length; i += per) (isHeavy ? heavy : light).push({ g, items: g.items.slice(i, i + per), heavy: isHeavy });
    }
    // Les plus grosses textures d'abord : meilleure répartition entre processus
    const bySize = (a, b) => (b.g.state.Width * b.g.state.Height) - (a.g.state.Width * a.g.state.Height);
    heavy.sort(bySize); light.sort(bySize);

    let done = 0;
    const tick = () => onProgress?.(done, this.count);
    const result = { converted: 0, sizeMismatch: [], failed: [] };

    const runBatch = ({ g, items, heavy: isHeavy }) => new Promise((resolve) => {
      const st = g.state;
      const args = ['-nologo', '-y', '-w', String(st.Width), '-h', String(st.Height),
        '-m', String(st.MipLevels), '-f', st.Format, '-o', path.join(g.dir, 'out')];
      if (!isHeavy) args.push('-singleproc');
      if (/_SRGB$/i.test(st.Format)) args.push('-srgbi');
      args.push(...items.map((it) => it.input));
      let out = '', pending = '', written = 0;
      const proc = trackedSpawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const keep = (t) => { out = (out + t).slice(-4000); };
      proc.stdout.on('data', (b) => {
        const t = b.toString(); keep(t);
        const lines = (pending + t).split('\n'); pending = lines.pop();
        for (const l of lines) if (l.startsWith('writing ') && written < items.length) { written++; done++; tick(); }
      });
      proc.stderr.on('data', (b) => keep(b.toString()));
      proc.on('error', (e) => resolve({ code: -1, out: String(e.message), written }));
      proc.on('close', (code) => resolve({ code, out, written }));
    }).then(({ code, out, written }) => {
      for (const it of items) {
        const conv = path.join(g.dir, 'out', `${it.n}.dds`);
        fs.mkdirSync(path.dirname(it.outputPath), { recursive: true });
        let ok = false;
        try { ok = fs.statSync(conv).size > 0; } catch { /* absent */ }
        if (ok) {
          moveFile(conv, it.outputPath);
          result.converted++;
          const got = fs.statSync(it.outputPath).size;
          if (it.size && got !== it.size) result.sizeMismatch.push({ to: it.to, expected: it.size, actual: got });
        } else {
          moveFile(it.input, it.outputPath);
          const why = out.split('\n').find((l) => l.includes(`${it.n}.dds`) && /FAILED/.test(l)) || out.trim().split('\n').pop() || `code ${code}`;
          result.failed.push({ to: it.to, reason: why.slice(0, 200) });
        }
        try { fs.rmSync(it.input, { force: true }); } catch { /* */ }
      }
      done += items.length - written;
      tick();
    });

    const drain = async (queue) => {
      while (queue.length > 0) {
        if (signal?.aborted) throw new Error('Annulé');
        await runBatch(queue.shift());
      }
    };
    try {
      const lightWorkers = Array.from({ length: Math.min(Math.max(1, jobs), light.length) }, () => drain(light));
      await Promise.all([drain(heavy), ...lightWorkers]);
    } finally {
      this.cleanup();
    }
    return result;
  }

  cleanup() {
    try { fs.rmSync(this.stageRoot, { recursive: true, force: true }); } catch { /* */ }
  }
}

function moveFile(from, to) {
  try { fs.renameSync(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}
