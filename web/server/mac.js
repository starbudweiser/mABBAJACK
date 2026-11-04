// Adaptation au Mac (DXMT, ENB, DLSS) : pont entre le serveur de mABBAJACK et le moteur Mac commun (mackit).
// Le moteur vient de _tools/shared/mackit/src (copié dans server/mackit par _tools/sync_shared.sh, empaqueté en
// server/mackit/engine.mjs par scripts/build-mackit.mjs) : il n'est jamais modifié ici. Le moteur ne renvoie aucun texte
// à lire, seulement des clés « mackit.* » : l'interface les traduit (fr, en, es, it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeLog } from './logger.js';
import { GAME_EXES, isGameRoot, detectSkyrimAtPath } from './gamefiles.js';
import { detectGameRootFolders } from './paths.js';
import { loadRawModlist } from './modprofile.js';
import { installDirName } from './update.js';
import { nexusFetch, getNexusDownloadUrl } from './nexus.js';
import { downloadHttp } from './downloaders.js';
import { safeFileName } from './nxm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_FILE = path.join(HERE, 'mackit', 'engine.mjs');
const BUILD_SCRIPT = path.join(HERE, '..', '..', 'scripts', 'build-mackit.mjs');
const DATA_DIR = () => process.env.MABBAJACK_DATA_DIR || path.join(os.homedir(), '.mabbajack');
const ALL_GAME_EXES = [...new Set(Object.values(GAME_EXES).flat())];

/** Bottled Shaders sur Nexus Mods (Skyrim Special Edition). */
export const BOTTLED = { game: 'skyrimspecialedition', modId: 192816, page: 'https://www.nexusmods.com/skyrimspecialedition/mods/192816' };

/** Le pont mDLSS (d3d11.dll) n'est pas embarqué : on se sert de celui de mORTEX s'il est installé sur ce Mac. */
const BRIDGE_CANDIDATES = () => [
  path.join(os.homedir(), 'Applications', 'Skyrim Tools', 'mORTEX.app', 'Contents', 'Resources', 'app.asar.unpacked', 'assets', 'mdlss', 'd3d11.dll'),
  '/Applications/mORTEX.app/Contents/Resources/app.asar.unpacked/assets/mdlss/d3d11.dll',
];
export const findBridge = () => process.env.MABBAJACK_MDLSS_BRIDGE || BRIDGE_CANDIDATES().find((f) => fs.existsSync(f));

// ── Moteur ─────────────────────────────────────────────────────────────────────
let enginePromise;

const engineLog = (level, message, metadata) =>
  writeLog({ level: level === 'warn' ? 'warn' : 'debug', message: `mackit : ${message}`, details: metadata === undefined ? null : JSON.stringify(metadata), source: 'server' });

/** Le moteur, chargé une fois ; son fichier d'état des bouteilles est propre à mABBAJACK. */
export function loadEngine() {
  enginePromise ??= (async () => {
    if (!fs.existsSync(ENGINE_FILE) && fs.existsSync(BUILD_SCRIPT)) {
      await (await import(pathToFileURL(BUILD_SCRIPT).href)).buildMackit(); // arbre de développement : empaquetage à la demande
    }
    const engine = await import(pathToFileURL(ENGINE_FILE).href);
    engine.configureBottles({ statePath: () => path.join(DATA_DIR(), 'bottles.json'), log: engineLog });
    return engine;
  })().catch((err) => { enginePromise = undefined; throw err; });
  return enginePromise;
}

export const macSupported = () => process.platform === 'darwin';

// ── Dossier à adapter et bouteille ───────────────────────────────────────────────

/** Dossier du jeu embarqué par l'installation : il contient Data/ et l'exécutable (« Game Root », « Stock Game »…). */
export const installHasGame = (installDir) => !!installDir && isGameRoot(installDir, ALL_GAME_EXES);

/**
 * Le dossier que l'adaptation modifie : le jeu embarqué par la liste (son dossier d'installation) quand elle en a un,
 * sinon le Skyrim de l'utilisateur. `exists: false` = le dossier d'installation sera créé par l'installation.
 */
