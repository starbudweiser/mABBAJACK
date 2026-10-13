import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../locales';
import { INSTALLER_UI } from '../locales/uiExtra';
import { ParsedWabbajackFile, NexusAccount, InstallOptions } from '../types/wabbajack';
import OptionalModsCard from './OptionalModsCard';
import { pickNativeFolder, getNativeClipboard, getApiBaseUrl } from '../services/api';
import { btn, btnFull, badge, card, sectionLabel, inputField, chip, FieldRow, ApiKeyRow, Divider } from '../design';

interface InstallerViewProps {
  parsedFile: ParsedWabbajackFile | null;
  downloadsPath: string;
  setDownloadsPath: (p: string) => void;
  destPath: string;
  setDestPath: (p: string) => void;
  gamePath: string;
  setGamePath: (p: string) => void;
  onScanDownloads: () => void;
  onStartInstall: () => void;
  onOpenManualDownloads: () => void;
  onOpenPluginsTxt: () => void;
  nexusApiKey: string;
  setNexusApiKey: (k: string) => void;
  onVerifyNexusKey: (k: string) => Promise<NexusAccount>;
  nexusAccount: NexusAccount | null;
  isScanning: boolean;
  installOptions: InstallOptions;
  setInstallOptions: (o: InstallOptions) => void;
}

function formatBytes(bytes: number, fr = true): string {
  const mbUnit = fr ? 'Mo' : 'MB';
  const gbUnit = fr ? 'Go' : 'GB';
  if (!bytes || bytes <= 0) return `0 ${mbUnit}`;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ${gbUnit}`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} ${mbUnit}`;
}

/** Map wabbajack gameType + optional skyrimVersion classification to edition info */
function getEditionInfo(gameType: string, skyrimVersion?: string) {
  // skyrimVersion (from catalog multi-signal heuristic) takes priority
  const sv = (skyrimVersion || '').toLowerCase();
  if (sv === 'vr')  return { edition: 'VR', label: 'Skyrim VR',                    version: '1.4.x',  color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)', border: 'rgba(14,165,233,0.25)' };
  if (sv === 'ae')  return { edition: 'AE', label: 'Skyrim Anniversary Edition',    version: '1.6.x',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)'  };
  if (sv === 'se')  return { edition: 'SE', label: 'Skyrim Special Edition',         version: '1.5.97', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.22)'  };

  // Fallback: parse gameType string (for .wabbajack files loaded from disk)
  const g = (gameType || '').toLowerCase();
  if (g.includes('vr'))          return { edition: 'VR', label: 'Skyrim VR',                    version: '1.4.x',  color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)', border: 'rgba(14,165,233,0.25)' };
  if (g.includes('anniversary') || g === 'skyrimae')
    return { edition: 'AE',      label: 'Skyrim Anniversary Edition',    version: '1.6.x',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)'  };
  if (g.includes('special') || g.includes('se'))
    return { edition: 'SE',      label: 'Skyrim Special Edition',         version: '1.5.97', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.22)'  };
  return   { edition: '?',       label: 'Skyrim SE / AE',                  version: '?',      color: '#aaaaaa', bg: 'rgba(161,161,170,0.06)', border: 'rgba(161,161,170,0.18)' };
}

/** Version exacte exigée par le manifeste (GameVersion des fichiers originaux du jeu), ex. « 1.6.1170 » */
function getManifestGameVersion(archives?: Array<{ State?: unknown }>): string | null {
  for (const a of archives || []) {
    const v = String((a?.State as { GameVersion?: unknown } | undefined)?.GameVersion || '');
    if (/^\d+\.\d+\.\d+/.test(v)) return v.split('.').slice(0, 3).join('.');
  }
  return null;
}

