// RemappedInlineFile — remplacement des « magic strings » Wabbajack
// (MO2_PATH_MAGIC_*, GAME_PATH_MAGIC_*, DOWNLOAD_PATH_MAGIC_*) par les chemins réels.
//
// Variantes :
//   *_BACK         → chemin Windows, antislash simple      (Z:\Volumes\X)
//   *_DOUBLE_BACK  → chemin Windows échappé (JSON/INI)     (Z:\\Volumes\\X)
//   *_FORWARD      → chemin avec slashs                    (Z:/Volumes/X)
//
// Les chemins macOS sont exposés à Wine/CrossOver/Whisky sous la lettre Z: (racine « / »).

const MAGIC_RE = /\{--\|\|(MO2|GAME|DOWNLOAD)_PATH_MAGIC_(DOUBLE_BACK|BACK|FORWARD)\|\|--\}/g;

/** Chemin macOS → chemin Windows vu par Wine (Z:\...). */
export function toWinPath(p) {
  const s = String(p || '').replace(/\/+$/, '');
  if (!s) return '';
  if (/^[A-Za-z]:[\\/]/.test(s)) return s.replace(/\//g, '\\');
  return 'Z:' + s.replace(/\//g, '\\');
}

/**
 * Remplace les magic strings d'un contenu texte.
 * @param {Buffer|string} content
 * @param {{mo2?:string, game?:string, download?:string}} roots chemins macOS
 * @returns {{data: Buffer, replaced: number, unresolved: number}}
 */
export function remapMagicStrings(content, roots = {}) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  // Fichiers texte uniquement : contenu UTF-8 (les BOM sont conservés tels quels)
  const text = buf.toString('utf8');
  if (!text.includes('_PATH_MAGIC_')) return { data: buf, replaced: 0, unresolved: 0 };

  let replaced = 0;
  let unresolved = 0;
  const out = text.replace(MAGIC_RE, (m, kind, variant) => {
    const base = roots[kind.toLowerCase()];
    if (!base) { unresolved++; return m; }
    replaced++;
    const win = toWinPath(base);
    if (variant === 'DOUBLE_BACK') return win.replace(/\\/g, '\\\\');
    if (variant === 'FORWARD') return win.replace(/\\/g, '/');
    return win;
  });
  return { data: Buffer.from(out, 'utf8'), replaced, unresolved };
}
