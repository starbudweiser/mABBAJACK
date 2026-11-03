import React, { useMemo, useState } from 'react';
import { useI18n } from '../locales';
import { fmtBytes } from '../locales/uiScreens';
import { SIMPLE_UI, fillText } from '../locales/uiSimple';
import { GalleryModlist } from '../types/wabbajack';
import { useMabbajack } from '../state/mabbajack';
import { btn, inputField } from '../design';
import { useDetectedGame } from './useGame';

const gameKey = (g: string | undefined) => (g || '').toLowerCase().replace(/[\s_:'-]/g, '');
/** Skyrim (hors VR) et Enderal : les jeux proposés en mode Simple. */
const isOffered = (m: GalleryModlist) => {
  const k = gameKey(m.game);
  return (k.startsWith('skyrim') && !k.includes('vr')) || k.startsWith('enderal');
};
const isNsfw = (m: GalleryModlist) => !!m.nsfw || !!m.tags?.some((t) => t.toLowerCase() === 'nsfw');

export const ChooseStep: React.FC = () => {
  const { language } = useI18n();
  const ui = SIMPLE_UI[language] ?? SIMPLE_UI.fr;
  const m = useMabbajack();
  const game = useDetectedGame();
  const [search, setSearch] = useState('');
  const [hideNsfw, setHideNsfw] = useState(() => localStorage.getItem('mabbajack_gallery_hide_nsfw') === '1');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return m.galleryModlists
      .filter((x) => isOffered(x) && !x.utility_list && !!x.links?.download && !(hideNsfw && isNsfw(x)))
      .filter((x) => !q || x.title.toLowerCase().includes(q) || (x.author || '').toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [m.galleryModlists, search, hideNsfw]);

  const badge = (x: GalleryModlist) => {
    const sv = String((x as unknown as { skyrimVersion?: string }).skyrimVersion || '').toLowerCase();
    if ((sv !== 'se' && sv !== 'ae') || (game.edition !== 'SE' && game.edition !== 'AE')) return null;
    return sv.toUpperCase() === game.edition
      ? { text: ui.compatible, cls: 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]' }
      : { text: sv === 'ae' ? ui.needsAE : ui.needsSE, cls: 'bg-[#3f2a0c]/40 text-[#fbbf24] border-[#f59e0b]/40' };
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 select-text">
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-display font-bold text-white">{ui.chooseTitle}</h2>
          <p className="text-body-lg text-[#aaaaaa] mt-1">{ui.chooseSubtitle}</p>
          <p className="text-meta text-[#8f8f8f] mt-1">
            {game.found ? fillText(ui.gameLine, { edition: game.edition }) : game.loaded ? ui.noGameLine : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ui.search}
            className={`${inputField} max-w-sm font-sans`} />
          <label className="flex items-center gap-2 text-body text-[#aaaaaa] cursor-pointer select-none">
            <input type="checkbox" checked={hideNsfw} className="accent-[#0ea5e9]"
              onChange={(e) => { setHideNsfw(e.target.checked); localStorage.setItem('mabbajack_gallery_hide_nsfw', e.target.checked ? '1' : '0'); }} />
            {ui.hideNsfw}
          </label>
          <button type="button" className={`${btn.ghost} ml-auto`} onClick={m.pickNativeWabbajackFile}>📁 {ui.openFile}</button>
        </div>

        {m.isLoadingModlists && !list.length && <p className="text-body-lg text-[#8f8f8f] py-10 text-center">{ui.loading}</p>}
        {!m.isLoadingModlists && !list.length && <p className="text-body-lg text-[#8f8f8f] py-10 text-center">{ui.none}</p>}

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {list.map((x) => {
            const dl = x.download_metadata;
            const total = (dl?.SizeOfArchives || 0) + (dl?.SizeOfInstalledFiles || 0);
            const b = badge(x);
            return (
              <div key={`${x.repositoryName}-${x.title}`} className="bg-[#222222] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col">
                <div className="aspect-video bg-[#181818]">
                  {x.links?.image && <img src={x.links.image} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div>
                    <h3 className="text-body-lg font-bold text-white leading-tight">{x.title}</h3>
                    <p className="text-meta text-[#8f8f8f]">{ui.by} {x.author}</p>
                  </div>
                  {b && <span className={`self-start text-caption font-semibold px-2 py-0.5 rounded border ${b.cls}`}>{b.text}</span>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="text-meta text-[#aaaaaa]">{total ? `${fmtBytes(total, language, 'gb')} ${ui.onDisk}` : ''}</span>
                    <button type="button" className={btn.primary} onClick={() => m.installFromGallery(x)}>⬇️ {ui.install}</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChooseStep;
