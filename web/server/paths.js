// Correspondance entre les destinations Wabbajack (directive.To) et l'arborescence installée.
import path from 'path';

// Sous-dossiers de mods/<Mod>/ propres à MO2 : pas des fichiers du jeu
const MODS_SKIP_SUBDIRS = new Set([
  'shadercache', 'nemesis_engine', 'fomod', 'docs', 'readmes', 'bashtags',
]);

// Top-level folders that are MO2 application binaries — skip entirely
const MO2_BINARY_ROOTS = new Set([
  'plugins', 'translations', 'stylesheets', 'ncc', 'dlls', 'tutorials',
  'licenses', 'qtqml', 'qtquick.2', 'pythoncore', 'resources', 'loot',
  'platforms', 'styles', 'imageformats', 'bearer', 'mediaservice', 'locales',
  'swiftshader', 'sqldrivers', 'position', 'sensorgesture', 'explorer++',
]);

export const BSA_STAGING_DIR = '.mabbajack_bsa_staging';

// Dossier « jeu de base » de l'instance MO2 (« Game Root », « Stock Game »… selon les listes) :
// ses fichiers vont à la racine de l'installation (Game Root/Data/X.bsa → Data/X.bsa).
// Détecté d'après le contenu : un sous-dossier Data/ ou un exécutable à sa racine.
export const KNOWN_GAME_ROOT_NAMES = ['game root', 'stock game', 'stock folder', 'game folder'];
const NON_GAME_TOPS = new Set(['mods', 'profiles', 'temp_bsa_files', 'downloads', 'webcache', 'overwrite', 'tools']);
let gameRootFolders = new Set(KNOWN_GAME_ROOT_NAMES);
/** Dossiers de jeu reconnus pour l'installation en cours (voir detectGameRootFolders). */
export function setGameRootFolders(set) { gameRootFolders = set; }
export function getGameRootFolders() { return gameRootFolders; }
export function detectGameRootFolders(directives) {
  const out = new Set(KNOWN_GAME_ROOT_NAMES);
  for (const d of directives || []) {
    const parts = String(d.To || '').replace(/\\/g, '/').split('/');
    const top = parts[0].toLowerCase();
    if (parts.length < 2 || NON_GAME_TOPS.has(top) || MO2_BINARY_ROOTS.has(top)) continue;
    if ((parts.length > 2 && parts[1].toLowerCase() === 'data') || (parts.length === 2 && /\.exe$/i.test(parts[1]))) out.add(top);
  }
  return out;
}

export function resolveDirectivePath(toField, destRoot) {
  if (!toField) return null;
  const normalized = toField.replace(/\\/g, '/').trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();

  // Skip MO2 metadata file extensions
  const dotIdx = lower.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lower.substring(dotIdx) : '';
  if (ext === '.meta' || ext === '.modgroup' || ext === '.modgroups') return null;

  // Skip known non-Data top-level prefixes
  // TEMP_BSA_FILES/<TempID>/<chemin> : fichiers à empaqueter par une directive CreateBSA.
  // Stagés dans un dossier temporaire, puis supprimés après création du BSA.
  if (lower.startsWith('temp_bsa_files/')) {
    const parts = normalized.split('/').slice(1);
    if (parts.length < 2 || parts.some((p) => p === '..' || p === '')) return null;
    const stagingRoot = path.join(destRoot, BSA_STAGING_DIR);
    const resolved = path.join(stagingRoot, ...parts);
    return resolved.startsWith(stagingRoot + path.sep) ? resolved : null;
  }
  if (lower.startsWith('downloads/') ||
      lower.startsWith('webcache/')) return null;

  // ── <Game Root>/{relPath} → destRoot/{relPath} (exécutables, DLL, Data/…) ──
  const slash = lower.indexOf('/');
  if (slash > 0 && gameRootFolders.has(lower.slice(0, slash))) {
    const parts = normalized.split('/').slice(1);
    if (!parts.length || parts.some((p) => p === '..' || p === '')) return null;
    const resolved = path.join(destRoot, ...parts);
    return resolved.startsWith(destRoot + path.sep) ? resolved : null;
  }

  // ── mods/{ModName}/{relPath} — the main case (98% of directives) ──────────
  if (lower.startsWith('mods/')) {
    const parts = normalized.split('/');
    // parts[0]='mods', parts[1]=ModName, parts[2..]= relPath within mod
    if (parts.length < 3) return null;

    const relParts = parts.slice(2);
    const firstSub = relParts[0].toLowerCase();

    // Skip MO2-only artifact subdirs
    if (MODS_SKIP_SUBDIRS.has(firstSub)) return null;

    // mods/{ModName}/Root/{file} → destRoot/{file}
    // These files belong at the Skyrim root (ENB dlls, SKSE preloader, d3d11.dll…)
    if (firstSub === 'root') {
      const rootRel = relParts.slice(1).join('/');
      if (!rootRel) return null;
      const resolved = path.join(destRoot, rootRel);
      return resolved.startsWith(destRoot) ? resolved : null;
    }

    // All other mods files → go into destRoot/Data/
    // mods/{ModName}/textures/foo.dds → destRoot/Data/textures/foo.dds
    // mods/{ModName}/SomeMod.esp      → destRoot/Data/SomeMod.esp
    const dataRel = relParts.join('/');
    if (!dataRel) return null;
    const resolved = path.join(destRoot, 'Data', dataRel);
    return resolved.startsWith(destRoot) ? resolved : null;
  }

  // ── profiles/ → plugins.txt and loadorder.txt at destRoot root ────────────
  if (lower.startsWith('profiles/')) {
    const bn = path.basename(normalized).toLowerCase();
    if (bn === 'plugins.txt' || bn === 'loadorder.txt') {
      return path.join(destRoot, bn);
    }
    return null;
  }

  // ── MO2 binary top-level folders → skip ───────────────────────────────────
  const topFolder = lower.split('/')[0];
  if (MO2_BINARY_ROOTS.has(topFolder)) return null;

  // Everything else (root-level MO2 files, unknown paths) → skip
  return null;
}
