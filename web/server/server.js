import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFile, execFileSync } from 'child_process';
import { jobControl, trackedSpawn as spawn, shutdown } from './jobcontrol.js';
import JSZip from 'jszip';
import https from 'https';
import http from 'http';
import { createWriteStream, mkdirSync } from 'fs';
import multer from 'multer';
import { openBsa, extractFileFromBsa } from './bsa.js';
import { looksLikeBsa, extractNestedArchive } from './nested.js';
import { matchInRoot, rankGameRoots, siblingGameRoots } from './gameroot.js';
import { createBsa } from './bsawriter.js';
import { patchFile } from './octodiff.js';
import { findTexconv, TextureQueue } from './textures.js';
import { remapMagicStrings } from './remap.js';
import { downloadWabbajackCdn, downloadGoogleDrive, downloadHttp } from './downloaders.js';
import { buildOptions, buildSelection, dedupeByPriority, renderModlistTxt, loadRawModlist, readZipEntry } from './modprofile.js';
import { checkDiskSpace, fmtBytes } from './diskspace.js';
import { inspectWabbajack as inspectWabbajackRaw } from './inspect.js';
import { recordGameVersion, enrichCatalog } from './gameversions.js';
import { openLazyZip } from './lazyzip.js';
import { HashCache, verifyArchive, verifyInstalledFiles, findStrayFiles, archiveSourceUrl, listDownloadDir, modOf } from './archivecheck.js';
import { isTempPath, locateWabbajack } from './locate.js';
import { resolveDirectivePath, detectGameRootFolders, setGameRootFolders, getGameRootFolders, KNOWN_GAME_ROOT_NAMES, BSA_STAGING_DIR } from './paths.js';
import { installDirName, compareWithInstalled, readSnapshot, writeSnapshot, findPreviousWabbajack, manifestEntries, manifestArchives, manifestFingerprint, baselineFromSnapshot, baselineFromManifest, planUpdate, removeFiles, inferOptions } from './update.js';
import { findUnusedDownloads, moveToTrash } from './cleanup.js';
import { initLogger, writeLog, startInstallLog, endInstallLog, getLogInfo, tailLog } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

// Serveur local uniquement : refuse les pages d'autres sites (CSRF, lecture du presse-papiers…)
// et le « DNS rebinding » (en-tête Host étranger). Le dev Vite (localhost:5173) reste autorisé.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocalOrigin = (origin) => {
  try { return LOCAL_HOSTNAMES.has(new URL(origin).hostname); } catch { return false; }
};
app.use((req, res, next) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const origin = req.headers.origin;
  if (!LOCAL_HOSTNAMES.has(host) || (origin && !isLocalOrigin(origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: 'Origine refusée' });
  }
  next();
});
app.use(cors({ origin: (origin, cb) => cb(null, !origin || isLocalOrigin(origin)) }));
app.use(express.json({ limit: '100mb' }));

// ──────────────────────────────────────────────────────────
// Journal persistant (logs/mabbajack.log + logs/installs/*.log)
// ──────────────────────────────────────────────────────────
initLogger(path.join(__dirname, '..'));
process.on('uncaughtException', (err) => {
  writeLog({ level: 'error', message: `uncaughtException : ${err?.message || err}`, details: err?.stack || null, source: 'node' });
  console.error(err);
});
process.on('unhandledRejection', (reason) => {
  writeLog({ level: 'error', message: `unhandledRejection : ${reason?.message || reason}`, details: reason?.stack || null, source: 'node' });
});
process.on('warning', (w) => {
  writeLog({ level: 'warn', message: `Node warning : ${w?.name || ''} ${w?.message || w}`, source: 'node' });
});

// Application autonome : s'arrêter si le processus parent (fenêtre) disparaît
const PARENT_PID = Number(process.env.MABBAJACK_PARENT_PID || 0);
if (PARENT_PID > 0) {
  setInterval(() => {
    try { process.kill(PARENT_PID, 0); } catch { shutdown(0); }
  }, 2000).unref();
}

// Entrées de l'interface (logs locaux, erreurs JS) — par lot
app.post('/api/log', (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 500) : [];
  for (const e of entries) {
    if (!e || typeof e.message !== 'string') continue;
    const at = Number.isFinite(e.at) ? new Date(e.at) : new Date();
    writeLog({
      level: typeof e.level === 'string' ? e.level : 'info',
      message: e.message.slice(0, 20000),
      details: typeof e.details === 'string' ? e.details.slice(0, 20000) : null,
      source: e.source === 'js' ? 'js' : 'client',
      at,
    });
  }
  res.json({ ok: true, written: entries.length });
});

// Lecture des dernières lignes : ?lines=500&which=main|install
app.get('/api/logs/tail', (req, res) => {
  try {
    const which = req.query.which === 'install' ? 'install' : 'main';
    res.type('text/plain; charset=utf-8').send(tailLog({ lines: req.query.lines, which }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/logs/info', (_req, res) => res.json(getLogInfo()));

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────
let sseClients = [];
let logHistory = [];
let cachedModlists = null;

/** Analyse un .wabbajack et mémorise sa version de jeu exacte (alimente la galerie). */
async function inspectWabbajack(...args) {
  const info = await inspectWabbajackRaw(...args);
  if (info?.gameVersion) recordGameVersion(info.name, info.gameVersion);
  return info;
}
let lastModlistsFetch = 0;
let lastGeneratedPluginsTxt = '';
// Translation cache: key = `${lang}:${text}` → translated string
const translateCache = new Map();

let currentInstallJob = {
  active: false,
  abortController: null,
  progress: {
    stage: 'idle', stageName: 'En attente', overallPercent: 0, stagePercent: 0,
    currentTask: 'Prêt', processedItems: 0, totalItems: 0, processedBytes: 0,
    totalBytes: 0, speedBytesPerSec: 0, etaSeconds: 0, activeDownloads: 0,
    missingArchivesCount: 0, isPaused: false, hasError: false, errorMessage: null,
  },
};

// ──────────────────────────────────────────────────────────
// SSE
// ──────────────────────────────────────────────────────────
function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => { try { res.write(payload); } catch { /**/ } });
}
function broadcastLog(level, message, details = null) {
  const log = { id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, timestamp: new Date().toLocaleTimeString(), level, message, details };
  logHistory.push(log);
  if (logHistory.length > 500) logHistory.shift();
  writeLog({ level, message, details, source: 'server' });
  broadcastSSE({ type: 'log', log });
}
/** Détail technique écrit uniquement dans le fichier journal (pas dans l'interface). */
function debugLog(message, details = null) {
  writeLog({ level: 'debug', message, details, source: 'server' });
}
function broadcastProgress(patch) {
  currentInstallJob.progress = { ...currentInstallJob.progress, ...patch };
  broadcastSSE({ type: 'progress', progress: currentInstallJob.progress });
}

// ──────────────────────────────────────────────────────────
// Filesystem helpers
// ──────────────────────────────────────────────────────────
function makeDirResilient(targetDir) {
  if (!targetDir?.trim()) throw new Error('Chemin vide ou invalide.');
  const normalized = path.resolve(targetDir.trim());

  if (normalized.startsWith('/Volumes/')) {
    const parts = normalized.split(path.sep).filter(Boolean);
    if (parts.length >= 2) {
      const volumeRoot = '/' + path.join(parts[0], parts[1]);
      if (!fs.existsSync(volumeRoot)) {
        throw new Error(`Volume "${volumeRoot}" non monté. Vérifiez qu'il est visible dans le Finder.`);
      }
    }
  }

  if (fs.existsSync(normalized)) {
    if (!fs.statSync(normalized).isDirectory()) throw new Error(`"${normalized}" n'est pas un dossier.`);
    return normalized;
  }

  // Tier 1: Node native
  try { fs.mkdirSync(normalized, { recursive: true }); if (fs.existsSync(normalized)) return normalized; } catch { /* */ }
  // Tier 2: /bin/mkdir -p (handles spaces as array argument — no shell interpolation)
  try { execFileSync('/bin/mkdir', ['-p', normalized], { stdio: 'ignore' }); if (fs.existsSync(normalized)) return normalized; } catch { /* */ }
  // Tier 3: osascript (runs as user, bypasses App Sandbox)
  try {
    execFileSync('/usr/bin/osascript', ['-e', `do shell script "/bin/mkdir -p " & quoted form of "${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`], { stdio: 'ignore' });
    if (fs.existsSync(normalized)) return normalized;
  } catch { /* */ }

  throw new Error(`Impossible de créer "${normalized}". Accordez l'Accès complet au disque dans Réglages Système > Confidentialité & Sécurité.`);
}

function testWriteAccess(dir) {
  try {
    const f = path.join(dir, `.mw_test_${Date.now()}`);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    return null;
  } catch (err) {
    if (err.code === 'EROFS') return 'Disque en lecture seule (NTFS). Formatez en APFS ou ExFAT.';
    if (err.code === 'EACCES' || err.code === 'EPERM') return 'macOS refuse l\'accès en écriture. Accordez l\'Accès complet au disque dans Réglages Système.';
    return err.message;
  }
}

// ──────────────────────────────────────────────────────────
// 7z helpers
// ──────────────────────────────────────────────────────────
// Dossier de binaires embarqués (application autonome) : prioritaire sur Homebrew
const BUNDLED_BIN_DIR = process.env.MABBAJACK_BIN_DIR || '';

function find7z() {
  const bundled = BUNDLED_BIN_DIR ? [path.join(BUNDLED_BIN_DIR, '7zz')] : [];
  for (const c of [...bundled, '/opt/homebrew/bin/7zz', '/usr/local/bin/7zz', '/opt/homebrew/bin/7z', '/usr/local/bin/7z']) {
    try { execFileSync(c, ['i'], { stdio: 'ignore' }); return c; } catch { /* */ }
  }
  return null;
}

function findTexconvBin() { return findTexconv(BUNDLED_BIN_DIR); }

function findUnar() {
  const bundled = BUNDLED_BIN_DIR ? [path.join(BUNDLED_BIN_DIR, 'unar')] : [];
  for (const c of [...bundled, '/opt/homebrew/bin/unar', '/usr/local/bin/unar']) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch { /* */ }
  }
  return null;
}

// Clean up any orphaned mwab_batch_* temp dirs/files from previous runs
function purgeMwabTmpDirs() {
  try {
    const tmpRoot = os.tmpdir();
    const entries = fs.readdirSync(tmpRoot);
    let purged = 0;
    for (const e of entries) {
      if (!e.startsWith('mwab_batch_')) continue;
      try {
        const fp = path.join(tmpRoot, e);
        fs.rmSync(fp, { recursive: true, force: true });
        purged++;
      } catch {}
    }
    if (purged > 0) console.log(`[mABBAJACK] /tmp purge: ${purged} entrée(s) supprimée(s)`);
  } catch {}
}


/**
 * Extract a single specific file from an archive using 7z.
 * Strategy:
 *   1. Try `7zz e -so <archive> <path>` (stdout pipe) — fast for 7z/zip
 *   2. If 0 bytes with code 0: retry with backslash path
 *   3. If still 0 bytes: fallback to `7zz e <archive> <path> -o<tempdir>` — needed for some RAR5
 * A 120s timeout per call prevents deadlocks on corrupt archives.
 */
function extract7zSingleFile(sevenZipBin, archivePath, sourcePath, outputFile) {
  // BSA archives (vanilla game files) : 7z ne sait pas les lire → lecteur natif
  if (/\.bsa$/i.test(archivePath || '')) {
    return new Promise((resolve, reject) => {
      try {
        makeDirResilient(path.dirname(outputFile));
        resolve(extractFileFromBsa(archivePath, sourcePath, outputFile));
      } catch (err) { reject(err); }
    });
  }
  return new Promise((resolve, reject) => {
    const normalizedSource = sourcePath.replace(/\\/g, '/');
    const backslashSource  = sourcePath.replace(/\//g, '\\');
    makeDirResilient(path.dirname(outputFile));

    // Global timeout: 120 s per file
    const globalTimer = setTimeout(() => {
      reject(new Error(`Timeout 120s pour "${normalizedSource}" dans ${path.basename(archivePath)}`));
    }, 120000);

    const done = (result) => { clearTimeout(globalTimer); resolve(result); };
    const fail  = (err)   => { clearTimeout(globalTimer); reject(err); };

    // --- Attempt 1: stdout pipe with forward slashes ---
    function attempt1() {
      const out = createWriteStream(outputFile);
      const proc = spawn(sevenZipBin, ['e', '-so', archivePath, normalizedSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, stderr = '';
      proc.stdout.on('data', (d) => { bytes += d.length; });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.pipe(out);
      proc.on('error', (err) => { out.destroy(); fail(err); });
      proc.on('close', (code) => {
        out.end(() => {
          if (code === 0 && bytes > 0) { done(bytes); return; }
          if (code !== 0) {
            try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
            // Non-zero exit → genuine error, skip fallback
            fail(new Error(`7z exit ${code} pour "${normalizedSource}": ${stderr.slice(0, 200)}`));
            return;
          }
          // code === 0 but 0 bytes → file not found with this path, try backslash
          attempt2();
        });
      });
    }

    // --- Attempt 2: stdout pipe with backslashes (RAR often needs this) ---
    function attempt2() {
      const out = createWriteStream(outputFile);
      const proc = spawn(sevenZipBin, ['e', '-so', archivePath, backslashSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, stderr = '';
      proc.stdout.on('data', (d) => { bytes += d.length; });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.pipe(out);
      proc.on('error', (err) => { out.destroy(); fail(err); });
      proc.on('close', (code) => {
        out.end(() => {
          if (code === 0 && bytes > 0) { done(bytes); return; }
          if (code !== 0) {
            try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
            fail(new Error(`7z exit ${code} pour "${backslashSource}": ${stderr.slice(0, 200)}`));
            return;
          }
          // Still 0 bytes → fallback to temp-dir extraction (works for most RAR5)
          attempt3();
        });
      });
    }

    // --- Attempt 3: extract to temp dir, then move file ---
    function attempt3() {
      const tmpDir = path.join(os.tmpdir(), `mwab_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      // 7zz e extracts flat (no subdirs), 7zz x preserves structure — use x here
      const proc = spawn(sevenZipBin, ['x', '-y', `-o${tmpDir}`, archivePath, normalizedSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.resume(); // drain stdout
      proc.on('error', (err) => { fs.rmSync(tmpDir, { recursive: true, force: true }); fail(err); });
      proc.on('close', (code) => {
        if (code !== 0) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fail(new Error(`Fichier introuvable dans l'archive : "${normalizedSource}"`));
          return;
        }
        // Find the extracted file (may be nested)
        const basename = path.basename(normalizedSource);
        let found = null;
        const walk = (dir) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) { walk(fp); }
            else if (e.name === basename || fp.endsWith(normalizedSource.replace(/\//g, path.sep))) { found = fp; }
          }
        };
        try { walk(tmpDir); } catch {}
        if (found && fs.existsSync(found)) {
          try {
            fs.copyFileSync(found, outputFile);
            const size = fs.statSync(outputFile).size;
            fs.rmSync(tmpDir, { recursive: true, force: true });
            done(size);
          } catch (e) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            fail(e);
          }
        } else {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fail(new Error(`Fichier introuvable après extraction temp : "${normalizedSource}"`));
        }
      });
    }

    attempt1();
  });
}


// ──────────────────────────────────────────────────────────
// Download helper
// ──────────────────────────────────────────────────────────
const downloadFile = downloadHttp; // reprise (.part + Range) et nouvelles tentatives : downloaders.js

// ──────────────────────────────────────────────────────────
// Nexus Mods helpers
// ──────────────────────────────────────────────────────────
const NEXUS_RETRIES = 4;
const DOWNLOAD_CONCURRENCY = 3; // archives téléchargées en même temps

async function nexusFetchOnce(endpoint, apiKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://api.nexusmods.com${endpoint}`, {
      headers: { apikey: apiKey, 'Application-Name': 'mAbbajack-macOS', 'Application-Version': '2.1.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`Nexus API ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Appel API Nexus ; réessaie sur limite de débit (429), erreur serveur (5xx) ou coupure réseau. */
async function nexusFetch(endpoint, apiKey) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await nexusFetchOnce(endpoint, apiKey);
    } catch (e) {
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || attempt >= NEXUS_RETRIES) throw e;
      const wait = e.retryAfter ? e.retryAfter * 1000 : 2000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60000)));
    }
  }
}

// Statut Premium par clé : une seule vérification par session au lieu d'une par archive
const nexusPremiumCache = new Map();
async function isNexusPremium(apiKey) {
  if (!nexusPremiumCache.has(apiKey)) {
    const validate = await nexusFetch('/v1/users/validate.json', apiKey);
    nexusPremiumCache.set(apiKey, !!validate.is_premium);
  }
  return nexusPremiumCache.get(apiKey);
}

