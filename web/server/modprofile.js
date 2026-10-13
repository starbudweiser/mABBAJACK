// Profils MO2 d'une modlist Wabbajack : mods optionnels (désactivés), priorités, sélection.
//
// Un .wabbajack n'a pas de « choix » : tout est installé et les options sont des mods
// désactivés (« -Nom ») dans profiles/<profil>/modlist.txt, regroupés sous des séparateurs.
// modlist.txt est écrit en ordre de priorité DÉCROISSANT : la 1re ligne l'emporte en cas de conflit.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const norm = (s) => String(s || '').replace(/\\/g, '/');
const lc = (s) => String(s || '').toLowerCase();
const PLUGIN_RE = /\.(esp|esm|esl)$/i;
const SEP_SUFFIX = '_separator';

/** Lit une entrée d'un .wabbajack (zip) via `unzip -p` — sans charger le zip en mémoire. */
export async function readZipEntry(file, name) {
  try {
    const { stdout } = await run('unzip', ['-p', file, name], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/** Charge et parse le manifeste `modlist` d'un .wabbajack. */
export async function loadRawModlist(file) {
  const buf = await readZipEntry(file, 'modlist');
  if (!buf || !buf.length) throw new Error('Manifeste « modlist » introuvable dans le .wabbajack');
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Parse un modlist.txt MO2.
 * @returns {{name:string, enabled:boolean, separator:boolean, priority:number, group:string|null}[]}
 *   dans l'ordre du fichier (priority 0 = priorité la plus haute)
 */
export function parseModlistTxt(text) {
  const items = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const flag = line[0];
    if (flag !== '+' && flag !== '-' && flag !== '*') continue;
    const name = line.slice(1);
    if (!name) continue;
    items.push({ name, enabled: flag !== '-', separator: name.endsWith(SEP_SUFFIX), priority: items.length, group: null });
  }
  // Dans le fichier, un séparateur suit (en lecture) les mods qu'il regroupe.
  let group = null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].separator) group = items[i].name.slice(0, -SEP_SUFFIX.length);
    else items[i].group = group;
  }
  return items;
}

/** Profils disponibles : nom → { text, mods: Map(nomLower → item) }. */
async function loadProfiles(raw, readEntry) {
  const profiles = new Map();
  for (const d of raw.Directives || raw.directives || []) {
    const to = norm(d.To || d.to);
    const m = /^profiles\/([^/]+)\/modlist\.txt$/i.exec(to);
    if (!m || !d.SourceDataID) continue;
    const buf = await readEntry(d.SourceDataID);
    if (!buf) continue;
    const items = parseModlistTxt(buf.toString('utf8'));
    const mods = new Map();
    for (const it of items) if (!it.separator) mods.set(lc(it.name), it);
    profiles.set(m[1], { name: m[1], items, mods });
  }
  return profiles;
}

function pickProfile(profiles, wanted, modlistName) {
  if (wanted && profiles.has(wanted)) return profiles.get(wanted);
  for (const p of profiles.values()) if (lc(p.name) === lc(modlistName)) return p;
  return profiles.values().next().value || null;
}

/** Taille installée (octets) par mod. */
function modSizes(raw) {
  const sizes = new Map();
  for (const d of raw.Directives || raw.directives || []) {
    const to = norm(d.To || d.to);
    if (!/^mods\//i.test(to)) continue;
    const mod = lc(to.split('/')[1]);
    sizes.set(mod, (sizes.get(mod) || 0) + (d.Size || 0));
  }
  return sizes;
}

/**
 * Options affichables : mods désactivés par défaut, groupés par séparateur.
 * @returns {{profiles:{name:string, isDefault:boolean, groups:{separator:string, mods:{name:string,size:number}[]}[], optionalCount:number, optionalBytes:number}[]}}
 */
export async function buildOptions(raw, readEntry) {
  const profiles = await loadProfiles(raw, readEntry);
  const def = pickProfile(profiles, null, raw.Name);
  const sizes = modSizes(raw);
  const out = [];
  for (const p of profiles.values()) {
    const groups = new Map();
    let count = 0, bytes = 0;
    // Ordre d'affichage = ordre de la liste MO2 (de bas en haut du fichier)
    for (let i = p.items.length - 1; i >= 0; i--) {
      const it = p.items[i];
      if (it.separator || it.enabled) continue;
      const size = sizes.get(lc(it.name)) || 0;
      const key = it.group || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ name: it.name, size });
      count++; bytes += size;
    }
    out.push({
      name: p.name,
      isDefault: p === def,
      groups: [...groups.entries()].map(([separator, mods]) => ({ separator, mods })),
      optionalCount: count,
      optionalBytes: bytes,
    });
  }
  return { profiles: out };
}

/**
 * Construit la sélection d'installation.
 * @param raw manifeste brut (Directives, Archives…)
 * @param readEntry async (nomEntréeZip) => Buffer|null
 * @param options { profile?: string, enable?: string[] } — mods optionnels à installer
 */
