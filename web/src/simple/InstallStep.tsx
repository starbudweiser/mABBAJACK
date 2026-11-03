import React from 'react';
import { useI18n } from '../locales';
import { translateLog } from '../locales/logCatalog';
import { SIMPLE_UI, fillText } from '../locales/uiSimple';
import { useMabbajack } from '../state/mabbajack';
import { btn, card } from '../design';
import { InstallStage } from '../types/wabbajack';

const mmss = (secs: number) => {
  if (!secs || secs <= 0) return '--:--';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
};

interface Props {
  onOpenManual: () => void;
  onOpenPluginsTxt: () => void;
  onBack: () => void;
  onAnother: () => void;
}

export const InstallStep: React.FC<Props> = ({ onOpenManual, onOpenPluginsTxt, onBack, onAnother }) => {
  const { language } = useI18n();
  const ui = SIMPLE_UI[language] ?? SIMPLE_UI.fr;
  const m = useMabbajack();
  const p = m.progress;

  const stageLabel = (s: InstallStage): string => ({
    validating_paths: ui.stageValidating, scanning_downloads: ui.stageScanning, downloading_archives: ui.stageDownloading,
    extracting_files: ui.stageExtracting, generating_mo2: ui.stageConfig,
  } as Partial<Record<InstallStage, string>>)[s] ?? ui.starting;

  if (p.stage === 'completed') {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center select-text">
        <div className={`${card} max-w-lg w-full items-center text-center gap-4 p-8`}>
          <div className="text-[48px]">✅</div>
          <h2 className="text-display font-bold text-white">{ui.doneTitle}</h2>
          <p className="text-body-lg text-[#dddddd]">{fillText(ui.doneBody, { name: m.parsedFile?.name || '' })}</p>
          <p className="text-body text-[#aaaaaa]">{ui.doneHow}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button type="button" className={btn.primary} onClick={m.openDestFolder}>📂 {ui.openFolder}</button>
            <button type="button" className={btn.secondary} onClick={onOpenPluginsTxt}>📄 {ui.pluginsTxt}</button>
          </div>
          <button type="button" className={btn.ghost} onClick={onAnother}>{ui.another}</button>
        </div>
      </div>
    );
  }

  if (p.stage === 'error' || p.hasError) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center select-text">
        <div className={`${card} max-w-lg w-full items-center text-center gap-4 p-8 border-[#ef4444]/40`}>
          <div className="text-[48px]">⚠️</div>
          <h2 className="text-display font-bold text-white">{ui.failTitle}</h2>
          {p.errorMessage && <p className="text-body-lg text-[#f87171] break-words">{translateLog(p.errorMessage, language)}</p>}
          <p className="text-body text-[#aaaaaa]">{ui.failHint}</p>
          <button type="button" className={btn.primary} onClick={onBack}>{ui.retry}</button>
        </div>
      </div>
    );
  }

  // Pendant l'inventaire et la vérification des archives le pourcentage global n'avance pas : on montre celui de l'étape,
  // et une barre animée tant que l'étape ne sait pas encore où elle en est.
  const scanning = p.stage === 'scanning_downloads';
  const indeterminate = !p.isPaused && ((scanning && !(p.stagePercent > 0)) || p.stage === 'validating_paths' || p.stage === 'idle');
  const pct = Math.max(0, Math.min(100, (scanning ? p.stagePercent : p.overallPercent) || 0));
  return (
    <div className="flex-1 overflow-y-auto p-6 select-text">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <h2 className="text-display font-bold text-white">{ui.installTitle}</h2>
        <p className="text-body-lg text-[#aaaaaa]">{m.parsedFile?.name}</p>

        <div className={`${card} gap-3`}>
          <div className="flex items-baseline justify-between">
            <span className="text-heading font-bold text-white">{p.isPaused ? ui.paused : stageLabel(p.stage)}</span>
            <span className="text-heading font-bold text-[#38bdf8] font-mono">{indeterminate ? '' : `${pct.toFixed(0)} %`}</span>
          </div>
          <div className="h-3 rounded-full bg-[#262626] overflow-hidden">
            <div className={`h-full rounded-full bg-[#0ea5e9] transition-all duration-500 ${indeterminate ? 'animate-pulse' : ''}`} style={{ width: indeterminate ? '100%' : `${pct}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-body text-[#aaaaaa]">
            <span>{p.totalItems > 0 && !(scanning && p.processedItems === 0) ? `${p.processedItems.toLocaleString(language)} / ${p.totalItems.toLocaleString(language)}` : ''}</span>
            <span>{p.etaSeconds > 0 ? fillText(ui.eta, { time: mmss(p.etaSeconds) }) : ''}</span>
          </div>
          {p.currentTask && <p className="text-meta text-[#8f8f8f] break-words">{translateLog(p.currentTask, language)}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.isPaused
            ? <button type="button" className={btn.success} onClick={m.resumeInstall}>▶ {ui.resume}</button>
            : <button type="button" className={btn.secondary} onClick={m.pauseInstall}>⏸ {ui.pause}</button>}
          <button type="button" className={btn.danger} onClick={() => { m.cancelInstall(); onBack(); }}>✕ {ui.cancel}</button>
          {p.missingArchivesCount > 0 && (
            <button type="button" className={`${btn.warning} ml-auto`} onClick={onOpenManual}>
              {fillText(ui.manualDownloads, { n: p.missingArchivesCount })}
            </button>
          )}
        </div>

        <details className="group">
          <summary className="cursor-pointer select-none text-body text-[#8f8f8f] hover:text-white">{ui.showDetails}</summary>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg bg-[#181818] border border-[#2e2e2e] p-3 font-mono text-meta text-[#aaaaaa] space-y-0.5">
            {m.logs.slice(-100).map((l) => (
              <div key={l.id} className={l.level === 'error' ? 'text-[#f87171]' : l.level === 'warn' ? 'text-[#fbbf24]' : l.level === 'success' ? 'text-[#4ade80]' : ''}>
                {translateLog(l.message, language)}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
};

export default InstallStep;
