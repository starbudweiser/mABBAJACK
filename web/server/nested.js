// Archives imbriquées : une directive de niveau 3 (ArchiveHashPath = [hash, interne, fichier])
// vise un fichier rangé dans un BSA… ou dans un zip/7z/rar lui-même contenu dans l'archive.
import fs from 'fs';
import path from 'path';
import { trackedSpawn as spawn } from './jobcontrol.js';

/** Vrai si le fichier commence par la signature d'un BSA (Skyrim) ou d'un BA2 (Fallout 4). */
export function looksLikeBsa(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    const magic = buf.toString('latin1');
    return magic === 'BSA\0' || magic === 'BTDX';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Liste les fichiers d'un dossier : chemin relatif normalisé (/, minuscules) → chemin absolu. */
export function indexExtracted(dir) {
  const files = new Map();
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp, rel);
      else files.set(rel.replace(/\\/g, '/').toLowerCase(), fp);
    }
  };
  walk(dir, '');
  return files;
}

/** Extrait entièrement une archive imbriquée dans outDir et renvoie son index. */
export function extractNestedArchive(sevenZipBin, archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn(sevenZipBin, ['x', '-y', `-o${outDir}`, archivePath, '-aoa'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.resume();
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`Timeout pour ${path.basename(archivePath)}`)); }, 600000);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1) resolve(indexExtracted(outDir));
      else reject(new Error(`7z exit ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}
