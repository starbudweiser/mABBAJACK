/**
 * mABBAJACK — Design Tokens & Button Primitives
 * Single source of truth for all UI components.
 * Import this in any component that needs buttons, badges or field rows.
 */

import React from 'react';
import { useI18n } from './locales';
import { COMMON_UI } from './locales/uiScreens';

// ── Color Tokens ──────────────────────────────────────────────────────────────
export const colors = {
  // Backgrounds
  bg0: '#181818',      // page background
  bg1: '#181818',      // card surface
  bg2: '#1a1a1a',      // input / elevated surface
  bg3: '#262626',      // hover surface

  // Borders
  border1: '#262626',  // card border
  border2: '#303030',  // input border
  border3: '#333333',  // subtle separator

  // Text
  textPrimary: '#ffffff',
  textSecondary: '#aaaaaa',
  textMuted: '#707070',
  textPlaceholder: '#444444',

  // Accents
  blue: '#0ea5e9',
  blueDim: '#38bdf8',
  indigo: '#0369a1',
  green: '#22c55e',
  greenDim: '#4ade80',
  amber: '#f59e0b',
  amberDim: '#fbbf24',
  red: '#ef4444',
  redDim: '#f87171',
  purple: '#0ea5e9',
} as const;

// ── Button Base Classes ───────────────────────────────────────────────────────
// Consistent height (h-8 = 32px), padding, font-size, border-radius, transitions
const BASE = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-body font-semibold transition-all duration-150 cursor-pointer select-none whitespace-nowrap border';

export const btn = {
  /**
   * PRIMARY — blue gradient, main call-to-action
   * Use for: "Lancer le déploiement", "Valider", "Confirmer"
   */
  primary: `${BASE} bg-gradient-to-r from-[#0369a1] to-[#0369a1] hover:from-[#0369a1] hover:to-[#0369a1] border-transparent text-white shadow-md shadow-[#0369a1]/20 hover:shadow-[#0369a1]/30 hover:scale-[1.02]`,

  /**
   * SECONDARY — dark slate, utility actions
   * Use for: "Coller", "Parcourir", "Exporter"
   */
  secondary: `${BASE} bg-[#262626] hover:bg-[#333333] border-[#444444] text-[#dddddd] hover:text-white`,

  /**
   * SECONDARY SUBTLE — even more muted, for folder/browse icon buttons
   * Use for: "📁" browse button
   */
  subtle: `${BASE} bg-[#262626] hover:bg-[#303030] border-[#333333] text-[#aaaaaa] hover:text-white`,

  /**
   * SUCCESS — green, for positive confirmations
   * Use for: "▶ Reprendre", "✓ Connecté"
   */
  success: `${BASE} bg-[#22c55e] hover:bg-[#14391f] border-[#22c55e]/30 text-white`,

  /**
   * DANGER — red ghost, for destructive or cancel actions
   * Use for: "Annuler"
   */
  danger: `${BASE} bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border-[#ef4444]/40 text-[#f87171] hover:text-white`,

  /**
   * WARNING — amber, pause state
   * Use for: "⏸ Pause"
   */
  warning: `${BASE} bg-[#3f2a0c]/30 hover:bg-[#3f2a0c]/50 border-[#f59e0b]/40 text-[#fbbf24] hover:text-white`,

  /**
   * GHOST — no background, text link style
   * Use for: "🔄 Scanner", toolbar ghost actions
   */
  ghost: `inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-body font-medium transition-colors duration-150 cursor-pointer select-none text-[#aaaaaa] hover:text-white hover:bg-[#262626]`,

  /**
   * ICON — square icon-only button, same height
   * Use for: 👁 toggle, small toolbar icons
   */
  icon: `inline-flex items-center justify-center h-8 w-8 rounded-lg text-body transition-colors duration-150 cursor-pointer select-none bg-[#262626] hover:bg-[#303030] border border-[#333333] text-[#aaaaaa] hover:text-white`,

  /**
   * DISABLED state — apply on top of any variant
   * Use via conditional: parsedFile ? btn.primary : btn.disabled
   */
  disabled: `${BASE} border-[#333333] bg-[#1e1e1e] text-[#666666] cursor-not-allowed`,
} as const;

// ── Full-width CTA ────────────────────────────────────────────────────────────
export const btnFull = {
  primary: 'w-full h-12 flex items-center justify-center gap-2 rounded-xl font-extrabold text-title uppercase tracking-wider transition-all duration-150 cursor-pointer bg-gradient-to-r from-[#0369a1] to-[#0369a1] hover:from-[#0369a1] hover:to-[#0369a1] text-white shadow-lg shadow-[#0369a1]/20 hover:scale-[1.01] hover:shadow-[#0369a1]/30',
  disabled: 'w-full h-12 flex items-center justify-center gap-2 rounded-xl font-extrabold text-title uppercase tracking-wider bg-[#222222] text-[#666666] cursor-not-allowed border border-[#333333]',
} as const;

