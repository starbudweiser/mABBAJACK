// Lecteur de .wabbajack « paresseux » : aucune lecture complète du fichier en mémoire.
//
// JSZip + fs.readFileSync échouent au-delà de 2 Go (ERR_FS_FILE_TOO_LARGE) et saturent la mémoire.
// Ici : la liste des entrées vient de `unzip -Z1`, chaque entrée est extraite à la demande via
// `unzip -p`. L'objet exposé imite la partie de l'API JSZip utilisée par le serveur :
//   zip.files[nom], zip.file(nom) → { name, dir, async(type) } | null

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const run = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 1024;

/** Échappe les jokers d'unzip (* ? [ ] \) pour que le nom soit pris littéralement. */
function escapeUnzipPattern(name) {
  return String(name).replace(/[\\*?[\]]/g, '\\$&');
}

/** Extrait une entrée du zip (Buffer) ou null si absente / illisible. */
export async function extractEntry(file, name) {
  try {
    const { stdout } = await run('unzip', ['-p', file, escapeUnzipPattern(name)], { encoding: 'buffer', maxBuffer: MAX_BUFFER });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Ouvre un .wabbajack sans le charger.
 * @param {string} file chemin d'un fichier zip existant
 * @returns {Promise<{ files: Record<string, {name:string, dir:boolean}>, names: string[], file: (n:string)=>object|null }>}
 */
export async function openLazyZip(file) {
  if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error('Fichier .wabbajack introuvable');
  let stdout;
  try {
    ({ stdout } = await run('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  } catch (e) {
    throw new Error(`Archive .wabbajack illisible : ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
  }
  const names = stdout.split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean);
  const files = Object.create(null);
  const makeEntry = (name) => ({
    name,
    dir: name.endsWith('/'),
    async: async (type = 'nodebuffer') => {
      const buf = await extractEntry(file, name);
      if (!buf) throw new Error(`Entrée illisible : ${name}`);
      if (type === 'string') return buf.toString('utf8');
      if (type === 'uint8array') return new Uint8Array(buf);
      return buf;
    },
  });
  for (const n of names) files[n] = makeEntry(n);
  return {
    files,
    names,
    file: (n) => (n in files && !files[n].dir ? files[n] : null),
  };
}
