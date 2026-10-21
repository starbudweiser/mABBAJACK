// Outils système : dossiers (création résiliente, test d'écriture), binaires embarqués (7zz, unar,
// texconv), extraction d'un fichier unique d'une archive.

import fs, { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { extractFileFromBsa } from './bsa.js';
import { trackedSpawn as spawn } from './jobcontrol.js';
import { findTexconv } from './textures.js';

// ──────────────────────────────────────────────────────────
// Filesystem helpers
// ──────────────────────────────────────────────────────────
export function makeDirResilient(targetDir) {
  if (!targetDir?.trim()) throw new Error('Chemin vide ou invalide.');
  const normalized = path.resolve(targetDir.trim());

  if (normalized.startsWith('/Volumes/')) {
    const parts = normalized.split(path.sep).filter(Boolean);
    if (parts.length >= 2) {
      const volumeRoot = '/' + path.join(parts[0], parts[1]);
      if (!fs.existsSync(volumeRoot)) {
        throw new Error(`Volume "${volumeRoot}" non monté. Vérifiez qu'il est visible dans le Finder.`);
      }
    }
  }

  if (fs.existsSync(normalized)) {
    if (!fs.statSync(normalized).isDirectory()) throw new Error(`"${normalized}" n'est pas un dossier.`);
    return normalized;
  }

  // Tier 1: Node native
  try { fs.mkdirSync(normalized, { recursive: true }); if (fs.existsSync(normalized)) return normalized; } catch { /* */ }
  // Tier 2: /bin/mkdir -p (handles spaces as array argument — no shell interpolation)
  try { execFileSync('/bin/mkdir', ['-p', normalized], { stdio: 'ignore' }); if (fs.existsSync(normalized)) return normalized; } catch { /* */ }
  // Tier 3: osascript (runs as user, bypasses App Sandbox)
  try {
    execFileSync('/usr/bin/osascript', ['-e', `do shell script "/bin/mkdir -p " & quoted form of "${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`], { stdio: 'ignore' });
    if (fs.existsSync(normalized)) return normalized;
  } catch { /* */ }

  throw new Error(`Impossible de créer "${normalized}". Accordez l'Accès complet au disque dans Réglages Système > Confidentialité & Sécurité.`);
}

export function testWriteAccess(dir) {
  try {
    const f = path.join(dir, `.mw_test_${Date.now()}`);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    return null;
  } catch (err) {
    if (err.code === 'EROFS') return 'Disque en lecture seule (NTFS). Formatez en APFS ou ExFAT.';
    if (err.code === 'EACCES' || err.code === 'EPERM') return 'macOS refuse l\'accès en écriture. Accordez l\'Accès complet au disque dans Réglages Système.';
    return err.message;
  }
}

// ──────────────────────────────────────────────────────────
// 7z helpers
// ──────────────────────────────────────────────────────────
// Dossier de binaires embarqués (application autonome) : prioritaire sur Homebrew
export const BUNDLED_BIN_DIR = process.env.MABBAJACK_BIN_DIR || '';

export function find7z() {
  const bundled = BUNDLED_BIN_DIR ? [path.join(BUNDLED_BIN_DIR, '7zz')] : [];
  for (const c of [...bundled, '/opt/homebrew/bin/7zz', '/usr/local/bin/7zz', '/opt/homebrew/bin/7z', '/usr/local/bin/7z']) {
    try { execFileSync(c, ['i'], { stdio: 'ignore' }); return c; } catch { /* */ }
  }
  return null;
}

export function findTexconvBin() { return findTexconv(BUNDLED_BIN_DIR); }

export function findUnar() {
  const bundled = BUNDLED_BIN_DIR ? [path.join(BUNDLED_BIN_DIR, 'unar')] : [];
  for (const c of [...bundled, '/opt/homebrew/bin/unar', '/usr/local/bin/unar']) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch { /* */ }
  }
  return null;
}

// Clean up any orphaned mwab_batch_* temp dirs/files from previous runs
export function purgeMwabTmpDirs() {
  try {
    const tmpRoot = os.tmpdir();
    const entries = fs.readdirSync(tmpRoot);
    let purged = 0;
    for (const e of entries) {
      if (!e.startsWith('mwab_batch_')) continue;
      try {
        const fp = path.join(tmpRoot, e);
        fs.rmSync(fp, { recursive: true, force: true });
        purged++;
      } catch {}
    }
    if (purged > 0) console.log(`[mABBAJACK] /tmp purge: ${purged} entrée(s) supprimée(s)`);
  } catch {}
}


