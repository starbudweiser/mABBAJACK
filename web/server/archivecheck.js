// Vérification des archives téléchargées (taille + hash Wabbajack) et contrôle
// post-installation des fichiers produits.
// Hash Wabbajack = xxHash64 (graine 0) du fichier entier, 8 octets little-endian en base64.
import fs from 'fs';
import path from 'path';
import os from 'os';
import xxhash from 'xxhash-wasm';
import { isTempPath } from './locate.js';

const DATA_DIR = process.env.MABBAJACK_DATA_DIR || path.join(os.homedir(), '.mabbajack');
const CACHE_FILE = path.join(DATA_DIR, 'archive-hashes.json');
const CHUNK = 8 * 1024 * 1024;

let hasherPromise = null;
const hasher = () => (hasherPromise ||= xxhash());

/** xxHash64 (BigInt) → représentation Wabbajack (base64 de 8 octets little-endian). */
export function toWabbajackHash(h) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt.asUintN(64, h));
  return b.toString('base64');
}

/** Hash Wabbajack d'un fichier, lu par blocs. onBytes(n) reçoit le nombre d'octets lus. */
export async function hashFile(file, { signal, onBytes, waitIfPaused } = {}) {
  const { create64 } = await hasher();
  const h = create64(0n);
  const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = 0;
    for (;;) {
      if (signal?.aborted) throw new Error('Annulé');
      if (waitIfPaused) await waitIfPaused(signal);
      const { bytesRead } = await fd.read(buf, 0, CHUNK, pos);
      if (bytesRead === 0) break;
      h.update(bytesRead === CHUNK ? buf : buf.subarray(0, bytesRead));
      pos += bytesRead;
      onBytes?.(bytesRead);
    }
  } finally {
    await fd.close();
  }
  return toWabbajackHash(h.digest());
}

/** Cache persistant des hash : chemin → { size, mtimeMs, hash }. Invalide si taille ou date changent. */
export class HashCache {
  constructor(file = CACHE_FILE) {
    this.file = file;
    this.map = new Map();
    this.dirty = false;
    try {
      const o = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const [k, v] of Object.entries(o)) this.map.set(k, v);
    } catch { /* absent ou illisible → cache vide */ }
  }
  get(p, st) {
    const e = this.map.get(p);
    return e && e.size === st.size && e.mtimeMs === st.mtimeMs ? e.hash : null;
  }
  set(p, st, hash) {
    this.map.set(p, { size: st.size, mtimeMs: st.mtimeMs, hash });
    this.dirty = true;
  }
  save() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch { /* cache non persistant : pas bloquant */ }
  }
}

/**
 * Vérifie qu'un fichier est bien l'archive attendue par le manifeste.
 * Retourne { ok, reason: 'ok' | 'size' | 'hash' | 'unreadable', size, hash, cached }.
 * Le hash n'est calculé que si la taille correspond.
 */
export async function verifyArchive(arc, file, { cache, signal, onBytes, waitIfPaused } = {}) {
  let st;
  try { st = fs.statSync(file); if (!st.isFile()) throw new Error('pas un fichier'); }
  catch { return { ok: false, reason: 'unreadable' }; }
  const expected = Number(arc.Size) || 0;
  if (expected > 0 && st.size !== expected) return { ok: false, reason: 'size', size: st.size };
  if (!arc.Hash) return { ok: true, reason: 'ok', size: st.size };
  let hash = cache?.get(file, st);
  const cached = !!hash;
  if (!hash) {
    hash = await hashFile(file, { signal, onBytes, waitIfPaused });
    cache?.set(file, st, hash);
  } else {
    onBytes?.(st.size);
  }
  return hash === arc.Hash
    ? { ok: true, reason: 'ok', size: st.size, hash, cached }
    : { ok: false, reason: 'hash', size: st.size, hash, cached };
}

