import React, { useState, useRef, useEffect } from 'react';
import { useI18n, Language } from '../locales';
import { COMMON_UI } from '../locales/uiScreens';

interface LanguageSelectorProps {
  variant?: 'dropdown' | 'pills';
  className?: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  variant = 'dropdown',
  className = '',
}) => {
  const { language, setLanguage, availableLanguages } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = availableLanguages.find((l) => l.code === language) || availableLanguages[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (variant === 'pills') {
    return (
      <div className={`inline-flex items-center gap-1 p-1 bg-[#181818] border border-[#2e2e2e] rounded-lg shadow-inner ${className}`}>
        {availableLanguages.map((lang) => {
          const isActive = lang.code === language;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => setLanguage(lang.code as Language)}
              className={`px-2.5 py-1 rounded-md text-body font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#0369a1] text-white shadow-sm font-semibold'
                  : 'text-[#aaaaaa] hover:text-white hover:bg-[#262626]'
              }`}
              title={lang.nativeName}
            >
              <span className="text-body leading-none">{lang.flag}</span>
              <span>{lang.nativeName}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-7 px-2.5 rounded-md bg-[#262626] hover:bg-[#303030] border border-[#333333] text-body font-medium text-[#dddddd] flex items-center gap-1.5 transition-colors cursor-pointer"
        aria-label={(COMMON_UI[language] ?? COMMON_UI.fr).languageSelect}
      >
        <span className="text-body-lg leading-none">{currentLang.flag}</span>
        <span className="text-body font-semibold uppercase tracking-wider">{currentLang.code}</span>
        <svg
          className={`w-3 h-3 text-[#aaaaaa] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-40 bg-[#1e1e1e] border border-[#333333] rounded-lg shadow-2xl py-1 z-50 overflow-hidden animate-in fade-in duration-100">
          {availableLanguages.map((lang) => {
            const isActive = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  setLanguage(lang.code as Language);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-body flex items-center justify-between transition-colors cursor-pointer text-left ${
                  isActive
                    ? 'bg-[#0369a1]/15 text-[#38bdf8] font-semibold'
                    : 'text-[#dddddd] hover:bg-[#262626] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-body-lg leading-none">{lang.flag}</span>
                  <span>{lang.nativeName}</span>
                </div>
                {isActive && <span className="text-[#38bdf8] text-body font-bold">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
export default LanguageSelector;
