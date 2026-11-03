/**
 * Présentation de l'interface : « simple » (parcours guidé en 4 étapes) ou « expert » (les 4 onglets).
 * Le mode vient de ?mode= (app macOS), sinon du réglage mémorisé, sinon « simple » (premier lancement).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type UiMode = 'simple' | 'expert';
const KEY = 'mabbajack_ui_mode';
const isMode = (v: unknown): v is UiMode => v === 'simple' || v === 'expert';

interface UiModeContextType { mode: UiMode; setMode: (m: UiMode) => void }
const UiModeContext = createContext<UiModeContextType | null>(null);

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<UiMode>(() => {
    const asked = new URLSearchParams(location.search).get('mode');
    if (isMode(asked)) return asked;
    try { const saved = localStorage.getItem(KEY); if (isMode(saved)) return saved; } catch { /* stockage indisponible */ }
    return 'simple';
  });

  const setMode = useCallback((m: UiMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* stockage indisponible */ }
  }, []);

  // Réglage poussé par l'appli macOS (menu Affichage)
  useEffect(() => {
    (window as unknown as { mabbajackSetMode?: (m: string) => void }).mabbajackSetMode = (m: string) => { if (isMode(m)) setMode(m); };
  }, [setMode]);

  return <UiModeContext.Provider value={{ mode, setMode }}>{children}</UiModeContext.Provider>;
};

export function useUiMode(): UiModeContextType {
  const ctx = useContext(UiModeContext);
  if (!ctx) throw new Error('useUiMode must be used within a UiModeProvider');
  return ctx;
}

/**
 * Pont vers les menus macOS natifs (python_app appelle window.mabbajackMenu) : actions de l'écran courant
 * plus « mode:simple » / « mode:expert ». Pas de menu contextuel de navigateur hors des champs de saisie.
 */
export function useMenuBridge(actions: Record<string, () => void>): void {
  const { setMode } = useUiMode();
  const ref = useRef(actions);
  ref.current = { ...actions, 'mode:simple': () => setMode('simple'), 'mode:expert': () => setMode('expert') };
  useEffect(() => {
    const w = window as unknown as { mabbajackMenu?: (a: string) => void };
    w.mabbajackMenu = (action: string) => ref.current[action]?.();
    const noBrowserMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('input, textarea, [contenteditable="true"]') && !window.getSelection()?.toString()) e.preventDefault();
    };
    window.addEventListener('contextmenu', noBrowserMenu);
    return () => { window.removeEventListener('contextmenu', noBrowserMenu); delete w.mabbajackMenu; };
  }, []);
}
