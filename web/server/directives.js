// Moteur d'installation : préparation d'une mise à jour et exécution des directives Wabbajack.

import fs from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { jobControl, trackedSpawn as spawn } from './jobcontrol.js';
import { broadcastLog, broadcastProgress, debugLog } from './events.js';
import { openBsa } from './bsa.js';
import { looksLikeBsa, extractNestedArchive } from './nested.js';
import { createBsa, installBsaOverflow } from './bsawriter.js';
import { patchFile } from './octodiff.js';
import { TextureQueue } from './textures.js';
import { remapMagicStrings } from './remap.js';
import { dedupeByPriority, loadRawModlist } from './modprofile.js';
import { resolveDirectivePath, detectGameRootFolders, setGameRootFolders, BSA_STAGING_DIR } from './paths.js';
import { readSnapshot, findPreviousWabbajack, manifestEntries, manifestArchives, manifestFingerprint, baselineFromSnapshot, baselineFromManifest, planUpdate } from './update.js';
import { isGameFileArchive, isIgnorableGameFile } from './gamefiles.js';
import { makeDirResilient, purgeMwabTmpDirs } from './tools.js';
import { buildMergedPatch } from './mergedpatch.js';

// ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
//  DIRECTIVE PROCESSOR — THE CORE ENGINE
//  Implements the Wabbajack directive specification:
//  - FromArchive: extract a SPECIFIC file from a SPECIFIC archive
//  - InlineFile: read file embedded in the .wabbajack zip
//  - PatchedFromArchive: extract base file + apply OctoDiff patch
//  This is how FOMOD pre-selected choices are honoured.
// ══════════════════════════════════════════════════════════
// ──────────────────────────────────────────────────────────

// Résolution des destinations (directive.To → chemin installé) : voir paths.js

/**
 * Mise à jour d'une installation existante : base de comparaison (instantané, sinon ancien
 * .wabbajack, sinon disque) puis plan (fichiers inchangés, retirés, archives nécessaires).
 */
