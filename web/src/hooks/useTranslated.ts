import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../services/api';

// ── Module-level cache partagé entre tous les composants ─────────────────────
const _txCache = new Map<string, string>();

export async function translateOne(text: string, lang: string): Promise<string> {
  if (!text || lang === 'en') return text;
  // Le serveur découpe en blocs ≤ 400 octets ; on borne seulement la taille totale
  if (text.length > 20000) text = text.slice(0, 20000);
  const key = `${lang}:${text}`;
  if (_txCache.has(key)) return _txCache.get(key)!;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) return text;
    const data = await res.json();
    const translated = data.result || text;
    // Discard API error messages returned as translated text
    const isError = /QUERY LENGTH LIMIT|MAX ALLOWED QUERY|^error[:\s]/i.test(translated);
    const final = isError ? text : translated;
    if (!isError && final !== text) _txCache.set(key, final);
    return final;
  } catch {
    return text;
  }
}

export async function translateBatch(texts: string[], lang: string): Promise<string[]> {
  if (lang === 'en') return texts;
  const uncached = texts.filter((t) => t && !_txCache.has(`${lang}:${t}`));
  if (uncached.length > 0) {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: uncached, lang }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.results as string[])?.forEach((t, i) => {
          if (t) _txCache.set(`${lang}:${uncached[i]}`, t);
        });
      }
    } catch { /* use cache as-is */ }
  }
  return texts.map((t) => (t ? (_txCache.get(`${lang}:${t}`) ?? t) : t));
}

/** Hook : traduit une seule chaîne, retourne l'original pendant le chargement */
export function useTranslated(text: string | undefined, lang: string): { translated: string; loading: boolean } {
  const [translated, setTranslated] = useState(text || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!text) { setTranslated(''); return; }
    if (lang === 'en') { setTranslated(text); return; }
    const key = `${lang}:${text}`;
    if (_txCache.has(key)) { setTranslated(_txCache.get(key)!); return; }
    let cancelled = false;
    setLoading(true);
    translateOne(text, lang).then((r) => { if (!cancelled) { setTranslated(r); setLoading(false); } });
    return () => { cancelled = true; };
  }, [text, lang]);

  return { translated, loading };
}