export async function buildSelection(raw, readEntry, options = {}) {
  const profiles = await loadProfiles(raw, readEntry);
  const profile = pickProfile(profiles, options.profile, raw.Name);
  const enable = new Set((options.enable || []).map(lc));
  const excluded = new Set();
  const priority = new Map();
  if (profile) {
    for (const [key, it] of profile.mods) {
      priority.set(key, it.priority);
      if (!it.enabled && !enable.has(key)) excluded.add(key);
    }
  }
  const chosen = profile ? lc(profile.name) : '';

  const directives = raw.Directives || raw.directives || [];

  // CreateBSA d'un mod exclu → ses fichiers stagés (TEMP_BSA_FILES/<TempID>/…) sont inutiles
  const droppedTemp = new Set();
  for (const d of directives) {
    if (!/createbsa/i.test(d.$type || '') || !d.TempID) continue;
    const to = norm(d.To);
    if (/^mods\//i.test(to) && excluded.has(lc(to.split('/')[1]))) droppedTemp.add(String(d.TempID));
  }

  const dropPath = (to) => {
    const parts = to.split('/');
    const top = lc(parts[0]);
    if (top === 'mods') return excluded.has(lc(parts[1]));
    if (top === 'profiles') return chosen ? lc(parts[1]) !== chosen : false;
    if (top === 'temp_bsa_files') return droppedTemp.has(parts[1]);
    return false;
  };

  const keptHashes = new Set();
  const droppedHashes = new Set();
  const keptPlugins = new Set();
  const droppedPlugins = new Set();
  let droppedCount = 0;
  let keptBytes = 0;
  for (const d of directives) {
    const to = norm(d.To || d.to);
    const drop = dropPath(to);
    const hash = d.ArchiveHashPath?.[0];
    if (hash) (drop ? droppedHashes : keptHashes).add(hash);
    const base = to.split('/').pop();
    if (PLUGIN_RE.test(base) && /^mods\//i.test(to)) (drop ? droppedPlugins : keptPlugins).add(lc(base));
    if (drop) droppedCount++;
    else keptBytes += Number(d.Size) || 0;
  }
  const skipHashes = new Set([...droppedHashes].filter((h) => !keptHashes.has(h)));
  const pluginsExcluded = new Set([...droppedPlugins].filter((p) => !keptPlugins.has(p)));

  return {
    profile: profile ? profile.name : null,
    profileItems: profile ? profile.items : [],
    excludedMods: [...excluded],
    enabledOptional: [...enable].filter((k) => profile?.mods.get(k) && !profile.mods.get(k).enabled),
    skipHashes,
    pluginsExcluded,
    droppedCount,
    keptBytes,
    priority,
    /** true si la directive (To normalisé en « / ») doit être conservée */
    keep: (to) => !dropPath(norm(to)),
  };
}

/**
 * Écrit un modlist.txt reflétant la sélection (mods exclus = « - », optionnels choisis = « + »).
 */
export function renderModlistTxt(selection) {
  const excluded = new Set(selection.excludedMods);
  const enabledOpt = new Set(selection.enabledOptional);
  let active = 0;
  const lines = selection.profileItems.map((it) => {
    if (it.separator) return `-${it.name}`;
    const key = lc(it.name);
    const on = excluded.has(key) ? false : (it.enabled || enabledOpt.has(key));
    if (on) active++;
    return `${on ? '+' : '-'}${it.name}`;
  });
  return { text: ['# This file was automatically generated by mABBAJACK.', ...lines].join('\n') + '\n', active };
}

/**
 * Supprime les doublons d'un même fichier de sortie : le mod de plus haute priorité MO2 l'emporte.
 * @param outPathOf (directive) => chemin de sortie résolu | null
 * @returns {{directives:object[], removed:number}}
 */
export function dedupeByPriority(directives, outPathOf, priority) {
  const prioOf = (to) => {
    const parts = norm(to).split('/');
    if (lc(parts[0]) !== 'mods') return -1; // hors mods : jamais en concurrence
    const p = priority.get(lc(parts[1]));
    return p === undefined ? Number.MAX_SAFE_INTEGER : p;
  };
  const best = new Map(); // clé → { index, prio }
  const prios = new Array(directives.length);
  const keys = new Array(directives.length);
  for (let i = 0; i < directives.length; i++) {
    const out = outPathOf(directives[i]);
    if (!out) continue;
    const key = lc(out);
    const prio = prioOf(directives[i].To);
    keys[i] = key; prios[i] = prio;
    const cur = best.get(key);
    if (!cur || prio < cur.prio) best.set(key, { index: i, prio });
  }
  const out = [];
  let removed = 0;
  for (let i = 0; i < directives.length; i++) {
    const key = keys[i];
    if (key !== undefined && best.get(key).index !== i) { removed++; continue; }
    out.push(directives[i]);
  }
  return { directives: out, removed };
}
