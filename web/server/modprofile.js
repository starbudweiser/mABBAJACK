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

// ── Choix exclusifs ─────────────────────────────────────────────────────────
// Un profil MO2 n'exprime pas l'exclusivité : on la déduit des noms.
//  - familles : « (UI) Vel'dun … », « (UI) Norden … » : une seule famille active par étiquette ;
//  - format d'écran : suffixes 21x9 / 32x9 / 16x10, un seul format (ou aucun = 16:9) ;
//  - variantes : « Base - A », « Base - B » dont une seule est active dans le profil.
const FORMAT_RE = /(?:^|[^\p{L}\p{N}])(16x10|21x9|32x9)(?=$|[^\p{L}\p{N}])/iu;
const formatOf = (name) => (FORMAT_RE.exec(name)?.[1] || '').toLowerCase() || null;
const splitTag = (name) => {
  const m = /^\(([^)]*)\)\s*(.*)$/.exec(name);
  return m ? { tag: m[1].trim(), rest: m[2] } : { tag: '', rest: name };
};
const firstWord = (s) => (String(s).trim().split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}'’-]/gu, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
const FORMAT_ORDER = ['21x9', '32x9', '16x10'];

/**
 * Détecte les choix exclusifs d'un profil.
 * @returns {{choices: {id:string, kind:'family'|'format'|'variant', label:string, group:string|null,
 *   default:string, options:{id:string, label:string, mods:string[]}[]}[],
 *   formatMods: {name:string, format:string, choice:string|null, family:string|null}[], used:Set<string>}}
 */
export function detectChoices(items, singletons = null) {
  const mods = items.filter((it) => !it.separator);
  const used = new Set();
  const choices = [];
  const familyOf = new Map(); // nom (lc) → { choice, family }

  // 1. Familles, par étiquette « (TAG) »
  const byTag = new Map();
  for (const it of mods) {
    const { tag, rest } = splitTag(it.name);
    if (!tag) continue;
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push({ it, rest });
  }
  for (const [tag, list] of byTag) {
    const byWord = new Map();
    for (const e of list) {
      if (formatOf(e.it.name)) continue;
      const w = firstWord(e.rest);
      if (!w) continue;
      if (!byWord.has(lc(w))) byWord.set(lc(w), { word: w, members: [] });
      byWord.get(lc(w)).members.push(e.it);
    }
    const fams = [...byWord.values()].filter((f) => f.members.length >= 3
      && f.members.every((m) => m.enabled === f.members[0].enabled));
    const on = fams.filter((f) => f.members[0].enabled);
    if (fams.length < 2 || on.length !== 1) continue;
    const id = `family:${tag}`;
    const options = fams.map((f) => ({ id: f.word, label: f.word, mods: [], state: f.members[0].enabled }));
    for (const e of list) {
      const w = lc(firstWord(e.rest));
      const opt = options.find((o) => lc(o.id) === w) || options.find((o) => hasWord(e.rest, o.id));
      if (!opt) continue;
      familyOf.set(lc(e.it.name), { choice: id, family: opt.id });
      if (formatOf(e.it.name) || e.it.enabled !== opt.state) continue; // formats : traités à part
      opt.mods.push(e.it.name);
      used.add(lc(e.it.name));
    }
    choices.push({ id, kind: 'family', label: `(${tag})`, group: null, default: on[0].word,
      options: options.map(({ state, ...o }) => o) });
  }

  // 2. Format d'écran
  const formatMods = mods.filter((it) => formatOf(it.name));
  const enabledFormats = new Set(formatMods.filter((it) => it.enabled).map((it) => formatOf(it.name)));
  if (formatMods.length > 0 && enabledFormats.size <= 1) {
    const tokens = FORMAT_ORDER.filter((t) => formatMods.some((it) => formatOf(it.name) === t));
    choices.push({ id: 'format', kind: 'format', label: 'format', group: null, default: [...enabledFormats][0] || 'none',
      options: [{ id: 'none', label: '16:9', mods: [] }, ...tokens.map((t) => ({ id: t, label: t.replace('x', ':'), mods: formatMods.filter((it) => formatOf(it.name) === t).map((it) => it.name) }))] });
    for (const it of formatMods) used.add(lc(it.name));
  }
  const fmtList = choices.some((c) => c.id === 'format')
    ? formatMods.map((it) => ({ name: it.name, format: formatOf(it.name), ...(familyOf.get(lc(it.name)) || { choice: null, family: null }) }))
    : [];

  // 3. Variantes « Base - Suffixe » : une seule active dans le profil
  const byBase = new Map();
  for (const it of mods) {
    if (used.has(lc(it.name))) continue;
    const i = it.name.lastIndexOf(' - ');
    if (i <= 0) continue;
    const key = `${it.group || ''}\u0000${lc(it.name.slice(0, i))}`;
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(it);
  }
  for (const [key, list] of byBase) {
    if (list.length < 2 || list.filter((it) => it.enabled).length !== 1) continue;
    const base = list[0].name.slice(0, list[0].name.lastIndexOf(' - '));
    choices.push({ id: `variant:${key}`, kind: 'variant', label: base, group: list[0].group || null,
      default: list.find((it) => it.enabled).name,
      options: list.map((it) => ({ id: it.name, label: it.name.slice(base.length + 3), mods: [it.name] })) });
    for (const it of list) used.add(lc(it.name));
  }
  // 4. Mods d'une même section qui fournissent le même fichier « unique » (enbseries.ini,
  //    dossier enbseries/…) : un seul peut être actif (presets ENB…). Une extension nommée
  //    d'après un autre membre (« Foo - Bar », « … For Foo ») n'est pas une option : elle reste
  //    une case à cocher qui exige sa base.
  const extensions = new Map(); // nom (lc) → { choice, option }
  if (singletons) {
    const byGroup = new Map();
    for (const it of mods) {
      if (used.has(lc(it.name)) || !it.group) continue;
      const keys = singletons.get(lc(it.name));
      if (!keys?.size) continue;
      if (!byGroup.has(it.group)) byGroup.set(it.group, []);
      byGroup.get(it.group).push({ it, keys });
    }
    for (const [group, list] of byGroup) {
      // composantes connexes par fichier partagé
      const comp = new Map(list.map((e) => [e, e]));
      const root = (e) => { while (comp.get(e) !== e) e = comp.get(e); return e; };
      for (const a of list) for (const b of list) {
        if (a !== b && [...a.keys].some((k) => b.keys.has(k))) comp.set(root(a), root(b));
      }
      const parts = new Map();
      for (const e of list) { const r = root(e); if (!parts.has(r)) parts.set(r, []); parts.get(r).push(e.it); }
      for (const members of parts.values()) {
        const bases = members.filter((m) => !baseOf(m, members));
        if (bases.length < 2 || bases.filter((m) => m.enabled).length > 1) continue;
        const id = `exclusive:${group}`;
        const on = bases.find((m) => m.enabled);
        choices.push({ id, kind: 'exclusive', label: group, group, default: on ? on.name : 'none',
          options: [...bases.map((m) => ({ id: m.name, label: m.name, mods: [m.name] })), { id: 'none', label: 'none', mods: [] }] });
        for (const m of bases) used.add(lc(m.name));
        for (const m of members) {
          const b = baseOf(m, members);
          if (b) extensions.set(lc(m.name), { choice: id, option: b.name });
        }
      }
    }
  }
  return { choices, formatMods: fmtList, used, extensions };
}

