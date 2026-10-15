import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  toWabbajackHash, hashFile, HashCache, verifyArchive, verifyInstalledFiles, findStrayFiles, archiveSourceUrl, listDownloadDir, modOf,
} from '../web/server/archivecheck.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mabba-archivecheck-'));
try {
  // xxHash64("abc", graine 0) = 0x44BC2CF5AD770999, encodé en little-endian puis base64 (format Wabbajack)
  const abcHash = Buffer.from('9909 77ad f52c bc44'.replace(/ /g, ''), 'hex').toString('base64');
  assert.equal(toWabbajackHash(0x44bc2cf5ad770999n), abcHash);
  const f = path.join(dir, 'Pandora Output.7z');
  fs.writeFileSync(f, 'abc');
  assert.equal(await hashFile(f), abcHash);

  // Taille, hash, cache
  const cache = new HashCache(path.join(dir, 'cache.json'));
  assert.equal((await verifyArchive({ Size: 3, Hash: abcHash }, f, { cache })).reason, 'ok');
  assert.equal((await verifyArchive({ Size: 3, Hash: abcHash }, f, { cache })).cached, true);
  assert.equal((await verifyArchive({ Size: 4, Hash: abcHash }, f)).reason, 'size');
  assert.equal((await verifyArchive({ Size: 3, Hash: 'AAAAAAAAAAA=' }, f)).reason, 'hash');
  assert.equal((await verifyArchive({ Size: 3, Hash: abcHash }, path.join(dir, 'absent.7z'))).reason, 'unreadable');
  cache.save();
  assert.equal(new HashCache(path.join(dir, 'cache.json')).get(f, fs.statSync(f)), abcHash, 'cache persistant');
  fs.writeFileSync(f, 'abd'); // même taille, contenu modifié → mtime différent → recalcul
  const st = fs.statSync(f); fs.utimesSync(f, st.atime, new Date(st.mtimeMs + 5000));
  assert.equal((await verifyArchive({ Size: 3, Hash: abcHash }, f, { cache })).reason, 'hash', 'cache invalidé');

  // Liens et dossiers
  assert.equal(archiveSourceUrl({ State: { GameName: 'SkyrimSpecialEdition', ModID: 89632, FileID: 816971 } }),
    'https://www.nexusmods.com/skyrimspecialedition/mods/89632?tab=files&file_id=816971');
  assert.equal(archiveSourceUrl({ State: { Url: 'https://x/y.zip' } }), 'https://x/y.zip');
  assert.equal(archiveSourceUrl({ State: {} }), null);
  fs.writeFileSync(path.join(dir, 'Liste.wabbajack'), '');
  assert.equal(listDownloadDir(path.join(dir, 'Liste.wabbajack')), dir);
  assert.equal(listDownloadDir('https://cdn/x.wabbajack'.replace('https://', '/nonexistent/')), null);
  assert.equal(modOf('mods/Pandora Output/meshes/a.hkx'), 'Pandora Output');
  assert.equal(modOf('profiles/Default/plugins.txt'), null);

  // Contrôle post-installation
  const data = path.join(dir, 'Data');
  fs.mkdirSync(path.join(data, 'meshes'), { recursive: true });
  fs.writeFileSync(path.join(data, 'meshes', 'ok.nif'), '12345');
  fs.writeFileSync(path.join(data, 'meshes', 'bad.nif'), '12');
  fs.writeFileSync(path.join(data, 'meshes', 'conflit.nif'), '123');
  const out = (to) => path.join(data, to.split('/').slice(2).join('/'));
  const r = await verifyInstalledFiles([
    { To: 'mods/A/meshes/ok.nif', Size: 5 },
    { To: 'mods/A/meshes/bad.nif', Size: 5 },
    { To: 'mods/A/meshes/absent.nif', Size: 5 },
    { To: 'mods/A/meshes/conflit.nif', Size: 9 },
    { To: 'mods/B/meshes/conflit.nif', Size: 3 }, // conflit : une des tailles suffit
    { $type: 'CreateBSA', To: 'mods/A/x.bsa', Size: 1 },
  ], out);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.missing.map((m) => m.to), ['mods/A/meshes/absent.nif']);
  assert.deepEqual(r.wrongSize.map((m) => [m.to, m.actual]), [['mods/A/meshes/bad.nif', 2]]);
  // Fichiers de mods désactivés restés dans l'installation
  fs.writeFileSync(path.join(data, 'meshes', 'debug.dll'), 'x');
  const stray = await findStrayFiles(
    [{ To: 'mods/DT/meshes/debug.dll' }, { To: 'mods/DT/meshes/ok.nif' }, { To: 'mods/DT/meshes/absent.dll' }],
    [{ To: 'mods/A/meshes/ok.nif' }], out);
  assert.deepEqual(stray.map((x) => [x.mod, path.basename(x.path)]), [['DT', 'debug.dll']]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('archivecheck OK');
