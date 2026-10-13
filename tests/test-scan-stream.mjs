// Test de bout en bout du scan en flux : démarre le serveur sur un port libre, scanne un dossier
// avec les archives d'un vrai .wabbajack et vérifie les événements de progression.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWabbajack } from '../web/server/inspect.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wab = process.argv[2] || path.join(root, 'tests', 'Authoria - Requiem Reforged.wabbajack');
if (!fs.existsSync(wab)) { console.log('SKIP : fichier de test absent', wab); process.exit(0); }

const port = 3900 + Math.floor(Math.random() * 90);
const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
const stop = () => { try { child.kill(); } catch { /* déjà arrêté */ } };
process.on('exit', stop);

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/modlists/health`).catch(() => fetch(`http://127.0.0.1:${port}/`)); break; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }

  const info = await inspectWabbajack(wab);
  const body = { downloadsPath: path.join(root, 'tests'), gamePath: '', archives: info.archives };
  const res = await fetch(`http://127.0.0.1:${port}/api/wabbajack/verify-downloads?stream=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /ndjson/);

  const text = await res.text();
  const events = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const progress = events.filter((e) => e.type === 'progress');
  const result = events.find((e) => e.type === 'result');
  assert.ok(progress.length >= 3, 'plusieurs événements de progression');
  assert.ok(result, 'résultat final');
  assert.equal(result.archives.length, info.archives.length);
  // Le dossier tests/ ne contient aucune archive de la modlist : plus aucun faux positif (nom court / préfixe)
  // (les fichiers du jeu sont résolus via le chemin du jeu enregistré, ils sont exclus du contrôle)
  const fp = result.archives.filter((a) => a.status === 'ready' && a.sourceKind !== 'game').length;
  assert.equal(fp, 0, `faux positifs : ${fp}`);
  const match = progress.filter((e) => e.phase === 'match');
  assert.equal(match.at(-1).done, match.at(-1).total, 'progression complète');
  for (let i = 1; i < match.length; i++) assert.ok(match[i].done >= match[i - 1].done, 'progression monotone');

  // Scénario synthétique : taille correcte → prêt ; même nom mais taille fausse → manquant (sizeMismatch) ;
  // fichier au nom court (préfixe) → jamais validé
  const tmp = fs.mkdtempSync(path.join(root, 'tests', '.scan-'));
  try {
    fs.writeFileSync(path.join(tmp, 'Good-1-0.7z'), Buffer.alloc(100));
    fs.writeFileSync(path.join(tmp, 'Partial-2-0.7z'), Buffer.alloc(40));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    const archives = [
      { Hash: 'h1', Name: 'Good-1-0.7z', Size: 100, State: {} },
      { Hash: 'h2', Name: 'Partial-2-0.7z', Size: 100, State: {} },
      { Hash: 'h3', Name: 'apple-3-0.7z', Size: 100, State: {} },
    ];
    const r2 = await fetch(`http://127.0.0.1:${port}/api/wabbajack/verify-downloads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadsPath: tmp, archives }),
    });
    const j = await r2.json();
    const by = Object.fromEntries(j.archives.map((a) => [a.Name, a]));
    assert.equal(by['Good-1-0.7z'].status, 'ready');
    assert.equal(by['Partial-2-0.7z'].status, 'missing');
    assert.equal(by['Partial-2-0.7z'].sizeMismatch, 'Partial-2-0.7z');
    assert.equal(by['apple-3-0.7z'].status, 'missing');
    assert.equal(j.sizeMismatches, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Mode non-flux conservé
  const legacy = await fetch(`http://127.0.0.1:${port}/api/wabbajack/verify-downloads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const legacyJson = await legacy.json();
  assert.equal(legacyJson.archives.length, info.archives.length);

  console.log(`${progress.length} événements de progression, ${result.readyCount} prêtes / ${info.archives.length}`);
  console.log('scan-stream OK');
} finally {
  stop();
}
