import React, { useState } from 'react';
import { useI18n } from '../locales';
import { useEscapeKey } from '../design';
import { PLUGINS_UI } from '../locales/uiScreens';
import { fillText } from '../locales/plural.ts';

interface PluginsTxtModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginsTxtContent: string;
  modlistName?: string;
}

export const PluginsTxtModal: React.FC<PluginsTxtModalProps> = ({
  isOpen,
  onClose,
  pluginsTxtContent,
  modlistName = 'Modlist',
}) => {
  useEscapeKey(onClose, isOpen);
  const { language } = useI18n();
  const ui = PLUGINS_UI[language] ?? PLUGINS_UI.fr;
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState('');

  if (!isOpen) return null;

  const lines = pluginsTxtContent
    ? pluginsTxtContent.split('\n').filter((l) => l.trim().length > 0)
    : [];

  const filteredLines = lines.filter((l) =>
    l.toLowerCase().includes(filter.toLowerCase())
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(pluginsTxtContent).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => { /* presse-papier refusé : on ne signale pas de copie */ },
    );
  };

  const handleDownload = () => {
    const blob = new Blob([pluginsTxtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plugins.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-[#2e2e2e] rounded-2xl max-w-3xl w-full h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="p-4 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-[#0369a1]/20 border border-[#0ea5e9]/40 flex items-center justify-center text-[#38bdf8] text-lg">
              📄
            </div>
            <div className="min-w-0">
              <h2 className="text-title font-bold text-white flex items-center gap-2 flex-wrap">
                <span>{ui.title}</span>
                <span className="text-caption font-mono px-2 py-0.5 rounded-full bg-[#0369a1]/20 text-[#38bdf8] border border-[#0ea5e9]/30 whitespace-nowrap tabular-nums">
                  {fillText(ui.count, { n: lines.length }, language)}
                </span>
              </h2>
              <p className="text-meta text-[#8f8f8f] [overflow-wrap:anywhere]">
                {fillText(ui.subtitle, { name: modlistName }, language)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-lg bg-[#222222] hover:bg-[#303030] text-[#8f8f8f] hover:text-white flex items-center justify-center text-body-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Action bar & Search */}
        <div className="p-3 bg-[#181818] border-b border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={ui.filter}
              className="w-full h-8 px-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-body text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopy}
              className="h-8 px-3 bg-[#262626] hover:bg-[#404040] border border-[#444444] text-white rounded-lg text-body font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{copied ? '✓' : '📋'}</span>
              <span>{copied ? ui.copied : ui.copyAll}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="h-8 px-3 bg-[#0369a1] hover:bg-[#0369a1] text-white rounded-lg text-body font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>💾</span>
              <span>{ui.download}</span>
            </button>
          </div>
        </div>

        {/* Plugins List View */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-body bg-[#181818] select-text">
          {filteredLines.length === 0 ? (
            <div className="text-[#aaaaaa] text-center py-12 flex flex-col items-center gap-3 font-sans">
              <span className="[overflow-wrap:anywhere]">{lines.length === 0 ? ui.empty : ui.noMatch}</span>
              {lines.length > 0 && filter !== '' && (
                <button type="button" onClick={() => setFilter('')} className="h-8 px-3 bg-[#262626] hover:bg-[#333333] border border-[#444444] text-[#dddddd] hover:text-white rounded-lg text-body font-semibold cursor-pointer transition-colors">{ui.showAll}</button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLines.map((line, idx) => {
                const isComment = line.startsWith('#');
                const isMaster = line.endsWith('.esm') || line.endsWith('.esl');
                return (
                  <div
                    key={idx}
                    className="sc-selectable !cursor-default flex items-start gap-3 px-2 py-1 rounded text-[#dddddd] [content-visibility:auto] [contain-intrinsic-size:auto_28px]"
                  >
                    <span className="text-[#666666] min-w-8 shrink-0 text-right select-none text-caption tabular-nums">
                      {idx + 1}
                    </span>
                    <span
                      className={`min-w-0 [overflow-wrap:anywhere] ${
                        isComment
                          ? 'text-[#666666] italic'
                          : isMaster
                          ? 'text-[#38bdf8] font-semibold'
                          : 'text-[#dddddd]'
                      }`}
                    >
                      {line}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-[#181818] border-t border-[#2e2e2e] flex items-center justify-between gap-3 text-meta text-[#666666]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">💡</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {ui.footerHint}{' '}
              <code className="text-[#aaaaaa] bg-[#1a1a1a] px-1 py-0.5 rounded">
                drive_c/users/&lt;user&gt;/AppData/Local/Skyrim Special Edition/plugins.txt
              </code>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 shrink-0 bg-[#222222] hover:bg-[#303030] text-white rounded-lg text-body font-semibold transition-colors cursor-pointer"
          >
            {ui.close}
          </button>
        </div>
      </div>
    </div>
  );
};
export default PluginsTxtModal;
