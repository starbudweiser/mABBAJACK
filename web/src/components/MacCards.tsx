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
      {/* Socle : le constat est centré, et le bouton d'action centré juste en dessous */}
      <div className="flex flex-col items-center text-center gap-0.5 min-w-0">
        <span className="flex items-center gap-2">
          <span className={bottled.state === 'ok' ? 'text-[#4ade80]' : needsFix ? 'text-[#fbbf24]' : 'text-[#8f8f8f]'}>{bottled.state === 'ok' ? '✓' : needsFix ? '⚠' : '•'}</span>
          <span className="text-body font-semibold text-white">{ui.bottled}</span>
        </span>
        <p className="text-body text-[#aaaaaa]">{macText(bottled.text, language)}</p>
      </div>
      {needsFix && (
        <div className="flex flex-col items-center text-center gap-2">
          {job.status === 'idle' || job.status === 'error' ? (
            <>
              <div><button type="button" className={btn.secondary} onClick={start}>⬇ {fillMac(ui.bottledGet, { version: bottled.minimum })}</button></div>
              {job.status === 'error' && <p className="text-meta text-[#f87171]">{errorText(job)}</p>}
            </>
          ) : job.status === 'looking' ? (
            <p className="text-meta text-[#aaaaaa]">{ui.bottledLooking}</p>
          ) : job.status === 'downloading' ? (
            <div className="flex flex-col gap-1 w-full">
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

/** Une des deux façons de rendre le jeu : titre, ce qu'elle fait, puis quatre lignes fixes (dossier, bouteille, ensuite, annulation). */
const ModeOption: React.FC<{
  selected: boolean; disabled?: boolean; onSelect: () => void; title: string; lead: string; rows: [string, string][]; notice?: string;
}> = ({ selected, disabled, onSelect, title, lead, rows, notice }) => (
  <div
    role="radio"
    aria-checked={selected}
    aria-disabled={disabled || undefined}
    tabIndex={disabled ? -1 : 0}
    onClick={() => { if (!disabled) onSelect(); }}
    onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onSelect(); } }}
    className={`rounded-lg border p-3 flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9] ${selected ? 'border-[#0ea5e9] bg-[#0ea5e9]/10' : 'border-[#2e2e2e] bg-[#1a1a1a]'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-[#3d3d3d]'}`}
  >
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center ${selected ? 'border-[#0ea5e9]' : 'border-[#555555]'}`}>
        {selected && <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />}
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-body font-semibold text-white">{title}</span>
        <p className="text-body text-[#aaaaaa]">{lead}</p>
      </div>
    </div>
    <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1.5 pl-[26px]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-caption uppercase font-bold text-[#707070] pt-0.5">{label}</dt>
          <dd className="text-meta text-[#aaaaaa]">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
    {notice && <p className="text-meta text-[#fbbf24] pl-[26px]">⚠ {notice}</p>}
  </div>
);

/**
 * Carte « Adaptation au Mac » avant l'installation : le choix entre le dossier universel (Stock, rien n'est copié, présélectionné)
 * et le kit DXMT pour une bouteille CrossOver. Le détail du kit (plan du moteur) ne s'affiche que si le kit est choisi.
 */
export const MacCard: React.FC = () => {
  const { language } = useI18n();
  const ui = MAC_UI[language] ?? MAC_UI.fr;
  const m = useMabbajack();
  const { parsedFile, destPath, gamePath, updateRequest, macMode, setMacMode, macBottle, setMacBottle } = m;
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

  // sans bouteille CrossOver, le kit n'est pas proposé : jamais de demi-mesure
  const kitUnavailable = !!preview?.supported && !!preview.noBottle;
  useEffect(() => { if (kitUnavailable && macMode === 'crossover') setMacMode('stock'); }, [kitUnavailable, macMode, setMacMode]);

  if (!parsedFile) return null;
  if (preview && !preview.supported) return null; // hors macOS : pas de carte
  const kit = macMode === 'crossover' && !kitUnavailable;
  const plan = preview?.plan;
  const future = preview?.target && !preview.target.exists;
  const nothing = plan && !future && plan.fixes.length === 0;

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <span className={sectionLabel}><span>🍎</span><span>{ui.title}</span></span>
        {kit && preview?.target && <span className={badge.blue}>{preview.target.kind === 'install' ? ui.targetInstall : ui.targetGame}</span>}
      </div>

      <p className="text-meta text-[#8f8f8f] -mt-1">{ui.modeChoose}</p>
      <div role="radiogroup" aria-label={ui.modeChoose} className="flex flex-col gap-2">
        <ModeOption
          selected={macMode === 'stock'}
          onSelect={() => setMacMode('stock')}
          title={ui.modeStock}
          lead={ui.modeStockLead}
          rows={[[ui.rowFolder, ui.modeStockFolder], [ui.rowBottle, ui.modeStockBottle], [ui.rowAfter, ui.modeStockAfter], [ui.rowUndo, ui.modeStockUndo]]}
        />
        <ModeOption
          selected={kit}
          disabled={kitUnavailable}
          onSelect={() => setMacMode('crossover')}
          title={ui.modeKit}
          lead={ui.modeKitLead}
          rows={[[ui.rowFolder, ui.modeKitFolder], [ui.rowBottle, ui.modeKitBottle], [ui.rowAfter, ui.modeKitAfter], [ui.rowUndo, ui.modeKitUndo]]}
          notice={kitUnavailable ? ui.kitUnavailable : undefined}
        />
      </div>

      {kit && (
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

  // dossier universel (Stock) : rien n'a été copié ni modifié, le bilan le dit simplement
  if (report.mode === 'stock') {
    return (
      <div className={`${card} gap-3`}>
        <div>
          <span className={sectionLabel}><span>📦</span><span>{ui.reportStock}</span></span>
          <p className="text-meta text-[#8f8f8f] mt-1">{subtitle ?? ui.reportDone}</p>
        </div>
        <p className="text-body text-[#4ade80]">✓ {ui.reportStockText}</p>
        {report.target && (
          <p className="text-meta text-[#8f8f8f]">{ui.target} : <code className="font-mono text-[#aaaaaa] break-all">{report.target.dir}</code></p>
        )}
        {children}
      </div>
    );
  }

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
      <div>
        <span className={sectionLabel}><span>🍎</span><span>{title ?? ui.report}</span></span>
        <p className="text-meta text-[#8f8f8f] mt-1">{subtitle ?? ui.reportDone}</p>
      </div>

      {report.error && <p className="text-body text-[#f87171]">⚠ {ui.reportError}</p>}
      {!report.error && !report.target && <p className="text-body text-[#fbbf24]">{ui.reportNoTarget}</p>}
      {!report.error && report.noBottle && <p className="text-body text-[#fbbf24]">⚠ {ui.reportNoBottle}</p>}
      {!report.error && report.target && !report.noBottle && items.length === 0 && !undoneCount && <p className="text-body text-[#4ade80]">✓ {ui.reportNothing}</p>}
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

      {/* Socle : le bouton d'action d'un bilan est centré sous le texte */}
      {undoable.length > 1 && (
        <div className="flex justify-center pt-1">
          <button type="button" className={btn.secondary} disabled={busy !== null} onClick={() => undo('all')}>{busy === 'all' ? ui.undoing : `↩ ${ui.undoAll}`}</button>
        </div>
      )}
      {appliedLeft && <p className="text-meta text-[#8f8f8f] text-center">{ui.backupNote}</p>}
      {children}
    </div>
  );
};
