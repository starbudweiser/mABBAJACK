import React, { useEffect, useState } from 'react';
import { useI18n } from '../locales';
import { UPDATE_UI } from '../locales/uiExtra';
import { adoptInstalled, compareInstalled, pickNativeFile } from '../services/api';
import { InstalledComparison, UpdateRequest } from '../types/wabbajack';
import { badge, btn, card, sectionLabel } from '../design';

interface Props {
  /** Chemin local du .wabbajack chargé */
  filePath?: string;
  /** Dossier READY TO PLAY (parent des installations) */
  destPath?: string;
  /** Absent = affichage seul (Inspecteur) ; présent = choix du mode mise à jour (Installation) */
  value?: UpdateRequest | null;
  onChange?: (v: UpdateRequest | null) => void;
}

// Une comparaison par (fichier, dossier, ancienne version) : partagée entre l'Inspecteur et l'Installation
const cache = new Map<string, Promise<InstalledComparison>>();
export function compare(filePath: string, destPath: string, previousFile?: string, fresh = false) {
  const key = `${filePath}\n${destPath}\n${previousFile ?? ''}`;
  if (fresh || !cache.has(key)) {
    const p = compareInstalled(filePath, destPath, previousFile);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

function formatBytes(bytes: number, fr: boolean): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ${fr ? 'Go' : 'GB'}`;
  return `${Math.round(bytes / (1024 * 1024))} ${fr ? 'Mo' : 'MB'}`;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

const NameList: React.FC<{ title: string; items: React.ReactNode[]; total: number; more: string; color: string }> = ({ title, items, total, more, color }) => {
  if (total === 0) return null;
  return (
    <details className="text-body">
      <summary className="cursor-pointer select-none" style={{ color }}>{title}</summary>
      <ul className="mt-1 ml-4 flex flex-col gap-0.5 text-caption text-[#cccccc] max-h-64 overflow-y-auto">
        {items.map((it, i) => <li key={i}>{it}</li>)}
        {total > items.length && <li className="text-[#707070]">{fill(more, { n: total - items.length })}</li>}
      </ul>
    </details>
  );
};

/** Liste déjà installée : nouvelle version, différences avec l'installation, mode mise à jour. */
export const UpdateCard: React.FC<Props> = ({ filePath, destPath, value, onChange }) => {
  const { language } = useI18n();
  const ui = UPDATE_UI[language] ?? UPDATE_UI.fr;
  const fr = language === 'fr';
  const interactive = !!onChange;

  const [result, setResult] = useState<InstalledComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previousFile, setPreviousFile] = useState<string | undefined>(undefined);
  const [adoptMsg, setAdoptMsg] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { setPreviousFile(undefined); setAdoptMsg(''); }, [filePath, destPath]);

  useEffect(() => {
    setResult(null);
    setError('');
    if (!filePath || !destPath) { onChange?.(null); return; }
    let cancelled = false;
    setLoading(true);
    compare(filePath, destPath, previousFile, refresh > 0)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        // Installation trouvée : mise à jour proposée par défaut
        onChange?.(r.installed ? { dir: r.installed.dir, previousFile: r.previousFile } : null);
      })
      .catch((e) => { if (!cancelled) { setError(String(e.message || e)); onChange?.(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, destPath, previousFile, refresh]);

  if (!filePath || !destPath) return null;
  if (loading) return <div className={card}><span className="text-body text-[#aaaaaa]">{ui.checking}</span></div>;
  if (error) return <div className={card}><span className="text-body text-[#f87171]">{fill(ui.error, { msg: error })}</span></div>;
  if (!result?.installed) return null;

  const inst = result.installed;
  const diff = result.diff;
  const pickPrevious = async () => {
    const r = await pickNativeFile(ui.pickPreviousTitle);
    if (r.path) setPreviousFile(r.path);
  };
  const adopt = async () => {
    try {
      const r = await adoptInstalled(filePath, inst.dir);
      setAdoptMsg(fill(ui.adopted, { n: r.files }));
      setRefresh((n) => n + 1);
    } catch (e: any) { setAdoptMsg(fill(ui.error, { msg: String(e.message || e) })); }
  };

  const headline = result.status === 'same' ? fill(ui.same, { v: result.version })
    : result.status === 'update' ? fill(ui.update, { old: result.previousVersion || inst.version || '?', new: result.version })
    : fill(ui.unknown, { old: inst.version || '?' });
  const sameNumber = result.status === 'update' && (result.previousVersion || inst.version) === result.version;

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className={sectionLabel}><span>🔄</span><span>{ui.title}</span></span>
        <span className={result.status === 'same' ? badge.green : badge.amber}>v{result.version}</span>
      </div>
      <div className="flex flex-col gap-1 text-body">
        <span className="text-white font-semibold">{headline}</span>
        {sameNumber && <span className="text-[#fbbf24]">{ui.sameVersionNumber}</span>}
        <span className="text-caption text-[#aaaaaa] font-mono break-all">{fill(ui.installedIn, { dir: inst.dir })}</span>
        <span className="text-caption text-[#aaaaaa]">
          {result.baseline === 'snapshot' ? ui.baseSnapshot
            : result.baseline === 'previous-wabbajack' ? fill(ui.basePrevious, { file: (result.previousFile || '').split('/').pop() || '' })
            : ui.baseDisk}
        </span>
      </div>

      {diff && (
        <div className="flex flex-col gap-1.5">
          <NameList title={fill(ui.modsChanged, { n: diff.mods.changedCount })} total={diff.mods.changedCount} more={ui.more} color="#fbbf24"
            items={diff.mods.changed.map((m) => (
              <span>
                <span className="text-white">{m.name}</span>
                <span className="text-[#707070]"> — +{m.added} −{m.removed} ~{m.changed}</span>
                {(m.archivesBefore.length > 0 || m.archivesAfter.length > 0) && (
                  <span className="block ml-3 text-[#888888] font-mono">{m.archivesBefore.join(', ') || '∅'} → {m.archivesAfter.join(', ') || '∅'}</span>
                )}
              </span>
            ))} />
          <NameList title={fill(ui.modsAdded, { n: diff.mods.addedCount })} total={diff.mods.addedCount} more={ui.more} color="#4ade80"
            items={diff.mods.added.map((m) => <span><span className="text-white">{m.name}</span><span className="text-[#707070]"> — {m.files} · {formatBytes(m.size, fr)}</span></span>)} />
          <NameList title={fill(ui.modsRemoved, { n: diff.mods.removedCount })} total={diff.mods.removedCount} more={ui.more} color="#f87171"
            items={diff.mods.removed.map((m) => <span><span className="text-white">{m.name}</span><span className="text-[#707070]"> — {m.files}</span></span>)} />
          <span className="text-caption text-[#aaaaaa]">{fill(ui.modsUnchanged, { n: diff.mods.unchangedCount })}</span>
          <span className="text-caption text-[#aaaaaa]">{fill(ui.files, { a: diff.files.added, r: diff.files.removed, c: diff.files.changed, u: diff.files.unchanged })}</span>
          <NameList title={fill(ui.archives, { a: diff.archives.addedCount, size: formatBytes(diff.archives.downloadSize, fr), r: diff.archives.removedCount })}
            total={diff.archives.addedCount} more={ui.more} color="#aaaaaa"
            items={diff.archives.added.map((a) => <span className="font-mono">{a.name} <span className="text-[#707070]">({formatBytes(a.size, fr)})</span></span>)} />
        </div>
      )}

      {interactive && result.status === 'unknown' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={pickPrevious}>{ui.pickPrevious}</button>
          <button type="button" className={btn.secondary} onClick={adopt} title={ui.adoptHint}>{ui.adopt}</button>
        </div>
      )}
      {adoptMsg && <span className="text-caption text-[#aaaaaa]">{adoptMsg}</span>}

      {interactive && (
        <label className="flex items-start gap-2 text-body cursor-pointer">
          <input type="checkbox" className="mt-1" checked={!!value}
            onChange={(e) => onChange!(e.target.checked ? { dir: inst.dir, previousFile: result.previousFile } : null)} />
          <span className="flex flex-col">
            <span className="text-white font-semibold">{ui.toggle}</span>
            <span className="text-caption text-[#aaaaaa]">{result.status === 'same' ? ui.repairHint : ui.toggleHint}</span>
          </span>
        </label>
      )}
    </div>
  );
};

export default UpdateCard;
