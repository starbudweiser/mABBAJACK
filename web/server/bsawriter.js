/**
 * Écrivain BSA natif (TES5 : v104 Skyrim LE, v105 Skyrim SE/AE).
 * Remplace `bsarch` pour les directives Wabbajack « CreateBSA » sur macOS.
 *
 * Les fichiers sont stockés NON compressés (le jeu les lit sans problème ;
 * l'archive est simplement plus volumineuse). Les bits « compressé » (0x4) et
 * « noms embarqués » (0x100) des ArchiveFlags sont donc retirés.
 *
 * Limite des 2 Go : Skyrim SE lit les décalages en 31 bits ; un fichier rangé
 * au-delà de 2 Go dans l'archive est lu comme vide (textures noires, cf.
 * « Faultier's PBR Clutter - Textures.bsa », 3 Go). Ces fichiers sont laissés
 * hors de l'archive (`overflow`) pour être installés en fichiers libres.
 *
 * Format :
 *   Header (36) | Folder records | [Folder block : nom + file records] × N | Noms de fichiers | Données
 *   Records triés par hash croissant (u64).
 */
import fs from 'fs';
import path from 'path';

const FLAG_DIR_NAMES = 0x1;
const FLAG_FILE_NAMES = 0x2;
const FLAG_COMPRESSED = 0x4;
const FLAG_EMBED_NAMES = 0x100;
const MAX_U32 = 0xFFFFFFFF;
/** Fin maximale des données d'un fichier lisible par le jeu (décalage signé 32 bits). */
export const BSA_GAME_LIMIT = 0x7FFFFFFF;

const EXT_FLAGS = {
  '.kf': 0x80,
  '.nif': 0x8000,
  '.dds': 0x8080,
  '.wav': 0x80000000,
  '.adp': 0x3000,
};

function normName(p) {
  return String(p || '').replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase();
}

