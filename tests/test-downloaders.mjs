// Test réseau : CDN Wabbajack + Google Drive (petits fichiers d'Authoria).
// Usage : node scripts/test-downloaders.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadWabbajackCdn, downloadGoogleDrive, isTrustedCdnUrl, parseDriveConfirmForm } from '../web/server/downloaders.js';

assert.equal(isTrustedCdnUrl('https://authored-files.wabbajack.org/x_1'), true);
assert.equal(isTrustedCdnUrl('http://authored-files.wabbajack.org/x_1'), false);
assert.equal(isTrustedCdnUrl('https://evil.example.com/x_1'), false);

const form = '<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="ABC"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form>';
assert.equal(parseDriveConfirmForm(form), 'https://drive.usercontent.google.com/download?id=ABC&confirm=t&uuid=u-1');
assert.equal(parseDriveConfirmForm('<html></html>'), null);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab-dl-'));
try {
  const cdn = path.join(dir, 'Troll.zip');
  const r1 = await downloadWabbajackCdn('https://authored-files.wabbajack.org/Troll+MCO-DXP+v2.0.1.zip_16ec5fe0-3e1d-4ca4-bc2d-9731c0419150', cdn, null, null, 838009);
  assert.equal(fs.statSync(cdn).size, 838009);
  assert.equal(fs.existsSync(`${cdn}.part`), false);
  console.log('CDN OK', r1);

  const drv = path.join(dir, 'drive.rar');
  try {
    const r2 = await downloadGoogleDrive('17tGAnd24wOxZvyVhx9Znox46PKu-H7xn', drv, null, null, 8670910);
    console.log('Drive OK', r2);
  } catch (e) {
    console.log('Drive KO :', e.message);
    assert.equal(fs.existsSync(`${drv}.part`), false);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('downloaders OK');
