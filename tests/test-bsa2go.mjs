#!/usr/bin/env node
/**
 * Limite des 2 Go des BSA : avec une limite réduite (maxEnd), les fichiers qui
 * finiraient au-delà sortent de l'archive, l'archive reste lisible, et
 * installBsaOverflow les pose en fichiers libres sans écraser l'existant.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openBsa } from '../web/server/bsa.js';
import { createBsa, installBsaOverflow, BSA_GAME_LIMIT } from '../web/server/bsawriter.js';

assert.equal(BSA_GAME_LIMIT, 0x7FFFFFFF);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsa2go-'));
try {
  const src = path.join(tmp, 'staging');
  const rels = [];
  for (let i = 0; i < 40; i++) {
    const rel = `textures\\pbr\\d${i % 4}\\f${i}.dds`;
    const abs = path.join(src, ...rel.split('\\'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.alloc(1000, i));
    rels.push(rel);
  }
  const data = path.join(tmp, 'Data');
  const out = path.join(data, 'Test - Textures.bsa');
  const state = { Version: 105, ArchiveFlags: 3, FileFlags: 2 };

  // Sans limite effective : tout est empaqueté
  const full = createBsa(src, out, state, rels, { maxEnd: 10_000_000 });
  assert.equal(full.files, 40);
  assert.equal(full.overflow.length, 0);

  // Limite à ~20 Ko : une partie déborde
  const r = createBsa(src, out, state, rels, { maxEnd: 20_000 });
  assert.ok(r.overflow.length > 0 && r.files > 0);
  assert.equal(r.files + r.overflow.length, 40);
  assert.ok(r.bytes <= 20_000, `fin des données ${r.bytes} > limite`);
  assert.equal(fs.statSync(out).size, r.bytes);

  const bsa = openBsa(out);
  for (const e of bsa.entries.values()) assert.ok(e.offset + e.size <= 20_000);
  assert.equal(bsa.entries.size, r.files);
  for (const o of r.overflow) assert.equal(bsa.readFile(o.rel.replace(/\\/g, '/')), null);
  bsa.close();

  // Un fichier libre déjà présent n'est pas écrasé
  const first = r.overflow[0];
  const keep = path.join(data, ...first.rel.split('\\'));
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.writeFileSync(keep, 'déjà là');

  const loose = installBsaOverflow(r.overflow, data);
  assert.equal(loose.existing, 1);
  assert.equal(loose.placed, r.overflow.length - 1);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'déjà là');
  for (const o of r.overflow.slice(1)) {
    const dest = path.join(data, ...o.rel.split('\\'));
    assert.equal(fs.statSync(dest).size, 1000);
  }
  console.log(`OK : ${r.files} empaquetés, ${r.overflow.length} en libres`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