async function getNexusDownloadUrl(gameName, modId, fileId, apiKey) {
  if (!apiKey || !modId || !fileId) return { url: null, requiresManual: true };
  try {
    if (!(await isNexusPremium(apiKey))) {
      return { url: null, requiresManual: true, isPremium: false, manualUrl: `https://www.nexusmods.com/${gameName}/mods/${modId}?tab=files&file_id=${fileId}` };
    }
    const links = await nexusFetch(`/v1/games/${gameName}/mods/${modId}/files/${fileId}/download_link.json`, apiKey);
    if (Array.isArray(links) && links.length > 0) {
      const cdn = links.find((l) => l.short_name === 'Cloudflare' || l.short_name === 'CDN') || links[0];
      return { url: cdn.URI, requiresManual: false, isPremium: true };
    }
    return { url: null, requiresManual: true, isPremium: true };
  } catch (err) {
    return { url: null, requiresManual: true, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────
// Skyrim version detection
// ──────────────────────────────────────────────────────────
function getExpectedSkyrimVersion(gameType, skyrimVersion, archives) {
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
const GAME_DIR_NAMES = {
  skyrimspecialedition: 'Skyrim Special Edition',
  skyrimvr: 'SkyrimVR',
  skyrim: 'Skyrim',
  enderalspecialedition: 'Enderal Special Edition',
};

function isGameFileArchive(a) {
  return /GameFileSource/i.test(a?.State?.$type || '');
}

/** Fichiers du jeu sans intérêt (journaux : Debug.log, Papyrus.0.log…) : jamais requis, jamais signalés manquants. */
function isIgnorableGameFile(a) {
  if (!isGameFileArchive(a)) return false;
  const rel = String(a?.State?.GameFile || a?.Name || '').replace(/\\/g, '/');
  return /\.log$/i.test(rel);
}

function gameFileRel(a) {
  return String(a?.State?.GameFile || '').replace(/\\/g, '/');
}

const GAME_EXES = {
  skyrimspecialedition: ['SkyrimSE.exe', 'SkyrimSELauncher.exe'],
  skyrimvr: ['SkyrimVR.exe'],
  skyrim: ['TESV.exe'],
  enderalspecialedition: ['SkyrimSE.exe'],
};
// Dossiers jamais explorés lors de la recherche d'un dossier de jeu
const GAME_SCAN_SKIP = new Set([
  'data', 'mods', 'downloads', 'profiles', 'overwrite', 'node_modules', 'textures', 'meshes',
  'sound', 'music', 'scripts', 'interface', 'skse', '$recycle.bin', 'system volume information',
  '.spotlight-v100', '.fseventsd', '.trashes', '.documentrevisions-v100', '.temporaryitems',
]);

/** Dossier racine d'un jeu : contient Data/ ET l'exécutable du jeu. */
function isGameRoot(p, exes) {
  try {
    if (!fs.statSync(path.join(p, 'Data')).isDirectory()) return false;
    return exes.some((e) => fs.existsSync(path.join(p, e)));
  } catch { return false; }
}

/**
 * Recherche bornée (profondeur 3) des installations du jeu sur les volumes montés.
 * Couvre « Stock Game » / « Game Root » (Wabbajack, Nolvus) et les bibliothèques Steam.
 */
function discoverGameRoots(exes, maxDepth = 3, maxDirsPerVolume = 4000) {
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

const _gameDirCache = new Map(); // `${gameName}|${deep}` → { at, dirs }
function autoDetectGameDirs(gameName, deep = false) {
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
function gameSearchDirs(a, gamePath, deep = false) {
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
function resolveGameFileArchive(a, gamePath, downloadsDir) {
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

function expectedGameFilePath(a, gamePath) {
  const dirs = gameSearchDirs(a, gamePath, true);
  const base = dirs[0] || `<${GAME_DIR_NAMES[String(a?.State?.Game || '').toLowerCase()] || 'Skyrim Special Edition'}>`;
  return path.join(base, gameFileRel(a));
}

function detectSkyrimAtPath(gamePath) {
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

// ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
//  DIRECTIVE PROCESSOR — THE CORE ENGINE
//  Implements the Wabbajack directive specification:
//  - FromArchive: extract a SPECIFIC file from a SPECIFIC archive
//  - InlineFile: read file embedded in the .wabbajack zip
//  - PatchedFromArchive: extract base file + apply OctoDiff patch
//  This is how FOMOD pre-selected choices are honoured.
// ══════════════════════════════════════════════════════════
// ──────────────────────────────────────────────────────────

// Résolution des destinations (directive.To → chemin installé) : voir paths.js

/**
 * Mise à jour d'une installation existante : base de comparaison (instantané, sinon ancien
 * .wabbajack, sinon disque) puis plan (fichiers inchangés, retirés, archives nécessaires).
 */
async function prepareUpdate({ raw, wabbajackPath, selection, destRoot, previousFile, signal }) {
  const posixTo = (t) => String(t || '').replace(/\\/g, '/');
  let dirs = (raw.Directives || raw.directives || []).map((d) => ({
    $type: d.$type || '', To: posixTo(d.To || d.to), Hash: d.Hash || '', Size: d.Size || 0,
    TempID: d.TempID || '', ArchiveHash: (d.ArchiveHashPath || [])[0] || '',
  }));
  if (selection) dirs = dirs.filter((d) => selection.keep(d.To));
  setGameRootFolders(detectGameRootFolders(dirs));
  const resolve = (d) => resolveDirectivePath(d.To, destRoot);
  if (selection && selection.priority.size > 0) dirs = dedupeByPriority(dirs, resolve, selection.priority).directives;

  let baseline = null;
  const snap = readSnapshot(destRoot);
  if (snap) {
    baseline = baselineFromSnapshot(snap);
    broadcastLog('info', `🔄 Base de comparaison : état enregistré de l'installation (v${snap.version || '?'}, ${snap.files.length} fichier(s)).`);
  } else {
    const name = raw.Name || raw.name || '';
    let prev = null;
    if (previousFile && fs.existsSync(previousFile)) {
      const r = await loadRawModlist(previousFile);
      prev = { file: previousFile, entries: manifestEntries(r) };
    } else if (wabbajackPath) {
      const fp = await manifestFingerprint(manifestEntries(raw), manifestArchives(raw));
      prev = await findPreviousWabbajack(wabbajackPath, name, fp);
    }
    if (prev) {
      baseline = baselineFromManifest(prev.entries);
      broadcastLog('info', `🔄 Base de comparaison : version précédente ${path.basename(prev.file)}.`);
    } else {
      broadcastLog('info', `🔄 Aucune version précédente connue : comparaison avec les fichiers présents (taille, puis hash Wabbajack). Cette première comparaison peut être longue.`);
    }
  }
  let lastPct = -1;
  const plan = await planUpdate({
    directives: dirs, resolve, baseline, signal,
    onProgress: (phase, done, total) => {
      const pct = Math.floor((done / Math.max(1, total)) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      broadcastProgress({ currentTask: phase === 'hash' ? `Comparaison des fichiers installés (hash) : ${pct} %` : `Comparaison des fichiers installés : ${done}/${total}` });
    },
  });
  broadcastLog('info', `🔄 Comparaison : ${plan.added} fichier(s) absent(s) à installer, ${plan.changed} modifié(s), ${plan.unchanged} inchangé(s), ${plan.removed.length} à supprimer.`);
  if (plan.hashed) broadcastLog('info', `  → ${plan.hashed} fichier(s) vérifié(s) par hash.`);
  return plan;
}

/**
 * Process all directives from the parsed modlist.
 * Handles FromArchive, InlineFile, PatchedFromArchive.
 * Returns { processed, skipped, errors }
 */
async function processDirectives({ directives, archiveStatuses, destRoot, wabbajackZip, sevenZipBin, unarBin, signal, onProgress, gamePath = '', downloadsPath = '', texconvBin = null }) {
  // Clean up any leftover temp dirs from previous crashed/killed runs
  purgeMwabTmpDirs();
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let processedBytes = 0;
  let gameDirectCopies = 0;   // fichiers originaux du jeu copiés tels quels
  let modDirectCopies = 0;    // archives « fichier unique » (ex. .esp téléchargé directement)
  const patchStats = { patched: 0, already: 0, fallback: 0, noPatch: 0 };
  let transformedTextures = 0;   // TransformedTexture copiée sans conversion (texconv absent)
  // TransformedTexture : textures collectées pendant l'extraction, converties en lot ensuite
  const textureQueue = texconvBin ? new TextureQueue({ bin: texconvBin, stageRoot: path.join(destRoot, '.mabbajack_textures') }) : null;
  textureQueue?.cleanup();
  let remappedFiles = 0;         // RemappedInlineFile : chemins remplacés
  let remapUnresolved = 0;
  const patchFallbackNames = [];

  // Build archive lookup: by Hash AND by Name (case-insensitive)
  // Both are needed because scan might match by name while directive references by hash
  const archiveByHash = new Map();
  const archiveByNameLower = new Map();
  // allArchivesByHash includes unavailable archives (for name lookup in warnings)
  const allArchivesByHash = new Map();
  for (const arc of archiveStatuses) {
    if (arc.Hash) allArchivesByHash.set(arc.Hash, arc);
    if (arc.status === 'ready' && arc.localPath && fs.existsSync(arc.localPath)) {
      if (arc.Hash) archiveByHash.set(arc.Hash, arc);
      if (arc.Name) archiveByNameLower.set(arc.Name.toLowerCase(), arc);
    }
  }

  /** Resolve archive by hash first, then by Name fallback */
  function findArchive(hash, archName) {
    let arc = hash ? archiveByHash.get(hash) : null;
    if (!arc && archName) arc = archiveByNameLower.get(archName.toLowerCase());
    return arc || null;
  }

  /** Get a human-readable name for an unavailable archive hash */
  function unknownArchiveName(hash) {
    const arc = hash ? allArchivesByHash.get(hash) : null;
    return arc?.Name || (hash ? hash.slice(0, 16) + '…' : '(hash inconnu)');
  }

  const isPatchedDirective = (d) => /patched/i.test(d?.$type || '');

  /** Lit le delta OctoDiff d'une directive PatchedFromArchive dans le .wabbajack. */
  async function loadPatch(d) {
    if (!wabbajackZip || !d.PatchID) return null;
    const entry = wabbajackZip.file(d.PatchID) || wabbajackZip.file(`patches/${d.PatchID}`);
    return entry ? entry.async('nodebuffer') : null;
  }

  /**
   * Écrit le fichier final d'une directive.
   * src = { file } (copie, clone APFS si possible) ou { buffer }.
   * PatchedFromArchive : application du delta OctoDiff sur la base.
   */
  async function deliver(d, outputPath, src) {
    makeDirResilient(path.dirname(outputPath));
    // TransformedTexture : mise de côté pour texconv (sauf si la source a déjà l'état demandé).
    // Sans texconv, la texture source est copiée telle quelle (valide, mais d'une autre taille).
    if (/transformedtexture/i.test(d?.$type || '')) {
      if (textureQueue) { if (textureQueue.add(d, outputPath, src)) return; }
      else transformedTextures++;
    }
    if (isPatchedDirective(d)) {
      const base = src.buffer || fs.readFileSync(src.file);
      const delta = await loadPatch(d);
      let data = base;
      if (!delta) patchStats.noPatch++;
      else {
        const r = patchFile(base, delta);
        data = r.data;
        patchStats[r.status]++;
        if (r.status === 'fallback') patchFallbackNames.push(path.basename(d.To || ''));
      }
      fs.writeFileSync(outputPath, data);
      return;
    }
    if (src.buffer) fs.writeFileSync(outputPath, src.buffer);
    else fs.copyFileSync(src.file, outputPath, fs.constants.COPYFILE_FICLONE);
  }

  // Categorize directives — « patched » AVANT « fromarchive » :
  // "PatchedFromArchive" contient "FromArchive" et était traité comme une simple extraction.
  const fromArchiveDirectives = [];
  const inlineDirectives = [];
  const patchedDirectives = [];
  const otherDirectives = [];

  for (const d of directives) {
    const type = (d.$type || '').toLowerCase();
    if (type.includes('patched')) patchedDirectives.push(d);
    else if (type.includes('fromarchive') || type.includes('transformedtexture')) fromArchiveDirectives.push(d);
    else if (type.includes('inline')) inlineDirectives.push(d);
    else otherDirectives.push(d);
  }

  const total = directives.length;
  broadcastLog('info', `📋 Directives à traiter : ${fromArchiveDirectives.length} FromArchive, ${inlineDirectives.length} InlineFile, ${patchedDirectives.length} PatchedFromArchive, ${otherDirectives.length} autres`);

  // ── 0. FICHIERS ORIGINAUX DU JEU — identifiés avant toute extraction ─────
  const gameArchives = archiveStatuses.filter(isGameFileArchive);
  if (gameArchives.length > 0) {
    const gameReady = gameArchives.filter((a) => a.status === 'ready' && a.localPath).length;
    broadcastLog('info', `🎮 Fichiers originaux du jeu : ${gameReady}/${gameArchives.length} identifiés — copie directe, aucune décompression.`);
  }

  // Staging CreateBSA résiduel d'une installation interrompue
  try { fs.rmSync(path.join(destRoot, BSA_STAGING_DIR), { recursive: true, force: true }); } catch { /* */ }

  // ── 1. INLINE FILES ─────────────────────────────────────────────────
  // These are small files embedded directly in the .wabbajack zip
  broadcastLog('info', `📎 Traitement des fichiers inline (${inlineDirectives.length})...`);
  for (const d of inlineDirectives) {
    await jobControl.waitIfPaused(signal);
    const outputPath = resolveDirectivePath(d.To, destRoot);
    if (!outputPath) { skipped++; continue; }

    try {
      if (wabbajackZip) {
        // Wabbajack InlineFile: SourceDataID is a UUID used as the filename at the ROOT of the zip
        // (not under 'inlined/'). Hash is a fallback for older formats.
        const sourceId = d.SourceDataID || '';
        const hashId   = d.Hash || '';
        const toPosix  = (d.To || '').replace(/\\/g, '/');

        const entry =
          (sourceId && wabbajackZip.file(sourceId)) ||          // Modern: UUID at root
          (sourceId && wabbajackZip.file(`inlined/${sourceId}`)) || // Older: under inlined/
          (sourceId && wabbajackZip.file(`inlined/${sourceId}.zip`)) ||
          (hashId   && wabbajackZip.file(hashId)) ||            // Hash at root
          (hashId   && wabbajackZip.file(`inlined/${hashId}`)) ||
          (hashId   && wabbajackZip.file(`inlined/${hashId}.zip`)) ||
          (toPosix  && wabbajackZip.file(toPosix)) ||
          null;

        if (entry) {
          let content = await entry.async('nodebuffer');
          // Some inline entries are themselves zip-compressed; unwrap if needed
          if (entry.name.endsWith('.zip')) {
            try {
              const inner = await JSZip.loadAsync(content);
              const innerFiles = Object.values(inner.files).filter((f) => !f.dir);
              if (innerFiles.length === 1) content = await innerFiles[0].async('nodebuffer');
            } catch { /* not a zip, use as-is */ }
          }
          // RemappedInlineFile : remplace les magic strings par les chemins réels de cette machine
          if (/remapped/i.test(d.$type || '')) {
            const r = remapMagicStrings(content, { mo2: destRoot, game: gamePath, download: downloadsPath });
            content = r.data;
            if (r.replaced > 0) remappedFiles++;
            remapUnresolved += r.unresolved;
          }
          makeDirResilient(path.dirname(outputPath));
          fs.writeFileSync(outputPath, content);
          processed++;
        } else {
          // Entry not found in zip — create placeholder to preserve directory structure
          makeDirResilient(path.dirname(outputPath));
          if (!fs.existsSync(outputPath)) {
            fs.writeFileSync(outputPath, '', 'utf-8');
          }
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
    }

    if ((processed + skipped + errors) % 50 === 0 && onProgress) {
      onProgress(processed + skipped + errors, total);
    }
  }
  broadcastLog('info', `  → ${processed} inline écrits, ${skipped} ignorés`);

  // ── 2. FROM ARCHIVE + PATCHED FROM ARCHIVE ──────────────────────────────
  // Group by archive hash for efficiency — one 7z open per archive.
  // Les directives patchées suivent le même chemin (base extraite puis delta OctoDiff).
  broadcastLog('info', `📦 Extraction sélective des fichiers FromArchive (${fromArchiveDirectives.length + patchedDirectives.length})...`);

  // Group directives by archive hash
  const byArchive = new Map();
  for (const d of [...fromArchiveDirectives, ...patchedDirectives]) {
    // ArchiveHashPath[0] is the archive hash (already normalized in ArchiveHash field)
    const hash = d.ArchiveHash || (d.ArchiveHashPath && d.ArchiveHashPath[0]) || '';
    if (!byArchive.has(hash)) byArchive.set(hash, []);
    byArchive.get(hash).push(d);
  }

  let archiveIdx = 0;
  for (const [archiveHash, allArchDirectives] of byArchive) {
    await jobControl.waitIfPaused(signal);
    archiveIdx++;

    // Seules les archives réellement présentes sur disque sont exploitables
    const archive = findArchive(archiveHash, allArchDirectives[0]?.ArchiveName);

    if (!archive) {
      if (isIgnorableGameFile(allArchivesByHash.get(archiveHash))) { skipped += allArchDirectives.length; if (onProgress) onProgress(processed + skipped + errors, total); continue; }
      broadcastLog('warn', `  ⚠ Archive non disponible : "${unknownArchiveName(archiveHash)}" — ${allArchDirectives.length} fichier(s) ignoré(s)`);
      skipped += allArchDirectives.length;
      if (onProgress) onProgress(processed + skipped + errors, total);
      continue;
    }
    const isGameSource = isGameFileArchive(archive);

    // ── Source = fichier entier (ArchiveHashPath de longueur 1) ──────────────
    // Cas des fichiers originaux du jeu (Skyrim.esm, Update.esm, cc*.esl/esm…) :
    // le fichier est copié tel quel (ou patché), JAMAIS décompressé.
    const archDirectives = [];
    for (const d of allArchDirectives) {
      await jobControl.waitIfPaused(signal);
      if (d.SourcePath) { archDirectives.push(d); continue; }
      processedBytes += d.Size || 0;
      const outputPath = resolveDirectivePath(d.To, destRoot);
      if (!outputPath) { skipped++; continue; }
      try {
        await deliver(d, outputPath, { file: archive.localPath });
        processed++;
        if (isGameSource) gameDirectCopies++; else modDirectCopies++;
      } catch (copyErr) {
        errors++;
        broadcastLog('warn', `  ⚠ Copie impossible : ${path.basename(archive.localPath)} → ${path.basename(outputPath)} — ${String(copyErr.message).slice(0, 160)}`);
      }
    }
    if (archDirectives.length === 0) {
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    // Garde-fou : un fichier original du jeu qui n'est pas un BSA n'est pas une archive
    if (isGameSource && !/\.bsa$/i.test(archive.localPath || '')) {
      broadcastLog('warn', `  ⚠ ${path.basename(archive.localPath)} est un fichier du jeu, pas une archive — ${archDirectives.length} chemin(s) interne(s) ignoré(s)`);
      skipped += archDirectives.length;
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    broadcastProgress({
      currentTask: `📦 [${archiveIdx}/${byArchive.size}] ${archive.Name} — ${archDirectives.length} fichier(s)`,
      stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
    });

    // ── Archive = BSA (fichiers originaux du jeu, GameFileSource) ───────────
    // Extraction uniquement parce que le manifeste demande un chemin interne précis.
    // 7z ne lit pas le format BSA de Bethesda → lecteur natif (server/bsa.js)
    if (/\.bsa$/i.test(archive.localPath || '')) {
      let bsa = null;
      let handled = 0, bsaOk = 0;
      try {
        bsa = openBsa(archive.localPath);
        for (const d of archDirectives) {
          await jobControl.waitIfPaused(signal);
          handled++;
          processedBytes += d.Size || 0;
          const outputPath = resolveDirectivePath(d.To, destRoot);
          if (!outputPath) { skipped++; continue; }
          try {
            const buf = bsa.readFile(d.SourcePath || d.From || '');
            if (!buf) { debugLog(`Absent du BSA : ${archive.Name} :: ${d.SourcePath} (→ ${d.To})`); errors++; continue; }
            await deliver(d, outputPath, { buffer: buf });
            bsaOk++; processed++;
          } catch (e) { debugLog(`Erreur BSA : ${archive.Name} :: ${d.SourcePath}`, e?.message); errors++; }
        }
      } catch (bsaErr) {
        if (signal?.aborted) throw bsaErr;
        broadcastLog('warn', `  ⚠ BSA illisible : ${archive.Name} — ${String(bsaErr.message).slice(0, 160)}`);
        skipped += archDirectives.length - handled;
      } finally {
        bsa?.close();
      }
      if (bsaOk > 0) broadcastLog('success', `  ✓ ${archive.Name} : ${bsaOk}/${archDirectives.length} fichier(s) extrait(s)`);
      else broadcastLog('warn', `  ✗ ${archive.Name} : 0/${archDirectives.length} extrait(s) — vérifiez l'archive`);
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    if (!sevenZipBin) {
      for (const d of archDirectives) {
        const out = resolveDirectivePath(d.To, destRoot);
        if (out) { makeDirResilient(path.dirname(out)); if (!fs.existsSync(out)) fs.writeFileSync(out, '', 'utf-8'); }
        skipped++;
      }
      if (onProgress) onProgress(processed + skipped + errors, total);
      continue;
    }

    // ── BATCH EXTRACTION — one call per archive ───────────────────────────────
    const tmpDir = path.join(os.tmpdir(), `mwab_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    let archiveProcessed = 0;
    let archiveErrors = 0;
    let usedUnar = false; // set to true when unar is used instead of 7z (RAR5)
    const nestedBsa = new Map(); // bsaPath → open BSA reader (depth-3 directives)
    const nestedArchives = new Map(); // innerPath → Map(chemin normalisé → fichier extrait)

    let heartbeatActive = true;
    let heartbeat = setInterval(() => {
      if (!heartbeatActive) return;
      const archiveSizeMo = archive.Size ? `${(archive.Size / 1024 / 1024).toFixed(0)} Mo` : '';
      broadcastProgress({
        currentTask: `⚙️ [${archiveIdx}/${byArchive.size}] Décompression : ${archive.Name} ${archiveSizeMo ? `(${archiveSizeMo})` : ''}`,
        stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
        processedItems: processed + skipped + errors,
        processedBytes,
      });
    }, 3000);

    try {
      // Chaque chemin est demandé sous ses deux formes : certains zip faits sous Windows
      // nomment leurs entrées « Data\\SKSE\\x.dll » (antislash dans le nom), que 7zz
      // garde tel quel et ne fait pas correspondre à « Data/SKSE/x.dll ».
      const neededPaths = [...new Set(
        archDirectives.flatMap(d => {
          const fwd = (d.SourcePath || d.From || '').replace(/\\/g, '/').trim();
          return fwd ? [fwd, fwd.replace(/\//g, '\\')] : [];
        })
      )];

      const listFilePath = `${tmpDir}.list`;
      fs.writeFileSync(listFilePath, neededPaths.join('\n'), 'utf8');


      // Helper: run unar for full RAR extraction then resolve/reject
      const runUnar = (outputDir) => new Promise((res2, rej2) => {
        const proc = spawn(unarBin, [
          '-D',        // preserve structure but skip archive root folder
          '-o', outputDir,
          '-f',        // force overwrite
          archive.localPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr2 = '';
        proc.stdout.resume();
        proc.stderr.on('data', (d) => { stderr2 += d.toString(); });
        const t = setTimeout(() => { proc.kill('SIGKILL'); rej2(new Error(`Timeout unar pour ${archive.Name}`)); }, 600000);
        proc.on('error', (err) => { clearTimeout(t); rej2(err); });
        proc.on('close', (c) => {
          clearTimeout(t);
          if (c === 0) res2();
          else rej2(new Error(`unar exit ${c}: ${stderr2.slice(0, 200)}`));
        });
      });

      await new Promise((resolve, reject) => {
        const isRar = archive.localPath && archive.localPath.toLowerCase().endsWith('.rar');

        // ── RAR : utiliser unar directement (7z ne supporte pas RAR5) ────────
        if (isRar && unarBin) {
          usedUnar = true;
          broadcastLog('info', `  ↩ Archive RAR → unar : ${archive.Name}`);
          runUnar(tmpDir).then(resolve).catch(reject);
          return;
        }

        // ── 7z : extraction sélective (listfile) ─────────────────────────────
        const proc = spawn(sevenZipBin, [
          'x', '-y',
          `-o${tmpDir}`,
          archive.localPath,
          '-aoa',
          '-ssc-',          // case-insensitive matching
          `@${listFilePath}`,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stdout.resume();
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`Timeout 10min pour ${archive.Name}`)); }, 600000);

        proc.on('error', (err) => { clearTimeout(timer); reject(err); });
        proc.on('close', (code) => {
          clearTimeout(timer);
          // code 0 = OK, code 1 = warnings (still OK)
          if (code === 0 || code === 1) { resolve(); return; }

          // Exit 2 = Unsupported Method (RAR5 avec compression propriétaire)
          // Fallback unar — unar ne supporte pas le listfile, on extrait tout puis on filtre
          if (code === 2 && unarBin && stderr.includes('Unsupported Method')) {
            broadcastLog('info', `  ↩ Fallback unar pour ${archive.Name} (RAR5)...`);
            usedUnar = true;
            runUnar(tmpDir).then(resolve).catch(reject);
            return;
          }

          // Extraction sélective échouée (paths non trouvés, archive corrompue…)
          // Tenter une extraction complète — 7z pour .7z/.zip, unar pour .rar
          if (code !== 0 && code !== 1) {
            broadcastLog('info', `  ↩ Extraction sélective failed (${code}), tentative extraction complète…`);
            if (isRar && unarBin) {
              usedUnar = true;
              runUnar(tmpDir).then(resolve).catch(reject);
            } else {
              const proc3 = spawn(sevenZipBin, [
                'x', '-y', `-o${tmpDir}`, archive.localPath, '-aoa',
              ], { stdio: ['ignore', 'pipe', 'pipe'] });
              let stderr3 = '';
              proc3.stdout.resume();
              proc3.stderr.on('data', (d) => { stderr3 += d.toString(); });
              const timer3 = setTimeout(() => { proc3.kill('SIGKILL'); reject(new Error(`Timeout (fallback) pour ${archive.Name}`)); }, 600000);
              proc3.on('error', (err) => { clearTimeout(timer3); reject(err); });
              proc3.on('close', (c3) => {
                clearTimeout(timer3);
                if (c3 === 0 || c3 === 1) resolve();
                else reject(new Error(`7z exit ${c3}: ${stderr3.slice(0, 300)}`));
              });
            }
            return;
          }

          reject(new Error(`7z exit ${code}: ${stderr.slice(0, 300)}`));
        });
      });
      // Cleanup listfile
      try { fs.unlinkSync(listFilePath); } catch {}

      heartbeatActive = false;
      clearInterval(heartbeat);

      // Build lookup map: relative path (normalized) → absolute extracted path
      const extractedFiles = new Map();
      const walkTmp = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) {
            walkTmp(fp, rel);
          } else {
            // Store both slash styles for robust lookup
            const normalized = rel.replace(/\\/g, '/').toLowerCase();
            extractedFiles.set(normalized, fp);
            // Also store just the basename for flat extractions
            extractedFiles.set(e.name.toLowerCase(), fp);
          }
        }
      };
      try { walkTmp(tmpDir, ''); } catch {}

      // Copy each needed file to its final destination
      for (const d of archDirectives) {
        try { await jobControl.waitIfPaused(signal); } catch (e) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw e; }

        const outputPath = resolveDirectivePath(d.To, destRoot);
        if (!outputPath) { skipped++; processedBytes += d.Size || 0; continue; }

        const srcRaw = d.SourcePath || d.From || '';
        const srcFwd = srcRaw.replace(/\\/g, '/').toLowerCase();

        // ── DEPTH-3: file is inside a BSA which is inside the archive ─────
        if (d.BsaInternalPath) {
          // The BSA was extracted into tmpDir via SourcePath
          const bsaPath = extractedFiles.get(srcFwd) || extractedFiles.get(path.basename(srcRaw).toLowerCase());
          if (bsaPath && fs.existsSync(bsaPath) && !looksLikeBsa(bsaPath)) {
            // ── Niveau 3 dans une archive imbriquée (zip/7z/rar dans le zip) ──
            try {
              let files = nestedArchives.get(bsaPath);
              if (!files) {
                files = await extractNestedArchive(sevenZipBin, bsaPath, `${tmpDir}_nested${nestedArchives.size}`);
                nestedArchives.set(bsaPath, files);
              }
              const innerFwd = d.BsaInternalPath.replace(/\\/g, '/').toLowerCase();
              const innerFile = files.get(innerFwd);
              if (innerFile) {
                await deliver(d, outputPath, { file: innerFile });
                archiveProcessed++; processed++; processedBytes += d.Size || 0;
              } else {
                debugLog(`Introuvable dans l'archive imbriquée : ${archive.Name} :: ${srcRaw} :: ${d.BsaInternalPath}`);
                archiveErrors++; errors++; processedBytes += d.Size || 0;
              }
            } catch (nestErr) {
              broadcastLog('warn', `  ⚠ Archive imbriquée ${path.basename(srcRaw)} : ${String(nestErr.message).slice(0, 120)}`);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else if (bsaPath && fs.existsSync(bsaPath)) {
            try {
              let nb = nestedBsa.get(bsaPath);
              if (!nb) { nb = openBsa(bsaPath); nestedBsa.set(bsaPath, nb); }
              const bsaInternal = d.BsaInternalPath.replace(/\\/g, '/');
              const buf = nb.readFile(bsaInternal);
              if (buf) {
                await deliver(d, outputPath, { buffer: buf });
                archiveProcessed++; processed++; processedBytes += d.Size || 0;
              } else {
                broadcastLog('warn', `  ⚠ BSA: fichier introuvable après extraction: ${bsaInternal}`);
                archiveErrors++; errors++; processedBytes += d.Size || 0;
              }
            } catch (bsaErr) {
              broadcastLog('warn', `  ⚠ BSA extract: ${bsaErr.message.slice(0, 120)}`);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else {
            broadcastLog('warn', `  ⚠ BSA introuvable dans tmpDir: ${srcRaw}`);
            archiveErrors++; errors++; processedBytes += d.Size || 0;
          }
        } else {
          // ── DEPTH-2: file is directly in the archive ────────────────────
          // Only use exact path match — NO basename fallback (prevents wrong large files being copied)
          const foundPath = extractedFiles.get(srcFwd);

          if (foundPath && fs.existsSync(foundPath)) {
            try {
              await deliver(d, outputPath, { file: foundPath });
              archiveProcessed++; processed++; processedBytes += d.Size || 0;
            } catch (copyErr) {
              debugLog(`Copie impossible : ${archive.Name} :: ${srcRaw} → ${d.To}`, copyErr?.message);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else {
            debugLog(`Introuvable après extraction : ${archive.Name} :: ${srcRaw} (→ ${d.To})`);
            archiveErrors++; errors++; processedBytes += d.Size || 0;
          }
        }

        if ((processed + skipped + errors) % 200 === 0 && onProgress) {
          onProgress(processed + skipped + errors, total, processedBytes);
          broadcastProgress({
            currentTask: `📁 [${archiveIdx}/${byArchive.size}] ${archive.Name} — ${archiveProcessed}/${archDirectives.length} fichiers`,
            stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
          });
        }
      }

    } catch (batchErr) {
      heartbeatActive = false;
      clearInterval(heartbeat);
      broadcastLog('warn', `  ⚠ Erreur batch ${archive.Name} : ${batchErr.message.slice(0, 200)}`);
      debugLog(`Erreur batch complète : ${archive.Name} (${archive.localPath})`, batchErr?.stack || batchErr?.message);
      skipped += archDirectives.length - archiveProcessed;
    } finally {
      for (const nb of nestedBsa.values()) nb.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      for (let i = 0; i < nestedArchives.size; i++) {
        try { fs.rmSync(`${tmpDir}_nested${i}`, { recursive: true, force: true }); } catch {}
      }
    }

    if (archiveProcessed > 0) {
      broadcastLog('success', `  ✓ ${archive.Name} : ${archiveProcessed}/${archDirectives.length} fichier(s) extrait(s)`);
    } else if (archiveErrors > 0) {
      broadcastLog('warn', `  ✗ ${archive.Name} : 0/${archDirectives.length} extrait(s) — vérifiez l'archive`);
    }

    if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);

    // Periodic /tmp purge every 10 archives to prevent disk saturation
    if (archiveIdx % 10 === 0) purgeMwabTmpDirs();
  }

  // ── 2 bis. TRANSFORMED TEXTURES : conversion texconv en lot ───────────
  if (textureQueue?.alreadyOk) {
    broadcastLog('info', `🖼 ${textureQueue.alreadyOk} texture(s) TransformedTexture déjà au bon format — copiées telles quelles.`);
  }
  if (textureQueue && textureQueue.size > 0) {
    const n = textureQueue.size;
    broadcastLog('info', `🖼 Conversion de ${n} texture(s) (TransformedTexture, ${textureQueue.groups.size} format(s) cible(s)) avec texconv…`);
    let lastLog = 0;
    const t0 = Date.now();
    const r = await textureQueue.run({
      signal,
      onProgress: (done, tot) => {
        broadcastProgress({ currentTask: `🖼 Conversion des textures : ${done}/${tot}`, stagePercent: Math.round((done / tot) * 100) });
        const pct = Math.floor((done / tot) * 10) * 10;
        if (pct > lastLog && done < tot) { lastLog = pct; broadcastLog('info', `  🖼 Textures : ${done}/${tot} (${pct} %)`); }
      },
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    const names = (list) => list.slice(0, 5).map((f) => path.basename(f.to.replace(/\\/g, '/'))).join(', ') + (list.length > 5 ? '…' : '');
    broadcastLog('success', `  ✓ ${r.converted}/${n} texture(s) convertie(s) en ${secs} s.`);
    if (r.failed.length > 0) {
      broadcastLog('warn', `  ⚠ ${r.failed.length} texture(s) non convertie(s) — source copiée telle quelle : ${names(r.failed)}`);
      for (const f of r.failed) debugLog(`texconv échec : ${f.to} — ${f.reason}`);
    }
    if (r.sizeMismatch.length > 0) {
      broadcastLog('warn', `  ⚠ ${r.sizeMismatch.length} texture(s) convertie(s) d'une taille différente du manifeste : ${names(r.sizeMismatch)}`);
      for (const f of r.sizeMismatch) debugLog(`texconv taille : ${f.to} — ${f.actual} o au lieu de ${f.expected} o`);
    }
  }

  // ── 3. BILAN : fichiers originaux du jeu & patchs OctoDiff ─────────────
  if (gameDirectCopies > 0) {
    broadcastLog('success', `🎮 ${gameDirectCopies} fichier(s) original(aux) du jeu copié(s) directement (sans décompression).`);
  }
  if (modDirectCopies > 0) {
    broadcastLog('info', `📄 ${modDirectCopies} fichier(s) copié(s) tel(s) quel(s) depuis DOWNLOADS (téléchargement direct, sans archive).`);
  }
  if (transformedTextures > 0) {
    broadcastLog('warn', `🖼 ${transformedTextures} texture(s) transformée(s) : texconv introuvable, texture source copiée telle quelle (non redimensionnée / recompressée).`);
  }
  if (remappedFiles > 0) {
    broadcastLog('info', `📝 ${remappedFiles} fichier(s) de configuration adapté(s) à cette machine (chemins remplacés).`);
  }
  if (remapUnresolved > 0) {
    broadcastLog('warn', `⚠ ${remapUnresolved} chemin(s) non résolu(s) dans les fichiers de configuration (dossier jeu / téléchargements non renseigné).`);
  }
  if (patchedDirectives.length > 0) {
    broadcastLog('info', `🔧 Patchs OctoDiff : ${patchStats.patched} appliqué(s), ${patchStats.already} déjà à jour, ${patchStats.fallback + patchStats.noPatch} non applicable(s).`);
    if (patchFallbackNames.length > 0) {
      broadcastLog('warn', `  ⚠ Version du fichier de base différente — fichier conservé sans patch : ${patchFallbackNames.slice(0, 10).join(', ')}${patchFallbackNames.length > 10 ? ` (+${patchFallbackNames.length - 10})` : ''}`);
    }
    if (patchStats.noPatch > 0) {
      broadcastLog('warn', `  ⚠ ${patchStats.noPatch} patch(s) absent(s) du .wabbajack — fichier de base conservé.`);
    }
  }

  // ── 4. OTHER DIRECTIVES ──────────────────────────────────────────────
  const bsaStaging = path.join(destRoot, BSA_STAGING_DIR);
  for (const d of otherDirectives) {
    await jobControl.waitIfPaused(signal);
    const type = (d.$type || '').toLowerCase();
    if (type.includes('createbsa')) {
      const bsaName = path.basename((d.To || '').replace(/\\/g, '/'));
      try {
        const outFile = resolveDirectivePath(d.To, destRoot);
        if (!outFile) throw new Error('chemin de destination invalide');
        const srcDir = path.join(bsaStaging, String(d.TempID || ''));
        if (!d.TempID || !fs.existsSync(srcDir)) throw new Error('fichiers sources absents (TempID introuvable)');
        const rels = Array.isArray(d.FileStates) ? d.FileStates.map((f) => f.Path).filter(Boolean) : undefined;
        const r = createBsa(srcDir, outFile, d.State || {}, rels && rels.length ? rels : undefined);
        broadcastLog('success', `  ✓ BSA créé : ${bsaName} (${r.files} fichiers)`);
        if (r.skipped.length > 0) broadcastLog('warn', `  ⚠ BSA ${bsaName} : ${r.skipped.length} fichier(s) manquant(s) ignoré(s)`);
        processed++;
      } catch (e) {
        broadcastLog('warn', `  ⚠ CreateBSA échoué (${bsaName} : ${String(e.message || e).slice(0, 160)})`);
        debugLog(`CreateBSA échoué : ${d.To}`, e?.stack || e?.message);
        errors++;
      }
      continue;
    }
    skipped++;
  }
  try { fs.rmSync(bsaStaging, { recursive: true, force: true }); } catch { /* */ }

  // ── POST-INSTALL CLEANUP ─────────────────────────────────────────────
  // Remove MO2-only files that have no function in a standalone Data directory
  broadcastLog('info', `🧹 Nettoyage post-installation...`);
  let cleanedCount = 0;
  const cleanupExts = new Set(['.modgroup', '.modgroups']);
  const dataDir = path.join(destRoot, 'Data');

  function cleanupDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanupDir(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (cleanupExts.has(ext)) {
          try { fs.unlinkSync(full); cleanedCount++; } catch { /* ignore */ }
        }
      }
    }
  }

  try {
    if (fs.existsSync(dataDir)) cleanupDir(dataDir);
    // Also check root in case some slipped through
    if (fs.existsSync(destRoot)) {
      for (const entry of fs.readdirSync(destRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (cleanupExts.has(ext)) {
            try { fs.unlinkSync(path.join(destRoot, entry.name)); cleanedCount++; } catch { }
          }
        }
      }
    }
    if (cleanedCount > 0) broadcastLog('success', `  ✓ ${cleanedCount} fichier(s) .modgroups supprimés (métadonnées MO2)`);
    else broadcastLog('info', `  ✓ Aucun fichier .modgroups à nettoyer`);
  } catch (cleanErr) {
    broadcastLog('warn', `  ⚠ Erreur nettoyage .modgroups : ${cleanErr.message}`);
  }

  return { processed, skipped, errors };
}

// ──────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), platform: process.platform, arch: process.arch, version: '3.0.0', sevenZip: find7z() || 'NOT FOUND — brew install sevenzip' });
});

app.post('/api/system/pick-folder', (req, res) => {
  const title = (req.body.title || 'Sélectionnez un dossier').replace(/"/g, '\\"');
  let defClause = '';
  if (req.body.defaultPath && fs.existsSync(req.body.defaultPath)) {
    defClause = `default location (POSIX file "${req.body.defaultPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" as alias)`;
  }
  const script = `try\n  set chosen to (choose folder with prompt "${title}" ${defClause})\non error errMsg number errNum\n  if errNum is -128 then\n    return "CANCELLED"\n  end if\nend try\nreturn POSIX path of chosen`;
  execFile('/usr/bin/osascript', ['-e', script], { timeout: 120000 }, (err, stdout) => {
    if (err) return res.json({ cancelled: err.message.includes('-128'), path: null });
    const out = stdout.trim();
    res.json({ cancelled: out === 'CANCELLED', path: out === 'CANCELLED' ? null : out });
  });
});

app.post('/api/system/pick-file', (req, res) => {
  const title = (req.body.title || 'Sélectionnez un fichier .wabbajack').replace(/"/g, '\\"');
  const script = `try\n  set chosen to (choose file with prompt "${title}")\n  return POSIX path of chosen\non error errMsg number errNum\n  if errNum is -128 then\n    return "CANCELLED"\n  else\n    return "ERROR: " & errMsg\n  end if\nend try`;
  execFile('/usr/bin/osascript', ['-e', script], { timeout: 120000 }, (err, stdout) => {
    if (err) return res.json({ cancelled: err.message.includes('-128'), path: null });
    const out = stdout.trim();
    if (out === 'CANCELLED') return res.json({ cancelled: true, path: null });
    if (out.startsWith('ERROR:')) return res.json({ cancelled: false, path: null, error: out.slice(6).trim() });
    res.json({ cancelled: false, path: out });
  });
});

app.get('/api/system/clipboard', (req, res) => {
  execFile('/usr/bin/pbpaste', [], (err, stdout) => res.json({ text: err ? '' : stdout.trim() }));
});

app.post('/api/system/open-folder', (req, res) => {
  const p = req.body.path;
  if (p && fs.existsSync(p)) { execFile('/usr/bin/open', [p], () => {}); return res.json({ success: true }); }
  res.status(404).json({ error: 'Dossier introuvable' });
});

app.post('/api/system/open-url', (req, res) => {
  const { url } = req.body || {};
  if (!url || !String(url).startsWith('http')) return res.status(400).json({ error: 'URL invalide' });
  execFile('/usr/bin/open', [url], () => {});
  res.json({ success: true });
});

// ── Translation endpoint (MyMemory free API, no key required) ────────────────
const LANG_PAIRS = { fr: 'en|fr', es: 'en|es', it: 'en|it', de: 'en|de', pt: 'en|pt' };

const TRANSLATE_CHUNK_BYTES = 400;       // MyMemory : 500 octets max (pas caractères) par requête
const TRANSLATE_MAX_CHARS = 20000;        // au-delà : texte tronqué (protège la mémoire et le quota)
const TRANSLATE_CACHE_MAX = 1000;         // entrées max du cache (LRU simple)
const TRANSLATE_MAX_BATCH = 100;          // textes max par requête /api/translate
const TRANSLATE_CONCURRENCY = 4;
const TRANSLATE_MAX_RESPONSE = 256 * 1024;
const TRANSLATE_ERROR_RE = /QUERY LENGTH LIMIT|MAX ALLOWED QUERY|MYMEMORY WARNING|INVALID (LANGUAGE|EMAIL)|PLEASE SELECT TWO DISTINCT|NO CONTENT/i;

function cacheSet(key, value) {
  if (translateCache.has(key)) translateCache.delete(key);
  translateCache.set(key, value);
  while (translateCache.size > TRANSLATE_CACHE_MAX) translateCache.delete(translateCache.keys().next().value);
}

/** Découpe un texte en unités traduisibles ≤ maxBytes (phrases), les sauts de ligne restent intacts. */
function splitForTranslation(text, maxBytes = TRANSLATE_CHUNK_BYTES) {
  const parts = [];   // { text, translate }
  let buf = '';
  const flush = () => { if (buf.trim()) parts.push({ text: buf, translate: true }); else if (buf) parts.push({ text: buf, translate: false }); buf = ''; };
  const push = (unit) => {
    if (Buffer.byteLength(buf + unit) > maxBytes) flush();
    buf += unit;
  };
  for (const seg of text.split(/(\n+)/)) {
    if (!seg) continue;
    if (/^\n+$/.test(seg)) { flush(); parts.push({ text: seg, translate: false }); continue; }
    for (const sentence of seg.match(/[^.!?…]*[.!?…]+\s*|[^.!?…]+\s*/g) || [seg]) {
      if (Buffer.byteLength(sentence) <= maxBytes) { push(sentence); continue; }
      // phrase trop longue : découpe par mots, puis par caractères si un « mot » est géant
      for (const word of sentence.split(/(?<=\s)/)) {
        if (Buffer.byteLength(word) <= maxBytes) { push(word); continue; }
        for (let i = 0; i < word.length; i += 100) push(word.slice(i, i + 100));
      }
    }
  }
  flush();
  return parts;
}

/** Une requête MyMemory ; retourne le texte d'origine en cas d'erreur (jamais le message d'erreur de l'API). */
function translateChunk(chunk, pair) {
  return new Promise((resolve) => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${pair}`;
    const req = https.get(url, { timeout: 8000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      let size = 0; const bufs = [];
      r.on('data', (c) => {
        size += c.length;
        if (size > TRANSLATE_MAX_RESPONSE) { r.destroy(); return resolve(null); }
        bufs.push(c);
      });
      r.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(bufs).toString('utf8'));
          const t = json?.responseData?.translatedText;
          const status = Number(json?.responseStatus);
          if (typeof t !== 'string' || !t || (status && status !== 200) || TRANSLATE_ERROR_RE.test(t)) return resolve(null);
          resolve(t);
        } catch { resolve(null); }
      });
      r.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function translateText(text, langTo) {
  if (typeof text !== 'string' || !text.trim() || langTo === 'en') return text;
  const pair = LANG_PAIRS[langTo];
  if (!pair) return text;
  const input = text.length > TRANSLATE_MAX_CHARS ? text.slice(0, TRANSLATE_MAX_CHARS) : text;
  const cacheKey = `${langTo}:${input}`;
  if (translateCache.has(cacheKey)) return translateCache.get(cacheKey);

  let allOk = true;
  const out = [];
  for (const part of splitForTranslation(input)) {
    if (!part.translate) { out.push(part.text); continue; }
    const key = `${langTo}:${part.text}`;
    let t = translateCache.get(key);
    if (t === undefined) {
      t = await translateChunk(part.text.trim(), pair);
      if (t === null) { allOk = false; out.push(part.text); continue; }
      // conserve les espaces de bord d'origine
      t = part.text.match(/^\s*/)[0] + t + part.text.match(/\s*$/)[0];
      cacheSet(key, t);
    }
    out.push(t);
  }
  const result = out.join('');
  if (allOk) cacheSet(cacheKey, result);   // un échec partiel n'est pas mis en cache (nouvel essai possible)
  return result;
}

/** map avec concurrence bornée (évite des centaines de requêtes simultanées). */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return results;
}

app.post('/api/translate', async (req, res) => {
  const { texts, text, lang } = req.body || {};
  if (!lang || lang === 'en') {
    // No translation needed
    if (Array.isArray(texts)) return res.json({ results: texts });
    return res.json({ result: text || '' });
  }
  if (typeof lang !== 'string' || !LANG_PAIRS[lang]) return res.status(400).json({ error: 'Langue non prise en charge.' });
  try {
    if (Array.isArray(texts)) {
      const batch = texts.slice(0, TRANSLATE_MAX_BATCH).map((t) => (typeof t === 'string' ? t : ''));
      const results = await mapLimit(batch, TRANSLATE_CONCURRENCY, (t) => translateText(t, lang));
      return res.json({ results });
    }
    const result = await translateText(typeof text === 'string' ? text : '', lang);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/system/detect-skyrim-at', (req, res) => {
  const { gamePath, wabbajackGameType } = req.body;
  const detection = detectSkyrimAtPath(gamePath);
  const expected = wabbajackGameType ? getExpectedSkyrimVersion(wabbajackGameType) : null;
  let compatibility = null;
  if (detection.found && expected) {
    const ins = detection.edition, req_ = expected.edition;
    if (req_ === 'SE_OR_AE') compatibility = { compatible: true, message: `Skyrim ${ins} détecté — compatible SE/AE`, level: 'ok' };
    else if (ins === req_) compatibility = { compatible: true, message: `✓ Version compatible : ${ins} (${expected.versionHint})`, level: 'ok' };
    else if (req_ === 'SE' && ins === 'AE') compatibility = { compatible: false, message: `⚠ La modlist cible SE (1.5.97) mais vous avez AE (1.6.x). Incompatibilités SKSE possibles.`, level: 'warn' };
    else compatibility = { compatible: false, message: `⚠ La modlist cible AE (1.6.x) mais vous avez SE (1.5.97). Risque de crash.`, level: 'error' };
  }
  res.json({ ...detection, expected, compatibility });
});

app.get('/api/system/detect-skyrim', (req, res) => {
  const home = os.homedir();
  const paths = [
    path.join(home, 'Library/Application Support/Steam/steamapps/common/Skyrim Special Edition'),
    '/Volumes/SKYRIM/GAMES/Skyrim Special Edition',
    path.join(home, 'Library/Application Support/com.isaacmarovitz.Whisky/Libraries/Bottles/Skyrim/drive_c/Program Files (x86)/Steam/steamapps/common/Skyrim Special Edition'),
    path.join(home, 'Library/Application Support/CrossOver/Bottles/Skyrim/drive_c/Program Files (x86)/Steam/steamapps/common/Skyrim Special Edition'),
  ];
  for (const p of paths) {
    const r = detectSkyrimAtPath(p);
    if (r.found) return res.json({ ...r, path: p, isValid: true });
  }
  res.json({ found: false, isValid: false, edition: 'Unknown', path: '', validationIssues: ['Aucune installation Skyrim détectée.'] });
});

// Chemin réel d'un .wabbajack déposé (nom + taille), pour l'analyser sur place au lieu de l'envoyer
app.post('/api/wabbajack/locate', async (req, res) => {
  const { name, size } = req.body || {};
  try { res.json({ path: await locateWabbajack(String(name || ''), Number(size) || 0) }); }
  catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

app.post('/api/wabbajack/inspect-path', async (req, res) => {
  const { filePath } = req.body || {};
  if (typeof filePath !== 'string' || !filePath || !fs.existsSync(filePath)) return res.status(400).json({ error: 'Fichier .wabbajack introuvable' });
  try {
    res.json(await inspectWabbajack(filePath));
  } catch (err) { res.status(err.status || 500).json({ error: String(err.message || err) }); }
});

// ── Upload endpoint — browser drag-and-drop / file input ———————————————
// Saves to /tmp/mabbajack-uploads/<original-name> so localFilePath is usable
const wabUploadDir = path.join(os.tmpdir(), 'mabbajack-uploads');
fs.mkdirSync(wabUploadDir, { recursive: true });
const wabUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, wabUploadDir),
    // basename : le nom vient du client, pas de composants de chemin (../)
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname || 'modlist.wabbajack').replace(/[^\w.\- ()\[\]]/g, '_')),
  }),
  limits: { fileSize: 32 * 1024 * 1024 * 1024 }, // 32 Go (les modlists dépassent 3 Go)
});

app.post('/api/wabbajack/inspect-upload', (req, res) => {
  wabUpload.single('wabbajack')(req, res, async (upErr) => {
    if (upErr) return res.status(upErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: String(upErr.message || upErr) });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    try {
      res.json(await inspectWabbajack(req.file.path));
    } catch (err) { res.status(err.status || 500).json({ error: String(err.message || err) }); }
  });
});

// Mods optionnels (désactivés dans le profil MO2), groupés par séparateur
const optionsCache = new Map();
app.post('/api/wabbajack/options', async (req, res) => {
  const { filePath } = req.body || {};
  if (typeof filePath !== 'string' || !/\.wabbajack$/i.test(filePath) || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Fichier .wabbajack introuvable' });
  }
  try {
    const st = fs.statSync(filePath);
    const key = `${filePath}:${st.mtimeMs}:${st.size}`;
    if (optionsCache.has(key)) return res.json(optionsCache.get(key));
    const raw = await loadRawModlist(filePath);
    const out = await buildOptions(raw, (n) => readZipEntry(filePath, n));
    optionsCache.clear();
    optionsCache.set(key, out);
    res.json(out);
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// Liste déjà installée ? Compare le .wabbajack chargé à l'installation trouvée dans READY TO PLAY.
app.post('/api/wabbajack/compare-installed', async (req, res) => {
  const { filePath, destPath, previousFile } = req.body || {};
  if (typeof filePath !== 'string' || !/\.wabbajack$/i.test(filePath) || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Fichier .wabbajack introuvable' });
  }
  if (typeof destPath !== 'string' || !destPath.trim()) return res.json({ status: 'not-installed', installed: null });
  if (previousFile !== undefined && (typeof previousFile !== 'string' || !/\.wabbajack$/i.test(previousFile) || !fs.existsSync(previousFile))) {
    return res.status(400).json({ error: 'Ancienne version .wabbajack introuvable' });
  }
  try {
    const raw = await loadRawModlist(filePath);
    const r = await compareWithInstalled(filePath, path.resolve(destPath.trim()), { raw, previousFile });
    // Options de l'installation existante (enregistrées, sinon déduites du disque) : reprises pour la mise à jour.
    // La détection des dossiers de jeu est globale : pas pendant une installation.
    if (r.installed && !currentInstallJob.active) {
      try {
        const opts = await buildOptions(raw, (n) => readZipEntry(filePath, n));
        const dirs = (raw.Directives || raw.directives || []).map((d) => ({ To: String(d.To || '').replace(/\\/g, '/') }));
        setGameRootFolders(detectGameRootFolders(dirs));
        const snap = readSnapshot(r.installed.dir);
        r.previousOptions = inferOptions({ raw, options: opts, resolve: (d) => resolveDirectivePath(d.To, r.installed.dir), saved: snap?.options || null, previous: snap?.manifest || null });
      } catch { /* options non retrouvées : valeurs par défaut */ }
    }
    res.json(r);
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// Installation antérieure à l'instantané : la déclarer comme installée depuis ce .wabbajack
// (seuls les fichiers présents avec la taille attendue sont retenus).
app.post('/api/wabbajack/adopt-installed', async (req, res) => {
  const { filePath, dir } = req.body || {};
  if (typeof filePath !== 'string' || !/\.wabbajack$/i.test(filePath) || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Fichier .wabbajack introuvable' });
  }
  if (typeof dir !== 'string' || !fs.existsSync(path.join(dir, 'README_READY_TO_PLAY.txt'))) {
    return res.status(400).json({ error: 'Installation introuvable' });
  }
  if (currentInstallJob.active) return res.status(409).json({ error: 'Une installation est en cours.' });
  try {
    const raw = await loadRawModlist(filePath);
    const dirs = (raw.Directives || raw.directives || []).map((d) => ({ $type: d.$type || '', To: String(d.To || '').replace(/\\/g, '/'), Size: d.Size || 0 }));
    setGameRootFolders(detectGameRootFolders(dirs));
    const r = await writeSnapshot(dir, { raw, wabbajackPath: filePath, installed: dirs, resolve: (d) => resolveDirectivePath(d.To, dir) });
    res.json({ ok: true, files: r.files, total: r.total });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// Download + parse a .wabbajack from a CDN URL (from gallery links.download)
app.post('/api/wabbajack/install-from-url', async (req, res) => {
  const { url, title } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url manquant' });

  const safeName = (title || 'modlist').replace(/[^a-zA-Z0-9._-]/g, '_');
  const destFile = path.join(os.tmpdir(), `mwabbajack-uploads/${safeName}.wabbajack`);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const partFile = `${destFile}.part`;

  try {
    broadcastProgress({ currentTask: `⬇️ Téléchargement de ${safeName}.wabbajack…`, stagePercent: 0 });
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3600000);
    let dlRes;
    try { dlRes = await fetch(url, { signal: ctrl.signal }); } catch (e) { clearTimeout(timeout); throw e; }
    if (!dlRes.ok) { clearTimeout(timeout); return res.status(502).json({ error: `Téléchargement échoué : HTTP ${dlRes.status}` }); }

    // Écriture en flux sur disque (jamais tout en mémoire : > 2 Go possible)
    const totalSize = parseInt(dlRes.headers.get('content-length') || '0', 10);
    let downloaded = 0;
    const out = fs.createWriteStream(partFile);
    try {
      for await (const chunk of dlRes.body) {
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        downloaded += chunk.length;
        if (totalSize > 0) {
          const pct = Math.round((downloaded / totalSize) * 100);
          broadcastProgress({ currentTask: `⬇️ Téléchargement ${safeName} — ${pct}% (${(downloaded/1024/1024).toFixed(0)} Mo / ${(totalSize/1024/1024).toFixed(0)} Mo)`, stagePercent: pct });
        }
      }
      await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); });
    } catch (e) {
      out.destroy();
      try { fs.unlinkSync(partFile); } catch { /* absent */ }
      throw e;
    } finally { clearTimeout(timeout); }
    fs.renameSync(partFile, destFile);
    broadcastProgress({ currentTask: `🔍 Analyse de ${safeName}.wabbajack…`, stagePercent: 100 });

    res.json(await inspectWabbajack(destFile, safeName));
  } catch (err) { res.status(err.status || 500).json({ error: String(err.message || err) }); }
});

app.get('/api/modlists', async (req, res) => {
  const now = Date.now();
  if (cachedModlists && now - lastModlistsFetch < 900000) return res.json(enrichCatalog(cachedModlists));

  const REPOS_URL = 'https://raw.githubusercontent.com/wabbajack-tools/mod-lists/master/repositories.json';
  const FEATURED_URL = 'https://raw.githubusercontent.com/wabbajack-tools/mod-lists/master/modlists.json';

  async function fetchJson(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { clearTimeout(t); throw e; }
  }

  try {
    // Step 1 — fetch repositories index
    const repos = await fetchJson(REPOS_URL, 10000);

    // Step 2 — fetch all repos in parallel (cap at 8s each, ignore failures)
    const repoUrls = Object.values(repos);
    const results = await Promise.allSettled(
      repoUrls.map((url) => fetchJson(url, 8000))
    );

    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        all.push(...r.value);
      }
    }

    // Deduplicate by machineURL (some lists appear in multiple repos)
    const seen = new Set();
    const deduped = all.filter((m) => {
      const key = m.links?.machineURL || m.links?.download || (m.title + m.author);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Enrich each entry with computed skyrimVersion for reliable client-side filtering
    function classifySkyrimVersion(m) {
      const game = (m.game || '').toLowerCase().replace(/[\s_-]/g, '');
      if (!game.startsWith('skyrim') && game !== 'skyrim') return 'other';
      if (game.includes('vr')) return 'vr';
      if (game === 'skyrimanniversaryedition' || game === 'skyrimae') return 'ae';
      const tags = (m.tags || []).map((t) => t.toLowerCase().trim().replace(/\s+/g, ''));
      const AE_TAGS = [
        'ae','1.6','1.6.x','1.6.1','1.6.2','1.6.3','1.6.353','1.6.640','1.6.1130',
        'nextgen','nextgenupdate','post-aeupdate','postaeupdate','anniversaryedition',
        'creationclub','creationclub','anniversaryedition',
      ];
      const SE_TAGS = ['1.5','1.5.97','1.5.x','se'];
      const hasAETag = tags.some((t) => AE_TAGS.includes(t));
      const hasSETag = tags.some((t) => SE_TAGS.includes(t));
      if (hasAETag && !hasSETag) return 'ae';
      if (hasSETag && !hasAETag) return 'se';
      const txt = ((m.title || '') + ' ' + (m.description || '')).toLowerCase();
      const aeScore = [
        /\b1\.6\.\d/, /next[\s-]?gen update/, /anniversary edition/,
        /\bae\b/, /creation club/, /post.?ae/, /requires.*1\.6/,
      ].filter((p) => p.test(txt)).length;
      const seScore = [
        /\b1\.5\.97\b/, /\b1\.5\b/, /old[\s-]?ae/, /pre[\s-]?ae/, /requires.*1\.5/,
      ].filter((p) => p.test(txt)).length;
      if (aeScore > seScore) return 'ae';
      if (seScore > aeScore) return 'se';
      const ver = (m.version || '').trim();
      if (/^1\.6/.test(ver)) return 'ae';
      if (/^1\.5/.test(ver)) return 'se';
      return 'se';
    }

    const enriched = deduped.map((m) => ({ ...m, skyrimVersion: classifySkyrimVersion(m) }));

    if (enriched.length > 0) {
      cachedModlists = enriched;
      lastModlistsFetch = now;
      const seCount  = enriched.filter((m) => m.skyrimVersion === 'se').length;
      const aeCount  = enriched.filter((m) => m.skyrimVersion === 'ae').length;
      const vrCount  = enriched.filter((m) => m.skyrimVersion === 'vr').length;
      const othCount = enriched.filter((m) => m.skyrimVersion === 'other').length;
      broadcastLog('info', `Catalogue : ${enriched.length} modlists — SE:${seCount} AE:${aeCount} VR:${vrCount} Autres:${othCount}`);
      return res.json(enrichCatalog(enriched));
    }
    throw new Error('Aucun résultat après agrégation');
  } catch (aggErr) {
    // Fallback — featured list only
    try {
      const d = await fetchJson(FEATURED_URL, 10000);
      cachedModlists = d;
      lastModlistsFetch = now;
      return res.json(enrichCatalog(d));
    } catch {
      if (cachedModlists) return res.json(enrichCatalog(cachedModlists));
      res.status(502).json({ error: 'Catalogue GitHub inaccessible.' });
    }
  }
});

// Scan du dossier de téléchargement. Avec ?stream=1 : réponse NDJSON (une ligne JSON par événement)
//   {type:'progress', phase:'list'|'match', done, total}  …  {type:'result', ...}  ou  {type:'error', error}
// afin que l'interface affiche une vraie progression ; la boucle cède régulièrement la main pour ne pas
// bloquer le serveur (SSE, autres requêtes) sur de gros dossiers.
app.post('/api/wabbajack/verify-downloads', async (req, res) => {
  const { downloadsPath, archives, gamePath } = req.body || {};
  if (!downloadsPath || !Array.isArray(archives)) return res.status(400).json({ error: 'Paramètres manquants.' });

  const stream = req.query.stream === '1';
  let clientGone = false;
  res.on('close', () => { if (!res.writableFinished) clientGone = true; }); // (req 'close' est émis dès le corps lu)
  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();
  }
  const emit = (o) => { if (stream && !clientGone) res.write(JSON.stringify(o) + '\n'); };
  const yieldLoop = () => new Promise((r) => setImmediate(r));
  const fail = (status, error) => {
    if (stream) { emit({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };

  const downloadsExists = fs.existsSync(downloadsPath);

  // Collect all files (and one level of subdirectories)
  const allFiles = [];
  emit({ type: 'progress', phase: 'list', done: 0, total: 0 });
  if (downloadsExists) try {
    const entries = fs.readdirSync(downloadsPath, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).length;
    let dirsDone = 0;
    for (const e of entries) {
      const fullPath = path.join(downloadsPath, e.name);
      if (e.isFile()) {
        allFiles.push({ name: e.name, lower: e.name.toLowerCase(), fullPath });
      } else if (e.isDirectory()) {
        try {
          const sub = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const se of sub) {
            if (se.isFile()) {
              allFiles.push({ name: se.name, lower: se.name.toLowerCase(), fullPath: path.join(fullPath, se.name) });
            }
          }
        } catch { /* skip */ }
        dirsDone++;
        if (dirsDone % 5 === 0) { emit({ type: 'progress', phase: 'list', done: dirsDone, total: dirs }); await yieldLoop(); if (clientGone) return; }
      }
    }
  } catch (err) {
    return fail(500, 'Impossible de lire le dossier : ' + err.message);
  }

  // Strip Nexus suffix: 'SkyUI_5_2_SE-12604-5-2SE-timestamp.7z' → 'skyui_5_2_se'
  function stripNexusSuffix(filename) {
    const ext = path.extname(filename);
    const stem = path.basename(filename, ext);
    return stem.replace(/-d+(-[w.]+)*$/, '').replace(/-d+$/, '').toLowerCase();
  }
  function stripExt(filename) {
    return path.basename(filename, path.extname(filename)).toLowerCase();
  }

  const byExactLower = new Map(allFiles.map((f) => [f.lower, f]));
  const byStemClean  = new Map();
  const byStemExact  = new Map();
  for (const f of allFiles) {
    const ck = stripNexusSuffix(f.name);
    if (!byStemClean.has(ck)) byStemClean.set(ck, f);
    const sk = stripExt(f.name);
    if (!byStemExact.has(sk)) byStemExact.set(sk, f);
  }

  for (const f of allFiles) f.stem = stripExt(f.name); // précalculé : évite un basename par comparaison (stratégie 4)

  let readyCount = 0;
  let sizeMismatchCount = 0;
  const sizeCache = new Map();
  const sizeOf = (f) => {
    if (sizeCache.has(f.fullPath)) return sizeCache.get(f.fullPath);
    let s = null;
    try { const st = fs.statSync(f.fullPath); if (st.isFile()) s = st.size; } catch { /* race */ }
    sizeCache.set(f.fullPath, s);
    return s;
  };

  const resolveOne = (a) => {
    // Fichiers originaux du jeu : jamais dans DOWNLOADS par défaut → dossier du jeu
    if (isIgnorableGameFile(a)) { readyCount++; return { ...a, status: 'ready', sourceKind: 'game', ignored: true }; }
    if (isGameFileArchive(a)) {
      const r = resolveGameFileArchive(a, gamePath, downloadsExists ? downloadsPath : null);
      if (r) { readyCount++; return { ...a, status: 'ready', localPath: r.path, matchedAs: path.basename(r.path), sourceKind: 'game', sizeMatches: r.sizeMatches }; }
      return { ...a, status: 'missing', sourceKind: 'game', expectedPath: expectedGameFilePath(a, gamePath) };
    }

    const archiveName  = a.Name || '';
    const archiveLower = archiveName.toLowerCase();
    const archiveSC    = stripNexusSuffix(archiveName);
    const archiveSE    = stripExt(archiveName);
    const expected     = Number(a.Size) || 0;

    // Candidats par ordre de confiance décroissante ; le premier dont la TAILLE correspond à celle
    // du manifeste est retenu. Un fichier de mauvaise taille (autre version, téléchargement
    // incomplet, fichier sans rapport au nom court) n'est jamais validé.
    const candidates = [];
    const addCandidate = (f) => { if (f && !candidates.includes(f)) candidates.push(f); };
    addCandidate(byExactLower.get(archiveLower));   // 1 : nom exact
    addCandidate(byStemClean.get(archiveSC));       // 2 : nom nettoyé
    addCandidate(byStemExact.get(archiveSE));       // 3 : nom sans extension
    for (const f of allFiles) {                     // 4 : préfixe (dans un sens ou dans l'autre)
      const ds = f.stem;
      if (ds && ds.length >= 8 && (ds.startsWith(archiveSE) || archiveSE.startsWith(ds))) addCandidate(f);
    }

    let wrongSize = null;
    for (const f of candidates) {
      const size = sizeOf(f);
      if (!size) continue; // illisible ou vide
      if (expected > 0 && size !== expected) { if (!wrongSize) wrongSize = f; continue; }
      readyCount++;
      return { ...a, status: 'ready', localPath: f.fullPath, matchedAs: f.name };
    }
    if (wrongSize) {
      sizeMismatchCount++;
      return { ...a, status: 'missing', sourceKind: 'mod', sizeMismatch: wrongSize.name };
    }
    return { ...a, status: 'missing', sourceKind: 'mod' };
  };

  const updated = [];
  const total = archives.length;
  emit({ type: 'progress', phase: 'match', done: 0, total });
  for (let i = 0; i < total; i++) {
    updated.push(resolveOne(archives[i]));
    if ((i + 1) % 25 === 0 || i + 1 === total) {
      emit({ type: 'progress', phase: 'match', done: i + 1, total });
      await yieldLoop();
      if (clientGone) return;
    }
  }

  const gameArcs = updated.filter((a) => a.sourceKind === 'game' && !a.ignored);
  const gameFound = gameArcs.filter((a) => a.status === 'ready' && a.localPath);
  const gameFiles = {
    total: gameArcs.length,
    found: gameFound.length,
    dirs: [...new Set(gameFound.map((a) => String(a.localPath).replace(/\/data\/.*$/i, '') || path.dirname(a.localPath)))],
  };
  const result = { archives: updated, readyCount, missingCount: archives.length - readyCount, totalScanned: allFiles.length, sizeMismatches: sizeMismatchCount, gameFiles };
  if (stream) { emit({ type: 'result', ...result }); return res.end(); }
  res.json(result);
});

// ── Nettoyage de DOWNLOADS : archives inutilisées par les listes installées ─────
// Seuls les fichiers du dernier examen peuvent partir à la Corbeille (pas de chemin arbitraire).
let lastUnusedScan = new Set();
app.post('/api/downloads/unused', (req, res) => {
  const { downloadsPath, destPath } = req.body || {};
  if (typeof downloadsPath !== 'string' || !fs.existsSync(downloadsPath)) return res.status(400).json({ error: 'Dossier DOWNLOADS introuvable' });
  if (typeof destPath !== 'string' || !fs.existsSync(destPath)) return res.status(400).json({ error: 'Dossier READY TO PLAY introuvable' });
  const r = findUnusedDownloads(path.resolve(downloadsPath), path.resolve(destPath));
  // Sans liste connue, ou avec une installation sans état enregistré, tout paraîtrait inutilisé : rien n'est proposé
  if (!r.installs.length || r.legacy.length) { r.blocked = r.installs.length ? 'legacy' : 'no-install'; r.unused = []; r.totalSize = 0; }
  lastUnusedScan = new Set(r.unused.flatMap((u) => (u.meta ? [u.path, u.meta] : [u.path])));
  res.json(r);
});
app.post('/api/downloads/trash', async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter((p) => lastUnusedScan.has(p)) : [];
  if (!paths.length) return res.status(400).json({ error: 'Aucun fichier à déplacer' });
  try {
    await moveToTrash(paths);
    for (const p of paths) lastUnusedScan.delete(p);
    writeLog({ level: 'info', message: `Nettoyage DOWNLOADS : ${paths.length} fichier(s) placé(s) dans la Corbeille`, details: paths.join('\n') });
    res.json({ moved: paths.length });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

app.post('/api/nexus/check-key', async (req, res) => {
  const { key } = req.body;
  if (!key?.trim()) return res.status(400).json({ valid: false, error: 'Clé absente' });
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api.nexusmods.com/v1/users/validate.json', {
      headers: { apikey: key.trim(), 'Application-Name': 'mAbbajack-macOS', 'Application-Version': '3.0.0' }, signal: ctrl.signal,
    });
    clearTimeout(t);
    if (r.ok) { const d = await r.json(); nexusPremiumCache.set(key.trim(), Boolean(d.is_premium)); return res.json({ valid: true, name: d.name, isPremium: Boolean(d.is_premium), dailyLimit: d.daily_limit, dailyRemaining: d.daily_remaining, hourlyLimit: d.hourly_limit, hourlyRemaining: d.hourly_remaining }); }
    res.json({ valid: false, error: `HTTP ${r.status}` });
  } catch { res.json({ valid: false, offline: true, error: 'Nexus injoignable' }); } // statut inconnu : rien d'inventé
});

app.get('/api/install/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  res.write(`data: ${JSON.stringify({ type: 'progress', progress: currentInstallJob.progress })}\n\n`);
  logHistory.slice(-50).forEach((log) => res.write(`data: ${JSON.stringify({ type: 'log', log })}\n\n`));
  req.on('close', () => { sseClients = sseClients.filter((c) => c !== res); });
});

app.get('/api/install/plugins-txt', (req, res) => res.json({ pluginsTxt: lastGeneratedPluginsTxt }));

app.post('/api/install/pause', (req, res) => {
  if (!currentInstallJob.active) return res.status(409).json({ error: 'Aucune installation en cours.' });
  jobControl.setPaused(true);
  broadcastProgress({ isPaused: true, currentTask: 'Installation suspendue.' });
  broadcastLog('warn', '⏸ Installation suspendue.');
  res.json({ status: 'paused' });
});

app.post('/api/install/resume', (req, res) => {
  if (!currentInstallJob.active) return res.status(409).json({ error: 'Aucune installation en cours.' });
  jobControl.setPaused(false);
  broadcastProgress({ isPaused: false, currentTask: 'Reprise…' });
  broadcastLog('info', '▶ Installation reprise.');
  res.json({ status: 'resumed' });
});

app.post('/api/install/cancel', (req, res) => {
  currentInstallJob.abortController?.abort();
  jobControl.cancel();
  currentInstallJob.active = false;
  broadcastProgress({ stage: 'idle', stageName: 'Annulé', overallPercent: 0, hasError: false, currentTask: 'Annulé.' });
  broadcastLog('warn', '⛔ Installation annulée.');
  res.json({ status: 'cancelled' });
});

// ──────────────────────────────────────────────────────────────────────
// MAIN INSTALLATION ENDPOINT — Directive-based deployment
// ──────────────────────────────────────────────────────────────────────

// Identifiant de dossier de jeu utilisé par Vortex (<downloads>/<id>/)
const VORTEX_GAME_IDS = {
  skyrimspecialedition: 'skyrimse', skyrimse: 'skyrimse',
  skyrim: 'skyrim', skyrimle: 'skyrim',
  skyrimvr: 'skyrimvr',
  falloutnewvegas: 'falloutnv', falloutnv: 'falloutnv',
  fallout4: 'fallout4', fallout3: 'fallout3',
};

/**
 * Organisation Vortex : si `root` contient déjà un sous-dossier du jeu (ex. skyrimse),
 * les téléchargements y sont écrits. Sinon (ou si `root` est déjà ce dossier) : `root`.
 * Ne crée aucun dossier.
 */
function resolveVortexDownloadDir(root, gameType) {
  try {
    const compact = String(gameType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return root;
    const wanted = new Set([VORTEX_GAME_IDS[compact] || compact, compact]);
    if (wanted.has(path.basename(root).toLowerCase())) return root;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && wanted.has(e.name.toLowerCase())) return path.join(root, e.name);
    }
  } catch { /* dossier absent ou illisible → racine */ }
  return root;
}
// Notification macOS de fin d'installation (l'installation dure des heures : fenêtre souvent en arrière-plan)
const NOTIFY_TEXT = {
  fr: { done: (n) => `« ${n} » est installée.`, failed: (n) => `Échec de l'installation de « ${n} ».` },
  en: { done: (n) => `"${n}" is installed.`, failed: (n) => `Installing "${n}" failed.` },
  es: { done: (n) => `«${n}» está instalada.`, failed: (n) => `La instalación de «${n}» ha fallado.` },
  it: { done: (n) => `«${n}» è installata.`, failed: (n) => `Installazione di «${n}» non riuscita.` },
};
function notifyMac(lang, kind, name) {
  const text = (NOTIFY_TEXT[lang] || NOTIFY_TEXT.fr)[kind](name || 'modlist');
  // Texte passé en argument (argv) : aucun risque d'injection AppleScript
  execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run', 'mABBAJACK', text], () => {});
}

app.post('/api/install/start', async (req, res) => {
  const { modlist, downloadsPath, destPath, nexusApiKey, gamePath, options, uiLanguage } = req.body;
  if (!modlist || !destPath) return res.status(400).json({ error: 'Modlist et dossier READY TO PLAY requis.' });

  // Build the modlist-named subdirectory: UPPERCASE, filesystem-safe chars only
  // e.g. "Nordic Souls PBR" → destPath/NORDIC_SOULS_PBR/
  const baseDest     = path.resolve(destPath.trim());
  // Mise à jour : dossier de l'installation existante (sous-dossier direct de READY TO PLAY)
  const updateMode   = !!options?.update;
  const updateDir    = updateMode && typeof options.update?.dir === 'string' ? path.resolve(options.update.dir) : null;
  const modlistDirName = updateDir && path.dirname(updateDir) === baseDest
    ? path.basename(updateDir)
    : installDirName(modlist.name || modlist.title);
  const cleanDest    = path.join(baseDest, modlistDirName);
  const downloadsRoot = downloadsPath ? path.resolve(downloadsPath.trim()) : path.join(baseDest, 'DOWNLOADS');
  const cleanDownloads = resolveVortexDownloadDir(downloadsRoot, modlist.gameType);
  const vortexSubfolder = cleanDownloads !== downloadsRoot;

  if (currentInstallJob.active && currentInstallJob.abortController) {
    return res.status(409).json({ error: 'Une installation est déjà en cours.' });
  }
  jobControl.paused = false;
  const abortController = new AbortController();
  currentInstallJob.active = true;
  currentInstallJob.abortController = abortController;
  logHistory = [];
  const installLogPath = startInstallLog(modlistDirName);
  writeLog({
    level: 'debug',
    message: `Paramètres d'installation — journal : ${installLogPath || '(désactivé)'}`,
    details: JSON.stringify({
      modlist: modlist.name, version: modlist.version, gameType: modlist.gameType, skyrimVersion: modlist.skyrimVersion,
      localFilePath: modlist.localFilePath, archives: (modlist.archives || []).length, directives: (modlist.directives || []).length,
      downloadsPath, destPath, gamePath, nexusApiKey: nexusApiKey ? '(renseignée)' : '(absente)',
    }, null, 2),
  });

  currentInstallJob.progress = {
    stage: 'validating_paths', stageName: 'Initialisation', overallPercent: 2, stagePercent: 0,
    currentTask: 'Vérification des répertoires...', processedItems: 0,
    totalItems: (modlist.directives || []).length || (modlist.archives || []).length,
    processedBytes: 0, totalBytes: modlist.totalArchiveSize || 0,
    speedBytesPerSec: 0, etaSeconds: 0, activeDownloads: 0, missingArchivesCount: 0,
    isPaused: false, hasError: false, errorMessage: null,
  };

  res.json({ status: 'started', message: 'Installation démarrée.' });

  (async () => {
    const { signal } = abortController;
    let wabbajackTempPath = null; // hors du try : nettoyé aussi en cas d'erreur (catch)
    try {
      await new Promise((r) => setTimeout(r, 400));

      broadcastLog('info', `═══════════════════════════════════════════════════`);
      broadcastLog('info', `  mABBAJACK v3 — Moteur de directives Wabbajack`);
      broadcastLog('info', `  Modlist : "${modlist.name}" v${modlist.version || '?'}`);
      broadcastLog('info', `  Dossier : ${modlistDirName}`);
      broadcastLog('info', `═══════════════════════════════════════════════════`);
      broadcastLog('info', `📥 DOWNLOADS    : ${cleanDownloads}`);
      if (vortexSubfolder) broadcastLog('info', `📂 Organisation Vortex détectée : les téléchargements sont enregistrés dans "${path.basename(cleanDownloads)}" (${downloadsRoot}).`);
      broadcastLog('info', `🚀 READY TO PLAY : ${baseDest}`);
      broadcastLog('info', `📂 Sous-dossier  : ${modlistDirName}`);

      if (modlist.gameType || modlist.skyrimVersion) {
        const expected = getExpectedSkyrimVersion(modlist.gameType, modlist.skyrimVersion, modlist.archives);
        broadcastLog('info', `🎮 Cible : ${expected.label} (${expected.versionHint})`);

      }

      // ── ÉTAPE 1 : Répertoires ──────────────────────────────────────
      broadcastProgress({ stage: 'validating_paths', stageName: 'Création des répertoires', overallPercent: 3, currentTask: 'Création DOWNLOADS et READY TO PLAY...' });

      try { makeDirResilient(cleanDownloads); broadcastLog('success', `✓ DOWNLOADS : "${cleanDownloads}"`); }
      catch (e) { broadcastLog('warn', `⚠ DOWNLOADS inaccessible : ${e.message}`); }

      makeDirResilient(cleanDest);
      const writeErr = testWriteAccess(cleanDest);
      if (writeErr) throw new Error(`READY TO PLAY "${cleanDest}" : ${writeErr}`);
      broadcastLog('success', `✓ Répertoire d'installation créé : "${cleanDest}"`);

      // Warn if READY TO PLAY already contains files (accumulated previous installs)
      if (updateMode) broadcastLog('info', `🔄 Mode mise à jour : seuls les fichiers nouveaux ou modifiés seront installés, les fichiers retirés de la liste seront supprimés.`);
      else try {
        const existingEntries = fs.readdirSync(cleanDest);
        if (existingEntries.length > 0) {
          broadcastLog('warn', `⚠ READY TO PLAY contient déjà ${existingEntries.length} entrée(s) — les fichiers existants seront écrasés ou coexisteront.`);
          broadcastLog('warn', `  → Si vous observez un dossier trop volumineux, videz READY TO PLAY manuellement avant relancer.`);
        }
      } catch {}


      const sevenZipBin = find7z();
      if (sevenZipBin) broadcastLog('success', `✓ 7zz disponible : ${sevenZipBin}`);
      else broadcastLog('warn', `⚠ 7zz introuvable — extraction impossible. Installez via : brew install sevenzip`);

      const unarBin = findUnar();
      if (unarBin) broadcastLog('info', `✓ unar disponible (fallback RAR5) : ${unarBin}`);

      const texconvBin = findTexconvBin();
      if (texconvBin) broadcastLog('info', `✓ texconv disponible (textures transformées) : ${texconvBin}`);
      else broadcastLog('warn', `⚠ texconv introuvable — les textures transformées seront copiées sans conversion.`);

      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 2 : Scan DOWNLOADS ───────────────────────────────────
      broadcastProgress({ stage: 'scanning_downloads', stageName: 'Scan DOWNLOADS', overallPercent: 7, currentTask: 'Inventaire des archives...' });

      // ── Sélection des mods : optionnels désactivés, profil, archives inutiles ──
      let selection = null;
      const logSelection = (sel) => {
        broadcastLog('info', `🎛 Options : ${sel.excludedMods.length} mod(s) optionnel(s) ignoré(s), ${sel.enabledOptional.length} activé(s) — profil « ${sel.profile || '?'} ».`);
        if (sel.skipHashes.size > 0) broadcastLog('info', `⏭ ${sel.skipHashes.size} archive(s) réservée(s) aux mods optionnels ignorées (non téléchargées).`);
      };
      const earlyFile = typeof modlist.localFilePath === 'string' && /\.wabbajack$/i.test(modlist.localFilePath) && fs.existsSync(modlist.localFilePath) ? modlist.localFilePath : null;
      let manifestRaw = null; // manifeste complet : instantané de fin d'installation
      if (earlyFile) {
        try {
          manifestRaw = await loadRawModlist(earlyFile);
          selection = await buildSelection(manifestRaw, (n) => readZipEntry(earlyFile, n), options || {});
          logSelection(selection);
        } catch (e) {
          broadcastLog('warn', `⚠ Options non appliquées : ${String(e.message || e).slice(0, 160)}`);
        }
      }
      // ── Mise à jour : fichiers inchangés, fichiers retirés, archives réellement nécessaires ──
      let updatePlan = null;
      if (updateMode) {
        if (!manifestRaw) broadcastLog('warn', `⚠ Mise à jour impossible sans fichier .wabbajack local : installation complète.`);
        else {
          try {
            updatePlan = await prepareUpdate({ raw: manifestRaw, wabbajackPath: earlyFile, selection, destRoot: cleanDest, previousFile: options.update?.previousFile, signal });
          } catch (e) {
            if (signal.aborted) throw e;
            broadcastLog('warn', `⚠ Comparaison avec l'installation existante impossible : ${String(e.message || e).slice(0, 160)} — installation complète.`);
          }
        }
      }
      const notSkipped = (a) => (!selection || !selection.skipHashes.has(a.Hash)) && (!updatePlan || updatePlan.neededArchives.has(a.Hash));
      if (updatePlan) {
        const unused = (modlist.archives || []).filter((a) => (!selection || !selection.skipHashes.has(a.Hash)) && !updatePlan.neededArchives.has(a.Hash)).length;
        broadcastLog('info', `⏭ Mise à jour : ${unused} archive(s) inutile(s) (fichiers inchangés) — ni vérifiées ni téléchargées.`);
      }

      const archives = (modlist.archives || []).filter(notSkipped);
      // Trust localPath already resolved by the client's verify-downloads scan.
      // The client sends archives with localPath set for matched files.
      // We only fall back to a server-side name-exact scan for archives without localPath.
      let archiveStatuses = archives.map((a) => {
        if (a.localPath && fs.existsSync(a.localPath)) {
          return { ...a, status: 'ready' };
        }
        if (a.status === 'ready' && a.localPath) {
          // path was set but file vanished between scan and install
          return { ...a, status: 'missing', localPath: null };
        }
        return { ...a, status: a.status || 'missing', localPath: a.localPath || null };
      });

      // ── Fichiers ORIGINAUX du jeu (GameFileSource) : identifiés EN PREMIER ──
      // Ils ne sont jamais téléchargés ni décompressés : lus dans le dossier du jeu.
      const fileSizeOf = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };
      // Un seul dossier du jeu, choisi parce que ses fichiers ont la taille attendue par le
      // manifeste : les patchs s'appliquent sur ces fichiers, une autre version donnerait des
      // fichiers faux. Un fichier qui ne correspond pas n'est jamais déployé.
      const resolveGameFiles = (list) => {
        const games = list.filter((a) => isGameFileArchive(a) && !isIgnorableGameFile(a));
        let chosenRoot = null;
        if (games.length > 0) {
          const gameName = games[0]?.State?.Game;
          const exes = GAME_EXES[String(gameName || '').toLowerCase()] || GAME_EXES.skyrimspecialedition;
          const isRoot = (p) => isGameRoot(p, exes);
          const userRoot = gamePath && String(gamePath).trim() ? path.resolve(String(gamePath).trim()) : null;
          const roots = [];
          if (userRoot) {
            if (isRoot(userRoot)) roots.push(userRoot);
            // Le dossier indiqué, ses sous-dossiers et ses voisins (autres versions du jeu)
            roots.push(...siblingGameRoots(path.join(userRoot, '_'), isRoot, 3, 2));
          }
          roots.push(...gameSearchDirs(games[0], null, true));
          const ranking = rankGameRoots(roots, games, userRoot);
          const ver = games[0]?.State?.GameVersion || '?';
          const best = ranking[0];
          if (best && best.matched > 0) {
            chosenRoot = best.root;
            const inUser = (r) => r === userRoot || r.startsWith(`${userRoot}/`);
            const userRank = userRoot ? ranking.find((r) => r.root === userRoot) || ranking.find((r) => inUser(r.root)) : null;
            if (userRoot && !inUser(best.root)) {
              broadcastLog('warn', `⚠ Dossier du jeu indiqué : ${userRoot}${userRank ? ` (${userRank.matched}/${games.length} fichiers conformes à la version ${ver})` : ''}.`);
              broadcastLog('warn', `  → Dossier retenu, conforme à la version ${ver} : ${best.root} (${best.matched}/${games.length}).`);
            }
            const ties = ranking.filter((r) => r.matched === best.matched && r.root !== best.root);
            if (ties.length > 0) broadcastLog('info', `  ℹ Autre(s) dossier(s) du jeu équivalent(s) : ${ties.map((r) => r.root).join(', ')}`);
          }
          if (ranking.length > 0) debugLog(`Dossiers du jeu (version ${ver}) : ${ranking.map((r) => `${r.root} = ${r.matched}/${games.length}`).join(' · ')}`);
        }
        const downloads = fs.existsSync(cleanDownloads) ? cleanDownloads : null;
        const out = list.map((a) => {
          if (isIgnorableGameFile(a)) return { ...a, status: 'ready', sourceKind: 'game', ignored: true };
          if (!isGameFileArchive(a)) return a;
          if (a.status === 'ready' && a.localPath && (!a.Size || fileSizeOf(a.localPath) === a.Size)) return { ...a, sourceKind: 'game' };
          let p = chosenRoot ? matchInRoot(chosenRoot, a) : null;
          if (!p && downloads) {
            p = [a.Name, path.basename(gameFileRel(a))].filter(Boolean).map((n) => path.join(downloads, n))
              .find((c) => { const sz = fileSizeOf(c); return sz > 0 && (!a.Size || sz === a.Size); }) || null;
          }
          return p
            ? { ...a, status: 'ready', localPath: p, sourceKind: 'game', sizeMatches: true }
            : { ...a, status: 'missing', localPath: null, sourceKind: 'game' };
        });
        if (games.length > 0) {
          const ver = games[0]?.State?.GameVersion || '?';
          const found = out.filter((a) => isGameFileArchive(a) && !a.ignored && a.status === 'ready');
          const absent = out.filter((a) => isGameFileArchive(a) && !a.ignored && a.status !== 'ready');
          broadcastLog(absent.length === 0 ? 'success' : 'warn',
            `🎮 Fichiers originaux du jeu (version ${ver}) : ${found.length}/${games.length} conformes${chosenRoot ? ` dans ${chosenRoot}` : ''}`);
          if (absent.length > 0) {
            const names = absent.map((a) => gameFileRel(a) || a.Name);
            broadcastLog('error', `  ✗ ${absent.length} fichier(s) du jeu absent(s) ou d'une autre version : ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`);
            broadcastLog('error', `  → Les fichiers qui en dépendent ne seront pas installés. Indiquez un dossier du jeu en version ${ver}.`);
          }
        }
        return out;
      };
      archiveStatuses = resolveGameFiles(archiveStatuses);

      // Dossier dédié à la liste : celui du .wabbajack (ex. WABBAJACK LISTS/<LISTE>/), sinon
      // DOWNLOADS/<LISTE>/. Prioritaire sur le cache commun, qu'on ne modifie jamais pour une
      // archive de même nom : il sert peut-être à une autre modlist.
      // Fichier chargé par copie temporaire (envoi du navigateur) : retrouver le vrai .wabbajack
      let wabbajackRealPath = modlist.localFilePath;
      if (isTempPath(wabbajackRealPath)) {
        const tmpSize = fileSizeOf(wabbajackRealPath);
        const found = tmpSize > 0 ? await locateWabbajack(path.basename(wabbajackRealPath), tmpSize) : null;
        if (found) { wabbajackRealPath = found; broadcastLog('info', `📄 Fichier .wabbajack d'origine retrouvé : ${found}`); }
        else broadcastLog('warn', `⚠ Fichier .wabbajack chargé par une copie temporaire et original introuvable : dossier dédié = ${path.join(cleanDownloads, modlistDirName)}`);
      }
      const listDir = listDownloadDir(wabbajackRealPath);
      const dedicatedDir = listDir || path.join(cleanDownloads, modlistDirName);
      if (listDir) broadcastLog('info', `📂 Dossier dédié à la liste (prioritaire) : ${listDir}`);
      const hashCache = new HashCache();
      const fmtSize = (n) => `${Number(n || 0).toLocaleString('fr-FR')} o`;
      const describeWrongVersion = (a) => {
        const w = a.wrongVersion;
        return w.reason === 'size'
          ? `"${w.path}" fait ${fmtSize(w.size)} au lieu de ${fmtSize(a.Size)}`
          : `"${w.path}" a la bonne taille mais un autre contenu (hash ${w.hash} au lieu de ${a.Hash})`;
      };
      const verifyArchiveFiles = async (list) => {
        const todo = list.filter((a) => !isGameFileArchive(a) && !a.ignored);
        if (todo.length === 0) return list;
        broadcastProgress({ stage: 'scanning_downloads', stageName: 'Vérification des archives', currentTask: `Vérification de ${todo.length} archive(s)…` });
        broadcastLog('info', `🔎 Vérification de ${todo.length} archive(s) : taille puis hash Wabbajack (mis en cache après le premier calcul)…`);
        const totalBytes = todo.reduce((s, a) => s + (Number(a.Size) || 0), 0);
        let doneBytes = 0, hashed = 0, fromCache = 0, i = 0, lastSave = Date.now();
        const out = [];
        for (const a of list) {
          if (isGameFileArchive(a) || a.ignored) { out.push(a); continue; }
          i++;
          await jobControl.waitIfPaused(signal);
          const name = a.Name || '';
          const candidates = [...new Set([
            name && path.join(dedicatedDir, name),
            a.localPath,
            name && path.join(cleanDownloads, name),
            name && path.join(downloadsRoot, name),
          ].filter((p) => p && fs.existsSync(p)))];
          let good = null, wrong = null;
          for (const p of candidates) {
            const r = await verifyArchive(a, p, {
              cache: hashCache, signal, waitIfPaused: (s) => jobControl.waitIfPaused(s),
              onBytes: (n) => {
                doneBytes += n;
                broadcastProgress({ currentTask: `🔎 ${i}/${todo.length} — ${name}`, stagePercent: totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0 });
              },
            });
            if (r.hash) { if (r.cached) fromCache++; else hashed++; }
            if (r.ok) { good = p; break; }
            if (!wrong && r.reason !== 'unreadable') wrong = { path: p, reason: r.reason, size: r.size, hash: r.hash };
          }
          if (Date.now() - lastSave > 30000) { hashCache.save(); lastSave = Date.now(); }
          const { wrongVersion: _old, ...rest } = a;
          if (good) out.push({ ...rest, status: 'ready', localPath: good });
          else out.push({ ...rest, status: 'missing', localPath: null, ...(wrong ? { wrongVersion: wrong } : {}) });
        }
        hashCache.save();
        const ok = out.filter((a) => a.status === 'ready' && !isGameFileArchive(a) && !a.ignored).length;
        const wrongN = out.filter((a) => a.wrongVersion).length;
        broadcastLog(ok === todo.length ? 'success' : 'warn',
          `✓ Archives vérifiées : ${ok} correcte(s), ${wrongN} de même nom mais d'une autre version, ${todo.length - ok - wrongN} absente(s) — ${hashed} hash calculé(s), ${fromCache} lu(s) en cache.`);
        return out;
      };

      // ── Vérification des archives : taille puis hash Wabbajack (xxHash64) ──
      // Une archive de même nom n'est JAMAIS acceptée sur son seul nom : les noms génériques
      // (« DynDOLOD Output.7z », « Synthesis.zip »…) existent dans plusieurs modlists.
      // Ordre de recherche : dossier dédié à la liste (prioritaire), chemin trouvé par le scan
      // de l'interface, puis cache commun (dossier du jeu, puis racine).
      archiveStatuses = await verifyArchiveFiles(archiveStatuses);

      const readyCount = archiveStatuses.filter((a) => a.status === 'ready').length;
      const missingCount = archives.length - readyCount;
      broadcastLog('info', `Scan : ${readyCount}/${archives.length} archives correctes, ${missingCount} absente(s) ou incorrecte(s).`);
      for (const a of archiveStatuses) {
        if (a.status === 'ready') continue;
        if (isGameFileArchive(a)) broadcastLog('warn', `  ✗ Manquant : ${path.basename(gameFileRel(a))} — fichier original du jeu (attendu : ${expectedGameFilePath(a, gamePath)})`);
        else if (a.wrongVersion) broadcastLog('warn', `  ✗ Mauvaise version : ${a.Name} — ${describeWrongVersion(a)}`);
        else broadcastLog('warn', `  ✗ Manquant : ${a.Name} — archive de mod`);
      }
      broadcastProgress({ missingArchivesCount: missingCount, overallPercent: 10 });

      // ── Contrôle d'espace disque ──
      {
        const downloadBytes = archiveStatuses
          .filter((a) => a.status !== 'ready' && !isGameFileArchive(a))
          .reduce((s, a) => s + (Number(a.Size) || 0), 0);
        const installBytes = selection?.keptBytes ?? (Number(modlist.totalInstalledSize) || 0);
        const ds = checkDiskSpace({ downloadDir: cleanDownloads, destDir: cleanDest, downloadBytes, installBytes });
        if (ds.level !== 'unknown') {
          broadcastLog('info', `💾 Espace requis ≈ ${fmtBytes(ds.need)} (téléchargements ${fmtBytes(ds.needDownloads)} + installation ${fmtBytes(ds.needInstall)}) — libre : ${fmtBytes(ds.free)}.`);
        }
        if (ds.level === 'warn') broadcastLog('warn', `⚠ Espace disque limite : il manque ≈ ${fmtBytes(ds.shortBy)} sur ${fmtBytes(ds.free)}.`);
        if (ds.level === 'error') throw new Error(`Espace disque insuffisant : il manque ≈ ${fmtBytes(ds.shortBy)} sur ${fmtBytes(ds.free)}.`);
      }
      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 3 : Téléchargements ──────────────────────────────────
      let downloadedCount = 0, skippedManual = 0, globalBytes = 0;
      const manualUrls = new Map(); // archive Name → page de téléchargement manuel
      const globalStart = Date.now();

      if (missingCount > 0) {
        broadcastProgress({ stage: 'downloading_archives', stageName: `Téléchargements`, overallPercent: 12, processedItems: readyCount, totalItems: archives.length, currentTask: `${missingCount} archive(s) à télécharger...` });

        // Plusieurs archives à la fois : le débit Nexus / CDN est mieux exploité
        const queue = archiveStatuses.filter((a) => a.status !== 'ready');
        const missingBytes = queue.reduce((s, a) => s + (a.Size || 0), 0);
        const received = new Map(); // archive → octets reçus (progression globale)
        let active = 0;
        const downloadOne = async (arc) => {
          await jobControl.waitIfPaused(signal);
          // Fichier original du jeu : aucune source de téléchargement (voir rapport final)
          if (isGameFileArchive(arc)) { skippedManual++; return; }

          const archiveName = arc.Name || 'inconnu';
          const sizeMo = arc.Size ? `${(arc.Size / 1048576).toFixed(1)} Mo` : '? Mo';
          const state = arc.State || {};
          broadcastLog('info', `⬇ ${archiveName} (${sizeMo})`);

          let url = null;
          let requiresManual = false, manualUrl = null;

          let cdnUrl = null, driveId = null;
          const stateType = String(state.$type || '');

          if (/WabbajackCDN/i.test(stateType) && state.Url) { cdnUrl = state.Url; url = state.Url; }
          else if (/GoogleDrive/i.test(stateType) && state.Id) { driveId = state.Id; url = 'gdrive'; }
          else if (state.Url?.startsWith('http')) { url = state.Url; }
          else if (state.GameName && (state.ModID || state.NexusFileID) && nexusApiKey) {
            const modId = state.ModID || state.NexusFileID;
            const fileId = state.FileID || state.NexusID;
            if (modId && fileId) {
              const r = await getNexusDownloadUrl(state.GameName, modId, fileId, nexusApiKey);
              if (r.url) { url = r.url; }
              else { requiresManual = true; manualUrl = r.manualUrl; if (!r.isPremium) broadcastLog('warn', `  → Nexus Standard : téléchargement manuel requis`); }
            } else { requiresManual = true; manualUrl = `https://www.nexusmods.com/${state.GameName || 'skyrimspecialedition'}/mods/${modId}`; }
          } else { requiresManual = true; }

          if (requiresManual) {
            skippedManual++;
            manualUrl ||= archiveSourceUrl(arc);
            const copyDir = arc.wrongVersion ? dedicatedDir : cleanDownloads;
            if (manualUrl) { manualUrls.set(archiveName, manualUrl); broadcastLog('warn', `  → Manuel : ${manualUrl}`); broadcastLog('warn', `  → Copiez "${archiveName}" dans : ${copyDir}`); }
            else broadcastLog('warn', `  → Source inconnue — copiez manuellement "${archiveName}" dans : ${copyDir}`);
            return;
          }

          active++;
          try {
            let lastRecv = null; // 1er appel : base (un .part repris ne compte pas dans la vitesse)
            const dlProgress = (recv, total, speed) => {
              if (lastRecv !== null) globalBytes += recv - lastRecv;
              lastRecv = recv;
              received.set(arc, recv);
              const elap = (Date.now() - globalStart) / 1000;
              let done = 0; for (const n of received.values()) done += n;
              const others = active > 1 ? ` (+${active - 1} en cours)` : '';
              broadcastProgress({ currentTask: `⬇ ${archiveName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo${others}`, speedBytesPerSec: Math.round(elap > 0 ? globalBytes / elap : speed), stagePercent: missingBytes > 0 ? Math.min(100, Math.round((done / missingBytes) * 100)) : 0 });
            };
            // Une autre version porte déjà ce nom dans le cache commun : on ne l'écrase pas.
            const destDir = arc.wrongVersion ? dedicatedDir : cleanDownloads;
            if (arc.wrongVersion) { makeDirResilient(destDir); broadcastLog('info', `  → Enregistré dans le dossier dédié à la liste : ${destDir}`); }
            const destFile = path.join(destDir, archiveName);
            if (cdnUrl) await downloadWabbajackCdn(cdnUrl, destFile, dlProgress, signal, arc.Size || 0);
            else if (driveId) await downloadGoogleDrive(driveId, destFile, dlProgress, signal, arc.Size || 0);
            else await downloadFile(url, destFile, dlProgress, signal);
            const check = await verifyArchive(arc, destFile, { cache: hashCache, signal });
            hashCache.save();
            if (!check.ok) throw new Error(`fichier téléchargé incorrect (${check.reason === 'size' ? `taille ${check.size} au lieu de ${arc.Size}` : 'hash différent du manifeste'})`);
            arc.status = 'ready'; arc.localPath = destFile; delete arc.wrongVersion;
            downloadedCount++;
            broadcastLog('success', `  ✓ Téléchargé et vérifié : ${archiveName}`);
            broadcastProgress({ overallPercent: Math.min(35, 12 + Math.round(((downloadedCount + skippedManual) / missingCount) * 23)), processedItems: readyCount + downloadedCount });
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `  ✗ Échec : ${archiveName} — ${dlErr.message}`);
            const src = archiveSourceUrl(arc);
            if (src) { manualUrls.set(archiveName, src); broadcastLog('warn', `  → Manuel : ${src}`); }
            broadcastLog('warn', `  → Copiez manuellement "${archiveName}" dans : ${arc.wrongVersion ? dedicatedDir : cleanDownloads}`);
            skippedManual++;
          }
          finally { active--; }
        };
        const worker = async () => { while (queue.length) await downloadOne(queue.shift()); };
        await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, worker));

        if (downloadedCount > 0) broadcastLog('success', `✓ ${downloadedCount} archive(s) téléchargée(s).`);
      }

      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 4 : ACQUISITION + DÉPLOIEMENT .wabbajack ────────────────────
      // L'URL CDN authored-files.wabbajack.org/{name}_{guid} est une page HTML.
      // Stratégie :
      //   1. Chemin local → charger directement
      //   2. URL page CDN → essayer GitHub Releases; sinon instructions manuelles
      //   3. Autre URL    → vérifier content-type avant téléchargement

      broadcastProgress({
        stage: 'extracting_files',
        stageName: 'Déploiement des directives (extraction sélective)',
        overallPercent: 38,
        processedItems: 0,
        totalItems: (modlist.directives || []).length,
        currentTask: `Préparation du fichier .wabbajack…`,
      });

      broadcastLog('info', `\n═══════════════════════════════════════════════════`);
      broadcastLog('info', `  PHASE PRINCIPALE : Déploiement des directives`);
      broadcastLog('info', `  Chaque fichier est extrait précisément selon`);
      broadcastLog('info', `  les choix FOMOD pré-enregistrés par l'auteur.`);
      broadcastLog('info', `═══════════════════════════════════════════════════`);

      let wabbajackZip = null;
      let droppedDirectives = []; // directives des mods désactivés (profil, options)
      const rawWabbajackRef = modlist.localFilePath;
      const CDN_PAGE_HOST = 'authored-files.wabbajack.org';

      // Détecte si l'URL est une page web CDN (pas un fichier direct)
      const isCdnPageUrl = (url) => {
        if (!url) return false;
        try {
          const u = new URL(url);
          return u.hostname === CDN_PAGE_HOST && !u.pathname.startsWith('/authored_files/');
        } catch { return false; }
      };

      // Cherche un .wabbajack dans les GitHub Releases de la modlist
      // Priorité à la version qui correspond à modlist.version (ex: 3.1.1)
      // Retourne { url, exactMatch } ou null si aucune release trouvée
      const findGithubRelease = async (readmeUrl) => {
        const ghMatch = (readmeUrl || '').match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!ghMatch) return null;
        const [, owner, repo] = ghMatch;
        try {
          broadcastLog('info', `🔍 Recherche releases GitHub : ${owner}/${repo}…`);
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
            headers: { 'User-Agent': 'mAbbajack/3', 'Accept': 'application/vnd.github.v3+json' },
            signal,
          });
          if (!res.ok) { broadcastLog('warn', `  ⚠ GitHub API : ${res.status}`); return null; }
          const releases = await res.json();
          // -- Passe 1 : chercher la version correspondante exactement
          const targetVersion = (modlist.version || '').replace(/^v/i, '').trim();
          if (targetVersion) {
            for (const rel of releases) {
              const tagVer = (rel.tag_name || '').replace(/^v/i, '').trim();
              if (tagVer !== targetVersion) continue;
              for (const asset of (rel.assets || [])) {
                if (asset.name && asset.name.toLowerCase().endsWith('.wabbajack')) {
                  broadcastLog('info', `  ✓ Version exacte trouvée : ${asset.name} (${(asset.size / 1048576).toFixed(0)} Mo) — Release ${rel.tag_name}`);
                  return { url: asset.browser_download_url, exactMatch: true };
                }
              }
            }
            broadcastLog('warn', `  ⚠ Version ${targetVersion} introuvable sur GitHub — tentative Nexus Mods…`);
          }
          // -- Passe 2 : prendre la première release disponible (fallback)
          for (const rel of releases) {
            for (const asset of (rel.assets || [])) {
              if (asset.name && asset.name.toLowerCase().endsWith('.wabbajack')) {
                broadcastLog('warn', `  ⚠ GitHub fallback : release ${rel.tag_name} disponible (pas la v${targetVersion}).`);
                return { url: asset.browser_download_url, exactMatch: false };
              }
            }
          }
          broadcastLog('warn', `  ⚠ Aucun asset .wabbajack dans les releases de ${owner}/${repo}`);
        } catch (e) {
          broadcastLog('warn', `  ⚠ GitHub API inaccessible : ${e.message}`);
        }
        return null;
      };

      // Cherche un .wabbajack sur Nexus Mods (via links.websiteURL ou links.nexusCollection)
      // Retourne { url, manualUrl, isPremium } ou null si non trouvé
      const findNexusWabbajack = async (nexusPageUrl) => {
        if (!nexusApiKey) { broadcastLog('warn', `  ⚠ Nexus : clé API manquante — impossible de chercher le .wabbajack`); return null; }
        // Extract game domain + mod ID from URL
        // e.g. https://www.nexusmods.com/skyrimspecialedition/mods/147302
        const nexusMatch = (nexusPageUrl || '').match(/nexusmods\.com\/([a-z0-9]+)\/mods\/(\d+)/);
        if (!nexusMatch) return null;
        const [, gameDomain, modId] = nexusMatch;
        try {
          broadcastLog('info', `🔍 Recherche .wabbajack sur Nexus Mods : ${gameDomain}/mods/${modId}…`);
          const filesData = await nexusFetch(`/v1/games/${gameDomain}/mods/${modId}/files.json`, nexusApiKey);
          const allFiles = filesData?.files || filesData || [];
          // Find the .wabbajack file (usually in category MAIN or OPTIONAL)
          const wjFile = allFiles.find((f) =>
            f.file_name && f.file_name.toLowerCase().endsWith('.wabbajack') &&
            f.category_name !== 'ARCHIVED'
          );
          if (!wjFile) {
            broadcastLog('warn', `  ⚠ Aucun fichier .wabbajack trouvé sur Nexus mods/${modId}`);
            return null;
          }
          const sizeMo = wjFile.size_kb ? `${(wjFile.size_kb / 1024).toFixed(0)} Mo` : '? Mo';
          broadcastLog('info', `  ✓ Trouvé sur Nexus : ${wjFile.file_name} (${sizeMo}) — file_id=${wjFile.file_id}`);
          // Try to get download URL (requires premium for direct link)
          const dlResult = await getNexusDownloadUrl(gameDomain, modId, wjFile.file_id, nexusApiKey);
          if (dlResult.url) {
            broadcastLog('info', `  ✓ URL directe Nexus obtenue (Premium)`);
            return { url: dlResult.url, manualUrl: null, isPremium: true };
          } else {
            const manualUrl = dlResult.manualUrl || `https://www.nexusmods.com/${gameDomain}/mods/${modId}?tab=files&file_id=${wjFile.file_id}`;
            broadcastLog('warn', `  ⚠ Nexus Standard : téléchargement manuel requis`);
            return { url: null, manualUrl, isPremium: false };
          }
        } catch (e) {
          broadcastLog('warn', `  ⚠ Nexus API inaccessible : ${e.message}`);
          return null;
        }
      };

      let localWabbajackPath = null;

      if (rawWabbajackRef && !rawWabbajackRef.startsWith('http') && fs.existsSync(rawWabbajackRef)) {
        // Cas 1 : chemin local
        localWabbajackPath = rawWabbajackRef;
        broadcastLog('info', `📁 Fichier .wabbajack local : ${path.basename(localWabbajackPath)}`);

      } else if (isCdnPageUrl(rawWabbajackRef)) {
        // Cas 2 : URL page CDN — chaîne de fallback :
        //   1. GitHub version EXACTE  →  2. Nexus Mods (Premium)  →  3. GitHub version inexacte  →  4. Manuel
        broadcastLog('warn', `⚠ L'URL CDN Wabbajack est une page web (non téléchargeable directement).`);

        const modLinks  = modlist.links || {};
        const readmeUrl  = modLinks.readme  || '';
        const websiteUrl = modLinks.websiteURL || '';
        const nexusUrl   = [websiteUrl, readmeUrl].find((u) => u && u.includes('nexusmods.com'));

        // Résultat GitHub (peut être exact ou fallback vieille version)
        broadcastLog('info', `  → [1/3] Tentative via GitHub Releases…`);
        const ghResult = await findGithubRelease(readmeUrl || websiteUrl);

        // ── Étape 1 : Version exacte sur GitHub → utiliser directement ────
        if (ghResult && ghResult.exactMatch) {
          broadcastProgress({ currentTask: 'Téléchargement .wabbajack depuis GitHub (version exacte)…', stagePercent: 0 });
          broadcastLog('info', `⬇ Téléchargement depuis GitHub (version exacte) : ${ghResult.url}`);
          const tmpDir = path.join(os.tmpdir(), 'mabbajack');
          makeDirResilient(tmpDir);
          const safeName = path.basename(ghResult.url.split('?')[0]) || 'modlist.wabbajack';
          wabbajackTempPath = path.join(tmpDir, safeName);
          try {
            await downloadFile(ghResult.url, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack téléchargé depuis GitHub : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `✗ Échec téléchargement GitHub : ${dlErr.message}`);
          }
        }

        // ── Étape 2 : Nexus Mods (prioritaire sur GitHub inexact) ──────────
        if (!localWabbajackPath) {
          broadcastLog('info', `  → [2/3] Tentative via Nexus Mods…`);
          const nexusResult = await findNexusWabbajack(nexusUrl);

          if (nexusResult && nexusResult.url) {
            broadcastProgress({ currentTask: 'Téléchargement .wabbajack depuis Nexus Mods…', stagePercent: 0 });
            broadcastLog('info', `⬇ Téléchargement depuis Nexus : ${nexusResult.url.substring(0, 80)}…`);
            const tmpDir = path.join(os.tmpdir(), 'mabbajack');
            makeDirResilient(tmpDir);
            const safeName = `${(modlist.title || modlist.name || 'modlist').replace(/[^a-zA-Z0-9_-]/g, '_')}.wabbajack`;
            wabbajackTempPath = path.join(tmpDir, safeName);
            try {
              await downloadFile(nexusResult.url, wabbajackTempPath, (recv, total) => {
                broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
              }, signal);
              broadcastLog('success', `✓ .wabbajack téléchargé depuis Nexus : ${wabbajackTempPath}`);
              localWabbajackPath = wabbajackTempPath;
            } catch (dlErr) {
              if (signal.aborted) throw new Error('Annulé');
              broadcastLog('error', `✗ Échec téléchargement Nexus : ${dlErr.message}`);
            }
          } else if (nexusResult && nexusResult.manualUrl) {
            broadcastLog('warn', `  ⚠ Compte Nexus Standard — URL de téléchargement manuel : ${nexusResult.manualUrl}`);
          }
        }

        // ── Étape 3 : GitHub version inexacte (dernier recours) ─────────────
        if (!localWabbajackPath && ghResult && ghResult.url) {
          broadcastLog('warn', `  → [3/3] Utilisation de la version GitHub inexacte en dernier recours…`);
          broadcastLog('warn', `  ⚠ ATTENTION : version ${(modlist.version || '?')} introuvable — utilisation d'une version antérieure.`);
          broadcastLog('warn', `  ⚠ Les directives peuvent ne pas correspondre à vos archives téléchargées.`);
          const tmpDir = path.join(os.tmpdir(), 'mabbajack');
          makeDirResilient(tmpDir);
          const safeName = path.basename(ghResult.url.split('?')[0]) || 'modlist.wabbajack';
          wabbajackTempPath = path.join(tmpDir, safeName);
          try {
            await downloadFile(ghResult.url, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} (version inexacte) — ${(recv / 1048576).toFixed(1)} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack (version inexacte) téléchargé : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `✗ Échec : ${dlErr.message}`);
          }
        }

        // ── Aucune source → instructions manuelles ───────────────────────────
        if (!localWabbajackPath) {
          broadcastLog('warn', `⚠ Téléchargement automatique impossible.`);
          broadcastLog('warn', ``);
          broadcastLog('warn', `  ┌─ ACTION REQUISE ──────────────────────────────────────────────────`);
          if (nexusUrl) {
            broadcastLog('warn', `  │ Option A — Nexus Mods (onglet Files) :`);
            broadcastLog('warn', `  │   ${nexusUrl}?tab=files`);
          }
          broadcastLog('warn', `  │ Option ${nexusUrl ? 'B' : 'A'} — CDN Wabbajack (connexion requise) :`);
          broadcastLog('warn', `  │   ${rawWabbajackRef}`);
          broadcastLog('warn', `  │`);
          broadcastLog('warn', `  │ 1. Téléchargez le fichier .wabbajack`);
          broadcastLog('warn', `  │ 2. Chargez-le via 📁 Ouvrir (Inspecteur mABBAJACK)`);
          broadcastLog('warn', `  │ 3. Relancez l'installation`);
          broadcastLog('warn', `  └────────────────────────────────────────────────────────────────────`);
          broadcastLog('warn', `  → Installation continue sans directives (plugins.txt seulement).`);
        }

      } else if (rawWabbajackRef && rawWabbajackRef.startsWith('http')) {
        // Cas 3 : URL directe — vérification content-type avant téléchargement
        try {
          const headRes = await fetch(rawWabbajackRef, { method: 'HEAD', signal });
          const ct = headRes.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            broadcastLog('warn', `⚠ L'URL retourne du HTML, pas un fichier .wabbajack : ${rawWabbajackRef}`);
          } else {
            broadcastLog('info', `⬇ Téléchargement direct .wabbajack…`);
            const tmpDir = path.join(os.tmpdir(), 'mabbajack');
            makeDirResilient(tmpDir);
            const safeName = path.basename(rawWabbajackRef.split('?')[0]) || 'modlist.wabbajack';
            wabbajackTempPath = path.join(tmpDir, safeName);
            await downloadFile(rawWabbajackRef, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack téléchargé : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          }
        } catch (e) {
          if (signal.aborted) throw new Error('Annulé');
          broadcastLog('error', `✗ Erreur téléchargement .wabbajack : ${e.message}`);
        }
      }

      if (localWabbajackPath) {
        try {
          broadcastLog('info', `📁 Lecture du fichier .wabbajack : ${path.basename(localWabbajackPath)}`);
          // Lecture paresseuse (unzip) : un .wabbajack de plusieurs Go ne tient pas dans JSZip / un Buffer
          wabbajackZip = await openLazyZip(localWabbajackPath);
          const entries = Object.keys(wabbajackZip.files).length;
          broadcastLog('success', `✓ .wabbajack chargé (${entries} entrées)`);

          // Always parse directives + archives from the zip (directives are NOT sent in body to avoid 413)
          if (wabbajackZip.files['modlist']) {
            try {
              const modlistJson = JSON.parse(await wabbajackZip.files['modlist'].async('string'));
              const rawDirs = modlistJson.Directives || modlistJson.directives || [];
              const parseDirective = (d) => {
                const ahp = d.ArchiveHashPath || [];
                const len = ahp.length;
                return {
                  $type: d.$type || d.type || 'FromArchive',
                  To: (d.To || d.to || '').replace(/\\/g, '/'),
                  Size: d.Size || 0,
                  Hash: d.Hash || '',
                  ArchiveHash: ahp[0] || d.ArchiveHash || '',
                  SourcePath: len >= 2 ? ahp[1].replace(/\\/g, '/') : (d.SourcePath || '').replace(/\\/g, '/'),
                  BsaInternalPath: len === 3 ? ahp[2].replace(/\\/g, '/') : null,
                  ArchiveHashPath: ahp,
                  PatchID: d.PatchID || d.patchID || '',
                  FromHash: d.FromHash || '',
                  SourceDataID: d.SourceDataID || '',
                  ArchiveName: d.State?.Name || '',
                  // TransformedTexture : état cible (Width, Height, Format, MipLevels)
                  ImageState: d.ImageState || undefined,
                  // CreateBSA
                  TempID: d.TempID || '',
                  FileStates: d.FileStates || undefined,
                  State: d.State || undefined,
                };
              };
              modlist.directives = rawDirs.map(parseDirective);
              manifestRaw ||= modlistJson;
              // Sélection non encore calculée (fichier téléchargé pendant l'installation)
              if (!selection) {
                try {
                  selection = await buildSelection(modlistJson, async (n) => { const f = wabbajackZip.file(n); return f ? f.async('nodebuffer') : null; }, options || {});
                  logSelection(selection);
                } catch (e) {
                  broadcastLog('warn', `⚠ Options non appliquées : ${String(e.message || e).slice(0, 160)}`);
                }
              }
              if (selection) {
                droppedDirectives = modlist.directives.filter((d) => !selection.keep(d.To));
                modlist.directives = modlist.directives.filter((d) => selection.keep(d.To));
              }
              // Only overwrite archives if not already provided with localPath by client scan
              if (!modlist.archives || modlist.archives.length === 0) {
                modlist.archives = (modlistJson.Archives || modlistJson.archives || []).map((a) => ({
                  Hash: a.Hash || '', Name: a.Name || '', Size: a.Size || 0, State: a.State || {}, status: 'missing',
                }));
              }
              broadcastLog('info', `📋 Directives parsées : ${modlist.directives.length} directives, ${modlist.archives.length} archives`);
            } catch (parseErr) {
              broadcastLog('warn', `⚠ Impossible de parser modlist depuis zip : ${parseErr.message}`);
            }
          }
        } catch (zipErr) {
          broadcastLog('warn', `⚠ Impossible de charger le .wabbajack : ${zipErr.message}`);
          if (wabbajackTempPath && fs.existsSync(wabbajackTempPath)) {
            broadcastLog('warn', `  Taille : ${(fs.statSync(wabbajackTempPath).size / 1024).toFixed(0)} Ko — probablement pas un ZIP valide.`);
          }
        }
      } else if (!rawWabbajackRef) {
        broadcastLog('warn', `⚠ Aucune référence .wabbajack — les directives InlineFile seront ignorées.`);
        broadcastLog('warn', `  Chargez le .wabbajack via le bouton 📁 dans l'Inspecteur.`);
      }

      // ── MODE GALERIE : reconstruire archiveStatuses depuis le zip ────────────
      // En mode galerie, archives = [] à l'origine. Après chargement du
      // wabbajack, modlist.archives contient les vraies archives. On les
      // scanne dans DOWNLOADS pour savoir lesquelles sont présentes.
      if (modlist.archives && modlist.archives.length > 0 && archiveStatuses.length === 0) {
        broadcastLog('info', `🔄 Reconstruction de la liste des archives depuis le .wabbajack…`);
        archiveStatuses = modlist.archives.filter(notSkipped).map((arc) => ({ ...arc, Name: arc.Name || arc.name || '', status: 'missing', localPath: null }));
        archiveStatuses = resolveGameFiles(archiveStatuses);
        archiveStatuses = await verifyArchiveFiles(archiveStatuses);
        const ready2 = archiveStatuses.filter((a) => a.status === 'ready').length;
        const miss2  = archiveStatuses.filter((a) => a.status === 'missing').length;
        broadcastLog('info', `  → ${archiveStatuses.length} archives : ${ready2} présentes, ${miss2} manquantes.`);
      }

      // ── Analyse d'impact des archives manquantes ───────────────────────────
      // Pour chaque archive absente : nombre de fichiers de la modlist qui en
      // dépendent et mods concernés (dossier mods/<Nom>/…).
      const missingReport = archiveStatuses
        .filter((a) => a.status !== 'ready')
        .map((a) => ({ arc: a, files: 0, mods: new Map() }));
      if (missingReport.length > 0) {
        const byHash = new Map(missingReport.map((m) => [m.arc.Hash, m]));
        for (const d of (modlist.directives || [])) {
          const h = d.ArchiveHash || d.ArchiveHashPath?.[0];
          const m = h && byHash.get(h);
          if (!m) continue;
          m.files++;
          const parts = String(d.To || '').replace(/\\/g, '/').split('/');
          const mod = parts[0].toLowerCase() === 'mods' && parts[1] ? parts[1] : (parts.length > 1 ? parts[0] : '(racine)');
          m.mods.set(mod, (m.mods.get(mod) || 0) + 1);
        }
        // Annoncé AVANT le déploiement : aucune directive n'est sautée en silence.
        const lost = missingReport.reduce((s, m) => s + m.files, 0);
        broadcastLog('warn', `⚠ Avant déploiement : ${missingReport.length} archive(s) absente(s) ou incorrecte(s) — ${lost} fichier(s) de la modlist ne pourront pas être installés :`);
        for (const m of [...missingReport].sort((x, y) => y.files - x.files)) {
          const label = isGameFileArchive(m.arc) ? `${path.basename(gameFileRel(m.arc))} (fichier du jeu)` : m.arc.Name;
          if (m.arc.wrongVersion) broadcastLog('warn', `  • ${label} — mauvaise version — ${m.files} directive(s)`);
          else broadcastLog('warn', `  • ${label} — absente — ${m.files} directive(s)`);
        }
      }

      // ── ÉTAPE 4 : TRAITEMENT DES DIRECTIVES ──────────────────────────
      let directives = modlist.directives || [];
      setGameRootFolders(detectGameRootFolders(directives));
      const extraRoots = [...getGameRootFolders()].filter((g) => !KNOWN_GAME_ROOT_NAMES.includes(g));
      if (extraRoots.length) broadcastLog('info', `🎮 Dossier(s) de jeu de l'instance MO2 : ${extraRoots.join(', ')} → racine de l'installation.`);
      // Priorités MO2 : un même fichier fourni par plusieurs mods → le mod le plus prioritaire l'emporte
      if (selection && selection.priority.size > 0 && directives.length > 0) {
        const dd = dedupeByPriority(directives, (d) => resolveDirectivePath(d.To, cleanDest), selection.priority);
        directives = dd.directives;
        if (dd.removed > 0) broadcastLog('info', `⚖ Priorités MO2 : ${dd.removed} fichier(s) en conflit résolus (le mod le plus prioritaire l'emporte).`);
      }
      const installedDirectives = directives; // liste complète : instantané de fin d'installation
      if (updatePlan) {
        if (updatePlan.removed.length > 0) {
          const n = removeFiles(updatePlan.removed, cleanDest);
          broadcastLog('info', `🗑 ${n} fichier(s) retiré(s) de la liste supprimé(s).`);
        }
        directives = directives.filter((d) => !updatePlan.skip.has(String(d.To || '').replace(/\\/g, '/').toLowerCase()));
        broadcastLog('info', `🔄 Mise à jour : ${directives.length} directive(s) à traiter, ${installedDirectives.length - directives.length} fichier(s) inchangé(s) conservé(s).`);
      }
      let directivesProcessed = 0;
      let installCheck = null;

      if (directives.length > 0) {
        broadcastProgress({
          stage: 'extracting_files',
          stageName: 'Déploiement des directives (extraction sélective)',
          overallPercent: 40,
          processedItems: 0,
          totalItems: directives.length,
          currentTask: `Traitement de ${directives.length} directive(s) Wabbajack…`,
        });

        const result = await processDirectives({
          directives,
          archiveStatuses,
          destRoot: cleanDest,
          wabbajackZip,
          sevenZipBin,
          unarBin,
          texconvBin,
          signal,
          gamePath: gamePath || '',
          downloadsPath: downloadsPath || '',
          onProgress: (() => {
            const startTime = Date.now();
            const totalBytes = directives.reduce((s, d) => s + (d.Size || 0), 0);
            return (done, total, doneBytes = 0) => {
              directivesProcessed = done;
              const pct = 40 + Math.round((done / Math.max(1, total)) * 45);
              const elapsedSec = (Date.now() - startTime) / 1000;
              const speed = elapsedSec > 2 ? doneBytes / elapsedSec : 0;
              const remaining = speed > 0 ? (totalBytes - doneBytes) / speed : 0;
              broadcastProgress({
                overallPercent: Math.min(85, pct),
                processedItems: done,
                totalItems: total,
                processedBytes: doneBytes,
                totalBytes,
                speedBytesPerSec: Math.round(speed),
                etaSeconds: Math.round(remaining),
                currentTask: `Directive ${done}/${total} — ${path.basename((directives[done - 1]?.To || '?').replace(/\\/g, '/'))}`,
              });
            };
          })(),
        });

        broadcastLog('success', `✓ Directives : ${result.processed} traitée(s), ${result.skipped} ignorée(s), ${result.errors} erreur(s).`);
        directivesProcessed = result.processed;

        // ── Contrôle post-installation : chaque fichier mods/<mod>/… doit exister avec la bonne taille ──
        broadcastProgress({ stage: 'extracting_files', stageName: 'Contrôle de l\'installation', overallPercent: 86, currentTask: 'Contrôle des fichiers installés…' });
        try {
          const lostHashes = new Set(missingReport.map((m) => m.arc.Hash).filter(Boolean));
          // Fichiers des mods et du dossier du jeu de l'instance (« Game Root/ », « Stock Game/ »…)
          const rootFolders = new Set([...getGameRootFolders()].map((n) => n.toLowerCase()));
          const isGameRootOut = (to) => rootFolders.has(String(to || '').replace(/\\/g, '/').split('/')[0].toLowerCase());
          const toCheck = directives.filter((d) => (modOf(d.To) || isGameRootOut(d.To)) && !/Remapped/i.test(d.$type || ''));
          const chk = await verifyInstalledFiles(toCheck, (to) => resolveDirectivePath(to, cleanDest), {
            signal,
            onProgress: (done, total) => broadcastProgress({ currentTask: `Contrôle des fichiers installés : ${done}/${total}`, stagePercent: Math.round((done / Math.max(1, total)) * 100) }),
          });
          const archOf = new Map(toCheck.map((d) => [d.To, d.ArchiveHash]));
          const explained = chk.missing.filter((m) => lostHashes.has(archOf.get(m.to)));
          const unexplained = chk.missing.filter((m) => !lostHashes.has(archOf.get(m.to)));
          // Fichiers de mods désactivés présents malgré tout (installation précédente dans le même dossier…)
          const stray = await findStrayFiles(droppedDirectives, directives, (to) => resolveDirectivePath(to, cleanDest), { signal });
          installCheck = { checked: chk.checked, explained, unexplained, wrongSize: chk.wrongSize, stray };
          if (stray.length > 0) {
            const strayMods = [...new Set(stray.map((x) => x.mod))];
            broadcastLog('warn', `⚠ ${stray.length} fichier(s) de ${strayMods.length} mod(s) désactivé(s) présent(s) dans l'installation : ${strayMods.slice(0, 8).join(', ')}${strayMods.length > 8 ? '…' : ''}`);
            broadcastLog('warn', `  → Restes d'une installation précédente : videz le dossier d'installation avant de relancer (liste dans CONTROLE_INSTALLATION.txt).`);
          }
          const bad = unexplained.length + chk.wrongSize.length;
          broadcastLog(bad === 0 && explained.length === 0 ? 'success' : 'warn',
            `🔍 Contrôle : ${chk.checked} fichier(s) vérifié(s) — ${explained.length} absent(s) à cause d'archives manquantes, ${unexplained.length} autre(s) absent(s), ${chk.wrongSize.length} de taille différente.`);
          const byMod = new Map();
          for (const m of [...unexplained, ...chk.wrongSize]) byMod.set(m.mod, (byMod.get(m.mod) || 0) + 1);
          for (const [mod, n] of [...byMod.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) broadcastLog('warn', `  • ${mod} : ${n} fichier(s) absent(s) ou différent(s)`);
          if (byMod.size > 15) broadcastLog('warn', `  … et ${byMod.size - 15} autre(s) mod(s) — détail dans CONTROLE_INSTALLATION.txt`);
        } catch (e) {
          if (signal.aborted) throw e;
          broadcastLog('warn', `⚠ Contrôle post-installation impossible : ${String(e.message || e).slice(0, 160)}`);
        }
      } else if (updatePlan) {
        broadcastLog('success', `✓ Aucun fichier à mettre à jour : l'installation est déjà à jour.`);
      } else {
        broadcastLog('warn', `⚠ Aucune directive — installation plugins.txt seulement.`);
      }

      // ── Instantané de l'installation : base de comparaison des prochaines mises à jour ──
      if (manifestRaw && installedDirectives.length > 0) {
        broadcastProgress({ currentTask: 'Enregistrement de l\'état de l\'installation…' });
        try {
          const r = await writeSnapshot(cleanDest, {
            raw: manifestRaw, wabbajackPath: earlyFile || '', installed: installedDirectives,
            resolve: (d) => resolveDirectivePath(d.To, cleanDest), signal,
            options: { profile: selection?.profile || null, enable: options?.enable || [], choices: options?.choices || {} },
          });
          broadcastLog('success', `✓ État de l'installation enregistré (${r.files} fichier(s)) : base des prochaines mises à jour.`);
        } catch (e) {
          if (signal.aborted) throw e;
          broadcastLog('warn', `⚠ État de l'installation non enregistré : ${String(e.message || e).slice(0, 160)}`);
        }
      }

      // ── ÉTAPE 5 : plugins.txt & loadorder.txt ─────────────────────
      broadcastProgress({ stage: 'generating_mo2', stageName: 'Génération plugins.txt', overallPercent: 90, currentTask: 'Écriture des fichiers de configuration Skyrim...' });

      // Use the plugins.txt extracted from inline directives if available, otherwise reconstruct
      let pluginsContent = '';
      const pluginsTxtFile = path.join(cleanDest, 'plugins.txt');
      if (fs.existsSync(pluginsTxtFile)) {
        pluginsContent = fs.readFileSync(pluginsTxtFile, 'utf-8');
        broadcastLog('info', `📄 plugins.txt récupéré depuis les directives inline.`);
      } else {
        pluginsContent = modlist.pluginsTxt || '';
        if (!pluginsContent.trim()) {
          const cores = ['*Skyrim.esm', '*Update.esm', '*Dawnguard.esm', '*HearthFires.esm', '*Dragonborn.esm'];
          const extras = directives.map((d) => path.basename((d.To || '').replace(/\\/g, '/'))).filter((f) => /\.(esp|esm|esl)$/i.test(f)).filter((f, i, a) => a.indexOf(f) === i).map((f) => `*${f}`);
          pluginsContent = [...cores, ...extras.filter((p) => !cores.includes(p))].join('\n');
        }
      }

      // Plugins des mods optionnels non installés : retirés de plugins.txt
      if (selection && selection.pluginsExcluded.size > 0) {
        const lines = pluginsContent.split('\n');
        const kept = lines.filter((l) => !selection.pluginsExcluded.has(l.replace(/^\*/, '').trim().toLowerCase()));
        if (kept.length < lines.length) {
          broadcastLog('info', `ℹ ${lines.length - kept.length} plugin(s) de mods ignorés retirés de plugins.txt.`);
          pluginsContent = kept.join('\n');
        }
      }
      // Plugins des mods activés par l'utilisateur (options, autre famille d'interface…) :
      // absents ou inactifs dans le plugins.txt du profil → activés, ajoutés en fin de liste.
      if (selection && selection.pluginsAdded?.size > 0) {
        const lines = pluginsContent.split('\n');
        const seen = new Set();
        let added = 0;
        const next = lines.map((l) => {
          const key = l.replace(/^\*/, '').trim().toLowerCase();
          if (!selection.pluginsAdded.has(key)) return l;
          seen.add(key);
          if (l.startsWith('*')) return l;
          added++;
          return `*${l.trim()}`;
        });
        for (const [key, name] of selection.pluginsAdded) if (!seen.has(key)) { next.push(`*${name}`); added++; }
        if (added > 0) {
          broadcastLog('info', `ℹ ${added} plugin(s) de mods activés par vos choix ajoutés à plugins.txt.`);
          pluginsContent = next.join('\n');
        }
      }
      if (selection && selection.profileItems.length > 0) {
        const ml = renderModlistTxt(selection);
        fs.writeFileSync(path.join(cleanDest, 'modlist.txt'), ml.text, 'utf-8');
        broadcastLog('info', `📝 modlist.txt écrit (${ml.active} mod(s) actifs).`);
      }

      lastGeneratedPluginsTxt = pluginsContent;
      const loadOrderContent = pluginsContent.split('\n').map((l) => l.replace(/^\*/, '')).filter((l) => l && !l.startsWith('#')).join('\n');
      const pluginCount = loadOrderContent.split('\n').filter(Boolean).length;

      fs.writeFileSync(path.join(cleanDest, 'plugins.txt'), pluginsContent, 'utf-8');
      fs.writeFileSync(path.join(cleanDest, 'loadorder.txt'), loadOrderContent, 'utf-8');

      const expected = (modlist.gameType || modlist.skyrimVersion || modlist.archives?.length) ? getExpectedSkyrimVersion(modlist.gameType, modlist.skyrimVersion, modlist.archives) : { label: 'Skyrim', versionHint: '?' };
      const readme = [
        `======================================================================`,
        ` mABBAJACK v3 — READY TO PLAY`,
        ` Modlist  : ${modlist.name} v${modlist.version || '?'}`,
        ` Jeu cible : ${expected.label} (${expected.versionHint})`,
        `======================================================================`,
        ``,
        `COMMENT UTILISER CET INSTALLATION :`,
        `  Ce dossier contient exactement les fichiers que l'auteur de la`,
        `  modlist a sélectionnés via FOMOD et Mod Organizer 2.`,
        `  Chaque fichier a été extrait précisément selon les directives`,
        `  du fichier .wabbajack (FromArchive, InlineFile, PatchedFromArchive).`,
        ``,
        `  1. Copiez le contenu de ce dossier dans votre Skyrim/Data/`,
        `  2. Copiez plugins.txt vers :`,
        `       ~/Library/Application Support/Skyrim Special Edition/plugins.txt`,
        `  3. Lancez SKSE64 (version ${expected.versionHint})`,
        ``,
        `STATISTIQUES :`,
        `  Archives téléchargées : ${downloadedCount}`,
        `  Directives traitées   : ${directivesProcessed} / ${directives.length}`,
        `  Plugins actifs        : ${pluginCount}`,
        `  Fichiers sources manquants : ${missingReport.length} (${missingReport.reduce((s, m) => s + m.files, 0)} fichier(s) de la modlist non installés)`,
        ...missingReport.map((m) => `    - ${isGameFileArchive(m.arc) ? `[JEU] ${expectedGameFilePath(m.arc, gamePath)}` : `[MOD] ${m.arc.Name}${m.arc.wrongVersion ? ' [MAUVAISE VERSION]' : ''}${(manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc)) ? ` — ${manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc)}` : ''}`} (${m.files} fichier(s))`),
        ...(installCheck ? [`  Contrôle des fichiers  : ${installCheck.checked} vérifiés, ${installCheck.explained.length + installCheck.unexplained.length} absents, ${installCheck.wrongSize.length} de taille différente, ${(installCheck.stray || []).length} de mods désactivés (voir CONTROLE_INSTALLATION.txt)`] : []),
        `  Généré le             : ${new Date().toLocaleString('fr-FR')}`,
        `======================================================================`,
      ].join('\n');
      fs.writeFileSync(path.join(cleanDest, 'README_READY_TO_PLAY.txt'), readme, 'utf-8');
      if (installCheck) {
        const sect = (title, rows) => rows.length ? [``, `${title} (${rows.length}) :`, ...rows] : [];
        fs.writeFileSync(path.join(cleanDest, 'CONTROLE_INSTALLATION.txt'), [
          `Contrôle de l'installation — ${modlist.name} v${modlist.version || '?'} — ${new Date().toLocaleString('fr-FR')}`,
          `Fichiers vérifiés : ${installCheck.checked}`,
          ...sect('ARCHIVES ABSENTES OU INCORRECTES', missingReport.map((m) => `  ${isGameFileArchive(m.arc) ? path.basename(gameFileRel(m.arc)) : m.arc.Name} — ${m.arc.wrongVersion ? `mauvaise version : ${describeWrongVersion(m.arc)}` : 'absente'} — ${m.files} directive(s)${archiveSourceUrl(m.arc) ? ` — ${archiveSourceUrl(m.arc)}` : ''}`)),
          ...sect('ABSENTS (archive manquante)', installCheck.explained.map((m) => `  ${m.to}`)),
          ...sect('ABSENTS (cause inconnue)', installCheck.unexplained.map((m) => `  ${m.to}`)),
          ...sect('TAILLE DIFFÉRENTE', installCheck.wrongSize.map((m) => `  ${m.to} — ${m.actual} o au lieu de ${m.expected} o`)),
          ...sect('FICHIERS DE MODS DÉSACTIVÉS (à supprimer)', (installCheck.stray || []).map((m) => `  ${m.path}  ← ${m.mod}`)),
        ].join('\n') + '\n', 'utf-8');
      }

      broadcastLog('success', `✓ plugins.txt (${pluginCount} plugins) écrit.`);
      broadcastLog('success', `✓ loadorder.txt et README créés.`);

      // Fichier repère : nom = version de Skyrim requise par la collection
      try {
        const verName = `${expected.label} ${expected.versionHint}`
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Skyrim';
        fs.writeFileSync(path.join(cleanDest, `${verName}.txt`), [
          `${expected.label} — version requise : ${expected.versionHint}`,
          `Collection : ${modlist.name} v${modlist.version || '?'}`,
        ].join('\n') + '\n', 'utf-8');
        broadcastLog('success', `✓ Fichier de version créé : ${verName}.txt`);
      } catch (e) {
        broadcastLog('warn', `⚠ Fichier de version non créé : ${String(e.message).slice(0, 120)}`);
      }

      // ── Nettoyage fichier .wabbajack temporaire ─────────────────────
      if (wabbajackTempPath) {
        try { fs.unlinkSync(wabbajackTempPath); } catch { /* ignore */ }
      }

      // ── TERMINÉ ────────────────────────────────────────────────────
      broadcastProgress({ stage: 'completed', stageName: 'Déploiement terminé !', overallPercent: 100, stagePercent: 100, processedItems: directives.length, totalItems: directives.length, currentTask: `✅ "${modlist.name}" prêt dans "${cleanDest}"`, speedBytesPerSec: 0, etaSeconds: 0, hasError: false, errorMessage: null });

      broadcastLog('success', `\n═══════════════════════════════════════════════════`);
      broadcastLog('success', `  🎉 Déploiement terminé — "${modlist.name}"`);
      broadcastLog('success', `  📁 ${cleanDest}`);
      if (missingReport.length > 0) {
        const lostFiles = missingReport.reduce((s, m) => s + m.files, 0);
        const hasGame = missingReport.some((m) => isGameFileArchive(m.arc));
        const hasMod = missingReport.some((m) => !isGameFileArchive(m.arc));
        broadcastLog('warn', ``);
        broadcastLog('warn', `⚠ ${missingReport.length} fichier(s) source introuvable(s) — ${lostFiles} fichier(s) de la modlist n'ont pas été installés :`);
        for (const m of missingReport) {
          const mods = [...m.mods.entries()].sort((x, y) => y[1] - x[1]);
          const modsTxt = mods.slice(0, 3).map(([n]) => `"${n}"`).join(', ') + (mods.length > 3 ? ` (+${mods.length - 3})` : '');
          if (isGameFileArchive(m.arc)) {
            broadcastLog('warn', `  • ${path.basename(gameFileRel(m.arc))} — fichier original du jeu (${m.arc.State?.Game || 'Skyrim'} ${m.arc.State?.GameVersion || ''})`.trimEnd());
            broadcastLog('warn', `      Emplacement attendu : ${expectedGameFilePath(m.arc, gamePath)}`);
          } else {
            if (m.arc.wrongVersion) broadcastLog('warn', `  • ${m.arc.Name} — mauvaise version : ${describeWrongVersion(m.arc)}`);
            else broadcastLog('warn', `  • ${m.arc.Name} — archive de mod`);
            const url = manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc);
            if (url) broadcastLog('warn', `      Téléchargement : ${url}`);
            else broadcastLog('warn', `      Téléchargement : source inconnue`);
          }
          if (m.files > 0) broadcastLog('warn', `      Impact : ${m.files} fichier(s) manquant(s) dans ${modsTxt}`);
          else broadcastLog('warn', `      Impact : aucun fichier de la modlist n'en dépend`);
        }
        if (lostFiles > 0) broadcastLog('warn', `  ℹ Conséquence : le jeu démarrera, mais les mods listés ci-dessus seront incomplets.`);
        if (hasGame) broadcastLog('warn', `  → Fichiers du jeu : indiquez le dossier du jeu (celui qui contient Data/) dans « Dossier du jeu Skyrim », puis relancez le déploiement.`);
        if (hasMod && missingReport.some((m) => m.arc.wrongVersion)) broadcastLog('warn', `  → Archives de mods : téléchargez-les, placez-les sous leur nom exact dans le dossier dédié à la liste ${dedicatedDir} (prioritaire sur le cache commun), puis relancez le déploiement.`);
        else if (hasMod) broadcastLog('warn', `  → Archives de mods : téléchargez-les, placez-les dans ${cleanDownloads} sous leur nom exact, puis relancez le déploiement.`);
      }
      broadcastLog('success', `═══════════════════════════════════════════════════`);
      currentInstallJob.active = false;
      notifyMac(uiLanguage, 'done', modlist.name);

    } catch (err) {
      const msg = err.message || String(err);
      // Nettoyage du fichier .wabbajack temporaire même en cas d'erreur
      if (wabbajackTempPath) {
        try { fs.unlinkSync(wabbajackTempPath); } catch { /* ignore */ }
      }
      if (signal.aborted) {
        broadcastProgress({ stage: 'idle', stageName: 'Annulé', overallPercent: 0, hasError: false, currentTask: 'Annulé.' });
        broadcastLog('warn', '⛔ Annulé.');
      } else {
        broadcastProgress({ stage: 'error', stageName: "Erreur d'installation", overallPercent: currentInstallJob.progress.overallPercent || 5, hasError: true, errorMessage: msg, currentTask: `Échec : ${msg}` });
        broadcastLog('error', `❌ ${msg}`);
        writeLog({ level: 'debug', message: 'Pile de l\'erreur fatale', details: err?.stack || null });
        notifyMac(uiLanguage, 'failed', modlist.name);
      }
      currentInstallJob.active = false;
    } finally {
      if (currentInstallJob.abortController === abortController) {
        jobControl.paused = false;
        jobControl.cancel();
      }
      writeLog({ level: 'debug', message: `Fin du job d'installation — étape finale : ${currentInstallJob.progress?.stage}` });
      endInstallLog();
    }
  })();
});

// Serve built frontend — no-cache on HTML, long-cache on hashed assets
const distDir = [path.join(__dirname, '../dist'), path.join(__dirname, '../../dist')].find((d) => fs.existsSync(d)) || path.join(__dirname, '../dist');
if (fs.existsSync(distDir)) {
  // Hashed JS/CSS assets: long cache (Vite names them with content hash)
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    maxAge: '1y',
    etag: false,
  }));
  // index.html: never cache
  app.use(express.static(distDir, { etag: false, maxAge: 0 }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const httpServer = app.listen(PORT, HOST, () => console.log(`[mABBAJACK Server] v3.0 (Directive Engine) actif sur http://${HOST}:${PORT}`));
// Envoi d'un .wabbajack de plusieurs Go (navigateur sans chemin de fichier) : pas de délai de 300 s par requête.
httpServer.requestTimeout = 0;
httpServer.timeout = 0;
