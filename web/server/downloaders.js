// Téléchargeurs non-Nexus de Wabbajack : CDN Wabbajack (authored-files) et Google Drive.
// Tous écrivent dans « <dest>.part » puis renomment : jamais de fichier partiel sous le nom final.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import { jobControl } from './jobcontrol.js';
import { APP_VERSION } from './version.js';

const UA = `mABBAJACK/${APP_VERSION} (macOS)`;
const CDN_HOST = 'authored-files.wabbajack.org';
const PART_RETRIES = 3;
const PART_CONCURRENCY = 3;

function abortError() { return new Error('Annulé'); }

async function fetchOk(url, signal, init = {}) {
  if (signal?.aborted) throw abortError();
  const res = await fetch(url, { ...init, signal, redirect: 'follow', headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function safeUnlink(p) { try { fs.unlinkSync(p); } catch { /* absent */ } }

/** URL CDN valide ? (https, hôte attendu) — évite toute requête vers un hôte arbitraire. */
export function isTrustedCdnUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && p.hostname === CDN_HOST;
  } catch { return false; }
}

/**
 * Télécharge un fichier hébergé sur le CDN Wabbajack.
 * Protocole : <Url>/definition.json.gz → Parts[{Index,Offset,Size}] → <Url>/parts/<Index>.
 */
export async function downloadWabbajackCdn(baseUrl, destPath, onProgress, signal, expectedSize = 0) {
  if (!isTrustedCdnUrl(baseUrl)) throw new Error('URL CDN Wabbajack invalide');
  const base = baseUrl.replace(/\/+$/, '');
  const defRes = await fetchOk(`${base}/definition.json.gz`, signal);
  let def;
  try {
    def = JSON.parse(zlib.gunzipSync(Buffer.from(await defRes.arrayBuffer())).toString('utf8'));
  } catch { throw new Error('Définition CDN illisible'); }

  const parts = Array.isArray(def?.Parts) ? def.Parts : [];
  const total = Number(def?.Size) || parts.reduce((s, p) => s + (p.Size || 0), 0);
  if (!parts.length || !total) throw new Error('Définition CDN vide');
  if (expectedSize && total !== expectedSize) throw new Error(`Taille CDN inattendue (${total} ≠ ${expectedSize})`);

  const tmp = `${destPath}.part`;
  safeUnlink(tmp);
  const fd = fs.openSync(tmp, 'w');
  let received = 0;
  let lastT = Date.now(), lastB = 0, speed = 0;
  const tick = (n) => {
    received += n;
    const now = Date.now();
    if (now - lastT >= 500) { speed = (received - lastB) / ((now - lastT) / 1000); lastT = now; lastB = received; }
    onProgress?.(received, total, Math.round(speed));
  };

  const queue = parts.slice().sort((a, b) => a.Index - b.Index);
  let failure = null;

  async function fetchPart(part) {
    for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
      try {
        await jobControl.waitIfPaused(signal);
        const res = await fetchOk(`${base}/parts/${part.Index}`, signal);
        const buf = Buffer.from(await res.arrayBuffer());
        if (part.Size && buf.length !== part.Size) throw new Error(`partie ${part.Index} : ${buf.length} ≠ ${part.Size} octets`);
        fs.writeSync(fd, buf, 0, buf.length, part.Offset);
        tick(buf.length);
        return;
      } catch (e) {
        if (signal?.aborted) throw abortError();
        if (attempt === PART_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  async function worker() {
    while (queue.length && !failure) {
      const part = queue.shift();
      try { await fetchPart(part); } catch (e) { failure = e; }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, worker));
    if (failure) throw failure;
    fs.closeSync(fd);
    if (fs.statSync(tmp).size !== total) throw new Error('Fichier CDN incomplet');
    fs.renameSync(tmp, destPath);
    return { receivedBytes: received, totalBytes: total };
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* déjà fermé */ }
    safeUnlink(tmp);
    throw e;
  }
}

/** Extrait les champs cachés du formulaire de confirmation Google Drive (gros fichiers). */
export function parseDriveConfirmForm(html) {
  const form = /<form[^>]*id="download-form"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html)
    || /<form[^>]*action="([^"]*(?:download|uc)[^"]*)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) return null;
  const action = form[1].replace(/&amp;/g, '&');
  const params = new URLSearchParams();
  for (const m of form[2].matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) params.set(m[1], m[2]);
  return params.has('id') ? `${action}?${params.toString()}` : null;
}

/** Télécharge un fichier public Google Drive (avec page de confirmation antivirus si besoin). */
export async function downloadGoogleDrive(fileId, destPath, onProgress, signal, expectedSize = 0) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId || ''))) throw new Error('Identifiant Google Drive invalide');
  const tmp = `${destPath}.part`;
  safeUnlink(tmp);

  let url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  let res = null;
  for (let step = 0; step < 3; step++) {
    res = await fetchOk(url, signal);
    const type = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) break;
    const next = parseDriveConfirmForm(await res.text());
    if (!next) throw new Error('Google Drive : fichier inaccessible (quota dépassé ou privé)');
    url = next;
    res = null;
  }
  if (!res) throw new Error('Google Drive : confirmation impossible');

  const total = parseInt(res.headers.get('content-length') || '0', 10) || expectedSize;
  let received = 0, lastT = Date.now(), lastB = 0, speed = 0;
  const body = Readable.fromWeb(res.body);
  const onPause = () => body.pause();
  const onResume = () => body.resume();
  jobControl.events.on('pause', onPause);
  jobControl.events.on('resume', onResume);
  if (jobControl.paused) body.pause();
  body.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastT >= 500) { speed = (received - lastB) / ((now - lastT) / 1000); lastT = now; lastB = received; }
    onProgress?.(received, total, Math.round(speed));
  });
  try {
    await pipeline(body, fs.createWriteStream(tmp), ...(signal ? [{ signal }] : []));
    if (expectedSize && fs.statSync(tmp).size !== expectedSize) throw new Error('Google Drive : taille inattendue');
    fs.renameSync(tmp, destPath);
    return { receivedBytes: received, totalBytes: total };
  } catch (e) {
    safeUnlink(tmp);
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    jobControl.events.off('pause', onPause);
    jobControl.events.off('resume', onResume);
  }
}

