import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useI18n } from '../locales';
import { GalleryModlist } from '../types/wabbajack';
import { getApiBaseUrl } from '../services/api';
import { translateOne, translateBatch, useTranslated } from '../hooks/useTranslated';
import { GALLERY_UI, COMMON_UI, fmtBytes } from '../locales/uiScreens';
import type { Language } from '../locales';



interface GalleryViewProps {
  modlists: GalleryModlist[];
  isLoading: boolean;
  onRefresh: () => void;
}

/** Libellé traduit d'un filtre de jeu (les noms de jeux restent tels quels). */
function filterLabel(id: string, fallback: string, lang: Language): string {
  const g = GALLERY_UI[lang] ?? GALLERY_UI.fr;
  if (id === 'all') return g.all;
  if (id === 'other') return g.otherGames;
  return fallback;
}

// Open a URL via the Express server (port 3000) — bypasses WebView/iframe restrictions on target="_blank"
async function openExternalUrl(url: string): Promise<void> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/system/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn('[openExternalUrl] fetch failed, trying window.open:', err);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

const GAME_FILTERS = [
  { id: 'all',     label: 'Tous',        icon: '🌐', color: '#aaaaaa', activeBg: '#404040', activeBorder: '#52525b88', activeColor: '#ffffff', versionLabel: '' },
  { id: 'se',     label: 'Skyrim SE',   icon: '🏔️', color: '#38bdf8', activeBg: '#1a1a1a', activeBorder: '#0ea5e988', activeColor: '#38bdf8', versionLabel: '1.5.97' },
  { id: 'ae',     label: 'Skyrim AE',   icon: '⚜️', color: '#f59e0b', activeBg: '#181818', activeBorder: '#f59e0b88', activeColor: '#f59e0b', versionLabel: '1.6.x' },
  { id: 'ae17',   label: 'Skyrim 1.7',  icon: '🆕', color: '#4ade80', activeBg: '#1a1a1a', activeBorder: '#10b98188', activeColor: '#4ade80', versionLabel: '1.7.x' },
  { id: 'vr',     label: 'Skyrim VR',   icon: '🥽', color: '#0ea5e9', activeBg: '#181818', activeBorder: '#7c3aed88', activeColor: '#0ea5e9', versionLabel: '1.4.x' },
  { id: 'enderal', label: 'Enderal',    icon: '✨', color: '#f59e0b', activeBg: '#181818', activeBorder: '#fb923c88', activeColor: '#f59e0b', versionLabel: '' },
  { id: 'other',  label: 'Autres jeux', icon: '🎮', color: '#707070', activeBg: '#1e1e1e', activeBorder: '#4b556388', activeColor: '#dddddd', versionLabel: '' },
] as const;

/** Boutons affichés : tous les filtres sauf « other » (remplacé par une picklist). */
const BUTTON_FILTERS = GAME_FILTERS.filter((f) => f.id !== 'other');
const OTHER_FILTER = GAME_FILTERS.find((f) => f.id === 'other')!;
const DEFAULT_FILTER = 'ae' as const;
const ALL_OTHERS = '*';

const KNOWN_GAME_NAMES: Record<string, string> = {
  fallout4: 'Fallout 4', fallout3: 'Fallout 3', falloutnewvegas: 'Fallout: New Vegas', fallout4vr: 'Fallout 4 VR',
  oblivion: 'Oblivion', oblivionremastered: 'Oblivion Remastered', morrowind: 'Morrowind', starfield: 'Starfield',
  skyrim: 'Skyrim LE', skyrimle: 'Skyrim LE', cyberpunk2077: 'Cyberpunk 2077', witcher3: 'The Witcher 3',
  baldursgate3: "Baldur's Gate 3", dragonage: 'Dragon Age', dragonageorigins: 'Dragon Age: Origins',
  dragonage2: 'Dragon Age 2', dragonageinquisition: 'Dragon Age: Inquisition', kingdomcomedeliverance: 'Kingdom Come: Deliverance',
  stardewvalley: 'Stardew Valley', dragonsdogma: "Dragon's Dogma", dragonsdogma2: "Dragon's Dogma 2",
  darksouls: 'Dark Souls', eldenring: 'Elden Ring', mountandblade2bannerlord: 'Mount & Blade II: Bannerlord',
  vtmb: 'Vampire: The Masquerade – Bloodlines', nomanssky: "No Man's Sky", sevendaystodie: '7 Days to Die',
  nierautomata: 'NieR: Automata', dishonored: 'Dishonored', enderalspecialedition: 'Enderal SE',
};

