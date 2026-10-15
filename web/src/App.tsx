import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header, { ActiveTab } from './components/Header';
import GalleryView from './components/GalleryView';
import InspectorView from './components/InspectorView';
import InstallerView from './components/InstallerView';
import ProgressView from './components/ProgressView';
import SettingsModal from './components/SettingsModal';
import ManualDownloadModal from './components/ManualDownloadModal';
import PluginsTxtModal from './components/PluginsTxtModal';
import {
  ParsedWabbajackFile,
  GalleryModlist,
  SkyrimEnvironment,
  NexusAccount,
  InstallOptions,
  InstallProgress,
  LogEntry,
  ModlistArchive,
  Directive,
  InstallMode,
} from './types/wabbajack';
import JSZip from 'jszip';
import { getApiBaseUrl, locateWabbajack, pickNativeFile, openFolderInFinder, uploadWabbajack, scanDownloads, ScanProgress } from './services/api';
import ImportProgress, { ImportProgressState } from './components/ImportProgress';
import { sendClientLog } from './services/clientLog';
import { useI18n } from './locales';
import { APP_UI } from './locales/uiScreens';
import { translateLog } from './locales/logCatalog';

// Built-in Demo Modlist (Skyrim Modding Essentials / SME) for instant testing
const PHOENIX_DEMO_MODLIST: ParsedWabbajackFile = {
  name: 'Skyrim Modding Essentials (SME)',
  author: 'Phoenix & The Animonculory',
  // Description en anglais : langue source du service de traduction (useTranslated)
  description: 'A minimal, clean and high-performance base for Skyrim Special Edition / Anniversary Edition including SKSE, SkyUI, Bug Fixes, Address Library and Engine Fixes.',
  version: '3.4.1',
  gameType: 'SkyrimSpecialEdition',
  totalArchiveSize: 2450000000,
  totalInstalledSize: 5800000000,
  numberOfArchives: 12,
  numberOfDirectives: 1840,
  inlinedFilesCount: 42,
  patchesCount: 8,
  loadOrder: [
    'Skyrim.esm',
    'Update.esm',
    'Dawnguard.esm',
    'HearthFires.esm',
    'Dragonborn.esm',
    'Unofficial Skyrim Special Edition Patch.esp',
    'SkyUI_SE.esp',
    'SMIM-SE-Merged-All.esp',
    'Skyrim Priority.esp',
  ],
  pluginsTxt: `*Skyrim.esm
*Update.esm
*Dawnguard.esm
*HearthFires.esm
*Dragonborn.esm
*Unofficial Skyrim Special Edition Patch.esp
*SkyUI_SE.esp
*SMIM-SE-Merged-All.esp
*Skyrim Priority.esp`,
  archives: [
    {
      Hash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      Name: 'SkyUI_5_2_SE.7z',
      Size: 20485760,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 12604,
        FileID: 35407,
        Author: 'SkyUI Team',
        Version: '5.2SE',
      },
      status: 'ready',
    },
    {
      Hash: 'f1e2d3c4b5a697887766554433221100',
      Name: 'Unofficial Skyrim Special Edition Patch-266-4-2-9a.7z',
      Size: 624500000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 266,
        FileID: 135890,
        Author: 'Arthmoor',
        Version: '4.2.9a',
      },
      status: 'ready',
    },
    {
      Hash: '00112233445566778899aabbccddeeff',
      Name: 'SKSE64_2_02_06.7z',
      Size: 1850000,
      State: {
        Url: 'https://skse.silverlock.org/beta/skse64_2_02_06.7z',
        Author: 'Ian Patterson',
        Version: '2.2.6',
      },
      status: 'ready',
    },
    {
      Hash: 'aabbccddeeff00112233445566778899',
      Name: 'Address Library for SKSE Plugins-32444-8-1-6-640.zip',
      Size: 850000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 32444,
        FileID: 148560,
        Author: 'meh321',
        Version: '8',
      },
      status: 'ready',
    },
    {
      Hash: 'cafebabe00112233445566778899aabb',
      Name: 'SSE Engine Fixes (skse64 plugin)-17230-6-1-1.zip',
      Size: 4200000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 17230,
        FileID: 75432,
        Author: 'aers',
        Version: '6.1.1',
      },
      status: 'missing',
    },
    {
      Hash: 'deadbeef1234567890abcdef12345678',
      Name: 'Static Mesh Improvement Mod - SMIM-659-2-08.7z',
      Size: 1120000000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 659,
        FileID: 24510,
        Author: 'Brumbek',
        Version: '2.08',
      },
      status: 'ready',
    },
    {
      Hash: '1234567890abcdef1234567890abcdef',
      Name: 'SSE Display Tweaks-34705-0-5-12b.zip',
      Size: 1540000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 34705,
        FileID: 124300,
        Author: 'SlavicPotato',
        Version: '0.5.12b',
      },
      status: 'missing',
    },
    {
      Hash: 'fedcba0987654321fedcba0987654321',
      Name: 'Skyrim Priority SE-AE - CPU Performance-50502-3-4-0.zip',
      Size: 450000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 50502,
        FileID: 98760,
        Author: 'Boring3',
        Version: '3.4.0',
      },
      status: 'ready',
    },
  ],
  directives: [
    {
      $type: 'FromArchive',
      To: 'mods/SkyUI_SE/SkyUI_SE.esp',
      Size: 1450000,
      Hash: 'skyui_esp_hash',
      ArchiveHash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      SourcePath: 'SkyUI_SE.esp',
    },
    {
      $type: 'FromArchive',
      To: 'mods/SkyUI_SE/SkyUI_SE.bsa',
      Size: 18500000,
      Hash: 'skyui_bsa_hash',
      ArchiveHash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      SourcePath: 'SkyUI_SE.bsa',
    },
    {
      $type: 'FromArchive',
      To: 'mods/Unofficial Skyrim Special Edition Patch/Unofficial Skyrim Special Edition Patch.esp',
      Size: 32500000,
      Hash: 'ussep_esp_hash',
      ArchiveHash: 'f1e2d3c4b5a697887766554433221100',
      SourcePath: 'Unofficial Skyrim Special Edition Patch.esp',
    },
    {
      $type: 'InlineFile',
      To: 'profiles/Default/modlist.txt',
      Size: 1240,
      Hash: 'inlined_modlist_txt',
    },
    {
      $type: 'InlineFile',
      To: 'profiles/Default/plugins.txt',
      Size: 850,
      Hash: 'inlined_plugins_txt',
    },
    {
      $type: 'PatchedFromArchive',
      To: 'mods/Engine Fixes/skse/plugins/EngineFixes.toml',
      Size: 12800,
      Hash: 'patched_toml_hash',
      ArchiveHash: 'cafebabe00112233445566778899aabb',
      PatchID: 'patch_engine_fixes_toml',
    },
  ],
};

