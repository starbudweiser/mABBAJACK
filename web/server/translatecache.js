// Cache disque des traductions MyMemory et suivi de son quota gratuit.
// Sans cache disque, chaque lancement retraduisait toute la galerie et épuisait le quota
// journalier en quelques minutes ; les descriptions restaient alors en anglais.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(process.env.MABBAJACK_DATA_DIR || path.join(os.homedir(), '.mabbajack'), 'translations.json');
const MAX_ENTRIES = 20000;
const SAVE_DELAY_MS = 2000;

/** Traductions déjà obtenues : clé `${lang}:${texte}` → texte traduit (ordre d'insertion = LRU simple). */
export const translateCache = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [k, v] of Object.entries(saved)) if (typeof v === 'string') translateCache.set(k, v);
  }
} catch { /* fichier absent ou corrompu : cache vide */ }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(translateCache)));
      fs.renameSync(tmp, FILE);
    } catch { /* écriture impossible : le cache reste en mémoire */ }
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

export function cacheSet(key, value) {
  if (translateCache.has(key)) translateCache.delete(key);
  translateCache.set(key, value);
  while (translateCache.size > MAX_ENTRIES) translateCache.delete(translateCache.keys().next().value);
  scheduleSave();
}

// ── Quota ────────────────────────────────────────────────────────────────────
let blockedUntil = 0;

/** Vrai tant que le quota gratuit du jour est épuisé : inutile d'interroger MyMemory. */
export function quotaExhausted() {
  return Date.now() < blockedUntil;
}

/** Note l'épuisement du quota d'après le message de MyMemory (« NEXT AVAILABLE IN 18 HOURS 20 MINUTES »). */
export function noteQuotaMessage(text) {
  if (!/YOU USED ALL AVAILABLE FREE TRANSLATIONS/i.test(String(text))) return false;
  const h = Number(/(\d+)\s*HOURS?/i.exec(text)?.[1] ?? 1);
  const m = Number(/(\d+)\s*MINUTES?/i.exec(text)?.[1] ?? 0);
  blockedUntil = Date.now() + (h * 60 + m + 1) * 60000;
  return true;
}
