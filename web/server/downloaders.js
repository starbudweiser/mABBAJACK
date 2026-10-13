// Téléchargeurs non-Nexus de Wabbajack : CDN Wabbajack (authored-files) et Google Drive.
// Tous écrivent dans « <dest>.part » puis renomment : jamais de fichier partiel sous le nom final.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { jobControl } from './jobcontrol.js';

const UA = 'mAbbajack-macOS/3.0';
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
