// Installation d'une modlist (POST /api/install/start) : vérifications, téléchargements, acquisition
// du .wabbajack, déploiement des directives, profil MO2, rapport final.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { jobControl } from './jobcontrol.js';
import { broadcastLog, broadcastProgress, debugLog, currentInstallJob, logHistory } from './events.js';
import { writeLog, startInstallLog, endInstallLog } from './logger.js';
import { matchInRoot, rankGameRoots, siblingGameRoots } from './gameroot.js';
import { downloadWabbajackCdn, downloadGoogleDrive, downloadHttp } from './downloaders.js';
import { buildSelection, dedupeByPriority, renderModlistTxt, loadRawModlist, readZipEntry } from './modprofile.js';
import { checkDiskSpace, fmtBytes } from './diskspace.js';
import { openLazyZip } from './lazyzip.js';
import { HashCache, verifyArchive, verifyInstalledFiles, findStrayFiles, archiveSourceUrl, listDownloadDir, modOf } from './archivecheck.js';
import { isTempPath, locateWabbajack } from './locate.js';
import { resolveDirectivePath, detectGameRootFolders, setGameRootFolders, getGameRootFolders, KNOWN_GAME_ROOT_NAMES } from './paths.js';
import { installDirName, writeSnapshot, removeFiles } from './update.js';
import { getExpectedSkyrimVersion, isGameFileArchive, isIgnorableGameFile, gameFileRel, GAME_EXES, isGameRoot, gameSearchDirs, expectedGameFilePath } from './gamefiles.js';
import { getNexusDownloadUrl, nexusFetch } from './nexus.js';
import { makeDirResilient, testWriteAccess, find7z, findUnar, findTexconvBin } from './tools.js';
import { prepareUpdate, processDirectives } from './directives.js';
import { resolveMediaFire, resolveModDB, downloadFromMirrors, downloadMega } from './mirrors.js';

const DOWNLOAD_CONCURRENCY = 3; // archives téléchargées en même temps
const downloadFile = downloadHttp; // reprise (.part + Range) et nouvelles tentatives : downloaders.js

// ──────────────────────────────────────────────────────────────────────
// MAIN INSTALLATION ENDPOINT — Directive-based deployment
// ──────────────────────────────────────────────────────────────────────

// Identifiant de dossier de jeu utilisé par Vortex (<downloads>/<id>/)
export const VORTEX_GAME_IDS = {
  skyrimspecialedition: 'skyrimse', skyrimse: 'skyrimse',
  skyrim: 'skyrim', skyrimle: 'skyrim',
  skyrimvr: 'skyrimvr',
  falloutnewvegas: 'falloutnv', falloutnv: 'falloutnv',
  fallout4: 'fallout4', fallout3: 'fallout3',
};

/**
 * Organisation Vortex : si `root` contient déjà un sous-dossier du jeu (ex. skyrimse),
 * les téléchargements y sont écrits. Sinon (ou si `root` est déjà ce dossier) : `root`.
 * Ne crée aucun dossier.
 */
export function resolveVortexDownloadDir(root, gameType) {
  try {
    const compact = String(gameType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return root;
    const wanted = new Set([VORTEX_GAME_IDS[compact] || compact, compact]);
    if (wanted.has(path.basename(root).toLowerCase())) return root;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && wanted.has(e.name.toLowerCase())) return path.join(root, e.name);
    }
  } catch { /* dossier absent ou illisible → racine */ }
  return root;
}
// Notification macOS de fin d'installation (l'installation dure des heures : fenêtre souvent en arrière-plan)
export const NOTIFY_TEXT = {
  fr: { done: (n) => `« ${n} » est installée.`, failed: (n) => `Échec de l'installation de « ${n} ».` },
  en: { done: (n) => `"${n}" is installed.`, failed: (n) => `Installing "${n}" failed.` },
  es: { done: (n) => `«${n}» está instalada.`, failed: (n) => `La instalación de «${n}» ha fallado.` },
  it: { done: (n) => `«${n}» è installata.`, failed: (n) => `Installazione di «${n}» non riuscita.` },
};
export function notifyMac(lang, kind, name) {
  const text = (NOTIFY_TEXT[lang] || NOTIFY_TEXT.fr)[kind](name || 'modlist');
  // Texte passé en argument (argv) : aucun risque d'injection AppleScript
  execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run', 'mABBAJACK', text], () => {});
}

