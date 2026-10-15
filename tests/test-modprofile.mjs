// Tests : profils MO2 / mods optionnels / priorités.
// Usage : node scripts/test-modprofile.mjs [chemin.wabbajack]  (le test réel est ignoré si le fichier est absent)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModlistTxt, detectChoices, choiceOverrides, dedupeByPriority, buildSelection, buildOptions, renderModlistTxt, loadRawModlist, readZipEntry } from '../web/server/modprofile.js';

// ── Unitaires ───────────────────────────────────────────────
// Choix exclusifs : familles d'interface, format d'écran, variantes
{
  const txt = [
    "-(UI) Edge UI - Explorer Addon - 21x9 Patch", "-(UI) Norden UI - 21x9", "-(UI) Vel'dun UI - 32x9", "-(UI) Vel'dun UI - 21x9",
    "-(UI) Wunduniik Main Menu - 21x9", '-(UI) Wunduniik Main Menu - 32x9', '-16.3 WIDESCREEN_separator',
    '-(OPT) Difficulty - Master', '+(OPT) Difficulty - Expert', '-(OPT) Difficulty - Easy',
    '-Foo - Addon 1', '-Foo - Addon 2', '-16.5 OPTIONAL MODS_separator',
    "+(UI) Vel'dun UI", "+(UI) Vel'dun UI Patches", "+(UI) Vel'dun Flick",
    '-(UI) Norden UI', '-(UI) Norden Racemenu DIP', '-(UI) Norden UI Quickloot',
    '-(UI) Edge UI - Modern Skyrim Interface', '-(UI) Edge UI - Explorer Addon', '-(UI) Edge UI - Explorer Addon Racemenu DIP',
    '-(UI) UIExtensions - Edge UI Explorer Addon Patch', '-15.4 LATE LOADERS_separator',
  ].join('\n');
  const det = detectChoices(parseModlistTxt(txt));
  const byKind = (k) => det.choices.filter((c) => c.kind === k);
  const fam = byKind('family')[0];
  assert.equal(fam.default, "Vel'dun");
  assert.deepEqual(fam.options.map((o) => [o.id, o.mods.length]), [["Vel'dun", 3], ['Norden', 3], ['Edge', 4]]);
  const fmt = byKind('format')[0];
  assert.deepEqual(fmt.options.map((o) => o.id), ['none', '21x9', '32x9']);
  assert.equal(fmt.default, 'none');
  assert.deepEqual(byKind('variant').map((c) => c.label), ['(OPT) Difficulty'], 'variante seulement si une seule active');
  assert.ok(!det.used.has('foo - addon 1'), 'deux options désactivées restent des cases à cocher');

  const on = (picked) => [...choiceOverrides(det, picked)].filter(([, v]) => v).map(([k]) => k).sort();
  assert.deepEqual(on({}), ["(opt) difficulty - expert", "(ui) vel'dun flick", "(ui) vel'dun ui", "(ui) vel'dun ui patches"]);
  const norden = on({ 'family:UI': 'Norden', format: '21x9', 'variant:16.5 OPTIONAL MODS\u0000(opt) difficulty': '(OPT) Difficulty - Master' });
  assert.ok(norden.includes('(ui) norden ui - 21x9') && norden.includes('(ui) wunduniik main menu - 21x9'));
  assert.ok(!norden.includes("(ui) vel'dun ui - 21x9") && !norden.includes('(ui) wunduniik main menu - 32x9'));
  assert.ok(!norden.includes("(ui) vel'dun ui") && norden.includes('(opt) difficulty - master') && !norden.includes('(opt) difficulty - expert'));
  assert.deepEqual(on({ 'family:UI': 'Inconnu' }), on({}), 'valeur inconnue → défaut du profil');
}

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
  // Mods désactivés = optionnels à cocher + options des choix exclusifs restées inactives (format 16:9 par défaut)
  const fmt = p.choices.find((c) => c.kind === 'format');
  const fmtMods = fmt ? fmt.options.flatMap((o) => o.mods).length : 0;
  assert.equal(sel.excludedMods.length, p.optionalCount + fmtMods);
  assert.equal(sel.keep('mods/Cabbage ENB/x.dll'), false);
  assert.equal(sel.keep('mods/Skyrim Script Extender (SKSE)/x'), true);

  const wide = p.groups.find((g) => /widescreen/i.test(g.separator)).mods.map((m) => m.name);
  const sel2 = await buildSelection(raw, readEntry, { enable: wide });
  assert.equal(sel2.excludedMods.length, p.optionalCount + fmtMods - wide.length);
  if (fmt) {
    const sel3 = await buildSelection(raw, readEntry, { choices: { format: fmt.options[1].id } });
    assert.equal(sel3.excludedMods.length, p.optionalCount + fmtMods - fmt.options[1].mods.length, 'format choisi → ses mods sont installés');
    assert.equal(sel3.keep(`mods/${fmt.options[1].mods[0]}/x`), true);
  }
  assert.equal(sel2.keep(`mods/${wide[0]}/x`), true);
  const { text, active } = renderModlistTxt(sel2);
  assert.ok(text.includes(`+${wide[0]}`));
  console.log('modlist.txt actifs', active);
} else {
  console.log('(test réel ignoré : fichier absent)');
}
console.log('modprofile OK');
