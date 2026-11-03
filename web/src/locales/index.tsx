import React, { createContext, useContext, useState, useEffect } from 'react';
import { Translations, Language, LanguageInfo } from './types';
export type { Translations, Language, LanguageInfo };
import { fr } from './fr';
import { en } from './en';
import { it } from './it';
import { es } from './es';

const translationsMap: Record<Language, Translations> = {
  fr,
  en,
  it,
  es,
};

export const availableLanguages: LanguageInfo[] = [
  { code: 'fr', name: 'Français', nativeName: 'Français' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'it', name: 'Italiano', nativeName: 'Italiano' },
  { code: 'es', name: 'Español', nativeName: 'Español' },
];

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
  availableLanguages: LanguageInfo[];
}

function systemLanguage(): Language {
  const code = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2).toLowerCase())
    .find((l) => ['fr', 'en', 'it', 'es'].includes(l));
  return (code ?? 'en') as Language;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Langue donnée par l'appli macOS (?ui=, menu natif « Langue »), sinon mémorisée (preview), sinon navigateur
  const [language, setLanguageState] = useState<Language>(() => {
    const asked = new URLSearchParams(location.search).get('ui') as Language;
    if (asked && ['fr', 'en', 'it', 'es'].includes(asked)) {
      return asked;
    }
    const saved = localStorage.getItem('mabbajack_language') as Language;
    if (saved && ['fr', 'en', 'it', 'es'].includes(saved)) {
      return saved;
    }
    return systemLanguage();
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('mabbajack_language', lang);
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Menu natif « Langue » (python_app/mabbajack_app.py)
  useEffect(() => {
    (window as unknown as { mabbajackSetLanguage?: (c: string) => void }).mabbajackSetLanguage = (code: string) => {
      if (['fr', 'en', 'it', 'es'].includes(code)) setLanguage(code as Language);
    };
  });

  const value: I18nContextType = {
    language,
    setLanguage,
    t: translationsMap[language] || fr,
    availableLanguages,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
