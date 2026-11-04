// Adaptation au Mac : textes dans les 4 langues, dossier et bouteille choisis, annonce (plan), application et
// annulation sur un faux jeu avec une fausse bouteille (jamais une vraie), téléchargement de Bottled Shaders.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mabbajack-mac-'));
process.env.MABBAJACK_DATA_DIR = path.join(tmp, 'data');   // fichier d'état des bouteilles propre au test
process.env.MABBAJACK_MDLSS_BRIDGE = path.join(tmp, 'no-bridge.dll');

const { MAC_TEXTS, MAC_UI, macText } = await import('../web/src/locales/uiMac.ts');
const mac = await import('../web/server/mac.js');
const { installDirName } = await import('../web/server/update.js');

const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const tree = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(dir, f)] = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    }
  };
  walk(dir);
  return out;
};
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

try {
  // ── Textes : les clés du moteur sont traduites dans les 4 langues, avec les mêmes valeurs à insérer ──
  const engine = await mac.loadEngine();
  const langs = ['fr', 'en', 'es', 'it'];
  for (const lang of langs) {
    for (const key of engine.MAC_TEXT_KEYS) {
      assert.ok(MAC_TEXTS[lang][key], `${lang} : clé du moteur sans traduction : ${key}`);
      assert.equal(placeholders(MAC_TEXTS[lang][key]), placeholders(MAC_TEXTS.fr[key]), `${lang} ${key} : valeurs à insérer différentes`);
    }
    assert.deepEqual(Object.keys(MAC_TEXTS[lang]).sort(), Object.keys(MAC_TEXTS.fr).sort(), `${lang} : clés différentes du français`);
    assert.deepEqual(Object.keys(MAC_UI[lang]).sort(), Object.keys(MAC_UI.fr).sort(), `${lang} : textes de l'interface différents du français`);
    for (const [k, v] of Object.entries(MAC_UI[lang])) {
      assert.ok(String(v).trim(), `${lang}.${k} vide`);
      assert.equal(placeholders(v), placeholders(MAC_UI.fr[k]), `${lang}.${k} : valeurs à insérer différentes`);
    }
  }
  assert.equal(macText({ key: 'mackit.bottled.ok', params: { version: '1.0.26' } }, 'fr'), 'Bottled Shaders 1.0.26 : à jour.');
  assert.equal(macText({ key: 'mackit.inconnue' }, 'en'), 'mackit.inconnue'); // jamais vide

  // ── Versions de Bottled Shaders ──
  assert.equal(mac.versionAtLeast('1.0.26', '1.0.26'), true);
  assert.equal(mac.versionAtLeast('1.0.27', '1.0.26'), true);
  assert.equal(mac.versionAtLeast('v1.1', '1.0.26'), true);
  assert.equal(mac.versionAtLeast('1.0.25', '1.0.26'), false);
  assert.equal(mac.versionAtLeast('', '1.0.26'), false);
  const files = [
    { file_id: 1, file_name: 'a-1.0.25.zip', category_name: 'MAIN', uploaded_timestamp: 10 },
    { file_id: 2, file_name: 'a-1.0.26.zip', category_name: 'MAIN', uploaded_timestamp: 30 },
    { file_id: 3, file_name: 'optional.zip', category_name: 'OPTIONAL', uploaded_timestamp: 90 },
    { file_id: 4, file_name: 'old.zip', category_id: 4, uploaded_timestamp: 99 },
  ];
  assert.equal(mac.latestMainFile(files).file_id, 2);
  assert.equal(mac.latestMainFile([]), undefined);

  // ── Faux jeu (Stock Game installé) et fausse bouteille : seule celle-ci est visible du moteur ──
  const bottle = path.join(tmp, 'bottles', 'Skyrim');
  write(path.join(bottle, 'system.reg'), 'WINE REGISTRY Version 2\n');
  write(path.join(bottle, 'user.reg'), 'WINE REGISTRY Version 2\n');
  write(path.join(bottle, 'cxbottle.conf'), '[EnvironmentVariables]\n"CX_GRAPHICS_BACKEND" = "dxvk"\n');
  fs.mkdirSync(path.join(bottle, 'drive_c'), { recursive: true });
  write(path.join(tmp, 'data', 'bottles.json'), JSON.stringify({ roots: [path.join(tmp, 'bottles')], activeBottle: bottle, exclusive: true }));

  const dest = path.join(tmp, 'READY');
  const install = path.join(dest, installDirName('Test List'));
  const bottledDll = (v) => Buffer.concat([Buffer.from('MZ...Bottled...'), Buffer.from('FileVersion', 'utf16le'), Buffer.from(`\0\0 ${v}.0`, 'utf16le')]);
  const plugins = path.join(install, 'Data', 'SKSE', 'Plugins');
  for (const esm of ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm']) write(path.join(install, 'Data', esm), esm);
  write(path.join(install, 'SkyrimSE.exe'), 'exe');
  write(path.join(plugins, 'CommunityShaders.dll'), bottledDll('1.0.25'));
  write(path.join(plugins, 'TerrainHelper.dll'), 'terrain');
  write(path.join(plugins, 'SSEDisplayTweaks.ini'), '[Render]\nSwapEffect = auto\n');

  // dossier à adapter : le jeu embarqué par la liste, sinon celui de l'utilisateur, sinon rien
  assert.deepEqual(mac.resolveTarget({ installDir: install, gamePath: '' }), { dir: install, kind: 'install', exists: true });
  const future = path.join(dest, 'FUTUR');
  assert.deepEqual(mac.resolveTarget({ installDir: future, gamePath: '', carriesGame: true }), { dir: future, kind: 'install', exists: false });
  assert.equal(mac.resolveTarget({ installDir: future, gamePath: '', carriesGame: false }), null);
  assert.equal(mac.resolveTarget({ installDir: '', gamePath: path.join(tmp, 'rien') }), null);
  assert.equal(mac.resolveTarget({ installDir: future, gamePath: install, carriesGame: false }).kind, 'game');

  // ── Annonce : le plan du moteur, sans rien écrire ──
  const before = tree(tmp);
  const preview = await mac.previewMac({ destPath: dest, modlist: { name: 'Test List' }, gamePath: '' });
  assert.deepEqual(tree(tmp), before, "l'annonce n'écrit rien");
  assert.equal(preview.supported, true);
  assert.equal(preview.target.dir, install);
  assert.equal(preview.bottle.name, 'Skyrim');
  assert.equal(preview.bottles.length, 1, 'seule la bouteille du test est visible');
  const ids = preview.plan.fixes.map((f) => f.id);
  assert.deepEqual(ids.filter((i) => ['engine', 'displayTweaks', 'duplicates'].includes(i)), ['engine', 'displayTweaks', 'duplicates']);
  for (const f of preview.plan.fixes) {
    assert.ok(f.title.key.startsWith('mackit.fix.'), 'texte sous forme de clé');
    assert.equal(f.ops, undefined, "l'annonce ne porte pas les contenus de fichiers");
  }
  assert.equal(preview.plan.fixes.find((f) => f.id === 'displayTweaks').changes.length > 0, true);
  assert.equal(preview.plan.discarded[0].file, path.join(plugins, 'TerrainHelper.dll'));
  assert.equal(preview.plan.bottled.state, 'outdated');
  assert.equal(preview.plan.bottled.minimum, '1.0.26');
  assert.equal(JSON.stringify(preview).includes('"content"'), false);

  // dossier d'installation pas encore créé et liste qui embarque son jeu : annonce « plus tard », sans correctif de fichier
  const later = await mac.previewMac({ destPath: path.join(tmp, 'AILLEURS'), modlist: { name: 'Autre', localFilePath: undefined }, gamePath: '' });
  assert.equal(later.target, null);

  // ── Bilan : application, puis annulation d'un correctif et de tout ──
  const original = tree(install);
  const originalBottle = tree(bottle);
  const report = await mac.finishMac({ installDir: install, gamePath: '' });
  assert.equal(report.error, undefined);
  assert.equal(report.target.dir, install);
  const byId = Object.fromEntries(report.items.map((i) => [i.id, i]));
  for (const id of ['engine', 'displayTweaks', 'duplicates']) {
    assert.equal(byId[id].status, 'applied', id);
    assert.equal(byId[id].undoable, true, id);
    assert.equal(byId[id].text.key, 'mackit.apply.ok');
  }
  assert.match(fs.readFileSync(path.join(bottle, 'cxbottle.conf'), 'utf8'), /dxmt/);
  assert.equal(fs.existsSync(path.join(plugins, 'TerrainHelper.dll')), false, 'doublon écarté');
  assert.ok(fs.existsSync(path.join(install, '_MAC_BACKUP', 'manifest.json')));
  assert.deepEqual(report.applied.map((a) => a.id).sort(), report.items.filter((i) => i.status === 'applied').map((i) => i.id).sort());
  assert.equal(report.bottled.state, 'outdated');

  const one = await mac.undoMac({ dir: install, id: 'duplicates' });
  assert.equal(one.fixes[0].status, 'restored');
  assert.equal(fs.readFileSync(path.join(plugins, 'TerrainHelper.dll'), 'utf8'), 'terrain');
  assert.equal(one.applied.some((a) => a.id === 'duplicates'), false, 'un correctif annulé disparaît du bilan');

  const ini = path.join(plugins, 'SSEDisplayTweaks.ini');
  const appliedIni = fs.readFileSync(ini, 'utf8');
  write(ini, '[Render]\nSwapEffect = autre\n'); // changé depuis l'adaptation : annulation refusée, rien d'écrasé
  const refused = await mac.undoMac({ dir: install, id: 'displayTweaks' });
  assert.equal(refused.fixes[0].status, 'refused');
  assert.match(fs.readFileSync(ini, 'utf8'), /autre/);
  write(ini, appliedIni);
  const all = await mac.undoMac({ dir: install, id: 'all' });
  assert.ok(all.fixes.every((f) => f.status === 'restored'), JSON.stringify(all.fixes));
  assert.deepEqual(tree(install), original, 'tout annulé : le jeu est identique, plus de _MAC_BACKUP');
  assert.deepEqual(tree(bottle), originalBottle, 'la bouteille aussi');

  await assert.rejects(mac.undoMac({ dir: install, id: 'all' }), /Rien à annuler/);
  await assert.rejects(mac.undoMac({ dir: 'relatif', id: 'all' }), /Rien à annuler/);

  // sans dossier de jeu : le bilan le dit, rien n'est écrit
  const none = await mac.finishMac({ installDir: path.join(tmp, 'vide'), gamePath: '' });
  assert.equal(none.target, null);
  assert.deepEqual(none.items, []);

  // ── Bottled Shaders : fichier principal le plus récent, clé Nexus de l'utilisateur ──
  const waitFor = async (pred) => { for (let i = 0; i < 200; i++) { if (pred(mac.bottledState())) return mac.bottledState(); await new Promise((r) => setTimeout(r, 10)); } throw new Error(`attente dépassée : ${JSON.stringify(mac.bottledState())}`); };
  const nexusFiles = { files: [
    { file_id: 11, file_name: 'Bottled Shaders-1.0.25.zip', category_name: 'MAIN', uploaded_timestamp: 1, mod_version: '1.0.25' },
    { file_id: 12, file_name: 'Bottled Shaders-1.0.26.zip', category_name: 'MAIN', uploaded_timestamp: 5, mod_version: '1.0.26' },
    { file_id: 13, file_name: 'Extra.zip', category_name: 'OPTIONAL', uploaded_timestamp: 9, mod_version: '9.9.9' },
  ] };
  const asked = [];
  const deps = (over = {}) => ({
    nexusFetch: async (endpoint, key) => { asked.push([endpoint, key]); return nexusFiles; },
    getNexusDownloadUrl: async () => ({ url: 'https://cdn.example/b.zip', isPremium: true }),
    downloadHttp: async (url, dest, onProgress) => { onProgress(50, 100); write(dest, 'zip'); onProgress(100, 100); },
    ...over,
  });
  const downloads = path.join(tmp, 'DOWNLOADS');

  mac.startBottledDownload({ apiKey: '', downloadsDir: downloads }, deps());
  assert.deepEqual(mac.bottledState(), { status: 'error', code: 'noKey' });
  mac.resetBottled();
  mac.startBottledDownload({ apiKey: 'KEY', downloadsDir: '' }, deps());
  assert.equal(mac.bottledState().code, 'noFolder');
  mac.resetBottled();

  mac.startBottledDownload({ apiKey: 'KEY-1234', downloadsDir: downloads }, deps());
  const done = await waitFor((s) => s.status === 'done');
  assert.equal(done.version, '1.0.26');
  assert.equal(done.name, 'Bottled Shaders-1.0.26.zip');
  assert.equal(fs.readFileSync(done.path, 'utf8'), 'zip');
  assert.deepEqual(asked[0], ['/v1/games/skyrimspecialedition/mods/192816/files.json', 'KEY-1234']);
  mac.resetBottled();

  mac.startBottledDownload({ apiKey: 'KEY', downloadsDir: downloads }, deps({ getNexusDownloadUrl: async () => ({ url: null, isPremium: false, manualUrl: 'https://www.nexusmods.com/skyrimspecialedition/mods/192816?tab=files&file_id=12' }) }));
  const manual = await waitFor((s) => s.status === 'manual');
  assert.match(manual.url, /192816/);
  mac.resetBottled();

  mac.startBottledDownload({ apiKey: 'KEY', downloadsDir: downloads }, deps({ nexusFetch: async () => ({ files: [nexusFiles.files[0]] }) }));
  assert.equal((await waitFor((s) => s.status === 'error')).code, 'tooOld');
  mac.resetBottled();

  mac.startBottledDownload({ apiKey: 'KEY', downloadsDir: downloads }, deps({ nexusFetch: async () => { throw new Error('hors ligne'); } }));
  assert.equal((await waitFor((s) => s.status === 'error')).code, 'failed');
  mac.resetBottled();

  console.log('OK mac');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