/** Clé de regroupement d'un jeu (insensible à la casse, espaces et tirets). */
function gameKey(game: string | undefined): string {
  return (game || '').toLowerCase().replace(/[\s_:'-]/g, '') || 'unknown';
}

/** Nom lisible d'un jeu : table connue, sinon découpage camelCase du nom brut. */
function prettyGameName(game: string | undefined): string {
  const known = KNOWN_GAME_NAMES[gameKey(game)];
  if (known) return known;
  const raw = (game || '').trim();
  if (!raw) return '?';
  return raw.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

type GameFilterId = (typeof GAME_FILTERS)[number]['id'];

/** Version affichée : exacte (manifeste) si connue, sinon estimation marquée « ~ » (tags / description). */
function versionBadge(m: GalleryModlist, bd: { id: string; versionLabel: string }): { text: string; exact: boolean } {
  if (m.gameVersion) return { text: m.gameVersion, exact: true };
  const estimated = bd.id === 'se' || bd.id === 'ae' || bd.id === 'vr';
  return { text: bd.versionLabel ? (estimated ? `~${bd.versionLabel}` : bd.versionLabel) : '', exact: false };
}

function classifyModlist(m: GalleryModlist): GameFilterId {
  // Version exacte lue dans le manifeste : fait autorité (1.7+ = branche « 1.7.x »)
  if (m.gameVersion && /^1\.([7-9]|\d{2,})\./.test(m.gameVersion) && (m.game || '').toLowerCase().startsWith('skyrim') && !/vr/i.test(m.game || '')) return 'ae17';
  // Estimation : tags explicites 1.7 (sans version exacte connue)
  if (!m.gameVersion && (m.game || '').toLowerCase().startsWith('skyrim') && !/vr/i.test(m.game || '') &&
    (m.tags || []).some((tg) => /^1\.7(\.|$)/.test(tg.trim()))) return 'ae17';
  // Use server-computed field when available (most reliable)
  const sv = (m as any).skyrimVersion as string | undefined;
  if (sv === 'vr') return 'vr';
  if (sv === 'ae') return 'ae';
  if (sv === 'se') return 'se';
  if (sv === 'other') {
    // Further split 'other': Enderal gets its own bucket
    const game = (m.game || '').toLowerCase().replace(/[\s_-]/g, '');
    if (game.includes('enderal')) return 'enderal';
    return 'other';
  }
  // Fallback client-side heuristic (no skyrimVersion from server)
  const game = (m.game || '').toLowerCase().replace(/[\s_-]/g, '');
  if (game.includes('enderal')) return 'enderal';
  if (game.startsWith('skyrimvr')) return 'vr';
  if (!game.startsWith('skyrim') && game !== 'skyrim') return 'other';
  if (game === 'skyrimanniversaryedition' || game === 'skyrimae') return 'ae';
  const tags = (m.tags || []).map((t) => t.toLowerCase().trim().replace(/\s+/g, ''));
  const AE_TAGS = ['ae','1.6','1.6.x','nextgen','nextgenupdate','post-aeupdate','postaeupdate','anniversaryedition','creationclub','anniversaryedition'];
  const SE_TAGS = ['1.5','1.5.97','1.5.x','se'];
  if (tags.some((t) => AE_TAGS.includes(t)) && !tags.some((t) => SE_TAGS.includes(t))) return 'ae';
  if (tags.some((t) => SE_TAGS.includes(t))) return 'se';
  const rawDesc = (m.description || '').replace(/<[^>]*>/g, '').trim();
  const txt = ((m.title || '') + ' ' + rawDesc).slice(0, 1000).toLowerCase();
  if (/\b1\.6\.\d/.test(txt) || /next[\s-]?gen update/.test(txt) || /anniversary edition/.test(txt)) return 'ae';
  if (/\b1\.5\.97\b/.test(txt)) return 'se';
  return 'se';
}

// ── Tags : seuls les plus utilisés sont proposés (regroupement des variantes) ──
const TAG_GROUPS: { label: string; test: (tags: Set<string>, m: GalleryModlist) => boolean }[] = [
  { label: 'NSFW',          test: (t, m) => !!m.nsfw || t.has('nsfw') || t.has('adult') || t.has('18+') },
  { label: 'Never Nude',    test: (t) => t.has('nevernude') || t.has('never nude') },
  { label: 'Lightweight',   test: (t) => t.has('lightweight') || t.has('light') },
  { label: 'Performance',   test: (t) => t.has('performance') || t.has('stability') },
  { label: 'Vanilla+',      test: (t) => t.has('vanilla+') || t.has('vanilla plus') || t.has('vanilla') },
  { label: 'Overhaul',      test: (t) => t.has('total overhaul') || t.has('overhaul') },
  { label: 'Survival',      test: (t) => t.has('survival') },
  { label: 'Hardcore',      test: (t) => t.has('hardcore') },
  { label: 'Combat',        test: (t) => t.has('combat overhaul') || t.has('combat') || t.has('mco') || t.has('bfco') },
  { label: 'Visuals',       test: (t) => t.has('visuals') || t.has('graphics') || t.has('graphic focused') },
  { label: 'Immersive',     test: (t) => t.has('immersive') || t.has('immersion') || t.has('roleplay') },
  { label: 'Lore-Friendly', test: (t) => t.has('lore-friendly') },
  { label: 'Quests',        test: (t) => t.has('new quests') || t.has('quest mods') },
  { label: 'Steam Deck',    test: (t) => t.has('steam deck') },
];
const tagSet = (m: GalleryModlist) => new Set((m.tags || []).map((tg) => tg.trim().toLowerCase()));
const matchesTagGroup = (m: GalleryModlist, label: string) => !!TAG_GROUPS.find((g) => g.label === label)?.test(tagSet(m), m);

// ── Scrollable tag bar with ‹ › navigation arrows ──────────────────────────
const TagBar: React.FC<{ tags: string[]; selectedTag: string; onSelect: (t: string) => void; labelAll: string }> = ({ tags, selectedTag, onSelect, labelAll }) => {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useCallback((dir: 'left' | 'right') => {
    ref.current?.scrollBy({ left: dir === 'left' ? -180 : 180, behavior: 'smooth' });
  }, []);

  const arrowStyle: React.CSSProperties = {
    flexShrink: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#1a1a1a', border: '1px solid #2c2c2c', borderRadius: 6, color: '#707070', cursor: 'pointer', fontSize: 15,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
      <button type="button" onClick={() => scroll('left')} title="◀" style={arrowStyle}>‹</button>
      <div ref={ref} style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
        <button type="button" onClick={() => onSelect('all')}
          style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 6, fontSize: 'calc(12px * var(--text-scale))', fontWeight: 600, cursor: 'pointer', border: 'none',
            background: selectedTag === 'all' ? '#0ea5e9' : '#1a1a1a', color: selectedTag === 'all' ? '#ffffff' : '#707070' }}>
          {labelAll}
        </button>
        {tags.map((tag) => (
          <button key={tag} type="button" onClick={() => onSelect(tag === selectedTag ? 'all' : tag)}
            style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 6, fontSize: 'calc(12px * var(--text-scale))', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              background: selectedTag === tag ? '#262626' : '#1a1a1a',
              color: selectedTag === tag ? '#38bdf8' : '#707070',
              border: `1px solid ${selectedTag === tag ? 'rgba(14,165,233,0.4)' : 'transparent'}` }}>
            {tag}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => scroll('right')} title="▶" style={arrowStyle}>›</button>
    </div>
  );
};

// ── External link button (calls server to open in system browser) ───────────
const ExtLink: React.FC<{ url: string; label: string; bg: string; color: string; border: string }> = ({ url, label, bg, color, border }) => (
  <button
    type="button"
    onClick={() => openExternalUrl(url)}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
      fontSize: 'calc(12px * var(--text-scale))', fontWeight: 500, background: bg, color, border: `1px solid ${border}`,
      cursor: 'pointer' }}
  >
    {label}
  </button>
);

