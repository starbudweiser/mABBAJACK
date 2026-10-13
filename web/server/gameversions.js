// Versions de jeu EXACTES lues dans les manifestes (.wabbajack), mémorisées par nom de collection.
// Le catalogue Wabbajack ne publie pas cette information : seule l'analyse d'un manifeste la donne
// de façon fiable (GameVersion des fichiers originaux du jeu). Sans entrée ici, la galerie ne
// peut que l'estimer (tags / description).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(process.env.MABBAJACK_DATA_DIR || path.join(os.homedir(), '.mabbajack'), 'game-versions.json');

let mem = null;

/** Clé de collection : insensible à la casse, aux espaces et à la ponctuation. */
export function gameVersionKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Extrait « 1.6.1170 » d'une GameVersion de manifeste ; null si absente ou invalide. */
export function shortGameVersion(raw) {
  const v = String(raw || '');
  return /^\d+\.\d+\.\d+/.test(v) ? v.split('.').slice(0, 3).join('.') : null;
}

/** Première GameVersion valide parmi les archives d'un manifeste. */
export function gameVersionFromArchives(archives) {
  for (const a of Array.isArray(archives) ? archives : []) {
    const v = shortGameVersion(a?.State?.GameVersion);
    if (v) return v;
  }
  return null;
}

function load() {
  if (mem) return mem;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    mem = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    mem = {}; // fichier absent ou corrompu : cache vide
  }
  return mem;
}

export function getGameVersion(name) {
  const v = load()[gameVersionKey(name)];
  return typeof v === 'string' ? v : null;
}

/** Mémorise (et persiste) la version d'une collection. Silencieux en cas d'erreur d'écriture. */
export function recordGameVersion(name, version) {
  const key = gameVersionKey(name);
  const v = shortGameVersion(version);
  if (!key || !v) return false;
  const data = load();
  if (data[key] === v) return false;
  data[key] = v;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* disque en lecture seule : on garde la valeur en mémoire */ }
  return true;
}

/** Ajoute gameVersion (et corrige skyrimVersion) aux entrées du catalogue dont la version est connue. */
export function enrichCatalog(list) {
  if (!Array.isArray(list)) return list;
  return list.map((m) => {
    const gv = getGameVersion(m?.title);
    if (!gv) return m;
    const game = String(m.game || '').toLowerCase().replace(/[\s_-]/g, '');
    const out = { ...m, gameVersion: gv };
    if (game.startsWith('skyrim') && !game.includes('vr') && !game.includes('enderal')) {
      if (/^1\.([6-9]|\d{2,})\./.test(gv)) out.skyrimVersion = 'ae';
      else if (/^1\.5\./.test(gv)) out.skyrimVersion = 'se';
    }
    return out;
  });
}
