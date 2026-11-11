// Test hors ligne : fichiers « ._ » de macOS retirés en fin d'installation sur un disque exFAT ou FAT.
// Usage : node tests/test-macjunk.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMacMetadataName, hasNativeAttributes, removeMacMetadata, cleanMacMetadataIfNeeded } from '../web/server/macjunk.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab-macjunk-'));
const write = (rel) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
try {
  assert.equal(isMacMetadataName('._EngineFixes.dll'), true);
  assert.equal(isMacMetadataName('.DS_Store'), true);
  assert.equal(isMacMetadataName('_patch.esp'), false);
  assert.equal(isMacMetadataName('.hidden.ini'), false);

  assert.equal(hasNativeAttributes(root, 'apfs'), true);
  assert.equal(hasNativeAttributes(root, 'hfs'), true);
  assert.equal(hasNativeAttributes(root, 'exfat'), false);
  assert.equal(hasNativeAttributes(root, 'msdos'), false);
  assert.equal(hasNativeAttributes(root, null), true);   // type inconnu : on ne touche à rien

  const keep = [write('mods/EngineFixes/SKSE/Plugins/EngineFixes.dll'), write('mods/A/_patch.esp')];
  write('mods/EngineFixes/SKSE/Plugins/._EngineFixes.dll');
  write('mods/A/.DS_Store');
  write('._root');

  // APFS : rien n'est retiré
  assert.equal(cleanMacMetadataIfNeeded(root, 'apfs'), null);
  assert.ok(fs.existsSync(path.join(root, '._root')));

  // exFAT : les trois fichiers de macOS partent, les vrais fichiers restent
  assert.equal(cleanMacMetadataIfNeeded(root, 'exfat'), 3);
  for (const k of keep) assert.ok(fs.existsSync(k), k);
  assert.equal(fs.existsSync(path.join(root, 'mods/EngineFixes/SKSE/Plugins/._EngineFixes.dll')), false);
  assert.equal(removeMacMetadata(root), 0);
  console.log('OK test-macjunk');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
