import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/api';
import { useMabbajack } from '../state/mabbajack';

export interface DetectedGame { loaded: boolean; found: boolean; edition: 'SE' | 'AE' | 'VR' | 'Unknown'; path: string; auto: boolean }

let pending: Promise<DetectedGame> | null = null;

/** Skyrim installé sur ce Mac (détection Steam, Whisky, CrossOver) : une seule requête pour toute la session. */
function useAutoGame(): DetectedGame {
  const [game, setGame] = useState<DetectedGame>({ loaded: false, found: false, edition: 'Unknown', path: '', auto: true });
  useEffect(() => {
    let alive = true;
    pending ??= fetch(`${getApiBaseUrl()}/api/system/detect-skyrim`)
      .then((r) => r.json())
      .then((d) => ({ loaded: true, found: !!d.found, edition: (d.edition || 'Unknown') as DetectedGame['edition'], path: d.path || '', auto: true }))
      .catch(() => ({ loaded: true, found: false, edition: 'Unknown' as const, path: '', auto: true }));
    pending.then((g) => { if (alive) setGame(g); });
    return () => { alive = false; };
  }, []);
  return game;
}

/** Jeu détecté automatiquement, ou à défaut le dossier choisi à la main s'il contient bien Skyrim. */
export function useDetectedGame(): DetectedGame {
  const auto = useAutoGame();
  const { gamePath } = useMabbajack();
  const manual = gamePath.trim();
  const [checked, setChecked] = useState<{ path: string; found: boolean; edition: DetectedGame['edition'] } | null>(null);
  useEffect(() => {
    if (!manual || (auto.found && manual === auto.path)) { setChecked(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      fetch(`${getApiBaseUrl()}/api/system/detect-skyrim-at`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gamePath: manual }),
      }).then((r) => r.json())
        .then((d) => { if (alive) setChecked({ path: manual, found: !!d.found, edition: (d.edition || 'Unknown') as DetectedGame['edition'] }); })
        .catch(() => { if (alive) setChecked({ path: manual, found: false, edition: 'Unknown' }); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [manual, auto.found, auto.path]);

  if (checked && checked.path === manual && checked.found) return { loaded: true, found: true, edition: checked.edition, path: manual, auto: false };
  if (auto.found && (!manual || manual === auto.path)) return auto;
  // Dossier saisi mais pas encore vérifié : pas de verdict, pour ne pas afficher « introuvable » à tort
  const pendingCheck = !!manual && !(checked && checked.path === manual);
  return { ...auto, found: false, loaded: auto.loaded && !pendingCheck };
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
