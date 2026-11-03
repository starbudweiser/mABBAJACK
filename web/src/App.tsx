import React, { useState } from 'react';
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
import DropOverlay from './components/DropOverlay';
import { useFileDrop } from './hooks/useFileDrop';
import { useMabbajack, useMabbajackEvents } from './state/mabbajack';
import { useMenuBridge } from './state/uiMode';

/** Présentation Expert : les quatre onglets (Galerie, Inspecteur, Installation, Progression). */
export const App: React.FC = () => {
  const { language } = useI18n();
  const appUi = APP_UI[language] ?? APP_UI.fr;
  const m = useMabbajack();
  const { pickNativeWabbajackFile, fetchModlists } = m;

  const [activeTab, setActiveTab] = useState<ActiveTab>('gallery');
  useMabbajackEvents((e) => setActiveTab(e === 'installStarted' ? 'progress' : e === 'galleryReady' ? 'installer' : 'inspector'));

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManualDownloadsOpen, setIsManualDownloadsOpen] = useState(false);
  const [isPluginsTxtOpen, setIsPluginsTxtOpen] = useState(false);

  const { isDragging, dropProps } = useFileDrop();

  // Pont vers les menus macOS natifs (python_app/mabbajack_app.py appelle window.mabbajackMenu)
  useMenuBridge({
    open: () => { pickNativeWabbajackFile(); },
    settings: () => setIsSettingsOpen(true),
    gallery: () => setActiveTab('gallery'),
    inspector: () => setActiveTab('inspector'),
    installer: () => setActiveTab('installer'),
    progress: () => setActiveTab('progress'),
    refresh: () => { fetchModlists(); },
  });

  return (
    <div
      {...dropProps}
      className="w-screen h-screen flex flex-col bg-[#181818] text-[#dddddd] overflow-hidden font-sans select-text relative"
    >
      {isDragging && <DropOverlay />}

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
