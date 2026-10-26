/**
 * Clé API Nexus : rangée dans le trousseau macOS par le serveur local (plus dans le localStorage).
 * Une clé encore présente dans l'ancien localStorage y est déplacée au premier chargement.
 */
import { getApiBaseUrl } from './api';

const LEGACY_KEY = 'mabbajack_nexus_key';

async function put(key: string): Promise<boolean> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/nexus/key`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function loadNexusKey(): Promise<string> {
  let legacy = '';
  try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch { /* stockage indisponible */ }
  if (legacy && (await put(legacy))) {
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* rien */ }
    return legacy;
  }
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/nexus/key`);
    const d = await r.json();
    return typeof d.key === 'string' && d.key ? d.key : legacy;
  } catch {
    return legacy;
  }
}

// La saisie appelle storeNexusKey à chaque frappe : on n'écrit dans le trousseau qu'une fois la saisie finie.
let timer: ReturnType<typeof setTimeout> | undefined;
export function storeNexusKey(key: string): void {
  clearTimeout(timer);
  timer = setTimeout(() => { void put(key.trim()); }, 600);
}
