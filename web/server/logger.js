// ──────────────────────────────────────────────────────────
// Journal persistant des opérations (serveur + interface)
//
//   logs/mabbajack.log              journal continu (rotation 20 Mo × 5)
//   logs/installs/<date>_<nom>.log  un fichier complet par installation
//
// Écriture synchrone non bufferisée (fs.writeSync) : aucune entrée perdue,
// même si le processus est tué brutalement. Toute erreur d'écriture est
// silencieuse pour ne jamais interrompre une installation.
// ──────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const MAX_MAIN_BYTES = 20 * 1024 * 1024;
const MAX_ROTATIONS = 5;
const MAX_INSTALL_LOGS = 30;
const LEVELS = new Set(['info', 'success', 'warn', 'error', 'debug']);

let logDir = null;
let mainPath = null;
let mainFd = null;
let mainBytes = 0;
let installFd = null;
let installPath = null;

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function safeClose(fd) { try { if (fd !== null) fs.closeSync(fd); } catch { /* ignore */ } }

function openMain() {
  mainFd = fs.openSync(mainPath, 'a');
  try { mainBytes = fs.fstatSync(mainFd).size; } catch { mainBytes = 0; }
}

function rotateMain() {
  safeClose(mainFd);
  mainFd = null;
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = path.join(logDir, `mabbajack.${i}.log`);
    const to = path.join(logDir, `mabbajack.${i + 1}.log`);
    try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch { /* ignore */ }
  }
  try { fs.renameSync(mainPath, path.join(logDir, 'mabbajack.1.log')); } catch { /* ignore */ }
  openMain();
}

/** Formate une entrée : horodatage, niveau, source, message (multi-lignes indentées), détails. */
function formatEntry({ level, message, details, source, at }) {
  const lvl = (LEVELS.has(level) ? level : 'info').toUpperCase().padEnd(7);
  const src = String(source || 'server').padEnd(6);
  const head = `${stamp(at)} [${lvl}] [${src}] `;
  const indent = ' '.repeat(head.length);
  const body = String(message ?? '').replace(/\r\n?/g, '\n').split('\n').join(`\n${indent}`);
  let line = head + body;
  if (details !== null && details !== undefined && details !== '') {
    const det = typeof details === 'string' ? details : JSON.stringify(details);
    line += `\n${indent}↳ ${det.replace(/\r\n?/g, '\n').split('\n').join(`\n${indent}  `)}`;
  }
  return `${line}\n`;
}

function writeFd(fd, text) {
  if (fd === null) return 0;
  try { return fs.writeSync(fd, text); } catch { return 0; }
}

/** Initialise le dossier de logs (MABBAJACK_LOG_DIR ou <projet>/logs). */
export function initLogger(projectRoot) {
  try {
    logDir = path.resolve(process.env.MABBAJACK_LOG_DIR || path.join(projectRoot, 'logs'));
    fs.mkdirSync(path.join(logDir, 'installs'), { recursive: true });
    mainPath = path.join(logDir, 'mabbajack.log');
    openMain();
    writeFd(mainFd, `\n${'═'.repeat(78)}\n${stamp()}  Démarrage du serveur mABBAJACK (pid ${process.pid}, node ${process.version})\n${'═'.repeat(78)}\n`);
  } catch (err) {
    logDir = null;
    console.error('[mABBAJACK] Journal fichier désactivé :', err.message);
  }
  return logDir;
}

/** Écrit une entrée dans le journal continu et, si actif, dans le journal d'installation. */
export function writeLog(entry) {
  if (!logDir) return;
  const text = formatEntry({ ...entry, at: entry.at || new Date() });
  if (mainFd !== null) {
    if (mainBytes + text.length > MAX_MAIN_BYTES) rotateMain();
    mainBytes += writeFd(mainFd, text);
  }
  writeFd(installFd, text);
}

/** Ouvre un fichier dédié à une installation. Retourne son chemin. */
export function startInstallLog(name) {
  if (!logDir) return null;
  endInstallLog();
  const d = new Date();
  const safe = String(name || 'modlist').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'modlist';
  installPath = path.join(logDir, 'installs',
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${safe}.log`);
  try {
    installFd = fs.openSync(installPath, 'a');
  } catch {
    installFd = null;
    installPath = null;
    return null;
  }
  pruneInstallLogs();
  return installPath;
}

/** Ferme le fichier d'installation en cours. */
export function endInstallLog() {
  safeClose(installFd);
  installFd = null;
  const p = installPath;
  installPath = null;
  return p;
}

function pruneInstallLogs() {
  try {
    const dir = path.join(logDir, 'installs');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_INSTALL_LOGS))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export function getLogInfo() {
  return { dir: logDir, main: mainPath, install: installPath };
}

/** Lit les N dernières lignes du journal continu (ou du dernier fichier d'installation). */
export function tailLog({ lines = 500, which = 'main' } = {}) {
  if (!logDir) return '';
  let file = mainPath;
  if (which === 'install') {
    try {
      const dir = path.join(logDir, 'installs');
      const last = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort().pop();
      file = last ? path.join(dir, last) : null;
    } catch { file = null; }
  }
  if (!file || !fs.existsSync(file)) return '';
  const n = Math.min(Math.max(parseInt(lines, 10) || 500, 1), 20000);
  const size = fs.statSync(file).size;
  const chunk = Math.min(size, n * 400);
  const buf = Buffer.alloc(chunk);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, chunk, size - chunk); } finally { fs.closeSync(fd); }
  return buf.toString('utf8').split('\n').slice(-n - 1).join('\n');
}
