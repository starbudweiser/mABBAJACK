import React from 'react';
import { useI18n } from '../locales';
import { COMMON_UI } from '../locales/uiScreens';
import LanguageSelector from './LanguageSelector';
import { SkyrimEnvironment, NexusAccount } from '../types/wabbajack';

export type ActiveTab = 'gallery' | 'inspector' | 'installer' | 'progress';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  skyrimEnv?: SkyrimEnvironment | null;
  nexusAccount: NexusAccount | null;
  onOpenSettings: () => void;
  isInstalling: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  nexusAccount,
  onOpenSettings,
  isInstalling,
}) => {
  const { t, language } = useI18n();
  const ui = COMMON_UI[language] ?? COMMON_UI.fr;

  const TAB_BASE = 'px-3 py-1.5 rounded-md text-body font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer whitespace-nowrap';
  const TAB_ACTIVE = `${TAB_BASE} bg-[#0369a1] text-white font-semibold shadow-sm shadow-[#0369a1]/30`;
  const TAB_IDLE = `${TAB_BASE} text-[#aaaaaa] hover:text-white hover:bg-[#262626]`;

  const TABS: Array<{ id: ActiveTab; icon: string; label: string }> = [
    { id: 'gallery',   icon: '🏪', label: t.header.tabs.gallery },
    { id: 'inspector', icon: '🔍', label: t.header.tabs.inspector },
    { id: 'installer', icon: '📦', label: t.header.tabs.installer },
    { id: 'progress',  icon: '⚡', label: t.header.tabs.progress },
  ];

  return (
    <header className="h-14 px-3 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between select-none z-30 flex-shrink-0 gap-2 min-w-0">

      {/* Brand */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0369a1] to-[#0369a1] flex items-center justify-center text-white font-black text-body shadow-md shadow-[#0369a1]/20 flex-shrink-0">
          ⚡
        </div>
        <div className="hidden sm:block">
          <h1 className="text-title font-extrabold text-white tracking-wide flex items-center gap-1.5">
            <span>mABBAJACK</span>
            <span className="text-caption font-mono px-1 py-0.5 rounded bg-[#0369a1]/15 text-[#38bdf8] border border-[#0ea5e9]/30">
              v3.0
            </span>
          </h1>
        </div>
      </div>

      {/* Navigation Tabs — scrollable so they never overflow */}
      <nav className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        <div className="flex items-center bg-[#1a1a1a] border border-[#2e2e2e] p-1 rounded-lg gap-0.5 w-max mx-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`${activeTab === tab.id ? TAB_ACTIVE : TAB_IDLE} relative`}
            >
              <span>{tab.icon}</span>
              <span className="hidden xs:inline">{tab.label}</span>
              {tab.id === 'progress' && isInstalling && (
                <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-ping absolute -top-0.5 -right-0.5" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Right controls — flex-shrink-0 prevents squeezing */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Nexus badge — hidden below xl to avoid overflow */}
        <div className={`hidden xl:flex items-center gap-1.5 h-7 px-2.5 rounded-md text-meta font-medium border whitespace-nowrap ${
          nexusAccount?.isPremium
            ? 'bg-[#1e1e1e] text-[#38bdf8] border-[#0369a1]'
            : nexusAccount?.valid
            ? 'bg-[#222222] text-[#38bdf8] border-[#0369a1]'
            : 'bg-[#222222] text-[#666666] border-[#2e2e2e]'
        }`}>
          <span>🛡️</span>
          <span>{nexusAccount?.isPremium ? 'Premium ⭐' : nexusAccount?.valid ? ui.nexusFree : 'Nexus'}</span>
        </div>

        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="h-7 px-2 rounded-md bg-[#1e1e1e] hover:bg-[#2c2c2c] border border-[#333333] text-[#aaaaaa] hover:text-white text-body flex items-center gap-1.5 transition-colors cursor-pointer flex-shrink-0"
          title={t.header.tabs.settings}
        >
          <span>⚙️</span>
          <span className="hidden lg:inline">{t.header.tabs.settings}</span>
        </button>

        <LanguageSelector variant="dropdown" />
      </div>
    </header>
  );
};
export default Header;
