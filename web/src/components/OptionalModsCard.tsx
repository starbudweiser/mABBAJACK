import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../locales';
import { OPTIONS_UI } from '../locales/uiExtra';
import { fetchModlistOptions } from '../services/api';
import { InstallOptions, ModlistChoice, ModlistOptionProfile, ModlistOptions } from '../types/wabbajack';
import { badge, btn, card, sectionLabel } from '../design';

interface Props {
  /** Chemin local du .wabbajack (absent = mode aperçu : rien à afficher) */
  filePath?: string;
  value: InstallOptions;
  onChange: (v: InstallOptions) => void;
}

function formatBytes(bytes: number, fr: boolean): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ${fr ? 'Go' : 'GB'}`;
  return `${Math.round(bytes / (1024 * 1024))} ${fr ? 'Mo' : 'MB'}`;
}

/** Format d'écran le plus proche de l'écran courant (null = 16:9, format natif des interfaces). */
function detectScreenFormat(): { id: string | null; ratio: string } {
  // App native : tous les écrans (fournis par python_app) → le plus large ; sinon l'écran de la fenêtre.
  const all = (window as unknown as { mabbajackScreens?: [number, number][] }).mabbajackScreens;
  const widest = all?.length ? all.reduce((a, b) => (b[0] > a[0] ? b : a)) : null;
  const w = widest?.[0] || window.screen?.width || 0, h = widest?.[1] || window.screen?.height || 0;
  if (!w || !h) return { id: null, ratio: '?' };
  const r = Math.max(w, h) / Math.min(w, h);
  const known: [string | null, number][] = [[null, 16 / 9], ['16x10', 16 / 10], ['21x9', 64 / 27], ['32x9', 32 / 9]];
  const best = known.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return { id: best[0], ratio: `${Math.max(w, h)}×${Math.min(w, h)}` };
}

/** Valeurs par défaut des choix visibles : celles du profil, sauf le format d'écran (détecté). */
function defaultChoices(p: ModlistOptionProfile): Record<string, string> {
  const fmt = detectScreenFormat().id;
  const out: Record<string, string> = {};
  for (const c of p.choices ?? []) {
    if (c.hidden) continue;
    out[c.id] = c.kind === 'format' && fmt && c.options.some((o) => o.id === fmt) ? fmt : c.default;
  }
  return out;
}

/** Choix du profil, choix exclusifs (boutons radio) et mods désactivés par défaut (cases à cocher). */
export const OptionalModsCard: React.FC<Props> = ({ filePath, value, onChange }) => {
  const { language } = useI18n();
  const ui = OPTIONS_UI[language] ?? OPTIONS_UI.fr;
  const fr = language === 'fr';

  const [options, setOptions] = useState<ModlistOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setOptions(null);
    setFailed(false);
    onChange({ enable: [] });
    if (!filePath) return;
    let cancelled = false;
    setLoading(true);
    fetchModlistOptions(filePath)
      .then((o) => {
        if (cancelled) return;
        setOptions(o);
        const p = o.profiles.find((x) => x.isDefault) ?? o.profiles[0];
        if (p) onChange({ profile: p.name, enable: [], choices: defaultChoices(p) });
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const profile = useMemo(() => {
    if (!options?.profiles.length) return null;
    return options.profiles.find((p) => p.name === value.profile)
      ?? options.profiles.find((p) => p.isDefault)
      ?? options.profiles[0];
  }, [options, value.profile]);

  const enabled = useMemo(() => new Set(value.enable), [value.enable]);

  const selectedBytes = useMemo(() => {
    if (!profile) return 0;
    let total = 0;
    for (const g of profile.groups) for (const m of g.mods) if (enabled.has(m.name)) total += m.size;
    return total;
  }, [profile, enabled]);

  if (!filePath) return null;
  if (loading) return <div className={card}><span className="text-meta text-[#666666]">⏳ {ui.loading}</span></div>;
  if (failed) return <div className={card}><span className="text-meta text-[#666666]">{ui.error}</span></div>;
  if (!profile) return null;
  const visibleChoices: ModlistChoice[] = (profile.choices ?? []).filter((c) => !c.hidden);
  if (profile.optionalCount === 0 && visibleChoices.length === 0 && (options?.profiles.length ?? 0) < 2) return null;
  const picked = value.choices ?? {};
  const pick = (c: ModlistChoice, id: string) => onChange({ ...value, profile: profile.name, choices: { ...picked, [c.id]: id } });
  const screen = detectScreenFormat();
  const choiceTitle = (c: ModlistChoice) => c.kind === 'format' ? ui.format
    : c.kind === 'family' ? ui.family.replace('{tag}', c.label)
    : ui.variant.replace('{label}', c.label);

  const set = (names: string[], on: boolean) => {
    const next = new Set(value.enable);
    for (const n of names) on ? next.add(n) : next.delete(n);
    onChange({ ...value, profile: profile.name, enable: [...next] });
  };
  const allNames = profile.groups.flatMap((g) => g.mods.map((m) => m.name));

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className={sectionLabel}><span>🎛</span><span>{ui.title}</span></span>
        <span className={badge.blue}>
          {ui.selected.replace('{n}', String(enabled.size)).replace('{total}', String(profile.optionalCount)).replace('{size}', formatBytes(selectedBytes, fr))}
        </span>
      </div>
      <p className="text-meta text-[#666666] -mt-1">{ui.hint}</p>

      {options && options.profiles.length > 1 && (
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-3 py-2 flex flex-col gap-1" role="radiogroup" aria-label={ui.profile}>
          <span className="text-body text-[#aaaaaa]">{ui.profile} <span className="text-[#666666]">— {ui.profilesHint}</span></span>
          {options.profiles.map((p) => (
            <label key={p.name} className="text-body text-[#dddddd] flex items-center gap-2 py-0.5">
              <input type="radio" name="mabba-profile" checked={p.name === profile.name}
                onChange={() => onChange({ profile: p.name, enable: [], choices: defaultChoices(p) })} />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      )}

      {visibleChoices.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-[#aaaaaa]">{ui.choicesTitle}</span>
          {visibleChoices.map((c) => {
            const cur = picked[c.id] ?? c.default;
            return (
              <div key={c.id} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-3 py-2 flex flex-col gap-1" role="radiogroup" aria-label={choiceTitle(c)}>
                <span className="text-body text-white flex items-center justify-between gap-2">
                  <span className="truncate">{choiceTitle(c)}</span>
                  {c.kind === 'format' && <span className="text-caption text-[#666666] shrink-0">{ui.formatDetected.replace('{ratio}', screen.ratio)}</span>}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {c.options.map((o) => (
                    <label key={o.id} className="text-body text-[#dddddd] flex items-center gap-1.5 py-0.5" title={o.mods.join('\n')}>
                      <input type="radio" name={`mabba-${c.id}`} checked={cur === o.id} onChange={() => pick(c, o.id)} />
                      <span>{o.label}</span>
                      {o.size >= 1048576 && <span className="text-caption text-[#666666]">{formatBytes(o.size, fr)}</span>}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {profile.optionalCount > 0 && <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className={btn.ghost} onClick={() => set(allNames, true)}>{ui.checkAll}</button>
        <button type="button" className={btn.ghost} onClick={() => set(allNames, false)}>{ui.uncheckAll}</button>
      </div>}

      <div className="flex flex-col gap-1.5">
        {profile.groups.map((g) => {
          const names = g.mods.map((m) => m.name);
          const nSel = names.filter((n) => enabled.has(n)).length;
          return (
            <details key={g.separator} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg">
              <summary className="px-3 py-2 cursor-pointer text-body text-white flex items-center justify-between gap-2 select-none">
                <span className="truncate">{g.separator}</span>
                <span className="text-caption text-[#666666] shrink-0">{nSel} / {names.length}</span>
              </summary>
              <div className="px-3 pb-2 flex flex-col gap-1">
                <label className="text-body text-[#aaaaaa] flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={nSel === names.length} onChange={(e) => set(names, e.target.checked)} />
                  <span>{nSel === names.length ? ui.uncheckAll : ui.checkAll}</span>
                </label>
                {g.mods.map((m) => (
                  <label key={m.name} className="text-body text-[#dddddd] flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={enabled.has(m.name)} onChange={(e) => set([m.name], e.target.checked)} />
                    <span className="truncate flex-1">{m.name}</span>
                    <span className="text-caption text-[#666666] shrink-0">{formatBytes(m.size, fr)}</span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <p className="text-caption text-[#666666]">{ui.note}</p>
    </div>
  );
};

export default OptionalModsCard;
