/**
 * État et actions de mABBAJACK, partagés par les deux présentations (Simple et Expert) :
 * catalogue, modlist chargée, dossiers, compte Nexus, analyse de DOWNLOADS, installation et journal.
 * Les écrans ne gardent que leur navigation ; ils suivent les étapes par subscribe() (événements).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ParsedWabbajackFile,
  GalleryModlist,
  NexusAccount,
  InstallOptions,
  UpdateRequest,
  InstallProgress,
  LogEntry,
  ModlistArchive,
} from '../types/wabbajack';
import { getApiBaseUrl, locateWabbajack, pickNativeFile, openFolderInFinder, uploadWabbajack, scanDownloads, ScanProgress } from '../services/api';
import { loadNexusKey, storeNexusKey } from '../services/nexusKey';
import { ImportProgressState } from '../components/ImportProgress';
import { sendClientLog } from '../services/clientLog';
import { useI18n } from '../locales';
import { APP_UI } from '../locales/uiScreens';
import { translateLog } from '../locales/logCatalog';
import { PHOENIX_DEMO_MODLIST } from './demoModlist';

/** Étapes signalées aux écrans : modlist analysée, installation lancée, lancement refusé. */
export type MabbajackEvent = 'loaded' | 'installStarted' | 'installFailed';

export const DEFAULT_PROGRESS: InstallProgress = {
  stage: 'idle',
  stageName: 'En attente',
  overallPercent: 0,
  stagePercent: 0,
  currentTask: 'Prêt pour l’installation', // i18n-ignore : source FR traduite par logCatalog
  processedItems: 0,
  totalItems: 0,
  processedBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
  etaSeconds: 0,
  activeDownloads: 0,
  missingArchivesCount: 0,
  isPaused: false,
  hasError: false,
};

