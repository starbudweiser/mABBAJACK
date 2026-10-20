import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hashFile } from '../web/server/archivecheck.js';
import { resolveDirectivePath } from '../web/server/paths.js';
import {
  installDirName, manifestEntries, manifestArchives, manifestFingerprint, diffManifests, writeSnapshot, readSnapshot,
  findInstallation, compareWithInstalled, inferOptions, baselineFromSnapshot, baselineFromManifest, planUpdate, removeFiles,
} from '../web/server/update.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_upd_'));
try {
  assert.equal(installDirName('Wunduniik Reloaded'), 'WUNDUNIIK_RELOADED');

  // Contenus et hash Wabbajack
  const src = path.join(tmp, 'src');
  fs.mkdirSync(src);
  const content = { a: 'texture A v1', b: 'mesh B', c: 'plugin C v1', a2: 'texture A v2!', d: 'nouveau D', e: 'retiré E' };
  const hash = {};
  for (const [k, v] of Object.entries(content)) {
    fs.writeFileSync(path.join(src, k), v);
    hash[k] = await hashFile(path.join(src, k));
  }
  const dir = (to, k, arc) => ({ $type: 'FromArchive', To: to, Hash: hash[k], Size: Buffer.byteLength(content[k]), ArchiveHashPath: [arc, 'x'] });
  const v1 = {
    Name: 'Ma Liste', Version: '1.0',
    Archives: [{ Hash: 'H1', Name: 'ModA v1.7z', Size: 10 }, { Hash: 'H2', Name: 'ModB.7z', Size: 20 }, { Hash: 'H5', Name: 'ModE.7z', Size: 5 }],
    Directives: [
      dir('mods\\ModA\\textures\\a.dds', 'a', 'H1'),
      dir('mods\\ModB\\meshes\\b.nif', 'b', 'H2'),
      dir('mods\\ModB\\C.esp', 'c', 'H2'),
      dir('mods\\ModE\\e.txt', 'e', 'H5'),
    ],
  };
  // v2 : ModA mis à jour, ModE retiré, ModD ajouté, ModB inchangé — même numéro de version
  const v2 = {
    Name: 'Ma Liste', Version: '1.0',
    Archives: [{ Hash: 'H1b', Name: 'ModA v2.7z', Size: 11 }, { Hash: 'H2', Name: 'ModB.7z', Size: 20 }, { Hash: 'H4', Name: 'ModD.7z', Size: 9 }],
    Directives: [
      dir('mods\\ModA\\textures\\a.dds', 'a2', 'H1b'),
      dir('mods\\ModB\\meshes\\b.nif', 'b', 'H2'),
      dir('mods\\ModB\\C.esp', 'c', 'H2'),
      dir('mods\\ModD\\d.txt', 'd', 'H4'),
    ],
  };

  // Empreinte : différente malgré le même numéro de version
  const fp1 = await manifestFingerprint(manifestEntries(v1), manifestArchives(v1));
  const fp2 = await manifestFingerprint(manifestEntries(v2), manifestArchives(v2));
  assert.notEqual(fp1, fp2);

  // Différences
  const diff = diffManifests(manifestEntries(v1), manifestEntries(v2), manifestArchives(v1), manifestArchives(v2));
  assert.deepEqual(diff.mods.added.map((m) => m.name), ['ModD']);
  assert.deepEqual(diff.mods.removed.map((m) => m.name), ['ModE']);
  assert.deepEqual(diff.mods.changed.map((m) => m.name), ['ModA']);
  assert.deepEqual(diff.mods.changed[0].archivesBefore, ['ModA v1.7z']);
  assert.deepEqual(diff.mods.changed[0].archivesAfter, ['ModA v2.7z']);
  assert.equal(diff.mods.unchangedCount, 1);
  assert.deepEqual(diff.files, { added: 1, removed: 1, changed: 1, unchanged: 2 });
  assert.deepEqual(diff.archives.added.map((a) => a.name), ['ModA v2.7z', 'ModD.7z']);
  assert.equal(diff.archives.downloadSize, 20);

  // « Installation » v1 puis instantané
  const dest = path.join(tmp, 'READY', installDirName(v1.Name));
  const resolve = (d) => resolveDirectivePath(d.To.replace(/\\/g, '/'), dest);
  const parse = (raw) => raw.Directives.map((d) => ({ ...d, To: d.To.replace(/\\/g, '/'), ArchiveHash: d.ArchiveHashPath[0] }));
  const install = (raw, keys) => raw.Directives.forEach((d, i) => {
    const out = resolve(d); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(path.join(src, keys[i]), out);
  });
  install(v1, ['a', 'b', 'c', 'e']);
  fs.writeFileSync(path.join(dest, 'README_READY_TO_PLAY.txt'), ' Modlist  : Ma Liste  v1.0\n');
  const w = await writeSnapshot(dest, { raw: v1, installed: parse(v1), resolve });
  assert.equal(w.files, 4);
  const snap = readSnapshot(dest);
  assert.equal(snap.fingerprint, fp1);
  assert.equal(findInstallation(path.join(tmp, 'READY'), 'ma liste').dir, dest);

  // Fichier v2 sur disque pour compareWithInstalled
  const zipDir = path.join(tmp, 'zip');
  fs.mkdirSync(zipDir);
  fs.writeFileSync(path.join(zipDir, 'modlist'), JSON.stringify(v2));
  const v2File = path.join(tmp, 'Ma Liste.wabbajack');
  execFileSync('zip', ['-qj', v2File, path.join(zipDir, 'modlist')]);
  const cmp = await compareWithInstalled(v2File, path.join(tmp, 'READY'));
  assert.equal(cmp.status, 'update');
  assert.equal(cmp.baseline, 'snapshot');
  assert.equal(cmp.diff.mods.changedCount, 1);

  // Plan depuis l'instantané
  const plan = await planUpdate({ directives: parse(v2), resolve, baseline: baselineFromSnapshot(snap) });
  assert.deepEqual([...plan.skip].sort(), ['mods/modb/c.esp', 'mods/modb/meshes/b.nif']);
  assert.equal(plan.changed, 1);
  assert.equal(plan.added, 1);
  assert.equal(plan.removed.length, 1);
  assert.ok(plan.removed[0].endsWith(path.join('Data', 'e.txt')));
  assert.deepEqual([...plan.neededArchives].sort(), ['H1b', 'H4']);

  // Fichier modifié à la main après l'installation : réinstallé
  const bOut = resolve(v2.Directives[1]);
  fs.writeFileSync(bOut, 'mesh X');
  fs.utimesSync(bOut, new Date(), new Date(Date.now() + 5000));
  const plan2 = await planUpdate({ directives: parse(v2), resolve, baseline: baselineFromSnapshot(snap) });
  assert.ok(!plan2.skip.has('mods/modb/meshes/b.nif'));
  fs.copyFileSync(path.join(src, 'b'), bOut);

  // Sans instantané, avec l'ancien manifeste
  const plan3 = await planUpdate({ directives: parse(v2), resolve, baseline: baselineFromManifest(manifestEntries(v1)) });
  assert.equal(plan3.skip.size, 2);
  assert.equal(plan3.removed.length, 1);

  // Mod renommé : même fichier, même destination → conservé
  const v3 = { ...v2, Directives: v2.Directives.map((d) => ({ ...d, To: d.To.replace('ModB', 'ModB v2') })) };
  const plan5 = await planUpdate({ directives: parse(v3), resolve, baseline: baselineFromManifest(manifestEntries(v1)) });
  assert.ok(plan5.skip.has('mods/modb v2/c.esp') && plan5.skip.has('mods/modb v2/meshes/b.nif'));
  assert.equal(plan5.removed.length, 1); // e.txt seulement : b.nif et C.esp restent des destinations

  // Sans aucune base : comparaison au disque (taille puis hash)
  const plan4 = await planUpdate({ directives: parse(v2), resolve, baseline: null });
  assert.deepEqual([...plan4.skip].sort(), ['mods/modb/c.esp', 'mods/modb/meshes/b.nif']);
  assert.equal(plan4.hashed, 2);
  assert.equal(plan4.removed.length, 0);

  // Suppression + dossiers vides
  assert.equal(removeFiles(plan.removed, dest), 1);
  assert.equal(fs.existsSync(path.join(dest, 'Data', 'e.txt')), false);
  assert.equal(removeFiles([path.join(tmp, 'src', 'a')], dest), 0); // hors installation : refusé
  assert.ok(fs.existsSync(path.join(tmp, 'src', 'a')));

  // Ancienne version à côté du nouveau fichier (installation sans instantané)
  fs.rmSync(path.join(dest, '.mabbajack'), { recursive: true });
  fs.writeFileSync(path.join(zipDir, 'modlist'), JSON.stringify(v1));
  execFileSync('zip', ['-qj', path.join(tmp, 'Ma Liste beta 1.wabbajack'), path.join(zipDir, 'modlist')]);
  const cmp2 = await compareWithInstalled(v2File, path.join(tmp, 'READY'));
  assert.equal(cmp2.status, 'update');
  assert.equal(cmp2.baseline, 'previous-wabbajack');
  assert.ok(cmp2.previousFile.endsWith('Ma Liste beta 1.wabbajack'));
  fs.rmSync(path.join(tmp, 'Ma Liste beta 1.wabbajack'));
  const cmp3 = await compareWithInstalled(v2File, path.join(tmp, 'READY'));
  assert.equal(cmp3.status, 'unknown');
  assert.equal(cmp3.installed.version, '1.0');

  // Même révision
  await writeSnapshot(dest, { raw: v2, installed: parse(v2), resolve });
  assert.equal((await compareWithInstalled(v2File, path.join(tmp, 'READY'))).status, 'same');
  assert.equal((await compareWithInstalled(v2File, path.join(tmp, 'AILLEURS'))).status, 'not-installed');

  // Options de l'installation existante : déduites du disque, puis enregistrées
  const opts = { profiles: [{ name: 'P', isDefault: true, groups: [{ separator: 'x', mods: [{ name: 'ModD' }, { name: 'ModZ' }] }],
    choices: [{ id: 'c', default: 'o2', options: [{ id: 'o1', mods: ['ModA'] }, { id: 'o2', mods: ['ModQ'] }] }] }] };
  for (const d of v2.Directives) {
    const out = resolve(d); fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(src, { 'mods\\ModA\\textures\\a.dds': 'a2', 'mods\\ModB\\meshes\\b.nif': 'b', 'mods\\ModB\\C.esp': 'c', 'mods\\ModD\\d.txt': 'd' }[d.To]), out);
  }
  assert.deepEqual(inferOptions({ raw: v2, options: opts, resolve }), { profile: 'P', enable: ['ModD'], choices: { c: 'o1' }, source: 'disk' });
  assert.deepEqual(inferOptions({ raw: v2, options: opts, resolve, saved: { profile: 'P', enable: ['modz', 'Inconnu'], choices: { c: 'o2' } } }),
    { profile: 'P', enable: ['ModZ'], choices: { c: 'o2' }, source: 'saved' });

  console.log('test-update : OK');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
