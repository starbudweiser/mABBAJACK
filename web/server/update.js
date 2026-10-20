// Mise à jour d'une liste déjà installée.
//
// - À la fin de chaque installation, un instantané est écrit dans <installation>/.mabbajack/ :
//   manifeste complet (To, Hash, archive), archives, et état des fichiers installés (taille, date).
// - Au chargement d'un .wabbajack, on retrouve l'installation existante et on compare les deux
//   versions : mods ajoutés / supprimés / modifiés, archives à télécharger.
// - En mode mise à jour, seuls les fichiers nouveaux ou modifiés sont réinstallés, les fichiers
//   retirés de la liste sont supprimés, et seules les archives nécessaires sont requises.
//
// Base de comparaison, par ordre de préférence :
//   1. instantané (installation faite par mABBAJACK depuis cette fonction) ;
//   2. ancien .wabbajack de la même liste (à côté du nouveau) — installation antérieure ;
//   3. aucun : contenu du disque (taille puis hash Wabbajack de chaque fichier).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import xxhash from 'xxhash-wasm';
import { hashFile } from './archivecheck.js';
import { loadRawModlist } from './modprofile.js';

export const SNAPSHOT_DIR = '.mabbajack';
export const SNAPSHOT_FILE = 'installation.json.gz';
const FORMAT = 1;

const posix = (s) => String(s || '').replace(/\\/g, '/');
const lc = (s) => String(s || '').toLowerCase();
const sameName = (a, b) => lc(a).trim() === lc(b).trim();

let hasherPromise = null;
const hasher = () => (hasherPromise ||= xxhash());

/** Nom du sous-dossier d'installation : MAJUSCULES, caractères sûrs (« Nordic Souls » → NORDIC_SOULS). */
export function installDirName(name) {
  return String(name || 'MODLIST')
    .toUpperCase()
    .replace(/[^A-Z0-9À-ÜÀÂÄÉÈÊËÎÏÔÙÛÜ _-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 64);
}

/** Entrées du manifeste : [To, Hash, ArchiveHash, Size, $type]. */
export function manifestEntries(raw) {
  return (raw.Directives || raw.directives || []).map((d) => [
    posix(d.To || d.to), d.Hash || '', (d.ArchiveHashPath || [])[0] || '', Number(d.Size) || 0, d.$type || '',
  ]);
}

export function manifestArchives(raw) {
  return (raw.Archives || raw.archives || []).map((a) => [a.Hash || '', a.Name || '', Number(a.Size) || 0]);
}

/** Empreinte d'un manifeste : identifie une révision même si le numéro de version ne change pas. */
export async function manifestFingerprint(entries, archives) {
  const { create64 } = await hasher();
  const h = create64(0n);
  for (const e of entries) h.update(`${e[0]}\u0000${e[1]}\n`);
  for (const a of archives) h.update(`${a[0]}\n`);
  return h.digest().toString(16).padStart(16, '0');
}

/** Mod (dossier mods/<Mod>/) d'une destination, sinon null. */
function modName(to) {
  const p = to.split('/');
  return lc(p[0]) === 'mods' && p.length > 2 ? p[1] : null;
}

// ── Instantané ────────────────────────────────────────────────────────────

export function snapshotPath(dir) { return path.join(dir, SNAPSHOT_DIR, SNAPSHOT_FILE); }

export function readSnapshot(dir) {
  try {
    const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(snapshotPath(dir))).toString('utf8'));
    return o && o.format === FORMAT && Array.isArray(o.manifest) ? o : null;
  } catch { return null; }
}

/**
 * Écrit l'instantané de l'installation.
 * installed = directives réellement déployées (après options et priorités) ; seuls les fichiers
 * présents avec la taille attendue sont enregistrés (les autres seront réinstallés à la prochaine mise à jour).
 */