export function resolveTarget({ installDir, gamePath, carriesGame }) {
  if (installDir && installHasGame(installDir)) return { dir: installDir, kind: 'install', exists: true };
  if (installDir && carriesGame) return { dir: installDir, kind: 'install', exists: false };
  const game = typeof gamePath === 'string' && gamePath.trim() ? path.resolve(gamePath.trim()) : '';
  if (game && detectSkyrimAtPath(game).found) return { dir: game, kind: 'game', exists: true };
  return null;
}

/** Bouteille qui contient le dossier (ou le jeu), sinon la préférée du moteur ; `name` impose une bouteille. */
export function chooseBottle(engine, dirs, name) {
  const bottles = engine.listBottles();
  const named = name ? bottles.find((b) => b.name === name) : undefined;
  const bottle = named
    ?? dirs.filter(Boolean).map((d) => engine.bottleForPath(d, bottles)).find(Boolean)
    ?? bottles.find((b) => b.kind === 'crossover')
    ?? bottles[0];
  return { bottle, bottles };
}

const bottleInfo = (b) => (b ? { name: b.name, kind: b.kind, path: b.path } : null);

/** Dossier d'installation de la liste : sous-dossier de READY TO PLAY (même règle que l'installation). */
export function installDirFor({ destPath, modlistName, update }) {
  if (typeof destPath !== 'string' || !destPath.trim()) return '';
  const base = path.resolve(destPath.trim());
  const updateDir = update && typeof update.dir === 'string' ? path.resolve(update.dir) : null;
  return updateDir && path.dirname(updateDir) === base ? updateDir : path.join(base, installDirName(modlistName));
}

const carriesCache = new Map();
/** La liste installe-t-elle son propre dossier de jeu (Game Root, Stock Game…) ? Lecture du .wabbajack, gardée en mémoire. */
export async function listCarriesGame(filePath) {
  if (typeof filePath !== 'string' || !/\.wabbajack$/i.test(filePath) || !fs.existsSync(filePath)) return false;
  const st = fs.statSync(filePath);
  const key = `${filePath}:${st.mtimeMs}:${st.size}`;
  if (carriesCache.has(key)) return carriesCache.get(key);
  const raw = await loadRawModlist(filePath);
  const dirs = (raw.Directives || raw.directives || []).map((d) => ({ To: String(d.To || '').replace(/\\/g, '/') }));
  const roots = detectGameRootFolders(dirs);
  const carries = dirs.some((d) => { const i = d.To.indexOf('/'); return i > 0 && roots.has(d.To.slice(0, i).toLowerCase()); });
  carriesCache.clear();
  carriesCache.set(key, carries);
  return carries;
}

// ── Annonce (avant l'installation) ─────────────────────────────────────────────────

/** Le plan sans ce qu'il faut pour l'appliquer (contenus de fichiers) : seulement de quoi l'annoncer. */
export function summarizePlan(plan) {
  return {
    gamePath: plan.gamePath,
    fixes: plan.fixes.map((f) => ({ id: f.id, title: f.title, detail: f.detail, files: f.files, changes: f.changes })),
    skipped: plan.skipped,
    discarded: plan.discarded,
    bottled: plan.bottled,
  };
}

/**
 * Ce que l'adaptation ferait, sans rien écrire (plan du moteur). Entrée : { destPath, modlist: { name, localFilePath },
 * gamePath, update, bottle }. Sortie JSON : { supported, target, bottle, bottles, bridge, plan? }.
 */
export async function previewMac(input = {}) {
  if (!macSupported()) return { supported: false };
  const engine = await loadEngine();
  const installDir = installDirFor({ destPath: input.destPath, modlistName: input.modlist?.name || input.modlist?.title, update: input.update });
  const carriesGame = installDir ? await listCarriesGame(input.modlist?.localFilePath).catch(() => false) : false;
  const target = resolveTarget({ installDir, gamePath: input.gamePath, carriesGame });
  const { bottle, bottles } = chooseBottle(engine, [target?.dir, input.gamePath], input.bottle);
  const out = { supported: true, target, bottle: bottleInfo(bottle), bottles: bottles.map(bottleInfo), bridge: !!findBridge() && fs.existsSync(findBridge()) };
  if (!target) return out;
  const plan = await engine.plan(target.dir, bottle, { bridgeSource: findBridge(), log: engineLog });
  return { ...out, plan: summarizePlan(plan) };
}

