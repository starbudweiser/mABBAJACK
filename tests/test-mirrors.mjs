// MediaFire, ModDB, Mega : lecture des pages, ordre des miroirs, déchiffrement Mega (serveur local).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  parseMediaFirePage, resolveMediaFire, modDBId, parseModDBMirrors, resolveModDB, downloadFromMirrors,
  parseMegaUrl, downloadMega,
} from '../web/server/mirrors.js';

// MediaFire
const mfPage = '<a class="input popsok" aria-label="Download file" href="https://download2.mediafire.com/abc/x/File.7z" id="downloadButton">';
assert.equal(parseMediaFirePage(mfPage), 'https://download2.mediafire.com/abc/x/File.7z');
assert.equal(parseMediaFirePage("<script>window.location.href = 'https://download9.mediafire.com/z/File.7z';</script>"), 'https://download9.mediafire.com/z/File.7z');
assert.equal(parseMediaFirePage('<a aria-label="Download file" class="popsok" href="javascript:alert(1)">'), null);
assert.equal(await resolveMediaFire('https://www.mediafire.com/file/x', null, async () => ({ type: 'text/html', text: mfPage })), 'https://download2.mediafire.com/abc/x/File.7z');
assert.equal(await resolveMediaFire('https://www.mediafire.com/file/x', null, async () => ({ type: 'application/x-7z', text: '', url: 'https://cdn/File.7z' })), 'https://cdn/File.7z');
await assert.rejects(resolveMediaFire('https://www.mediafire.com/file/x', null, async () => ({ type: 'text/html', text: '<p>removed</p>' })), /introuvable/);

// ModDB
assert.equal(modDBId('https://www.moddb.com/downloads/start/123456'), '123456');
assert.equal(modDBId('https://www.moddb.com/mods/x/downloads/y'), null);
const mdPage = `
<div class="row clear"><p><a id="downloadon" href="/downloads/mirror/123456/101/aaa">Mirror A</a></p><span class="subheading">Server A, 80% capacity</span></div>
<div class="row clear"><p><a href="/downloads/mirror/123456/102/bbb" id="downloadon">Mirror B</a></p><span class="subheading">Server B, 12% capacity</span></div>`;
assert.deepEqual(parseModDBMirrors(mdPage), ['https://www.moddb.com/downloads/mirror/123456/102/bbb', 'https://www.moddb.com/downloads/mirror/123456/101/aaa']);
let asked = '';
assert.equal((await resolveModDB('https://www.moddb.com/downloads/start/123456', null, async (u) => { asked = u; return { text: mdPage }; })).length, 2);
assert.equal(asked, 'https://www.moddb.com/downloads/start/123456/all');
const tried = [];
assert.equal(await downloadFromMirrors(['m1', 'm2'], 'f', null, null, async (u) => { tried.push(u); if (u === 'm1') throw new Error('down'); return 'ok'; }), 'ok');
assert.deepEqual(tried, ['m1', 'm2']);

// Mega : clé de 32 octets → clé AES et IV
const raw = crypto.randomBytes(32);
const link = `https://mega.nz/file/AbCd1234#${raw.toString('base64url')}`;
const p = parseMegaUrl(link);
assert.equal(p.id, 'AbCd1234');
assert.equal(p.iv.subarray(8).equals(Buffer.alloc(8)), true);
assert.deepEqual(parseMegaUrl(`https://mega.nz/#!AbCd1234!${raw.toString('base64url')}`).key, p.key);
assert.equal(parseMegaUrl('https://mega.nz/folder/xyz#abc'), null);

const plain = crypto.randomBytes(200000);
const cipher = crypto.createCipheriv('aes-128-ctr', p.key, p.iv);
const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
const server = http.createServer((_req, res) => { res.writeHead(200); res.end(encrypted); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_mirrors_'));
try {
  const dest = path.join(tmp, 'File.7z');
  const info = async (id) => { assert.equal(id, 'AbCd1234'); return { url: `http://127.0.0.1:${server.address().port}/f`, size: plain.length }; };
  const r = await downloadMega(link, dest, null, null, info);
  assert.equal(r.receivedBytes, plain.length);
  assert.equal(fs.readFileSync(dest).equals(plain), true);
  await assert.rejects(downloadMega('https://mega.nz/file/x', dest, null, null, info), /invalide/);
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('OK mirrors');
