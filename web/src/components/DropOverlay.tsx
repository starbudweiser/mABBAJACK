import React from 'react';
import { useI18n } from '../locales';
import { APP_UI } from '../locales/uiScreens';

/** Voile affiché pendant qu'un fichier est glissé sur la fenêtre. */
export const DropOverlay: React.FC = () => {
  const { language } = useI18n();
  const ui = APP_UI[language] ?? APP_UI.fr;
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center pointer-events-none"
      style={{ background: 'rgba(14,14,17,0.88)', backdropFilter: 'blur(8px)' }}>
      <div style={{ border: '3px dashed #0369a1', borderRadius: '24px', padding: '64px 96px', textAlign: 'center', background: 'rgba(3,105,161,0.08)', boxShadow: '0 0 60px rgba(3,105,161,0.3)' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>📦</div>
        <div style={{ fontSize: 'calc(20px * var(--text-scale))', fontWeight: 700, color: '#0ea5e9', marginBottom: '8px' }}>{ui.dropTitle}</div>
        <div style={{ fontSize: 'calc(15px * var(--text-scale))', color: '#707070' }}>{ui.dropSubtitle}</div>
      </div>
    </div>
  );
};

export default DropOverlay;
