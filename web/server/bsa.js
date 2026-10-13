/**
 * Pure-JS reader for Bethesda BSA archives (TES5 / Skyrim LE v104, Skyrim SE/AE v105).
 *
 * 7-Zip cannot open BSA files, so this module is used for:
 *   - GameFileSource archives (vanilla game BSAs such as "Skyrim - Animations.bsa")
 *   - nested BSAs inside mod archives (ArchiveHashPath of depth 3)
 *
 * Compression:
 *   - v104 : zlib  (node:zlib inflateSync)
 *   - v105 : LZ4 frame format (decoder implemented below, no dependency)
 *
 * Paths are normalised to lowercase with forward slashes.
 */
import fs from 'fs';
import zlib from 'zlib';

const FLAG_DIR_NAMES = 0x1;
const FLAG_FILE_NAMES = 0x2;
const FLAG_COMPRESSED = 0x4;
const FLAG_EMBED_NAMES = 0x100;
const SIZE_COMPRESS_TOGGLE = 0x40000000;

export function normalizeBsaPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

// ── LZ4 ──────────────────────────────────────────────────────────────────────
function lz4DecodeBlock(src, start, end, out, outPos) {
  let ip = start;
  let op = outPos;
  while (ip < end) {
    const token = src[ip++];
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b;
      do { b = src[ip++]; litLen += b; } while (b === 255 && ip < end);
    }
    if (op + litLen > out.length) throw new Error('LZ4: literal overflow');
    src.copy(out, op, ip, ip + litLen);
    ip += litLen; op += litLen;
    if (ip >= end) break; // last sequence has no match part

    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('LZ4: invalid offset');
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b;
      do { b = src[ip++]; matchLen += b; } while (b === 255 && ip < end);
    }
    matchLen += 4;
    if (op + matchLen > out.length) throw new Error('LZ4: match overflow');
    let mp = op - offset;
    for (let i = 0; i < matchLen; i++) out[op++] = out[mp++]; // overlap-safe copy
  }
  return op;
}

export function lz4DecodeFrame(src, originalSize) {
  const out = Buffer.allocUnsafe(originalSize);
  let ip = 0;
  let op = 0;
  while (ip + 4 <= src.length && op < originalSize) {
    const magic = src.readUInt32LE(ip); ip += 4;
    if ((magic & 0xFFFFFFF0) === 0x184D2A50) { // skippable frame
      const len = src.readUInt32LE(ip); ip += 4 + len; continue;
    }
    if (magic !== 0x184D2204) throw new Error(`LZ4: bad frame magic 0x${magic.toString(16)}`);
    const flg = src[ip++];
    ip++; // BD
    const blockChecksum = (flg & 0x10) !== 0;
    const contentSize = (flg & 0x08) !== 0;
    const contentChecksum = (flg & 0x04) !== 0;
    const dictId = (flg & 0x01) !== 0;
    if (contentSize) ip += 8;
    if (dictId) ip += 4;
    ip++; // header checksum
    for (;;) {
      if (ip + 4 > src.length) throw new Error('LZ4: truncated frame');
      const raw = src.readUInt32LE(ip); ip += 4;
      if (raw === 0) break; // end mark
      const uncompressed = (raw & 0x80000000) !== 0;
      const size = raw & 0x7FFFFFFF;
      if (uncompressed) { src.copy(out, op, ip, ip + size); op += size; }
      else op = lz4DecodeBlock(src, ip, ip + size, out, op);
      ip += size;
      if (blockChecksum) ip += 4;
    }
    if (contentChecksum) ip += 4;
  }
  if (op !== originalSize) throw new Error(`LZ4: size mismatch (${op}/${originalSize})`);
  return out;
}

// ── BSA ──────────────────────────────────────────────────────────────────────
function readExact(fd, length, position) {
  const buf = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, position + read);
    if (n === 0) throw new Error('BSA: unexpected end of file');
    read += n;
  }
  return buf;
}

/**
 * Open a BSA and index its entries. Call close() when done.
 * @returns {{ version:number, entries:Map<string,{offset:number,size:number,compressed:boolean}>, readFile:(p:string)=>Buffer|null, close:()=>void }}
 */
