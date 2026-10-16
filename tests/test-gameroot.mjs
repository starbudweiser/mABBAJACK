import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchInRoot, rankGameRoots, siblingGameRoots } from '../web/server/gameroot.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_gameroot_'));
const mk = (root, rel, size) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), Buffer.alloc(size));
};
const game = (rel, size) => ({ Size: size, State: { GameFile: rel.replace(/\//g, '\\') } });

try {
  // Deux versions rangées côte à côte : 1.6.1170 (choisie par l'utilisateur) et 1.7.104 (attendue)
  const v1170 = path.join(dir, 'VERSIONS', '2 - SKYRIM 1.6.1170', 'Skyrim Special Edition');
  const v1104 = path.join(dir, 'VERSIONS', '3 - SKYRIM 1.7.104', 'Skyrim Special Edition');
  for (const [root, esm, exe] of [[v1170, 10, 30], [v1104, 11, 31]]) {
    mk(root, 'SkyrimSE.exe', exe);
    mk(root, 'Data/Update.esm', esm);
    mk(root, 'Data/Skyrim - Animations.bsa', 50); // identique dans les deux versions
  }
  const games = [game('Data/Update.esm', 11), game('SkyrimSE.exe', 31), game('Data/Skyrim - Animations.bsa', 50)];

  assert.equal(matchInRoot(v1104, games[0]), path.join(v1104, 'Data/Update.esm'));
  assert.equal(matchInRoot(v1170, games[0]), null, 'mauvaise taille → pas de correspondance');
  assert.equal(matchInRoot(v1170, { Size: 1, State: {} }), null);

  const isRoot = (p) => fs.existsSync(path.join(p, 'SkyrimSE.exe')) && fs.existsSync(path.join(p, 'Data'));
  const siblings = siblingGameRoots(path.join(v1170, '_'), isRoot, 3, 2);
  assert.ok(siblings.includes(v1104), 'le dossier voisin 1.7.104 est trouvé');

  const ranking = rankGameRoots([v1170, ...siblings], games, v1170);
  assert.equal(ranking[0].root, v1104);
  assert.equal(ranking[0].matched, 3);
  assert.equal(ranking.find((r) => r.root === v1170).matched, 1);

  // À égalité, le dossier de l'utilisateur passe en premier
  const tie = rankGameRoots([v1104, v1170], [games[2]], v1170);
  assert.equal(tie[0].root, v1170);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-gameroot : OK');