export async function startInstall(req, res) {
  const { modlist, downloadsPath, destPath, nexusApiKey, gamePath, options, uiLanguage } = req.body;
  if (!modlist || !destPath) return res.status(400).json({ error: 'Modlist et dossier READY TO PLAY requis.' });

  // Build the modlist-named subdirectory: UPPERCASE, filesystem-safe chars only
  // e.g. "Nordic Souls PBR" → destPath/NORDIC_SOULS_PBR/
  const baseDest     = path.resolve(destPath.trim());
  // Mise à jour : dossier de l'installation existante (sous-dossier direct de READY TO PLAY)
  const updateMode   = !!options?.update;
  const updateDir    = updateMode && typeof options.update?.dir === 'string' ? path.resolve(options.update.dir) : null;
  const modlistDirName = updateDir && path.dirname(updateDir) === baseDest
    ? path.basename(updateDir)
    : installDirName(modlist.name || modlist.title);
  const cleanDest    = path.join(baseDest, modlistDirName);
  const downloadsRoot = downloadsPath ? path.resolve(downloadsPath.trim()) : path.join(baseDest, 'DOWNLOADS');
  const cleanDownloads = resolveVortexDownloadDir(downloadsRoot, modlist.gameType);
  const vortexSubfolder = cleanDownloads !== downloadsRoot;

  if (currentInstallJob.active && currentInstallJob.abortController) {
    return res.status(409).json({ error: 'Une installation est déjà en cours.' });
  }
  jobControl.paused = false;
  const abortController = new AbortController();
  currentInstallJob.active = true;
  currentInstallJob.abortController = abortController;
  logHistory.length = 0;
  const installLogPath = startInstallLog(modlistDirName);
  writeLog({
    level: 'debug',
    message: `Paramètres d'installation — journal : ${installLogPath || '(désactivé)'}`,
    details: JSON.stringify({
      modlist: modlist.name, version: modlist.version, gameType: modlist.gameType, skyrimVersion: modlist.skyrimVersion,
      localFilePath: modlist.localFilePath, archives: (modlist.archives || []).length, directives: (modlist.directives || []).length,
      downloadsPath, destPath, gamePath, nexusApiKey: nexusApiKey ? '(renseignée)' : '(absente)',
    }, null, 2),
  });

  currentInstallJob.progress = {
    stage: 'validating_paths', stageName: 'Initialisation', overallPercent: 2, stagePercent: 0,
    currentTask: 'Vérification des répertoires...', processedItems: 0,
    totalItems: (modlist.directives || []).length || (modlist.archives || []).length,
    processedBytes: 0, totalBytes: modlist.totalArchiveSize || 0,
    speedBytesPerSec: 0, etaSeconds: 0, activeDownloads: 0, missingArchivesCount: 0,
    isPaused: false, hasError: false, errorMessage: null,
  };

  res.json({ status: 'started', message: 'Installation démarrée.' });

  (async () => {
    const { signal } = abortController;
    let wabbajackTempPath = null; // hors du try : nettoyé aussi en cas d'erreur (catch)
    try {
      await new Promise((r) => setTimeout(r, 400));

      broadcastLog('info', `═══════════════════════════════════════════════════`);
      broadcastLog('info', `  mABBAJACK v3 — Moteur de directives Wabbajack`);
      broadcastLog('info', `  Modlist : "${modlist.name}" v${modlist.version || '?'}`);
      broadcastLog('info', `  Dossier : ${modlistDirName}`);
      broadcastLog('info', `═══════════════════════════════════════════════════`);
      broadcastLog('info', `📥 DOWNLOADS    : ${cleanDownloads}`);
      if (vortexSubfolder) broadcastLog('info', `📂 Organisation Vortex détectée : les téléchargements sont enregistrés dans "${path.basename(cleanDownloads)}" (${downloadsRoot}).`);
      broadcastLog('info', `🚀 READY TO PLAY : ${baseDest}`);
      broadcastLog('info', `📂 Sous-dossier  : ${modlistDirName}`);

      if (modlist.gameType || modlist.skyrimVersion) {
        const expected = getExpectedSkyrimVersion(modlist.gameType, modlist.skyrimVersion, modlist.archives);
        broadcastLog('info', `🎮 Cible : ${expected.label} (${expected.versionHint})`);

      }

      // ── ÉTAPE 1 : Répertoires ──────────────────────────────────────
      broadcastProgress({ stage: 'validating_paths', stageName: 'Création des répertoires', overallPercent: 3, currentTask: 'Création DOWNLOADS et READY TO PLAY...' });

      try { makeDirResilient(cleanDownloads); broadcastLog('success', `✓ DOWNLOADS : "${cleanDownloads}"`); }
      catch (e) { broadcastLog('warn', `⚠ DOWNLOADS inaccessible : ${e.message}`); }

      makeDirResilient(cleanDest);
      const writeErr = testWriteAccess(cleanDest);
      if (writeErr) throw new Error(`READY TO PLAY "${cleanDest}" : ${writeErr}`);
      broadcastLog('success', `✓ Répertoire d'installation créé : "${cleanDest}"`);

      // Warn if READY TO PLAY already contains files (accumulated previous installs)
      if (updateMode) broadcastLog('info', `🔄 Mode mise à jour : seuls les fichiers nouveaux ou modifiés seront installés, les fichiers retirés de la liste seront supprimés.`);
      else try {
        const existingEntries = fs.readdirSync(cleanDest);
        if (existingEntries.length > 0) {
          broadcastLog('warn', `⚠ READY TO PLAY contient déjà ${existingEntries.length} entrée(s) — les fichiers existants seront écrasés ou coexisteront.`);
          broadcastLog('warn', `  → Si vous observez un dossier trop volumineux, videz READY TO PLAY manuellement avant relancer.`);
        }
      } catch {}


      const sevenZipBin = find7z();
      if (sevenZipBin) broadcastLog('success', `✓ 7zz disponible : ${sevenZipBin}`);
      else broadcastLog('warn', `⚠ 7zz introuvable — extraction impossible. Installez via : brew install sevenzip`);

      const unarBin = findUnar();
      if (unarBin) broadcastLog('info', `✓ unar disponible (fallback RAR5) : ${unarBin}`);

      const texconvBin = findTexconvBin();
      if (texconvBin) broadcastLog('info', `✓ texconv disponible (textures transformées) : ${texconvBin}`);
      else broadcastLog('warn', `⚠ texconv introuvable — les textures transformées seront copiées sans conversion.`);

      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 2 : Scan DOWNLOADS ───────────────────────────────────
      broadcastProgress({ stage: 'scanning_downloads', stageName: 'Scan DOWNLOADS', overallPercent: 7, currentTask: 'Inventaire des archives...' });

      // ── Sélection des mods : optionnels désactivés, profil, archives inutiles ──
      let selection = null;
      const logSelection = (sel) => {
        broadcastLog('info', `🎛 Options : ${sel.excludedMods.length} mod(s) optionnel(s) ignoré(s), ${sel.enabledOptional.length} activé(s) — profil « ${sel.profile || '?'} ».`);
        if (sel.skipHashes.size > 0) broadcastLog('info', `⏭ ${sel.skipHashes.size} archive(s) réservée(s) aux mods optionnels ignorées (non téléchargées).`);
      };
      const earlyFile = typeof modlist.localFilePath === 'string' && /\.wabbajack$/i.test(modlist.localFilePath) && fs.existsSync(modlist.localFilePath) ? modlist.localFilePath : null;
      let manifestRaw = null; // manifeste complet : instantané de fin d'installation
      if (earlyFile) {
        try {
          manifestRaw = await loadRawModlist(earlyFile);
          selection = await buildSelection(manifestRaw, (n) => readZipEntry(earlyFile, n), options || {});
          logSelection(selection);
        } catch (e) {
          broadcastLog('warn', `⚠ Options non appliquées : ${String(e.message || e).slice(0, 160)}`);
        }
      }
      // ── Mise à jour : fichiers inchangés, fichiers retirés, archives réellement nécessaires ──
      let updatePlan = null;
      if (updateMode) {
        if (!manifestRaw) broadcastLog('warn', `⚠ Mise à jour impossible sans fichier .wabbajack local : installation complète.`);
        else {
          try {
            updatePlan = await prepareUpdate({ raw: manifestRaw, wabbajackPath: earlyFile, selection, destRoot: cleanDest, previousFile: options.update?.previousFile, signal });
          } catch (e) {
            if (signal.aborted) throw e;
            broadcastLog('warn', `⚠ Comparaison avec l'installation existante impossible : ${String(e.message || e).slice(0, 160)} — installation complète.`);
          }
        }
      }
      const notSkipped = (a) => (!selection || !selection.skipHashes.has(a.Hash)) && (!updatePlan || updatePlan.neededArchives.has(a.Hash));
      if (updatePlan) {
        const unused = (modlist.archives || []).filter((a) => (!selection || !selection.skipHashes.has(a.Hash)) && !updatePlan.neededArchives.has(a.Hash)).length;
        broadcastLog('info', `⏭ Mise à jour : ${unused} archive(s) inutile(s) (fichiers inchangés) — ni vérifiées ni téléchargées.`);
      }

      const archives = (modlist.archives || []).filter(notSkipped);
      // Trust localPath already resolved by the client's verify-downloads scan.
      // The client sends archives with localPath set for matched files.
      // We only fall back to a server-side name-exact scan for archives without localPath.
      let archiveStatuses = archives.map((a) => {
        if (a.localPath && fs.existsSync(a.localPath)) {
          return { ...a, status: 'ready' };
        }
        if (a.status === 'ready' && a.localPath) {
          // path was set but file vanished between scan and install
          return { ...a, status: 'missing', localPath: null };
        }
        return { ...a, status: a.status || 'missing', localPath: a.localPath || null };
      });

      // ── Fichiers ORIGINAUX du jeu (GameFileSource) : identifiés EN PREMIER ──
      // Ils ne sont jamais téléchargés ni décompressés : lus dans le dossier du jeu.
      const fileSizeOf = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };
      // Un seul dossier du jeu, choisi parce que ses fichiers ont la taille attendue par le
      // manifeste : les patchs s'appliquent sur ces fichiers, une autre version donnerait des
      // fichiers faux. Un fichier qui ne correspond pas n'est jamais déployé.
      const resolveGameFiles = (list) => {
        const games = list.filter((a) => isGameFileArchive(a) && !isIgnorableGameFile(a));
        let chosenRoot = null;
        if (games.length > 0) {
          const gameName = games[0]?.State?.Game;
          const exes = GAME_EXES[String(gameName || '').toLowerCase()] || GAME_EXES.skyrimspecialedition;
          const isRoot = (p) => isGameRoot(p, exes);
          const userRoot = gamePath && String(gamePath).trim() ? path.resolve(String(gamePath).trim()) : null;
          const roots = [];
          if (userRoot) {
            if (isRoot(userRoot)) roots.push(userRoot);
            // Le dossier indiqué, ses sous-dossiers et ses voisins (autres versions du jeu)
            roots.push(...siblingGameRoots(path.join(userRoot, '_'), isRoot, 3, 2));
          }
          roots.push(...gameSearchDirs(games[0], null, true));
          const ranking = rankGameRoots(roots, games, userRoot);
          const ver = games[0]?.State?.GameVersion || '?';
          const best = ranking[0];
          if (best && best.matched > 0) {
            chosenRoot = best.root;
            const inUser = (r) => r === userRoot || r.startsWith(`${userRoot}/`);
            const userRank = userRoot ? ranking.find((r) => r.root === userRoot) || ranking.find((r) => inUser(r.root)) : null;
            if (userRoot && !inUser(best.root)) {
              broadcastLog('warn', `⚠ Dossier du jeu indiqué : ${userRoot}${userRank ? ` (${userRank.matched}/${games.length} fichiers conformes à la version ${ver})` : ''}.`);
              broadcastLog('warn', `  → Dossier retenu, conforme à la version ${ver} : ${best.root} (${best.matched}/${games.length}).`);
            }
            const ties = ranking.filter((r) => r.matched === best.matched && r.root !== best.root);
            if (ties.length > 0) broadcastLog('info', `  ℹ Autre(s) dossier(s) du jeu équivalent(s) : ${ties.map((r) => r.root).join(', ')}`);
          }
          if (ranking.length > 0) debugLog(`Dossiers du jeu (version ${ver}) : ${ranking.map((r) => `${r.root} = ${r.matched}/${games.length}`).join(' · ')}`);
        }
        const downloads = fs.existsSync(cleanDownloads) ? cleanDownloads : null;
        const out = list.map((a) => {
          if (isIgnorableGameFile(a)) return { ...a, status: 'ready', sourceKind: 'game', ignored: true };
          if (!isGameFileArchive(a)) return a;
          if (a.status === 'ready' && a.localPath && (!a.Size || fileSizeOf(a.localPath) === a.Size)) return { ...a, sourceKind: 'game' };
          let p = chosenRoot ? matchInRoot(chosenRoot, a) : null;
          if (!p && downloads) {
            p = [a.Name, path.basename(gameFileRel(a))].filter(Boolean).map((n) => path.join(downloads, n))
              .find((c) => { const sz = fileSizeOf(c); return sz > 0 && (!a.Size || sz === a.Size); }) || null;
          }
          return p
            ? { ...a, status: 'ready', localPath: p, sourceKind: 'game', sizeMatches: true }
            : { ...a, status: 'missing', localPath: null, sourceKind: 'game' };
        });
        if (games.length > 0) {
          const ver = games[0]?.State?.GameVersion || '?';
          const found = out.filter((a) => isGameFileArchive(a) && !a.ignored && a.status === 'ready');
          const absent = out.filter((a) => isGameFileArchive(a) && !a.ignored && a.status !== 'ready');
          broadcastLog(absent.length === 0 ? 'success' : 'warn',
            `🎮 Fichiers originaux du jeu (version ${ver}) : ${found.length}/${games.length} conformes${chosenRoot ? ` dans ${chosenRoot}` : ''}`);
          if (absent.length > 0) {
            const names = absent.map((a) => gameFileRel(a) || a.Name);
            broadcastLog('error', `  ✗ ${absent.length} fichier(s) du jeu absent(s) ou d'une autre version : ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`);
            broadcastLog('error', `  → Les fichiers qui en dépendent ne seront pas installés. Indiquez un dossier du jeu en version ${ver}.`);
          }
        }
        return out;
      };
      archiveStatuses = resolveGameFiles(archiveStatuses);

      // Dossier dédié à la liste : celui du .wabbajack (ex. WABBAJACK LISTS/<LISTE>/), sinon
      // DOWNLOADS/<LISTE>/. Prioritaire sur le cache commun, qu'on ne modifie jamais pour une
      // archive de même nom : il sert peut-être à une autre modlist.
      // Fichier chargé par copie temporaire (envoi du navigateur) : retrouver le vrai .wabbajack
      let wabbajackRealPath = modlist.localFilePath;
      if (isTempPath(wabbajackRealPath)) {
        const tmpSize = fileSizeOf(wabbajackRealPath);
        const found = tmpSize > 0 ? await locateWabbajack(path.basename(wabbajackRealPath), tmpSize) : null;
        if (found) { wabbajackRealPath = found; broadcastLog('info', `📄 Fichier .wabbajack d'origine retrouvé : ${found}`); }
        else broadcastLog('warn', `⚠ Fichier .wabbajack chargé par une copie temporaire et original introuvable : dossier dédié = ${path.join(cleanDownloads, modlistDirName)}`);
      }
      const listDir = listDownloadDir(wabbajackRealPath);
      const dedicatedDir = listDir || path.join(cleanDownloads, modlistDirName);
      if (listDir) broadcastLog('info', `📂 Dossier dédié à la liste (prioritaire) : ${listDir}`);
      const hashCache = new HashCache();
      const fmtSize = (n) => `${Number(n || 0).toLocaleString('fr-FR')} o`;
      const describeWrongVersion = (a) => {
        const w = a.wrongVersion;
        return w.reason === 'size'
          ? `"${w.path}" fait ${fmtSize(w.size)} au lieu de ${fmtSize(a.Size)}`
          : `"${w.path}" a la bonne taille mais un autre contenu (hash ${w.hash} au lieu de ${a.Hash})`;
      };
      const verifyArchiveFiles = async (list) => {
        const todo = list.filter((a) => !isGameFileArchive(a) && !a.ignored);
        if (todo.length === 0) return list;
        broadcastProgress({ stage: 'scanning_downloads', stageName: 'Vérification des archives', currentTask: `Vérification de ${todo.length} archive(s)…` });
        broadcastLog('info', `🔎 Vérification de ${todo.length} archive(s) : taille puis hash Wabbajack (mis en cache après le premier calcul)…`);
        const totalBytes = todo.reduce((s, a) => s + (Number(a.Size) || 0), 0);
        let doneBytes = 0, hashed = 0, fromCache = 0, i = 0, lastSave = Date.now();
        const out = [];
        for (const a of list) {
          if (isGameFileArchive(a) || a.ignored) { out.push(a); continue; }
          i++;
          await jobControl.waitIfPaused(signal);
          const name = a.Name || '';
          const candidates = [...new Set([
            name && path.join(dedicatedDir, name),
            a.localPath,
            name && path.join(cleanDownloads, name),
            name && path.join(downloadsRoot, name),
          ].filter((p) => p && fs.existsSync(p)))];
          let good = null, wrong = null;
          for (const p of candidates) {
            const r = await verifyArchive(a, p, {
              cache: hashCache, signal, waitIfPaused: (s) => jobControl.waitIfPaused(s),
              onBytes: (n) => {
                doneBytes += n;
                broadcastProgress({ currentTask: `🔎 ${i}/${todo.length} — ${name}`, stagePercent: totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0 });
              },
            });
            if (r.hash) { if (r.cached) fromCache++; else hashed++; }
            if (r.ok) { good = p; break; }
            if (!wrong && r.reason !== 'unreadable') wrong = { path: p, reason: r.reason, size: r.size, hash: r.hash };
          }
          if (Date.now() - lastSave > 30000) { hashCache.save(); lastSave = Date.now(); }
          const { wrongVersion: _old, ...rest } = a;
          if (good) out.push({ ...rest, status: 'ready', localPath: good });
          else out.push({ ...rest, status: 'missing', localPath: null, ...(wrong ? { wrongVersion: wrong } : {}) });
        }
        hashCache.save();
        const ok = out.filter((a) => a.status === 'ready' && !isGameFileArchive(a) && !a.ignored).length;
        const wrongN = out.filter((a) => a.wrongVersion).length;
        broadcastLog(ok === todo.length ? 'success' : 'warn',
          `✓ Archives vérifiées : ${ok} correcte(s), ${wrongN} de même nom mais d'une autre version, ${todo.length - ok - wrongN} absente(s) — ${hashed} hash calculé(s), ${fromCache} lu(s) en cache.`);
        return out;
      };

      // ── Vérification des archives : taille puis hash Wabbajack (xxHash64) ──
      // Une archive de même nom n'est JAMAIS acceptée sur son seul nom : les noms génériques
      // (« DynDOLOD Output.7z », « Synthesis.zip »…) existent dans plusieurs modlists.
      // Ordre de recherche : dossier dédié à la liste (prioritaire), chemin trouvé par le scan
      // de l'interface, puis cache commun (dossier du jeu, puis racine).
      archiveStatuses = await verifyArchiveFiles(archiveStatuses);

      const readyCount = archiveStatuses.filter((a) => a.status === 'ready').length;
      const missingCount = archives.length - readyCount;
      broadcastLog('info', `Scan : ${readyCount}/${archives.length} archives correctes, ${missingCount} absente(s) ou incorrecte(s).`);
      for (const a of archiveStatuses) {
        if (a.status === 'ready') continue;
        if (isGameFileArchive(a)) broadcastLog('warn', `  ✗ Manquant : ${path.basename(gameFileRel(a))} — fichier original du jeu (attendu : ${expectedGameFilePath(a, gamePath)})`);
        else if (a.wrongVersion) broadcastLog('warn', `  ✗ Mauvaise version : ${a.Name} — ${describeWrongVersion(a)}`);
        else broadcastLog('warn', `  ✗ Manquant : ${a.Name} — archive de mod`);
      }
      broadcastProgress({ missingArchivesCount: missingCount, overallPercent: 10 });

      // ── Contrôle d'espace disque ──
      {
        const downloadBytes = archiveStatuses
          .filter((a) => a.status !== 'ready' && !isGameFileArchive(a))
          .reduce((s, a) => s + (Number(a.Size) || 0), 0);
        const installBytes = selection?.keptBytes ?? (Number(modlist.totalInstalledSize) || 0);
        const ds = checkDiskSpace({ downloadDir: cleanDownloads, destDir: cleanDest, downloadBytes, installBytes });
        if (ds.level !== 'unknown') {
          broadcastLog('info', `💾 Espace requis ≈ ${fmtBytes(ds.need)} (téléchargements ${fmtBytes(ds.needDownloads)} + installation ${fmtBytes(ds.needInstall)}) — libre : ${fmtBytes(ds.free)}.`);
        }
        if (ds.level === 'warn') broadcastLog('warn', `⚠ Espace disque limite : il manque ≈ ${fmtBytes(ds.shortBy)} sur ${fmtBytes(ds.free)}.`);
        if (ds.level === 'error') throw new Error(`Espace disque insuffisant : il manque ≈ ${fmtBytes(ds.shortBy)} sur ${fmtBytes(ds.free)}.`);
      }
      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 3 : Téléchargements ──────────────────────────────────
      let downloadedCount = 0, skippedManual = 0, globalBytes = 0;
      const manualUrls = new Map(); // archive Name → page de téléchargement manuel
      const globalStart = Date.now();

      if (missingCount > 0) {
        broadcastProgress({ stage: 'downloading_archives', stageName: `Téléchargements`, overallPercent: 12, processedItems: readyCount, totalItems: archives.length, currentTask: `${missingCount} archive(s) à télécharger...` });

        // Plusieurs archives à la fois : le débit Nexus / CDN est mieux exploité
        const queue = archiveStatuses.filter((a) => a.status !== 'ready');
        const missingBytes = queue.reduce((s, a) => s + (a.Size || 0), 0);
        const received = new Map(); // archive → octets reçus (progression globale)
        let active = 0;
        const downloadOne = async (arc) => {
          await jobControl.waitIfPaused(signal);
          // Fichier original du jeu : aucune source de téléchargement (voir rapport final)
          if (isGameFileArchive(arc)) { skippedManual++; return; }

          const archiveName = arc.Name || 'inconnu';
          const sizeMo = arc.Size ? `${(arc.Size / 1048576).toFixed(1)} Mo` : '? Mo';
          const state = arc.State || {};
          broadcastLog('info', `⬇ ${archiveName} (${sizeMo})`);

          let url = null;
          let requiresManual = false, manualUrl = null;

          let cdnUrl = null, driveId = null, hosted = null;
          const stateType = String(state.$type || '');

          if (/WabbajackCDN/i.test(stateType) && state.Url) { cdnUrl = state.Url; url = state.Url; }
          else if (/GoogleDrive/i.test(stateType) && state.Id) { driveId = state.Id; url = 'gdrive'; }
          // Pages d'hébergeurs : le vrai lien est trouvé au moment du téléchargement (mirrors.js)
          else if (/MediaFire/i.test(stateType) && state.Url) { hosted = 'mediafire'; url = state.Url; }
          else if (/ModDB/i.test(stateType) && state.Url) { hosted = 'moddb'; url = state.Url; }
          else if (/^Mega/i.test(stateType) && state.Url) { hosted = 'mega'; url = state.Url; }
          else if (state.Url?.startsWith('http')) { url = state.Url; }
          else if (state.GameName && (state.ModID || state.NexusFileID) && nexusApiKey) {
            const modId = state.ModID || state.NexusFileID;
            const fileId = state.FileID || state.NexusID;
            if (modId && fileId) {
              const r = await getNexusDownloadUrl(state.GameName, modId, fileId, nexusApiKey);
              if (r.url) { url = r.url; }
              else { requiresManual = true; manualUrl = r.manualUrl; if (!r.isPremium) broadcastLog('warn', `  → Nexus Standard : téléchargement manuel requis`); }
            } else { requiresManual = true; manualUrl = `https://www.nexusmods.com/${state.GameName || 'skyrimspecialedition'}/mods/${modId}`; }
          } else { requiresManual = true; }

          if (requiresManual) {
            skippedManual++;
            manualUrl ||= archiveSourceUrl(arc);
            const copyDir = arc.wrongVersion ? dedicatedDir : cleanDownloads;
            if (manualUrl) { manualUrls.set(archiveName, manualUrl); broadcastLog('warn', `  → Manuel : ${manualUrl}`); broadcastLog('warn', `  → Copiez "${archiveName}" dans : ${copyDir}`); }
            else broadcastLog('warn', `  → Source inconnue — copiez manuellement "${archiveName}" dans : ${copyDir}`);
            return;
          }

          active++;
          try {
            let lastRecv = null; // 1er appel : base (un .part repris ne compte pas dans la vitesse)
            const dlProgress = (recv, total, speed) => {
              if (lastRecv !== null) globalBytes += recv - lastRecv;
              lastRecv = recv;
              received.set(arc, recv);
              const elap = (Date.now() - globalStart) / 1000;
              let done = 0; for (const n of received.values()) done += n;
              const others = active > 1 ? ` (+${active - 1} en cours)` : '';
              broadcastProgress({ currentTask: `⬇ ${archiveName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo${others}`, speedBytesPerSec: Math.round(elap > 0 ? globalBytes / elap : speed), stagePercent: missingBytes > 0 ? Math.min(100, Math.round((done / missingBytes) * 100)) : 0 });
            };
            // Une autre version porte déjà ce nom dans le cache commun : on ne l'écrase pas.
            const destDir = arc.wrongVersion ? dedicatedDir : cleanDownloads;
            if (arc.wrongVersion) { makeDirResilient(destDir); broadcastLog('info', `  → Enregistré dans le dossier dédié à la liste : ${destDir}`); }
            const destFile = path.join(destDir, archiveName);
            if (cdnUrl) await downloadWabbajackCdn(cdnUrl, destFile, dlProgress, signal, arc.Size || 0);
            else if (driveId) await downloadGoogleDrive(driveId, destFile, dlProgress, signal, arc.Size || 0);
            else if (hosted === 'mega') await downloadMega(url, destFile, dlProgress, signal);
            else if (hosted === 'mediafire') await downloadFile(await resolveMediaFire(url, signal), destFile, dlProgress, signal);
            else if (hosted === 'moddb') await downloadFromMirrors(await resolveModDB(url, signal), destFile, dlProgress, signal, downloadFile);
            else await downloadFile(url, destFile, dlProgress, signal);
            const check = await verifyArchive(arc, destFile, { cache: hashCache, signal });
            hashCache.save();
            if (!check.ok) throw new Error(`fichier téléchargé incorrect (${check.reason === 'size' ? `taille ${check.size} au lieu de ${arc.Size}` : 'hash différent du manifeste'})`);
            arc.status = 'ready'; arc.localPath = destFile; delete arc.wrongVersion;
            downloadedCount++;
            broadcastLog('success', `  ✓ Téléchargé et vérifié : ${archiveName}`);
            broadcastProgress({ overallPercent: Math.min(35, 12 + Math.round(((downloadedCount + skippedManual) / missingCount) * 23)), processedItems: readyCount + downloadedCount });
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `  ✗ Échec : ${archiveName} — ${dlErr.message}`);
            const src = archiveSourceUrl(arc);
            if (src) { manualUrls.set(archiveName, src); broadcastLog('warn', `  → Manuel : ${src}`); }
            broadcastLog('warn', `  → Copiez manuellement "${archiveName}" dans : ${arc.wrongVersion ? dedicatedDir : cleanDownloads}`);
            skippedManual++;
          }
          finally { active--; }
        };
        const worker = async () => { while (queue.length) await downloadOne(queue.shift()); };
        await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, worker));

        if (downloadedCount > 0) broadcastLog('success', `✓ ${downloadedCount} archive(s) téléchargée(s).`);
      }

      await new Promise((r) => setTimeout(r, 200));

      // ── ÉTAPE 4 : ACQUISITION + DÉPLOIEMENT .wabbajack ────────────────────
      // L'URL CDN authored-files.wabbajack.org/{name}_{guid} est une page HTML.
      // Stratégie :
      //   1. Chemin local → charger directement
      //   2. URL page CDN → essayer GitHub Releases; sinon instructions manuelles
      //   3. Autre URL    → vérifier content-type avant téléchargement

      broadcastProgress({
        stage: 'extracting_files',
        stageName: 'Déploiement des directives (extraction sélective)',
        overallPercent: 38,
        processedItems: 0,
        totalItems: (modlist.directives || []).length,
        currentTask: `Préparation du fichier .wabbajack…`,
      });

      broadcastLog('info', `\n═══════════════════════════════════════════════════`);
      broadcastLog('info', `  PHASE PRINCIPALE : Déploiement des directives`);
      broadcastLog('info', `  Chaque fichier est extrait précisément selon`);
      broadcastLog('info', `  les choix FOMOD pré-enregistrés par l'auteur.`);
      broadcastLog('info', `═══════════════════════════════════════════════════`);

      let wabbajackZip = null;
      let droppedDirectives = []; // directives des mods désactivés (profil, options)
      const rawWabbajackRef = modlist.localFilePath;
      const CDN_PAGE_HOST = 'authored-files.wabbajack.org';

      // Détecte si l'URL est une page web CDN (pas un fichier direct)
      const isCdnPageUrl = (url) => {
        if (!url) return false;
        try {
          const u = new URL(url);
          return u.hostname === CDN_PAGE_HOST && !u.pathname.startsWith('/authored_files/');
        } catch { return false; }
      };

      // Cherche un .wabbajack dans les GitHub Releases de la modlist
      // Priorité à la version qui correspond à modlist.version (ex: 3.1.1)
      // Retourne { url, exactMatch } ou null si aucune release trouvée
      const findGithubRelease = async (readmeUrl) => {
        const ghMatch = (readmeUrl || '').match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!ghMatch) return null;
        const [, owner, repo] = ghMatch;
        try {
          broadcastLog('info', `🔍 Recherche releases GitHub : ${owner}/${repo}…`);
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
            headers: { 'User-Agent': 'mAbbajack/3', 'Accept': 'application/vnd.github.v3+json' },
            signal,
          });
          if (!res.ok) { broadcastLog('warn', `  ⚠ GitHub API : ${res.status}`); return null; }
          const releases = await res.json();
          // -- Passe 1 : chercher la version correspondante exactement
          const targetVersion = (modlist.version || '').replace(/^v/i, '').trim();
          if (targetVersion) {
            for (const rel of releases) {
              const tagVer = (rel.tag_name || '').replace(/^v/i, '').trim();
              if (tagVer !== targetVersion) continue;
              for (const asset of (rel.assets || [])) {
                if (asset.name && asset.name.toLowerCase().endsWith('.wabbajack')) {
                  broadcastLog('info', `  ✓ Version exacte trouvée : ${asset.name} (${(asset.size / 1048576).toFixed(0)} Mo) — Release ${rel.tag_name}`);
                  return { url: asset.browser_download_url, exactMatch: true };
                }
              }
            }
            broadcastLog('warn', `  ⚠ Version ${targetVersion} introuvable sur GitHub — tentative Nexus Mods…`);
          }
          // -- Passe 2 : prendre la première release disponible (fallback)
          for (const rel of releases) {
            for (const asset of (rel.assets || [])) {
              if (asset.name && asset.name.toLowerCase().endsWith('.wabbajack')) {
                broadcastLog('warn', `  ⚠ GitHub fallback : release ${rel.tag_name} disponible (pas la v${targetVersion}).`);
                return { url: asset.browser_download_url, exactMatch: false };
              }
            }
          }
          broadcastLog('warn', `  ⚠ Aucun asset .wabbajack dans les releases de ${owner}/${repo}`);
        } catch (e) {
          broadcastLog('warn', `  ⚠ GitHub API inaccessible : ${e.message}`);
        }
        return null;
      };

      // Cherche un .wabbajack sur Nexus Mods (via links.websiteURL ou links.nexusCollection)
      // Retourne { url, manualUrl, isPremium } ou null si non trouvé
      const findNexusWabbajack = async (nexusPageUrl) => {
        if (!nexusApiKey) { broadcastLog('warn', `  ⚠ Nexus : clé API manquante — impossible de chercher le .wabbajack`); return null; }
        // Extract game domain + mod ID from URL
        // e.g. https://www.nexusmods.com/skyrimspecialedition/mods/147302
        const nexusMatch = (nexusPageUrl || '').match(/nexusmods\.com\/([a-z0-9]+)\/mods\/(\d+)/);
        if (!nexusMatch) return null;
        const [, gameDomain, modId] = nexusMatch;
        try {
          broadcastLog('info', `🔍 Recherche .wabbajack sur Nexus Mods : ${gameDomain}/mods/${modId}…`);
          const filesData = await nexusFetch(`/v1/games/${gameDomain}/mods/${modId}/files.json`, nexusApiKey);
          const allFiles = filesData?.files || filesData || [];
          // Find the .wabbajack file (usually in category MAIN or OPTIONAL)
          const wjFile = allFiles.find((f) =>
            f.file_name && f.file_name.toLowerCase().endsWith('.wabbajack') &&
            f.category_name !== 'ARCHIVED'
          );
          if (!wjFile) {
            broadcastLog('warn', `  ⚠ Aucun fichier .wabbajack trouvé sur Nexus mods/${modId}`);
            return null;
          }
          const sizeMo = wjFile.size_kb ? `${(wjFile.size_kb / 1024).toFixed(0)} Mo` : '? Mo';
          broadcastLog('info', `  ✓ Trouvé sur Nexus : ${wjFile.file_name} (${sizeMo}) — file_id=${wjFile.file_id}`);
          // Try to get download URL (requires premium for direct link)
          const dlResult = await getNexusDownloadUrl(gameDomain, modId, wjFile.file_id, nexusApiKey);
          if (dlResult.url) {
            broadcastLog('info', `  ✓ URL directe Nexus obtenue (Premium)`);
            return { url: dlResult.url, manualUrl: null, isPremium: true };
          } else {
            const manualUrl = dlResult.manualUrl || `https://www.nexusmods.com/${gameDomain}/mods/${modId}?tab=files&file_id=${wjFile.file_id}`;
            broadcastLog('warn', `  ⚠ Nexus Standard : téléchargement manuel requis`);
            return { url: null, manualUrl, isPremium: false };
          }
        } catch (e) {
          broadcastLog('warn', `  ⚠ Nexus API inaccessible : ${e.message}`);
          return null;
        }
      };

      let localWabbajackPath = null;

      if (rawWabbajackRef && !rawWabbajackRef.startsWith('http') && fs.existsSync(rawWabbajackRef)) {
        // Cas 1 : chemin local
        localWabbajackPath = rawWabbajackRef;
        broadcastLog('info', `📁 Fichier .wabbajack local : ${path.basename(localWabbajackPath)}`);

      } else if (isCdnPageUrl(rawWabbajackRef)) {
        // Cas 2 : URL page CDN — chaîne de fallback :
        //   1. GitHub version EXACTE  →  2. Nexus Mods (Premium)  →  3. GitHub version inexacte  →  4. Manuel
        broadcastLog('warn', `⚠ L'URL CDN Wabbajack est une page web (non téléchargeable directement).`);

        const modLinks  = modlist.links || {};
        const readmeUrl  = modLinks.readme  || '';
        const websiteUrl = modLinks.websiteURL || '';
        const nexusUrl   = [websiteUrl, readmeUrl].find((u) => u && u.includes('nexusmods.com'));

        // Résultat GitHub (peut être exact ou fallback vieille version)
        broadcastLog('info', `  → [1/3] Tentative via GitHub Releases…`);
        const ghResult = await findGithubRelease(readmeUrl || websiteUrl);

        // ── Étape 1 : Version exacte sur GitHub → utiliser directement ────
        if (ghResult && ghResult.exactMatch) {
          broadcastProgress({ currentTask: 'Téléchargement .wabbajack depuis GitHub (version exacte)…', stagePercent: 0 });
          broadcastLog('info', `⬇ Téléchargement depuis GitHub (version exacte) : ${ghResult.url}`);
          const tmpDir = path.join(os.tmpdir(), 'mabbajack');
          makeDirResilient(tmpDir);
          const safeName = path.basename(ghResult.url.split('?')[0]) || 'modlist.wabbajack';
          wabbajackTempPath = path.join(tmpDir, safeName);
          try {
            await downloadFile(ghResult.url, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack téléchargé depuis GitHub : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `✗ Échec téléchargement GitHub : ${dlErr.message}`);
          }
        }

        // ── Étape 2 : Nexus Mods (prioritaire sur GitHub inexact) ──────────
        if (!localWabbajackPath) {
          broadcastLog('info', `  → [2/3] Tentative via Nexus Mods…`);
          const nexusResult = await findNexusWabbajack(nexusUrl);

          if (nexusResult && nexusResult.url) {
            broadcastProgress({ currentTask: 'Téléchargement .wabbajack depuis Nexus Mods…', stagePercent: 0 });
            broadcastLog('info', `⬇ Téléchargement depuis Nexus : ${nexusResult.url.substring(0, 80)}…`);
            const tmpDir = path.join(os.tmpdir(), 'mabbajack');
            makeDirResilient(tmpDir);
            const safeName = `${(modlist.title || modlist.name || 'modlist').replace(/[^a-zA-Z0-9_-]/g, '_')}.wabbajack`;
            wabbajackTempPath = path.join(tmpDir, safeName);
            try {
              await downloadFile(nexusResult.url, wabbajackTempPath, (recv, total) => {
                broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} / ${total > 0 ? (total / 1048576).toFixed(1) : '?'} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
              }, signal);
              broadcastLog('success', `✓ .wabbajack téléchargé depuis Nexus : ${wabbajackTempPath}`);
              localWabbajackPath = wabbajackTempPath;
            } catch (dlErr) {
              if (signal.aborted) throw new Error('Annulé');
              broadcastLog('error', `✗ Échec téléchargement Nexus : ${dlErr.message}`);
            }
          } else if (nexusResult && nexusResult.manualUrl) {
            broadcastLog('warn', `  ⚠ Compte Nexus Standard — URL de téléchargement manuel : ${nexusResult.manualUrl}`);
          }
        }

        // ── Étape 3 : GitHub version inexacte (dernier recours) ─────────────
        if (!localWabbajackPath && ghResult && ghResult.url) {
          broadcastLog('warn', `  → [3/3] Utilisation de la version GitHub inexacte en dernier recours…`);
          broadcastLog('warn', `  ⚠ ATTENTION : version ${(modlist.version || '?')} introuvable — utilisation d'une version antérieure.`);
          broadcastLog('warn', `  ⚠ Les directives peuvent ne pas correspondre à vos archives téléchargées.`);
          const tmpDir = path.join(os.tmpdir(), 'mabbajack');
          makeDirResilient(tmpDir);
          const safeName = path.basename(ghResult.url.split('?')[0]) || 'modlist.wabbajack';
          wabbajackTempPath = path.join(tmpDir, safeName);
          try {
            await downloadFile(ghResult.url, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} (version inexacte) — ${(recv / 1048576).toFixed(1)} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack (version inexacte) téléchargé : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          } catch (dlErr) {
            if (signal.aborted) throw new Error('Annulé');
            broadcastLog('error', `✗ Échec : ${dlErr.message}`);
          }
        }

        // ── Aucune source → instructions manuelles ───────────────────────────
        if (!localWabbajackPath) {
          broadcastLog('warn', `⚠ Téléchargement automatique impossible.`);
          broadcastLog('warn', ``);
          broadcastLog('warn', `  ┌─ ACTION REQUISE ──────────────────────────────────────────────────`);
          if (nexusUrl) {
            broadcastLog('warn', `  │ Option A — Nexus Mods (onglet Files) :`);
            broadcastLog('warn', `  │   ${nexusUrl}?tab=files`);
          }
          broadcastLog('warn', `  │ Option ${nexusUrl ? 'B' : 'A'} — CDN Wabbajack (connexion requise) :`);
          broadcastLog('warn', `  │   ${rawWabbajackRef}`);
          broadcastLog('warn', `  │`);
          broadcastLog('warn', `  │ 1. Téléchargez le fichier .wabbajack`);
          broadcastLog('warn', `  │ 2. Chargez-le via 📁 Ouvrir (Inspecteur mABBAJACK)`);
          broadcastLog('warn', `  │ 3. Relancez l'installation`);
          broadcastLog('warn', `  └────────────────────────────────────────────────────────────────────`);
          broadcastLog('warn', `  → Installation continue sans directives (plugins.txt seulement).`);
        }

      } else if (rawWabbajackRef && rawWabbajackRef.startsWith('http')) {
        // Cas 3 : URL directe — vérification content-type avant téléchargement
        try {
          const headRes = await fetch(rawWabbajackRef, { method: 'HEAD', signal });
          const ct = headRes.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            broadcastLog('warn', `⚠ L'URL retourne du HTML, pas un fichier .wabbajack : ${rawWabbajackRef}`);
          } else {
            broadcastLog('info', `⬇ Téléchargement direct .wabbajack…`);
            const tmpDir = path.join(os.tmpdir(), 'mabbajack');
            makeDirResilient(tmpDir);
            const safeName = path.basename(rawWabbajackRef.split('?')[0]) || 'modlist.wabbajack';
            wabbajackTempPath = path.join(tmpDir, safeName);
            await downloadFile(rawWabbajackRef, wabbajackTempPath, (recv, total) => {
              broadcastProgress({ currentTask: `⬇ ${safeName} — ${(recv / 1048576).toFixed(1)} Mo`, stagePercent: total > 0 ? Math.round((recv / total) * 100) : 0 });
            }, signal);
            broadcastLog('success', `✓ .wabbajack téléchargé : ${wabbajackTempPath}`);
            localWabbajackPath = wabbajackTempPath;
          }
        } catch (e) {
          if (signal.aborted) throw new Error('Annulé');
          broadcastLog('error', `✗ Erreur téléchargement .wabbajack : ${e.message}`);
        }
      }

      if (localWabbajackPath) {
        try {
          broadcastLog('info', `📁 Lecture du fichier .wabbajack : ${path.basename(localWabbajackPath)}`);
          // Lecture paresseuse (unzip) : un .wabbajack de plusieurs Go ne tient pas dans JSZip / un Buffer
          wabbajackZip = await openLazyZip(localWabbajackPath);
          const entries = Object.keys(wabbajackZip.files).length;
          broadcastLog('success', `✓ .wabbajack chargé (${entries} entrées)`);

          // Always parse directives + archives from the zip (directives are NOT sent in body to avoid 413)
          if (wabbajackZip.files['modlist']) {
            try {
              const modlistJson = JSON.parse(await wabbajackZip.files['modlist'].async('string'));
              const rawDirs = modlistJson.Directives || modlistJson.directives || [];
              const parseDirective = (d) => {
                const ahp = d.ArchiveHashPath || [];
                const len = ahp.length;
                return {
                  $type: d.$type || d.type || 'FromArchive',
                  To: (d.To || d.to || '').replace(/\\/g, '/'),
                  Size: d.Size || 0,
                  Hash: d.Hash || '',
                  ArchiveHash: ahp[0] || d.ArchiveHash || '',
                  SourcePath: len >= 2 ? ahp[1].replace(/\\/g, '/') : (d.SourcePath || '').replace(/\\/g, '/'),
                  BsaInternalPath: len === 3 ? ahp[2].replace(/\\/g, '/') : null,
                  ArchiveHashPath: ahp,
                  PatchID: d.PatchID || d.patchID || '',
                  FromHash: d.FromHash || '',
                  SourceDataID: d.SourceDataID || '',
                  ArchiveName: d.State?.Name || '',
                  // TransformedTexture : état cible (Width, Height, Format, MipLevels)
                  ImageState: d.ImageState || undefined,
                  // CreateBSA
                  TempID: d.TempID || '',
                  FileStates: d.FileStates || undefined,
                  State: d.State || undefined,
                };
              };
              modlist.directives = rawDirs.map(parseDirective);
              manifestRaw ||= modlistJson;
              // Sélection non encore calculée (fichier téléchargé pendant l'installation)
              if (!selection) {
                try {
                  selection = await buildSelection(modlistJson, async (n) => { const f = wabbajackZip.file(n); return f ? f.async('nodebuffer') : null; }, options || {});
                  logSelection(selection);
                } catch (e) {
                  broadcastLog('warn', `⚠ Options non appliquées : ${String(e.message || e).slice(0, 160)}`);
                }
              }
              if (selection) {
                droppedDirectives = modlist.directives.filter((d) => !selection.keep(d.To));
                modlist.directives = modlist.directives.filter((d) => selection.keep(d.To));
              }
              // Only overwrite archives if not already provided with localPath by client scan
              if (!modlist.archives || modlist.archives.length === 0) {
                modlist.archives = (modlistJson.Archives || modlistJson.archives || []).map((a) => ({
                  Hash: a.Hash || '', Name: a.Name || '', Size: a.Size || 0, State: a.State || {}, status: 'missing',
                }));
              }
              broadcastLog('info', `📋 Directives parsées : ${modlist.directives.length} directives, ${modlist.archives.length} archives`);
            } catch (parseErr) {
              broadcastLog('warn', `⚠ Impossible de parser modlist depuis zip : ${parseErr.message}`);
            }
          }
        } catch (zipErr) {
          broadcastLog('warn', `⚠ Impossible de charger le .wabbajack : ${zipErr.message}`);
          if (wabbajackTempPath && fs.existsSync(wabbajackTempPath)) {
            broadcastLog('warn', `  Taille : ${(fs.statSync(wabbajackTempPath).size / 1024).toFixed(0)} Ko — probablement pas un ZIP valide.`);
          }
        }
      } else if (!rawWabbajackRef) {
        broadcastLog('warn', `⚠ Aucune référence .wabbajack — les directives InlineFile seront ignorées.`);
        broadcastLog('warn', `  Chargez le .wabbajack via le bouton 📁 dans l'Inspecteur.`);
      }

      // ── MODE GALERIE : reconstruire archiveStatuses depuis le zip ────────────
      // En mode galerie, archives = [] à l'origine. Après chargement du
      // wabbajack, modlist.archives contient les vraies archives. On les
      // scanne dans DOWNLOADS pour savoir lesquelles sont présentes.
      if (modlist.archives && modlist.archives.length > 0 && archiveStatuses.length === 0) {
        broadcastLog('info', `🔄 Reconstruction de la liste des archives depuis le .wabbajack…`);
        archiveStatuses = modlist.archives.filter(notSkipped).map((arc) => ({ ...arc, Name: arc.Name || arc.name || '', status: 'missing', localPath: null }));
        archiveStatuses = resolveGameFiles(archiveStatuses);
        archiveStatuses = await verifyArchiveFiles(archiveStatuses);
        const ready2 = archiveStatuses.filter((a) => a.status === 'ready').length;
        const miss2  = archiveStatuses.filter((a) => a.status === 'missing').length;
        broadcastLog('info', `  → ${archiveStatuses.length} archives : ${ready2} présentes, ${miss2} manquantes.`);
      }

      // ── Analyse d'impact des archives manquantes ───────────────────────────
      // Pour chaque archive absente : nombre de fichiers de la modlist qui en
      // dépendent et mods concernés (dossier mods/<Nom>/…).
      const missingReport = archiveStatuses
        .filter((a) => a.status !== 'ready')
        .map((a) => ({ arc: a, files: 0, mods: new Map() }));
      if (missingReport.length > 0) {
        const byHash = new Map(missingReport.map((m) => [m.arc.Hash, m]));
        for (const d of (modlist.directives || [])) {
          const h = d.ArchiveHash || d.ArchiveHashPath?.[0];
          const m = h && byHash.get(h);
          if (!m) continue;
          m.files++;
          const parts = String(d.To || '').replace(/\\/g, '/').split('/');
          const mod = parts[0].toLowerCase() === 'mods' && parts[1] ? parts[1] : (parts.length > 1 ? parts[0] : '(racine)');
          m.mods.set(mod, (m.mods.get(mod) || 0) + 1);
        }
        // Annoncé AVANT le déploiement : aucune directive n'est sautée en silence.
        const lost = missingReport.reduce((s, m) => s + m.files, 0);
        broadcastLog('warn', `⚠ Avant déploiement : ${missingReport.length} archive(s) absente(s) ou incorrecte(s) — ${lost} fichier(s) de la modlist ne pourront pas être installés :`);
        for (const m of [...missingReport].sort((x, y) => y.files - x.files)) {
          const label = isGameFileArchive(m.arc) ? `${path.basename(gameFileRel(m.arc))} (fichier du jeu)` : m.arc.Name;
          if (m.arc.wrongVersion) broadcastLog('warn', `  • ${label} — mauvaise version — ${m.files} directive(s)`);
          else broadcastLog('warn', `  • ${label} — absente — ${m.files} directive(s)`);
        }
      }

      // ── ÉTAPE 4 : TRAITEMENT DES DIRECTIVES ──────────────────────────
      let directives = modlist.directives || [];
      setGameRootFolders(detectGameRootFolders(directives));
      const extraRoots = [...getGameRootFolders()].filter((g) => !KNOWN_GAME_ROOT_NAMES.includes(g));
      if (extraRoots.length) broadcastLog('info', `🎮 Dossier(s) de jeu de l'instance MO2 : ${extraRoots.join(', ')} → racine de l'installation.`);
      // Priorités MO2 : un même fichier fourni par plusieurs mods → le mod le plus prioritaire l'emporte
      if (selection && selection.priority.size > 0 && directives.length > 0) {
        const dd = dedupeByPriority(directives, (d) => resolveDirectivePath(d.To, cleanDest), selection.priority);
        directives = dd.directives;
        if (dd.removed > 0) broadcastLog('info', `⚖ Priorités MO2 : ${dd.removed} fichier(s) en conflit résolus (le mod le plus prioritaire l'emporte).`);
      }
      const installedDirectives = directives; // liste complète : instantané de fin d'installation
      if (updatePlan) {
        if (updatePlan.removed.length > 0) {
          const n = removeFiles(updatePlan.removed, cleanDest);
          broadcastLog('info', `🗑 ${n} fichier(s) retiré(s) de la liste supprimé(s).`);
        }
        directives = directives.filter((d) => !updatePlan.skip.has(String(d.To || '').replace(/\\/g, '/').toLowerCase()));
        broadcastLog('info', `🔄 Mise à jour : ${directives.length} directive(s) à traiter, ${installedDirectives.length - directives.length} fichier(s) inchangé(s) conservé(s).`);
      }
      let directivesProcessed = 0;
      let installCheck = null;

      if (directives.length > 0) {
        broadcastProgress({
          stage: 'extracting_files',
          stageName: 'Déploiement des directives (extraction sélective)',
          overallPercent: 40,
          processedItems: 0,
          totalItems: directives.length,
          currentTask: `Traitement de ${directives.length} directive(s) Wabbajack…`,
        });

        const result = await processDirectives({
          directives,
          archiveStatuses,
          destRoot: cleanDest,
          wabbajackZip,
          sevenZipBin,
          unarBin,
          texconvBin,
          signal,
          gamePath: gamePath || '',
          downloadsPath: downloadsPath || '',
          onProgress: (() => {
            const startTime = Date.now();
            const totalBytes = directives.reduce((s, d) => s + (d.Size || 0), 0);
            return (done, total, doneBytes = 0) => {
              directivesProcessed = done;
              const pct = 40 + Math.round((done / Math.max(1, total)) * 45);
              const elapsedSec = (Date.now() - startTime) / 1000;
              const speed = elapsedSec > 2 ? doneBytes / elapsedSec : 0;
              const remaining = speed > 0 ? (totalBytes - doneBytes) / speed : 0;
              broadcastProgress({
                overallPercent: Math.min(85, pct),
                processedItems: done,
                totalItems: total,
                processedBytes: doneBytes,
                totalBytes,
                speedBytesPerSec: Math.round(speed),
                etaSeconds: Math.round(remaining),
                currentTask: `Directive ${done}/${total} — ${path.basename((directives[done - 1]?.To || '?').replace(/\\/g, '/'))}`,
              });
            };
          })(),
        });

        broadcastLog('success', `✓ Directives : ${result.processed} traitée(s), ${result.skipped} ignorée(s), ${result.errors} erreur(s).`);
        directivesProcessed = result.processed;

        // ── Contrôle post-installation : chaque fichier mods/<mod>/… doit exister avec la bonne taille ──
        broadcastProgress({ stage: 'extracting_files', stageName: 'Contrôle de l\'installation', overallPercent: 86, currentTask: 'Contrôle des fichiers installés…' });
        try {
          const lostHashes = new Set(missingReport.map((m) => m.arc.Hash).filter(Boolean));
          // Fichiers des mods et du dossier du jeu de l'instance (« Game Root/ », « Stock Game/ »…)
          const rootFolders = new Set([...getGameRootFolders()].map((n) => n.toLowerCase()));
          const isGameRootOut = (to) => rootFolders.has(String(to || '').replace(/\\/g, '/').split('/')[0].toLowerCase());
          const toCheck = directives.filter((d) => (modOf(d.To) || isGameRootOut(d.To)) && !/Remapped/i.test(d.$type || ''));
          const chk = await verifyInstalledFiles(toCheck, (to) => resolveDirectivePath(to, cleanDest), {
            signal,
            onProgress: (done, total) => broadcastProgress({ currentTask: `Contrôle des fichiers installés : ${done}/${total}`, stagePercent: Math.round((done / Math.max(1, total)) * 100) }),
          });
          const archOf = new Map(toCheck.map((d) => [d.To, d.ArchiveHash]));
          const explained = chk.missing.filter((m) => lostHashes.has(archOf.get(m.to)));
          const unexplained = chk.missing.filter((m) => !lostHashes.has(archOf.get(m.to)));
          // Fichiers de mods désactivés présents malgré tout (installation précédente dans le même dossier…)
          const stray = await findStrayFiles(droppedDirectives, directives, (to) => resolveDirectivePath(to, cleanDest), { signal });
          installCheck = { checked: chk.checked, explained, unexplained, wrongSize: chk.wrongSize, stray };
          if (stray.length > 0) {
            const strayMods = [...new Set(stray.map((x) => x.mod))];
            broadcastLog('warn', `⚠ ${stray.length} fichier(s) de ${strayMods.length} mod(s) désactivé(s) présent(s) dans l'installation : ${strayMods.slice(0, 8).join(', ')}${strayMods.length > 8 ? '…' : ''}`);
            broadcastLog('warn', `  → Restes d'une installation précédente : videz le dossier d'installation avant de relancer (liste dans CONTROLE_INSTALLATION.txt).`);
          }
          const bad = unexplained.length + chk.wrongSize.length;
          broadcastLog(bad === 0 && explained.length === 0 ? 'success' : 'warn',
            `🔍 Contrôle : ${chk.checked} fichier(s) vérifié(s) — ${explained.length} absent(s) à cause d'archives manquantes, ${unexplained.length} autre(s) absent(s), ${chk.wrongSize.length} de taille différente.`);
          const byMod = new Map();
          for (const m of [...unexplained, ...chk.wrongSize]) byMod.set(m.mod, (byMod.get(m.mod) || 0) + 1);
          for (const [mod, n] of [...byMod.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) broadcastLog('warn', `  • ${mod} : ${n} fichier(s) absent(s) ou différent(s)`);
          if (byMod.size > 15) broadcastLog('warn', `  … et ${byMod.size - 15} autre(s) mod(s) — détail dans CONTROLE_INSTALLATION.txt`);
        } catch (e) {
          if (signal.aborted) throw e;
          broadcastLog('warn', `⚠ Contrôle post-installation impossible : ${String(e.message || e).slice(0, 160)}`);
        }
      } else if (updatePlan) {
        broadcastLog('success', `✓ Aucun fichier à mettre à jour : l'installation est déjà à jour.`);
      } else {
        broadcastLog('warn', `⚠ Aucune directive — installation plugins.txt seulement.`);
      }

      // ── Instantané de l'installation : base de comparaison des prochaines mises à jour ──
      if (manifestRaw && installedDirectives.length > 0) {
        broadcastProgress({ currentTask: 'Enregistrement de l\'état de l\'installation…' });
        try {
          const r = await writeSnapshot(cleanDest, {
            raw: manifestRaw, wabbajackPath: earlyFile || '', installed: installedDirectives,
            resolve: (d) => resolveDirectivePath(d.To, cleanDest), signal,
            options: { profile: selection?.profile || null, enable: options?.enable || [], choices: options?.choices || {} },
          });
          broadcastLog('success', `✓ État de l'installation enregistré (${r.files} fichier(s)) : base des prochaines mises à jour.`);
        } catch (e) {
          if (signal.aborted) throw e;
          broadcastLog('warn', `⚠ État de l'installation non enregistré : ${String(e.message || e).slice(0, 160)}`);
        }
      }

      // ── ÉTAPE 5 : plugins.txt & loadorder.txt ─────────────────────
      broadcastProgress({ stage: 'generating_mo2', stageName: 'Génération plugins.txt', overallPercent: 90, currentTask: 'Écriture des fichiers de configuration Skyrim...' });

      // Use the plugins.txt extracted from inline directives if available, otherwise reconstruct
      let pluginsContent = '';
      const pluginsTxtFile = path.join(cleanDest, 'plugins.txt');
      if (fs.existsSync(pluginsTxtFile)) {
        pluginsContent = fs.readFileSync(pluginsTxtFile, 'utf-8');
        broadcastLog('info', `📄 plugins.txt récupéré depuis les directives inline.`);
      } else {
        pluginsContent = modlist.pluginsTxt || '';
        if (!pluginsContent.trim()) {
          const cores = ['*Skyrim.esm', '*Update.esm', '*Dawnguard.esm', '*HearthFires.esm', '*Dragonborn.esm'];
          const extras = directives.map((d) => path.basename((d.To || '').replace(/\\/g, '/'))).filter((f) => /\.(esp|esm|esl)$/i.test(f)).filter((f, i, a) => a.indexOf(f) === i).map((f) => `*${f}`);
          pluginsContent = [...cores, ...extras.filter((p) => !cores.includes(p))].join('\n');
        }
      }

      // Plugins des mods optionnels non installés : retirés de plugins.txt
      if (selection && selection.pluginsExcluded.size > 0) {
        const lines = pluginsContent.split('\n');
        const kept = lines.filter((l) => !selection.pluginsExcluded.has(l.replace(/^\*/, '').trim().toLowerCase()));
        if (kept.length < lines.length) {
          broadcastLog('info', `ℹ ${lines.length - kept.length} plugin(s) de mods ignorés retirés de plugins.txt.`);
          pluginsContent = kept.join('\n');
        }
      }
      // Plugins des mods activés par l'utilisateur (options, autre famille d'interface…) :
      // absents ou inactifs dans le plugins.txt du profil → activés, ajoutés en fin de liste.
      if (selection && selection.pluginsAdded?.size > 0) {
        const lines = pluginsContent.split('\n');
        const seen = new Set();
        let added = 0;
        const next = lines.map((l) => {
          const key = l.replace(/^\*/, '').trim().toLowerCase();
          if (!selection.pluginsAdded.has(key)) return l;
          seen.add(key);
          if (l.startsWith('*')) return l;
          added++;
          return `*${l.trim()}`;
        });
        for (const [key, name] of selection.pluginsAdded) if (!seen.has(key)) { next.push(`*${name}`); added++; }
        if (added > 0) {
          broadcastLog('info', `ℹ ${added} plugin(s) de mods activés par vos choix ajoutés à plugins.txt.`);
          pluginsContent = next.join('\n');
        }
      }
      if (selection && selection.profileItems.length > 0) {
        const ml = renderModlistTxt(selection);
        fs.writeFileSync(path.join(cleanDest, 'modlist.txt'), ml.text, 'utf-8');
        broadcastLog('info', `📝 modlist.txt écrit (${ml.active} mod(s) actifs).`);
      }

      currentInstallJob.pluginsTxt = pluginsContent;
      const loadOrderContent = pluginsContent.split('\n').map((l) => l.replace(/^\*/, '')).filter((l) => l && !l.startsWith('#')).join('\n');
      const pluginCount = loadOrderContent.split('\n').filter(Boolean).length;

      fs.writeFileSync(path.join(cleanDest, 'plugins.txt'), pluginsContent, 'utf-8');
      fs.writeFileSync(path.join(cleanDest, 'loadorder.txt'), loadOrderContent, 'utf-8');

      const expected = (modlist.gameType || modlist.skyrimVersion || modlist.archives?.length) ? getExpectedSkyrimVersion(modlist.gameType, modlist.skyrimVersion, modlist.archives) : { label: 'Skyrim', versionHint: '?' };
      const readme = [
        `======================================================================`,
        ` mABBAJACK v3 — READY TO PLAY`,
        ` Modlist  : ${modlist.name} v${modlist.version || '?'}`,
        ` Jeu cible : ${expected.label} (${expected.versionHint})`,
        `======================================================================`,
        ``,
        `COMMENT UTILISER CET INSTALLATION :`,
        `  Ce dossier contient exactement les fichiers que l'auteur de la`,
        `  modlist a sélectionnés via FOMOD et Mod Organizer 2.`,
        `  Chaque fichier a été extrait précisément selon les directives`,
        `  du fichier .wabbajack (FromArchive, InlineFile, PatchedFromArchive).`,
        ``,
        `  1. Copiez le contenu de ce dossier dans votre Skyrim/Data/`,
        `  2. Copiez plugins.txt vers :`,
        `       ~/Library/Application Support/Skyrim Special Edition/plugins.txt`,
        `  3. Lancez SKSE64 (version ${expected.versionHint})`,
        ``,
        `STATISTIQUES :`,
        `  Archives téléchargées : ${downloadedCount}`,
        `  Directives traitées   : ${directivesProcessed} / ${directives.length}`,
        `  Plugins actifs        : ${pluginCount}`,
        `  Fichiers sources manquants : ${missingReport.length} (${missingReport.reduce((s, m) => s + m.files, 0)} fichier(s) de la modlist non installés)`,
        ...missingReport.map((m) => `    - ${isGameFileArchive(m.arc) ? `[JEU] ${expectedGameFilePath(m.arc, gamePath)}` : `[MOD] ${m.arc.Name}${m.arc.wrongVersion ? ' [MAUVAISE VERSION]' : ''}${(manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc)) ? ` — ${manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc)}` : ''}`} (${m.files} fichier(s))`),
        ...(installCheck ? [`  Contrôle des fichiers  : ${installCheck.checked} vérifiés, ${installCheck.explained.length + installCheck.unexplained.length} absents, ${installCheck.wrongSize.length} de taille différente, ${(installCheck.stray || []).length} de mods désactivés (voir CONTROLE_INSTALLATION.txt)`] : []),
        `  Généré le             : ${new Date().toLocaleString('fr-FR')}`,
        `======================================================================`,
      ].join('\n');
      fs.writeFileSync(path.join(cleanDest, 'README_READY_TO_PLAY.txt'), readme, 'utf-8');
      if (installCheck) {
        const sect = (title, rows) => rows.length ? [``, `${title} (${rows.length}) :`, ...rows] : [];
        fs.writeFileSync(path.join(cleanDest, 'CONTROLE_INSTALLATION.txt'), [
          `Contrôle de l'installation — ${modlist.name} v${modlist.version || '?'} — ${new Date().toLocaleString('fr-FR')}`,
          `Fichiers vérifiés : ${installCheck.checked}`,
          ...sect('ARCHIVES ABSENTES OU INCORRECTES', missingReport.map((m) => `  ${isGameFileArchive(m.arc) ? path.basename(gameFileRel(m.arc)) : m.arc.Name} — ${m.arc.wrongVersion ? `mauvaise version : ${describeWrongVersion(m.arc)}` : 'absente'} — ${m.files} directive(s)${archiveSourceUrl(m.arc) ? ` — ${archiveSourceUrl(m.arc)}` : ''}`)),
          ...sect('ABSENTS (archive manquante)', installCheck.explained.map((m) => `  ${m.to}`)),
          ...sect('ABSENTS (cause inconnue)', installCheck.unexplained.map((m) => `  ${m.to}`)),
          ...sect('TAILLE DIFFÉRENTE', installCheck.wrongSize.map((m) => `  ${m.to} — ${m.actual} o au lieu de ${m.expected} o`)),
          ...sect('FICHIERS DE MODS DÉSACTIVÉS (à supprimer)', (installCheck.stray || []).map((m) => `  ${m.path}  ← ${m.mod}`)),
        ].join('\n') + '\n', 'utf-8');
      }

      broadcastLog('success', `✓ plugins.txt (${pluginCount} plugins) écrit.`);
      broadcastLog('success', `✓ loadorder.txt et README créés.`);

      // Fichier repère : nom = version de Skyrim requise par la collection
      try {
        const verName = `${expected.label} ${expected.versionHint}`
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Skyrim';
        fs.writeFileSync(path.join(cleanDest, `${verName}.txt`), [
          `${expected.label} — version requise : ${expected.versionHint}`,
          `Collection : ${modlist.name} v${modlist.version || '?'}`,
        ].join('\n') + '\n', 'utf-8');
        broadcastLog('success', `✓ Fichier de version créé : ${verName}.txt`);
      } catch (e) {
        broadcastLog('warn', `⚠ Fichier de version non créé : ${String(e.message).slice(0, 120)}`);
      }

      // ── Nettoyage fichier .wabbajack temporaire ─────────────────────
      if (wabbajackTempPath) {
        try { fs.unlinkSync(wabbajackTempPath); } catch { /* ignore */ }
      }

      // ── TERMINÉ ────────────────────────────────────────────────────
      broadcastProgress({ stage: 'completed', stageName: 'Déploiement terminé !', overallPercent: 100, stagePercent: 100, processedItems: directives.length, totalItems: directives.length, currentTask: `✅ "${modlist.name}" prêt dans "${cleanDest}"`, speedBytesPerSec: 0, etaSeconds: 0, hasError: false, errorMessage: null });

      broadcastLog('success', `\n═══════════════════════════════════════════════════`);
      broadcastLog('success', `  🎉 Déploiement terminé — "${modlist.name}"`);
      broadcastLog('success', `  📁 ${cleanDest}`);
      if (missingReport.length > 0) {
        const lostFiles = missingReport.reduce((s, m) => s + m.files, 0);
        const hasGame = missingReport.some((m) => isGameFileArchive(m.arc));
        const hasMod = missingReport.some((m) => !isGameFileArchive(m.arc));
        broadcastLog('warn', ``);
        broadcastLog('warn', `⚠ ${missingReport.length} fichier(s) source introuvable(s) — ${lostFiles} fichier(s) de la modlist n'ont pas été installés :`);
        for (const m of missingReport) {
          const mods = [...m.mods.entries()].sort((x, y) => y[1] - x[1]);
          const modsTxt = mods.slice(0, 3).map(([n]) => `"${n}"`).join(', ') + (mods.length > 3 ? ` (+${mods.length - 3})` : '');
          if (isGameFileArchive(m.arc)) {
            broadcastLog('warn', `  • ${path.basename(gameFileRel(m.arc))} — fichier original du jeu (${m.arc.State?.Game || 'Skyrim'} ${m.arc.State?.GameVersion || ''})`.trimEnd());
            broadcastLog('warn', `      Emplacement attendu : ${expectedGameFilePath(m.arc, gamePath)}`);
          } else {
            if (m.arc.wrongVersion) broadcastLog('warn', `  • ${m.arc.Name} — mauvaise version : ${describeWrongVersion(m.arc)}`);
            else broadcastLog('warn', `  • ${m.arc.Name} — archive de mod`);
            const url = manualUrls.get(m.arc.Name) || archiveSourceUrl(m.arc);
            if (url) broadcastLog('warn', `      Téléchargement : ${url}`);
            else broadcastLog('warn', `      Téléchargement : source inconnue`);
          }
          if (m.files > 0) broadcastLog('warn', `      Impact : ${m.files} fichier(s) manquant(s) dans ${modsTxt}`);
          else broadcastLog('warn', `      Impact : aucun fichier de la modlist n'en dépend`);
        }
        if (lostFiles > 0) broadcastLog('warn', `  ℹ Conséquence : le jeu démarrera, mais les mods listés ci-dessus seront incomplets.`);
        if (hasGame) broadcastLog('warn', `  → Fichiers du jeu : indiquez le dossier du jeu (celui qui contient Data/) dans « Dossier du jeu Skyrim », puis relancez le déploiement.`);
        if (hasMod && missingReport.some((m) => m.arc.wrongVersion)) broadcastLog('warn', `  → Archives de mods : téléchargez-les, placez-les sous leur nom exact dans le dossier dédié à la liste ${dedicatedDir} (prioritaire sur le cache commun), puis relancez le déploiement.`);
        else if (hasMod) broadcastLog('warn', `  → Archives de mods : téléchargez-les, placez-les dans ${cleanDownloads} sous leur nom exact, puis relancez le déploiement.`);
      }
      broadcastLog('success', `═══════════════════════════════════════════════════`);
      currentInstallJob.active = false;
      notifyMac(uiLanguage, 'done', modlist.name);

    } catch (err) {
      const msg = err.message || String(err);
      // Nettoyage du fichier .wabbajack temporaire même en cas d'erreur
      if (wabbajackTempPath) {
        try { fs.unlinkSync(wabbajackTempPath); } catch { /* ignore */ }
      }
      if (signal.aborted) {
        broadcastProgress({ stage: 'idle', stageName: 'Annulé', overallPercent: 0, hasError: false, currentTask: 'Annulé.' });
        broadcastLog('warn', '⛔ Annulé.');
      } else {
        broadcastProgress({ stage: 'error', stageName: "Erreur d'installation", overallPercent: currentInstallJob.progress.overallPercent || 5, hasError: true, errorMessage: msg, currentTask: `Échec : ${msg}` });
        broadcastLog('error', `❌ ${msg}`);
        writeLog({ level: 'debug', message: 'Pile de l\'erreur fatale', details: err?.stack || null });
        notifyMac(uiLanguage, 'failed', modlist.name);
      }
      currentInstallJob.active = false;
    } finally {
      if (currentInstallJob.abortController === abortController) {
        jobControl.paused = false;
        jobControl.cancel();
      }
      writeLog({ level: 'debug', message: `Fin du job d'installation — étape finale : ${currentInstallJob.progress?.stage}` });
      endInstallLog();
    }
  })();
}