// ── Badge / Tag ───────────────────────────────────────────────────────────────
export const badge = {
  blue:   'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#0369a1]/15 text-[#38bdf8] border border-[#0ea5e9]/30',
  green:  'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30',
  amber:  'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/30',
  red:    'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/30',
  purple: 'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#0369a1]/15 text-[#38bdf8] border border-[#0ea5e9]/30',
  muted:  'inline-flex items-center gap-1 text-caption font-mono font-semibold px-2 py-0.5 rounded-md bg-[#1e1e1e] text-[#aaaaaa] border border-[#2e2e2e]',
} as const;

// ── Card ──────────────────────────────────────────────────────────────────────
export const card = 'bg-[#181818] border border-[#2e2e2e] rounded-xl p-4 shadow-sm flex flex-col gap-3';

// ── Section Label ─────────────────────────────────────────────────────────────
export const sectionLabel = 'text-body font-bold text-white uppercase tracking-wider flex items-center gap-1.5';

// ── Input field ───────────────────────────────────────────────────────────────
export const inputField = 'flex-1 h-8 px-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-body font-mono text-white placeholder-[#666666] focus:outline-none focus:border-[#0ea5e9] transition-colors select-text';

// ── Shortcut chip (path presets) ─────────────────────────────────────────────
export const chip = 'text-caption font-mono px-2 py-0.5 rounded-md bg-[#1e1e1e] text-[#aaaaaa] hover:text-white border border-[#2e2e2e] cursor-pointer transition-colors';

// ── Divider (vertical, for button groups) ────────────────────────────────────
export const Divider: React.FC = () => (
  <div className="w-px h-5 bg-[#333333] flex-shrink-0" />
);

// ── FieldRow — label + input + buttons in one consistent row ──────────────────
interface FieldRowProps {
  label: string;
  icon?: string;
  value: string;
  onChange: (v: string) => void;
  onPaste: () => void;
  onBrowse: () => void;
  placeholder?: string;
  isBrowsing?: boolean;
  badge?: React.ReactNode;
  presets?: Array<{ label: string; value: string }>;
  onPreset?: (v: string) => void;
  className?: string;
}

export const FieldRow: React.FC<FieldRowProps> = ({
  label,
  icon,
  value,
  onChange,
  onPaste,
  onBrowse,
  placeholder,
  isBrowsing,
  badge: badgeProp,
  presets,
  onPreset,
  className = '',
}) => {
  const { language } = useI18n();
  const ui = COMMON_UI[language] ?? COMMON_UI.fr;
  return (
  <div className={`flex flex-col gap-1.5 ${className}`}>
    <div className="flex items-center justify-between">
      <span className={sectionLabel}>
        {icon && <span>{icon}</span>}
        <span>{label}</span>
      </span>
      {badgeProp}
    </div>
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData?.getData('text');
          if (text?.trim()) onChange(text.trim());
        }}
        placeholder={placeholder}
        className={inputField}
      />
      <button type="button" onClick={onPaste} className={btn.secondary} title={ui.pastePath}>
        <span>📋</span>
        <span>{ui.paste}</span>
      </button>
      <button type="button" onClick={onBrowse} className={btn.subtle} title={ui.browse}>
        <span>📁</span>
        <span>{isBrowsing ? '…' : ui.browse}</span>
      </button>
    </div>
    {presets && presets.length > 0 && (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-caption text-[#666666]">→</span>
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            className={chip}
            onClick={() => onPreset?.(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>
    )}
  </div>
  );
};

// ── ApiKeyRow — specialized row for API key input ─────────────────────────────
interface ApiKeyRowProps {
  value: string;
  onChange: (v: string) => void;
  onPaste: () => void;
  onVerify: () => void;
  showKey: boolean;
  onToggleShow: () => void;
  isVerifying: boolean;
  message?: string | null;
  status?: React.ReactNode;
}

export const ApiKeyRow: React.FC<ApiKeyRowProps> = ({
  value,
  onChange,
  onPaste,
  onVerify,
  showKey,
  onToggleShow,
  isVerifying,
  message,
  status,
}) => {
  const { language } = useI18n();
  const ui = COMMON_UI[language] ?? COMMON_UI.fr;
  return (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <span className={sectionLabel}>
        <span>🛡️</span>
        <span>{ui.apiKeyLabel}</span>
        <span className="text-[#666666] font-normal normal-case text-caption">{ui.optional}</span>
      </span>
      {status}
    </div>
    <div className="flex items-center gap-2">
      <input
        type={showKey ? 'text' : 'password'}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onPaste={(e) => {
          const text = e.clipboardData?.getData('text');
          if (text?.trim()) onChange(text.trim());
        }}
        placeholder={ui.apiKeyPlaceholder}
        className={inputField}
      />
      <button type="button" onClick={onToggleShow} className={btn.icon} title={showKey ? ui.hide : ui.show}>
        {showKey ? '🔒' : '👁️'}
      </button>
      <button type="button" onClick={onPaste} className={btn.secondary}>
        <span>📋</span>
        <span>{ui.paste}</span>
      </button>
      <button
        type="button"
        onClick={onVerify}
        disabled={isVerifying || !value.trim()}
        className={value.trim() && !isVerifying ? btn.primary : btn.disabled}
      >
        {isVerifying ? ui.validating : ui.validate}
      </button>
    </div>
    {message && (
      <p className="text-body text-[#38bdf8] font-medium pl-1">{message}</p>
    )}
  </div>
  );
};
