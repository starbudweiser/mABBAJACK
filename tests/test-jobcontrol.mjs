// Test : pause/reprise/annulation des processus enfants et arrêt sur disparition du parent.
// Usage : node scripts/test-jobcontrol.mjs
import { spawn as rawSpawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { jobControl, trackedSpawn, killAllChildren } from '../web/server/jobcontrol.js';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const state = (pid) => execFileSync('ps', ['-o', 'stat=', '-p', String(pid)]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. pause → processus stoppé (T), reprise → actif
const p = trackedSpawn('sleep', ['60'], { stdio: 'ignore' });
await sleep(200);
jobControl.setPaused(true);
await sleep(200);
assert.match(state(p.pid), /^T/, 'le processus doit être stoppé');
jobControl.setPaused(false);
await sleep(200);
assert.doesNotMatch(state(p.pid), /^T/, 'le processus doit reprendre');

// 2. un processus lancé pendant la pause démarre stoppé
jobControl.setPaused(true);
const q = trackedSpawn('sleep', ['60'], { stdio: 'ignore' });
await sleep(200);
assert.match(state(q.pid), /^T/, 'processus créé en pause = stoppé');

// 3. annulation pendant la pause → tous morts
jobControl.cancel();
await sleep(300);
assert.equal(alive(p.pid) && state(p.pid).startsWith('Z') === false, false, 'p doit être tué');
assert.equal(alive(q.pid) && state(q.pid).startsWith('Z') === false, false, 'q doit être tué');
assert.equal(jobControl.paused, false);

// 4. waitIfPaused lève « Annulé »
const ac = new AbortController();
jobControl.setPaused(true);
const waiting = jobControl.waitIfPaused(ac.signal).then(() => 'ok', (e) => e.message);
ac.abort();
assert.equal(await waiting, 'Annulé');
jobControl.setPaused(false);

// 5. le serveur s'arrête (et tue ses enfants) quand le parent disparaît
const parent = rawSpawn('sleep', ['60'], { stdio: 'ignore' });
const srv = rawSpawn('node', ['-e', `
  import('${new URL('../web/server/jobcontrol.js', import.meta.url).href}').then(({ trackedSpawn, shutdown }) => {
    const c = trackedSpawn('sleep', ['60'], { stdio: 'ignore' });
    console.log(c.pid);
    setInterval(() => { try { process.kill(${parent.pid}, 0); } catch { shutdown(0); } }, 200);
  });
`], { stdio: ['ignore', 'pipe', 'inherit'] });
const childPid = await new Promise((r) => srv.stdout.once('data', (d) => r(Number(String(d).trim()))));
assert.ok(alive(childPid));
parent.kill('SIGKILL');
await sleep(1000);
assert.equal(srv.exitCode, 0, 'le serveur doit s\'arrêter');
assert.equal(alive(childPid) && !state(childPid).startsWith('Z'), false, 'l\'enfant doit être tué');

killAllChildren();
console.log('OK : jobcontrol');
process.exit(0);