/** Hash TES5 d'un nom (dossier : isFolder=true, sans extension). Retourne un BigInt u64. */
export function tes5Hash(name, isFolder = false) {
  const n = normName(name);
  let root = n;
  let ext = '';
  if (!isFolder) {
    const base = n.lastIndexOf('\\') + 1;
    const dot = n.lastIndexOf('.');
    if (dot > base) { root = n.slice(0, dot); ext = n.slice(dot); }
  }
  const b = Buffer.from(root, 'latin1');
  let lo = 0;
  if (b.length > 0) {
    lo = (b[b.length - 1] | ((b.length > 2 ? b[b.length - 2] : 0) << 8) | (b.length << 16) | (b[0] << 24)) >>> 0;
  }
  if (!isFolder && EXT_FLAGS[ext] !== undefined) lo = (lo | EXT_FLAGS[ext]) >>> 0;

  const crc = (buf, start, end) => {
    let h = 0;
    for (let i = start; i < end; i++) h = (Math.imul(h, 0x1003f) + buf[i]) >>> 0;
    return h;
  };
  const h2 = b.length > 3 ? crc(b, 1, b.length - 2) : 0;
  const eb = Buffer.from(ext, 'latin1');
  const h3 = crc(eb, 0, eb.length);
  const hi = (h2 + h3) >>> 0;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

function cmpBig(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/**
 * Crée un BSA à partir d'un dossier.
 * @param {string} srcDir      dossier contenant les fichiers à empaqueter
 * @param {string} outFile     BSA à écrire
 * @param {{ Version:number, ArchiveFlags:number, FileFlags:number }} state  État issu du .wabbajack
 * @param {string[]} [relPaths] chemins relatifs à empaqueter (sinon : parcours complet du dossier)
 * @param {{ maxEnd?:number }} [opts] fin maximale des données dans l'archive (défaut : limite du jeu)
 * @returns {{ files:number, bytes:number, skipped:string[], overflow:{ rel:string, abs:string, size:number }[] }}
 *   `overflow` : fichiers au-delà de la limite, NON empaquetés (à installer en libres)
 */
export function createBsa(srcDir, outFile, state, relPaths, opts = {}) {
  const maxEnd = Number(opts.maxEnd) > 0 ? Number(opts.maxEnd) : BSA_GAME_LIMIT;
  const version = Number(state?.Version);
  if (version !== 104 && version !== 105) throw new Error(`Version BSA non supportée : ${state?.Version}`);

  let list = relPaths;
  if (!list) {
    list = [];
    const walk = (d, prefix) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}\\${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), rel); else list.push(rel);
      }
    };
    walk(srcDir, '');
  }

  const skipped = [];
  // folders: nom normalisé → { name, files:[{ name, hash, abs, size }] }
  const folders = new Map();
  for (const raw of list) {
    const rel = normName(raw);
    const abs = path.join(srcDir, ...raw.split(/[\\/]/).filter(Boolean));
    if (raw.split(/[\\/]/).includes('..') || !abs.startsWith(srcDir)) { skipped.push(raw); continue; }
    let st;
    try { st = fs.statSync(abs); } catch { skipped.push(raw); continue; }
    if (!st.isFile()) { skipped.push(raw); continue; }
    if (st.size >= 0x40000000) { skipped.push(raw); continue; }
    const cut = rel.lastIndexOf('\\');
    const folderName = cut >= 0 ? rel.slice(0, cut) : '';
    const fileName = cut >= 0 ? rel.slice(cut + 1) : rel;
    if (!fileName || folderName.length > 254 || fileName.length > 254) { skipped.push(raw); continue; }
    let f = folders.get(folderName);
    if (!f) { f = { name: folderName, hash: tes5Hash(folderName, true), files: [] }; folders.set(folderName, f); }
    f.files.push({ name: fileName, hash: tes5Hash(fileName, false), abs, size: st.size, raw });
  }
  if (folders.size === 0) throw new Error('Aucun fichier à empaqueter');

  let folderList = [...folders.values()].sort((a, b) => cmpBig(a.hash, b.hash));
  for (const f of folderList) f.files.sort((a, b) => cmpBig(a.hash, b.hash));

  const archiveFlags = ((Number(state.ArchiveFlags) | FLAG_DIR_NAMES | FLAG_FILE_NAMES)
    & ~FLAG_COMPRESSED & ~FLAG_EMBED_NAMES) >>> 0;
  const fileFlags = Number(state.FileFlags) >>> 0;

  const folderRecSize = version === 105 ? 24 : 16;
  const folderRecsStart = 36;
  const overflow = [];
  let fileCount, totalFolderNameLen, totalFileNameLen, blocksStart, namesStart, dataStart, cursor;
  // Retirer un fichier ne fait que raccourcir l'en-tête : la boucle converge en 2 passes.
  for (;;) {
    fileCount = folderList.reduce((n, f) => n + f.files.length, 0);
    totalFolderNameLen = folderList.reduce((n, f) => n + f.name.length + 1, 0);
    totalFileNameLen = folderList.reduce((n, f) => n + f.files.reduce((m, x) => m + x.name.length + 1, 0), 0);
    blocksStart = folderRecsStart + folderList.length * folderRecSize;
    const blocksLen = folderList.reduce((n, f) => n + 1 + f.name.length + 1 + f.files.length * 16, 0);
    namesStart = blocksStart + blocksLen;
    dataStart = namesStart + totalFileNameLen;

    // Offsets des données ; les fichiers qui finiraient au-delà de la limite sortent de l'archive
    cursor = dataStart;
    let moved = false;
    for (const f of folderList) {
      f.files = f.files.filter((x) => {
        if (cursor + x.size > maxEnd) { overflow.push({ rel: x.raw, abs: x.abs, size: x.size }); moved = true; return false; }
        x.offset = cursor; cursor += x.size; return true;
      });
    }
    if (!moved) break;
    folderList = folderList.filter((f) => f.files.length > 0);
    if (folderList.length === 0) throw new Error('Aucun fichier ne tient sous la limite de taille du BSA');
  }
  if (cursor > MAX_U32) throw new Error('BSA > 4 Go : non supporté par le format');

  const head = Buffer.alloc(dataStart);
  head.write('BSA\0', 0, 'latin1');
  head.writeUInt32LE(version, 4);
  head.writeUInt32LE(36, 8);
  head.writeUInt32LE(archiveFlags, 12);
  head.writeUInt32LE(folderList.length, 16);
  head.writeUInt32LE(fileCount, 20);
  head.writeUInt32LE(totalFolderNameLen, 24);
  head.writeUInt32LE(totalFileNameLen, 28);
  head.writeUInt32LE(fileFlags, 32);

  let blockPos = blocksStart;
  folderList.forEach((f, i) => {
    const rec = folderRecsStart + i * folderRecSize;
    head.writeBigUInt64LE(f.hash, rec);
    head.writeUInt32LE(f.files.length, rec + 8);
    const offsetField = blockPos + totalFileNameLen; // convention du format
    if (version === 105) head.writeBigUInt64LE(BigInt(offsetField), rec + 16);
    else head.writeUInt32LE(offsetField, rec + 12);

    head.writeUInt8(f.name.length + 1, blockPos);
    head.write(f.name, blockPos + 1, 'latin1');
    head.writeUInt8(0, blockPos + 1 + f.name.length);
    let p = blockPos + 1 + f.name.length + 1;
    for (const x of f.files) {
      head.writeBigUInt64LE(x.hash, p);
      head.writeUInt32LE(x.size, p + 8);
      head.writeUInt32LE(x.offset, p + 12);
      p += 16;
    }
    blockPos = p;
  });

  let np = namesStart;
  for (const f of folderList) for (const x of f.files) {
    head.write(x.name, np, 'latin1');
    np += x.name.length;
    head.writeUInt8(0, np++);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmpOut = `${outFile}.part`;
  const fd = fs.openSync(tmpOut, 'w');
  try {
    fs.writeSync(fd, head, 0, head.length, 0);
    let pos = dataStart;
    for (const f of folderList) for (const x of f.files) {
      const buf = fs.readFileSync(x.abs);
      if (buf.length !== x.size) throw new Error(`Taille modifiée pendant la lecture : ${x.abs}`);
      fs.writeSync(fd, buf, 0, buf.length, pos);
      pos += buf.length;
    }
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* */ }
    try { fs.unlinkSync(tmpOut); } catch { /* */ }
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmpOut, outFile);
  return { files: fileCount, bytes: cursor, skipped, overflow };
}

/**
 * Installe en fichiers libres, à côté du BSA, les fichiers laissés hors de l'archive
 * (`overflow` de createBsa). Les fichiers sont déplacés depuis le staging (copie si
 * le déplacement échoue). Un fichier libre déjà présent est conservé : il prime déjà
 * sur le contenu des BSA.
 * @param {{ rel:string, abs:string }[]} overflow
 * @param {string} rootDir dossier contenant le BSA (Data ou dossier du mod)
 * @returns {{ placed:number, existing:number }}
 */
export function installBsaOverflow(overflow, rootDir) {
  let placed = 0, existing = 0;
  for (const f of overflow) {
    const dest = path.join(rootDir, ...f.rel.split(/[\\/]/).filter(Boolean));
    if (!dest.startsWith(rootDir + path.sep)) continue;
    if (fs.existsSync(dest)) { existing++; continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(f.abs, dest); } catch { fs.copyFileSync(f.abs, dest); }
    placed++;
  }
  return { placed, existing };
}
