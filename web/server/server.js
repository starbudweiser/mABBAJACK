import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { jobControl, shutdown } from './jobcontrol.js';
import https from 'https';
import multer from 'multer';
import { buildOptions, loadRawModlist, readZipEntry } from './modprofile.js';
import { inspectWabbajack as inspectWabbajackRaw } from './inspect.js';
import { recordGameVersion, enrichCatalog } from './gameversions.js';
import { locateWabbajack } from './locate.js';
import { resolveDirectivePath, detectGameRootFolders, setGameRootFolders } from './paths.js';
import { compareWithInstalled, readSnapshot, writeSnapshot, inferOptions } from './update.js';
import { findUnusedDownloads, moveToTrash } from './cleanup.js';
import { initLogger, writeLog, getLogInfo, tailLog } from './logger.js';
import { sseClients, logHistory, currentInstallJob, broadcastLog, broadcastProgress } from './events.js';
import { getExpectedSkyrimVersion, isGameFileArchive, isIgnorableGameFile, resolveGameFileArchive, expectedGameFilePath, detectSkyrimAtPath } from './gamefiles.js';
import { nexusPremiumCache } from './nexus.js';
import { find7z } from './tools.js';
import { startInstall } from './install.js';
import { APP_VERSION, NEXUS_APP_HEADERS } from './version.js';
import { readKey, saveKey, deleteKey } from './keychain.js';
import { handleNxm, parseNxm, setNxmTarget, nxmHandler, claimNxmHandler } from './nxm.js';

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

let cachedModlists = null;

/** Analyse un .wabbajack et mémorise sa version de jeu exacte (alimente la galerie). */
async function inspectWabbajack(...args) {
  const info = await inspectWabbajackRaw(...args);
  if (info?.gameVersion) recordGameVersion(info.name, info.gameVersion);
  return info;
}
let lastModlistsFetch = 0;
// Translation cache: key = `${lang}:${text}` → translated string
const translateCache = new Map();


// ──────────────────────────────────────────────────────────
// Download helper
// ──────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), platform: process.platform, arch: process.arch, version: APP_VERSION, sevenZip: find7z() || 'NOT FOUND — brew install sevenzip' });
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

// Clé Nexus : rangée dans le trousseau macOS (l'interface ne la garde plus dans son stockage local).
app.get('/api/nexus/key', async (_req, res) => res.json({ key: await readKey() }));
app.put('/api/nexus/key', async (req, res) => {
  const key = String(req.body?.key || '').trim();
  try { await (key ? saveKey(key) : deleteKey()); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ ok: false, error: String(err.message || err) }); }
});

// Liens nxm:// transmis par l'application (gestionnaire de liens macOS) ; le téléchargement continue en tâche de fond.
app.post('/api/nexus/nxm', async (req, res) => {
  const url = String(req.body?.url || '');
  if (!parseNxm(url)) return res.status(400).json({ ok: false, error: 'Lien nxm invalide' });
  // Au premier lancement après la mise à jour, l'interface déplace encore l'ancienne clé dans le trousseau
  let key = await readKey();
  for (let i = 0; !key && i < 10; i++) { await new Promise((r) => setTimeout(r, 500)); key = await readKey(); }
  if (!key) { broadcastLog('warn', '⚠ Lien nxm reçu, mais aucune clé API Nexus n\'est enregistrée'); return res.status(400).json({ ok: false, error: 'Clé API Nexus absente' }); }
  res.status(202).json({ ok: true });
  handleNxm(url, key).catch(() => { /* déjà signalé dans le journal */ });
});
app.get('/api/nexus/nxm-handler', async (_req, res) => res.json(await nxmHandler()));
app.post('/api/nexus/nxm-handler', async (_req, res) => res.json(await claimNxmHandler()));
app.put('/api/nexus/nxm-target', (req, res) => { setNxmTarget(String(req.body?.downloadsPath || '')); res.json({ ok: true }); });

app.post('/api/nexus/check-key', async (req, res) => {
  const { key } = req.body;
  if (!key?.trim()) return res.status(400).json({ valid: false, error: 'Clé absente' });
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api.nexusmods.com/v1/users/validate.json', {
      headers: { apikey: key.trim(), ...NEXUS_APP_HEADERS }, signal: ctrl.signal,
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
  req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
});

app.get('/api/install/plugins-txt', (req, res) => res.json({ pluginsTxt: currentInstallJob.pluginsTxt || '' }));

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


app.post('/api/install/start', startInstall);

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