function useMabbajackState() {
  const listenersRef = useRef(new Set<(e: MabbajackEvent) => void>());
  const emit = useCallback((e: MabbajackEvent) => { listenersRef.current.forEach((fn) => fn(e)); }, []);
  const subscribe = useCallback((fn: (e: MabbajackEvent) => void) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  const { language } = useI18n();
  // Référence stable pour les callbacks mémorisés (évite de les recréer à chaque changement de langue)
  const langRef = useRef(language);
  langRef.current = language;


  // Modlist & Inspection
  const [galleryModlists, setGalleryModlists] = useState<GalleryModlist[]>([]);
  const [isLoadingModlists, setIsLoadingModlists] = useState(false);
  const [parsedFile, setParsedFile] = useState<ParsedWabbajackFile | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  // Mods optionnels choisis (profil + mods désactivés par défaut à installer)
  const [installOptions, setInstallOptions] = useState<InstallOptions>({ enable: [] });
  // Mise à jour d'une installation existante de la liste (null = installation complète)
  const [updateRequest, setUpdateRequest] = useState<UpdateRequest | null>(null);

  // Configuration Paths (strictly 2 directories: DOWNLOADS and READY TO PLAY)
  const [downloadsPath, setDownloadsPath] = useState<string>(() => {
    return localStorage.getItem('mabbajack_downloads_path') || '';
  });
  const [destPath, setDestPath] = useState<string>(() => {
    return localStorage.getItem('mabbajack_dest_path') || '';
  });
  // Dossier du jeu (contient Data/) — source des fichiers originaux (GameFileSource)
  const [gamePath, setGamePath] = useState<string>(() => {
    return localStorage.getItem('mabbajack_game_path') || '';
  });
  const [concurrency, setConcurrency] = useState<number>(() => {
    const c = localStorage.getItem('mabbajack_concurrency');
    return c ? parseInt(c, 10) : 4;
  });

  // Nexus Status
  const [nexusApiKey, setNexusApiKey] = useState<string>('');
  const [nexusAccount, setNexusAccount] = useState<NexusAccount | null>(null);

  // Installation & Tracking
  const [progress, setProgress] = useState<InstallProgress>(DEFAULT_PROGRESS);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'log-init',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: 'mABBAJACK Initialisé - Moteur macOS prêt', // i18n-ignore : traduit par logCatalog
    },
  ]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);


  const eventSourceRef = useRef<EventSource | null>(null);

  // appendLog : affichage seul (entrées venant du serveur, déjà écrites dans le fichier journal)
  const appendLog = useCallback((level: LogEntry['level'], message: string, details?: string) => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      details,
    };
    setLogs((prev) => [...prev.slice(-200), entry]);
  }, []);

  // addLog : affichage + enregistrement dans logs/mabbajack.log
  const addLog = useCallback((level: LogEntry['level'], message: string, details?: string) => {
    appendLog(level, message, details);
    sendClientLog(level, message, details);
  }, [appendLog]);

  // 2. Fetch modlists — local server first (4s timeout) then full GitHub aggregation
  const fetchModlists = useCallback(async () => {
    setIsLoadingModlists(true);
    addLog('info', 'Récupération du catalogue Wabbajack…');

    async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try { const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(t); return r; }
      catch (e) { clearTimeout(t); throw e; }
    }

    function classifyVersion(m: any): string {
      const game = (m.game || '').toLowerCase().replace(/[\s_-]/g, '');
      if (!game.startsWith('skyrim') && game !== 'skyrim') return 'other';
      if (game.includes('vr')) return 'vr';
      if (game === 'skyrimanniversaryedition' || game === 'skyrimae') return 'ae';
      const tags = (m.tags || []).map((t: string) => t.toLowerCase().trim().replace(/\s+/g, ''));
      const AE_TAGS = ['ae','1.6','1.6.x','1.6.353','1.6.640','1.6.1130','nextgen','nextgenupdate','post-aeupdate','postaeupdate','anniversaryedition','creationclub'];
      const SE_TAGS = ['1.5','1.5.97','1.5.x','se'];
      const hasAE = tags.some((t: string) => AE_TAGS.includes(t));
      const hasSE = tags.some((t: string) => SE_TAGS.includes(t));
      if (hasAE && !hasSE) return 'ae';
      if (hasSE && !hasAE) return 'se';
      const txt = ((m.title || '') + ' ' + (m.description || '')).toLowerCase();
      const aeScore = [/\b1\.6\.\d/, /next[\s-]?gen update/, /anniversary edition/, /\bae\b/, /creation club/].filter((p: RegExp) => p.test(txt)).length;
      const seScore = [/\b1\.5\.97\b/, /\b1\.5\b/, /pre[\s-]?ae/].filter((p: RegExp) => p.test(txt)).length;
      if (aeScore > seScore) return 'ae';
      if (seScore > aeScore) return 'se';
      const ver = (m.version || '').trim();
      if (/^1\.6/.test(ver)) return 'ae';
      if (/^1\.5/.test(ver)) return 'se';
      return 'se';
    }

    // Step 1: local Express server (fast, pre-classified, cached)
    try {
      const res = await fetchWithTimeout(`${getApiBaseUrl()}/api/modlists`, 4000);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 20) {
          setGalleryModlists(data);
          addLog('success', `${data.length} modlists chargées depuis le serveur local.`);
          setIsLoadingModlists(false);
          return;
        }
      }
    } catch { /* server not ready, fall through */ }

    // Step 2: aggregate all repos directly from GitHub
    addLog('info', 'Serveur local indisponible — agrégation directe depuis GitHub…');
    try {
      const reposRes = await fetchWithTimeout('https://raw.githubusercontent.com/wabbajack-tools/mod-lists/master/repositories.json', 10000);
      if (!reposRes.ok) throw new Error(`HTTP ${reposRes.status}`);
      const repos: Record<string, string> = await reposRes.json();
      const repoUrls = Object.values(repos);
      const results = await Promise.allSettled(
        repoUrls.map((url) => fetchWithTimeout(url, 8000).then((r) => r.ok ? r.json() : Promise.reject()))
      );
      const all: any[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
      }
      const seen = new Set<string>();
      const deduped = all.filter((m) => {
        const key = m.links?.machineURL || m.links?.download || (m.title + m.author);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const enriched = deduped.map((m) => ({ ...m, skyrimVersion: classifyVersion(m) }));
      if (enriched.length > 0) {
        setGalleryModlists(enriched);
        addLog('success', `${enriched.length} modlists agrégées depuis GitHub (${repoUrls.length} dépôts).`);
        setIsLoadingModlists(false);
        return;
      }
    } catch (err: any) {
      addLog('warn', `GitHub inaccessible : ${err.message}`);
    }

    // Step 3: featured list only (18 entries) as last resort
    try {
      const featRes = await fetchWithTimeout('https://raw.githubusercontent.com/wabbajack-tools/mod-lists/master/modlists.json', 8000);
      if (featRes.ok) {
        const featured = await featRes.json();
        setGalleryModlists(featured.map((m: any) => ({ ...m, skyrimVersion: classifyVersion(m) })));
        addLog('warn', `Catalogue partiel : ${featured.length} modlists officielles seulement.`);
        setIsLoadingModlists(false);
        return;
      }
    } catch { /* fully offline */ }

    addLog('error', 'Impossible de charger le catalogue. Vérifiez votre connexion internet.');
    setGalleryModlists([]);
    setIsLoadingModlists(false);
  }, [addLog]);



  // 3. Verify Nexus / Vortex API Key
  const handleVerifyNexusKey = useCallback(
    async (key: string): Promise<NexusAccount> => {
      addLog('info', 'Validation de la clé API Nexus Mods / Vortex...');
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/nexus/check-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (res.ok) {
          const acc: NexusAccount = await res.json();
          setNexusAccount(acc);
          if (acc.valid) {
            addLog('success', `Compte Nexus vérifié : ${acc.name} (${acc.isPremium ? 'Premium ⭐' : 'Standard'})`);
          } else if (acc.offline) {
            addLog('warn', 'Nexus injoignable : clé non vérifiée.');
          } else {
            addLog('warn', 'Clé API Nexus invalide.');
          }
          return acc;
        }
      } catch {
        // Serveur local injoignable : statut inconnu
      }

      const acc: NexusAccount = { valid: false, offline: true };
      setNexusAccount(acc);
      addLog('warn', 'Nexus injoignable : clé non vérifiée.');
      return acc;
    },
    [addLog]
  );

  // 4. Analyse d'un .wabbajack local par son chemin : le serveur lit le fichier sur place
  // (aucun transfert HTTP, et localFilePath reste le vrai chemin, utile au dossier dédié à la liste).
  const inspectWabbajackPath = useCallback(async (filePath: string) => {
    try {
      setIsInspecting(true);
      const base = filePath.split('/').pop() || filePath;
      setImportProgress({ fileName: base, phase: 'analyze', sent: 0, total: 0, startedAt: Date.now() });
      addLog('info', `Inspection directe de : ${filePath}...`);
      const inspectRes = await fetch(`${getApiBaseUrl()}/api/wabbajack/inspect-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (inspectRes.ok) {
        const parsed = await inspectRes.json();
        setParsedFile(parsed);
        emit('loaded');
        addLog('success', `Modlist "${parsed.name}" analysée : ${parsed.numberOfArchives} archives.`);
        return;
      }
      const err = await inspectRes.json().catch(() => ({ error: `HTTP ${inspectRes.status}` }));
      addLog('error', `Erreur lors de l'analyse du fichier .wabbajack : ${err.error || inspectRes.status}`);
      alert(`${APP_UI[langRef.current].analysisError} ${translateLog(String(err.error || inspectRes.status), langRef.current)}`);
    } catch (err: any) {
      addLog('error', `Erreur lors de l'analyse du fichier .wabbajack : ${err.message}`);
    } finally {
      setIsInspecting(false);
      setImportProgress(null);
    }
  }, [addLog]);

  // Native File Picker for .wabbajack on macOS
  const handlePickNativeWabbajackFile = useCallback(async () => {
    try {
      const fileRes = await pickNativeFile(APP_UI[langRef.current].pickFileTitle);
      if (fileRes.path) await inspectWabbajackPath(fileRes.path);
    } catch (err: any) {
      addLog('warn', `Erreur dialogue natif : ${err.message}`);
    }
  }, [addLog, inspectWabbajackPath]);

  // Glisser-déposer dans l'app native : python_app/mabbajack_app.py transmet le vrai chemin
  // du fichier déposé (window.mabbajackDroppedPath), ce que l'API File du navigateur ne donne pas.
  const droppedPathRef = useRef<{ path: string; at: number } | null>(null);
  const lastDropRef = useRef<{ key: string; at: number } | null>(null);
  const droppedWaiterRef = useRef<((p: string) => void) | null>(null);
  useEffect(() => {
    const w = window as unknown as { mabbajackDroppedPath?: (p: string) => void };
    w.mabbajackDroppedPath = (p: string) => {
      droppedPathRef.current = { path: p, at: Date.now() };
      droppedWaiterRef.current?.(p);
    };
    return () => { delete w.mabbajackDroppedPath; };
  }, []);
  const waitDroppedPath = useCallback((fileName: string): Promise<string | null> => {
    if (!(window as unknown as { pywebview?: unknown }).pywebview) return Promise.resolve(null);
    const matches = (p: string) => p.split('/').pop() === fileName;
    const recent = droppedPathRef.current;
    if (recent && Date.now() - recent.at < 5000 && matches(recent.path)) return Promise.resolve(recent.path);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { droppedWaiterRef.current = null; resolve(null); }, 1500);
      droppedWaiterRef.current = (p) => {
        if (!matches(p)) return;
        clearTimeout(timer); droppedWaiterRef.current = null; resolve(p);
      };
    });
  }, []);


  // 5. Load .wabbajack via browser file input — upload to server for parsing
  // (The browser File API never exposes the real filesystem path, so we upload
  //  the bytes to the server which saves to a temp file, parses, and returns
  //  the parsed object WITH localFilePath so real installation is possible.)
  const handleLoadWabbajackFile = useCallback(
    async (file: File) => {
      // Le dépôt est capté à la fois par l'écouteur global et par l'Inspecteur : un seul traitement.
      const key = `${file.name}:${file.size}`;
      if (lastDropRef.current && lastDropRef.current.key === key && Date.now() - lastDropRef.current.at < 3000) return;
      lastDropRef.current = { key, at: Date.now() };
      // Chemin réel : fourni par l'app native au dépôt, sinon retrouvé par le serveur (nom + taille).
      // Évite d'envoyer plusieurs Go par HTTP et garde le dossier du .wabbajack (dossier dédié à la liste).
      let nativePath = await waitDroppedPath(file.name);
      if (!nativePath && /\.wabbajack$/i.test(file.name)) {
        setIsInspecting(true);
        setImportProgress({ fileName: file.name, phase: 'analyze', sent: 0, total: 0, startedAt: Date.now() });
        nativePath = await locateWabbajack(file.name, file.size);
      }
      if (nativePath) { await inspectWabbajackPath(nativePath); return; }
      setIsInspecting(true);
      const startedAt = Date.now();
      setImportProgress({ fileName: file.name, phase: 'upload', sent: 0, total: file.size, startedAt });
      addLog('info', `Envoi au serveur pour analyse : ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} Mo)...`);
      try {
        const parsed = await uploadWabbajack<ParsedWabbajackFile>(
          file,
          (sent, total) => setImportProgress({ fileName: file.name, phase: 'upload', sent, total, startedAt }),
          () => setImportProgress({ fileName: file.name, phase: 'analyze', sent: file.size, total: file.size, startedAt }),
        );
        if (!parsed.name) throw new Error('Réponse serveur invalide'); // i18n-ignore : traduit par logCatalog

        setParsedFile(parsed);
        emit('loaded');
        addLog('success', `Modlist "${parsed.name}" analysée : ${parsed.numberOfArchives} archives, ${parsed.loadOrder?.length ?? 0} plugins.`);
        if (parsed.localFilePath) {
          addLog('info', `Fichier réel : ${parsed.localFilePath}`);
        }
      } catch (err: any) {
        addLog('error', `Erreur lors de l'analyse du fichier .wabbajack : ${err.message}`);
        alert(`${APP_UI[langRef.current].analysisError} ${translateLog(err.message, langRef.current)}`);
      } finally {
        setIsInspecting(false);
        setImportProgress(null);
      }
    },
    [addLog, waitDroppedPath, inspectWabbajackPath]
  );

  // 6. Load Demo Phoenix Modlist
  const handleLoadDemoModlist = useCallback(() => {
    setIsInspecting(true);
    setTimeout(() => {
      setParsedFile(PHOENIX_DEMO_MODLIST);
      setIsInspecting(false);
      emit('loaded');
      addLog('success', `Modlist de démonstration "${PHOENIX_DEMO_MODLIST.name}" chargée avec succès.`);
    }, 400);
  }, [addLog]);

  // 7. Scan downloads directory for archives
  const handleScanDownloads = useCallback(async () => {
    if (!parsedFile || !downloadsPath) return;
    // Un nouveau scan annule le précédent (changement de dossier pendant un scan en cours)
    scanAbortRef.current?.abort();
    const ctrl = new AbortController();
    scanAbortRef.current = ctrl;

    setIsScanning(true);
    setScanProgress({ phase: 'list', done: 0, total: 0 });
    addLog('info', `🔄 Scan DOWNLOADS : ${downloadsPath}...`);

    try {
      const data = await scanDownloads(
        { downloadsPath, gamePath, archives: parsedFile.archives },
        (p) => { if (!ctrl.signal.aborted) setScanProgress(p); },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;

      setParsedFile((prev) => {
        if (!prev) return null;
        return { ...prev, archives: data.archives };
      });
      const modArchives = data.archives.filter((a: ModlistArchive) => a.sourceKind !== 'game');
      const ready = modArchives.filter((a: ModlistArchive) => a.status === 'ready').length;
      if (ready > 0) {
        addLog('success', `✓ ${ready}/${modArchives.length} archives détectées dans DOWNLOADS.`);
      } else if (modArchives.length > 0) {
        addLog('warn', `⚠ Aucune archive trouvée dans ${downloadsPath}. Vérifiez le chemin.`);
      }
      if (data.sizeMismatches && data.sizeMismatches > 0) {
        addLog('warn', `⚠ ${data.sizeMismatches} archive(s) présente(s) mais de taille différente (incomplète ou autre version) : à retélécharger.`);
      }
      const gf = data.gameFiles;
      if (gf && gf.total > 0 && gf.found > 0) {
        addLog('success', `🎮 ${gf.found}/${gf.total} fichiers originaux du jeu identifiés dans ${gf.dirs.join(', ')} — copiés tels quels, sans décompression.`);
      }
      const missingGame = data.archives.filter((a: ModlistArchive) => a.status !== 'ready' && a.sourceKind === 'game');
      if (missingGame.length > 0) {
        addLog('warn', `⚠ ${missingGame.length} fichier(s) original(aux) du jeu introuvable(s) : ${missingGame.map((a: ModlistArchive) => a.Name).join(', ')}`);
        addLog('warn', `  → Renseignez « Dossier du jeu Skyrim » (dossier contenant Data/).`);
      }
    } catch (err: any) {
      if (ctrl.signal.aborted) return; // remplacé par un scan plus récent
      addLog('warn', `Scan impossible : ${err.message}`);
    } finally {
      if (scanAbortRef.current === ctrl) {
        scanAbortRef.current = null;
        setIsScanning(false);
        setScanProgress(null);
      }
    }
  }, [parsedFile, downloadsPath, gamePath, addLog]);

  // Auto-scan whenever parsedFile, downloadsPath or gamePath changes
  useEffect(() => {
    if (parsedFile && downloadsPath) {
      handleScanDownloads();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFile?.name, downloadsPath, gamePath]);

  // 8. Start Installation Process (NO BLOCKING GAME CHECK)
  const handleStartInstall = useCallback(async () => {
    if (!parsedFile) {
      alert(APP_UI[langRef.current].loadModlistFirst);
      return;
    }
    if (!destPath) {
      alert(APP_UI[langRef.current].setDestFirst);
      return;
    }

    emit('installStarted');
    addLog('info', `Démarrage de l'installation Ready to Play pour "${parsedFile.name}"...`);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/install/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modlist: {
            name: parsedFile.name,
            version: parsedFile.version,
            author: parsedFile.author,
            gameType: parsedFile.gameType,
            skyrimVersion: parsedFile.skyrimVersion,
            links: parsedFile.links,
            totalArchiveSize: parsedFile.totalArchiveSize,
            totalInstalledSize: parsedFile.totalInstalledSize,
            numberOfArchives: parsedFile.numberOfArchives,
            numberOfDirectives: parsedFile.numberOfDirectives,
            archives: parsedFile.archives,       // includes localPath from scan (~1MB, needed)
            // directives intentionally NOT sent — server re-parses from localFilePath (~100MB saved)
            pluginsTxt: parsedFile.pluginsTxt,
            // ⚠️ CRITICAL: needed for InlineFile + PatchedFromArchive directives
            localFilePath: parsedFile.localFilePath,
          },
          downloadsPath,
          destPath,
          gamePath,
          nexusApiKey,
          uiLanguage: language,
          options: { ...installOptions, update: updateRequest || undefined },
        }),
      });

      if (res.ok) {
        addLog('success', 'Installation initiée côté serveur avec succès.');
        if (eventSourceRef.current) eventSourceRef.current.close();
        const sse = new EventSource(`${getApiBaseUrl()}/api/install/stream`);
        eventSourceRef.current = sse;
        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'progress') setProgress(data.progress);
            else if (data.type === 'log') appendLog(data.log.level, data.log.message, data.log.details);
          } catch { /* ignore */ }
        };
        sse.onerror = () => { sse.close(); };
        return;
      }

      // Non-OK HTTP response from server
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      addLog('error', `Serveur HTTP ${res.status} : ${errBody.error || JSON.stringify(errBody)}`);
      emit('installFailed');
    } catch (err: any) {
      addLog('error', `Erreur réseau : ${err.message || err}`);
      emit('installFailed');
    }
  }, [parsedFile, downloadsPath, destPath, gamePath, nexusApiKey, installOptions, updateRequest, addLog, language]);





  // Dossier où mABBAJACK range les fichiers reçus par les liens nxm:// de Nexus
  useEffect(() => {
    if (!downloadsPath) return;
    fetch(`${getApiBaseUrl()}/api/nexus/nxm-target`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadsPath }),
    }).catch(() => { /* serveur pas encore prêt : réessayé au prochain changement */ });
  }, [downloadsPath]);

  // Initialize data on mount
  useEffect(() => {
    fetchModlists();
    loadNexusKey().then((k) => {
      if (!k) return;
      setNexusApiKey(k);
      handleVerifyNexusKey(k);
    });
  }, []);

  // Dossiers et clé : chaque changement est mémorisé
  const persist = (key: string, set: (v: string) => void) => (v: string) => { set(v); localStorage.setItem(key, v); };
  const saveDownloadsPath = useCallback(persist('mabbajack_downloads_path', setDownloadsPath), []);
  const saveDestPath = useCallback(persist('mabbajack_dest_path', setDestPath), []);
  const saveGamePath = useCallback(persist('mabbajack_game_path', setGamePath), []);
  const saveConcurrency = useCallback((c: number) => {
    setConcurrency(c);
    localStorage.setItem('mabbajack_concurrency', c.toString());
  }, []);
  const saveNexusApiKey = useCallback((k: string) => { setNexusApiKey(k); storeNexusKey(k); }, []);

  // Commandes de l'installation en cours
  const pauseInstall = useCallback(() => {
    setProgress((p) => ({ ...p, isPaused: true, stage: 'paused' }));
    addLog('warn', 'Installation mise en pause.');
    fetch(`${getApiBaseUrl()}/api/install/pause`, { method: 'POST' })
      .catch((e) => addLog('error', `Pause impossible : ${e?.message || e}`));
  }, [addLog]);
  const resumeInstall = useCallback(() => {
    setProgress((p) => ({ ...p, isPaused: false, stage: 'extracting_files' }));
    addLog('info', 'Installation reprise.');
    fetch(`${getApiBaseUrl()}/api/install/resume`, { method: 'POST' })
      .catch((e) => addLog('error', `Reprise impossible : ${e?.message || e}`));
  }, [addLog]);
  const cancelInstall = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
    addLog('warn', 'Installation annulée par l’utilisateur.');
    fetch(`${getApiBaseUrl()}/api/install/cancel`, { method: 'POST' })
      .catch((e) => addLog('error', `Annulation impossible : ${e?.message || e}`));
  }, [addLog]);
  const clearLogs = useCallback(() => setLogs([]), []);
  const openDestFolder = useCallback(() => {
    openFolderInFinder(destPath).then((ok) => {
      if (!ok) alert(`${APP_UI[langRef.current].destFolderAlert}\n${destPath}`);
    });
  }, [destPath]);

  return {
    subscribe,
    // catalogue
    galleryModlists, isLoadingModlists, fetchModlists,
    // modlist chargée
    parsedFile, isInspecting, importProgress,
    loadWabbajackFile: handleLoadWabbajackFile, inspectWabbajackPath, pickNativeWabbajackFile: handlePickNativeWabbajackFile,
    loadDemoModlist: handleLoadDemoModlist,
    installOptions, setInstallOptions, updateRequest, setUpdateRequest,
    // dossiers et réglages
    downloadsPath, setDownloadsPath: saveDownloadsPath, destPath, setDestPath: saveDestPath,
    gamePath, setGamePath: saveGamePath, concurrency, setConcurrency: saveConcurrency,
    // Nexus
    nexusApiKey, setNexusApiKey: saveNexusApiKey, nexusAccount, verifyNexusKey: handleVerifyNexusKey,
    // DOWNLOADS
    isScanning, scanProgress, scanDownloads: handleScanDownloads,
    // installation et journal
    progress, logs, addLog, startInstall: handleStartInstall,
    pauseInstall, resumeInstall, cancelInstall, clearLogs, openDestFolder,
  };
}

export type Mabbajack = ReturnType<typeof useMabbajackState>;

const MabbajackContext = createContext<Mabbajack | null>(null);

export const MabbajackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MabbajackContext.Provider value={useMabbajackState()}>{children}</MabbajackContext.Provider>
);

export function useMabbajack(): Mabbajack {
  const ctx = useContext(MabbajackContext);
  if (!ctx) throw new Error('useMabbajack must be used within a MabbajackProvider');
  return ctx;
}

/** Abonnement d'un écran aux étapes (ex. Expert : analyse terminée → onglet Inspecteur). */
export function useMabbajackEvents(handler: (e: MabbajackEvent) => void): void {
  const { subscribe } = useMabbajack();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
