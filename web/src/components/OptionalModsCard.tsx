import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../locales';
import { OPTIONS_UI } from '../locales/uiExtra';
import { fetchModlistOptions } from '../services/api';
import { InstallOptions, ModlistOptions } from '../types/wabbajack';
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

/** Mods désactivés par défaut dans la modlist, groupés par séparateur MO2, à cocher pour les installer. */
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
      .then((o) => { if (!cancelled) setOptions(o); })
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
  if (loading) return <div className={card}><span className="text-[11px] text-[#666666]">⏳ {ui.loading}</span></div>;
  if (failed) return <div className={card}><span className="text-[11px] text-[#666666]">{ui.error}</span></div>;
  if (!profile || profile.optionalCount === 0) return null;

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
      <p className="text-[11px] text-[#666666] -mt-1">{ui.hint}</p>

      <div className="flex items-center gap-2 flex-wrap">
        {options && options.profiles.length > 1 && (
          <label className="text-[11px] text-[#aaaaaa] flex items-center gap-1.5">
            {ui.profile}
            <select
              value={profile.name}
              onChange={(e) => onChange({ profile: e.target.value, enable: [] })}
              className="bg-[#1a1a1a] border border-[#2e2e2e] rounded px-2 py-1 text-white text-[11px]"
            >
              {options.profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className={btn.ghost} onClick={() => set(allNames, true)}>{ui.checkAll}</button>
        <button type="button" className={btn.ghost} onClick={() => set(allNames, false)}>{ui.uncheckAll}</button>
      </div>

      <div className="flex flex-col gap-1.5">
        {profile.groups.map((g) => {
          const names = g.mods.map((m) => m.name);
          const nSel = names.filter((n) => enabled.has(n)).length;
          return (
            <details key={g.separator} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg">
              <summary className="px-3 py-2 cursor-pointer text-[12px] text-white flex items-center justify-between gap-2 select-none">
                <span className="truncate">{g.separator}</span>
                <span className="text-[10px] text-[#666666] shrink-0">{nSel} / {names.length}</span>
              </summary>
              <div className="px-3 pb-2 flex flex-col gap-1">
                <label className="text-[11px] text-[#aaaaaa] flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={nSel === names.length} onChange={(e) => set(names, e.target.checked)} />
                  <span>{nSel === names.length ? ui.uncheckAll : ui.checkAll}</span>
                </label>
                {g.mods.map((m) => (
                  <label key={m.name} className="text-[11px] text-[#dddddd] flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={enabled.has(m.name)} onChange={(e) => set([m.name], e.target.checked)} />
                    <span className="truncate flex-1">{m.name}</span>
                    <span className="text-[10px] text-[#666666] shrink-0">{formatBytes(m.size, fr)}</span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <p className="text-[10px] text-[#666666]">{ui.note}</p>
    </div>
  );
};

export default OptionalModsCard;
