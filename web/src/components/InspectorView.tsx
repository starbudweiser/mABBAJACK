import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../locales';
import { btn, badge, Divider } from '../design';
import { ParsedWabbajackFile, ModlistArchive } from '../types/wabbajack';
import { useTranslated } from '../hooks/useTranslated';
import { INSPECTOR_UI, fmtBytes } from '../locales/uiScreens';
import { SCAN_UI } from '../locales/uiExtra';
import type { ScanProgress } from '../services/api';

interface InspectorViewProps {
  parsedFile: ParsedWabbajackFile | null;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  onProceedToInstall: () => void;
  onOpenPluginsTxt?: () => void;
  onPickNativeFile?: () => void;
  isLoading: boolean;
  /** Scan du dossier de téléchargement en cours + sa progression */
  isScanning?: boolean;
  scanProgress?: ScanProgress | null;
  downloadsPath?: string;
}


/** Affiche la description traduite avec un spinner de chargement */
const DescriptionSpan: React.FC<{ description: string; language: string }> = ({ description, language }) => {
  // Le serveur découpe le texte en blocs adaptés à l'API de traduction
  const MAX = 20000;
  const truncated = description.length > MAX ? description.slice(0, MAX).trimEnd() + '…' : description;
  const { translated, loading } = useTranslated(truncated, language);
  return (
    <>
      <span>{translated}</span>
      {loading && (
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          border: '2px solid #38bdf8', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', flexShrink: 0 }} />
      )}
    </>
  );
};

