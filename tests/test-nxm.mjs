// Liens nxm:// : lecture du lien, nom de fichier sûr, téléchargement (Nexus et réseau simulés).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseNxm, safeFileName, handleNxm, setNxmTarget, nxmTarget } from '../web/server/nxm.js';

const ok = 'nxm://skyrimspecialedition/mods/266/files/558129?key=abc_DEF-123&expires=1761500000&user_id=42';
assert.deepEqual(parseNxm(ok), { game: 'skyrimspecialedition', modId: 266, fileId: 558129, key: 'abc_DEF-123', expires: '1761500000' });
assert.equal(parseNxm('https://www.nexusmods.com/skyrimspecialedition/mods/266'), null);
assert.equal(parseNxm('nxm://skyrimspecialedition/collections/abc/revisions/3'), null);
assert.equal(parseNxm('nxm://skyrimspecialedition/mods/266/files/1?key=a%22b&expires=1'), null);
assert.equal(parseNxm('nxm://skyrimspecialedition/mods/266/files/1?key=abc&expires=soon'), null);
assert.equal(parseNxm('not a url'), null);

assert.equal(safeFileName('SkyUI_5_2_SE-12604-5-2SE.7z'), 'SkyUI_5_2_SE-12604-5-2SE.7z');
assert.equal(safeFileName('../../etc/passwd'), 'passwd');
assert.equal(safeFileName('..'), '');
assert.equal(safeFileName(''), '');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_nxm_'));
try {
  setNxmTarget('');
  assert.equal(nxmTarget(), path.join(os.homedir(), 'Downloads'));
  setNxmTarget(tmp);

  const calls = [];
  const deps = {
    nexusFetch: async (endpoint) => {
      calls.push(endpoint);
      if (endpoint.endsWith('/files/558129.json')) return { file_name: 'SkyUI.7z' };
      if (endpoint.includes('download_link.json')) return [{ short_name: 'Nexus CDN', URI: 'https://cdn.example/SkyUI.7z' }];
      throw new Error(`inattendu : ${endpoint}`);
    },
    downloadHttp: async (url, dest) => { fs.writeFileSync(dest, url); },
  };
  const r = await handleNxm(ok, 'apikey', deps);
  assert.equal(r.status, 'downloaded');
  assert.equal(fs.readFileSync(path.join(tmp, 'SkyUI.7z'), 'utf8'), 'https://cdn.example/SkyUI.7z');
  assert.ok(calls.some((c) => c.endsWith('download_link.json?key=abc_DEF-123&expires=1761500000')));

  // Déjà présent : rien n'est retéléchargé
  calls.length = 0;
  assert.equal((await handleNxm(ok, 'apikey', deps)).status, 'exists');
  assert.ok(!calls.some((c) => c.includes('download_link')));

  await assert.rejects(handleNxm(ok, '', deps), /Clé API/);
  await assert.rejects(handleNxm('nxm://bad', 'apikey', deps), /invalide/);
  const evil = { ...deps, nexusFetch: async () => ({ file_name: '..' }) };
  await assert.rejects(handleNxm(ok.replace('558129', '7'), 'apikey', evil), /Nom de fichier/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('OK nxm');