// ── Description de carte : traduite seulement quand la carte entre dans la zone visible ──
const API_ERROR_RE = /QUERY LENGTH LIMIT|MAX ALLOWED QUERY|^error:|^exception:/i;
const CardDescription: React.FC<{ raw?: string; language: Language; fallback: string }> = ({ raw, language, fallback }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState(false);
  const clean = (raw || '').replace(/<[^>]*>/g, '').trim();
  const text = !clean || API_ERROR_RE.test(clean) ? '' : clean.length > 300 ? clean.slice(0, 300).trimEnd() + '…' : clean;

  useEffect(() => {
    const el = ref.current;
    if (!el || !text || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [text]);

  const { translated } = useTranslated(visible ? text : undefined, language);
  return (
    <p ref={ref} className="text-body text-[#8f8f8f] line-clamp-2 leading-relaxed mb-3">
      {text ? (translated || text) : fallback}
    </p>
  );
};

const DetailModal: React.FC<{
  modlist: GalleryModlist;
  onClose: () => void;
}> = ({ modlist, onClose }) => {
  const { t, language } = useI18n();
  const formatBytes = (b: number) => fmtBytes(b, language, 'gb');
  const bucket = classifyModlist(modlist);
  const bd = GAME_FILTERS.find((f) => f.id === bucket)!;
  const dl = modlist.download_metadata;

  const previewImages: string[] = [];
  if (modlist.links?.image) previewImages.push(modlist.links.image);
  const galleryField = (modlist.links as any)?.gallery;
  if (Array.isArray(galleryField)) previewImages.push(...galleryField);
  else if (typeof galleryField === 'string' && galleryField) previewImages.push(galleryField);

  const [imgIdx, setImgIdx] = useState(0);

  const websiteUrl = modlist.links?.websiteURL?.trim() || '';
  const readmeUrl  = modlist.links?.readme || '';
  const discordUrl = modlist.links?.discordURL || '';

  // Sanitize description: strip HTML, discard API error messages
  const rawDescription = (() => {
    const d = (modlist.description || '').replace(/<[^>]*>/g, '').trim();
    // Discard known API error patterns returned upstream (e.g. Wabbajack/Nexus)
    const errorPatterns = [
      /QUERY LENGTH LIMIT EXCEEDED/i,
      /MAX ALLOWED QUERY/i,
      /^error[:\s]/i,
      /^exception[:\s]/i,
      /^undefined$/i,
      /^null$/i,
    ];
    if (!d || errorPatterns.some((re) => re.test(d))) return '';
    return d;
  })();
  const { translated: descTranslated, loading: descLoading } = useTranslated(rawDescription, language);
  const description = descTranslated || (rawDescription ? rawDescription : t.gallery.noDescription);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 16, width: '100%', maxWidth: 640,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', background: '#181818', borderBottom: '1px solid #262626',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 'calc(16px * var(--text-scale))', fontWeight: 700, color: '#ffffff' }}>{modlist.title}</h3>
            <p style={{ margin: '4px 0 0', fontSize: 'calc(11px * var(--text-scale))', color: '#aaaaaa' }}>
              {t.gallery.byAuthor}{' '}
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{modlist.author}</span>
              {modlist.version && <>{' · '}<span style={{ fontFamily: 'monospace' }}>v{modlist.version}</span></>}
              {' · '}<span style={{ color: bd.color }}>{bd.icon} {filterLabel(bd.id, bd.label, language)}{versionBadge(modlist, bd).text ? ` ${versionBadge(modlist, bd).text}` : ''}</span>
            </p>
          </div>
          <button type="button" onClick={onClose}
            style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', color: '#aaaaaa', cursor: 'pointer', fontSize: 18, borderRadius: 8 }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Preview image */}
          {previewImages.length > 0 && (
            <div style={{ position: 'relative', width: '100%', height: 220, background: '#181818', overflow: 'hidden', flexShrink: 0 }}>
              <img src={previewImages[imgIdx]} alt={`${modlist.title} — ${(GALLERY_UI[language] ?? GALLERY_UI.fr).preview}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(26,26,32,0.5) 0%, transparent 60%)', pointerEvents: 'none' }} />
              {previewImages.length > 1 && (
                <>
                  {(['left', 'right'] as const).map((side) => (
                    <button key={side} type="button"
                      onClick={() => setImgIdx((i) => side === 'left' ? (i - 1 + previewImages.length) % previewImages.length : (i + 1) % previewImages.length)}
                      style={{ position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32,
                        borderRadius: '50%', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {side === 'left' ? '‹' : '›'}
                    </button>
                  ))}
                  <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5 }}>
                    {previewImages.map((_, i) => (
                      <button key={i} type="button" onClick={() => setImgIdx(i)}
                        style={{ width: 6, height: 6, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                          background: i === imgIdx ? '#38bdf8' : 'rgba(255,255,255,0.3)' }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Description */}
            <p style={{ margin: 0, fontSize: 'calc(15px * var(--text-scale))', color: !rawDescription ? '#707070' : '#dddddd', lineHeight: 1.6, fontStyle: !rawDescription ? 'italic' : 'normal', position: 'relative' }}>
              {description}
              {descLoading && (
                <span style={{ marginLeft: 8, display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #38bdf8', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle' }} />
              )}
            </p>

            {/* Tags */}
            {modlist.tags && modlist.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {modlist.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: 'calc(10px * var(--text-scale))', padding: '2px 8px', borderRadius: 12,
                    background: tag.toLowerCase().includes('anniversary') ? 'rgba(245,158,11,0.08)' : '#222222',
                    color: tag.toLowerCase().includes('anniversary') ? '#f59e0b' : '#aaaaaa',
                    border: `1px solid ${tag.toLowerCase().includes('anniversary') ? 'rgba(245,158,11,0.3)' : '#303030'}`,
                  }}>{tag}</span>
                ))}
              </div>
            )}

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([
                [t.gallery.statDl,        formatBytes(dl?.SizeOfArchives || 0), '#38bdf8'],
                [t.gallery.statInstalled, formatBytes(dl?.SizeOfInstalledFiles || 0), '#4ade80'],
                [t.gallery.statArchives,  String(dl?.NumberOfArchives || 0), '#dddddd'],
                [t.gallery.statGame,      modlist.game || '—', '#aaaaaa'],
              ] as [string, string, string][]).map(([label, value, color]) => (
                <div key={label} style={{ background: '#181818', border: '1px solid #262626', borderRadius: 10, padding: '10px 12px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 'calc(10px * var(--text-scale))', color: '#707070' }}>{label}</p>
                  <p style={{ margin: 0, fontSize: 'calc(14px * var(--text-scale))', fontWeight: 700, color }}>{value}</p>
                </div>
              ))}
            </div>

            {/* External links — open via server to bypass WebView restrictions */}
            {(websiteUrl || readmeUrl || discordUrl) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {websiteUrl && (
                  <ExtLink url={websiteUrl} label={t.gallery.siteOfficiel}
                    bg="rgba(14,165,233,0.1)" color="#38bdf8" border="rgba(14,165,233,0.3)" />
                )}
                {readmeUrl && (
                  <ExtLink url={readmeUrl} label={t.gallery.guideInstall}
                    bg="rgba(14,165,233,0.1)" color="#0ea5e9" border="rgba(14,165,233,0.3)" />
                )}
                {discordUrl && (
                  <ExtLink url={discordUrl} label={t.gallery.discordLink}
                    bg="rgba(3,105,161,0.12)" color="#0ea5e9" border="rgba(3,105,161,0.35)" />
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', background: '#181818', borderTop: '1px solid #262626',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '7px 20px', borderRadius: 8, background: '#262626', border: 'none', color: '#dddddd', fontSize: 'calc(12px * var(--text-scale))', fontWeight: 500, cursor: 'pointer' }}>
            {t.gallery.detailClose}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main component ──────────────────────────────────────────────────────────
export const GalleryView: React.FC<GalleryViewProps> = ({ modlists, isLoading, onRefresh }) => {
  const { t, language } = useI18n();
  const formatBytes = (b: number) => fmtBytes(b, language, 'gb');
  const [search, setSearch]               = useState('');
  const [activeFilter, setActiveFilter]   = useState<GameFilterId>(DEFAULT_FILTER);
  const [otherGame, setOtherGame]         = useState<string>(ALL_OTHERS);
  const [selectedTag, setSelectedTag]     = useState<string>('all');
  const [hideNsfw, setHideNsfwState]      = useState<boolean>(() => localStorage.getItem('mabbajack_gallery_hide_nsfw') === '1');
  const setHideNsfw = (v: boolean) => {
    setHideNsfwState(v); localStorage.setItem('mabbajack_gallery_hide_nsfw', v ? '1' : '0');
    if (v && selectedTag === 'NSFW') setSelectedTag('all');
  };
  type SortKey = 'sizeAsc' | 'sizeDesc' | 'name' | 'updated';
  const [sortBy, setSortByState]          = useState<SortKey>(() => {
    const saved = localStorage.getItem('mabbajack_gallery_sort');
    return saved === 'sizeDesc' || saved === 'name' || saved === 'updated' ? saved : 'sizeAsc';
  });
  const setSortBy = (v: SortKey) => { setSortByState(v); localStorage.setItem('mabbajack_gallery_sort', v); };
  const [detailModlist, setDetailModlist] = useState<GalleryModlist | null>(null);

  const classified = useMemo(() => modlists.map((m) => ({ m, bucket: classifyModlist(m) })), [modlists]);

  const bucketCounts = useMemo(() => {
    const c: Record<GameFilterId, number> = { all: modlists.length, se: 0, ae: 0, ae17: 0, vr: 0, enderal: 0, other: 0 };
    for (const { bucket } of classified) c[bucket]++;
    return c;
  }, [classified, modlists.length]);

  // Jeux hors Skyrim/Enderal : { clé, nom, nombre }, triés par nom
  const otherGames = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number }>();
    for (const { m, bucket } of classified) {
      if (bucket !== 'other') continue;
      const key = gameKey(m.game);
      const cur = map.get(key);
      if (cur) cur.count++; else map.set(key, { key, name: prettyGameName(m.game), count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [classified]);

  const availableTags = useMemo(() => {
    const present = new Set<string>();
    for (const { m, bucket } of classified) {
      if (activeFilter === 'all' || bucket === activeFilter) {
        if (activeFilter === 'other' && otherGame !== ALL_OTHERS && gameKey(m.game) !== otherGame) continue;
        if (hideNsfw && matchesTagGroup(m, 'NSFW')) continue;
        const ts = tagSet(m);
        for (const g of TAG_GROUPS) if (g.test(ts, m)) present.add(g.label);
      }
    }
    return TAG_GROUPS.map((g) => g.label).filter((l) => present.has(l));
  }, [classified, activeFilter, otherGame, hideNsfw]);

  const filtered = useMemo(() =>
    classified
      .filter(({ m, bucket }) => {
        if (activeFilter !== 'all' && bucket !== activeFilter) return false;
        if (activeFilter === 'other' && otherGame !== ALL_OTHERS && gameKey(m.game) !== otherGame) return false;
        if (hideNsfw && matchesTagGroup(m, 'NSFW')) return false;
        if (selectedTag !== 'all' && !matchesTagGroup(m, selectedTag)) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          if (!m.title.toLowerCase().includes(q) && !m.author.toLowerCase().includes(q) &&
            !(m.description || '').toLowerCase().includes(q) && !m.tags?.some((tg) => tg.toLowerCase().includes(q))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'sizeAsc' || sortBy === 'sizeDesc') {
          const sa = a.m.download_metadata?.SizeOfArchives || 0;
          const sb = b.m.download_metadata?.SizeOfArchives || 0;
          if (!sa !== !sb) return sa ? -1 : 1; // taille inconnue toujours en fin de liste
          const diff = sortBy === 'sizeAsc' ? sa - sb : sb - sa;
          return diff || a.m.title.localeCompare(b.m.title);
        }
        if (sortBy === 'updated') return (b.m.dateUpdated || '').localeCompare(a.m.dateUpdated || '');
        return a.m.title.localeCompare(b.m.title);
      }),
    [classified, activeFilter, otherGame, selectedTag, hideNsfw, search, sortBy]
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-[#181818]">

      {/* ── Filter bar ─────────────────────────────────── */}
      <div className="bg-[#181818] border-b border-[#2e2e2e] flex-shrink-0">

        {/* Row 1 — Title + Search */}
        <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-white flex items-center gap-2">
              <span>{t.gallery.title}</span>
              <span className="text-caption font-mono px-1.5 py-0.5 rounded-full bg-[#1e1e1e] text-[#38bdf8] border border-[#2e2e2e]">{filtered.length}</span>
            </h2>
            <p className="text-meta text-[#666666] truncate">{t.gallery.subtitle}</p>
          </div>
          <div className="relative flex-shrink-0 w-56">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-meta text-[#666666]">🔍</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.gallery.searchPlaceholder}
              className="w-full h-8 pl-7 pr-7 bg-[#1e1e1e] border border-[#333333] rounded-md text-body text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9]" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#666666] hover:text-white text-body cursor-pointer">✕</button>}
          </div>
        </div>

        {/* Row 2 — Game filter buttons */}
        <div className="px-4 pb-2 flex flex-wrap items-center gap-2">
          <span className="text-caption text-[#666666] uppercase font-bold tracking-wider flex-shrink-0">{t.gallery.filterLabel}</span>
          {BUTTON_FILTERS.map((f) => {
            const isActive = activeFilter === f.id;
            return (
              <button key={f.id} type="button" onClick={() => { setActiveFilter(f.id); setSelectedTag('all'); }}
                className="flex items-center gap-1.5 px-3 h-[30px] rounded-lg text-body font-semibold border transition-all duration-150 cursor-pointer flex-shrink-0"
                style={isActive ? { color: f.activeColor, background: f.activeBg, borderColor: f.activeBorder } : { color: '#707070', background: '#1a1a1a', borderColor: '#2c2c2c' }}>
                <span>{f.icon}</span>
                <span>{filterLabel(f.id, f.label, language)}</span>
                {f.versionLabel && <span className="text-caption font-mono px-1 rounded font-bold opacity-80" style={isActive ? { color: f.color } : { color: '#444444' }}>{f.versionLabel}</span>}
                <span className="px-1.5 py-px rounded-full text-caption font-bold" style={isActive ? { background: f.color + '22', color: f.color } : { background: '#262626', color: '#444444' }}>{bucketCounts[f.id] ?? 0}</span>
              </button>
            );
          })}

          {/* Autres jeux : picklist */}
          {otherGames.length > 0 && (() => {
            const isActive = activeFilter === 'other';
            return (
              <select
                id="gallery-other-games"
                aria-label={filterLabel('other', OTHER_FILTER.label, language)}
                value={isActive ? otherGame : ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setActiveFilter('other'); setOtherGame(e.target.value); setSelectedTag('all');
                }}
                className="appearance-none ml-auto h-[30px] pl-3 pr-7 rounded-lg text-body font-semibold leading-none border transition-all duration-150 cursor-pointer w-[180px] flex-shrink-0 truncate focus:outline-none"
                style={{
                  ...(isActive
                    ? { color: OTHER_FILTER.activeColor, background: OTHER_FILTER.activeBg, borderColor: OTHER_FILTER.activeBorder }
                    : { color: '#707070', background: '#1a1a1a', borderColor: '#2c2c2c' }),
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2371717a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
                }}>
                <option value="" disabled>{OTHER_FILTER.icon} {filterLabel('other', OTHER_FILTER.label, language)} ({bucketCounts.other})</option>
                <option value={ALL_OTHERS}>{(GALLERY_UI[language] ?? GALLERY_UI.fr).allOthers} ({bucketCounts.other})</option>
                {otherGames.map((g) => <option key={g.key} value={g.key}>{g.name} ({g.count})</option>)}
              </select>
            );
          })()}
        </div>

        {/* Row 3 — Tag bar with arrows + Sort */}
        <div className="px-4 pb-3 flex items-center gap-2 border-t border-[#2e2e2e] pt-2">
          <button type="button" id="gallery-hide-nsfw" aria-pressed={hideNsfw} onClick={() => setHideNsfw(!hideNsfw)}
            className="flex-shrink-0 px-2.5 py-1 rounded-md text-body font-semibold border cursor-pointer transition-all duration-150"
            style={hideNsfw
              ? { color: '#fecaca', background: '#1a1a1a', borderColor: '#ef444488' }
              : { color: '#707070', background: '#1a1a1a', borderColor: '#2c2c2c' }}>
            {hideNsfw ? '🚫 ' : ''}{(GALLERY_UI[language] ?? GALLERY_UI.fr).hideNsfw}
          </button>
          <TagBar tags={availableTags} selectedTag={selectedTag} onSelect={setSelectedTag} labelAll={t.gallery.allGames} />
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} title={t.gallery.sortBy}
              className="bg-[#1e1e1e] border border-[#333333] rounded px-2 py-1 text-body text-[#dddddd] focus:outline-none focus:border-[#0ea5e9] cursor-pointer">
              <option value="sizeAsc">{t.gallery.sortSizeAsc}</option>
              <option value="sizeDesc">{t.gallery.sortSizeDesc}</option>
              <option value="name">{t.gallery.sortName}</option>
              <option value="updated">{t.gallery.sortUpdated}</option>
            </select>
            <button type="button" onClick={onRefresh} title={(COMMON_UI[language] ?? COMMON_UI.fr).refresh}
              className="h-7 w-7 flex items-center justify-center rounded bg-[#1e1e1e] hover:bg-[#262626] border border-[#333333] text-[#aaaaaa] hover:text-white text-body cursor-pointer">🔄</button>
          </div>
        </div>
      </div>

      {/* ── Content grid ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[#aaaaaa]">
            <div className="w-8 h-8 border-2 border-[#0ea5e9] border-t-transparent rounded-full animate-spin" />
            <p className="text-body">{t.gallery.loadingModlists}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-[#666666] py-16">
            <span className="text-5xl">📦</span>
            <p className="text-body-lg font-medium text-[#dddddd]">{t.gallery.noModlistsFound}</p>
            <button type="button" onClick={() => { setSearch(''); setActiveFilter('all'); setOtherGame(ALL_OTHERS); setSelectedTag('all'); }}
              className="px-3 py-1.5 rounded-md bg-[#0369a1]/20 text-[#38bdf8] border border-[#0ea5e9]/40 text-body font-medium hover:bg-[#0369a1]/30 cursor-pointer">
              {t.gallery.retryBtn}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(({ m: modlist, bucket }) => {
              const dlSize    = modlist.download_metadata?.SizeOfArchives || 0;
              const instSize  = modlist.download_metadata?.SizeOfInstalledFiles || 0;
              const archCount = modlist.download_metadata?.NumberOfArchives || 0;
              const bd        = GAME_FILTERS.find((f) => f.id === bucket)!;

              return (
                <div key={(modlist.links as any)?.machineURL || modlist.title}
                  className="group bg-[#181818] hover:bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#38bdf8]/40 rounded-xl overflow-hidden flex flex-col transition-all duration-200 shadow-md hover:shadow-xl hover:shadow-[#0369a1]/5">

                  {/* Banner image */}
                  <div className="relative h-36 w-full bg-[#1e1e1e] overflow-hidden flex-shrink-0">
                    {modlist.links?.image ? (
                      <img src={modlist.links.image} alt={modlist.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-[#1e1e1e]">🏔️</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-black/30" />
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      {modlist.official && <span className="px-2 py-0.5 rounded text-caption font-bold bg-[#0369a1] text-white">{t.gallery.officialBadge}</span>}
                      {modlist.nsfw && <span className="px-2 py-0.5 rounded text-caption font-bold bg-[#ef4444] text-white">{t.gallery.nsfwBadge}</span>}
                      <span className="px-1.5 py-0.5 rounded text-caption font-mono bg-black/60 text-[#aaaaaa]">v{modlist.version || '1.0'}</span>
                    </div>
                    <div className="absolute top-2.5 right-2.5">
                      <span className="px-2 py-0.5 rounded text-caption font-bold backdrop-blur-sm"
                        style={{ color: bd.color, background: 'rgba(0,0,0,0.70)', border: `1px solid ${bd.color}44` }}>
                        {bd.icon} {versionBadge(modlist, bd).text || filterLabel(bd.id, bd.label, language)}
                      </span>
                    </div>
                    <div className="absolute bottom-2 left-2.5 text-body flex items-center gap-1">
                      <span className="text-[#aaaaaa]">{t.gallery.byAuthor}</span>
                      <span className="text-[#38bdf8] font-semibold">{modlist.author}</span>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-title font-bold text-white group-hover:text-[#38bdf8] transition-colors line-clamp-1 mb-1">{modlist.title}</h3>
                      <CardDescription raw={modlist.description} language={language} fallback={t.gallery.noDescription} />
                      {modlist.tags && modlist.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {modlist.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="text-caption px-1.5 py-0.5 rounded border"
                              style={tag.toLowerCase().includes('anniversary') || tag === 'AE'
                                ? { background: 'rgba(245,158,11,0.08)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.25)' }
                                : { background: '#222222', color: '#aaaaaa', borderColor: '#303030' }}>{tag}</span>
                          ))}
                          {modlist.tags.length > 4 && <span className="text-caption px-1 py-0.5 rounded bg-[#222222] text-[#666666]">+{modlist.tags.length - 4}</span>}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#2e2e2e] flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2 text-body">
                        <div className="bg-[#1e1e1e] p-1.5 rounded border border-[#2e2e2e]">
                          <span className="text-[#666666] block text-caption uppercase tracking-wider">{t.gallery.statDl}</span>
                          <span className="text-[#38bdf8] font-bold">{formatBytes(dlSize)}</span>
                          <span className="text-[#666666] text-caption block">({archCount} {t.gallery.archivesCount})</span>
                        </div>
                        <div className="bg-[#1e1e1e] p-1.5 rounded border border-[#2e2e2e]">
                          <span className="text-[#666666] block text-caption uppercase tracking-wider">{t.gallery.statInstalled}</span>
                          <span className="text-[#4ade80] font-bold">{formatBytes(instSize)}</span>
                          <span className="text-[#666666] text-caption block">{t.gallery.installedSize}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <button type="button" onClick={() => setDetailModlist(modlist)}
                          className="flex-1 py-2 px-3 rounded-lg bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] hover:border-[#38bdf8]/40 text-[#dddddd] hover:text-[#38bdf8] text-body font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                          <span>ℹ️</span><span>{t.gallery.detailsBtn || 'Infos'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Detail Modal ─────────────────────────────── */}
      {detailModlist && (
        <DetailModal
          modlist={detailModlist}
          onClose={() => setDetailModlist(null)}
        />
      )}
    </div>
  );
};

export default GalleryView;
