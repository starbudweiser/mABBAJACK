import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../locales';
import { MAC_UI, fillMac, macText } from '../locales/uiMac';
import { useMabbajack } from '../state/mabbajack';
import { badge, btn, card, sectionLabel } from '../design';
import { BottledJob, MacBottled, MacFixId, MacIniChange, MacPreview, MacReport, MacReportItem, MacText } from '../types/mac';
import { fetchBottledJob, fetchMacPreview, openFolderInFinder, openUrl, startBottledDownload, undoMacFix } from '../services/api';

const STATES_TO_FIX: MacBottled['state'][] = ['stock', 'outdated', 'unknown'];
const titleOf = (id: MacFixId): MacText => ({ key: `mackit.fix.${id}.title` });

/** Détail replié d'un correctif : fichiers touchés et lignes d'INI modifiées. */
const FixDetails: React.FC<{ files: string[]; changes?: MacIniChange[] }> = ({ files, changes }) => {
  const { language } = useI18n();
  const ui = MAC_UI[language] ?? MAC_UI.fr;
  if (!files.length && !changes?.length) return null;
  return (
    <details className="text-meta text-[#8f8f8f]">
      <summary className="cursor-pointer select-none hover:text-white">{ui.details}</summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {changes && changes.length > 0 && (
          <div>
            <span className="text-caption uppercase font-bold text-[#707070]">{ui.lines}</span>
            {changes.map((c) => (
              <code key={`${c.section}.${c.key}`} className="block font-mono text-caption text-[#dddddd] break-all">
                [{c.section}] {c.key} = {c.newValue}{c.oldValue !== undefined ? `   (${c.oldValue})` : ''}
              </code>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div>
            <span className="text-caption uppercase font-bold text-[#707070]">{ui.files}</span>
            {files.map((f) => <code key={f} className="block font-mono text-caption text-[#aaaaaa] break-all">{f}</code>)}
          </div>
        )}
      </div>
    </details>
  );
};

/** Bottled Shaders : état dans le jeu + téléchargement de la dernière version avec la clé Nexus (jamais embarqué). */
export const BottledBlock: React.FC<{ bottled: MacBottled }> = ({ bottled }) => {
  const { language } = useI18n();
  const ui = MAC_UI[language] ?? MAC_UI.fr;
  const m = useMabbajack();
  const [job, setJob] = useState<BottledJob>({ status: 'idle' });
  const busy = job.status === 'looking' || job.status === 'downloading';
  const needsFix = STATES_TO_FIX.includes(bottled.state);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { fetchBottledJob().then(setJob).catch(() => undefined); }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  const start = () => {
    setJob({ status: 'looking' });
    startBottledDownload(m.downloadsPath, m.nexusApiKey).then(setJob).catch(() => setJob({ status: 'error', code: 'failed' }));
  };

  const errorText = (j: Extract<BottledJob, { status: 'error' }>) => ({
    noKey: ui.bottledNoKey, noFolder: ui.bottledNoFolder, noFile: ui.bottledNoFile,
    tooOld: fillMac(ui.bottledTooOld, { version: j.version ?? '?' }), noLink: ui.bottledNoLink, failed: ui.bottledFailed,
  })[j.code];

  return (
    <div className="rounded-lg border border-[#2e2e2e] bg-[#1a1a1a] p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span className={bottled.state === 'ok' ? 'text-[#4ade80]' : needsFix ? 'text-[#fbbf24]' : 'text-[#8f8f8f]'}>{bottled.state === 'ok' ? '✓' : needsFix ? '⚠' : '•'}</span>
        <div className="min-w-0">
          <span className="text-body font-semibold text-white">{ui.bottled}</span>
          <p className="text-body text-[#aaaaaa]">{macText(bottled.text, language)}</p>
        </div>
      </div>
      {needsFix && (
        <div className="flex flex-col gap-2 pl-6">
          {job.status === 'idle' || job.status === 'error' ? (
            <>
              <div><button type="button" className={btn.secondary} onClick={start}>⬇ {fillMac(ui.bottledGet, { version: bottled.minimum })}</button></div>
              {job.status === 'error' && <p className="text-meta text-[#f87171]">{errorText(job)}</p>}
            </>
          ) : job.status === 'looking' ? (
            <p className="text-meta text-[#aaaaaa]">{ui.bottledLooking}</p>
          ) : job.status === 'downloading' ? (
            <div className="flex flex-col gap-1">
              <p className="text-meta text-[#aaaaaa]">{fillMac(ui.bottledProgress, { name: job.name, percent: job.percent })}</p>
              <div className="h-1.5 rounded-full bg-[#262626] overflow-hidden"><div className="h-full rounded-full bg-[#0ea5e9] transition-all" style={{ width: `${job.percent}%` }} /></div>
            </div>
          ) : job.status === 'manual' ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-meta text-[#aaaaaa]">{ui.bottledManual}</p>
              <div><button type="button" className={btn.secondary} onClick={() => openUrl(job.url)}>↗ {ui.bottledOpen}</button></div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-meta text-[#4ade80]">✓ {fillMac(ui.bottledDone, { name: job.name })}</p>
              <p className="text-meta text-[#8f8f8f]">{ui.bottledHint}</p>
              <div><button type="button" className={btn.ghost} onClick={() => openFolderInFinder(job.path.replace(/\/[^/]*$/, ''))}>📂 {ui.bottledShow}</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Carte « Adaptation au Mac » avant l'installation : case cochée par défaut, chaque correctif annoncé (plan du moteur). */
export const MacCard: React.FC = () => {
  const { language } = useI18n();
  const ui = MAC_UI[language] ?? MAC_UI.fr;
  const m = useMabbajack();
  const { parsedFile, destPath, gamePath, updateRequest, macAdapt, setMacAdapt, macBottle, setMacBottle } = m;
  const [preview, setPreview] = useState<MacPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const name = parsedFile?.name || '';
  const file = parsedFile?.localFilePath;
  const updateDir = updateRequest?.dir;
  useEffect(() => {
    if (!name) { setPreview(null); return; }
    const mine = ++seq.current;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetchMacPreview({ destPath, gamePath, modlist: { name, localFilePath: file }, update: updateDir ? { dir: updateDir } : null, bottle: macBottle || undefined }, ctrl.signal)
        .then((p) => { if (mine === seq.current) setPreview(p); })
        .catch(() => { if (mine === seq.current) setPreview(null); })
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [name, file, destPath, gamePath, updateDir, macBottle]);

  if (!parsedFile) return null;
  if (preview && !preview.supported) return null; // hors macOS : pas de carte
  const plan = preview?.plan;
  const future = preview?.target && !preview.target.exists;
  const nothing = plan && !future && plan.fixes.length === 0;

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <span className={sectionLabel}><span>🍎</span><span>{ui.title}</span></span>
        {preview?.target && <span className={badge.blue}>{preview.target.kind === 'install' ? ui.targetInstall : ui.targetGame}</span>}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-[#0ea5e9]" checked={macAdapt} onChange={(e) => setMacAdapt(e.target.checked)} />
        <span className="text-body font-semibold text-white">{ui.adapt}</span>
      </label>
      <p className="text-meta text-[#8f8f8f] -mt-1">{macAdapt ? ui.intro : ui.off}</p>

      {macAdapt && (
        <>
          {loading && !preview && <p className="text-body text-[#aaaaaa]">{ui.loading}</p>}
          {preview && !preview.target && <p className="text-body text-[#fbbf24]">{ui.noTarget}</p>}

          {preview?.target && (
            <div className="text-meta text-[#8f8f8f] flex flex-col gap-1">
              <span>{ui.target} : <code className="font-mono text-[#aaaaaa] break-all">{preview.target.dir}</code></span>
              {preview.bottles && preview.bottles.length > 1 ? (
                <label className="flex items-center gap-2">
                  <span>{ui.bottleLabel} :</span>
                  <select className="h-7 px-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-md text-body text-white" value={preview.bottle?.name || ''} onChange={(e) => setMacBottle(e.target.value)}>
                    {preview.bottles.map((b) => <option key={b.path} value={b.name}>{b.name}</option>)}
                  </select>
                </label>
              ) : (
                <span>{ui.bottle} : {preview.bottle ? <code className="font-mono text-[#aaaaaa]">{preview.bottle.name}</code> : ui.noBottle}</span>
              )}
            </div>
          )}

          {future && <p className="text-body text-[#aaaaaa]">{ui.futureTarget}</p>}
          {nothing && <p className="text-body text-[#4ade80]">✓ {ui.nothing}</p>}

          {plan && plan.fixes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-caption uppercase font-bold text-[#707070]">{ui.willDo}</span>
              {plan.fixes.map((f) => (
                <div key={f.id} className="rounded-lg border border-[#2e2e2e] bg-[#1a1a1a] p-3 flex flex-col gap-1">
                  <span className="text-body font-semibold text-white">{macText(f.title, language)}</span>
                  <p className="text-body text-[#aaaaaa]">{macText(f.detail, language)}</p>
                  <FixDetails files={f.files} changes={f.changes} />
                </div>
              ))}
            </div>
          )}

          {plan && plan.skipped.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-caption uppercase font-bold text-[#707070]">{ui.skippedTitle}</span>
              {plan.skipped.map((s) => (
                <p key={s.id} className="text-meta text-[#8f8f8f]"><span className="text-[#aaaaaa]">{macText(titleOf(s.id), language)}</span> — {macText(s.reason, language)}</p>
              ))}
            </div>
          )}

          {plan && plan.discarded.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-caption uppercase font-bold text-[#707070]">{ui.discardedTitle}</span>
              {plan.discarded.map((d) => (
                <p key={d.file} className="text-meta text-[#8f8f8f]"><code className="font-mono text-[#aaaaaa]">{d.file.split('/').pop()}</code> — {macText(d.reason, language)}</p>
              ))}
            </div>
          )}

          {plan && !future && <BottledBlock bottled={plan.bottled} />}

          {preview?.target && <p className="text-meta text-[#8f8f8f]">{ui.promise}</p>}
        </>
      )}
    </div>
  );
};

const STATUS: Record<MacReportItem['status'], { icon: string; color: string; badge: keyof typeof badge }> = {
  applied: { icon: '✓', color: 'text-[#4ade80]', badge: 'green' },
  failed: { icon: '✕', color: 'text-[#f87171]', badge: 'red' },
  skipped: { icon: '–', color: 'text-[#8f8f8f]', badge: 'muted' },
};

/** Carte « Bilan Mac » après l'installation : appliqué, échoué ou ignoré pour chaque correctif, avec « Annuler ». */
export const MacReportCard: React.FC<{ report: MacReport; children?: React.ReactNode; title?: string; subtitle?: string }> = ({ report, children, title, subtitle }) => {
  const { language } = useI18n();
  const ui = MAC_UI[language] ?? MAC_UI.fr;
  const [items, setItems] = useState<MacReportItem[]>(report.items);
  const [busy, setBusy] = useState<string | null>(null);
  const [undoneCount, setUndoneCount] = useState(0);
  const [refusals, setRefusals] = useState<Record<string, MacText>>({});
  useEffect(() => { setItems(report.items); setUndoneCount(0); setRefusals({}); }, [report]);

  const dir = report.target?.dir;
  const undoable = items.filter((i) => i.undoable);

  const undo = async (id: string) => {
    if (!dir) return;
    setBusy(id);
    try {
      const { fixes, applied } = await undoMacFix(dir, id);
      const restored = new Set(fixes.filter((f) => f.status === 'restored').map((f) => f.id));
      const stillApplied = new Set(applied.map((a) => a.id));
      setRefusals((prev) => {
        const next = { ...prev };
        for (const f of fixes) { if (f.status === 'restored') delete next[f.id]; else next[f.id] = f.text; }
        return next;
      });
      // un correctif annulé disparaît du bilan
      setItems((prev) => prev.filter((i) => !restored.has(i.id)).map((i) => ({ ...i, undoable: i.status === 'applied' && stillApplied.has(i.id) })));
      setUndoneCount((n) => n + restored.size);
    } catch {
      setRefusals((prev) => ({ ...prev, [id]: { key: 'mackit.cli.error' } }));
    } finally { setBusy(null); }
  };

  const appliedLeft = items.some((i) => i.status === 'applied');
  // les fichiers écartés d'un correctif annulé sont revenus : ils ne figurent plus au bilan
  const discarded = report.discarded.filter((d) => items.some((i) => i.id === d.fix && i.status === 'applied'));
  const allUndone = undoneCount > 0 && !appliedLeft && items.every((i) => i.status === 'skipped');

  return (
    <div className={`${card} gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={sectionLabel}><span>🍎</span><span>{title ?? ui.report}</span></span>
          <p className="text-meta text-[#8f8f8f] mt-1">{subtitle ?? ui.reportDone}</p>
        </div>
        {undoable.length > 1 && (
          <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => undo('all')}>{busy === 'all' ? ui.undoing : `↩ ${ui.undoAll}`}</button>
        )}
      </div>

      {report.error && <p className="text-body text-[#f87171]">⚠ {ui.reportError}</p>}
      {!report.error && !report.target && <p className="text-body text-[#fbbf24]">{ui.reportNoTarget}</p>}
      {!report.error && report.target && items.length === 0 && !undoneCount && <p className="text-body text-[#4ade80]">✓ {ui.reportNothing}</p>}
      {allUndone && <p className="text-body text-[#4ade80]">✓ {ui.allUndone}</p>}
      {undoneCount !== 0 && !allUndone && <p className="text-meta text-[#4ade80]">✓ {fillMac(ui.undone, { n: undoneCount })}</p>}

      {report.target && (
        <p className="text-meta text-[#8f8f8f]">
          {ui.target} : <code className="font-mono text-[#aaaaaa] break-all">{report.target.dir}</code>
          {report.bottle && <> · {ui.bottle} : <code className="font-mono text-[#aaaaaa]">{report.bottle.name}</code></>}
        </p>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const st = STATUS[it.status];
            const label = it.status === 'applied' ? ui.applied : it.status === 'failed' ? ui.failed : ui.skipped;
            const why = it.status === 'skipped' ? it.reason : it.status === 'failed' ? it.text : it.detail;
            return (
              <div key={it.id} className="rounded-lg border border-[#2e2e2e] bg-[#1a1a1a] p-3 flex items-start gap-3">
                <span className={`${st.color} font-bold w-4 text-center flex-shrink-0`}>{st.icon}</span>
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body font-semibold text-white">{macText(it.title ?? titleOf(it.id), language)}</span>
                    <span className={badge[st.badge]}>{label}</span>
                  </div>
                  {why && <p className="text-body text-[#aaaaaa]">{macText(why, language)}</p>}
                  {refusals[it.id] && <p className="text-meta text-[#fbbf24]">⚠ {ui.refused} — {macText(refusals[it.id], language)}</p>}
                  <FixDetails files={it.files} changes={it.changes} />
                </div>
                {it.undoable && (
                  <button type="button" className={`${btn.ghost} flex-shrink-0`} disabled={busy !== null} onClick={() => undo(it.id)}>{busy === it.id ? ui.undoing : `↩ ${ui.undo}`}</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {discarded.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-caption uppercase font-bold text-[#707070]">{ui.discardedTitle}</span>
          {discarded.map((d) => (
            <p key={d.file} className="text-meta text-[#8f8f8f]"><code className="font-mono text-[#aaaaaa]">{d.file.split('/').pop()}</code> — {macText(d.reason, language)}</p>
          ))}
        </div>
      )}

      {report.bottled && <BottledBlock bottled={report.bottled} />}

      {appliedLeft && <p className="text-meta text-[#8f8f8f]">{ui.backupNote}</p>}
      {children}
    </div>
  );
};
