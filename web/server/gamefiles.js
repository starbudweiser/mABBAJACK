// Fichiers originaux du jeu : détection des dossiers du jeu (Steam, CrossOver, volumes) et
// localisation des archives « fichier du jeu » du manifeste.

import fs from 'fs';
import path from 'path';
import os from 'os';

// ──────────────────────────────────────────────────────────
// Skyrim version detection
// ──────────────────────────────────────────────────────────
export function getExpectedSkyrimVersion(gameType, skyrimVersion, archives) {
  // 1. Source faisant autorité : GameVersion des fichiers originaux du jeu dans le manifeste
  const gv = (Array.isArray(archives) ? archives : [])
    .map((a) => String(a?.State?.GameVersion || ''))
    .find((v) => /^\d+\.\d+\.\d+/.test(v));
  if (gv) {
    const short = gv.split('.').slice(0, 3).join('.');
    const isVr = /vr/i.test(gameType || '');
    if (isVr) return { edition: 'VR', label: 'Skyrim VR', versionHint: short };
    if (/^1\.([6-9]|\d{2,})\./.test(short)) return { edition: 'AE', label: 'Skyrim AE', versionHint: short };
    if (/^1\.5\./.test(short)) return { edition: 'SE', label: 'Skyrim SE', versionHint: short };
  }
  // skyrimVersion (pre-computed multi-signal heuristic) takes priority
  const sv = (skyrimVersion || '').toLowerCase();
  if (sv === 'vr')  return { edition: 'VR',       label: 'Skyrim VR', versionHint: '1.4.x' };
  if (sv === 'ae')  return { edition: 'AE',        label: 'Skyrim AE', versionHint: '1.6.x' };
  if (sv === 'se')  return { edition: 'SE',        label: 'Skyrim SE', versionHint: '1.5.97' };
  // Fallback: parse gameType string
  const g = (gameType || '').toLowerCase();
  if (g.includes('vr'))                           return { edition: 'VR',       label: 'Skyrim VR',    versionHint: '1.4.x' };
  if (g.includes('anniversary') || g === 'skyrimae') return { edition: 'AE',   label: 'Skyrim AE',    versionHint: '1.6.x' };
  if (g.includes('special') || g.includes('se')) return { edition: 'SE',        label: 'Skyrim SE',    versionHint: '1.5.97' };
  return { edition: 'SE_OR_AE', label: 'Skyrim SE/AE', versionHint: '1.5.97 ou 1.6.x' };
}

// ──────────────────────────────────────────────────────────
// GameFileSource : fichiers ORIGINAUX du jeu (ex. Data\Skyrim - Animations.bsa)
// Wabbajack ne les télécharge jamais : il les lit dans le dossier du jeu.
// ──────────────────────────────────────────────────────────
export const GAME_DIR_NAMES = {
  skyrimspecialedition: 'Skyrim Special Edition',
  skyrimvr: 'SkyrimVR',
  skyrim: 'Skyrim',
  enderalspecialedition: 'Enderal Special Edition',
};

export function isGameFileArchive(a) {
  return /GameFileSource/i.test(a?.State?.$type || '');
}

/** Fichiers du jeu sans intérêt (journaux : Debug.log, Papyrus.0.log…) : jamais requis, jamais signalés manquants. */
export function isIgnorableGameFile(a) {
  if (!isGameFileArchive(a)) return false;
  const rel = String(a?.State?.GameFile || a?.Name || '').replace(/\\/g, '/');
  return /\.log$/i.test(rel);
}

export function gameFileRel(a) {
  return String(a?.State?.GameFile || '').replace(/\\/g, '/');
}

export const GAME_EXES = {
  skyrimspecialedition: ['SkyrimSE.exe', 'SkyrimSELauncher.exe'],
  skyrimvr: ['SkyrimVR.exe'],
  skyrim: ['TESV.exe'],
  enderalspecialedition: ['SkyrimSE.exe'],
};
// Dossiers jamais explorés lors de la recherche d'un dossier de jeu
export const GAME_SCAN_SKIP = new Set([
  'data', 'mods', 'downloads', 'profiles', 'overwrite', 'node_modules', 'textures', 'meshes',
  'sound', 'music', 'scripts', 'interface', 'skse', '$recycle.bin', 'system volume information',
  '.spotlight-v100', '.fseventsd', '.trashes', '.documentrevisions-v100', '.temporaryitems',
]);

/** Dossier racine d'un jeu : contient Data/ ET l'exécutable du jeu. */
export function isGameRoot(p, exes) {
  try {
    if (!fs.statSync(path.join(p, 'Data')).isDirectory()) return false;
    return exes.some((e) => fs.existsSync(path.join(p, e)));
  } catch { return false; }
}

/**
 * Recherche bornée (profondeur 3) des installations du jeu sur les volumes montés.
 * Couvre « Stock Game » / « Game Root » (Wabbajack, Nolvus) et les bibliothèques Steam.
 */
export function discoverGameRoots(exes, maxDepth = 3, maxDirsPerVolume = 4000) {
  const found = [];
  let volumes = [];
  try { volumes = fs.readdirSync('/Volumes', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join('/Volumes', e.name)); } catch { return found; }
  for (const vol of volumes) {
    let visited = 0;
    let level = [vol];
    for (let depth = 1; depth <= maxDepth && level.length; depth++) {
      const next = [];
      for (const dir of level) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || GAME_SCAN_SKIP.has(e.name.toLowerCase())) continue;
          if (++visited > maxDirsPerVolume) break;
          const p = path.join(dir, e.name);
          if (isGameRoot(p, exes)) { found.push(p); continue; }
          next.push(p);
        }
        if (visited > maxDirsPerVolume) break;
      }
      level = next;
    }
  }
  return found;
}

