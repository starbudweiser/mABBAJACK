import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/api';
import { useI18n } from '../locales';
import { MANUAL_UI } from '../locales/uiExtra';
import { ModlistArchive } from '../types/wabbajack';

interface ManualDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  missingArchives: ModlistArchive[];
  downloadsPath: string;
  onScanDownloads: () => void;
  isScanning: boolean;
}

function formatBytes(bytes: number, fr: boolean): string {
  const mbUnit = fr ? 'Mo' : 'MB';
  const gbUnit = fr ? 'Go' : 'GB';
  if (!bytes || bytes <= 0) return `0 ${mbUnit}`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} ${mbUnit}`;
  return `${(mb / 1024).toFixed(1)} ${gbUnit}`;
}

export const ManualDownloadModal: React.FC<ManualDownloadModalProps> = ({
  isOpen,
  onClose,
  missingArchives,
  downloadsPath,
  onScanDownloads,
  isScanning,
}) => {
  const { language } = useI18n();
  const ui = MANUAL_UI[language] ?? MANUAL_UI.fr;
  const isFr = language === 'fr';
  const [search, setSearch] = useState('');
  const [nxmStatus, setNxmStatus] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Appli qui reçoit les liens nxm:// sur ce Mac : prévenir si ce n'est pas mABBAJACK
  const [nxmOwner, setNxmOwner] = useState<{ isDefault: boolean; current: string } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${getApiBaseUrl()}/api/nexus/nxm-handler`).then((r) => r.json()).then(setNxmOwner).catch(() => setNxmOwner(null));
  }, [isOpen]);
  const claimNxm = async () => {
    try { setNxmOwner(await (await fetch(`${getApiBaseUrl()}/api/nexus/nxm-handler`, { method: 'POST' })).json()); } catch { /* rien */ }
  };

  // Fichiers reçus par les liens nxm:// pendant que la fenêtre est ouverte : nouvelle vérification à chaque arrivée.
  useEffect(() => {
    if (!isOpen) return;
    const sse = new EventSource(`${getApiBaseUrl()}/api/install/stream`);
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'nxm') return;
        const { status, name = '', error = '' } = data.nxm || {};
        if (status === 'downloading') setNxmStatus({ kind: 'info', text: ui.nxmDownloading.replace('{name}', name) });
        else if (status === 'done') { setNxmStatus({ kind: 'success', text: ui.nxmDone.replace('{name}', name) }); onScanDownloads(); }
        else if (status === 'error') setNxmStatus({ kind: 'error', text: ui.nxmError.replace('{error}', error) });
      } catch { /* message d'un autre type */ }
    };
    return () => sse.close();
  }, [isOpen, ui, onScanDownloads]);

  if (!isOpen) return null;

  const totalMissingSize = missingArchives.reduce((acc, a) => acc + (a.Size || 0), 0);

  const filteredArchives = missingArchives.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (a.Name || '').toLowerCase().includes(q) || (a.Hash && a.Hash.toLowerCase().includes(q));
  });

  const getNexusDownloadUrl = (archive: ModlistArchive): string | null => {
    const state = archive.State;
    if (!state) return null;

    if (state.Url) return state.Url;

    if (state.ModID && state.FileID) {
      const game = state.GameName || 'skyrimspecialedition';
      return `https://www.nexusmods.com/${game}/mods/${state.ModID}?tab=files&file_id=${state.FileID}&nmm=1`;
    }

    if (state.ModID) {
      const game = state.GameName || 'skyrimspecialedition';
      return `https://www.nexusmods.com/${game}/mods/${state.ModID}?tab=files`;
    }

    return null;
  };

  const handleCopyPath = async () => {
    if (!downloadsPath) return;
    try {
      await navigator.clipboard.writeText(downloadsPath);
      alert(`${ui.pathCopied}\n${downloadsPath}`);
    } catch {
      alert(downloadsPath);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#2e2e2e] rounded-2xl max-w-4xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="p-4 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0369a1]/20 border border-[#0ea5e9]/40 flex items-center justify-center text-[#38bdf8] text-lg">
              📥
            </div>
            <div>
              <h2 className="text-title font-bold text-white flex items-center gap-2">
                <span>{ui.title}</span>
                <span className="text-caption font-mono px-2 py-0.5 rounded-full bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30">
                  {ui.missingCount
                    .replace('{n}', String(missingArchives.length))
                    .replace('{size}', formatBytes(totalMissingSize, isFr))}
                </span>
              </h2>
              <p className="text-meta text-[#8f8f8f]">{ui.subtitle}</p>
              <p className="text-meta text-[#8f8f8f] mt-1">{ui.nxmHint}</p>
              {nxmOwner && !nxmOwner.isDefault && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-meta text-[#f59e0b]">{ui.nxmOther.replace('{app}', nxmOwner.current || '?')}</p>
                  <button onClick={claimNxm} className="text-meta px-2 py-0.5 rounded border border-[#f59e0b] text-[#f59e0b] hover:bg-[#f59e0b]/10">{ui.nxmClaim}</button>
                </div>
              )}
              {nxmStatus && (
                <p className={`text-meta mt-1 ${nxmStatus.kind === 'error' ? 'text-[#f87171]' : nxmStatus.kind === 'success' ? 'text-[#4ade80]' : 'text-[#0ea5e9]'}`}>{nxmStatus.text}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={ui.close}
            className="w-8 h-8 rounded-lg bg-[#222222] hover:bg-[#303030] text-[#8f8f8f] hover:text-white flex items-center justify-center text-body-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filter */}
        <div className="p-3 bg-[#181818] border-b border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[240px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ui.search}
              className="w-full h-8 px-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-body text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onScanDownloads}
              disabled={isScanning}
              className="h-8 px-3 bg-[#262626] hover:bg-[#404040] border border-[#444444] text-white rounded-lg text-body font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span>🔄</span>
              <span>{isScanning ? ui.scanning : ui.verify}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyPath}
              disabled={!downloadsPath}
              className="h-8 px-3 bg-[#1e1e1e] hover:bg-[#2c2c2c] border border-[#333333] text-[#aaaaaa] hover:text-white rounded-lg text-body font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span>📋</span>
              <span>{ui.copyPath}</span>
            </button>
          </div>
        </div>

        {/* Archives List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredArchives.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <span className="text-3xl mb-2">🎉</span>
              <h3 className="text-title font-bold text-white">{ui.allReady}</h3>
              <p className="text-body text-[#666666] mt-1">{ui.noMatch}</p>
            </div>
          ) : (
            filteredArchives.map((archive) => {
              const isGame = archive.sourceKind === 'game';
              const url = isGame ? null : getNexusDownloadUrl(archive);
              return (
                <div
                  key={(archive.Hash || '') + archive.Name}
                  className={`bg-[#181818] border ${isGame ? 'border-[#f59e0b]/40' : 'border-[#2e2e2e]'} hover:border-[#333333] rounded-xl p-3 flex items-center justify-between gap-4 transition-all`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-body-lg font-semibold text-white truncate">{archive.Name}</span>
                      <span className="text-caption font-mono px-2 py-0.5 rounded bg-[#262626] text-[#aaaaaa]">
                        {formatBytes(archive.Size, isFr)}
                      </span>
                      {isGame && (
                        <span className="text-caption font-semibold px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40">
                          🎮 {ui.gameFile}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-meta text-[#666666] mt-1">
                      {archive.Hash && (
                        <span className="font-mono text-caption text-[#666666]">
                          Hash: {archive.Hash.slice(0, 16)}…
                        </span>
                      )}
                      {archive.State?.ModID && (
                        <span>Mod ID: <strong className="text-[#aaaaaa]">{archive.State.ModID}</strong></span>
                      )}
                      {archive.State?.FileID && (
                        <span>File ID: <strong className="text-[#aaaaaa]">{archive.State.FileID}</strong></span>
                      )}
                      {archive.State?.Author && (
                        <span>{ui.author} : <strong className="text-[#aaaaaa]">{archive.State.Author}</strong></span>
                      )}
                    </div>

                    {isGame && (
                      <div className="mt-1 text-body text-[#d97706] space-y-0.5">
                        {archive.expectedPath && (
                          <div className="font-mono text-caption break-all">
                            {ui.expectedAt} {archive.expectedPath}
                          </div>
                        )}
                        <div>{ui.gameFileHint}</div>
                      </div>
                    )}
                  </div>

                  {!isGame && (
                    <div className="flex items-center gap-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 px-3 bg-[#0369a1]/20 hover:bg-[#0369a1]/30 border border-[#0ea5e9]/50 text-[#38bdf8] rounded-lg text-body font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span>🔗</span>
                          <span>Nexus Mods</span>
                        </a>
                      ) : (
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(archive.Name + ' Skyrim mod')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 px-3 bg-[#262626] hover:bg-[#303030] text-[#aaaaaa] hover:text-white rounded-lg text-body font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span>🔍</span>
                          <span>{ui.googleSearch}</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#181818] border-t border-[#2e2e2e] flex items-center justify-between">
          <div className="text-meta text-[#666666] flex items-center gap-2">
            <span>💡</span>
            <span>{ui.footer}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#222222] hover:bg-[#303030] text-white rounded-lg text-body font-semibold transition-colors cursor-pointer"
          >
            {ui.close}
          </button>
        </div>
      </div>
    </div>
  );
};
export default ManualDownloadModal;
