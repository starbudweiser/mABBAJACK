import React, { useState } from 'react';
import { useI18n } from '../locales';
import { NexusAccount } from '../types/wabbajack';
import { pickNativeFolder, getNativeClipboard } from '../services/api';
import { SETTINGS_UI } from '../locales/uiScreens';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  nexusApiKey: string;
  setNexusApiKey: (key: string) => void;
  onVerifyNexusKey: (key: string) => Promise<NexusAccount>;
  nexusAccount: NexusAccount | null;
  defaultDownloadsPath: string;
  setDefaultDownloadsPath: (p: string) => void;
  defaultDestPath: string;
  setDefaultDestPath: (p: string) => void;
  concurrency: number;
  setConcurrency: (c: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  nexusApiKey,
  setNexusApiKey,
  onVerifyNexusKey,
  nexusAccount,
  defaultDownloadsPath,
  setDefaultDownloadsPath,
  defaultDestPath,
  setDefaultDestPath,
  concurrency,
  setConcurrency,
}) => {
  const { t, language } = useI18n();
  const ui = SETTINGS_UI[language] ?? SETTINGS_UI.fr;
  const [keyInput, setKeyInput] = useState(nexusApiKey);
  const [downloadsInput, setDownloadsInput] = useState(defaultDownloadsPath);
  const [destInput, setDestInput] = useState(defaultDestPath);
  const [showKey, setShowKey] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState<string | null>(null);

  if (!isOpen) return null;

  // Native folder pickers via backend with generous timeout and manual prompt fallback
  const pickFolder = async (title: string, currentVal: string, setter: (val: string) => void) => {
    setIsBrowsing(title);
    const res = await pickNativeFolder(title, currentVal);
    setIsBrowsing(null);

    if (res.path) {
      setter(res.path);
      return;
    }

    if (res.cancelled) {
      return;
    }

    const manual = prompt(ui.manualPathPrompt.replace('{title}', title), currentVal || '');
    if (manual !== null && manual.trim()) {
      setter(manual.trim());
    }
  };

  const handlePastePath = async (setter: (val: string) => void, currentVal: string) => {
    let pastedText = await getNativeClipboard();
    if (!pastedText || !pastedText.trim()) {
      const fallback = prompt(ui.pastePathPrompt, currentVal || '');
      if (fallback !== null) pastedText = fallback;
    }
    if (pastedText && pastedText.trim()) {
      setter(pastedText.trim());
    }
  };

  const handlePaste = async () => {
    let pastedText = await getNativeClipboard();

    if (!pastedText || !pastedText.trim()) {
      const fallback = prompt(ui.pasteKeyPrompt, keyInput || '');
      if (fallback !== null) pastedText = fallback;
    }

    if (pastedText && pastedText.trim()) {
      const key = pastedText.trim();
      setKeyInput(key);
      setNexusApiKey(key);
      localStorage.setItem('mabbajack_nexus_key', key);
      setVerifyMessage(`${ui.keyPasted} (${key.slice(0, 8)}… · ${key.length})`);
    }
  };

  const handleVerify = async () => {
    if (!keyInput.trim()) return;
    setIsVerifying(true);
    setVerifyMessage(null);
    try {
      const acc = await onVerifyNexusKey(keyInput.trim());
      setNexusApiKey(keyInput.trim());
      localStorage.setItem('mabbajack_nexus_key', keyInput.trim());
      if (acc.valid) {
        setVerifyMessage(`✓ ${t.settings.keyValid} ${acc.name} (${acc.isPremium ? 'Premium ⭐' : 'Standard'})`);
      } else {
        setVerifyMessage(`✕ ${t.settings.keyInvalid}`);
      }
    } catch {
      setVerifyMessage(`✕ ${t.settings.keyInvalid}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = () => {
    const trimmedKey = keyInput.trim();
    setNexusApiKey(trimmedKey);
    localStorage.setItem('mabbajack_nexus_key', trimmedKey);

    const trimmedDownloads = downloadsInput.trim();
    setDefaultDownloadsPath(trimmedDownloads);
    localStorage.setItem('mabbajack_downloads_path', trimmedDownloads);

    const trimmedDest = destInput.trim();
    setDefaultDestPath(trimmedDest);
    localStorage.setItem('mabbajack_dest_path', trimmedDest);

    localStorage.setItem('mabbajack_concurrency', concurrency.toString());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl max-w-xl w-full flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="p-4 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <div>
              <h3 className="text-sm font-bold text-white">{t.settings.title}</h3>
              <p className="text-[11px] text-[#8f8f8f]">{t.settings.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#aaaaaa] hover:text-white px-2 py-1 text-base cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs select-text">
          {/* Section 1: Nexus Mods Integration */}
          <div className="space-y-2">
            <span className="font-bold text-white text-xs uppercase tracking-wider block flex items-center gap-1.5">
              <span>🛡️</span>
              <span>{t.settings.nexusSection} / Vortex</span>
            </span>

            <p className="text-[11px] text-[#8f8f8f] leading-relaxed">
              {t.settings.nexusApiKeyLabel}
            </p>

            <div className="flex items-center gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData?.getData('text');
                  if (text) {
                    const clean = text.trim();
                    setKeyInput(clean);
                    setNexusApiKey(clean);
                    localStorage.setItem('mabbajack_nexus_key', clean);
                    setVerifyMessage(`${ui.keyPasted} (${clean.slice(0, 8)}… · ${clean.length})`);
                  }
                }}
                placeholder={ui.keyPlaceholder}
                className="flex-1 h-9 px-3 bg-[#1e1e1e] border border-[#333333] rounded-md text-xs font-mono text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9] select-text"
              />

              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? ui.hideKey : ui.showKey}
                className="h-9 px-2.5 bg-[#262626] hover:bg-[#303030] text-[#aaaaaa] hover:text-white rounded-md text-xs transition-colors cursor-pointer flex-shrink-0"
              >
                {showKey ? '🔒' : '👁️'}
              </button>

              <button
                type="button"
                onClick={handlePaste}
                title={ui.pasteFromClipboard}
                className="h-9 px-3 bg-[#262626] hover:bg-[#404040] border border-[#444444] text-white font-semibold text-xs rounded-md transition-colors cursor-pointer flex-shrink-0 flex items-center gap-1"
              >
                <span>📋</span>
                <span>{ui.paste}</span>
              </button>

              <button
                type="button"
                onClick={handleVerify}
                disabled={isVerifying || !keyInput.trim()}
                className="h-9 px-3 rounded-md bg-[#0369a1] hover:bg-[#0369a1] disabled:bg-[#2c2c2c] disabled:text-[#666666] text-white font-bold text-xs transition-colors cursor-pointer flex-shrink-0"
              >
                {isVerifying ? ui.verifying : t.settings.verifyKeyBtn}
              </button>
            </div>

            {verifyMessage && (
              <div
                className={`p-2 rounded text-[11px] font-medium ${
                  verifyMessage.startsWith('✓')
                    ? 'bg-[#262626] text-[#4ade80] border border-[#22c55e]'
                    : 'bg-[#1e1e1e] text-[#f87171] border border-[#ef4444]'
                }`}
              >
                {verifyMessage}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-[#666666]">
                {nexusAccount?.isPremium
                  ? t.settings.nexusPremiumActive
                  : t.settings.nexusStandardAccount}
              </span>
              <a
                href="https://www.nexusmods.com/users/myaccount?tab=api"
                target="_blank"
                rel="noreferrer"
                className="text-[#38bdf8] hover:underline"
              >
                {t.settings.getKeyLink}
              </a>
            </div>
          </div>

          {/* Section 2: Default Paths (STRICTLY 2 DIRECTORIES) */}
          <div className="space-y-3 pt-3 border-t border-[#2e2e2e]">
            <span className="font-bold text-white text-xs uppercase tracking-wider block flex items-center gap-1.5">
              <span>📁</span>
              <span>{ui.foldersSection}</span>
            </span>

            <div className="space-y-1">
              <span className="text-[11px] text-[#aaaaaa] block">{ui.downloadsLabel}</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={downloadsInput}
                  onChange={(e) => setDownloadsInput(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData('text');
                    if (text) setDownloadsInput(text.trim());
                  }}
                  placeholder="/Volumes/SKYRIM/DOWNLOADS"
                  className="flex-1 h-8 px-3 bg-[#1e1e1e] border border-[#333333] rounded-md text-xs font-mono text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9] select-text"
                />
                <button
                  type="button"
                  onClick={() => handlePastePath(setDownloadsInput, downloadsInput)}
                  className="h-8 px-2.5 bg-[#262626] hover:bg-[#404040] border border-[#444444] text-white rounded-md text-xs font-semibold cursor-pointer"
                  title={ui.pastePath}
                >
                  📋
                </button>
                <button
                  type="button"
                  onClick={() => pickFolder(ui.downloadsPickTitle, downloadsInput, setDownloadsInput)}
                  className="h-8 px-3 bg-[#262626] hover:bg-[#333333] border border-[#333333] text-white rounded-md text-xs font-semibold cursor-pointer"
                >
                  {isBrowsing === ui.downloadsPickTitle ? ui.selecting : ui.browse}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] text-[#aaaaaa] block">{ui.destLabel}</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={destInput}
                  onChange={(e) => setDestInput(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData('text');
                    if (text) setDestInput(text.trim());
                  }}
                  placeholder="/Volumes/SKYRIM/READY_TO_PLAY"
                  className="flex-1 h-8 px-3 bg-[#1e1e1e] border border-[#333333] rounded-md text-xs font-mono text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9] select-text"
                />
                <button
                  type="button"
                  onClick={() => handlePastePath(setDestInput, destInput)}
                  className="h-8 px-2.5 bg-[#262626] hover:bg-[#404040] border border-[#444444] text-white rounded-md text-xs font-semibold cursor-pointer"
                  title={ui.pastePath}
                >
                  📋
                </button>
                <button
                  type="button"
                  onClick={() => pickFolder(ui.destPickTitle, destInput, setDestInput)}
                  className="h-8 px-3 bg-[#262626] hover:bg-[#333333] border border-[#333333] text-white rounded-md text-xs font-semibold cursor-pointer"
                >
                  {isBrowsing === ui.destPickTitle ? ui.selecting : ui.browse}
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Performance */}
          <div className="space-y-3 pt-3 border-t border-[#2e2e2e]">
            <span className="font-bold text-white text-xs uppercase tracking-wider block flex items-center gap-1.5">
              <span>⚡</span>
              <span>{t.settings.performanceSection}</span>
            </span>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-white block font-medium">{t.settings.concurrencyThreads}</span>
                <span className="text-[11px] text-[#666666]">
                  {ui.threadsHint}
                </span>
              </div>
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                className="h-8 px-3 bg-[#1e1e1e] border border-[#333333] rounded-md text-xs text-white focus:outline-none focus:border-[#0ea5e9]"
              >
                <option value={2}>2 {ui.threads}</option>
                <option value={4}>4 {ui.threads} ({ui.recommended})</option>
                <option value={8}>8 {ui.threads} (M Pro/Max)</option>
                <option value={12}>12 {ui.threads}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#181818] border-t border-[#2e2e2e] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#262626] hover:bg-[#333333] text-[#dddddd] text-xs font-medium transition-colors cursor-pointer"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-[#0369a1] hover:bg-[#0369a1] text-white text-xs font-bold transition-colors cursor-pointer"
          >
            {t.settings.saveBtn}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