export const _gameDirCache = new Map(); // `${gameName}|${deep}` → { at, dirs }
export function autoDetectGameDirs(gameName, deep = false) {
  const key = String(gameName || '').toLowerCase();
  const cacheKey = `${key}|${deep ? 1 : 0}`;
  const cached = _gameDirCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (deep ? 1800000 : 60000)) return cached.dirs;
  const folder = GAME_DIR_NAMES[key] || 'Skyrim Special Edition';
  const exes = GAME_EXES[key] || GAME_EXES.skyrimspecialedition;
  const home = os.homedir();
  const dirs = [];
  const tryAdd = (p) => {
    try { if (!dirs.includes(p) && fs.statSync(path.join(p, 'Data')).isDirectory()) dirs.push(p); } catch { /* absent */ }
  };
  tryAdd(path.join(home, 'Library/Application Support/Steam/steamapps/common', folder));
  for (const root of [
    path.join(home, 'Library/Application Support/CrossOver/Bottles'),
    path.join(home, 'Library/Containers/com.isaacmarovitz.Whisky/Bottles'),
  ]) {
    try {
      for (const b of fs.readdirSync(root)) {
        tryAdd(path.join(root, b, 'drive_c/Program Files (x86)/Steam/steamapps/common', folder));
        tryAdd(path.join(root, b, 'drive_c/Program Files/Steam/steamapps/common', folder));
      }
    } catch { /* absent */ }
  }
  try {
    for (const v of fs.readdirSync('/Volumes')) {
      for (const sub of ['GAMES', 'Games', 'SteamLibrary/steamapps/common', 'Steam/steamapps/common', 'steamapps/common', '']) {
        tryAdd(path.join('/Volumes', v, sub, folder));
      }
    }
  } catch { /* absent */ }
  if (deep) for (const p of discoverGameRoots(exes)) if (!dirs.includes(p)) dirs.push(p);
  _gameDirCache.set(cacheKey, { at: Date.now(), dirs });
  return dirs;
}

/** Dossiers où chercher les fichiers du jeu (chemin utilisateur en premier). */
export function gameSearchDirs(a, gamePath, deep = false) {
  const dirs = [];
  if (gamePath && String(gamePath).trim()) dirs.push(path.resolve(String(gamePath).trim()));
  for (const d of autoDetectGameDirs(a?.State?.Game, deep)) if (!dirs.includes(d)) dirs.push(d);
  return dirs;
}

/**
 * Localise un fichier original du jeu.
 * Ordre : <jeu>/Data/X.bsa · <jeu>/X.bsa (si l'utilisateur a pointé Data/) · DOWNLOADS/<Name> · DOWNLOADS/X.bsa
 * Recherche rapide d'abord ; recherche profonde (Stock Game…) si l'original exact n'est pas trouvé.
 * @returns {{ path:string, size:number, sizeMatches:boolean } | null}
 */
export function resolveGameFileArchive(a, gamePath, downloadsDir) {
  const rel = gameFileRel(a);
  if (!rel) return null;
  const relNoData = rel.replace(/^data\//i, '');
  const search = (deep) => {
    const candidates = [];
    for (const g of gameSearchDirs(a, gamePath, deep)) {
      candidates.push(path.join(g, rel), path.join(g, relNoData));
    }
    if (downloadsDir) {
      if (a.Name) candidates.push(path.join(downloadsDir, a.Name));
      candidates.push(path.join(downloadsDir, path.basename(rel)));
    }
    // Priorité au fichier dont la taille correspond à l'original attendu par la modlist
    let fallback = null;
    for (const c of candidates) {
      try {
        const st = fs.statSync(c);
        if (!st.isFile() || st.size === 0) continue;
        const r = { path: c, size: st.size, sizeMatches: !a.Size || st.size === a.Size };
        if (r.sizeMatches) return r;
        if (!fallback) fallback = r;
      } catch { /* next */ }
    }
    return fallback;
  };
  const quick = search(false);
  if (quick?.sizeMatches) return quick;
  const deep = search(true);
  if (deep?.sizeMatches) return deep;
  return quick || deep;
}

export function expectedGameFilePath(a, gamePath) {
  const dirs = gameSearchDirs(a, gamePath, true);
  const base = dirs[0] || `<${GAME_DIR_NAMES[String(a?.State?.Game || '').toLowerCase()] || 'Skyrim Special Edition'}>`;
  return path.join(base, gameFileRel(a));
}

export function detectSkyrimAtPath(gamePath) {
  if (!gamePath || !fs.existsSync(gamePath)) return { found: false, edition: 'Unknown', version: null, dataPath: null, hasCCContent: false, validationIssues: ['Chemin introuvable'] };
  const dataPath = path.join(gamePath, 'Data');
  const coreMasters = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
  const foundMasters = coreMasters.filter((p) => fs.existsSync(path.join(dataPath, p)));
  const missingMasters = coreMasters.filter((p) => !fs.existsSync(path.join(dataPath, p)));
  const ccIndicators = ['ccBGSSSE001-Fish.esm', 'ccBGSSSE025-AdvDSGS.esm', 'ccQDRSSE001-SurvivalMode.esl'];
  const hasCCContent = ccIndicators.some((f) => fs.existsSync(path.join(dataPath, f)));
  return {
    found: foundMasters.length >= 3,
    edition: hasCCContent ? 'AE' : 'SE',
    version: hasCCContent ? '1.6.x' : '1.5.97',
    dataPath,
    hasCCContent,
    foundMasters,
    missingMasters,
    validationIssues: missingMasters.length > 0 ? [`Masters manquants : ${missingMasters.join(', ')}`] : [],
  };
}
