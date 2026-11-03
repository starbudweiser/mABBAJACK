import React, { useEffect, useState } from 'react';
import { useI18n } from '../locales';
import { fmtBytes } from '../locales/uiScreens';
import { INSTALLER_UI } from '../locales/uiExtra';
import { SIMPLE_UI, fillText } from '../locales/uiSimple';
import { useMabbajack } from '../state/mabbajack';
import { ApiKeyRow, FieldRow, btn, card, sectionLabel } from '../design';
import { getApiBaseUrl, getNativeClipboard, pickNativeFolder } from '../services/api';
import OptionalModsCard from '../components/OptionalModsCard';
import { requiredEdition, useDetectedGame } from './useGame';

export const PrepareStep: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { language } = useI18n();
  const ui = SIMPLE_UI[language] ?? SIMPLE_UI.fr;
  const inst = INSTALLER_UI[language] ?? INSTALLER_UI.fr;
  const m = useMabbajack();
  const { parsedFile, downloadsPath, destPath, gamePath, nexusAccount } = m;
  const game = useDetectedGame();
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState(m.nexusApiKey);
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [free, setFree] = useState<{ same: boolean; dl: number | null; dest: number | null } | null>(null);

  // Le jeu détecté devient le dossier du jeu tant que l'utilisateur n'en a pas choisi un autre
  useEffect(() => { if (game.found && game.path && !gamePath) m.setGamePath(game.path); }, [game.found, game.path, gamePath]);
  useEffect(() => { setKeyInput(m.nexusApiKey); }, [m.nexusApiKey]);

  // Espace libre des disques choisis
  useEffect(() => {
    if (!downloadsPath && !destPath) { setFree(null); return; }
    let alive = true;
    fetch(`${getApiBaseUrl()}/api/system/disk-space`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [downloadsPath, destPath] }),
    }).then((r) => r.json()).then((d) => {
      if (!alive) return;
      const [a, b] = d.volumes || [];
      setFree({ same: !!a && !!b && a.dev === b.dev, dl: a?.free ?? null, dest: b?.free ?? null });
    }).catch(() => { if (alive) setFree(null); });
    return () => { alive = false; };
  }, [downloadsPath, destPath]);

  if (!parsedFile) return null;

  const pick = async (title: string, current: string, set: (v: string) => void) => {
    setBrowsing(title);
    const res = await pickNativeFolder(title, current);
    setBrowsing(null);
    if (res.path) { set(res.path); return; }
    if (res.cancelled) return;
    const fb = prompt(ui.pastePrompt, current || '');
    if (fb?.trim()) set(fb.trim());
  };
  const paste = async (set: (v: string) => void) => {
    let text = await getNativeClipboard();
    if (!text?.trim()) { const fb = prompt(ui.pastePrompt, ''); if (fb !== null) text = fb; }
    if (text?.trim()) set(text.trim());
  };
  const verifyKey = async () => {
    if (!keyInput.trim()) return;
    setVerifying(true); setKeyMsg(null);
    try {
      const acc = await m.verifyNexusKey(keyInput.trim());
      m.setNexusApiKey(keyInput.trim());
      setKeyMsg(acc.valid ? null : acc.offline ? ui.nexusOffline : ui.nexusInvalid);
    } finally { setVerifying(false); }
  };

  const isDemo = !parsedFile.localFilePath;
  const need = requiredEdition(parsedFile.archives);
  const mismatch = game.found && need && (game.edition === 'SE' || game.edition === 'AE') && need !== game.edition;
  const archivesSize = parsedFile.totalArchiveSize || 0;
  const installedSize = parsedFile.totalInstalledSize || 0;
  const needed = archivesSize + installedSize;
  const low = free && (free.same
    ? free.dl !== null && free.dl < needed
    : (free.dl !== null && free.dl < archivesSize) || (free.dest !== null && free.dest < installedSize));
  const freeSize = free ? Math.min(...[free.dl, free.dest].filter((v): v is number => v !== null)) : null;
  const ready = !!downloadsPath && !!destPath && !isDemo;

  return (
    <div className="flex-1 overflow-y-auto p-6 select-text">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-display font-bold text-white">{ui.prepareTitle}</h2>
            <p className="text-body-lg text-[#aaaaaa] mt-1">
              <span className="text-white font-semibold">{parsedFile.name}</span>
              {parsedFile.author ? ` · ${ui.by} ${parsedFile.author}` : ''}{parsedFile.version ? ` · v${parsedFile.version}` : ''}
            </p>
          </div>
          <button type="button" className={btn.ghost} onClick={onBack}>← {ui.changeModlist}</button>
        </div>

        {isDemo && <div className={`${card} border-[#ef4444]/40 text-[#f87171] text-body`}>{ui.preview}</div>}

        {/* Jeu */}
        <div className={card}>
          <span className={sectionLabel}><span>🎮</span><span>{ui.yourGame}</span></span>
          {game.found
            ? <p className="text-body text-[#4ade80]">✓ {fillText(ui.gameDetected, { edition: game.edition })}</p>
            : game.loaded && <p className="text-body text-[#fbbf24]">{ui.gameNotFound}</p>}
          {mismatch && <p className="text-body text-[#fbbf24]">⚠ {fillText(ui.gameMismatch, { need: need!, have: game.edition })}</p>}
          {(!game.found || !game.auto) && game.loaded && (
            <FieldRow label={ui.gameFolder} icon="📂" value={gamePath} onChange={m.setGamePath}
              onPaste={() => paste(m.setGamePath)} onBrowse={() => pick(ui.gameFolder, gamePath, m.setGamePath)}
              isBrowsing={browsing === ui.gameFolder} placeholder="…/Skyrim Special Edition" />
          )}
        </div>

        {/* Dossiers */}
        <div className={card}>
          <FieldRow label={ui.downloadsFolder} icon="📥" value={downloadsPath} onChange={m.setDownloadsPath}
            onPaste={() => paste(m.setDownloadsPath)} onBrowse={() => pick(ui.downloadsFolder, downloadsPath, m.setDownloadsPath)}
            isBrowsing={browsing === ui.downloadsFolder} placeholder="/Volumes/Disque/DOWNLOADS" />
          <p className="text-meta text-[#8f8f8f] -mt-1">{ui.downloadsHint}</p>
          <FieldRow label={ui.destFolder} icon="🚀" value={destPath} onChange={m.setDestPath}
            onPaste={() => paste(m.setDestPath)} onBrowse={() => pick(ui.destFolder, destPath, m.setDestPath)}
            isBrowsing={browsing === ui.destFolder} placeholder="/Volumes/Disque/READY_TO_PLAY" />
          <p className="text-meta text-[#8f8f8f] -mt-1">{ui.destHint}</p>
          {needed > 0 && (
            <p className={`text-body ${low ? 'text-[#fbbf24]' : 'text-[#aaaaaa]'}`}>
              {low
                ? `⚠ ${fillText(ui.diskLow, { need: fmtBytes(needed, language, 'gb'), free: fmtBytes(freeSize ?? 0, language, 'gb') })}`
                : fillText(ui.diskNeed, { size: fmtBytes(needed, language, 'gb') }) + (freeSize !== null ? ` ${fillText(ui.diskFree, { size: fmtBytes(freeSize, language, 'gb') })}` : '')}
            </p>
          )}
        </div>

        {/* Nexus */}
        <div className={card}>
          <span className={sectionLabel}><span>🛡️</span><span>{ui.nexusTitle}</span></span>
          {nexusAccount?.valid ? (
            <p className="text-body text-[#4ade80]">✓ {nexusAccount.name} — {nexusAccount.isPremium ? ui.nexusPremium : ui.nexusFree}</p>
          ) : (
            <>
              <p className="text-body text-[#aaaaaa]">{ui.nexusNoKey}</p>
              <ApiKeyRow value={keyInput} onChange={setKeyInput}
                onPaste={async () => { const t = (await getNativeClipboard())?.trim(); if (t) { setKeyInput(t); setKeyMsg(inst.keyPasted); } }}
                onVerify={verifyKey} showKey={showKey} onToggleShow={() => setShowKey(!showKey)} isVerifying={verifying} message={keyMsg} />
            </>
          )}
        </div>

        {/* Mods optionnels */}
        {!isDemo && (
          <details className={`${card} group`}>
            <summary className="cursor-pointer select-none text-body font-semibold text-white">{ui.customize}</summary>
            <div className="pt-3">
              <OptionalModsCard filePath={parsedFile.localFilePath} destPath={destPath} value={m.installOptions} onChange={m.setInstallOptions} />
            </div>
          </details>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 pb-6">
          {!ready && !isDemo && <span className="text-meta text-[#8f8f8f]">{ui.startHint}</span>}
          <button type="button" disabled={!ready} onClick={m.startInstall} className={ready ? btn.primary : btn.disabled}>🚀 {ui.start}</button>
        </div>
      </div>
    </div>
  );
};

export default PrepareStep;
