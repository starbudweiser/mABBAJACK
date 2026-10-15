import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../locales';
import { OPTIONS_UI } from '../locales/uiExtra';
import { fetchModlistOptions } from '../services/api';
import { InstallOptions, ModlistChoice, ModlistOptionGroup, ModlistOptionMod, ModlistOptionProfile, ModlistOptions } from '../types/wabbajack';
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
  const allMods = profile.groups.flatMap((g) => g.mods);
  // Un mod n'est sélectionnable que si ses dépendances le sont (mod requis coché, famille choisie)
  const unmet = (m: ModlistOptionMod, en: Set<string>, ch: Record<string, string>): string[] => {
    const out = (m.requires ?? []).filter((r) => !en.has(r));
    if (m.requiresChoice) {
      const c = profile.choices?.find((x) => x.id === m.requiresChoice!.choice);
      if ((ch[m.requiresChoice.choice] ?? c?.default) !== m.requiresChoice.option) out.push(m.requiresChoice.option);
    }
    return out;
  };
  const commit = (en: Set<string>, ch: Record<string, string>) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of allMods) if (en.has(m.name) && unmet(m, en, ch).length) { en.delete(m.name); changed = true; }
    }
    onChange({ ...value, profile: profile.name, enable: [...en], choices: ch });
  };
  const pick = (c: ModlistChoice, id: string) => commit(new Set(value.enable), { ...picked, [c.id]: id });
  const screen = detectScreenFormat();
  const choiceTitle = (c: ModlistChoice) => c.kind === 'format' ? ui.format
    : c.kind === 'family' ? ui.family.replace('{tag}', c.label)
    : ui.variant.replace('{label}', c.label);

  const set = (names: string[], on: boolean) => {
    const next = new Set(value.enable);
    for (const n of names) on ? next.add(n) : next.delete(n);
    commit(next, picked);
  };
  const allNames = allMods.map((m) => m.name);
  const mainGroups = profile.groups.filter((g) => !g.debug);
  const debugGroups = profile.groups.filter((g) => g.debug);

  const renderGroup = (g: ModlistOptionGroup) => {
    const selectable = g.mods.filter((m) => !unmet(m, enabled, picked).length).map((m) => m.name);
    const nSel = g.mods.filter((m) => enabled.has(m.name)).length;
    const allOn = selectable.length > 0 && selectable.every((n) => enabled.has(n));
    return (
      <details key={g.separator} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg">
        <summary className="px-3 py-2 cursor-pointer text-body text-white flex items-center justify-between gap-2 select-none">
          <span className="truncate">{g.separator}</span>
          <span className="text-caption text-[#666666] shrink-0">{nSel} / {g.mods.length}</span>
        </summary>
        <div className="px-3 pb-2 flex flex-col gap-1">
          {selectable.length > 1 && (
            <label className="text-body text-[#aaaaaa] flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={allOn} onChange={(e) => set(selectable, e.target.checked)} />
              <span>{allOn ? ui.uncheckAll : ui.checkAll}</span>
            </label>
          )}
          {g.mods.map((m) => {
            const missing = unmet(m, enabled, picked);
            const off = missing.length > 0;
            return (
              <label key={m.name} className={`text-body flex items-center gap-2 py-0.5 ${off ? 'text-[#666666]' : 'text-[#dddddd]'}`}
                title={off ? ui.requires.replace('{deps}', missing.join(', ')) : undefined}>
                <input type="checkbox" disabled={off} checked={enabled.has(m.name) && !off} onChange={(e) => set([m.name], e.target.checked)} />
                <span className="truncate flex-1">{m.name}</span>
                {off && <span className="text-caption text-[#666666] shrink-0 truncate max-w-[40%]">{ui.requires.replace('{deps}', missing.join(', '))}</span>}
                <span className="text-caption text-[#666666] shrink-0">{formatBytes(m.size, fr)}</span>
              </label>
            );
          })}
        </div>
      </details>
    );
  };

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
                      <span>{c.kind === 'exclusive' && o.id === 'none' ? ui.none : o.label}</span>
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
        <button type="button" className={btn.ghost} onClick={() => set(allNames, false)}>{ui.uncheckAll}</button>
      </div>}

      <div className="flex flex-col gap-1.5">{mainGroups.map(renderGroup)}</div>

      {debugGroups.length > 0 && (
        <details className="border border-[#2e2e2e] rounded-lg">
          <summary className="px-3 py-2 cursor-pointer text-body text-[#aaaaaa] select-none">⚠ {ui.debugTitle}</summary>
          <div className="px-3 pb-2 flex flex-col gap-1.5">
            <p className="text-meta text-[#8f8f8f]">{ui.debugHint}</p>
            {debugGroups.map(renderGroup)}
          </div>
        </details>
      )}

      {(profile.lockedGroups ?? []).map((l) => (
        <p key={l.separator} className="text-meta text-[#8f8f8f]">🔒 {ui.locked.replace('{n}', String(l.count)).replace('{sep}', l.separator)}</p>
      ))}
      <p className="text-caption text-[#666666]">{ui.note}</p>
    </div>
  );
};

export default OptionalModsCard;
