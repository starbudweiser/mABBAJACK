// Tests : profils MO2 / mods optionnels / priorités.
// Usage : node scripts/test-modprofile.mjs [chemin.wabbajack]  (le test réel est ignoré si le fichier est absent)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModlistTxt, dedupeByPriority, buildSelection, buildOptions, renderModlistTxt, loadRawModlist, readZipEntry } from '../web/server/modprofile.js';

// ── Unitaires ───────────────────────────────────────────────
const items = parseModlistTxt('# c\n+Top Mod\n-Optional A\n+Base Mod\n-Group B_separator\n+Core\n-Group A_separator\n');
assert.equal(items.length, 6);
assert.equal(items[0].priority, 0);
assert.equal(items.find((i) => i.name === 'Optional A').enabled, false);
assert.equal(items.find((i) => i.name === 'Optional A').group, 'Group B');
assert.equal(items.find((i) => i.name === 'Core').group, 'Group A');
assert.equal(items.find((i) => i.name === 'Top Mod').group, 'Group B');

const prio = new Map([['hi', 0], ['lo', 5]]);
const dirs = [
  { To: 'mods/Lo/a.dds' }, { To: 'mods/Hi/A.dds' }, { To: 'mods/Lo/b.dds' }, { To: 'profiles/x/plugins.txt' }, { To: 'skip' },
];
const outPathOf = (d) => (d.To === 'skip' ? null : '/out/' + d.To.split('/').slice(2).join('/').replace('mods', ''));
const r = dedupeByPriority(dirs, (d) => (d.To.startsWith('mods/') ? '/out/' + d.To.split('/').slice(2).join('/') : d.To === 'skip' ? null : '/out/' + d.To), prio);
assert.equal(r.removed, 1);
assert.deepEqual(r.directives.map((d) => d.To), ['mods/Hi/A.dds', 'mods/Lo/b.dds', 'profiles/x/plugins.txt', 'skip']);
void outPathOf;

// ── Réel (optionnel) ────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(here, 'Authoria - Requiem Reforged.wabbajack');
if (fs.existsSync(file)) {
  const raw = await loadRawModlist(file);
  const readEntry = (n) => readZipEntry(file, n);
  const opts = await buildOptions(raw, readEntry);
  const p = opts.profiles[0];
  console.log('profil', p.name, '| optionnels', p.optionalCount, '|', (p.optionalBytes / 1e9).toFixed(1), 'Go');
  assert.ok(p.optionalCount > 30);
  assert.ok(p.groups.some((g) => /widescreen/i.test(g.separator)));

  const sel = await buildSelection(raw, readEntry, {});
  console.log('exclus', sel.excludedMods.length, '| directives ignorées', sel.droppedCount, '| archives non nécessaires', sel.skipHashes.size, '| plugins retirés', sel.pluginsExcluded.size);
  assert.equal(sel.excludedMods.length, p.optionalCount);
  assert.equal(sel.keep('mods/Cabbage ENB/x.dll'), false);
  assert.equal(sel.keep('mods/Skyrim Script Extender (SKSE)/x'), true);

  const wide = p.groups.find((g) => /widescreen/i.test(g.separator)).mods.map((m) => m.name);
  const sel2 = await buildSelection(raw, readEntry, { enable: wide });
  assert.equal(sel2.excludedMods.length, p.optionalCount - wide.length);
  assert.equal(sel2.keep(`mods/${wide[0]}/x`), true);
  const { text, active } = renderModlistTxt(sel2);
  assert.ok(text.includes(`+${wide[0]}`));
  console.log('modlist.txt actifs', active);
} else {
  console.log('(test réel ignoré : fichier absent)');
}
console.log('modprofile OK');
