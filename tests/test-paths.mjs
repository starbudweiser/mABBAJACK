import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDirectivePath, detectGameRootFolders, setGameRootFolders, KNOWN_GAME_ROOT_NAMES } from '../web/server/paths.js';

const root = '/tmp/INSTALL';
const r = (to) => resolveDirectivePath(to, root);

// Mods MO2 → Data, Root/ → racine du jeu
assert.equal(r('mods/A/textures/x.dds'), path.join(root, 'Data/textures/x.dds'));
assert.equal(r('mods/A/Root/d3d11.dll'), path.join(root, 'd3d11.dll'));
assert.equal(r('mods/A/meta.ini'), path.join(root, 'Data/meta.ini'));
assert.equal(r('Tools/Bethini/x.exe'), null);

// Dossier de jeu de l'instance MO2 (« Game Root », « Stock Game »…) → racine de l'installation
setGameRootFolders(new Set(KNOWN_GAME_ROOT_NAMES));
assert.equal(r('Game Root\\Data\\Skyrim - Textures2.bsa'.replace(/\\/g, '/')), path.join(root, 'Data/Skyrim - Textures2.bsa'));
assert.equal(r('Game Root/bink2w64.dll'), path.join(root, 'bink2w64.dll'));
assert.equal(r('Stock Game/SkyrimSE.exe'), path.join(root, 'SkyrimSE.exe'));
assert.equal(r('Game Root/../evil.dll'), null);

// Nom propre à une liste, reconnu à son contenu (Data/ ou exécutable à sa racine)
const found = detectGameRootFolders([
  { To: 'Skyrim Vanilla\\Data\\Skyrim.esm' }, { To: 'MyGame/SkyrimSE.exe' },
  { To: 'Tools/SSEEdit/SSEEdit.exe' }, { To: 'plugins/x.dll' }, { To: 'mods/A/Data/x' },
]);
assert.ok(found.has('skyrim vanilla') && found.has('mygame'));
assert.ok(!found.has('tools') && !found.has('plugins') && !found.has('mods'));
setGameRootFolders(found);
assert.equal(r('Skyrim Vanilla/Data/Skyrim.esm'), path.join(root, 'Data/Skyrim.esm'));
console.log('paths OK');
