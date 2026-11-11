// Fichiers que macOS dépose tout seul, jamais des fichiers de mod.
//
// Sur un disque sans attributs étendus natifs (exFAT, FAT, partage réseau), macOS range les attributs de « nom »
// dans un fichier visible « ._nom » à côté. Dans Data, Wine le voit comme un vrai fichier : SKSE essayait de charger
// « ._EngineFixes.dll » comme plugin et le jeu plantait (constaté par SkyrimMT, ticket GitHub #16).
// En fin d'installation sur un tel disque, ces fichiers sont retirés du dossier installé (comme `dot_clean`) ;
// sur APFS ou HFS+, rien n'est touché : macOS n'en crée pas.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export function isMacMetadataName(name) {
  return name.startsWith('._') || name.toLowerCase() === '.ds_store';
}

/** Type du système de fichiers qui porte `p` (« apfs », « hfs », « exfat », « msdos »…), ou null si inconnu. */
export function fsTypeOf(p) {
  try {
    const out = execFileSync('/usr/sbin/diskutil', ['info', '-plist', p], { encoding: 'utf8', timeout: 15000 });
    const m = out.match(/<key>FilesystemType<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

export function hasNativeAttributes(p, fsType = fsTypeOf(p)) {
  return fsType === null || fsType === 'apfs' || fsType === 'hfs';
}

/** Retire les « ._nom » et .DS_Store sous `root`. Renvoie le nombre de fichiers retirés. */
export function removeMacMetadata(root) {
  let removed = 0;
  const visit = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) visit(p);
      else if (e.isFile() && isMacMetadataName(e.name)) {
        try { fs.unlinkSync(p); removed++; } catch { /* ignore */ }
      }
    }
  };
  visit(root);
  return removed;
}

/** Nettoyage de fin d'installation : seulement sur un disque sans attributs natifs. null si rien à faire. */
export function cleanMacMetadataIfNeeded(root, fsType = fsTypeOf(root)) {
  if (hasNativeAttributes(root, fsType)) return null;
  return removeMacMetadata(root);
}
