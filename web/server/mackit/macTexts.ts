/**
 * Moteur Mac commun : les clés de traduction que plan, apply et undo renvoient à la place de phrases.
 * Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh.
 *
 * Le moteur ne contient aucun texte à lire : chaque appli traduit ces clés (fr, en, es, it) avec ses
 * propres fichiers de langue. `params` donne les valeurs à insérer (`{{name}}` côté appli).
 *
 * Paramètres par clé :
 *  - mackit.fix.engine.detail            engine (moteur actuel, en majuscules)
 *  - mackit.fix.duplicates.detail        dlls (« EVLaS.dll, TerrainHelper.dll »)
 *  - mackit.fix.overrides.detail         dlls (« d3d11.dll, dxgi.dll »)
 *  - mackit.bottled.ok                   version
 *  - mackit.bottled.outdated             version, minimum
 *  - mackit.bottled.unknown              minimum
 *  - mackit.apply.changed, mackit.undo.changed / .backupMissing   file
 *  - mackit.cli.gameMissing              game (dossier de jeu demandé)
 *  - mackit.cli.bottleNotFound           bottle (nom ou chemin demandé)
 * Les clés mackit.cli.* viennent de l'outil en ligne de commande `mackit` (erreurs de l'appel, pas du moteur).
 */
export const MAC_TEXT_KEYS = [
  "mackit.fix.engine.title",
  "mackit.fix.engine.detail",
  "mackit.fix.bridge.title",
  "mackit.fix.bridge.detail",
  "mackit.fix.bridge.detailReplace",
  "mackit.fix.displayTweaks.title",
  "mackit.fix.displayTweaks.detail",
  "mackit.fix.duplicates.title",
  "mackit.fix.duplicates.detail",
  "mackit.fix.compiler.title",
  "mackit.fix.compiler.detail",
  "mackit.fix.overrides.title",
  "mackit.fix.overrides.detail",
  "mackit.discard.terrainHelper",
  "mackit.discard.inverseSquare",
  "mackit.discard.evlas",
  "mackit.skip.noBottle",
  "mackit.skip.notCrossover",
  "mackit.skip.bridgeSourceMissing",
  "mackit.skip.dotnetMissing",
  "mackit.bottled.absent",
  "mackit.bottled.stock",
  "mackit.bottled.ok",
  "mackit.bottled.outdated",
  "mackit.bottled.unknown",
  "mackit.apply.ok",
  "mackit.apply.changed",
  "mackit.apply.error",
  "mackit.undo.ok",
  "mackit.undo.absent",
  "mackit.undo.changed",
  "mackit.undo.backupMissing",
  "mackit.cli.usage",
  "mackit.cli.gameMissing",
  "mackit.cli.bottleNotFound",
  "mackit.cli.planInvalid",
  "mackit.cli.error",
] as const;

export type MacTextKey = (typeof MAC_TEXT_KEYS)[number];

export interface IMacText {
  key: MacTextKey;
  params?: Record<string, string | number>;
}

export const macText = (key: MacTextKey, params?: IMacText["params"]): IMacText =>
  params === undefined ? { key } : { key, params };
