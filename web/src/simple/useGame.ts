import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/api';

export interface DetectedGame { loaded: boolean; found: boolean; edition: 'SE' | 'AE' | 'VR' | 'Unknown'; path: string }

let pending: Promise<DetectedGame> | null = null;

/** Skyrim installé sur ce Mac (détection Steam, Whisky, CrossOver) : une seule requête pour toute la session. */
export function useDetectedGame(): DetectedGame {
  const [game, setGame] = useState<DetectedGame>({ loaded: false, found: false, edition: 'Unknown', path: '' });
  useEffect(() => {
    let alive = true;
    pending ??= fetch(`${getApiBaseUrl()}/api/system/detect-skyrim`)
      .then((r) => r.json())
      .then((d) => ({ loaded: true, found: !!d.found, edition: (d.edition || 'Unknown') as DetectedGame['edition'], path: d.path || '' }))
      .catch(() => ({ loaded: true, found: false, edition: 'Unknown' as const, path: '' }));
    pending.then((g) => { if (alive) setGame(g); });
    return () => { alive = false; };
  }, []);
  return game;
}

/** Édition de Skyrim exigée par une modlist d'après la version exacte lue dans son manifeste ; null si inconnue. */
export function requiredEdition(archives: Array<{ State?: unknown }> | undefined): 'SE' | 'AE' | null {
  for (const a of archives || []) {
    const v = String((a?.State as { GameVersion?: unknown } | undefined)?.GameVersion || '');
    if (/^1\.([6-9]|\d{2,})\./.test(v)) return 'AE';
    if (/^1\.5\./.test(v)) return 'SE';
  }
  return null;
}
