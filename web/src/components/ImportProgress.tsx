import React, { useEffect, useState } from 'react';
import { useI18n } from '../locales';
import { IMPORT_UI } from '../locales/uiExtra';
import { fmtBytes } from '../locales/uiScreens';

export interface ImportProgressState {
  fileName: string;
  /** upload : envoi du fichier (pourcentage réel) ; analyze : analyse côté serveur (durée inconnue) */
  phase: 'upload' | 'analyze';
  sent: number;
  total: number;
  startedAt: number;
}

/** Jauge modale de chargement d'un .wabbajack (utile pour les fichiers de plusieurs Go). */
export const ImportProgress: React.FC<{ state: ImportProgressState }> = ({ state }) => {
  const { language } = useI18n();
  const ui = IMPORT_UI[language] ?? IMPORT_UI.fr;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const uploading = state.phase === 'upload';
  const pct = uploading && state.total > 0 ? Math.min(100, Math.round((state.sent / state.total) * 100)) : null;
  const seconds = Math.max(0, Math.round((now - state.startedAt) / 1000));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={ui.title}
      id="import-progress-dialog"
    >
      <div className="w-[min(30rem,90vw)] bg-[#181818] border border-[#2e2e2e] rounded-xl shadow-2xl p-6">
        <h2 className="text-sm font-bold text-white mb-1">{ui.title}</h2>
        <p className="text-[11px] text-[#8f8f8f] font-mono truncate mb-4" title={state.fileName}>{state.fileName}</p>

        <div className="flex items-center justify-between text-xs text-[#dddddd] mb-1.5">
          <span>{uploading ? ui.uploading : ui.analyzing}</span>
          <span className="font-mono font-bold text-[#38bdf8]">{pct !== null ? `${pct} %` : '…'}</span>
        </div>

        <div
          className="h-2.5 rounded-full bg-[#181818] border border-[#2e2e2e] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
        >
          {pct !== null ? (
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0369a1] to-[#0369a1] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#0369a1] to-[#0369a1]" style={{ animation: 'importSlide 1.2s ease-in-out infinite alternate' }} />
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#666666] font-mono mt-2">
          <span>{uploading && state.total > 0 ? `${fmtBytes(state.sent, language)} / ${fmtBytes(state.total, language)}` : ''}</span>
          <span>{ui.elapsed.replace('{s}', String(seconds))}</span>
        </div>

        {!uploading && <p className="text-[11px] text-[#aaaaaa] mt-3 leading-relaxed">{ui.analyzingHint}</p>}
      </div>
      <style>{'@keyframes importSlide { from { margin-left: 0 } to { margin-left: 66% } }'}</style>
    </div>
  );
};

export default ImportProgress;