export function openBsa(bsaPath) {
  const fd = fs.openSync(bsaPath, 'r');
  try {
    const header = readExact(fd, 36, 0);
    if (header.toString('latin1', 0, 4) !== 'BSA\0') throw new Error('Not a BSA file (bad magic)');
    const version = header.readUInt32LE(4);
    if (version !== 104 && version !== 105) throw new Error(`Unsupported BSA version ${version} (expected 104/105)`);
    const folderOffset = header.readUInt32LE(8);
    const flags = header.readUInt32LE(12);
    const folderCount = header.readUInt32LE(16);
    const fileCount = header.readUInt32LE(20);
    const totalFolderNameLength = header.readUInt32LE(24);
    const totalFileNameLength = header.readUInt32LE(28);

    if (!(flags & FLAG_FILE_NAMES)) throw new Error('BSA without file names is not supported');

    const folderRecSize = version === 105 ? 24 : 16;
    const recordsLen = folderCount * folderRecSize;
    const blocksLen = (flags & FLAG_DIR_NAMES ? totalFolderNameLength + folderCount : 0) + fileCount * 16;
    const dir = readExact(fd, recordsLen + blocksLen + totalFileNameLength, folderOffset);

    const folderCounts = [];
    for (let i = 0; i < folderCount; i++) folderCounts.push(dir.readUInt32LE(i * folderRecSize + 8));

    let p = recordsLen;
    const files = [];
    for (let i = 0; i < folderCount; i++) {
      let folderName = '';
      if (flags & FLAG_DIR_NAMES) {
        const len = dir[p++];
        folderName = dir.toString('latin1', p, p + len - 1); // strip trailing NUL
        p += len;
      }
      for (let j = 0; j < folderCounts[i]; j++) {
        const rawSize = dir.readUInt32LE(p + 8);
        const offset = dir.readUInt32LE(p + 12);
        files.push({ folderName, rawSize, offset });
        p += 16;
      }
    }

    const entries = new Map();
    for (const f of files) {
      let end = p;
      while (end < dir.length && dir[end] !== 0) end++;
      const fileName = dir.toString('latin1', p, end);
      p = end + 1;
      const compressed = ((flags & FLAG_COMPRESSED) !== 0) !== ((f.rawSize & SIZE_COMPRESS_TOGGLE) !== 0);
      const key = normalizeBsaPath(f.folderName ? `${f.folderName}/${fileName}` : fileName);
      entries.set(key, { offset: f.offset, size: f.rawSize & 0x3FFFFFFF, compressed });
    }

    const readEntry = (entry) => {
      let pos = entry.offset;
      let remaining = entry.size;
      if (flags & FLAG_EMBED_NAMES) {
        const nameLen = readExact(fd, 1, pos)[0];
        pos += 1 + nameLen; remaining -= 1 + nameLen;
      }
      if (!entry.compressed) return readExact(fd, remaining, pos);
      const originalSize = readExact(fd, 4, pos).readUInt32LE(0);
      const data = readExact(fd, remaining - 4, pos + 4);
      return version === 105 ? lz4DecodeFrame(data, originalSize) : zlib.inflateSync(data);
    };

    let closed = false;
    return {
      version,
      entries,
      readFile(innerPath) {
        const e = entries.get(normalizeBsaPath(innerPath));
        return e ? readEntry(e) : null;
      },
      close() { if (!closed) { closed = true; try { fs.closeSync(fd); } catch { /* */ } } },
    };
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* */ }
    throw err;
  }
}

/** One-shot helper: extract a single inner file of a BSA into outputFile. Returns bytes written. */
export function extractFileFromBsa(bsaPath, innerPath, outputFile) {
  const bsa = openBsa(bsaPath);
  try {
    const buf = bsa.readFile(innerPath);
    if (!buf) throw new Error(`"${innerPath}" absent du BSA ${bsaPath}`);
    fs.writeFileSync(outputFile, buf);
    return buf.length;
  } finally {
    bsa.close();
  }
}