/** Édition + version : le manifeste fait autorité sur l'heuristique du nom de jeu */
function resolveEditionInfo(gameType: string, skyrimVersion?: string, archives?: Array<{ State?: unknown }>) {
  const base = getEditionInfo(gameType, skyrimVersion);
  const gv = getManifestGameVersion(archives);
  if (!gv) return base;
  if (/vr/i.test(gameType || '')) return { ...getEditionInfo('SkyrimVR'), version: gv };
  if (/^1\.([6-9]|\d{2,})\./.test(gv)) return { ...getEditionInfo('SkyrimAE'), version: gv };
  if (/^1\.5\./.test(gv)) return { ...getEditionInfo('SkyrimSpecialEdition'), version: gv };
  return { ...base, version: gv };
}

interface SkyrimCompat {
  checking: boolean;
  found?: boolean;
  edition?: string;
  version?: string;
  hasCCContent?: boolean;
  compatible?: boolean;
  message?: string;
  level?: 'ok' | 'warn' | 'error';
  validationIssues?: string[];
}

const DOWNLOAD_PRESETS = [
  { label: '/Volumes/SKYRIM/DOWNLOADS',   value: '/Volumes/SKYRIM/DOWNLOADS' },
  { label: '/Volumes/LaCie 6To/DOWNLOADS', value: '/Volumes/LaCie 6To/DOWNLOADS' },
];

const DEST_PRESETS = [
  { label: '/Volumes/SKYRIM/READY_TO_PLAY',    value: '/Volumes/SKYRIM/READY_TO_PLAY' },
  { label: '/Volumes/LaCie 6To/READY_TO_PLAY', value: '/Volumes/LaCie 6To/READY_TO_PLAY' },
];

const SKYRIM_PRESETS = [
  { label: '/Volumes/SKYRIM/GAMES/Skyrim Special Edition',    value: '/Volumes/SKYRIM/GAMES/Skyrim Special Edition' },
  { label: '/Volumes/LaCie 6To/GAMES/Skyrim Special Edition', value: '/Volumes/LaCie 6To/GAMES/Skyrim Special Edition' },
];

