import React, { useEffect, useState } from 'react';
import { useI18n } from '../locales';
import { CLEANUP_UI } from '../locales/uiExtra';
import { findUnusedDownloads, trashDownloads, UnusedDownloads } from '../services/api';
import { btn } from '../design';

interface Props {
  downloadsPath: string;
  destPath: string;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const SHOWN = 50;

function formatBytes(bytes: number, fr: boolean): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ${fr ? 'Go' : 'GB'}`;
  return `${Math.round(bytes / (1024 * 1024))} ${fr ? 'Mo' : 'MB'}`;
}

/** Paramètres : archives de DOWNLOADS inutilisées par les listes installées → Corbeille. */
export const DownloadsCleanup: React.FC<Props> = ({ downloadsPath, destPath }) => {
  const { language } = useI18n();
  const ui = CLEANUP_UI[language] ?? CLEANUP_UI.fr;
  const fr = language === 'fr';
  const [result, setResult] = useState<UnusedDownloads | null>(null);
  const [busy, setBusy] = useState<'scan' | 'trash' | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Dossiers modifiés : l'analyse précédente ne vaut plus
  useEffect(() => { setResult(null); setMessage(''); setConfirming(false); }, [downloadsPath, destPath]);

  const scan = async () => {
    setBusy('scan'); setMessage(''); setConfirming(false);
    try { setResult(await findUnusedDownloads(downloadsPath, destPath)); }
    catch (e: any) { setResult(null); setMessage(fill(ui.error, { msg: String(e.message || e) })); }
    finally { setBusy(null); }
  };

  const trash = async () => {
    if (!result?.unused.length) return;
    setConfirming(false);
    setBusy('trash');
    try {
      const r = await trashDownloads(result.unused.flatMap((u) => (u.meta ? [u.path, u.meta] : [u.path])));
      setResult(null);
      setMessage(fill(ui.moved, { n: r.moved }));
    } catch (e: any) { setMessage(fill(ui.error, { msg: String(e.message || e) })); }
    finally { setBusy(null); }
  };

  const canScan = !!downloadsPath.trim() && !!destPath.trim() && !busy;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-white block font-medium">{ui.title}</span>
          <span className="text-caption text-[#aaaaaa]">{ui.hint}</span>
        </div>
        <button type="button" className={btn.secondary} onClick={scan} disabled={!canScan}>
          {busy === 'scan' ? ui.scanning : ui.scan}
        </button>
      </div>

      {result && (
        <div className="flex flex-col gap-1.5 text-body">
          {result.blocked === 'no-install' && <span className="text-[#fbbf24]">{ui.noInstall}</span>}
          {result.blocked === 'legacy' && <span className="text-[#fbbf24] break-all">{fill(ui.legacy, { dirs: result.legacy.map((d) => d.split('/').pop()).join(', ') })}</span>}
          {result.installs.length > 0 && (
            <span className="text-caption text-[#aaaaaa]">{fill(ui.lists, { names: result.installs.map((i) => `${i.name} ${i.version}`).join(', ') })}</span>
          )}
          {!result.blocked && (result.unused.length === 0 ? <span className="text-[#4ade80]">{ui.none}</span> : (
            <>
              <details>
                <summary className="cursor-pointer select-none text-white">{fill(ui.found, { n: result.unused.length, size: formatBytes(result.totalSize, fr) })}</summary>
                <ul className="mt-1 ml-4 flex flex-col gap-0.5 text-caption text-[#cccccc] max-h-48 overflow-y-auto font-mono">
                  {result.unused.slice(0, SHOWN).map((u) => <li key={u.path} className="break-all">{u.name} <span className="text-[#707070]">({formatBytes(u.size, fr)})</span></li>)}
                  {result.unused.length > SHOWN && <li className="text-[#707070]">{fill(ui.more, { n: result.unused.length - SHOWN })}</li>}
                </ul>
              </details>
              {confirming ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[#fbbf24] whitespace-pre-line">{fill(ui.confirm, { n: result.unused.length, size: formatBytes(result.totalSize, fr) })}</span>
                  <div className="flex gap-2">
                    <button type="button" className={btn.danger} onClick={trash} disabled={!!busy}>{fill(ui.trash, { n: result.unused.length })}</button>
                    <button type="button" className={btn.secondary} onClick={() => setConfirming(false)}>{ui.cancel}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" className={btn.danger} onClick={() => setConfirming(true)} disabled={!!busy}>
                    {busy === 'trash' ? ui.trashing : fill(ui.trash, { n: result.unused.length })}
                  </button>
                </div>
              )}
            </>
          ))}
        </div>
      )}
      {message && <span className="text-caption text-[#aaaaaa] block">{message}</span>}
    </div>
  );
};

export default DownloadsCleanup;