/** Page Nexus du fichier exact (file_id) ou URL directe de l'archive, sinon null. */
export function archiveSourceUrl(arc) {
  const s = arc?.State || {};
  const modId = s.ModID || s.NexusFileID;
  const fileId = s.FileID || s.NexusID;
  if (s.GameName && modId) {
    const game = String(s.GameName).toLowerCase();
    return `https://www.nexusmods.com/${game}/mods/${modId}${fileId ? `?tab=files&file_id=${fileId}` : ''}`;
  }
  return typeof s.Url === 'string' && s.Url.startsWith('http') ? s.Url : null;
}

/** Dossier dédié à la liste : celui qui contient le fichier .wabbajack local (ex. WABBAJACK LISTS/<LISTE>/). */
export function listDownloadDir(wabbajackPath) {
  if (typeof wabbajackPath !== 'string' || !/\.wabbajack$/i.test(wabbajackPath)) return null;
  if (isTempPath(wabbajackPath)) return null; // copie envoyée par le navigateur : pas un dossier de travail
  const dir = path.dirname(path.resolve(wabbajackPath));
  return fs.existsSync(dir) ? dir : null;
}

/** Nom du mod MO2 d'une destination de directive (mods/<mod>/…), sinon null. */
export function modOf(to) {
  const parts = String(to || '').replace(/\\/g, '/').split('/');
  return parts[0].toLowerCase() === 'mods' && parts[1] ? parts[1] : null;
}

/**
 * Contrôle post-installation : chaque destination doit exister avec la taille du manifeste.
 * Plusieurs directives peuvent viser le même fichier (conflits) : une seule taille doit correspondre.
 * Retourne { checked, missing: [{ to, path, mod }], wrongSize: [{ to, path, mod, expected, actual }] }.
 */
export async function verifyInstalledFiles(directives, outPathOf, { signal, onProgress } = {}) {
  const byPath = new Map();
  for (const d of directives) {
    if (/CreateBSA/i.test(d.$type || '')) continue;
    const p = outPathOf(d.To);
    if (!p || p.includes(`${path.sep}.mabbajack_bsa_staging${path.sep}`)) continue;
    const e = byPath.get(p);
    if (e) e.sizes.add(Number(d.Size) || 0);
    else byPath.set(p, { d, sizes: new Set([Number(d.Size) || 0]) });
  }
  const missing = [], wrongSize = [];
  let checked = 0;
  for (const [p, { d, sizes }] of byPath) {
    if (signal?.aborted) throw new Error('Annulé');
    let size = -1;
    try { size = (await fs.promises.stat(p)).size; } catch { /* absent */ }
    if (size < 0) missing.push({ to: d.To, path: p, mod: modOf(d.To) });
    else if (!sizes.has(0) && !sizes.has(size)) wrongSize.push({ to: d.To, path: p, mod: modOf(d.To), expected: [...sizes][0], actual: size });
    if (++checked % 2000 === 0) onProgress?.(checked, byPath.size);
  }
  onProgress?.(checked, byPath.size);
  return { checked, missing, wrongSize };
}

/**
 * Fichiers de mods désactivés présents dans l'installation (restes d'une installation précédente
 * ou déploiement à tort) : destinations des directives écartées qu'aucune directive conservée ne vise.
 * Retourne [{ to, path, mod }].
 */
export async function findStrayFiles(dropped, kept, outPathOf, { signal } = {}) {
  const keptPaths = new Set();
  for (const d of kept) { const p = outPathOf(d.To); if (p) keptPaths.add(p.toLowerCase()); }
  const seen = new Set(), stray = [];
  for (const d of dropped) {
    if (signal?.aborted) throw new Error('Annulé');
    const mod = modOf(d.To);
    if (!mod) continue;
    const p = outPathOf(d.To);
    if (!p || keptPaths.has(p.toLowerCase()) || seen.has(p)) continue;
    seen.add(p);
    try { await fs.promises.access(p); stray.push({ to: d.To, path: p, mod }); } catch { /* absent : normal */ }
  }
  return stray;
}
