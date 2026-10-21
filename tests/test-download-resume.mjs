// Test hors ligne : téléchargement HTTP repris après coupure (Range) et .part existant réutilisé.
// Usage : node tests/test-download-resume.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { downloadHttp } from '../web/server/downloaders.js';

const data = crypto.randomBytes(1024 * 1024);
let requests = 0;
const ranges = [];
const server = http.createServer((req, res) => {
  requests++;
  if (req.url === '/missing') { res.writeHead(404); return res.end(); }
  const m = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = m ? Number(m[1]) : 0;
  ranges.push(start);
  const body = data.subarray(start);
  res.writeHead(m ? 206 : 200, { 'Content-Length': body.length });
  // Première requête : coupure au milieu du transfert
  if (requests === 1) { res.write(body.subarray(0, 300000)); setTimeout(() => res.destroy(), 50); return; }
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab-resume-'));

try {
  // 1. Coupure puis reprise automatique
  const dest = path.join(dir, 'a.bin');
  const r = await downloadHttp(`${base}/a`, dest, null, null);
  assert.equal(r.totalBytes, data.length);
  assert.ok(fs.readFileSync(dest).equals(data));
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.equal(ranges[0], 0);
  assert.ok(ranges[1] > 0, 'la 2e requête doit reprendre (Range)');

  // 2. .part laissé par un lancement précédent : reprise directe
  const dest2 = path.join(dir, 'b.bin');
  fs.writeFileSync(`${dest2}.part`, data.subarray(0, 500000));
  ranges.length = 0;
  await downloadHttp(`${base}/b`, dest2, null, null);
  assert.equal(ranges[0], 500000);
  assert.ok(fs.readFileSync(dest2).equals(data));

  // 3. Erreur 404 : échec immédiat, sans nouvelles tentatives
  const before = requests;
  await assert.rejects(downloadHttp(`${base}/missing`, path.join(dir, 'c.bin'), null, null), /HTTP 404/);
  assert.equal(requests - before, 1);
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('download-resume OK');