export const InspectorView: React.FC<InspectorViewProps> = ({
  parsedFile,
  onLoadFile,
  onLoadDemo,
  onProceedToInstall,
  onOpenPluginsTxt,
  onPickNativeFile,
  isLoading,
  isScanning = false,
  scanProgress = null,
  downloadsPath = '',
}) => {
  const { t, language } = useI18n();
  const ui = INSPECTOR_UI[language] ?? INSPECTOR_UI.fr;
  const scanUi = SCAN_UI[language] ?? SCAN_UI.fr;
  const [descOpen, setDescOpen] = useState(false);
  const scanPhase = scanProgress?.phase ?? 'list';
  const scanTotal = scanProgress?.total ?? 0;
  // Pourcentage seulement quand le total est connu (phase de correspondance) ; sinon barre animée
  const scanPct = scanPhase === 'match' && scanTotal > 0 ? Math.min(100, Math.round(((scanProgress?.done ?? 0) / scanTotal) * 100)) : null;
  const formatBytes = (b: number) => fmtBytes(b, language);
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'ready' | 'missing'>('all');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'archives' | 'directives' | 'plugins'>('archives');
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  // Native window-level drag & drop — works reliably in Electron/WebView
  // where React synthetic events may lose dataTransfer by the time they fire.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      setIsDragActive(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragActive(false); }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.toLowerCase().endsWith('.wabbajack') || file.name.toLowerCase().endsWith('.zip'))) {
        onLoadFile(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onLoadFile]);

  const filteredArchives = useMemo(() => {
    if (!parsedFile) return [];
    return parsedFile.archives.filter((a) => {
      if (archiveFilter === 'ready' && a.status !== 'ready') return false;
      if (archiveFilter === 'missing' && a.status === 'ready') return false;
      if (archiveSearch.trim()) {
        const q = archiveSearch.toLowerCase();
        return a.Name.toLowerCase().includes(q) || (a.Hash && a.Hash.toLowerCase().includes(q));
      }
      return true;
    });
  }, [parsedFile, archiveFilter, archiveSearch]);

  const readyCount = useMemo(() => {
    if (!parsedFile) return 0;
    return parsedFile.archives.filter((a) => a.status === 'ready').length;
  }, [parsedFile]);

  const missingCount = useMemo(() => {
    if (!parsedFile) return 0;
    return parsedFile.archives.length - readyCount;
  }, [parsedFile, readyCount]);

  if (!parsedFile) {
    return (
      <div
        ref={dropZoneRef}
        className="flex-1 flex flex-col items-center justify-center p-6 bg-[#181818] overflow-y-auto"
      >
        <div className="max-w-xl w-full bg-[#181818] border border-[#2e2e2e] rounded-xl shadow-2xl p-8 flex flex-col items-center text-center">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#262626] to-[#181818] border border-[#444444] flex items-center justify-center text-3xl mb-4 shadow-inner">
            🔍
          </div>

          <h2 className="text-heading font-bold text-white mb-1">{t.inspector.title}</h2>
          <p className="text-body text-[#8f8f8f] max-w-md mb-6 leading-relaxed">
            {t.inspector.subtitle}
          </p>

          {/* Drag & Drop Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 group ${
              isDragActive
                ? 'border-[#0ea5e9] bg-[#0369a1]/10 shadow-[0_0_20px_rgba(14,165,233,0.3)]'
                : 'border-[#333333] hover:border-[#0ea5e9] bg-[#181818] hover:bg-[#181818]'
            }`}
          >
            <span className={`text-4xl transition-transform ${isDragActive ? 'scale-125 text-[#38bdf8]' : 'group-hover:scale-110'}`}>
              📂
            </span>
            <div className="space-y-1">
              <span className="text-body-lg font-semibold text-white block group-hover:text-[#38bdf8]">
                {isDragActive ? ui.dropRelease : t.inspector.dropModlist}
              </span>
              <span className="text-meta text-[#666666] block font-mono">
                {t.inspector.supportedExt}
              </span>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onPickNativeFile) { onPickNativeFile(); } else { fileInputRef.current?.click(); }
              }}
              className={`mt-2 ${btn.secondary}`}
            >
              <span>📁</span><span>{ui.browseFile}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".wabbajack,.zip"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  onLoadFile(e.target.files[0]);
                }
              }}
            />
          </div>

          {/* Demo Button */}
          <div className="mt-5 pt-4 border-t border-[#2e2e2e] w-full flex items-center justify-center gap-2">
            <span className="text-meta text-[#666666]">{t.inspector.orChooseDemo}</span>
            <button type="button" onClick={onLoadDemo} disabled={isLoading} className={btn.ghost}>
              {t.inspector.loadPhoenixDemo}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden bg-[#181818]"
    >
      {/* Hidden file input for reloading */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wabbajack,.zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            onLoadFile(e.target.files[0]);
          }
        }}
      />

      {/* ── En-tête : identité de la modlist (gauche) + actions (droite), description dessous ── */}
      <div className="px-5 pt-4 pb-3 bg-[#181818] border-b border-[#2e2e2e] space-y-2.5 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-heading font-bold text-white leading-tight">{parsedFile.name}</h2>
              <span className="px-2 py-0.5 rounded text-caption font-mono font-bold bg-[#0369a1]/20 text-[#38bdf8] border border-[#0ea5e9]/30">
                v{parsedFile.version || '1.0'}
              </span>
              <span className="px-2 py-0.5 rounded text-caption font-mono font-medium bg-[#1e1e1e] text-[#aaaaaa] border border-[#2e2e2e]">
                {parsedFile.gameType || 'Skyrim SE'}
              </span>
            </div>
            <p className="text-body text-[#8f8f8f] mt-1">
              {ui.createdBy} <strong className="text-[#dddddd]">{parsedFile.author}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {onOpenPluginsTxt && (
              <button type="button" onClick={onOpenPluginsTxt} className={btn.secondary}>
                <span>📄</span><span>plugins.txt</span>
              </button>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()} className={btn.ghost}>
              <span>🔄</span><span>{ui.change}</span>
            </button>
            <Divider />
            <button
              type="button"
              onClick={onProceedToInstall}
              className={parsedFile?.localFilePath ? btn.primary : btn.warning ?? btn.secondary}
              title={!parsedFile?.localFilePath ? ui.demoTooltip : ''}
            >
              <span>📦</span>
              <span>{t.inspector.startInstallWithModlist}</span>
              {!parsedFile?.localFilePath && <span style={{ fontSize: 'calc(10px * var(--text-scale))', opacity: 0.8, marginLeft: 2 }}>{ui.demoBadge}</span>}
            </button>
          </div>
        </div>

        {parsedFile.description && (
          <div className="text-body text-[#8f8f8f] leading-relaxed max-w-5xl">
            <div
              style={descOpen
                ? { maxHeight: 240, overflowY: 'auto', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }
                : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
            >
              <DescriptionSpan description={parsedFile.description} language={language} />
            </div>
            <button
              type="button"
              onClick={() => setDescOpen((v) => !v)}
              className="mt-0.5 text-body text-[#38bdf8] hover:text-[#38bdf8] cursor-pointer bg-transparent border-0 p-0"
            >
              {descOpen ? scanUi.showLess : scanUi.showMore}
            </button>
          </div>
        )}
      </div>

      {/* ── Scan du dossier de téléchargement : progression visible tant qu'il tourne ── */}
      {isScanning && (
        <div className="px-5 py-2.5 bg-[#181818] border-b border-[#0369a1] flex-shrink-0" role="status" aria-live="polite" id="scan-progress-banner">
          <div className="flex items-center justify-between gap-3 text-body">
            <span className="text-[#bae6fd] flex items-center gap-2">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #38bdf8', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
              {scanPhase === 'match' ? scanUi.matching : scanUi.listing}
              {scanPhase === 'match' && scanTotal > 0 && (
                <span className="font-mono text-[#38bdf8]">{scanProgress?.done.toLocaleString()} / {scanTotal.toLocaleString()}</span>
              )}
            </span>
            <span className="font-mono font-bold text-[#38bdf8]">{scanPct !== null ? `${scanPct} %` : '…'}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[#181818] border border-[#0369a1] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanPct ?? undefined}>
            {scanPct !== null ? (
              <div className="h-full rounded-full bg-gradient-to-r from-[#0369a1] to-[#0369a1] transition-[width] duration-200" style={{ width: `${scanPct}%` }} />
            ) : (
              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#0369a1] to-[#0369a1]" style={{ animation: 'importSlide 1.2s ease-in-out infinite alternate' }} />
            )}
          </div>
          <p className="mt-1 text-caption text-[#38bdf8]">{scanUi.hint}</p>
          <style>{'@keyframes importSlide { from { margin-left: 0 } to { margin-left: 66% } }'}</style>
        </div>
      )}

      {/* ── Métriques ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-5 py-3.5 bg-[#181818] border-b border-[#2e2e2e] flex-shrink-0">
        <div className="bg-[#181818] p-3 rounded-lg border border-[#2e2e2e]">
          <span className="text-caption text-[#666666] uppercase font-mono block">{ui.requiredArchives}</span>
          <span className="text-heading font-bold text-white font-mono mt-0.5 block">{parsedFile.numberOfArchives.toLocaleString()}</span>
          <span className="text-caption text-[#38bdf8]">{ui.totalSize} {formatBytes(parsedFile.totalArchiveSize)}</span>
        </div>

        <div className="bg-[#181818] p-3 rounded-lg border border-[#2e2e2e]">
          <span className="text-caption text-[#666666] uppercase font-mono block">{ui.directives}</span>
          <span className="text-heading font-bold text-white font-mono mt-0.5 block">{parsedFile.numberOfDirectives.toLocaleString()}</span>
          <span className="text-caption text-[#38bdf8]">{ui.installedSize} {formatBytes(parsedFile.totalInstalledSize)}</span>
        </div>

        <div className="bg-[#181818] p-3 rounded-lg border border-[#2e2e2e]">
          <span className="text-caption text-[#666666] uppercase font-mono block">{ui.inlined}</span>
          <span className="text-heading font-bold text-white font-mono mt-0.5 block">{parsedFile.inlinedFilesCount.toLocaleString()}</span>
          <span className="text-caption text-[#4ade80]">{ui.inlinedDesc}</span>
        </div>

        <div className="bg-[#181818] p-3 rounded-lg border border-[#2e2e2e]">
          <span className="text-caption text-[#666666] uppercase font-mono block">{ui.patches}</span>
          <span className="text-heading font-bold text-white font-mono mt-0.5 block">{parsedFile.patchesCount.toLocaleString()}</span>
          <span className="text-caption text-[#fbbf24]">{ui.patchesDesc}</span>
        </div>

        {/* Disponibilité locale des archives (résultat du scan) */}
        <div className="bg-[#181818] p-3 rounded-lg border border-[#2e2e2e] col-span-2 lg:col-span-1">
          <span className="text-caption text-[#666666] uppercase font-mono block">{scanUi.availability}</span>
          {!downloadsPath ? (
            <span className="text-body text-[#aaaaaa] mt-1 block leading-snug">{scanUi.noFolder}</span>
          ) : (
            <>
              <span className="text-heading font-bold font-mono mt-0.5 block text-white">
                {isScanning ? '…' : `${readyCount.toLocaleString()} / ${parsedFile.archives.length.toLocaleString()}`}
              </span>
              <div className="h-1.5 mt-1 rounded-full bg-[#181818] overflow-hidden">
                <div className="h-full rounded-full bg-[#22c55e] transition-[width] duration-300"
                  style={{ width: `${parsedFile.archives.length ? Math.round((readyCount / parsedFile.archives.length) * 100) : 0}%` }} />
              </div>
              <span className={`text-caption mt-1 block ${missingCount > 0 ? 'text-[#f87171]' : 'text-[#4ade80]'}`}>
                {isScanning ? scanUi.scanning : scanUi.missingN.replace('{n}', missingCount.toLocaleString())}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Tabs Toolbar */}
      <div className="px-4 py-2.5 bg-[#181818] border-b border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-0.5 bg-[#1a1a1a] border border-[#2e2e2e] p-1 rounded-lg">
          {([
            ['archives', `${ui.tabArchives} (${parsedFile.archives.length})`],
            ['directives', `${ui.tabDirectives} (${parsedFile.numberOfDirectives ?? parsedFile.directives.length})`],
            ['plugins', `${ui.tabPlugins} (${parsedFile.loadOrder?.length || 7})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSubTab(id)}
              className={`px-3 py-1 rounded text-body font-semibold cursor-pointer transition-all ${
                activeSubTab === id ? 'bg-[#0369a1] text-white shadow-sm' : 'text-[#aaaaaa] hover:text-white hover:bg-[#262626]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeSubTab === 'archives' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#1a1a1a] border border-[#2e2e2e] p-0.5 rounded-lg text-body">
              {([
                ['all', `${ui.all} (${parsedFile.archives.length})`, 'text-white', 'bg-[#2c2c2c]'],
                ['ready', `${ui.ready} (${readyCount})`,          'text-[#4ade80]', 'bg-[#262626]'],
                ['missing', `${ui.missing} (${missingCount})`,  'text-[#f87171]', 'bg-[#1e1e1e]'],
              ] as const).map(([k, label, activeC, activeBg]) => (
                <button key={k} type="button" onClick={() => setArchiveFilter(k)}
                  className={`px-2 py-0.5 rounded cursor-pointer font-medium transition-colors ${
                    archiveFilter === k ? `${activeC} ${activeBg} font-bold` : 'text-[#666666] hover:text-[#aaaaaa]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="text" value={archiveSearch} onChange={(e) => setArchiveSearch(e.target.value)}
              placeholder={ui.search}
              className="h-7 px-2.5 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-body text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9] w-40 transition-colors"
            />
          </div>
        )}
      </div>

      {/* Subtab Content */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        {activeSubTab === 'archives' && (
          <div className="space-y-2">
            {filteredArchives.map((archive) => (
              <div
                key={archive.Hash + archive.Name}
                className="bg-[#181818] border border-[#2e2e2e] hover:border-[#333333] rounded-xl p-3 flex items-center justify-between gap-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body font-semibold text-white truncate">
                      {archive.Name}
                    </span>
                    <span className="text-caption font-mono px-2 py-0.5 rounded bg-[#222222] text-[#aaaaaa]">
                      {formatBytes(archive.Size)}
                    </span>
                    <span
                      className={`text-caption font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        archive.status === 'ready'
                          ? 'bg-[#262626] text-[#4ade80] border border-[#22c55e]'
                          : 'bg-[#1e1e1e] text-[#f87171] border border-[#ef4444]'
                      }`}
                    >
                      {archive.status === 'ready' ? ui.statusReady : ui.statusMissing}
                    </span>
                  </div>

                  <div className="text-caption text-[#666666] font-mono mt-1 flex items-center gap-3">
                    {archive.Hash && <span>Hash : {archive.Hash.slice(0, 16)}…</span>}
                    {archive.State?.ModID && <span>Mod ID : {archive.State.ModID}</span>}
                    {archive.State?.FileID && <span>File ID : {archive.State.FileID}</span>}
                    {archive.State?.Author && <span>{ui.author} : {archive.State.Author}</span>}
                  </div>
                </div>

                {archive.State?.ModID && archive.State?.FileID && (
                  <a
                    href={`https://www.nexusmods.com/${archive.State.GameName || 'skyrimspecialedition'}/mods/${archive.State.ModID}?tab=files&file_id=${archive.State.FileID}`}
                    target="_blank" rel="noreferrer"
                    className={`${btn.secondary} no-underline flex-shrink-0`}
                  >
                    <span>🔗</span><span>Nexus ↗</span>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {activeSubTab === 'directives' && (
          <div className="space-y-1.5 font-mono text-body">
            {parsedFile.directivesTruncated && (
              <div className="text-body text-[#aaaaaa] font-sans px-1 pb-1">
                {parsedFile.directives.length.toLocaleString()} / {(parsedFile.numberOfDirectives ?? 0).toLocaleString()}
              </div>
            )}
            {parsedFile.directives.map((dir, idx) => (
              <div
                key={idx}
                className="bg-[#181818] border border-[#2e2e2e] p-2 rounded-lg flex items-center justify-between text-body"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-caption px-1.5 py-0.5 rounded bg-[#262626] text-[#38bdf8] font-bold">
                    {dir.$type}
                  </span>
                  <span className="text-white truncate">{dir.To}</span>
                </div>
                <div className="text-[#666666] text-caption flex items-center gap-3 flex-shrink-0">
                  <span>{formatBytes(dir.Size)}</span>
                  {dir.ArchiveHash && (
                    <span className="text-[#aaaaaa]">Src: {dir.ArchiveHash.slice(0, 8)}...</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeSubTab === 'plugins' && (
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-title font-bold text-white flex items-center gap-2">
                  <span>📄</span>
                  <span>{ui.pluginsTitle}</span>
                </h3>
                <p className="text-meta text-[#8f8f8f] mt-0.5">
                  {ui.pluginsDesc}
                </p>
              </div>

              {onOpenPluginsTxt && (
                <button type="button" onClick={onOpenPluginsTxt} className={btn.primary}>
                  <span>📄</span><span>{ui.fullViewer}</span>
                </button>
              )}
            </div>

            <div className="bg-[#181818] border border-[#2e2e2e] rounded-lg p-3 font-mono text-body text-[#dddddd] max-h-96 overflow-y-auto space-y-1">
              {(parsedFile.pluginsTxt || `*Skyrim.esm\n*Update.esm\n*Dawnguard.esm\n*HearthFires.esm\n*Dragonborn.esm\n*Unofficial Skyrim Special Edition Patch.esp\n*SkyUI_SE.esp`).split('\n').map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[#666666] w-6 text-right select-none">{i + 1}</span>
                  <span className={line.endsWith('.esm') ? 'text-[#38bdf8] font-bold' : 'text-[#dddddd]'}>
                    {line}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default InspectorView;