export async function writeSnapshot(dir, { raw, wabbajackPath, installed, resolve, options, onProgress, signal }) {
  const manifest = manifestEntries(raw);
  const archives = manifestArchives(raw);
  const index = new Map(manifest.map((e, i) => [lc(e[0]), i]));
  const files = [];
  let n = 0;
  for (const d of installed) {
    if (signal?.aborted) throw new Error('Annulé');
    if (++n % 5000 === 0) onProgress?.(n, installed.length);
    const to = posix(d.To);
    const i = index.get(lc(to));
    const out = i === undefined || lc(to).startsWith('temp_bsa_files/') ? null : resolve(d);
    if (!out) continue;
    let st;
    try { st = fs.statSync(out); } catch { continue; }
    if (!st.isFile()) continue;
    // Taille différente du manifeste = fichier incomplet ou faux, sauf contenus réécrits ou recompressés
    const free = /remapped|transformedtexture/i.test(d.$type || '');
    if (!free && Number(d.Size) && st.size !== Number(d.Size)) continue;
    files.push([i, st.size, Math.round(st.mtimeMs)]);
  }
  const snap = {
    format: FORMAT,
    name: raw.Name || raw.name || '',
    version: raw.Version || raw.version || '',
    fingerprint: await manifestFingerprint(manifest, archives),
    wabbajackPath: wabbajackPath || '',
    installedAt: new Date().toISOString(),
    options: options || {},
    archives,
    manifest,
    files,
  };
  fs.mkdirSync(path.join(dir, SNAPSHOT_DIR), { recursive: true });
  const tmp = `${snapshotPath(dir)}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(snap)));
  fs.renameSync(tmp, snapshotPath(dir));
  return { files: files.length, total: installed.length };
}

// ── Installation existante ────────────────────────────────────────────────

/** Nom et version lus dans README_READY_TO_PLAY.txt (installations antérieures à l'instantané). */
function readLegacyReadme(dir) {
  try {
    const t = fs.readFileSync(path.join(dir, 'README_READY_TO_PLAY.txt'), 'utf8');
    const m = t.match(/Modlist\s*:\s*(.+?)\s+v(\S+)\s*$/m);
    return m ? { name: m[1].trim(), version: m[2] } : null;
  } catch { return null; }
}

/** Installation existante de la liste `name` dans destPath (dossier standard, sinon instantané au même nom). */
export function findInstallation(destPath, name) {
  if (!destPath || !fs.existsSync(destPath)) return null;
  const probe = (dir) => {
    const snap = readSnapshot(dir);
    if (snap && sameName(snap.name, name)) return { dir, snapshot: snap };
    const legacy = readLegacyReadme(dir);
    if (legacy && sameName(legacy.name, name)) return { dir, snapshot: null, legacy };
    return null;
  };
  const std = path.join(destPath, installDirName(name));
  const hit = fs.existsSync(std) ? probe(std) : null;
  if (hit) return hit;
  let entries = [];
  try { entries = fs.readdirSync(destPath, { withFileTypes: true }); } catch { /* */ }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(destPath, e.name);
    if (!fs.existsSync(snapshotPath(dir))) continue;
    const r = probe(dir);
    if (r?.snapshot) return r;
  }
  return null;
}

const squash = (s) => lc(s).replace(/\.wabbajack$/, '').replace(/[^a-z0-9]/g, '');

/**
 * Ancienne version de la liste à côté du nouveau fichier : .wabbajack de même nom de liste,
 * d'empreinte différente. Seuls les fichiers dont le nom ressemble à la liste sont ouverts.
 */
export async function findPreviousWabbajack(filePath, name, fingerprint) {
  const keys = [squash(name), squash(path.basename(filePath))].filter((k) => k.length >= 4);
  // Dossier du nouveau fichier, puis copies faites par l'appli lors d'un glisser-déposer
  const dirs = [path.dirname(filePath), path.join(os.tmpdir(), 'mabbajack-uploads')];
  const candidates = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const f = path.join(dir, n);
      if (!/\.wabbajack$/i.test(n) || f === filePath) continue;
      if (keys.some((k) => squash(n).includes(k) || k.includes(squash(n)))) candidates.push(f);
    }
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  candidates.splice(4);
  for (const file of candidates) {
    try {
      const raw = await loadRawModlist(file);
      if (!sameName(raw.Name || raw.name, name)) continue;
      const entries = manifestEntries(raw), archives = manifestArchives(raw);
      if (await manifestFingerprint(entries, archives) === fingerprint) continue;
      return { file, raw, entries, archives };
    } catch { /* fichier illisible : ignoré */ }
  }
  return null;
}

// ── Comparaison de deux versions ──────────────────────────────────────────

const LIST_MAX = 400;

/** Différences entre deux manifestes : mods, archives, fichiers. */
export function diffManifests(oldEntries, newEntries, oldArchives, newArchives) {
  const group = (entries) => {
    const mods = new Map();
    for (const e of entries) {
      const m = modName(e[0]) ?? '';
      if (!mods.has(m)) mods.set(m, new Map());
      mods.get(m).set(lc(e[0]), e);
    }
    return mods;
  };
  const oldMods = group(oldEntries), newMods = group(newEntries);
  const archName = new Map([...oldArchives, ...newArchives].map((a) => [a[0], a[1]]));
  const files = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const added = [], removed = [], changed = [];
  let unchangedMods = 0;
  for (const [m, nf] of newMods) {
    const of = oldMods.get(m);
    if (!of) {
      files.added += nf.size;
      if (m) added.push({ name: m, files: nf.size, size: [...nf.values()].reduce((s, e) => s + e[3], 0) });
      continue;
    }
    const c = { added: 0, removed: 0, changed: 0 };
    const oldArch = new Set(), newArch = new Set();
    for (const [k, e] of nf) {
      if (e[2]) newArch.add(e[2]);
      const o = of.get(k);
      if (!o) c.added++;
      else if (o[1] !== e[1]) c.changed++;
      else files.unchanged++;
    }
    for (const [k, o] of of) { if (o[2]) oldArch.add(o[2]); if (!nf.has(k)) c.removed++; }
    files.added += c.added; files.removed += c.removed; files.changed += c.changed;
    if (c.added + c.removed + c.changed === 0) { unchangedMods++; continue; }
    if (!m) continue;
    changed.push({
      name: m, ...c,
      archivesBefore: [...oldArch].filter((h) => !newArch.has(h)).map((h) => archName.get(h) || h),
      archivesAfter: [...newArch].filter((h) => !oldArch.has(h)).map((h) => archName.get(h) || h),
    });
  }
  for (const [m, of] of oldMods) {
    if (newMods.has(m)) continue;
    files.removed += of.size;
    if (m) removed.push({ name: m, files: of.size });
  }
  const oldHashes = new Set(oldArchives.map((a) => a[0]));
  const newHashes = new Set(newArchives.map((a) => a[0]));
  const archivesAdded = newArchives.filter((a) => !oldHashes.has(a[0])).map(([hash, name, size]) => ({ hash, name, size }));
  const archivesRemoved = oldArchives.filter((a) => !newHashes.has(a[0])).map(([hash, name, size]) => ({ hash, name, size }));
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    mods: {
      added: added.sort(byName).slice(0, LIST_MAX), removed: removed.sort(byName).slice(0, LIST_MAX), changed: changed.sort(byName).slice(0, LIST_MAX),
      addedCount: added.length, removedCount: removed.length, changedCount: changed.length, unchangedCount: unchangedMods,
    },
    archives: {
      added: archivesAdded.sort(byName).slice(0, LIST_MAX), removed: archivesRemoved.sort(byName).slice(0, LIST_MAX),
      addedCount: archivesAdded.length, removedCount: archivesRemoved.length,
      downloadSize: archivesAdded.reduce((s, a) => s + a.size, 0),
    },
    files,
  };
}

/**
 * Compare un .wabbajack à l'installation existante dans destPath.
 * status : 'not-installed' | 'same' (même révision) | 'update' (autre révision, différences connues)
 *        | 'unknown' (installation sans instantané ni ancienne version : comparaison au disque lors de la mise à jour)
 */
export async function compareWithInstalled(filePath, destPath, { raw: rawIn, previousFile } = {}) {
  const raw = rawIn || await loadRawModlist(filePath);
  const name = raw.Name || raw.name || '';
  const version = raw.Version || raw.version || '';
  const entries = manifestEntries(raw), archives = manifestArchives(raw);
  const fingerprint = await manifestFingerprint(entries, archives);
  const base = { name, version, fingerprint, newModCount: new Set(entries.map((e) => modName(e[0])).filter(Boolean)).size };

  const inst = findInstallation(destPath, name);
  if (!inst) return { ...base, status: 'not-installed', installed: null };

  const installed = { dir: inst.dir, hasSnapshot: !!inst.snapshot };
  if (inst.snapshot) {
    const s = inst.snapshot;
    Object.assign(installed, { version: s.version, fingerprint: s.fingerprint, installedAt: s.installedAt, files: s.files.length });
    if (s.fingerprint === fingerprint) return { ...base, status: 'same', installed, baseline: 'snapshot' };
    return { ...base, status: 'update', installed, baseline: 'snapshot', diff: diffManifests(s.manifest, entries, s.archives, archives) };
  }

  installed.version = inst.legacy?.version || '';
  const prev = previousFile
    ? await (async () => { const r = await loadRawModlist(previousFile); return { file: previousFile, raw: r, entries: manifestEntries(r), archives: manifestArchives(r) }; })()
    : await findPreviousWabbajack(filePath, name, fingerprint);
  if (prev) {
    return {
      ...base, status: 'update', installed, baseline: 'previous-wabbajack', previousFile: prev.file,
      previousVersion: prev.raw.Version || prev.raw.version || '',
      diff: diffManifests(prev.entries, entries, prev.archives, archives),
    };
  }
  // Sans base : différences inconnues (modlist.txt ne dit pas quelle révision est installée)
  return { ...base, status: 'unknown', installed, baseline: 'disk' };
}

// ── Plan de mise à jour ───────────────────────────────────────────────────

/**
 * Base de comparaison pour le plan : lc(To) → { hash, size?, mtime? }.
 * Instantané : fichiers réellement installés (taille + date sur disque) ; ancien manifeste : hash seuls.
 */
export function baselineFromSnapshot(snap) {
  const m = new Map();
  for (const [i, size, mtime] of snap.files) {
    const e = snap.manifest[i];
    if (e) m.set(lc(e[0]), { to: e[0], hash: e[1], size, mtime });
  }
  // Fichiers du manifeste précédent non installés (archives manquantes…) : connus mais absents
  for (const e of snap.manifest) if (!m.has(lc(e[0]))) m.set(lc(e[0]), { to: e[0], hash: e[1], missing: true });
  return m;
}

export function baselineFromManifest(entries) {
  return new Map(entries.map((e) => [lc(e[0]), { to: e[0], hash: e[1] }]));
}

/**
 * Détermine les directives à (ré)installer.
 * directives : liste finale (options et priorités appliquées) ; resolve(d) → chemin absolu ou null.
 * baseline : Map (voir ci-dessus) ou null (comparaison au disque : hash de chaque fichier de même taille).
 * Retourne { skip: Set<lc(To)>, added, changed, unchanged, removed: [chemins absolus], neededArchives, hashed }.
 */
export async function planUpdate({ directives, resolve, baseline, signal, onProgress }) {
  const skip = new Set();
  const stats = { added: 0, changed: 0, unchanged: 0, hashed: 0 };
  const toHash = [];
  const bsaChanged = new Set(); // TempID des CreateBSA à reconstruire
  const tempFiles = [];
  const newOutputs = new Set();
  // Même fichier final sous un autre chemin MO2 (mod renommé, déplacé) : reconnu par sa destination
  const byOut = new Map();
  if (baseline) {
    for (const b of baseline.values()) {
      const out = resolve({ To: b.to });
      if (out && !byOut.has(lc(out))) byOut.set(lc(out), b);
    }
  }
  let n = 0;
  for (const d of directives) {
    if (signal?.aborted) throw new Error('Annulé');
    if (++n % 5000 === 0) onProgress?.('stat', n, directives.length);
    const to = posix(d.To), key = lc(to);
    if (key.startsWith('temp_bsa_files/')) { tempFiles.push(d); continue; }
    const out = resolve(d);
    if (!out) continue;
    newOutputs.add(lc(out));
    // Fichiers réécrits selon la machine (chemins) : toujours régénérés, c'est immédiat
    if (/remapped/i.test(d.$type || '')) { stats.changed++; continue; }
    let st = null;
    try { st = fs.statSync(out); if (!st.isFile()) st = null; } catch { /* absent */ }
    let b = baseline?.get(key);
    if (baseline && (!b || b.hash !== d.Hash)) {
      const alt = byOut.get(lc(out));
      if (alt && alt.hash === d.Hash) b = alt;
    }
    const markChanged = () => {
      if (st) stats.changed++; else stats.added++;
      if (/createbsa/i.test(d.$type || '') && d.TempID) bsaChanged.add(d.TempID);
    };
    if (!st) { markChanged(); continue; }
    if (baseline) {
      const same = b && !b.missing && b.hash === d.Hash
        && (b.size !== undefined ? st.size === b.size && Math.abs(Math.round(st.mtimeMs) - b.mtime) <= 1
          : st.size === Number(d.Size) || /transformedtexture/i.test(d.$type || ''));
      if (same) { skip.add(key); stats.unchanged++; } else markChanged();
      continue;
    }
    // Sans base : même taille requise, puis même hash (les textures recompressées ne sont pas comparables)
    if (st.size !== Number(d.Size)) { markChanged(); continue; }
    if (/transformedtexture/i.test(d.$type || '') || !d.Hash) { skip.add(key); stats.unchanged++; continue; }
    toHash.push({ d, out, key, size: st.size });
  }

  const totalBytes = toHash.reduce((s, x) => s + x.size, 0);
  let doneBytes = 0;
  for (const x of toHash) {
    if (signal?.aborted) throw new Error('Annulé');
    let h = null;
    try { h = await hashFile(x.out, { signal, onBytes: (b) => { doneBytes += b; onProgress?.('hash', doneBytes, totalBytes); } }); } catch (e) { if (signal?.aborted) throw e; }
    stats.hashed++;
    if (h === x.d.Hash) { skip.add(x.key); stats.unchanged++; }
    else {
      stats.changed++;
      if (/createbsa/i.test(x.d.$type || '') && x.d.TempID) bsaChanged.add(x.d.TempID);
    }
  }

  // Fichiers à empaqueter : seulement pour les BSA reconstruits
  for (const d of tempFiles) {
    const tempId = posix(d.To).split('/')[1];
    if (!bsaChanged.has(tempId)) skip.add(lc(posix(d.To)));
  }

  // Fichiers de la version précédente absents de la nouvelle (et non repris ailleurs)
  const removed = [];
  if (baseline) {
    const newTo = new Set(directives.map((d) => lc(posix(d.To))));
    for (const [key, b] of baseline) {
      if (newTo.has(key) || key.startsWith('temp_bsa_files/')) continue;
      const out = resolve({ To: b.to });
      if (!out || newOutputs.has(lc(out))) continue;
      if (fs.existsSync(out)) removed.push(out);
    }
  }

  const neededArchives = new Set();
  for (const d of directives) {
    if (skip.has(lc(posix(d.To)))) continue;
    const h = d.ArchiveHash || d.ArchiveHashPath?.[0];
    if (h) neededArchives.add(h);
  }
  return { skip, ...stats, removed, neededArchives, totalBytesHashed: totalBytes };
}

/** Supprime les fichiers retirés de la liste, puis les dossiers devenus vides (sans remonter au-delà de root). */
export function removeFiles(files, root) {
  let removed = 0;
  const dirs = new Set();
  const rootAbs = path.resolve(root);
  for (const f of files) {
    const abs = path.resolve(f);
    if (!abs.startsWith(rootAbs + path.sep)) continue;
    try { fs.unlinkSync(abs); removed++; dirs.add(path.dirname(abs)); } catch { /* déjà absent */ }
  }
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (let d of sorted) {
    while (d.startsWith(rootAbs + path.sep)) {
      try {
        const left = fs.readdirSync(d).filter((n) => n !== '.DS_Store');
        if (left.length) break;
        fs.rmSync(d, { recursive: true, force: true });
      } catch { break; }
      d = path.dirname(d);
    }
  }
  return removed;
}

// ── Options de l'installation précédente ──────────────────────────────────

/**
 * Options (profil, mods optionnels, choix exclusifs) de l'installation existante, à reprendre
 * pour la mise à jour. `saved` = options enregistrées dans l'instantané ; sinon déduites du disque :
 * - mod optionnel installé si la majorité de ses fichiers propres (fournis par lui seul) sont présents ;
 * - choix exclusif : option dont les fichiers sont présents avec la taille attendue.
 * options = résultat de buildOptions ; resolve(d) → chemin absolu ou null ;
 * previous = entrées du manifeste installé (instantané), pour les tailles des fichiers.
 */
export function inferOptions({ raw, options, resolve, saved, previous }) {
  const profiles = options?.profiles || [];
  const prof = (saved?.profile && profiles.find((p) => p.name === saved.profile)) || profiles.find((p) => p.isDefault) || profiles[0];
  if (!prof) return null;
  const optional = new Map();
  for (const g of prof.groups) for (const m of g.mods) optional.set(lc(m.name), m.name);
  const choices = (prof.choices || []).filter((c) => !c.hidden);

  if (saved && Array.isArray(saved.enable)) {
    const out = { profile: prof.name, enable: (saved.enable || []).filter((n) => optional.has(lc(n))).map((n) => optional.get(lc(n))), choices: {}, source: 'saved' };
    for (const c of choices) {
      const v = saved.choices?.[c.id];
      if (c.options.some((o) => o.id === v)) out.choices[c.id] = v;
    }
    return out;
  }

  // Fichiers de chaque mod (destination finale) et nombre de mods fournissant chaque destination
  const files = new Map();
  const providers = new Map();
  for (const d of raw.Directives || raw.directives || []) {
    const to = posix(d.To || d.to);
    const m = modName(to);
    if (!m) continue;
    const out = resolve({ To: to });
    if (!out) continue;
    const k = lc(out);
    if (!providers.has(k)) providers.set(k, new Set());
    providers.get(k).add(lc(m));
    if (!files.has(lc(m))) files.set(lc(m), []);
    files.get(lc(m)).push({ out, size: Number(d.Size) || 0 });
  }
  const sample = (list) => list.length <= 200 ? list : list.filter((_, i) => i % Math.ceil(list.length / 200) === 0);
  const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

  const enable = [];
  for (const [k, name] of optional) {
    const own = (files.get(k) || []).filter((f) => providers.get(lc(f.out)).size === 1);
    if (!own.length) continue;
    const s = sample(own);
    if (s.filter((f) => exists(f.out)).length / s.length >= 0.5) enable.push(name);
  }
  // Choix exclusifs : vote sur les fichiers qui diffèrent d'une option à l'autre (présents seulement
  // pour certaines options, ou de taille différente) ; la taille sur disque désigne l'option installée.
  // Tailles de la version installée si connue (previous), sinon de la nouvelle.
  const entries = previous || manifestEntries(raw);
  const picked = {};
  for (const c of choices) {
    const withMods = c.options.filter((o) => o.mods.length);
    const prefixes = withMods.map((o) => [o.id, o.mods.map((m) => `mods/${lc(m)}/`)]);
    const byDest = new Map();
    for (const e of entries) {
      const to = lc(e[0]);
      if (!to.startsWith('mods/')) continue;
      for (const [id, pre] of prefixes) {
        if (!pre.some((x) => to.startsWith(x))) continue;
        const out = resolve({ To: e[0] });
        if (!out) continue;
        if (!byDest.has(out)) byDest.set(out, []);
        byDest.get(out).push({ id, size: e[3] });
      }
    }
    const votes = new Map();
    for (const [out, list] of byDest) {
      let size;
      try { size = fs.statSync(out).size; } catch { continue; }
      const ids = new Set(list.map((x) => x.id));
      for (const x of list) {
        if (size !== x.size) continue;
        const others = list.filter((y) => y.id !== x.id);
        if (others.some((y) => y.size === x.size)) continue; // ne départage pas
        if (ids.size < withMods.length || others.length) votes.set(x.id, (votes.get(x.id) || 0) + 1);
      }
    }
    const ranked = [...votes.entries()].sort((x, y) => y[1] - x[1]);
    // Option nettement majoritaire, sinon valeur par défaut
    if (ranked.length && (ranked.length === 1 || ranked[0][1] >= 3 * ranked[1][1])) picked[c.id] = ranked[0][0];
  }
  return { profile: prof.name, enable, choices: picked, source: 'disk' };
}
