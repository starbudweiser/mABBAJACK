import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header, { ActiveTab } from './components/Header';
import GalleryView from './components/GalleryView';
import InspectorView from './components/InspectorView';
import InstallerView from './components/InstallerView';
import ProgressView from './components/ProgressView';
import SettingsModal from './components/SettingsModal';
import ManualDownloadModal from './components/ManualDownloadModal';
import PluginsTxtModal from './components/PluginsTxtModal';
import ImportProgress from './components/ImportProgress';
import GalleryDownloadOverlay from './components/GalleryDownloadOverlay';
import { useI18n } from './locales';
import { APP_UI } from './locales/uiScreens';
import { useMabbajack, useMabbajackEvents } from './state/mabbajack';

/** Présentation Expert : les quatre onglets (Galerie, Inspecteur, Installation, Progression). */
export const App: React.FC = () => {
  const { language } = useI18n();
  const appUi = APP_UI[language] ?? APP_UI.fr;
  const m = useMabbajack();
  const { loadWabbajackFile, addLog, pickNativeWabbajackFile, fetchModlists } = m;

  const [activeTab, setActiveTab] = useState<ActiveTab>('gallery');
  useMabbajackEvents((e) => setActiveTab(e === 'installStarted' ? 'progress' : e === 'galleryReady' ? 'installer' : 'inspector'));

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManualDownloadsOpen, setIsManualDownloadsOpen] = useState(false);
  const [isPluginsTxtOpen, setIsPluginsTxtOpen] = useState(false);

  // Drag & Drop overlay state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

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
        loadWabbajackFile(file);
      } else {
        addLog('warn', `Fichier non reconnu : "${file.name}". Seuls les fichiers .wabbajack sont acceptés.`);
      }
    }
  }, [loadWabbajackFile, addLog]);

  // Pont vers les menus macOS natifs (python_app/mabbajack_app.py appelle window.mabbajackMenu)
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    open: () => { pickNativeWabbajackFile(); },
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

  return (
    <div
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
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

      {m.galleryDownload && <GalleryDownloadOverlay download={m.galleryDownload} />}

      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        nexusAccount={m.nexusAccount}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isInstalling={m.progress.stage !== 'idle' && m.progress.stage !== 'completed'}
      />

      {/* Main View Area */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'gallery' && (
          <GalleryView
            modlists={m.galleryModlists}
            isLoading={m.isLoadingModlists}
            onRefresh={m.fetchModlists}
            onInstall={m.installFromGallery}
          />
        )}

        {m.importProgress && <ImportProgress state={m.importProgress} />}

        {activeTab === 'inspector' && (
          <InspectorView
            parsedFile={m.parsedFile}
            onLoadFile={m.loadWabbajackFile}
            onLoadDemo={m.loadDemoModlist}
            onProceedToInstall={() => setActiveTab('installer')}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            onPickNativeFile={m.pickNativeWabbajackFile}
            isLoading={m.isInspecting}
            isScanning={m.isScanning}
            scanProgress={m.scanProgress}
            downloadsPath={m.downloadsPath}
            destPath={m.destPath}
          />
        )}

        {activeTab === 'installer' && (
          <InstallerView
            parsedFile={m.parsedFile}
            downloadsPath={m.downloadsPath}
            setDownloadsPath={m.setDownloadsPath}
            destPath={m.destPath}
            setDestPath={m.setDestPath}
            gamePath={m.gamePath}
            setGamePath={m.setGamePath}
            onScanDownloads={m.scanDownloads}
            onStartInstall={m.startInstall}
            onOpenManualDownloads={() => setIsManualDownloadsOpen(true)}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            nexusApiKey={m.nexusApiKey}
            setNexusApiKey={m.setNexusApiKey}
            onVerifyNexusKey={m.verifyNexusKey}
            nexusAccount={m.nexusAccount}
            isScanning={m.isScanning}
            installOptions={m.installOptions}
            updateRequest={m.updateRequest}
            setUpdateRequest={m.setUpdateRequest}
            setInstallOptions={m.setInstallOptions}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressView
            progress={m.progress}
            logs={m.logs}
            downloadsPath={m.downloadsPath}
            destPath={m.destPath}
            onPause={m.pauseInstall}
            onResume={m.resumeInstall}
            onCancel={m.cancelInstall}
            onClearLogs={m.clearLogs}
            onOpenDestFolder={m.openDestFolder}
            onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            onReturnToInstaller={() => setActiveTab('installer')}
          />
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        nexusApiKey={m.nexusApiKey}
        setNexusApiKey={m.setNexusApiKey}
        onVerifyNexusKey={m.verifyNexusKey}
        nexusAccount={m.nexusAccount}
        defaultDownloadsPath={m.downloadsPath}
        setDefaultDownloadsPath={m.setDownloadsPath}
        defaultDestPath={m.destPath}
        setDefaultDestPath={m.setDestPath}
        concurrency={m.concurrency}
        setConcurrency={m.setConcurrency}
      />

      {/* Manual Download Modal */}
      <ManualDownloadModal
        isOpen={isManualDownloadsOpen}
        onClose={() => setIsManualDownloadsOpen(false)}
        missingArchives={m.parsedFile?.archives.filter((a) => a.status !== 'ready') || []}
        downloadsPath={m.downloadsPath}
        onScanDownloads={m.scanDownloads}
        isScanning={m.isScanning}
      />

      {/* Plugins.txt post-LOOT Modal */}
      <PluginsTxtModal
        isOpen={isPluginsTxtOpen}
        onClose={() => setIsPluginsTxtOpen(false)}
        pluginsTxtContent={
          m.parsedFile?.pluginsTxt ||
          `*Skyrim.esm\n*Update.esm\n*Dawnguard.esm\n*HearthFires.esm\n*Dragonborn.esm\n*Unofficial Skyrim Special Edition Patch.esp\n*SkyUI_SE.esp`
        }
        modlistName={m.parsedFile?.name}
      />
    </div>
  );
};
export default App;
