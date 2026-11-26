/**
 * Pluriels et nombres des textes de l'interface.
 *
 * Les gabarits gardent la notation « mot(s) » (fr, es, en) ou « mot/i » (it) à côté du nombre qui les commande ;
 * `fillText` remplace les {valeurs} et accorde chaque marque d'après le nombre qui la précède, avec `Intl.PluralRules`
 * de la langue de l'interface (1 → singulier, 0 → singulier en français, pluriel en anglais, espagnol et italien).
 * Les nombres passés en paramètre sont formatés avec `Intl.NumberFormat` de la langue.
 */
import type { Language } from './types';

const LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', it: 'it-IT' };
const rulesCache = new Map<string, Intl.PluralRules>();

/** Vrai quand `n` s'écrit au pluriel dans cette langue. */
export function isPlural(n: number, lang: Language): boolean {
  let rules = rulesCache.get(lang);
  if (!rules) { rules = new Intl.PluralRules(LOCALE[lang]); rulesCache.set(lang, rules); }
  return rules.select(Number.isFinite(n) ? Math.abs(n) : 0) !== 'one';
}

/** Applique une marque de pluriel au mot qui la précède. */
function applyMark(word: string, mark: string, plural: boolean): string {
  if (!plural) return word;
  if (mark === '(s)') return `${word}s`;
  if (mark === '(es)') return /ón$/.test(word) ? `${word.slice(0, -2)}ones` : `${word}es`; // corrección → correcciones
  if (mark === '(x)') return `${word}x`;
  if (mark === '(aux)') return word.replace(/al$/, 'aux');
  // Italien « archivio/i », « applicata/e » : la dernière lettre du mot est remplacée
  return word.slice(0, -1) + mark.slice(1);
}

// mot + marque, ou {valeur}
const TOKEN = /\{(\w+)\}|([\p{L}’']+)(\(s\)|\(es\)|\(aux\)|\(x\)|\/[ie])(?![\p{L}])/gu;

const asCount = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v);
  return undefined;
};

/**
 * Remplace les {valeurs} d'un gabarit et accorde les marques de pluriel.
 * Une marque s'accorde avec le dernier nombre rencontré avant elle ; sans nombre avant, avec le premier de la phrase.
 */
export function fillText(tpl: string, params: Record<string, string | number | undefined> | undefined, lang: Language): string {
  const p = params ?? {};
  let current: number | undefined;
  let first: number | undefined;
  for (const k of Object.keys(p)) { const c = asCount(p[k]); if (c !== undefined) { first = c; break; } }
  return tpl.replace(TOKEN, (_m, key: string | undefined, word: string | undefined, mark: string | undefined) => {
    if (key !== undefined) {
      const v = p[key];
      const c = asCount(v);
      if (c !== undefined) current = c;
      if (v === undefined) return '';
      return typeof v === 'number' && Number.isInteger(v) ? v.toLocaleString(lang) : String(v);
    }
    if ((mark as string).startsWith('/') && lang !== 'it') return `${word}${mark}`;
    return applyMark(word as string, mark as string, isPlural(current ?? first ?? 2, lang));
  });
}

const NUMBER_RE = /\d+(?:[ \u00a0\u202f.,]\d+)*/gu;
/** Valeur d'un nombre écrit dans un texte (« 1 284 », « 2,5 »), séparateurs de milliers compris. */
function readNumber(s: string): number {
  if (/^\d{1,3}([ \u00a0\u202f.,]\d{3})+$/.test(s)) return Number(s.replace(/[ \u00a0\u202f.,]/g, ''));
  return Number(s.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
}

/** Accorde les marques de pluriel d'un texte déjà composé (messages du journal) d'après le nombre qui les précède. */
export function pluralizeText(text: string, lang: Language): string {
  if (!/\((?:s|es|aux|x)\)|[\p{L}]\/[ie](?![\p{L}])/u.test(text)) return text;
  const tokens = new RegExp(`${NUMBER_RE.source}|${TOKEN.source}`, 'gu');
  let current = 2;
  return text.replace(tokens, (m, _key, word: string | undefined, mark: string | undefined) => {
    if (word !== undefined && mark !== undefined) {
      if (mark.startsWith('/') && lang !== 'it') return m;
      return applyMark(word, mark, isPlural(current, lang));
    }
    if (/^\d/.test(m)) { const n = readNumber(m); if (Number.isFinite(n)) current = n; }
    return m;
  });
}