const HTTP_RETRIES = 5;
const HTTP_STALL_MS = 60000;

/** Erreur définitive (inutile de réessayer) : 4xx hors 408/429. */
class FatalHttpError extends Error {}

/** Une tentative : reprend « tmp » à partir de sa taille actuelle (en-tête Range). */
function httpAttempt(url, tmp, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirects = 0) => {
      if (signal?.aborted) return reject(abortError());
      if (redirects > 8) return reject(new FatalHttpError('Trop de redirections'));
      let parsed;
      try { parsed = new URL(requestUrl); } catch { return reject(new FatalHttpError(`URL invalide : ${requestUrl}`)); }
      const startAt = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
      const headers = { 'User-Agent': UA };
      if (startAt > 0) headers.Range = `bytes=${startAt}-`;
      const proto = parsed.protocol === 'https:' ? https : http;
      const req = proto.get(requestUrl, { headers }, (res) => {
        const code = res.statusCode;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          return doRequest(new URL(res.headers.location, parsed).href, redirects + 1);
        }
        // Partie déjà complète (ou serveur incohérent) : on repart de zéro au prochain essai
        if (code === 416) { res.resume(); safeUnlink(tmp); return reject(new Error('HTTP 416')); }
        if (code === 403) { res.resume(); return reject(new FatalHttpError('HTTP 403 — Compte Nexus Standard ou clé API invalide')); }
        if (code !== 200 && code !== 206) {
          res.resume();
          const Err = code >= 400 && code < 500 && code !== 408 && code !== 429 ? FatalHttpError : Error;
          return reject(new Err(`HTTP ${code}`));
        }
        const resumed = code === 206;
        const offset = resumed ? startAt : 0;
        const len = parseInt(res.headers['content-length'] || '0', 10);
        const total = len ? offset + len : 0;
        const out = fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' });
        let written = offset;
        const onPause = () => { res.unpipe(out); res.pause(); };
        const onResume = () => { res.pipe(out); res.resume(); };
        jobControl.events.on('pause', onPause);
        jobControl.events.on('resume', onResume);
        if (jobControl.paused) res.pause();
        let settled = false;
        const finish = (err) => {
          if (settled) return;
          settled = true;
          jobControl.events.off('pause', onPause);
          jobControl.events.off('resume', onResume);
          if (err) { res.destroy(); out.destroy(); reject(err); } else resolve({ received: written, total });
        };
        res.on('data', (chunk) => { written += chunk.length; onProgress?.(written, total); });
        res.on('aborted', () => finish(new Error('Connexion interrompue')));
        res.on('error', (e) => finish(e));
        out.on('error', (e) => finish(e));
        out.on('finish', () => {
          if (total && written !== total) return finish(new Error(`Téléchargement incomplet (${written}/${total} octets)`));
          finish(null);
        });
        res.pipe(out);
      });
      // Connexion figée : on coupe, la tentative suivante reprendra (sauf pendant une pause volontaire)
      req.setTimeout(HTTP_STALL_MS, () => { if (!jobControl.paused) req.destroy(new Error('Délai dépassé')); });
      req.on('error', (e) => reject(e));
      signal?.addEventListener('abort', () => { req.destroy(); reject(abortError()); }, { once: true });
    };
    doRequest(url);
  });
}

/**
 * Téléchargement HTTP(S) générique (Nexus, liens directs) : écrit dans « <dest>.part », reprend un
 * « .part » existant (Range) et réessaie en cas de coupure ; renomme à la fin.
 * Le « .part » est conservé après une annulation ou un échec : le prochain lancement repart de là.
 */
export async function downloadHttp(url, destPath, onProgress, signal) {
  const tmp = `${destPath}.part`;
  let lastT = Date.now(), lastB = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0, speed = 0;
  const progress = (received, total) => {
    const now = Date.now();
    if (now - lastT >= 500) { speed = Math.max(0, (received - lastB) / ((now - lastT) / 1000)); lastT = now; lastB = received; }
    onProgress?.(received, total, Math.round(speed));
  };
  for (let attempt = 1; ; attempt++) {
    try {
      await jobControl.waitIfPaused(signal);
      const { received, total } = await httpAttempt(url, tmp, signal, progress);
      fs.renameSync(tmp, destPath);
      return { receivedBytes: received, totalBytes: total || received };
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (e instanceof FatalHttpError || attempt >= HTTP_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
    }
  }
}
