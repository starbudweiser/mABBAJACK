// Sources hébergées : MediaFire, ModDB, Mega. Leur adresse mène à une page web (ou, pour Mega, à un fichier
// chiffré) : il faut d'abord trouver le vrai lien. Logique reprise du moteur Wabbajack (Wabbajack.Downloaders.*).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_VERSION } from './version.js';

const UA = `mABBAJACK/${APP_VERSION} (macOS)`;

async function fetchText(url, signal) {
  const res = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { type: res.headers.get('content-type') || '', text: await res.text(), url: res.url };
}

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

// ── MediaFire ─────────────────────────────────────────────────────────────
/** Lien direct trouvé dans la page MediaFire (bouton « Download file »), ou null. */
export function parseMediaFirePage(html) {
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    if (/aria-label="Download file"/i.test(tag) && /\bpopsok\b/.test(tag)) {
      const href = tag.match(/href="([^"]+)"/i);
      if (href && /^https:\/\//i.test(decodeHtml(href[1]))) return decodeHtml(href[1]);
    }
  }
  const js = html.match(/window\.location\.href\s*=\s*'([^']+)'/i);
  return js && /^https:\/\//i.test(js[1]) ? js[1] : null;
}

export async function resolveMediaFire(url, signal, get = fetchText) {
  const page = await get(url, signal);
  if (!/text\/html/i.test(page.type)) return page.url || url; // déjà le fichier
  const direct = parseMediaFirePage(page.text);
  if (!direct) throw new Error('lien MediaFire introuvable (fichier retiré ?)');
  return direct;
}

// ── ModDB ─────────────────────────────────────────────────────────────────
export function modDBId(url) {
  try { return new URL(url).pathname.split('/').reverse().find((p) => /^\d+$/.test(p)) || null; } catch { return null; }
}

/** Miroirs de la page « downloads/start/<id>/all », du moins chargé au plus chargé. */
export function parseModDBMirrors(html) {
  const mirrors = [];
  for (const row of html.split(/<div[^>]*class="[^"]*\brow\b[^"]*"/i).slice(1)) {
    const href = row.match(/id="downloadon"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="downloadon"/i);
    if (!href) continue;
    const link = decodeHtml(href[1] || href[2]);
    const sub = row.match(/class="[^"]*\bsubheading\b[^"]*"[^>]*>([^<]*)</i);
    const load = sub ? parseFloat(sub[1].split(',').pop()) : NaN;
    mirrors.push({ link: link.startsWith('http') ? link : `https://www.moddb.com${link}`, load: Number.isFinite(load) ? load : Infinity });
  }
  return mirrors.sort((a, b) => a.load - b.load).map((m) => m.link);
}

export async function resolveModDB(url, signal, get = fetchText) {
  const id = modDBId(url);
  if (!id) throw new Error('identifiant ModDB introuvable');
  const mirrors = parseModDBMirrors((await get(`https://www.moddb.com/downloads/start/${id}/all`, signal)).text);
  if (!mirrors.length) throw new Error('aucun miroir ModDB');
  return mirrors;
}

/** Essaie les miroirs l'un après l'autre. */
export async function downloadFromMirrors(urls, destFile, onProgress, signal, download) {
  let lastErr;
  for (const u of urls) {
    try { return await download(u, destFile, onProgress, signal); } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('aucun miroir');
}

// ── Mega ──────────────────────────────────────────────────────────────────
const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** { id, key, iv } d'un lien mega.nz/file/<id>#<clé> (ou ancien format #!<id>!<clé>). */
export function parseMegaUrl(url) {
  const m = String(url).match(/mega\.(?:nz|co\.nz)\/(?:file\/([\w-]+)#([\w-]+)|#!([\w-]+)!([\w-]+))/i);
  if (!m) return null;
  const id = m[1] || m[3];
  const raw = b64url(m[2] || m[4]);
  if (raw.length !== 32) return null;
  // Clé de fichier Mega : 8 mots de 32 bits ; clé AES = mots 0-3 XOR mots 4-7, IV = mots 4-5 puis zéros.
  const key = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) key[i] = raw[i] ^ raw[i + 16];
  const iv = Buffer.concat([raw.subarray(16, 24), Buffer.alloc(8)]);
  return { id, key, iv };
}

export async function megaFileInfo(id, signal) {
  const res = await fetch(`https://g.api.mega.co.nz/cs?id=${Date.now() % 1e9}`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify([{ a: 'g', g: 1, p: id }]),
  });
  if (!res.ok) throw new Error(`Mega HTTP ${res.status}`);
  const [r] = await res.json();
  if (typeof r === 'number') throw new Error(`Mega : erreur ${r}${r === -9 ? ' (fichier retiré)' : ''}`);
  if (!r?.g) throw new Error('Mega : lien de téléchargement absent');
  return { url: r.g, size: r.s || 0 };
}

/** Télécharge et déchiffre (AES-128-CTR) un fichier Mega. */
export async function downloadMega(url, destFile, onProgress, signal, info = megaFileInfo) {
  const parsed = parseMegaUrl(url);
  if (!parsed) throw new Error('lien Mega invalide');
  const { url: dl, size } = await info(parsed.id, signal);
  const res = await fetch(dl, { signal, headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`Mega HTTP ${res.status}`);
  const tmp = `${destFile}.part`;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => { received += c.length; onProgress?.(received, size, 0); });
  try {
    await pipeline(body, crypto.createDecipheriv('aes-128-ctr', parsed.key, parsed.iv), fs.createWriteStream(tmp));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* absent */ }
    throw e;
  }
  fs.renameSync(tmp, destFile);
  return { receivedBytes: received, totalBytes: size || received };
}
