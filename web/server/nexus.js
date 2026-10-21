// API Nexus Mods : appels avec nouvelles tentatives, statut Premium, liens de téléchargement.

// ──────────────────────────────────────────────────────────
// Nexus Mods helpers
// ──────────────────────────────────────────────────────────
export const NEXUS_RETRIES = 4;

export async function nexusFetchOnce(endpoint, apiKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://api.nexusmods.com${endpoint}`, {
      headers: { apikey: apiKey, 'Application-Name': 'mAbbajack-macOS', 'Application-Version': '2.1.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`Nexus API ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw err;
    }
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Appel API Nexus ; réessaie sur limite de débit (429), erreur serveur (5xx) ou coupure réseau. */
export async function nexusFetch(endpoint, apiKey) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await nexusFetchOnce(endpoint, apiKey);
    } catch (e) {
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || attempt >= NEXUS_RETRIES) throw e;
      const wait = e.retryAfter ? e.retryAfter * 1000 : 2000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60000)));
    }
  }
}

// Statut Premium par clé : une seule vérification par session au lieu d'une par archive
export const nexusPremiumCache = new Map();
export async function isNexusPremium(apiKey) {
  if (!nexusPremiumCache.has(apiKey)) {
    const validate = await nexusFetch('/v1/users/validate.json', apiKey);
    nexusPremiumCache.set(apiKey, !!validate.is_premium);
  }
  return nexusPremiumCache.get(apiKey);
}

export async function getNexusDownloadUrl(gameName, modId, fileId, apiKey) {
  if (!apiKey || !modId || !fileId) return { url: null, requiresManual: true };
  try {
    if (!(await isNexusPremium(apiKey))) {
      return { url: null, requiresManual: true, isPremium: false, manualUrl: `https://www.nexusmods.com/${gameName}/mods/${modId}?tab=files&file_id=${fileId}` };
    }
    const links = await nexusFetch(`/v1/games/${gameName}/mods/${modId}/files/${fileId}/download_link.json`, apiKey);
    if (Array.isArray(links) && links.length > 0) {
      const cdn = links.find((l) => l.short_name === 'Cloudflare' || l.short_name === 'CDN') || links[0];
      return { url: cdn.URI, requiresManual: false, isPremium: true };
    }
    return { url: null, requiresManual: true, isPremium: true };
  } catch (err) {
    return { url: null, requiresManual: true, error: err.message };
  }
}