// ── Application (fin d'installation) ───────────────────────────────────────────────

/**
 * Simule puis applique tous les correctifs sur le dossier du jeu qui vient d'être installé (ou sur le jeu de
 * l'utilisateur), et dresse le bilan : { target, bottle, items: [{ id, status: applied|failed|skipped, text?, reason?, files }],
 * discarded, bottled, applied }. Ne lève jamais : une erreur du moteur se lit dans `error`.
 */
export async function finishMac({ installDir, gamePath, bottle: bottleName, bridgeSource = findBridge() }) {
  const report = { target: null, bottle: null, items: [], discarded: [], bottled: null, applied: [] };
  try {
    const engine = await loadEngine();
    const target = resolveTarget({ installDir, gamePath });
    if (!target) return report;
    const { bottle } = chooseBottle(engine, [target.dir, gamePath], bottleName);
    report.target = target;
    report.bottle = bottleInfo(bottle);
    const plan = await engine.plan(target.dir, bottle, { bridgeSource, log: engineLog });
    report.bottled = plan.bottled;
    report.discarded = plan.discarded;
    const { outcomes } = plan.fixes.length ? await engine.apply(plan, { log: engineLog }) : { outcomes: [] };
    const byId = new Map(outcomes.map((o) => [o.id, o]));
    for (const fix of plan.fixes) {
      const o = byId.get(fix.id);
      report.items.push({
        id: fix.id, status: o?.status === 'applied' ? 'applied' : 'failed', undoable: false, title: fix.title, detail: fix.detail,
        text: o?.text, files: fix.files, changes: fix.changes,
      });
      if (o?.status === 'failed') engineLog('warn', `correctif ${fix.id} échoué`, { detail: o.detail });
    }
    for (const s of plan.skipped) report.items.push({ id: s.id, status: 'skipped', undoable: false, reason: s.reason, files: [] });
    report.applied = await engine.appliedFixes(target.dir);
    // seuls les correctifs inscrits au manifeste s'annulent
    const done = new Set(report.applied.map((a) => a.id));
    for (const it of report.items) it.undoable = it.status === 'applied' && done.has(it.id);
  } catch (err) {
    engineLog('warn', 'adaptation au Mac impossible', { error: String(err?.message || err) });
    report.error = String(err?.message || err);
  }
  return report;
}

/** Annule un correctif (ou tous) depuis le manifeste de `dir` ; renvoie le résultat et ce qui reste appliqué. */
export async function undoMac({ dir, id }) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(path.join(dir, '_MAC_BACKUP', 'manifest.json'))) {
    const err = new Error('Rien à annuler dans ce dossier.');
    err.status = 404;
    throw err;
  }
  const engine = await loadEngine();
  const { fixes } = await engine.undo(dir, id, { log: engineLog });
  return { fixes, applied: await engine.appliedFixes(dir) };
}

export async function appliedMac({ dir }) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { applied: [] };
  const engine = await loadEngine();
  return { applied: await engine.appliedFixes(dir) };
}

// ── Bottled Shaders : téléchargement avec la clé Nexus de l'utilisateur (jamais embarqué) ───────

