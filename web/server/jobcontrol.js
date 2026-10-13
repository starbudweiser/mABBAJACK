// Contrôle de l'installation en cours : pause/reprise, annulation et registre des processus enfants
// (7zz, unar…). Aucun processus enfant ne doit survivre à l'annulation ni à l'arrêt du serveur.

import { EventEmitter } from 'node:events';
import { spawn as rawSpawn } from 'node:child_process';

const children = new Set();
const events = new EventEmitter();
events.setMaxListeners(0);

export const jobControl = {
  paused: false,
  events,

  /** Bloque tant que l'installation est suspendue ; lève « Annulé » si annulée. */
  async waitIfPaused(signal) {
    while (this.paused) {
      if (signal?.aborted) throw new Error('Annulé');
      await new Promise((r) => setTimeout(r, 200));
    }
    if (signal?.aborted) throw new Error('Annulé');
  },

  setPaused(value) {
    const next = !!value;
    if (next === this.paused) return;
    this.paused = next;
    signalChildren(next ? 'SIGSTOP' : 'SIGCONT');
    events.emit(next ? 'pause' : 'resume');
  },

  /** Annulation : lève la pause (pour débloquer les attentes) et tue tous les enfants. */
  cancel() {
    this.paused = false;
    events.emit('resume');
    killAllChildren();
  },

  childCount() { return children.size; },
};

function signalChildren(sig) {
  for (const c of children) {
    try { if (c.pid && c.exitCode === null) process.kill(c.pid, sig); } catch { /* déjà terminé */ }
  }
}

/** Tue tous les processus enfants suivis (SIGCONT d'abord : un processus stoppé ne reçoit pas SIGTERM). */
export function killAllChildren() {
  for (const c of [...children]) {
    try {
      if (c.pid && c.exitCode === null) {
        process.kill(c.pid, 'SIGCONT');
        process.kill(c.pid, 'SIGKILL');
      }
    } catch { /* déjà terminé */ }
  }
  children.clear();
}

/** spawn() qui enregistre le processus ; il est mis en pause s'il démarre pendant une suspension. */
export function trackedSpawn(cmd, args, options) {
  const proc = rawSpawn(cmd, args, options);
  children.add(proc);
  const forget = () => children.delete(proc);
  proc.on('close', forget);
  proc.on('error', forget);
  if (jobControl.paused && proc.pid) {
    try { process.kill(proc.pid, 'SIGSTOP'); } catch { /* ignore */ }
  }
  return proc;
}

let shuttingDown = false;
/** Arrêt du serveur : tuer les enfants puis quitter. */
export function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killAllChildren();
  process.exit(code);
}

process.on('exit', killAllChildren);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => shutdown(0));
