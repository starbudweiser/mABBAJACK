import React, { useState } from 'react';
import { useI18n } from '../locales';
import { SIMPLE_UI } from '../locales/uiSimple';
import { useMabbajack, useMabbajackEvents } from '../state/mabbajack';
import { useMenuBridge, useUiMode } from '../state/uiMode';
import { useFileDrop } from '../hooks/useFileDrop';
import { btn } from '../design';
import DropOverlay from '../components/DropOverlay';
import ImportProgress from '../components/ImportProgress';
import GalleryDownloadOverlay from '../components/GalleryDownloadOverlay';
import SettingsModal from '../components/SettingsModal';
import ManualDownloadModal from '../components/ManualDownloadModal';
import PluginsTxtModal from '../components/PluginsTxtModal';
import ChooseStep from './ChooseStep';
import PrepareStep from './PrepareStep';
import InstallStep from './InstallStep';

type Step = 'choose' | 'prepare' | 'install';
const STEPS: Step[] = ['choose', 'prepare', 'install'];

/** Présentation Simple : Choisir → Préparer → Installer → Terminé, sans onglets ni vocabulaire technique. */
export const SimpleApp: React.FC = () => {
  const { language } = useI18n();
  const ui = SIMPLE_UI[language] ?? SIMPLE_UI.fr;
  const m = useMabbajack();
  const { setMode } = useUiMode();
  const { isDragging, dropProps } = useFileDrop();

  const installing = m.progress.stage !== 'idle';
  const [step, setStep] = useState<Step>(() => (installing ? 'install' : m.parsedFile ? 'prepare' : 'choose'));
  useMabbajackEvents((e) => setStep(e === 'installStarted' ? 'install' : 'prepare'));

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isPluginsTxtOpen, setIsPluginsTxtOpen] = useState(false);

  useMenuBridge({
    open: () => { m.pickNativeWabbajackFile(); },
    settings: () => setIsSettingsOpen(true),
    refresh: () => { m.fetchModlists(); },
    gallery: () => setStep('choose'),
    installer: () => setStep(m.parsedFile ? 'prepare' : 'choose'),
    progress: () => setStep(installing ? 'install' : 'choose'),
  });

  const done = m.progress.stage === 'completed';
  const labels: Record<Step, string> = { choose: ui.stepChoose, prepare: ui.stepPrepare, install: done ? ui.stepDone : ui.stepInstall };
  const reachable = (s: Step) => (s === 'choose' ? !installing || done : s === 'prepare' ? !!m.parsedFile && (!installing || done) : installing);

  return (
    <div {...dropProps} className="w-screen h-screen flex flex-col bg-[#181818] text-[#dddddd] overflow-hidden font-sans select-text relative">
      {isDragging && <DropOverlay />}
      {m.galleryDownload && <GalleryDownloadOverlay download={m.galleryDownload} />}
      {m.importProgress && <ImportProgress state={m.importProgress} />}

      <header className="h-14 px-4 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between gap-3 select-none flex-shrink-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#0369a1] flex items-center justify-center text-white">⚡</div>
          <span className="text-title font-extrabold text-white tracking-wide">mABBAJACK</span>
        </div>

        <nav className="flex items-center gap-1 min-w-0" aria-label={ui.stepsLabel}>
          {STEPS.map((s, i) => {
            const active = s === step;
            return (
              <React.Fragment key={s}>
                {i > 0 && <span className="text-[#444444]">›</span>}
                <button type="button" disabled={!reachable(s) && !active} onClick={() => setStep(s)} aria-current={active ? 'step' : undefined}
                  className={`px-3 py-1.5 rounded-md text-body font-medium whitespace-nowrap transition-colors ${active ? 'bg-[#0369a1] text-white font-semibold' : reachable(s) ? 'text-[#aaaaaa] hover:text-white hover:bg-[#262626] cursor-pointer' : 'text-[#555555] cursor-default'}`}>
                  <span className="font-mono mr-1.5 opacity-70">{i + 1}</span>{labels[s]}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button type="button" className={btn.ghost} onClick={() => setMode('expert')}>{ui.expertMode}</button>
          <button type="button" className={btn.icon} onClick={() => setIsSettingsOpen(true)} title={ui.settings} aria-label={ui.settings}>⚙️</button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {step === 'choose' && <ChooseStep />}
        {step === 'prepare' && m.parsedFile && <PrepareStep onBack={() => setStep('choose')} />}
        {step === 'install' && (
          <InstallStep onOpenManual={() => setIsManualOpen(true)} onOpenPluginsTxt={() => setIsPluginsTxtOpen(true)}
            onBack={() => setStep(m.parsedFile ? 'prepare' : 'choose')} onAnother={() => { m.cancelInstall(); setStep('choose'); }} />
        )}
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)}
        nexusApiKey={m.nexusApiKey} setNexusApiKey={m.setNexusApiKey} onVerifyNexusKey={m.verifyNexusKey} nexusAccount={m.nexusAccount}
        defaultDownloadsPath={m.downloadsPath} setDefaultDownloadsPath={m.setDownloadsPath}
        defaultDestPath={m.destPath} setDefaultDestPath={m.setDestPath}
        concurrency={m.concurrency} setConcurrency={m.setConcurrency} />
      <ManualDownloadModal isOpen={isManualOpen} onClose={() => setIsManualOpen(false)}
        missingArchives={m.parsedFile?.archives.filter((a) => a.status !== 'ready') || []}
        downloadsPath={m.downloadsPath} onScanDownloads={m.scanDownloads} isScanning={m.isScanning} />
      <PluginsTxtModal isOpen={isPluginsTxtOpen} onClose={() => setIsPluginsTxtOpen(false)}
        pluginsTxtContent={m.parsedFile?.pluginsTxt || ''} modlistName={m.parsedFile?.name} />
    </div>
  );
};

export default SimpleApp;
