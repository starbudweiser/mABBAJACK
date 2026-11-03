import React from 'react';
import { useI18n } from '../locales';
import { APP_UI } from '../locales/uiScreens';
import { translateLog } from '../locales/logCatalog';

export interface GalleryDownload { title: string; pct: number; status: string }

/** Plein écran pendant le téléchargement du .wabbajack d'une modlist de la galerie (modes Simple et Expert). */
export const GalleryDownloadOverlay: React.FC<{ download: GalleryDownload }> = ({ download }) => {
  const { language } = useI18n();
  const ui = APP_UI[language] ?? APP_UI.fr;
  return (
    <div className="absolute inset-0 z-[9998] flex items-center justify-center" style={{ background: 'rgba(14,14,17,0.93)', backdropFilter: 'blur(12px)' }}>
      <div style={{ width: 480, maxWidth: '90vw', background: '#181818', border: '1px solid #303030', borderRadius: 16, padding: '32px 36px', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>
        <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 16 }}>⬇️</div>
        <h3 style={{ color: '#ffffff', fontSize: 'calc(16px * var(--text-scale))', fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>{ui.downloading}</h3>
        <p style={{ color: '#aaaaaa', fontSize: 'calc(12px * var(--text-scale))', textAlign: 'center', marginBottom: 20 }}>{download.title}</p>
        <div style={{ background: '#262626', borderRadius: 8, height: 8, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 8, background: '#0ea5e9', width: `${download.pct}%`, transition: 'width 0.4s ease' }} />
        </div>
        <p style={{ color: '#707070', fontSize: 'calc(11px * var(--text-scale))', textAlign: 'center', fontFamily: 'monospace', minHeight: 16 }}>{translateLog(download.status, language)}</p>
        <p style={{ color: '#707070', fontSize: 'calc(10px * var(--text-scale))', textAlign: 'center', marginTop: 16 }}>{ui.downloadingHint}</p>
      </div>
    </div>
  );
};

export default GalleryDownloadOverlay;
