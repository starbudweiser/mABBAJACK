// État partagé du serveur : flux SSE vers l'interface, historique du journal, travail d'installation en cours.

import { writeLog } from './logger.js';

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────
export const sseClients = [];
export const logHistory = [];
export const currentInstallJob = {
  active: false,
  abortController: null,
  progress: {
    stage: 'idle', stageName: 'En attente', overallPercent: 0, stagePercent: 0,
    currentTask: 'Prêt', processedItems: 0, totalItems: 0, processedBytes: 0,
    totalBytes: 0, speedBytesPerSec: 0, etaSeconds: 0, activeDownloads: 0,
    missingArchivesCount: 0, isPaused: false, hasError: false, errorMessage: null,
  },
};

// ──────────────────────────────────────────────────────────
// SSE
// ──────────────────────────────────────────────────────────
export function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => { try { res.write(payload); } catch { /**/ } });
}
export function broadcastLog(level, message, details = null) {
  const log = { id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, timestamp: new Date().toLocaleTimeString(), level, message, details };
  logHistory.push(log);
  if (logHistory.length > 500) logHistory.shift();
  writeLog({ level, message, details, source: 'server' });
  broadcastSSE({ type: 'log', log });
}
/** Détail technique écrit uniquement dans le fichier journal (pas dans l'interface). */
export function debugLog(message, details = null) {
  writeLog({ level: 'debug', message, details, source: 'server' });
}
export function broadcastProgress(patch) {
  currentInstallJob.progress = { ...currentInstallJob.progress, ...patch };
  broadcastSSE({ type: 'progress', progress: currentInstallJob.progress });
}
