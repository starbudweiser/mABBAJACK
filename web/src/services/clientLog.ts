// ──────────────────────────────────────────────────────────
// Transmission des entrées du journal de l'interface au serveur,
// qui les écrit dans logs/mabbajack.log (source « client » ou « js »).
// Envoi groupé (500 ms), sendBeacon à la fermeture de la page.
// ──────────────────────────────────────────────────────────
import { getApiBaseUrl } from './api';

type ClientLogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';
interface ClientLogEntry {
  level: ClientLogLevel;
  message: string;
  details?: string;
  source: 'client' | 'js';
  at: number;
}

const MAX_QUEUE = 2000;
let queue: ClientLogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, 500);
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Serveur indisponible : on remet le lot en tête (borné) et on réessaie plus tard
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    if (!timer) timer = setTimeout(flush, 5000);
    return;
  }
  if (queue.length > 0) schedule(0);
}

function schedule(delay = 500): void {
  if (!timer) timer = setTimeout(flush, delay);
}

/** Ajoute une entrée au journal fichier du serveur. */
export function sendClientLog(level: ClientLogLevel, message: string, details?: string, source: 'client' | 'js' = 'client'): void {
  if (typeof message !== 'string' || !message) return;
  queue.push({ level, message, details: details || undefined, source, at: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  schedule();
}

let installed = false;
/** Capture les erreurs JavaScript non interceptées et vide la file à la fermeture. */
export function installGlobalLogCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    sendClientLog('error', `Erreur JS : ${e.message}`, [e.filename && `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack].filter(Boolean).join('\n'), 'js');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    sendClientLog('error', `Promesse rejetée : ${r?.message || String(r)}`, r?.stack, 'js');
  });
  window.addEventListener('pagehide', () => {
    if (queue.length === 0) return;
    try {
      const blob = new Blob([JSON.stringify({ entries: queue.splice(0, 500) })], { type: 'application/json' });
      navigator.sendBeacon(`${getApiBaseUrl()}/api/log`, blob);
    } catch { /* ignore */ }
  });
}
