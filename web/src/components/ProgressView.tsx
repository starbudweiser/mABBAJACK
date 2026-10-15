import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../locales';
import { InstallProgress, LogEntry } from '../types/wabbajack';
import { btn, Divider } from '../design';
import { translateLog, PROGRESS_UI } from '../locales/logCatalog';
import { fmtBytes, mbUnit } from '../locales/uiScreens';

interface ProgressViewProps {
  progress: InstallProgress;
  logs: LogEntry[];
  downloadsPath?: string;
  destPath?: string;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClearLogs: () => void;
  onOpenDestFolder: () => void;
  onOpenPluginsTxt?: () => void;
  onReturnToInstaller?: () => void;
}

function formatSeconds(secs: number): string {
  if (!secs || secs <= 0) return '--:--';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  progress, logs, downloadsPath, destPath,
  onPause, onResume, onCancel, onClearLogs,
  onOpenDestFolder, onOpenPluginsTxt, onReturnToInstaller,
}) => {
  const { t, language } = useI18n();
  const ui = PROGRESS_UI[language] || PROGRESS_UI.fr;
  const tr = (s?: string | null) => translateLog(s, language);
  const formatBytes = (b: number) => fmtBytes(b, language);
  const mbps = `${mbUnit(language)}/s`;
  const [autoScroll, setAutoScroll] = useState(true);
  const [logFilter, setLogFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [copied, setCopied] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'error') return l.level === 'error';
    if (logFilter === 'warn') return l.level === 'warn' || l.level === 'error';
    return true;
  });

  const handleCopyLogs = async () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${tr(l.message)}${l.details ? '\n  ' + l.details : ''}`).join('\n');
    // Try modern Clipboard API first
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        return;
      }
    } catch { /* fall through */ }
    // Fallback: hidden textarea + execCommand (works on http://localhost)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        return;
      }
    } catch { /* fall through */ }
    // Last resort: open in new window
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<pre style="font-family:monospace;font-size:11px;white-space:pre-wrap">' + text.replace(/</g,'&lt;') + '</pre>');
      w.document.title = 'mABBAJACK Logs';
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isCompleted = progress.stage === 'completed';
  const hasError = progress.hasError || progress.stage === 'error';
  const isActive = !hasError && !isCompleted && progress.stage !== 'idle';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#181818] p-5 gap-4">

      {/* ── Top card: status + actions ──────────────────────────────── */}
      <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl p-4 flex flex-col gap-3 flex-shrink-0 shadow-md">

        {/* Row 1: title + action toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-title font-bold text-white flex items-center gap-2 flex-shrink-0">
              <span>⚡</span>
              <span>{t.progress.title}</span>
            </h2>
            {progress.stage !== 'idle' && (
              <span className={`text-caption font-mono font-bold px-2 py-0.5 rounded-md border flex-shrink-0 ${
                hasError     ? 'bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/40'
                : isCompleted ? 'bg-[#22c55e]/15 text-[#4ade80] border-[#22c55e]/40'
                : 'bg-[#0369a1]/15 text-[#38bdf8] border-[#0ea5e9]/30'
              }`}>
                {tr(progress.stageName)}
              </span>
            )}
            <p className="text-meta text-[#666666] truncate hidden md:block">{t.progress.subtitle}</p>
          </div>

          {/* Action toolbar — grouped, separated by dividers */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Group A: install controls (only while active) */}
            {isActive && (
              <>
                {progress.isPaused ? (
                  <button type="button" onClick={onResume} className={btn.success}>
                    <span>▶</span><span>{t.progress.resumeBtn}</span>
                  </button>
                ) : (
                  <button type="button" onClick={onPause} className={btn.warning}>
                    <span>⏸</span><span>{t.progress.pauseBtn}</span>
                  </button>
                )}
                <button type="button" onClick={onCancel} className={btn.danger}>
                  {t.progress.cancelBtn}
                </button>
                <Divider />
              </>
            )}

            {/* Group B: error recovery */}
            {hasError && onReturnToInstaller && (
              <>
                <button type="button" onClick={onReturnToInstaller} className={btn.danger}>
                  <span>↩</span><span>{ui.editRetry}</span>
                </button>
                <Divider />
              </>
            )}

            {/* Group C: output actions */}
            {onOpenPluginsTxt && (
              <button type="button" onClick={onOpenPluginsTxt} className={btn.secondary}>
                <span>📄</span><span>plugins.txt</span>
              </button>
            )}
            {isCompleted && (
              <button type="button" onClick={onOpenDestFolder} className={btn.primary}>
                <span>📂</span><span>{t.progress.openInFinder}</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: directory reminder */}
        {(downloadsPath || destPath) && (
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-lg px-3 py-2 flex flex-col md:flex-row md:items-center gap-1.5 text-body font-mono">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[#38bdf8] font-bold flex-shrink-0">📥 DL:</span>
              <span className="text-[#666666] truncate">{downloadsPath || '—'}</span>
            </div>
            <div className="hidden md:block w-px h-3 bg-[#333333] flex-shrink-0 mx-1" />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[#4ade80] font-bold flex-shrink-0">🚀 RTP:</span>
              <span className="text-white truncate">{destPath || '—'}</span>
            </div>
          </div>
        )}

        {/* Row 3: error banner */}
        {hasError && (
          <div className="bg-[#181818] border border-[#ef4444]/50 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">❌</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-title font-bold text-[#fecaca]">
                  {ui.interruptedAt} {progress.overallPercent.toFixed(1)}%
                </h3>
                <code className="text-body text-[#fecaca] mt-1.5 block font-mono break-all bg-[#181818] p-2.5 rounded-lg border border-[#ef4444]/30">
                  {tr(progress.errorMessage) || tr(progress.currentTask) || ui.diskError}
                </code>
              </div>
              {onReturnToInstaller && (
                <button type="button" onClick={onReturnToInstaller} className={`${btn.danger} flex-shrink-0`}>
                  <span>↩</span><span>{ui.edit}</span>
                </button>
              )}
            </div>
            <div className="text-body text-[#fecaca]/80 bg-[#181818] p-2.5 rounded-lg border border-[#ef4444]/20 flex flex-col gap-1">
              <span className="font-semibold text-white">{ui.commonFixes}</span>
              <span>• <strong>{ui.fixVolume}</strong> — {ui.fixVolumeDesc}</span>
              <span>• <strong>{ui.fixNtfs}</strong> — {ui.fixNtfsDesc}</span>
              <span>• <strong>{ui.fixPerms}</strong> — {ui.fixPermsDesc}</span>
            </div>
          </div>
        )}

        {/* Row 4: progress bar */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-body">
            <span className={`font-medium truncate max-w-[70%] ${hasError ? 'text-[#f87171]' : 'text-[#aaaaaa]'}`}>
              {tr(progress.currentTask) || t.progress.overallProgress}
            </span>
            <span className={`font-mono font-bold text-title flex-shrink-0 ${hasError ? 'text-[#f87171]' : 'text-[#38bdf8]'}`}>
              {progress.overallPercent.toFixed(1)}%
            </span>
          </div>
          {/* Overall progress bar */}
          <div className="w-full h-2.5 bg-[#1e1e1e] rounded-full overflow-hidden border border-[#2e2e2e]">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                hasError ? 'bg-[#ef4444]'
                : isCompleted ? 'bg-gradient-to-r from-[#22c55e] to-[#22c55e]'
                : 'bg-gradient-to-r from-[#0369a1] via-[#0369a1] to-[#0369a1]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progress.overallPercent))}%` }}
            />
          </div>

          {/* Stage progress bar + animated activity indicator (visible during active extraction) */}
          {!isCompleted && !hasError && progress.stage !== 'idle' && (
            <div className="flex flex-col gap-1 mt-0.5">
              {/* Stage progress bar */}
              {progress.stagePercent > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#0369a1] to-[#0369a1] rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, progress.stagePercent)}%` }}
                    />
                  </div>
                  <span className="text-caption font-mono text-[#666666] flex-shrink-0 w-8 text-right">
                    {progress.stagePercent}%
                  </span>
                </div>
              )}
              {/* Animated current activity */}
              <div className="flex items-center gap-2 text-meta text-[#666666] min-h-[16px]">
                <span className="inline-block w-2 h-2 rounded-full bg-[#0369a1] flex-shrink-0 animate-pulse" />
                <span className="truncate italic">{tr(progress.currentTask) || ui.processing}</span>
              </div>
            </div>
          )}
        </div>

        {/* Row 5: stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1 border-t border-[#2e2e2e]">
          {[
            { label: ui.files, value: `${progress.processedItems} / ${progress.totalItems}`, color: 'text-white' },
            { label: ui.data, value: `${formatBytes(progress.processedBytes)} / ${formatBytes(progress.totalBytes)}`, color: 'text-[#38bdf8]' },
            { label: t.progress.speed, value: progress.speedBytesPerSec > 0 ? `${(progress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} ${mbps}` : `-- ${mbps}`, color: 'text-[#4ade80]' },
            { label: t.progress.eta, value: formatSeconds(progress.etaSeconds), color: 'text-[#fbbf24]' },
          ].map((s) => (
            <div key={s.label} className="bg-[#181818] px-2.5 py-2 rounded-lg border border-[#2e2e2e]">
              <span className="text-caption text-[#666666] uppercase font-bold block">{s.label}</span>
              <span className={`text-body font-mono font-bold ${s.color} block mt-0.5`}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Terminal logs ──────────────────────────────────────────── */}
      <div className="flex-1 bg-[#181818] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col shadow-inner min-h-0">

        {/* Terminal toolbar */}
        <div className="h-9 px-3 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-[#666666] text-meta">
            <span>💻</span>
            <span className="font-medium text-[#aaaaaa]">{t.progress.terminalLogs}</span>
            <span className="px-1.5 py-0.5 rounded bg-[#222222] text-caption">{logs.length}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Log filter pills */}
            <div className="flex items-center gap-1">
              {([['all', ui.all, '#38bdf8'], ['warn', ui.warnings, '#fbbf24'], ['error', ui.errors, '#f87171']] as const).map(([k, label, c]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLogFilter(k)}
                  className={`px-2 py-0.5 rounded text-caption font-medium transition-colors cursor-pointer ${
                    logFilter === k ? `font-bold` : 'text-[#666666] hover:text-[#aaaaaa]'
                  }`}
                  style={logFilter === k ? { color: c } : {}}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-[#333333]" />

            <label className="flex items-center gap-1 text-caption text-[#666666] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-[#333333]"
              />
              <span>{t.progress.autoScroll}</span>
            </label>

            <div className="w-px h-4 bg-[#333333]" />

            <button type="button" onClick={handleCopyLogs} className="text-caption text-[#666666] hover:text-[#aaaaaa] cursor-pointer">
              {copied ? ui.copied : t.progress.copyLogs}
            </button>
            <button type="button" onClick={onClearLogs} className="text-caption text-[#666666] hover:text-[#f87171] cursor-pointer">
              {t.progress.clearLogs}
            </button>
          </div>
        </div>

        {/* Terminal body */}
        <div className="flex-1 p-3 overflow-y-auto font-mono text-body space-y-0.5 bg-[#181818]">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[#666666] text-body">
              {ui.waitingOps}
            </div>
          ) : (
            filteredLogs.map((log) => {
              const style: Record<string, { line: string; tag: string }> = {
                success: { line: 'text-[#4ade80]', tag: 'text-[#4ade80] font-bold' },
                warn:    { line: 'text-[#fbbf24]', tag: 'text-[#fbbf24] font-bold' },
                error:   { line: 'text-[#f87171]', tag: 'text-[#f87171] font-bold' },
                info:    { line: 'text-[#38bdf8]', tag: 'text-[#38bdf8]' },
                debug:   { line: 'text-[#666666]', tag: 'text-[#666666]' },
              };
              const s = style[log.level] || { line: 'text-[#dddddd]', tag: 'text-[#666666]' };
              return (
                <div key={log.id} className="flex items-start gap-2 hover:bg-[#181818] px-1 py-px rounded leading-relaxed">
                  <span className="text-[#1e1e1e] select-none whitespace-nowrap text-caption flex-shrink-0">{log.timestamp}</span>
                  <span className={`text-caption uppercase select-none w-[52px] flex-shrink-0 ${s.tag}`}>[{log.level}]</span>
                  <span className={`flex-1 break-all whitespace-pre-wrap ${s.line}`}>{tr(log.message)}</span>
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
};

export default ProgressView;