/** « 1.0.26 » ≥ « 1.0.25 » ? comparaison numérique par segment ; une version illisible est la plus ancienne. */
export function versionAtLeast(version, minimum) {
  const seg = (v) => (/\d+(?:\.\d+)*/.exec(String(v ?? '')) || [''])[0].split('.').filter(Boolean).map(Number);
  const a = seg(version), b = seg(minimum);
  if (!a.length) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Le fichier principal le plus récent d'un mod Nexus (liste `files` de files.json). */
export function latestMainFile(files) {
  const main = (Array.isArray(files) ? files : []).filter((f) => f.category_id === 1 || String(f.category_name || '').toUpperCase() === 'MAIN');
  return [...main].sort((x, y) => (y.uploaded_timestamp ?? 0) - (x.uploaded_timestamp ?? 0) || Number(y.is_primary === true) - Number(x.is_primary === true))[0];
}

const idleBottled = () => ({ status: 'idle' });
let bottledJob = idleBottled();
let bottledRunning = false;
export const bottledState = () => ({ ...bottledJob });

/**
 * Lance le téléchargement de la dernière version de Bottled Shaders (au moins `minimum`) dans `downloadsDir`.
 * États : looking → downloading → done | manual (compte gratuit : page Nexus à ouvrir) | error (key en `code`).
 */
export function startBottledDownload({ apiKey, downloadsDir, minimum = '1.0.26' }, deps = { nexusFetch, getNexusDownloadUrl, downloadHttp }) {
  if (bottledRunning) return bottledState();
  if (!apiKey) { bottledJob = { status: 'error', code: 'noKey' }; return bottledState(); }
  if (typeof downloadsDir !== 'string' || !downloadsDir.trim()) { bottledJob = { status: 'error', code: 'noFolder' }; return bottledState(); }
  bottledRunning = true;
  bottledJob = { status: 'looking' };
  (async () => {
    try {
      const info = await deps.nexusFetch(`/v1/games/${BOTTLED.game}/mods/${BOTTLED.modId}/files.json`, apiKey);
      const file = latestMainFile(info?.files);
      const name = safeFileName(file?.file_name);
      if (!file || !name) { bottledJob = { status: 'error', code: 'noFile' }; return; }
      const version = String(file.mod_version || file.version || '');
      if (!versionAtLeast(version, minimum)) { bottledJob = { status: 'error', code: 'tooOld', version }; return; }
      const dest = path.join(path.resolve(downloadsDir.trim()), name);
      const link = await deps.getNexusDownloadUrl(BOTTLED.game, BOTTLED.modId, file.file_id, apiKey);
      if (!link.url) {
        bottledJob = link.isPremium === false
          ? { status: 'manual', version, name, url: link.manualUrl || `${BOTTLED.page}?tab=files&file_id=${file.file_id}` }
          : { status: 'error', code: 'noLink', version };
        return;
      }
      if (fs.existsSync(dest) && fs.statSync(dest).size === Number(file.size_in_bytes || (file.size_kb ?? 0) * 1024) && fs.statSync(dest).size > 0) {
        bottledJob = { status: 'done', version, name, path: dest };
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      bottledJob = { status: 'downloading', version, name, percent: 0 };
      await deps.downloadHttp(link.url, dest, (got, total) => {
        bottledJob = { status: 'downloading', version, name, percent: total > 0 ? Math.min(100, Math.round((got / total) * 100)) : 0 };
      });
      bottledJob = { status: 'done', version, name, path: dest };
      writeLog({ level: 'info', message: `Bottled Shaders ${version} téléchargé : ${dest}`, source: 'server' });
    } catch (err) {
      bottledJob = { status: 'error', code: 'failed', detail: String(err?.message || err).slice(0, 200) };
      writeLog({ level: 'warn', message: `Bottled Shaders : téléchargement échoué (${err?.message || err})`, source: 'server' });
    } finally { bottledRunning = false; }
  })();
  return bottledState();
}

export function resetBottled() { bottledJob = idleBottled(); bottledRunning = false; }

// ── Routes ───────────────────────────────────────────────────────────────────────────

const fail = (res, err) => res.status(err?.status || 500).json({ error: String(err?.message || err) });

export function registerMacRoutes(app, { readKey }) {
  app.post('/api/mac/preview', async (req, res) => {
    try { res.json(await previewMac(req.body || {})); } catch (err) { fail(res, err); }
  });
  app.post('/api/mac/undo', async (req, res) => {
    const { dir, id } = req.body || {};
    try { res.json(await undoMac({ dir, id: typeof id === 'string' && id ? id : 'all' })); } catch (err) { fail(res, err); }
  });
  app.get('/api/mac/applied', async (req, res) => {
    try { res.json(await appliedMac({ dir: String(req.query.dir || '') })); } catch (err) { fail(res, err); }
  });
  app.get('/api/mac/bottled', (_req, res) => res.json(bottledState()));
  app.post('/api/mac/bottled/download', async (req, res) => {
    const apiKey = String(req.body?.nexusApiKey || '').trim() || await readKey();
    res.json(startBottledDownload({ apiKey, downloadsDir: String(req.body?.downloadsPath || '') }));
  });
}
