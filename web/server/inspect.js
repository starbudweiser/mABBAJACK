// Analyse d'un .wabbajack pour l'Inspecteur — commune à inspect-path, inspect-upload et install-from-url.
//
// - fichier jamais chargé en entier (cf. lazyzip.js) : fonctionne au-delà de 2 Go ;
// - la réponse ne contient qu'un ÉCHANTILLON des directives (une modlist en compte des centaines de
//   milliers : plusieurs centaines de Mo de JSON, ce qui bloquait / faisait échouer la réponse).
//   Les totaux (`numberOfDirectives`, `totalInstalledSize`) portent sur l'ensemble.
//   L'installation relit de toute façon les directives depuis le fichier.

import path from 'node:path';
import { openLazyZip } from './lazyzip.js';
import { gameVersionFromArchives } from './gameversions.js';

export const DIRECTIVES_SAMPLE = 2000;

const posix = (s) => String(s || '').replace(/\\/g, '/');

function parseDirective(d) {
  const ahp = d.ArchiveHashPath || [];
  const len = ahp.length;
  return {
    $type: d.$type || d.type || 'FromArchive',
    To: posix(d.To || d.to),
    Size: d.Size || 0,
    Hash: d.Hash || '',
    ArchiveHash: ahp[0] || d.ArchiveHash || '',
    SourcePath: len >= 2 ? posix(ahp[1]) : posix(d.SourcePath),
    BsaInternalPath: len === 3 ? posix(ahp[2]) : null,
    ArchiveHashPath: ahp,
    PatchID: d.PatchID || d.patchID || '',
    FromHash: d.FromHash || '',
    SourceDataID: d.SourceDataID || '',
    ArchiveName: d.State?.Name || '',
    TempID: d.TempID || '',
    FileStates: d.FileStates || undefined,
    State: d.State || undefined,
  };
}

/**
 * @param {string} filePath chemin d'un .wabbajack
 * @param {string} [fallbackName] nom si le manifeste n'en contient pas
 * @param {{ onStep?: (step:string)=>void }} [opts]
 */
export async function inspectWabbajack(filePath, fallbackName, opts = {}) {
  const step = opts.onStep || (() => {});
  step('index');
  const zip = await openLazyZip(filePath);

  step('manifest');
  let entry = zip.file('modlist') || zip.file('modlist.json') || zip.file('status.json');
  if (!entry) {
    const alt = zip.names.find((n) => !n.endsWith('/') && (n.endsWith('.json') || n.toLowerCase().includes('modlist')));
    if (alt) entry = zip.file(alt);
  }
  if (!entry) throw Object.assign(new Error('Manifest introuvable dans le .wabbajack'), { status: 400 });

  const raw = JSON.parse(await entry.async('string'));

  step('directives');
  const archives = (raw.Archives || raw.archives || []).map((a) => ({
    Hash: a.Hash || '', Name: a.Name || '', Size: a.Size || 0, State: a.State || {}, status: 'missing',
  }));
  const rawDirectives = raw.Directives || raw.directives || [];

  let totalInstalledSize = 0;
  let inlinedFilesCount = 0; // fichiers embarqués dans le .wabbajack (SourceDataID)
  let patchesCount = 0;      // patchs binaires OctoDiff (PatchID)
  let plugins = null; // SourceDataID du plugins.txt d'un profil
  const extras = [];
  const seenExtras = new Set();
  for (const d of rawDirectives) {
    totalInstalledSize += Number(d.Size) || 0;
    if (d.SourceDataID) inlinedFilesCount++;
    if (d.PatchID || d.patchID) patchesCount++;
    const to = posix(d.To || d.to);
    const base = to.split('/').pop();
    if (/\.(esp|esm|esl)$/i.test(base) && !seenExtras.has(base)) { seenExtras.add(base); extras.push(base); }
    if (!plugins && d.SourceDataID && /^profiles\/[^/]+\/plugins\.txt$/i.test(to)) plugins = d.SourceDataID;
  }
  const directives = rawDirectives.slice(0, DIRECTIVES_SAMPLE).map(parseDirective);

  step('plugins');
  let pluginsTxt = '';
  const pluginsEntry = (plugins && (zip.file(plugins) || zip.file(`inlined/${plugins}`)))
    || zip.file('inlined/profiles/Default/plugins.txt') || zip.file('inlined/plugins.txt');
  if (pluginsEntry) {
    try { pluginsTxt = await pluginsEntry.async('string'); } catch { pluginsTxt = ''; }
  }
  if (!pluginsTxt) {
    const cores = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
    pluginsTxt = [...cores, ...extras.filter((p) => !cores.includes(p))].map((p) => `*${p}`).join('\n');
  }
  const loadOrder = pluginsTxt.split('\n').map((l) => l.replace(/^\*/, '').trim()).filter((l) => l && !l.startsWith('#'));

  return {
    name: raw.Name || raw.name || fallbackName || path.basename(filePath, '.wabbajack'),
    author: raw.Author || raw.author || 'Inconnu',
    description: raw.Description || raw.description || '',
    version: raw.Version || raw.version || '1.0',
    gameType: raw.GameType || raw.gameType || 'SkyrimSpecialEdition',
    gameVersion: gameVersionFromArchives(archives),
    archives,
    directives,
    directivesTruncated: rawDirectives.length > directives.length,
    totalArchiveSize: archives.reduce((s, a) => s + a.Size, 0),
    totalInstalledSize,
    numberOfArchives: archives.length,
    numberOfDirectives: rawDirectives.length,
    inlinedFilesCount: Math.max(inlinedFilesCount, zip.names.filter((p) => p.startsWith('inlined/')).length),
    patchesCount: Math.max(patchesCount, zip.names.filter((p) => p.startsWith('patches/')).length),
    loadOrder,
    pluginsTxt,
    localFilePath: filePath,
  };
}