/**
 * Extract a single specific file from an archive using 7z.
 * Strategy:
 *   1. Try `7zz e -so <archive> <path>` (stdout pipe) — fast for 7z/zip
 *   2. If 0 bytes with code 0: retry with backslash path
 *   3. If still 0 bytes: fallback to `7zz e <archive> <path> -o<tempdir>` — needed for some RAR5
 * A 120s timeout per call prevents deadlocks on corrupt archives.
 */
export function extract7zSingleFile(sevenZipBin, archivePath, sourcePath, outputFile) {
  // BSA archives (vanilla game files) : 7z ne sait pas les lire → lecteur natif
  if (/\.bsa$/i.test(archivePath || '')) {
    return new Promise((resolve, reject) => {
      try {
        makeDirResilient(path.dirname(outputFile));
        resolve(extractFileFromBsa(archivePath, sourcePath, outputFile));
      } catch (err) { reject(err); }
    });
  }
  return new Promise((resolve, reject) => {
    const normalizedSource = sourcePath.replace(/\\/g, '/');
    const backslashSource  = sourcePath.replace(/\//g, '\\');
    makeDirResilient(path.dirname(outputFile));

    // Global timeout: 120 s per file
    const globalTimer = setTimeout(() => {
      reject(new Error(`Timeout 120s pour "${normalizedSource}" dans ${path.basename(archivePath)}`));
    }, 120000);

    const done = (result) => { clearTimeout(globalTimer); resolve(result); };
    const fail  = (err)   => { clearTimeout(globalTimer); reject(err); };

    // --- Attempt 1: stdout pipe with forward slashes ---
    function attempt1() {
      const out = createWriteStream(outputFile);
      const proc = spawn(sevenZipBin, ['e', '-so', archivePath, normalizedSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, stderr = '';
      proc.stdout.on('data', (d) => { bytes += d.length; });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.pipe(out);
      proc.on('error', (err) => { out.destroy(); fail(err); });
      proc.on('close', (code) => {
        out.end(() => {
          if (code === 0 && bytes > 0) { done(bytes); return; }
          if (code !== 0) {
            try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
            // Non-zero exit → genuine error, skip fallback
            fail(new Error(`7z exit ${code} pour "${normalizedSource}": ${stderr.slice(0, 200)}`));
            return;
          }
          // code === 0 but 0 bytes → file not found with this path, try backslash
          attempt2();
        });
      });
    }

    // --- Attempt 2: stdout pipe with backslashes (RAR often needs this) ---
    function attempt2() {
      const out = createWriteStream(outputFile);
      const proc = spawn(sevenZipBin, ['e', '-so', archivePath, backslashSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, stderr = '';
      proc.stdout.on('data', (d) => { bytes += d.length; });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.pipe(out);
      proc.on('error', (err) => { out.destroy(); fail(err); });
      proc.on('close', (code) => {
        out.end(() => {
          if (code === 0 && bytes > 0) { done(bytes); return; }
          if (code !== 0) {
            try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
            fail(new Error(`7z exit ${code} pour "${backslashSource}": ${stderr.slice(0, 200)}`));
            return;
          }
          // Still 0 bytes → fallback to temp-dir extraction (works for most RAR5)
          attempt3();
        });
      });
    }

    // --- Attempt 3: extract to temp dir, then move file ---
    function attempt3() {
      const tmpDir = path.join(os.tmpdir(), `mwab_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      // 7zz e extracts flat (no subdirs), 7zz x preserves structure — use x here
      const proc = spawn(sevenZipBin, ['x', '-y', `-o${tmpDir}`, archivePath, normalizedSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.resume(); // drain stdout
      proc.on('error', (err) => { fs.rmSync(tmpDir, { recursive: true, force: true }); fail(err); });
      proc.on('close', (code) => {
        if (code !== 0) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fail(new Error(`Fichier introuvable dans l'archive : "${normalizedSource}"`));
          return;
        }
        // Find the extracted file (may be nested)
        const basename = path.basename(normalizedSource);
        let found = null;
        const walk = (dir) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) { walk(fp); }
            else if (e.name === basename || fp.endsWith(normalizedSource.replace(/\//g, path.sep))) { found = fp; }
          }
        };
        try { walk(tmpDir); } catch {}
        if (found && fs.existsSync(found)) {
          try {
            fs.copyFileSync(found, outputFile);
            const size = fs.statSync(outputFile).size;
            fs.rmSync(tmpDir, { recursive: true, force: true });
            done(size);
          } catch (e) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            fail(e);
          }
        } else {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fail(new Error(`Fichier introuvable après extraction temp : "${normalizedSource}"`));
        }
      });
    }

    attempt1();
  });
}
