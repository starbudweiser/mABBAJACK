// Liens nxm:// (bouton « Mod Manager Download » du site Nexus) : un compte gratuit obtient un lien de
// téléchargement avec la clé et l'expiration contenues dans le lien, sans téléchargement à la main.
// Format : nxm://<jeu>/mods/<mod>/files/<fichier>?key=<k>&expires=<t>&user_id=<u>
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { nexusFetch } from './nexus.js';
import { downloadHttp } from './downloaders.js';
import { broadcastLog, broadcastSSE } from './events.js';

/** { game, modId, fileId, key, expires } ou null si ce n'est pas un lien de fichier nxm valide. */
export function parseNxm(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'nxm:') return null;
  const m = u.pathname.match(/^\/mods\/(\d+)\/files\/(\d+)\/?$/);
  if (!u.hostname || !/^[a-z0-9]+$/i.test(u.hostname) || !m) return null;
  const key = u.searchParams.get('key') || '';
  const expires = u.searchParams.get('expires') || '';
  if (!/^[A-Za-z0-9_-]+$/.test(key) || !/^\d+$/.test(expires)) return null;
  return { game: u.hostname.toLowerCase(), modId: Number(m[1]), fileId: Number(m[2]), key, expires };
}

/** Nom de fichier sûr : jamais de dossier, jamais de chemin relatif. */
export function safeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f]/g, '').trim();
  return base && base !== '.' && base !== '..' ? base : '';
}

// Dossier où ranger les fichiers reçus : celui des téléchargements choisi dans l'interface.
let target = '';
export const setNxmTarget = (dir) => { target = typeof dir === 'string' ? dir : ''; };
export const nxmTarget = () => target || path.join(os.homedir(), 'Downloads');

const active = new Set(); // fichiers en cours, pour ignorer un double clic

/** Télécharge le fichier désigné par le lien nxm dans le dossier des téléchargements. */
export async function handleNxm(raw, apiKey, deps = { nexusFetch, downloadHttp }) {
  const nxm = parseNxm(raw);
  if (!nxm) throw new Error('Lien nxm invalide');
  if (!apiKey) throw new Error('Clé API Nexus absente');
  const id = `${nxm.game}/${nxm.modId}/${nxm.fileId}`;
  if (active.has(id)) return { status: 'already' };
  active.add(id);
  const notify = (status, extra = {}) => broadcastSSE({ type: 'nxm', nxm: { id, status, ...extra } });
  try {
    const base = `/v1/games/${nxm.game}/mods/${nxm.modId}/files/${nxm.fileId}`;
    const info = await deps.nexusFetch(`${base}.json`, apiKey);
    const name = safeFileName(info?.file_name);
    if (!name) throw new Error('Nom de fichier Nexus inconnu');
    const dir = nxmTarget();
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) { notify('done', { name }); return { status: 'exists', name, dest }; }
    const q = `?key=${encodeURIComponent(nxm.key)}&expires=${encodeURIComponent(nxm.expires)}`;
    const links = await deps.nexusFetch(`${base}/download_link.json${q}`, apiKey);
    const link = Array.isArray(links) && (links.find((l) => l.short_name === 'Nexus CDN' || l.short_name === 'CDN') || links[0]);
    if (!link?.URI) throw new Error('Aucun lien de téléchargement');
    fs.mkdirSync(dir, { recursive: true });
    broadcastLog('info', `⬇ Nexus (nxm) : ${name}`);
    notify('downloading', { name });
    let last = 0;
    await deps.downloadHttp(link.URI, dest, (received, total) => {
      const now = Date.now();
      if (now - last > 1000) { last = now; notify('downloading', { name, received, total }); }
    });
    broadcastLog('success', `✓ ${name} → ${dir}`);
    notify('done', { name });
    return { status: 'downloaded', name, dest };
  } catch (err) {
    const message = String(err.message || err);
    broadcastLog('error', `✗ Lien nxm : ${message}`);
    notify('error', { error: message });
    throw err;
  } finally {
    active.delete(id);
  }
}

// Appli qui ouvre les liens nxm:// sur ce Mac (un seul gestionnaire possible : Vortex, mORTEX…).
const BUNDLE_ID = 'com.mabbajack.app';
const jxa = (script) => new Promise((resolve) => {
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], (err, stdout) => resolve(err ? '' : stdout.trim()));
});

/** { isDefault, current } : current est le nom de l'appli qui reçoit les liens, ou ''. */
export async function nxmHandler() {
  const out = await jxa('ObjC.import("AppKit"); const w = $.NSWorkspace.sharedWorkspace;'
    + ' const u = w.URLForApplicationToOpenURL($.NSURL.URLWithString("nxm://x/mods/1/files/1"));'
    + ' u.isNil() ? "" : JSON.stringify({ path: u.path.js, id: $.NSBundle.bundleWithURL(u).bundleIdentifier.js || "" })');
  if (!out) return { isDefault: false, current: '' };
  try {
    const { path: appPath, id } = JSON.parse(out);
    return { isDefault: id === BUNDLE_ID, current: path.basename(appPath, '.app') };
  } catch { return { isDefault: false, current: '' }; }
}

/** Fait de mABBAJACK l'appli des liens nxm:// (demandé par l'utilisateur). */
export async function claimNxmHandler() {
  await jxa(`ObjC.import("CoreServices"); $.LSSetDefaultHandlerForURLScheme($("nxm"), $("${BUNDLE_ID}"))`);
  return nxmHandler();
}
