#!/usr/bin/env node
/**
 * Audit i18n : repère les textes d'interface codés en dur dans src/ (hors src/locales).
 * Usage : node scripts/audit-ui-i18n.mjs [--all]
 * Détecte : textes JSX, attributs (title/placeholder/aria-label/alt/label), alert/prompt/confirm,
 * et littéraux contenant des mots/accents français.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'web', 'src');
const SKIP_DIRS = new Set(['locales']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out); }
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const FR_HINT = /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|du|une|un|est|sont|pour|avec|dans|sur|aucun|aucune|fichier|dossier|chargé|télécharg|Fermer|Annuler|Enregistrer|Ouvrir|Sélectionn|Rechercher|Erreur|Clé|Paramètres|manquant)\b/i;
const IGNORE_LINE = /^\s*(\/\/|\*|\/\*)|console\.|import |className=|i18n-ignore|\b(addLog|broadcastLog)\(/;
// Termes techniques / noms propres identiques dans toutes les langues
const ALLOW = /^(Nexus Mods|Nexus ↗|Mod ID:?|File ID:?|Hash:?|🚀 RTP:|📥 DL:|plugins\.txt|\/Volumes\/.*|\$\{ui\.[\w.]+\}.*)$/;
const JSX_TEXT = />\s*([^<>{}`]*[A-Za-zÀ-ÿ]{3,}[^<>{}`]*)\s*</g;
const ATTR = /\b(title|placeholder|aria-label|alt|label)=["']([^"']*[A-Za-zÀ-ÿ]{3,}[^"']*)["']/g;
const DIALOG = /\b(alert|prompt|confirm)\(\s*([`'"])(.*?)\2/g;
const STR = /(['"`])((?:(?!\1).){4,}?)\1/g;

const all = process.argv.includes('--all');
let total = 0;
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    // Texte JSX seul sur sa ligne (ex. contenu multi-lignes entre balises)
    const bare = line.trim();
    if (file.endsWith('.tsx') && !IGNORE_LINE.test(line) && /\s/.test(bare) && !/,$/.test(bare)
      && !/^([?:]|[\w$]+\??:\s)/.test(bare) && !ALLOW.test(bare)
      && /^[^<>{}=;()'"`[\]]*[A-Za-zÀ-ÿ]{3,}[^<>{}=;()'"`[\]]*$/.test(bare) && !/^(import|export|return|const|let|type|interface)\b/.test(bare)) {
      hits.push(`  L${i + 1}: ${bare.slice(0, 140)}`);
    }
    if (IGNORE_LINE.test(line) && !/>[^<]*[A-Za-zÀ-ÿ]{3,}[^<]*</.test(line)) return;
    const found = new Set();
    for (const re of [JSX_TEXT, ATTR, DIALOG]) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(line))) {
        const txt = (m[3] ?? m[2] ?? m[1]).trim();
        if (txt && !/^[\w.-]+$/.test(txt) || FR_HINT.test(txt)) found.add(txt);
      }
    }
    STR.lastIndex = 0; let m;
    while ((m = STR.exec(line))) {
      const txt = m[2];
      if (FR_HINT.test(txt) && !/^[/.\w-]+$/.test(txt) && !/className|mabbajack_/.test(txt)) found.add(txt);
      else if (all && /\s/.test(txt) && /^[A-Z]/.test(txt)) found.add(txt);
    }
    for (const f of found) if (!ALLOW.test(f)) hits.push(`  L${i + 1}: ${f.slice(0, 140)}`);
  });
  if (hits.length) {
    console.log(`\n${relative(ROOT, file)} (${hits.length})`);
    console.log(hits.join('\n'));
    total += hits.length;
  }
}
console.log(`\nTotal : ${total} texte(s) potentiellement non traduits.`);
process.exit(0);