// ── Component ──────────────────────────────────────────────────────────────────
export const InstallerView: React.FC<InstallerViewProps> = ({
  parsedFile, downloadsPath, setDownloadsPath, destPath, setDestPath, gamePath, setGamePath,
  onScanDownloads, onStartInstall, onOpenManualDownloads, onOpenPluginsTxt,
  nexusApiKey, setNexusApiKey, onVerifyNexusKey, nexusAccount, isScanning, installOptions, setInstallOptions,
}) => {
  const { t, language } = useI18n();
  const ui = INSTALLER_UI[language] ?? INSTALLER_UI.fr;
  const isFr = language === 'fr';

  // API key state
  const [apiKeyInput, setApiKeyInput] = useState(nexusApiKey);
  const [showKey, setShowKey] = useState(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);


  // Browse state
  const [browsingKey, setBrowsingKey] = useState<string | null>(null);

  useEffect(() => { if (nexusApiKey) setApiKeyInput(nexusApiKey); }, [nexusApiKey]);

  const readyArchives  = parsedFile?.archives.filter((a) => a.status === 'ready').length || 0;
  const totalArchives  = parsedFile?.archives.length || 0;
  const missingArchives = totalArchives - readyArchives;
  const gameArchives = parsedFile?.archives.filter((a) => a.sourceKind === 'game') || [];
  const missingGameArchives = gameArchives.filter((a) => a.status !== 'ready');
  const editionInfo = parsedFile?.gameType ? resolveEditionInfo(parsedFile.gameType, parsedFile.skyrimVersion, parsedFile.archives) : null;


  // ── Helpers ───────────────────────────────────────────────────────────────
  const pastePath = async (setter: (v: string) => void, key: string) => {
    let text = await getNativeClipboard();
    if (!text?.trim()) { const fb = prompt(ui.pastePrompt, ''); if (fb !== null) text = fb; }
    if (text?.trim()) { setter(text.trim()); localStorage.setItem(key, text.trim()); }
  };

  const browsePath = async (title: string, current: string, setter: (v: string) => void, key: string, setBrowsing?: (b: boolean) => void) => {
    setBrowsing ? setBrowsing(true) : setBrowsingKey(title);
    const res = await pickNativeFolder(title, current);
    setBrowsing ? setBrowsing(false) : setBrowsingKey(null);
    if (res.path) { setter(res.path); localStorage.setItem(key, res.path); return; }
    if (res.cancelled) return;
    const fb = prompt(`${ui.pathPrompt} ${title}`, current || '');
    if (fb?.trim()) { setter(fb.trim()); localStorage.setItem(key, fb.trim()); }
  };

  const handleVerifyKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsVerifyingKey(true); setKeyMsg(null);
    try {
      const acc = await onVerifyNexusKey(apiKeyInput.trim());
      setNexusApiKey(apiKeyInput.trim()); localStorage.setItem('mabbajack_nexus_key', apiKeyInput.trim());
      setKeyMsg(acc.valid
        ? `✓ ${acc.name} — ${acc.isPremium ? ui.premiumAuto : ui.standardManual}`
        : ui.keyInvalid);
    } catch { setKeyMsg(ui.keyError); }
    finally { setIsVerifyingKey(false); }
  };

  const setPath = (setter: (v: string) => void, key: string) => (v: string) => { setter(v); localStorage.setItem(key, v); };


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#181818] flex flex-col items-center select-text">
      <div className="max-w-2xl w-full flex flex-col gap-4">

        {/* ── PAGE HEADER ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2e2e2e]">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>⚡</span>
              <span>{ui.title}</span>
            </h2>
            <p className="text-[11px] text-[#666666] mt-0.5">{ui.subtitle}</p>
          </div>
          {parsedFile && (
            <button type="button" onClick={onOpenPluginsTxt} className={btn.secondary}>
              <span>📄</span><span>{t.installer.exportPluginsTxt}</span>
            </button>
          )}
        </div>

        {/* ── CARD 1: Modlist ──────────────────────────────────────── */}
        <div className={card}>
          <div className="flex items-center justify-between">
            <span className={sectionLabel}><span>📋</span><span>{ui.modlistLoaded}</span></span>
            {parsedFile && <span className={badge.blue}>{parsedFile.numberOfArchives} archives · {formatBytes(parsedFile.totalArchiveSize, isFr)}</span>}
          </div>

          {/* ── Demo mode warning ─────────────────────────────────────── */}
          {parsedFile && !parsedFile.localFilePath && (
            <div style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>🚫</span>
              <div>
                <p style={{ color: '#f87171', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                  {ui.previewTitle}
                </p>
                <p style={{ color: '#fecaca', fontSize: 11, lineHeight: 1.5 }}>
                  {ui.previewBody1} {ui.previewBody2}
                </p>
                <p style={{ color: '#fecaca', fontSize: 11, marginTop: 6 }}>
                  {ui.previewBody3} <strong>{ui.previewOpenBtn}</strong>{' '}
                  (<a href="https://www.wabbajack.org" target="_blank" rel="noreferrer" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>wabbajack.org</a>)
                </p>
              </div>
            </div>
          )}

          {parsedFile ? (
            <>
              <div className="bg-[#1a1a1a] px-3 py-2.5 rounded-lg border border-[#2e2e2e] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-white block truncate">{parsedFile.name}</span>
                  <span className="text-[11px] text-[#666666]">{ui.by} {parsedFile.author} · v{parsedFile.version || '1.0'}</span>
                </div>
                <span className={badge.green}>{ui.loaded}</span>
              </div>

              {/* Edition badge */}
              {editionInfo && (
                <div style={{ padding: '8px 12px', background: editionInfo.bg, border: `1px solid ${editionInfo.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: editionInfo.color }}>🎮 {editionInfo.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#707070', marginTop: 2 }}>
                      {ui.requiredVersion} <strong style={{ color: editionInfo.color }}>{editionInfo.version}</strong>
                    </span>
                  </div>
                  <code style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 5, background: `${editionInfo.color}18`, color: editionInfo.color, border: `1px solid ${editionInfo.color}33` }}>
                    {parsedFile.gameType}
                  </code>
                </div>
              )}
            </>
          ) : (
            <div className="bg-[#181818] border border-[#f59e0b] px-3 py-2.5 rounded-lg text-[11px] text-[#fbbf24]">
              {ui.noModlist}
            </div>
          )}
        </div>

        {/* ── Mods optionnels (désactivés par défaut dans la modlist) ───── */}
        <OptionalModsCard filePath={parsedFile?.localFilePath} value={installOptions} onChange={setInstallOptions} />

        {/* ── CARD 3: DOWNLOADS ───────────────────────────────────── */}
        <div className={card}>
          <div className="flex items-center justify-between">
            <span className={sectionLabel}><span>📥</span><span>{ui.downloadsTitle}</span></span>
            {parsedFile && (
              <button type="button" onClick={onScanDownloads} disabled={isScanning} className={btn.ghost}>
                <span>{isScanning ? '⏳' : '🔄'}</span>
                <span>{t.installer.scanDownloads}</span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-[#666666] -mt-1">{ui.downloadsHint}</p>
          <FieldRow
            label=""
            value={downloadsPath}
            onChange={setPath(setDownloadsPath, 'mabbajack_downloads_path')}
            onPaste={() => pastePath(setPath(setDownloadsPath, 'mabbajack_downloads_path'), 'mabbajack_downloads_path')}
            onBrowse={() => browsePath(ui.downloadsSelect, downloadsPath, setPath(setDownloadsPath, 'mabbajack_downloads_path'), 'mabbajack_downloads_path')}
            isBrowsing={browsingKey === ui.downloadsSelect}
            placeholder="/Volumes/SKYRIM/DOWNLOADS"
            presets={DOWNLOAD_PRESETS}
            onPreset={setPath(setDownloadsPath, 'mabbajack_downloads_path')}
          />

          {parsedFile && (
            <div className="flex items-center justify-between bg-[#1a1a1a] border border-[#2e2e2e] px-3 py-2 rounded-lg text-[11px]">
              <span className="text-[#666666]">
                {ui.cache} <strong className="text-white">{readyArchives}</strong> / {totalArchives} {ui.archivesReady}
              </span>
              {missingArchives > 0 ? (
                <button type="button" onClick={onOpenManualDownloads} className={btn.warning}>
                  {missingArchives} {ui.missing}
                </button>
              ) : (
                <span className={badge.green}>{ui.allPresent}</span>
              )}
            </div>
          )}
        </div>

        {/* ── CARD 4: READY TO PLAY ────────────────────────────────── */}
        <div className={card}>
          <div className="flex items-center justify-between">
            <span className={sectionLabel}><span>🚀</span><span>{ui.destTitle}</span></span>
            <span className={badge.blue}>{ui.destBadge}</span>
          </div>
          <p className="text-[11px] text-[#666666] -mt-1">{ui.destHint}</p>
          <FieldRow
            label=""
            value={destPath}
            onChange={setPath(setDestPath, 'mabbajack_dest_path')}
            onPaste={() => pastePath(setPath(setDestPath, 'mabbajack_dest_path'), 'mabbajack_dest_path')}
            onBrowse={() => browsePath(ui.destSelect, destPath, setPath(setDestPath, 'mabbajack_dest_path'), 'mabbajack_dest_path')}
            isBrowsing={browsingKey === ui.destSelect}
            placeholder="/Volumes/SKYRIM/READY_TO_PLAY"
            presets={DEST_PRESETS}
            onPreset={setPath(setDestPath, 'mabbajack_dest_path')}
          />
        </div>

        {/* ── CARD 5: Dossier du jeu (fichiers originaux GameFileSource) ──── */}
        <div className={card}>
          <span className={sectionLabel}><span>🎮</span><span>{t.installer.gameFolderTitle}</span></span>
          <p className="text-[11px] text-[#666666] -mt-1">{t.installer.gameFolderHint}</p>
          <FieldRow
            label=""
            value={gamePath}
            onChange={setPath(setGamePath, 'mabbajack_game_path')}
            onPaste={() => pastePath(setPath(setGamePath, 'mabbajack_game_path'), 'mabbajack_game_path')}
            onBrowse={() => browsePath(t.installer.gameFolderSelect, gamePath, setPath(setGamePath, 'mabbajack_game_path'), 'mabbajack_game_path')}
            isBrowsing={browsingKey === t.installer.gameFolderSelect}
            placeholder="/Volumes/SKYRIM/GAMES/Skyrim Special Edition"
            presets={SKYRIM_PRESETS}
            onPreset={setPath(setGamePath, 'mabbajack_game_path')}
          />
          {gameArchives.length > 0 && (
            missingGameArchives.length > 0 ? (
              <div className="bg-[#181818] border border-[#f59e0b] px-3 py-2.5 rounded-lg text-[11px] text-[#fbbf24] flex flex-col gap-1">
                <span className="font-semibold">⚠ {t.installer.gameFilesMissing.replace('{n}', String(missingGameArchives.length))}</span>
                {missingGameArchives.map((a) => (
                  <code key={a.Hash || a.Name} className="font-mono text-[10px] text-[#fbbf24] break-all">{a.expectedPath || a.Name}</code>
                ))}
              </div>
            ) : (
              <span className={badge.green}>{t.installer.gameFilesFound} ({gameArchives.length})</span>
            )
          )}
        </div>

        {/* ── CARD 5: Clé API Nexus ────────────────────────────────── */}
        <div className={card}>
          <p className="text-[11px] text-[#666666]">
            <span className="text-[#fbbf24]">{ui.nexusInfoPremium}</span>{' '}
            <span className="text-white">{ui.nexusInfoStandard}</span>
          </p>
          <ApiKeyRow
            value={apiKeyInput}
            onChange={(v) => { setApiKeyInput(v); setNexusApiKey(v); localStorage.setItem('mabbajack_nexus_key', v); }}
            onPaste={async () => {
              let text = await getNativeClipboard();
              if (!text?.trim()) { const fb = prompt(ui.pasteKeyPrompt); if (fb !== null) text = fb; }
              if (text?.trim()) {
                const key = text.trim();
                setApiKeyInput(key); setNexusApiKey(key); localStorage.setItem('mabbajack_nexus_key', key);
                setKeyMsg(`${ui.keyPasted} (${key.slice(0, 8)}… · ${key.length})`);
              }
            }}
            onVerify={handleVerifyKey}
            showKey={showKey}
            onToggleShow={() => setShowKey(!showKey)}
            isVerifying={isVerifyingKey}
            message={keyMsg}
            status={nexusAccount?.valid ? (
              <span className={nexusAccount.isPremium ? badge.purple : badge.blue}>
                {nexusAccount.isPremium ? '⭐ Premium' : 'Standard'}
              </span>
            ) : undefined}
          />
        </div>

        {/* ── LAUNCH BUTTON ─────────────────────────────────────────── */}
        <div className="pt-1 flex flex-col gap-2">
          {/* Bloc launch button — disabled if no real .wabbajack */}
          {parsedFile && !parsedFile.localFilePath ? (
            <div style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.30)',
              borderRadius: 10,
              padding: '12px 16px',
              textAlign: 'center',
            }}>
              <p style={{ color: '#f87171', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{ui.blockedTitle}</p>
              <p style={{ color: '#fecaca', fontSize: 11 }}>{ui.blockedBody}</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={onStartInstall}
              disabled={!parsedFile || !destPath}
              className={parsedFile && destPath ? btnFull.primary : btnFull.disabled}
            >
              <span>⚡</span>
              <span>{ui.launch}</span>
            </button>
          )}


          <p className="text-[10px] text-[#666666] text-center">
            {ui.footer}
          </p>
        </div>

      </div>
    </div>
  );
};

export default InstallerView;
