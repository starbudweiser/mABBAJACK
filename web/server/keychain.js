// Clé API Nexus dans le trousseau de session macOS (outil security), jamais dans un fichier ni dans les journaux.
// La clé passe par l'entrée standard de « security -i », pas par la ligne de commande (visible dans ps).
import { execFile, spawn } from 'child_process';

const SERVICE = process.env.MABBAJACK_KEYCHAIN_SERVICE || 'mABBAJACK Nexus API key';
const ACCOUNT = 'nexus';
const KEY_RE = /^[A-Za-z0-9+/=_-]{8,512}$/; // forme des clés Nexus ; exclut tout ce qui casserait la commande

export const isValidKeyFormat = (key) => typeof key === 'string' && KEY_RE.test(key);

/** Clé enregistrée, ou '' s'il n'y en a pas. */
export function readKey() {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

/** Enregistre (ou remplace) la clé. */
export function saveKey(key) {
  if (!isValidKeyFormat(key)) return Promise.reject(new Error('Format de clé invalide'));
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 && !stderr.trim() ? resolve() : reject(new Error(stderr.trim() || `security ${code}`))));
    p.stdin.end(`add-generic-password -U -s "${SERVICE}" -a ${ACCOUNT} -w ${key}\n`);
  });
}

/** Supprime la clé (sans erreur si elle n'existe pas). */
export function deleteKey() {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], () => resolve());
  });
}