// ── Consignes de la liste ─────────────────────────────────────────────────
// Séparateur « DO NOT ENABLE » : sources fusionnées ou ressources, jamais proposées.
const LOCKED_SEP_RE = /\b(do\s*not|don'?t|never)\s+(enable|use|activate|install)\b/i;
// Séparateur d'outils de test de l'auteur : proposés à part, déconseillés.
const DEBUG_SEP_RE = /\b(game\s*testing|testing|debug(ging)?|dev(eloper)?\s*tools?|profil(er|ing))\b/i;

/**
 * Classe les mods désactivés d'un profil et leurs dépendances.
 * @returns {{ locked: Set<string>, debug: Set<string>,
 *   requires: Map<string, string[]>, requiresChoice: Map<string, {choice:string, option:string}> }}
 *   (clés en minuscules ; requires → noms de mods optionnels dont dépend le mod)
 */
export function classifyOptions(items, det) {
  const locked = new Set(), debug = new Set();
  const optional = items.filter((it) => !it.separator && !it.enabled && !det.used.has(lc(it.name)));
  for (const it of optional) {
    if (it.group && LOCKED_SEP_RE.test(it.group)) locked.add(lc(it.name));
    else if (it.group && DEBUG_SEP_RE.test(it.group)) debug.add(lc(it.name));
  }
  const offered = optional.filter((it) => !locked.has(lc(it.name)));
  const requires = new Map(), requiresChoice = new Map();
  for (const m of offered) {
    // Patch nommé d'après un autre mod optionnel : « Foo - Bar Patch » dépend de « Foo »
    const base = baseOf(m, offered);
    if (base) requires.set(lc(m.name), [lc(base.name)]);
    const ext = det.extensions?.get(lc(m.name));
    if (ext) { requiresChoice.set(lc(m.name), ext); continue; }
    // Mod d'une famille d'interface : « (UI) Edge UI - … » n'a de sens qu'avec la famille Edge
    const { tag, rest } = splitTag(m.name);
    const fam = tag && det.choices.find((c) => c.id === `family:${tag}`);
    const opt = fam && fam.options.find((o) => hasWord(rest, o.id));
    if (opt) requiresChoice.set(lc(m.name), { choice: fam.id, option: opt.id });
  }
  return { locked, debug, requires, requiresChoice };
}

const GENERIC_WORDS = new Set(['enb', 'the', 'a', 'mod', 'for', 'and', 'of']);
const words = (s) => lc(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
/**
 * Mod dont `m` est une extension parmi `candidates` : « Foo - Bar » → « Foo » ;
 * « AMON ENB For NAT III 2026 » → « NAT.ENB III » (mots distinctifs de la base après « for »).
 */
export function baseOf(m, candidates) {
  for (const n of candidates) {
    if (n === m) continue;
    if (lc(m.name).startsWith(lc(n.name)) && /^[\s-]/.test(m.name.slice(n.name.length))) return n;
  }
  const f = /\bfor\s+(.+)$/i.exec(splitTag(m.name).rest);
  if (!f) return null;
  const target = new Set(words(f[1]));
  for (const n of candidates) {
    if (n === m) continue;
    const need = words(splitTag(n.name).rest).filter((w) => !GENERIC_WORDS.has(w));
    if (need.length && need.every((w) => target.has(w))) return n;
  }
  return null;
}

/** Fichiers « uniques » par mod (un seul exemplaire possible dans le jeu) : nom de mod (lc) → Set de clés. */
const SINGLETON_FILE_RE = /^(enbseries\.ini|enblocal\.ini|d3d11\.dll|d3dcompiler_46e\.dll|dxgi\.dll|reshade\.ini)$/i;
export function singletonFiles(raw) {
  const out = new Map();
  for (const d of raw.Directives || raw.directives || []) {
    const parts = norm(d.To || d.to).split('/');
    if (lc(parts[0]) !== 'mods' || parts.length < 3) continue;
    const rel = parts.slice(2);
    if (lc(rel[0]) === 'root') rel.shift(); // Root/… = racine du jeu, même rôle
    let key = null;
    // enbseries.ini et le dossier enbseries/ forment un même preset ENB
    if (rel.length === 1 && lc(rel[0]) === 'enbseries.ini') key = 'enb-preset';
    else if (rel.length === 1 && SINGLETON_FILE_RE.test(rel[0])) key = lc(rel[0]);
    else if (rel.length > 1 && lc(rel[0]) === 'enbseries') key = 'enb-preset';
    if (!key) continue;
    const mod = lc(parts[1]);
    if (!out.has(mod)) out.set(mod, new Set());
    out.get(mod).add(key);
  }
  return out;
}

/** État (activé ou non) imposé par les choix : nom de mod (lc) → booléen. */
export function choiceOverrides(det, picked = {}) {
  const out = new Map();
  const pick = (c) => {
    const v = picked[c.id];
    return c.options.some((o) => o.id === v) ? v : c.default;
  };
  for (const c of det.choices) {
    if (c.kind === 'format') continue;
    const chosen = pick(c);
    for (const o of c.options) for (const m of o.mods) out.set(lc(m), o.id === chosen);
  }
  const fmt = det.choices.find((c) => c.kind === 'format');
  if (fmt) {
    const chosen = pick(fmt);
    const famChoice = new Map(det.choices.filter((c) => c.kind === 'family').map((c) => [c.id, pick(c)]));
    for (const m of det.formatMods) {
      out.set(lc(m.name), m.format === chosen && (!m.choice || famChoice.get(m.choice) === m.family));
    }
  }
  return out;
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
  const singles = singletonFiles(raw);
  const dets = new Map([...profiles.values()].map((p) => [p, detectChoices(p.items, singles)]));
  // Variante dont la valeur change d'un profil à l'autre (ex. DynDOLOD Ultra / Standard) :
  // elle découle du profil choisi, on ne la propose pas séparément.
  const defaults = new Map();
  for (const det of dets.values()) for (const c of det.choices) {
    if (!defaults.has(c.id)) defaults.set(c.id, new Set());
    defaults.get(c.id).add(c.default);
  }
  const out = [];
  for (const p of profiles.values()) {
    const groups = new Map();
    let count = 0, bytes = 0;
    const det = dets.get(p);
    const cls = classifyOptions(p.items, det);
    const locked = new Map();
    // Ordre d'affichage = ordre de la liste MO2 (de bas en haut du fichier)
    for (let i = p.items.length - 1; i >= 0; i--) {
      const it = p.items[i];
      if (it.separator || it.enabled || det.used.has(lc(it.name))) continue;
      const size = sizes.get(lc(it.name)) || 0;
      const key = it.group || '—';
      if (cls.locked.has(lc(it.name))) { locked.set(key, (locked.get(key) || 0) + 1); continue; }
      if (!groups.has(key)) groups.set(key, []);
      const requires = (cls.requires.get(lc(it.name)) || []).map((k) => p.mods.get(k)?.name || k);
      const requiresChoice = cls.requiresChoice.get(lc(it.name));
      groups.get(key).push({ name: it.name, size, ...(requires.length ? { requires } : {}), ...(requiresChoice ? { requiresChoice } : {}) });
      count++; bytes += size;
    }
    out.push({
      name: p.name,
      isDefault: p === def,
      groups: [...groups.entries()].map(([separator, mods]) => ({ separator, mods, ...(DEBUG_SEP_RE.test(separator) ? { debug: true } : {}) })),
      // Séparateurs « DO NOT ENABLE » : non proposés, seulement signalés
      lockedGroups: [...locked.entries()].map(([separator, count]) => ({ separator, count })),
      choices: det.choices.map((c) => ({
        ...c,
        hidden: c.kind === 'variant' && defaults.get(c.id).size > 1,
        options: c.options.map((o) => ({ ...o, size: o.mods.reduce((s, m) => s + (sizes.get(lc(m)) || 0), 0) })),
      })),
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
 * @param options { profile?: string, enable?: string[], choices?: {[id]: optionId} }
 *   enable : mods optionnels à installer ; choices : options retenues pour les choix exclusifs
 */
export async function buildSelection(raw, readEntry, options = {}) {
  const profiles = await loadProfiles(raw, readEntry);
  const profile = pickProfile(profiles, options.profile, raw.Name);
  const enable = new Set((options.enable || []).map(lc));
  const det = profile ? detectChoices(profile.items, singletonFiles(raw)) : null;
  const overrides = profile ? choiceOverrides(det, options.choices || {}) : new Map();
  if (profile) {
    // Consignes de la liste : jamais de mod « DO NOT ENABLE », ni de mod dont la dépendance est absente
    const cls = classifyOptions(profile.items, det);
    for (const k of cls.locked) enable.delete(k);
    const picked = (c) => {
      const choice = det.choices.find((x) => x.id === c);
      const v = (options.choices || {})[c];
      return choice && choice.options.some((o) => o.id === v) ? v : choice?.default;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of [...enable]) {
        const deps = cls.requires.get(k) || [];
        const rc = cls.requiresChoice.get(k);
        if (deps.some((d) => !enable.has(d)) || (rc && picked(rc.choice) !== rc.option)) { enable.delete(k); changed = true; }
      }
    }
  }
  const excluded = new Set();
  const turnedOn = new Set();
  const priority = new Map();
  if (profile) {
    for (const [key, it] of profile.mods) {
      priority.set(key, it.priority);
      const on = overrides.has(key) ? overrides.get(key) : (it.enabled || enable.has(key));
      if (!on) excluded.add(key);
      else if (!it.enabled) turnedOn.add(key);
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
  const pluginsAdded = new Map(); // plugins des mods activés par l'utilisateur : lc → nom
  let droppedCount = 0;
  let keptBytes = 0;
  for (const d of directives) {
    const to = norm(d.To || d.to);
    const drop = dropPath(to);
    const hash = d.ArchiveHashPath?.[0];
    if (hash) (drop ? droppedHashes : keptHashes).add(hash);
    const base = to.split('/').pop();
    if (PLUGIN_RE.test(base) && /^mods\//i.test(to)) {
      (drop ? droppedPlugins : keptPlugins).add(lc(base));
      if (!drop && to.split('/').length === 3 && turnedOn.has(lc(to.split('/')[1]))) pluginsAdded.set(lc(base), base);
    }
    if (drop) droppedCount++;
    else keptBytes += Number(d.Size) || 0;
  }
  const skipHashes = new Set([...droppedHashes].filter((h) => !keptHashes.has(h)));
  const pluginsExcluded = new Set([...droppedPlugins].filter((p) => !keptPlugins.has(p)));

  return {
    profile: profile ? profile.name : null,
    profileItems: profile ? profile.items : [],
    excludedMods: [...excluded],
    enabledOptional: [...turnedOn],
    pluginsAdded,
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
