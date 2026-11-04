/** Adaptation au Mac : réponses du serveur (web/server/mac.js, moteur commun mackit). Le moteur renvoie des clés de texte. */
export type MacFixId = 'engine' | 'bridge' | 'displayTweaks' | 'duplicates' | 'compiler' | 'overrides';

/** Clé « mackit.* » du moteur + valeurs à insérer ; traduite par MAC_TEXTS (locales/uiMac.ts). */
export interface MacText { key: string; params?: Record<string, string | number>; }

export interface MacIniChange { section: string; key: string; oldValue?: string; newValue: string; action: 'modify' | 'add'; }

/** « stock » = dossier universel (rien n'est copié) ; « crossover » = kit DXMT pour une bouteille CrossOver. */
export type MacMode = 'stock' | 'crossover';

export interface MacBottle { name: string; kind: string; path: string; }

export interface MacBottled {
  state: 'absent' | 'stock' | 'ok' | 'outdated' | 'unknown';
  minimum: string;
  version?: string;
  text: MacText;
}

export interface MacPlannedFix { id: MacFixId; title: MacText; detail: MacText; files: string[]; changes?: MacIniChange[]; }

/** POST /api/mac/preview : ce que l'adaptation ferait (rien n'est écrit). */
export interface MacPreview {
  supported: boolean;
  /** dossier adapté : le jeu embarqué par la liste (`install`) ou le Skyrim de l'utilisateur (`game`) ; `exists: false` = créé par l'installation */
  target?: { dir: string; kind: 'install' | 'game'; exists: boolean } | null;
  bottle?: MacBottle | null;
  bottles?: MacBottle[];
  bridge?: boolean;
  /** aucune bouteille CrossOver : le kit n'est pas proposé (pas de plan) */
  noBottle?: boolean;
  plan?: {
    gamePath: string;
    fixes: MacPlannedFix[];
    skipped: { id: MacFixId; reason: MacText }[];
    discarded: { file: string; fix: MacFixId; reason: MacText }[];
    bottled: MacBottled;
  };
}

export interface MacReportItem {
  id: MacFixId;
  status: 'applied' | 'failed' | 'skipped';
  undoable: boolean;
  title?: MacText;
  detail?: MacText;
  /** résultat de apply (échec : pourquoi) */
  text?: MacText;
  /** correctif ignoré : pourquoi */
  reason?: MacText;
  files: string[];
  changes?: MacIniChange[];
}

/** Bilan Mac : dans la progression finale (`progress.mac`) ; vide si l'adaptation n'était pas demandée. */
export interface MacReport {
  mode?: MacMode;
  /** mode « crossover » sans bouteille : rien n'a été modifié */
  noBottle?: boolean;
  target: { dir: string; kind: 'install' | 'game'; exists: boolean } | null;
  bottle: MacBottle | null;
  items: MacReportItem[];
  discarded: { file: string; fix: MacFixId; reason: MacText }[];
  bottled: MacBottled | null;
  applied: { id: MacFixId; files: string[]; dlls: string[]; at: string }[];
  error?: string;
}

export interface MacUndoOutcome { id: MacFixId; status: 'restored' | 'refused' | 'absent'; text: MacText; refusals?: { file: string; reason: string }[]; }

export type BottledJob =
  | { status: 'idle' }
  | { status: 'looking' }
  | { status: 'downloading'; version: string; name: string; percent: number }
  | { status: 'done'; version: string; name: string; path: string }
  | { status: 'manual'; version: string; name: string; url: string }
  | { status: 'error'; code: 'noKey' | 'noFolder' | 'noFile' | 'tooOld' | 'noLink' | 'failed'; version?: string; detail?: string };
