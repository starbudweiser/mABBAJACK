export interface DownloadMetadata {
  Hash: string;
  Size: number;
  NumberOfArchives: number;
  SizeOfArchives: number;
  NumberOfInstalledFiles: number;
  SizeOfInstalledFiles: number;
  TotalSize: number;
}

export interface ModlistLinks {
  image?: string;
  readme?: string;
  download?: string;
  machineURL?: string;
  discordURL?: string;
  websiteURL?: string;
  nexusCollection?: string | null;
}

export interface GalleryModlist {
  title: string;
  description: string;
  author: string;
  maintainers?: string[];
  game: string;
  official?: boolean;
  tags?: string[];
  nsfw?: boolean;
  utility_list?: boolean;
  image_contains_title?: boolean;
  force_down?: boolean;
  links: ModlistLinks;
  download_metadata?: DownloadMetadata;
  version: string;
  dateCreated?: string;
  dateUpdated?: string;
  repositoryName?: string;
  /** Version exacte du jeu lue dans le manifeste (ex. '1.6.1170') — connue seulement si la collection a déjà été analysée */
  gameVersion?: string;
}

export interface ArchiveDownloadState {
  $type?: string;
  GameName?: string;
  ModID?: number;
  FileID?: number;
  Url?: string;
  Name?: string;
  Author?: string;
  Version?: string;
  ID?: string;
}

export interface ModlistArchive {
  Hash: string;
  Name: string;
  Size: number;
  State?: ArchiveDownloadState | any;
  status?: 'ready' | 'missing' | 'downloading' | 'error';
  localPath?: string;
  /** 'game' = fichier original du jeu (GameFileSource), 'mod' = archive téléchargeable */
  sourceKind?: 'game' | 'mod';
  /** nom d'un fichier local portant ce nom mais d'une taille différente (incomplet / autre version) */
  sizeMismatch?: string;
  /** Emplacement attendu d'un fichier du jeu manquant */
  expectedPath?: string;
}

export interface Directive {
  $type: string; // 'FromArchive', 'InlineFile', 'PatchedFromArchive', 'CreateBSA', 'RemappedInlineFile', etc.
  To: string;
  Size: number;
  Hash: string;
  ArchiveHash?: string;
  SourcePath?: string;
  PatchID?: string;
  SourceID?: string;
  OriginalSize?: number;
  OriginalHash?: string;
}

export interface ParsedWabbajackFile {
  name: string;
  author: string;
  description: string;
  version: string;
  gameType: string;
  /** Version exacte du jeu lue dans le manifeste (ex. '1.6.1170') */
  gameVersion?: string | null;
  archives: ModlistArchive[];
  directives: Directive[];
  totalArchiveSize: number;
  totalInstalledSize: number;
  numberOfArchives: number;
  numberOfDirectives: number;
  /** true : `directives` n'est qu'un échantillon (le total est `numberOfDirectives`) */
  directivesTruncated?: boolean;
  inlinedFilesCount: number;
  patchesCount: number;
  loadOrder?: string[];
  pluginsTxt?: string;
  /** Absolute path to the .wabbajack file on disk — required for InlineFile + PatchedFromArchive directives */
  localFilePath?: string;
  /**
   * Pre-computed edition classification: 'se' | 'ae' | 'vr' | 'other'
   * Overrides gameType-based detection when set (e.g. from gallery catalog metadata).
   */
  skyrimVersion?: 'se' | 'ae' | 'vr' | 'other';
  /** CDN/social links — websiteURL used as Nexus fallback for .wabbajack download */
  links?: ModlistLinks;
}

export type InstallMode = 'ready_to_play' | 'mo2';

export type InstallStage = 
  | 'idle'
  | 'validating_paths'
  | 'scanning_downloads'
  | 'downloading_archives'
  | 'verifying_hashes'
  | 'extracting_files'
  | 'applying_patches'
  | 'generating_mo2'
  | 'completed'
  | 'paused'
  | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'debug';
  message: string;
  details?: string;
}

export interface InstallProgress {
  stage: InstallStage;
  stageName: string;
  overallPercent: number;
  stagePercent: number;
  currentTask: string;
  processedItems: number;
  totalItems: number;
  processedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  activeDownloads: number;
  missingArchivesCount: number;
  isPaused: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export interface SkyrimEnvironment {
  path: string;
  isValid: boolean;
  version: string;
  edition: 'SE' | 'AE' | 'VR' | 'Unknown';
  dataPath: string;
  foundCorePlugins: string[];
  missingCorePlugins: string[];
  sourceType: 'steam_mac' | 'whisky' | 'crossover' | 'custom';
}

export interface NexusAccount {
  valid: boolean;
  name?: string;
  isPremium?: boolean;
  dailyLimit?: number;
  dailyRemaining?: number;
  hourlyLimit?: number;
  hourlyRemaining?: number;
  avatarUrl?: string;
}

/** Mod optionnel (désactivé par défaut dans le profil MO2 de la modlist) */
export interface ModlistOptionMod {
  name: string;
  size: number;
  /** Mods optionnels requis (ex. « Foo - Patch » requiert « Foo ») */
  requires?: string[];
  /** Option d'un choix exclusif requise (ex. famille d'interface Edge) */
  requiresChoice?: { choice: string; option: string };
}
export interface ModlistOptionGroup { separator: string; mods: ModlistOptionMod[]; /** Outils de test de l'auteur */ debug?: boolean; }
/** Choix exclusif détecté (famille d'interface, format d'écran, variantes « Base - X ») */
export interface ModlistChoiceOption { id: string; label: string; mods: string[]; size: number; }
export interface ModlistChoice {
  id: string;
  kind: 'family' | 'format' | 'variant';
  label: string;
  group: string | null;
  default: string;
  /** Variante imposée par le profil (ex. DynDOLOD Ultra / Standard) : non proposée */
  hidden?: boolean;
  options: ModlistChoiceOption[];
}
export interface ModlistOptionProfile {
  name: string;
  isDefault: boolean;
  groups: ModlistOptionGroup[];
  choices?: ModlistChoice[];
  /** Séparateurs « DO NOT ENABLE » : mods non proposés */
  lockedGroups?: { separator: string; count: number }[];
  optionalCount: number;
  optionalBytes: number;
}
export interface ModlistOptions { profiles: ModlistOptionProfile[]; }

/** Choix de l'utilisateur envoyés au serveur : profil + mods optionnels à installer */
export interface InstallOptions { profile?: string; enable: string[]; choices?: Record<string, string>; }
