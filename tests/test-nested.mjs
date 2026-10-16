import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from '../web/node_modules/jszip/lib/index.js';
import { looksLikeBsa, indexExtracted, extractNestedArchive } from '../web/server/nested.js';

const bin = ['/opt/homebrew/bin/7zz', '/usr/local/bin/7zz'].find((p) => fs.existsSync(p));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwab_nested_'));

try {
  // Signature BSA / BA2
  fs.writeFileSync(path.join(dir, 'a.bsa'), Buffer.from('BSA\0xxxx', 'latin1'));
  fs.writeFileSync(path.join(dir, 'b.ba2'), Buffer.from('BTDXxxxx', 'latin1'));
  fs.writeFileSync(path.join(dir, 'c.zip'), Buffer.from('PK\x03\x04', 'latin1'));
  assert.equal(looksLikeBsa(path.join(dir, 'a.bsa')), true);
  assert.equal(looksLikeBsa(path.join(dir, 'b.ba2')), true);
  assert.equal(looksLikeBsa(path.join(dir, 'c.zip')), false);
  assert.equal(looksLikeBsa(path.join(dir, 'absent')), false);

  // Index : antislash dans le nom (zip fait sous Windows) et casse normalisés
  const idx = path.join(dir, 'idx');
  fs.mkdirSync(path.join(idx, 'Sub'), { recursive: true });
  fs.writeFileSync(path.join(idx, 'Data\\SKSE\\Plugins\\X.dll'), 'a');
  fs.writeFileSync(path.join(idx, 'Sub', 'Tex.DDS'), 'b');
  const files = indexExtracted(idx);
  assert.ok(files.has('data/skse/plugins/x.dll'));
  assert.ok(files.has('sub/tex.dds'));

  // Zip imbriqué extrait par 7zz
  if (bin) {
    const inner = new JSZip();
    inner.file('textures/Beehive.dds', 'ruche');
    const innerBuf = await inner.generateAsync({ type: 'nodebuffer' });
    const innerPath = path.join(dir, 'Skeps PBR.zip');
    fs.writeFileSync(innerPath, innerBuf);
    const out = await extractNestedArchive(bin, innerPath, path.join(dir, 'out'));
    assert.equal(fs.readFileSync(out.get('textures/beehive.dds'), 'utf8'), 'ruche');

    // Liste de sélection 7zz : la forme antislash retrouve une entrée nommée « Data\SKSE\… »
    const outer = new JSZip();
    outer.file('Data\\SKSE\\Plugins\\W.dll', 'dll');
    const outerPath = path.join(dir, 'water.zip');
    fs.writeFileSync(outerPath, await outer.generateAsync({ type: 'nodebuffer' }));
    const list = path.join(dir, 'list');
    fs.writeFileSync(list, ['Data/SKSE/Plugins/W.dll', 'Data\\SKSE\\Plugins\\W.dll'].join('\n'));
    execFileSync(bin, ['x', '-y', `-o${path.join(dir, 'sel')}`, outerPath, '-aoa', '-ssc-', `@${list}`], { stdio: 'ignore' });
    assert.ok(indexExtracted(path.join(dir, 'sel')).has('data/skse/plugins/w.dll'));
  } else {
    console.log('7zz absent : tests d\'extraction ignorés');
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-nested : OK');