export async function prepareUpdate({ raw, wabbajackPath, selection, destRoot, previousFile, signal }) {
  const posixTo = (t) => String(t || '').replace(/\\/g, '/');
  let dirs = (raw.Directives || raw.directives || []).map((d) => ({
    $type: d.$type || '', To: posixTo(d.To || d.to), Hash: d.Hash || '', Size: d.Size || 0,
    TempID: d.TempID || '', ArchiveHash: (d.ArchiveHashPath || [])[0] || '',
  }));
  if (selection) dirs = dirs.filter((d) => selection.keep(d.To));
  setGameRootFolders(detectGameRootFolders(dirs));
  const resolve = (d) => resolveDirectivePath(d.To, destRoot);
  if (selection && selection.priority.size > 0) dirs = dedupeByPriority(dirs, resolve, selection.priority).directives;

  let baseline = null;
  const snap = readSnapshot(destRoot);
  if (snap) {
    baseline = baselineFromSnapshot(snap);
    broadcastLog('info', `🔄 Base de comparaison : état enregistré de l'installation (v${snap.version || '?'}, ${snap.files.length} fichier(s)).`);
  } else {
    const name = raw.Name || raw.name || '';
    let prev = null;
    if (previousFile && fs.existsSync(previousFile)) {
      const r = await loadRawModlist(previousFile);
      prev = { file: previousFile, entries: manifestEntries(r) };
    } else if (wabbajackPath) {
      const fp = await manifestFingerprint(manifestEntries(raw), manifestArchives(raw));
      prev = await findPreviousWabbajack(wabbajackPath, name, fp);
    }
    if (prev) {
      baseline = baselineFromManifest(prev.entries);
      broadcastLog('info', `🔄 Base de comparaison : version précédente ${path.basename(prev.file)}.`);
    } else {
      broadcastLog('info', `🔄 Aucune version précédente connue : comparaison avec les fichiers présents (taille, puis hash Wabbajack). Cette première comparaison peut être longue.`);
    }
  }
  let lastPct = -1;
  const plan = await planUpdate({
    directives: dirs, resolve, baseline, signal,
    onProgress: (phase, done, total) => {
      const pct = Math.floor((done / Math.max(1, total)) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      broadcastProgress({ currentTask: phase === 'hash' ? `Comparaison des fichiers installés (hash) : ${pct} %` : `Comparaison des fichiers installés : ${done}/${total}` });
    },
  });
  broadcastLog('info', `🔄 Comparaison : ${plan.added} fichier(s) absent(s) à installer, ${plan.changed} modifié(s), ${plan.unchanged} inchangé(s), ${plan.removed.length} à supprimer.`);
  if (plan.hashed) broadcastLog('info', `  → ${plan.hashed} fichier(s) vérifié(s) par hash.`);
  return plan;
}

/**
 * Process all directives from the parsed modlist.
 * Handles FromArchive, InlineFile, PatchedFromArchive.
 * Returns { processed, skipped, errors }
 */
export async function processDirectives({ directives, archiveStatuses, destRoot, wabbajackZip, sevenZipBin, unarBin, signal, onProgress, gamePath = '', downloadsPath = '', texconvBin = null }) {
  // Clean up any leftover temp dirs from previous crashed/killed runs
  purgeMwabTmpDirs();
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let processedBytes = 0;
  let gameDirectCopies = 0;   // fichiers originaux du jeu copiés tels quels
  let modDirectCopies = 0;    // archives « fichier unique » (ex. .esp téléchargé directement)
  const patchStats = { patched: 0, already: 0, fallback: 0, noPatch: 0 };
  let transformedTextures = 0;   // TransformedTexture copiée sans conversion (texconv absent)
  // TransformedTexture : textures collectées pendant l'extraction, converties en lot ensuite
  const textureQueue = texconvBin ? new TextureQueue({ bin: texconvBin, stageRoot: path.join(destRoot, '.mabbajack_textures') }) : null;
  textureQueue?.cleanup();
  let remappedFiles = 0;         // RemappedInlineFile : chemins remplacés
  let remapUnresolved = 0;
  const patchFallbackNames = [];

  // Build archive lookup: by Hash AND by Name (case-insensitive)
  // Both are needed because scan might match by name while directive references by hash
  const archiveByHash = new Map();
  const archiveByNameLower = new Map();
  // allArchivesByHash includes unavailable archives (for name lookup in warnings)
  const allArchivesByHash = new Map();
  for (const arc of archiveStatuses) {
    if (arc.Hash) allArchivesByHash.set(arc.Hash, arc);
    if (arc.status === 'ready' && arc.localPath && fs.existsSync(arc.localPath)) {
      if (arc.Hash) archiveByHash.set(arc.Hash, arc);
      if (arc.Name) archiveByNameLower.set(arc.Name.toLowerCase(), arc);
    }
  }

  /** Resolve archive by hash first, then by Name fallback */
  function findArchive(hash, archName) {
    let arc = hash ? archiveByHash.get(hash) : null;
    if (!arc && archName) arc = archiveByNameLower.get(archName.toLowerCase());
    return arc || null;
  }

  /** Get a human-readable name for an unavailable archive hash */
  function unknownArchiveName(hash) {
    const arc = hash ? allArchivesByHash.get(hash) : null;
    return arc?.Name || (hash ? hash.slice(0, 16) + '…' : '(hash inconnu)');
  }

  const isPatchedDirective = (d) => /patched/i.test(d?.$type || '');

  /** Lit le delta OctoDiff d'une directive PatchedFromArchive dans le .wabbajack. */
  async function loadPatch(d) {
    if (!wabbajackZip || !d.PatchID) return null;
    const entry = wabbajackZip.file(d.PatchID) || wabbajackZip.file(`patches/${d.PatchID}`);
    return entry ? entry.async('nodebuffer') : null;
  }

  /**
   * Écrit le fichier final d'une directive.
   * src = { file } (copie, clone APFS si possible) ou { buffer }.
   * PatchedFromArchive : application du delta OctoDiff sur la base.
   */
  async function deliver(d, outputPath, src) {
    makeDirResilient(path.dirname(outputPath));
    // TransformedTexture : mise de côté pour texconv (sauf si la source a déjà l'état demandé).
    // Sans texconv, la texture source est copiée telle quelle (valide, mais d'une autre taille).
    if (/transformedtexture/i.test(d?.$type || '')) {
      if (textureQueue) { if (textureQueue.add(d, outputPath, src)) return; }
      else transformedTextures++;
    }
    if (isPatchedDirective(d)) {
      const base = src.buffer || fs.readFileSync(src.file);
      const delta = await loadPatch(d);
      let data = base;
      if (!delta) patchStats.noPatch++;
      else {
        const r = patchFile(base, delta);
        data = r.data;
        patchStats[r.status]++;
        if (r.status === 'fallback') patchFallbackNames.push(path.basename(d.To || ''));
      }
      fs.writeFileSync(outputPath, data);
      return;
    }
    if (src.buffer) fs.writeFileSync(outputPath, src.buffer);
    else fs.copyFileSync(src.file, outputPath, fs.constants.COPYFILE_FICLONE);
  }

  // Categorize directives — « patched » AVANT « fromarchive » :
  // "PatchedFromArchive" contient "FromArchive" et était traité comme une simple extraction.
  const fromArchiveDirectives = [];
  const inlineDirectives = [];
  const patchedDirectives = [];
  const otherDirectives = [];

  for (const d of directives) {
    const type = (d.$type || '').toLowerCase();
    if (type.includes('patched')) patchedDirectives.push(d);
    else if (type.includes('fromarchive') || type.includes('transformedtexture')) fromArchiveDirectives.push(d);
    else if (type.includes('inline')) inlineDirectives.push(d);
    else otherDirectives.push(d);
  }

  const total = directives.length;
  broadcastLog('info', `📋 Directives à traiter : ${fromArchiveDirectives.length} FromArchive, ${inlineDirectives.length} InlineFile, ${patchedDirectives.length} PatchedFromArchive, ${otherDirectives.length} autres`);

  // ── 0. FICHIERS ORIGINAUX DU JEU — identifiés avant toute extraction ─────
  const gameArchives = archiveStatuses.filter(isGameFileArchive);
  if (gameArchives.length > 0) {
    const gameReady = gameArchives.filter((a) => a.status === 'ready' && a.localPath).length;
    broadcastLog('info', `🎮 Fichiers originaux du jeu : ${gameReady}/${gameArchives.length} identifiés — copie directe, aucune décompression.`);
  }

  // Staging CreateBSA résiduel d'une installation interrompue
  try { fs.rmSync(path.join(destRoot, BSA_STAGING_DIR), { recursive: true, force: true }); } catch { /* */ }

  // ── 1. INLINE FILES ─────────────────────────────────────────────────
  // These are small files embedded directly in the .wabbajack zip
  broadcastLog('info', `📎 Traitement des fichiers inline (${inlineDirectives.length})...`);
  for (const d of inlineDirectives) {
    await jobControl.waitIfPaused(signal);
    const outputPath = resolveDirectivePath(d.To, destRoot);
    if (!outputPath) { skipped++; continue; }

    try {
      if (wabbajackZip) {
        // Wabbajack InlineFile: SourceDataID is a UUID used as the filename at the ROOT of the zip
        // (not under 'inlined/'). Hash is a fallback for older formats.
        const sourceId = d.SourceDataID || '';
        const hashId   = d.Hash || '';
        const toPosix  = (d.To || '').replace(/\\/g, '/');

        const entry =
          (sourceId && wabbajackZip.file(sourceId)) ||          // Modern: UUID at root
          (sourceId && wabbajackZip.file(`inlined/${sourceId}`)) || // Older: under inlined/
          (sourceId && wabbajackZip.file(`inlined/${sourceId}.zip`)) ||
          (hashId   && wabbajackZip.file(hashId)) ||            // Hash at root
          (hashId   && wabbajackZip.file(`inlined/${hashId}`)) ||
          (hashId   && wabbajackZip.file(`inlined/${hashId}.zip`)) ||
          (toPosix  && wabbajackZip.file(toPosix)) ||
          null;

        if (entry) {
          let content = await entry.async('nodebuffer');
          // Some inline entries are themselves zip-compressed; unwrap if needed
          if (entry.name.endsWith('.zip')) {
            try {
              const inner = await JSZip.loadAsync(content);
              const innerFiles = Object.values(inner.files).filter((f) => !f.dir);
              if (innerFiles.length === 1) content = await innerFiles[0].async('nodebuffer');
            } catch { /* not a zip, use as-is */ }
          }
          // RemappedInlineFile : remplace les magic strings par les chemins réels de cette machine
          if (/remapped/i.test(d.$type || '')) {
            const r = remapMagicStrings(content, { mo2: destRoot, game: gamePath, download: downloadsPath });
            content = r.data;
            if (r.replaced > 0) remappedFiles++;
            remapUnresolved += r.unresolved;
          }
          makeDirResilient(path.dirname(outputPath));
          fs.writeFileSync(outputPath, content);
          processed++;
        } else {
          // Entry not found in zip — create placeholder to preserve directory structure
          makeDirResilient(path.dirname(outputPath));
          if (!fs.existsSync(outputPath)) {
            fs.writeFileSync(outputPath, '', 'utf-8');
          }
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
    }

    if ((processed + skipped + errors) % 50 === 0 && onProgress) {
      onProgress(processed + skipped + errors, total);
    }
  }
  broadcastLog('info', `  → ${processed} inline écrits, ${skipped} ignorés`);

  // ── 2. FROM ARCHIVE + PATCHED FROM ARCHIVE ──────────────────────────────
  // Group by archive hash for efficiency — one 7z open per archive.
  // Les directives patchées suivent le même chemin (base extraite puis delta OctoDiff).
  broadcastLog('info', `📦 Extraction sélective des fichiers FromArchive (${fromArchiveDirectives.length + patchedDirectives.length})...`);

  // Group directives by archive hash
  const byArchive = new Map();
  for (const d of [...fromArchiveDirectives, ...patchedDirectives]) {
    // ArchiveHashPath[0] is the archive hash (already normalized in ArchiveHash field)
    const hash = d.ArchiveHash || (d.ArchiveHashPath && d.ArchiveHashPath[0]) || '';
    if (!byArchive.has(hash)) byArchive.set(hash, []);
    byArchive.get(hash).push(d);
  }

  let archiveIdx = 0;
  for (const [archiveHash, allArchDirectives] of byArchive) {
    await jobControl.waitIfPaused(signal);
    archiveIdx++;

    // Seules les archives réellement présentes sur disque sont exploitables
    const archive = findArchive(archiveHash, allArchDirectives[0]?.ArchiveName);

    if (!archive) {
      if (isIgnorableGameFile(allArchivesByHash.get(archiveHash))) { skipped += allArchDirectives.length; if (onProgress) onProgress(processed + skipped + errors, total); continue; }
      broadcastLog('warn', `  ⚠ Archive non disponible : "${unknownArchiveName(archiveHash)}" — ${allArchDirectives.length} fichier(s) ignoré(s)`);
      skipped += allArchDirectives.length;
      if (onProgress) onProgress(processed + skipped + errors, total);
      continue;
    }
    const isGameSource = isGameFileArchive(archive);

    // ── Source = fichier entier (ArchiveHashPath de longueur 1) ──────────────
    // Cas des fichiers originaux du jeu (Skyrim.esm, Update.esm, cc*.esl/esm…) :
    // le fichier est copié tel quel (ou patché), JAMAIS décompressé.
    const archDirectives = [];
    for (const d of allArchDirectives) {
      await jobControl.waitIfPaused(signal);
      if (d.SourcePath) { archDirectives.push(d); continue; }
      processedBytes += d.Size || 0;
      const outputPath = resolveDirectivePath(d.To, destRoot);
      if (!outputPath) { skipped++; continue; }
      try {
        await deliver(d, outputPath, { file: archive.localPath });
        processed++;
        if (isGameSource) gameDirectCopies++; else modDirectCopies++;
      } catch (copyErr) {
        errors++;
        broadcastLog('warn', `  ⚠ Copie impossible : ${path.basename(archive.localPath)} → ${path.basename(outputPath)} — ${String(copyErr.message).slice(0, 160)}`);
      }
    }
    if (archDirectives.length === 0) {
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    // Garde-fou : un fichier original du jeu qui n'est pas un BSA n'est pas une archive
    if (isGameSource && !/\.bsa$/i.test(archive.localPath || '')) {
      broadcastLog('warn', `  ⚠ ${path.basename(archive.localPath)} est un fichier du jeu, pas une archive — ${archDirectives.length} chemin(s) interne(s) ignoré(s)`);
      skipped += archDirectives.length;
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    broadcastProgress({
      currentTask: `📦 [${archiveIdx}/${byArchive.size}] ${archive.Name} — ${archDirectives.length} fichier(s)`,
      stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
    });

    // ── Archive = BSA (fichiers originaux du jeu, GameFileSource) ───────────
    // Extraction uniquement parce que le manifeste demande un chemin interne précis.
    // 7z ne lit pas le format BSA de Bethesda → lecteur natif (server/bsa.js)
    if (/\.bsa$/i.test(archive.localPath || '')) {
      let bsa = null;
      let handled = 0, bsaOk = 0;
      try {
        bsa = openBsa(archive.localPath);
        for (const d of archDirectives) {
          await jobControl.waitIfPaused(signal);
          handled++;
          processedBytes += d.Size || 0;
          const outputPath = resolveDirectivePath(d.To, destRoot);
          if (!outputPath) { skipped++; continue; }
          try {
            const buf = bsa.readFile(d.SourcePath || d.From || '');
            if (!buf) { debugLog(`Absent du BSA : ${archive.Name} :: ${d.SourcePath} (→ ${d.To})`); errors++; continue; }
            await deliver(d, outputPath, { buffer: buf });
            bsaOk++; processed++;
          } catch (e) { debugLog(`Erreur BSA : ${archive.Name} :: ${d.SourcePath}`, e?.message); errors++; }
        }
      } catch (bsaErr) {
        if (signal?.aborted) throw bsaErr;
        broadcastLog('warn', `  ⚠ BSA illisible : ${archive.Name} — ${String(bsaErr.message).slice(0, 160)}`);
        skipped += archDirectives.length - handled;
      } finally {
        bsa?.close();
      }
      if (bsaOk > 0) broadcastLog('success', `  ✓ ${archive.Name} : ${bsaOk}/${archDirectives.length} fichier(s) extrait(s)`);
      else broadcastLog('warn', `  ✗ ${archive.Name} : 0/${archDirectives.length} extrait(s) — vérifiez l'archive`);
      if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);
      continue;
    }

    if (!sevenZipBin) {
      for (const d of archDirectives) {
        const out = resolveDirectivePath(d.To, destRoot);
        if (out) { makeDirResilient(path.dirname(out)); if (!fs.existsSync(out)) fs.writeFileSync(out, '', 'utf-8'); }
        skipped++;
      }
      if (onProgress) onProgress(processed + skipped + errors, total);
      continue;
    }

    // ── BATCH EXTRACTION — one call per archive ───────────────────────────────
    const tmpDir = path.join(os.tmpdir(), `mwab_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    let archiveProcessed = 0;
    let archiveErrors = 0;
    let usedUnar = false; // set to true when unar is used instead of 7z (RAR5)
    const nestedBsa = new Map(); // bsaPath → open BSA reader (depth-3 directives)
    const nestedArchives = new Map(); // innerPath → Map(chemin normalisé → fichier extrait)

    let heartbeatActive = true;
    let heartbeat = setInterval(() => {
      if (!heartbeatActive) return;
      const archiveSizeMo = archive.Size ? `${(archive.Size / 1024 / 1024).toFixed(0)} Mo` : '';
      broadcastProgress({
        currentTask: `⚙️ [${archiveIdx}/${byArchive.size}] Décompression : ${archive.Name} ${archiveSizeMo ? `(${archiveSizeMo})` : ''}`,
        stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
        processedItems: processed + skipped + errors,
        processedBytes,
      });
    }, 3000);

    try {
      // Chaque chemin est demandé sous ses deux formes : certains zip faits sous Windows
      // nomment leurs entrées « Data\\SKSE\\x.dll » (antislash dans le nom), que 7zz
      // garde tel quel et ne fait pas correspondre à « Data/SKSE/x.dll ».
      const neededPaths = [...new Set(
        archDirectives.flatMap(d => {
          const fwd = (d.SourcePath || d.From || '').replace(/\\/g, '/').trim();
          return fwd ? [fwd, fwd.replace(/\//g, '\\')] : [];
        })
      )];

      const listFilePath = `${tmpDir}.list`;
      fs.writeFileSync(listFilePath, neededPaths.join('\n'), 'utf8');


      // Helper: run unar for full RAR extraction then resolve/reject
      const runUnar = (outputDir) => new Promise((res2, rej2) => {
        const proc = spawn(unarBin, [
          '-D',        // preserve structure but skip archive root folder
          '-o', outputDir,
          '-f',        // force overwrite
          archive.localPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr2 = '';
        proc.stdout.resume();
        proc.stderr.on('data', (d) => { stderr2 += d.toString(); });
        const t = setTimeout(() => { proc.kill('SIGKILL'); rej2(new Error(`Timeout unar pour ${archive.Name}`)); }, 600000);
        proc.on('error', (err) => { clearTimeout(t); rej2(err); });
        proc.on('close', (c) => {
          clearTimeout(t);
          if (c === 0) res2();
          else rej2(new Error(`unar exit ${c}: ${stderr2.slice(0, 200)}`));
        });
      });

      await new Promise((resolve, reject) => {
        const isRar = archive.localPath && archive.localPath.toLowerCase().endsWith('.rar');

        // ── RAR : utiliser unar directement (7z ne supporte pas RAR5) ────────
        if (isRar && unarBin) {
          usedUnar = true;
          broadcastLog('info', `  ↩ Archive RAR → unar : ${archive.Name}`);
          runUnar(tmpDir).then(resolve).catch(reject);
          return;
        }

        // ── 7z : extraction sélective (listfile) ─────────────────────────────
        const proc = spawn(sevenZipBin, [
          'x', '-y',
          `-o${tmpDir}`,
          archive.localPath,
          '-aoa',
          '-ssc-',          // case-insensitive matching
          `@${listFilePath}`,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stdout.resume();
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`Timeout 10min pour ${archive.Name}`)); }, 600000);

        proc.on('error', (err) => { clearTimeout(timer); reject(err); });
        proc.on('close', (code) => {
          clearTimeout(timer);
          // code 0 = OK, code 1 = warnings (still OK)
          if (code === 0 || code === 1) { resolve(); return; }

          // Exit 2 = Unsupported Method (RAR5 avec compression propriétaire)
          // Fallback unar — unar ne supporte pas le listfile, on extrait tout puis on filtre
          if (code === 2 && unarBin && stderr.includes('Unsupported Method')) {
            broadcastLog('info', `  ↩ Fallback unar pour ${archive.Name} (RAR5)...`);
            usedUnar = true;
            runUnar(tmpDir).then(resolve).catch(reject);
            return;
          }

          // Extraction sélective échouée (paths non trouvés, archive corrompue…)
          // Tenter une extraction complète — 7z pour .7z/.zip, unar pour .rar
          if (code !== 0 && code !== 1) {
            broadcastLog('info', `  ↩ Extraction sélective failed (${code}), tentative extraction complète…`);
            if (isRar && unarBin) {
              usedUnar = true;
              runUnar(tmpDir).then(resolve).catch(reject);
            } else {
              const proc3 = spawn(sevenZipBin, [
                'x', '-y', `-o${tmpDir}`, archive.localPath, '-aoa',
              ], { stdio: ['ignore', 'pipe', 'pipe'] });
              let stderr3 = '';
              proc3.stdout.resume();
              proc3.stderr.on('data', (d) => { stderr3 += d.toString(); });
              const timer3 = setTimeout(() => { proc3.kill('SIGKILL'); reject(new Error(`Timeout (fallback) pour ${archive.Name}`)); }, 600000);
              proc3.on('error', (err) => { clearTimeout(timer3); reject(err); });
              proc3.on('close', (c3) => {
                clearTimeout(timer3);
                if (c3 === 0 || c3 === 1) resolve();
                else reject(new Error(`7z exit ${c3}: ${stderr3.slice(0, 300)}`));
              });
            }
            return;
          }

          reject(new Error(`7z exit ${code}: ${stderr.slice(0, 300)}`));
        });
      });
      // Cleanup listfile
      try { fs.unlinkSync(listFilePath); } catch {}

      heartbeatActive = false;
      clearInterval(heartbeat);

      // Build lookup map: relative path (normalized) → absolute extracted path
      const extractedFiles = new Map();
      const walkTmp = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) {
            walkTmp(fp, rel);
          } else {
            // Store both slash styles for robust lookup
            const normalized = rel.replace(/\\/g, '/').toLowerCase();
            extractedFiles.set(normalized, fp);
            // Also store just the basename for flat extractions
            extractedFiles.set(e.name.toLowerCase(), fp);
          }
        }
      };
      try { walkTmp(tmpDir, ''); } catch {}

      // Copy each needed file to its final destination
      for (const d of archDirectives) {
        try { await jobControl.waitIfPaused(signal); } catch (e) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw e; }

        const outputPath = resolveDirectivePath(d.To, destRoot);
        if (!outputPath) { skipped++; processedBytes += d.Size || 0; continue; }

        const srcRaw = d.SourcePath || d.From || '';
        const srcFwd = srcRaw.replace(/\\/g, '/').toLowerCase();

        // ── DEPTH-3: file is inside a BSA which is inside the archive ─────
        if (d.BsaInternalPath) {
          // The BSA was extracted into tmpDir via SourcePath
          const bsaPath = extractedFiles.get(srcFwd) || extractedFiles.get(path.basename(srcRaw).toLowerCase());
          if (bsaPath && fs.existsSync(bsaPath) && !looksLikeBsa(bsaPath)) {
            // ── Niveau 3 dans une archive imbriquée (zip/7z/rar dans le zip) ──
            try {
              let files = nestedArchives.get(bsaPath);
              if (!files) {
                files = await extractNestedArchive(sevenZipBin, bsaPath, `${tmpDir}_nested${nestedArchives.size}`);
                nestedArchives.set(bsaPath, files);
              }
              const innerFwd = d.BsaInternalPath.replace(/\\/g, '/').toLowerCase();
              const innerFile = files.get(innerFwd);
              if (innerFile) {
                await deliver(d, outputPath, { file: innerFile });
                archiveProcessed++; processed++; processedBytes += d.Size || 0;
              } else {
                debugLog(`Introuvable dans l'archive imbriquée : ${archive.Name} :: ${srcRaw} :: ${d.BsaInternalPath}`);
                archiveErrors++; errors++; processedBytes += d.Size || 0;
              }
            } catch (nestErr) {
              broadcastLog('warn', `  ⚠ Archive imbriquée ${path.basename(srcRaw)} : ${String(nestErr.message).slice(0, 120)}`);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else if (bsaPath && fs.existsSync(bsaPath)) {
            try {
              let nb = nestedBsa.get(bsaPath);
              if (!nb) { nb = openBsa(bsaPath); nestedBsa.set(bsaPath, nb); }
              const bsaInternal = d.BsaInternalPath.replace(/\\/g, '/');
              const buf = nb.readFile(bsaInternal);
              if (buf) {
                await deliver(d, outputPath, { buffer: buf });
                archiveProcessed++; processed++; processedBytes += d.Size || 0;
              } else {
                broadcastLog('warn', `  ⚠ BSA: fichier introuvable après extraction: ${bsaInternal}`);
                archiveErrors++; errors++; processedBytes += d.Size || 0;
              }
            } catch (bsaErr) {
              broadcastLog('warn', `  ⚠ BSA extract: ${bsaErr.message.slice(0, 120)}`);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else {
            broadcastLog('warn', `  ⚠ BSA introuvable dans tmpDir: ${srcRaw}`);
            archiveErrors++; errors++; processedBytes += d.Size || 0;
          }
        } else {
          // ── DEPTH-2: file is directly in the archive ────────────────────
          // Only use exact path match — NO basename fallback (prevents wrong large files being copied)
          const foundPath = extractedFiles.get(srcFwd);

          if (foundPath && fs.existsSync(foundPath)) {
            try {
              await deliver(d, outputPath, { file: foundPath });
              archiveProcessed++; processed++; processedBytes += d.Size || 0;
            } catch (copyErr) {
              debugLog(`Copie impossible : ${archive.Name} :: ${srcRaw} → ${d.To}`, copyErr?.message);
              archiveErrors++; errors++; processedBytes += d.Size || 0;
            }
          } else {
            debugLog(`Introuvable après extraction : ${archive.Name} :: ${srcRaw} (→ ${d.To})`);
            archiveErrors++; errors++; processedBytes += d.Size || 0;
          }
        }

        if ((processed + skipped + errors) % 200 === 0 && onProgress) {
          onProgress(processed + skipped + errors, total, processedBytes);
          broadcastProgress({
            currentTask: `📁 [${archiveIdx}/${byArchive.size}] ${archive.Name} — ${archiveProcessed}/${archDirectives.length} fichiers`,
            stagePercent: Math.round((archiveIdx / byArchive.size) * 100),
          });
        }
      }

    } catch (batchErr) {
      heartbeatActive = false;
      clearInterval(heartbeat);
      broadcastLog('warn', `  ⚠ Erreur batch ${archive.Name} : ${batchErr.message.slice(0, 200)}`);
      debugLog(`Erreur batch complète : ${archive.Name} (${archive.localPath})`, batchErr?.stack || batchErr?.message);
      skipped += archDirectives.length - archiveProcessed;
    } finally {
      for (const nb of nestedBsa.values()) nb.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      for (let i = 0; i < nestedArchives.size; i++) {
        try { fs.rmSync(`${tmpDir}_nested${i}`, { recursive: true, force: true }); } catch {}
      }
    }

    if (archiveProcessed > 0) {
      broadcastLog('success', `  ✓ ${archive.Name} : ${archiveProcessed}/${archDirectives.length} fichier(s) extrait(s)`);
    } else if (archiveErrors > 0) {
      broadcastLog('warn', `  ✗ ${archive.Name} : 0/${archDirectives.length} extrait(s) — vérifiez l'archive`);
    }

    if (onProgress) onProgress(processed + skipped + errors, total, processedBytes);

    // Periodic /tmp purge every 10 archives to prevent disk saturation
    if (archiveIdx % 10 === 0) purgeMwabTmpDirs();
  }

  // ── 2 bis. TRANSFORMED TEXTURES : conversion texconv en lot ───────────
  if (textureQueue?.alreadyOk) {
    broadcastLog('info', `🖼 ${textureQueue.alreadyOk} texture(s) TransformedTexture déjà au bon format — copiées telles quelles.`);
  }
  if (textureQueue && textureQueue.size > 0) {
    const n = textureQueue.size;
    broadcastLog('info', `🖼 Conversion de ${n} texture(s) (TransformedTexture, ${textureQueue.groups.size} format(s) cible(s)) avec texconv…`);
    let lastLog = 0;
    const t0 = Date.now();
    const r = await textureQueue.run({
      signal,
      onProgress: (done, tot) => {
        broadcastProgress({ currentTask: `🖼 Conversion des textures : ${done}/${tot}`, stagePercent: Math.round((done / tot) * 100) });
        const pct = Math.floor((done / tot) * 10) * 10;
        if (pct > lastLog && done < tot) { lastLog = pct; broadcastLog('info', `  🖼 Textures : ${done}/${tot} (${pct} %)`); }
      },
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    const names = (list) => list.slice(0, 5).map((f) => path.basename(f.to.replace(/\\/g, '/'))).join(', ') + (list.length > 5 ? '…' : '');
    broadcastLog('success', `  ✓ ${r.converted}/${n} texture(s) convertie(s) en ${secs} s.`);
    if (r.failed.length > 0) {
      broadcastLog('warn', `  ⚠ ${r.failed.length} texture(s) non convertie(s) — source copiée telle quelle : ${names(r.failed)}`);
      for (const f of r.failed) debugLog(`texconv échec : ${f.to} — ${f.reason}`);
    }
    if (r.sizeMismatch.length > 0) {
      broadcastLog('warn', `  ⚠ ${r.sizeMismatch.length} texture(s) convertie(s) d'une taille différente du manifeste : ${names(r.sizeMismatch)}`);
      for (const f of r.sizeMismatch) debugLog(`texconv taille : ${f.to} — ${f.actual} o au lieu de ${f.expected} o`);
    }
  }

  // ── 3. BILAN : fichiers originaux du jeu & patchs OctoDiff ─────────────
  if (gameDirectCopies > 0) {
    broadcastLog('success', `🎮 ${gameDirectCopies} fichier(s) original(aux) du jeu copié(s) directement (sans décompression).`);
  }
  if (modDirectCopies > 0) {
    broadcastLog('info', `📄 ${modDirectCopies} fichier(s) copié(s) tel(s) quel(s) depuis DOWNLOADS (téléchargement direct, sans archive).`);
  }
  if (transformedTextures > 0) {
    broadcastLog('warn', `🖼 ${transformedTextures} texture(s) transformée(s) : texconv introuvable, texture source copiée telle quelle (non redimensionnée / recompressée).`);
  }
  if (remappedFiles > 0) {
    broadcastLog('info', `📝 ${remappedFiles} fichier(s) de configuration adapté(s) à cette machine (chemins remplacés).`);
  }
  if (remapUnresolved > 0) {
    broadcastLog('warn', `⚠ ${remapUnresolved} chemin(s) non résolu(s) dans les fichiers de configuration (dossier jeu / téléchargements non renseigné).`);
  }
  if (patchedDirectives.length > 0) {
    broadcastLog('info', `🔧 Patchs OctoDiff : ${patchStats.patched} appliqué(s), ${patchStats.already} déjà à jour, ${patchStats.fallback + patchStats.noPatch} non applicable(s).`);
    if (patchFallbackNames.length > 0) {
      broadcastLog('warn', `  ⚠ Version du fichier de base différente — fichier conservé sans patch : ${patchFallbackNames.slice(0, 10).join(', ')}${patchFallbackNames.length > 10 ? ` (+${patchFallbackNames.length - 10})` : ''}`);
    }
    if (patchStats.noPatch > 0) {
      broadcastLog('warn', `  ⚠ ${patchStats.noPatch} patch(s) absent(s) du .wabbajack — fichier de base conservé.`);
    }
  }

  // ── 4. OTHER DIRECTIVES ──────────────────────────────────────────────
  const bsaStaging = path.join(destRoot, BSA_STAGING_DIR);
  for (const d of otherDirectives) {
    await jobControl.waitIfPaused(signal);
    const type = (d.$type || '').toLowerCase();
    if (type.includes('createbsa')) {
      const bsaName = path.basename((d.To || '').replace(/\\/g, '/'));
      try {
        const outFile = resolveDirectivePath(d.To, destRoot);
        if (!outFile) throw new Error('chemin de destination invalide');
        const srcDir = path.join(bsaStaging, String(d.TempID || ''));
        if (!d.TempID || !fs.existsSync(srcDir)) throw new Error('fichiers sources absents (TempID introuvable)');
        const rels = Array.isArray(d.FileStates) ? d.FileStates.map((f) => f.Path).filter(Boolean) : undefined;
        const r = createBsa(srcDir, outFile, d.State || {}, rels && rels.length ? rels : undefined);
        broadcastLog('success', `  ✓ BSA créé : ${bsaName} (${r.files} fichiers)`);
        if (r.overflow.length > 0) {
          const loose = installBsaOverflow(r.overflow, path.dirname(outFile));
          broadcastLog('warn', `  ⚠ BSA ${bsaName} > 2 Go : ${r.overflow.length} fichier(s) au-delà de la limite lue par le jeu installé(s) en fichiers libres (${loose.placed} placé(s), ${loose.existing} déjà présent(s)).`);
          debugLog(`CreateBSA ${d.To} : fichiers libres hors archive`, r.overflow.map((f) => f.rel).join('\n'));
        }
        if (r.skipped.length > 0) broadcastLog('warn', `  ⚠ BSA ${bsaName} : ${r.skipped.length} fichier(s) manquant(s) ignoré(s)`);
        processed++;
      } catch (e) {
        broadcastLog('warn', `  ⚠ CreateBSA échoué (${bsaName} : ${String(e.message || e).slice(0, 160)})`);
        debugLog(`CreateBSA échoué : ${d.To}`, e?.stack || e?.message);
        errors++;
      }
      continue;
    }
    if (type.includes('mergedpatch')) {
      const mergeName = path.basename((d.To || '').replace(/\\/g, '/'));
      try {
        const r = buildMergedPatch(d, destRoot, await loadPatch(d));
        broadcastLog('success', `  ✓ Fusion zEdit créée : ${mergeName} (${r.sources} source(s))`);
        processed++;
      } catch (e) {
        broadcastLog('warn', `  ⚠ Fusion zEdit échouée (${mergeName} : ${String(e.message || e).slice(0, 160)})`);
        debugLog(`MergedPatch échoué : ${d.To}`, e?.stack || e?.message);
        errors++;
      }
      continue;
    }
    skipped++;
  }
  try { fs.rmSync(bsaStaging, { recursive: true, force: true }); } catch { /* */ }

  // ── POST-INSTALL CLEANUP ─────────────────────────────────────────────
  // Remove MO2-only files that have no function in a standalone Data directory
  broadcastLog('info', `🧹 Nettoyage post-installation...`);
  let cleanedCount = 0;
  const cleanupExts = new Set(['.modgroup', '.modgroups']);
  const dataDir = path.join(destRoot, 'Data');

  function cleanupDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanupDir(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (cleanupExts.has(ext)) {
          try { fs.unlinkSync(full); cleanedCount++; } catch { /* ignore */ }
        }
      }
    }
  }

  try {
    if (fs.existsSync(dataDir)) cleanupDir(dataDir);
    // Also check root in case some slipped through
    if (fs.existsSync(destRoot)) {
      for (const entry of fs.readdirSync(destRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (cleanupExts.has(ext)) {
            try { fs.unlinkSync(path.join(destRoot, entry.name)); cleanedCount++; } catch { }
          }
        }
      }
    }
    if (cleanedCount > 0) broadcastLog('success', `  ✓ ${cleanedCount} fichier(s) .modgroups supprimés (métadonnées MO2)`);
    else broadcastLog('info', `  ✓ Aucun fichier .modgroups à nettoyer`);
  } catch (cleanErr) {
    broadcastLog('warn', `  ⚠ Erreur nettoyage .modgroups : ${cleanErr.message}`);
  }

  return { processed, skipped, errors };
}