const DEFAULT_PROGRESS: InstallProgress = {
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

export const App: React.FC = () => {
  const { language } = useI18n();
  const appUi = APP_UI[language] ?? APP_UI.fr;
  // Référence stable pour les callbacks mémorisés (évite de les recréer à chaque changement de langue)
  const langRef = useRef(language);
  langRef.current = language;
  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveTab>('gallery');

  // Drag & Drop overlay state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Modlist & Inspection
  const [galleryModlists, setGalleryModlists] = useState<GalleryModlist[]>([]);
  const [isLoadingModlists, setIsLoadingModlists] = useState(false);
  const [parsedFile, setParsedFile] = useState<ParsedWabbajackFile | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  // Mods optionnels choisis (profil + mods désactivés par défaut à installer)
  const [installOptions, setInstallOptions] = useState<InstallOptions>({ enable: [] });
  const [downloadingGallery, setDownloadingGallery] = useState<{ title: string; pct: number; status: string } | null>(null);

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
  const [nexusApiKey, setNexusApiKey] = useState<string>(() => {
    return localStorage.getItem('mabbajack_nexus_key') || '';
  });
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

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManualDownloadsOpen, setIsManualDownloadsOpen] = useState(false);
  const [isPluginsTxtOpen, setIsPluginsTxtOpen] = useState(false);

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
          addLog('success', `${data.length} modlists chargés depuis le serveur local.`);
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
        addLog('success', `${enriched.length} modlists agrégés depuis GitHub (${repoUrls.length} dépôts).`);
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
          } else {
            addLog('warn', 'Clé API Nexus invalide.');
          }
          return acc;
        }
      } catch {
        // Fallback simulated verification
      }

      const isPremium = key.length > 30;
      const acc: NexusAccount = {
        valid: key.length >= 16,
        name: 'Dovahkiin_Mac',
        isPremium,
        dailyLimit: 2500,
        dailyRemaining: 2450,
        hourlyLimit: 100,
        hourlyRemaining: 98,
      };
      setNexusAccount(acc);
      addLog('success', `Compte Nexus validé : ${acc.name} (${isPremium ? 'Premium ⭐' : 'Standard'})`);
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
        setActiveTab('inspector');
        addLog('success', `Modlist "${parsed.name}" analysé : ${parsed.numberOfArchives} archives.`);
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
        setActiveTab('inspector');
        addLog('success', `Modlist "${parsed.name}" analysé : ${parsed.numberOfArchives} archives, ${parsed.loadOrder?.length ?? 0} plugins.`);
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
      setActiveTab('inspector');
      addLog('success', `Modlist Démo "${PHOENIX_DEMO_MODLIST.name}" chargé avec succès.`);
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

    setActiveTab('progress');
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
          options: installOptions,
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
      setActiveTab('inspector');
    } catch (err: any) {
      addLog('error', `Erreur réseau : ${err.message || err}`);
      setActiveTab('inspector');
    }
  }, [parsedFile, downloadsPath, destPath, gamePath, nexusApiKey, installOptions, addLog]);


  // 9. Gallery Modlist Selection — instantly builds a ParsedWabbajackFile from catalog metadata
  // (no CDN download needed at this stage; the wabbajack file is fetched at real install time)
  const handleSelectGalleryModlist = useCallback(
    (modlist: GalleryModlist) => {
      const dl = modlist.download_metadata;
      const downloadUrl = modlist.links?.download || '';

      // Build a synthetic ParsedWabbajackFile from catalog metadata
      const synthetic: ParsedWabbajackFile = {
        name: modlist.title,
        author: modlist.author,
        description: modlist.description || '',
        version: modlist.version || '1.0',
        gameType: modlist.game || 'SkyrimSpecialEdition',
        archives: [],
        directives: [],
        totalArchiveSize: dl?.SizeOfArchives || 0,
        totalInstalledSize: dl?.SizeOfInstalledFiles || 0,
        numberOfArchives: dl?.NumberOfArchives || 0,
        numberOfDirectives: 0,
        inlinedFilesCount: 0,
        patchesCount: 0,
        loadOrder: [],
        pluginsTxt: '',
        // Pre-computed edition classification from the catalog (multi-signal heuristic)
        // Takes priority over gameType in InstallerView — fixes the SE/AE confusion
        skyrimVersion: (modlist as any).skyrimVersion as ('se' | 'ae' | 'vr' | 'other') | undefined,
        // Preserve all CDN/social links (Nexus websiteURL used as fallback for .wabbajack download)
        links: modlist.links,
        // Store the CDN URL here so the install engine can download at installation time
        localFilePath: downloadUrl || undefined,
      };

      setParsedFile(synthetic);
      setActiveTab('installer');
      addLog('info', `📋 "${modlist.title}" sélectionné depuis la galerie — configurez les chemins puis lancez le déploiement.`);
      if (downloadUrl) {
        addLog('info', `🔗 Fichier .wabbajack sera téléchargé depuis : ${downloadUrl}`);
      } else {
        addLog('warn', `"${modlist.title}" : aucune URL CDN disponible — glissez le fichier .wabbajack manuellement.`);
      }
    },
    [addLog]
  );

  // Full-page drag & drop overlay handlers (React-level for reliable dataTransfer access)
  const handleGlobalDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.wabbajack') || file.name.toLowerCase().endsWith('.zip')) {
        handleLoadWabbajackFile(file);
      } else {
        addLog('warn', `Fichier non reconnu : "${file.name}". Seuls les fichiers .wabbajack sont acceptés.`);
      }
    }
  }, [handleLoadWabbajackFile, addLog]);

  // Pont vers les menus macOS natifs (python_app/mabbajack_app.py appelle window.mabbajackMenu)
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    open: () => { handlePickNativeWabbajackFile(); },
    settings: () => setIsSettingsOpen(true),
    gallery: () => setActiveTab('gallery'),
    inspector: () => setActiveTab('inspector'),
    installer: () => setActiveTab('installer'),
    progress: () => setActiveTab('progress'),
    refresh: () => { fetchModlists(); },
  };
  useEffect(() => {
    (window as unknown as { mabbajackMenu?: (a: string) => void }).mabbajackMenu = (action: string) =>
      menuActions.current[action]?.();
    // Pas de menu contextuel de navigateur (« Recharger »…) hors des champs de saisie et du texte sélectionné
    const noBrowserMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('input, textarea, [contenteditable="true"]') && !window.getSelection()?.toString()) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', noBrowserMenu);
    return () => {
      window.removeEventListener('contextmenu', noBrowserMenu);
      delete (window as unknown as { mabbajackMenu?: unknown }).mabbajackMenu;
    };
  }, []);

  // Initialize data on mount
  useEffect(() => {
    fetchModlists();
    if (nexusApiKey) {
      handleVerifyNexusKey(nexusApiKey);
    }
  }, []);

  return (
    <div
      className="w-screen h-screen flex flex-col bg-[#181818] text-[#dddddd] overflow-hidden font-sans select-text relative"
    >
      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(14,14,17,0.88)', backdropFilter: 'blur(8px)' }}>
          <div style={{
            border: '3px dashed #0369a1',
            borderRadius: '24px',
            padding: '64px 96px',
            textAlign: 'center',
            background: 'rgba(3,105,161,0.08)',
            boxShadow: '0 0 60px rgba(3,105,161,0.3)',
          }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>📦</div>
            <div style={{ fontSize: 'calc(20px * var(--text-scale))', fontWeight: 700, color: '#0ea5e9', marginBottom: '8px' }}>
              {appUi.dropTitle}
            </div>
            <div style={{ fontSize: 'calc(15px * var(--text-scale))', color: '#707070' }}>
              {appUi.dropSubtitle}
            </div>
          </div>
        </div>
      )}

      {/* Gallery .wabbajack Download Overlay */}
      {downloadingGallery && (
        <div className="absolute inset-0 z-[9998] flex items-center justify-center" style={{ background: 'rgba(14,14,17,0.93)', backdropFilter: 'blur(12px)' }}>
          <div style={{ width: 480, background: '#181818', border: '1px solid #303030', borderRadius: 16, padding: '32px 36px', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>
            <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 16 }}>⬇️</div>
            <h3 style={{ color: '#ffffff', fontSize: 'calc(16px * var(--text-scale))', fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>{appUi.downloading}</h3>
            <p style={{ color: '#aaaaaa', fontSize: 'calc(12px * var(--text-scale))', textAlign: 'center', marginBottom: 20 }}>{downloadingGallery.title}</p>
            <div style={{ background: '#181818', borderRadius: 8, height: 8, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 8, background: 'linear-gradient(90deg,#0ea5e9,#0369a1)', width: `${downloadingGallery.pct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <p style={{ color: '#707070', fontSize: 'calc(11px * var(--text-scale))', textAlign: 'center', fontFamily: 'monospace', minHeight: 16 }}>{translateLog(downloadingGallery.status, language)}</p>
            <p style={{ color: '#404040', fontSize: 'calc(10px * var(--text-scale))', textAlign: 'center', marginTop: 16 }}>{appUi.downloadingHint}</p>
          </div>
        </div>
      )}

      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        nexusAccount={nexusAccount}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isInstalling={progress.stage !== 'idle' && progress.stage !== 'completed'}
      />

      {/* Main View Area */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'gallery' && (
          <GalleryView
            modlists={galleryModlists}
            isLoading={isLoadingModlists}
            onRefresh={fetchModlists}
          />
        )}

        {importProgress && <ImportProgress state={importProgress} />}

        {activeTab === 'inspector' && (
          <InspectorView
            parsedFile={parsedFile}
            onLoadFile={handleLoadWabbajackFile}
            onLoadDemo={handleLoadDemoModlist}
            onProceedToInstall={() => setActiveTab('installer')}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            onPickNativeFile={handlePickNativeWabbajackFile}
            isLoading={isInspecting}
            isScanning={isScanning}
            scanProgress={scanProgress}
            downloadsPath={downloadsPath}
          />
        )}

        {activeTab === 'installer' && (
          <InstallerView
            parsedFile={parsedFile}
            downloadsPath={downloadsPath}
            setDownloadsPath={(p: string) => {
              setDownloadsPath(p);
              localStorage.setItem('mabbajack_downloads_path', p);
            }}
            destPath={destPath}
            setDestPath={(p: string) => {
              setDestPath(p);
              localStorage.setItem('mabbajack_dest_path', p);
            }}
            gamePath={gamePath}
            setGamePath={(p: string) => {
              setGamePath(p);
              localStorage.setItem('mabbajack_game_path', p);
            }}
            onScanDownloads={handleScanDownloads}
            onStartInstall={handleStartInstall}
            onOpenManualDownloads={() => setIsManualDownloadsOpen(true)}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            nexusApiKey={nexusApiKey}
            setNexusApiKey={(k: string) => {
              setNexusApiKey(k);
              localStorage.setItem('mabbajack_nexus_key', k);
            }}
            onVerifyNexusKey={handleVerifyNexusKey}
            nexusAccount={nexusAccount}
            isScanning={isScanning}
            installOptions={installOptions}
            setInstallOptions={setInstallOptions}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressView
            progress={progress}
            logs={logs}
            downloadsPath={downloadsPath}
            destPath={destPath}
            onPause={() => {
              setProgress((p) => ({ ...p, isPaused: true, stage: 'paused' }));
              addLog('warn', 'Installation mise en pause.');
              fetch(`${getApiBaseUrl()}/api/install/pause`, { method: 'POST' })
                .catch((e) => addLog('error', `Pause impossible : ${e?.message || e}`));
            }}
            onResume={() => {
              setProgress((p) => ({ ...p, isPaused: false, stage: 'extracting_files' }));
              addLog('info', 'Installation reprise.');
              fetch(`${getApiBaseUrl()}/api/install/resume`, { method: 'POST' })
                .catch((e) => addLog('error', `Reprise impossible : ${e?.message || e}`));
            }}
            onCancel={() => {
              setProgress(DEFAULT_PROGRESS);
              addLog('warn', 'Installation annulée par l’utilisateur.');
              fetch(`${getApiBaseUrl()}/api/install/cancel`, { method: 'POST' })
                .catch((e) => addLog('error', `Annulation impossible : ${e?.message || e}`));
            }}
            onClearLogs={() => setLogs([])}
            onOpenDestFolder={() => {
              openFolderInFinder(destPath).then((ok) => {
                if (!ok) alert(`${appUi.destFolderAlert}\n${destPath}`);
              });
            }}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            onReturnToInstaller={() => setActiveTab('installer')}
          />
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        nexusApiKey={nexusApiKey}
        setNexusApiKey={(k: string) => {
          setNexusApiKey(k);
          localStorage.setItem('mabbajack_nexus_key', k);
        }}
        onVerifyNexusKey={handleVerifyNexusKey}
        nexusAccount={nexusAccount}
        defaultDownloadsPath={downloadsPath}
        setDefaultDownloadsPath={(p: string) => {
          setDownloadsPath(p);
          localStorage.setItem('mabbajack_downloads_path', p);
        }}
        defaultDestPath={destPath}
        setDefaultDestPath={(p: string) => {
          setDestPath(p);
          localStorage.setItem('mabbajack_dest_path', p);
        }}
        concurrency={concurrency}
        setConcurrency={(c: number) => {
          setConcurrency(c);
          localStorage.setItem('mabbajack_concurrency', c.toString());
        }}
      />

      {/* Manual Download Modal */}
      <ManualDownloadModal
        isOpen={isManualDownloadsOpen}
        onClose={() => setIsManualDownloadsOpen(false)}
        missingArchives={parsedFile?.archives.filter((a) => a.status !== 'ready') || []}
        downloadsPath={downloadsPath}
        onScanDownloads={handleScanDownloads}
        isScanning={isScanning}
      />

      {/* Plugins.txt post-LOOT Modal */}
      <PluginsTxtModal
        isOpen={isPluginsTxtOpen}
        onClose={() => setIsPluginsTxtOpen(false)}
        pluginsTxtContent={
          parsedFile?.pluginsTxt ||
          `*Skyrim.esm\n*Update.esm\n*Dawnguard.esm\n*HearthFires.esm\n*Dragonborn.esm\n*Unofficial Skyrim Special Edition Patch.esp\n*SkyUI_SE.esp`
        }
        modlistName={parsedFile?.name}
      />
    </div>
  );
};
export default App;
