/**
 * Libellés d'interface des écrans restants : composants communs (design.tsx), en-tête,
 * inspecteur, paramètres, plugins.txt, galerie, App (overlays / alertes) et ErrorBoundary.
 * Toute nouvelle chaîne visible doit être ajoutée ici dans les 4 langues.
 */
import type { Language } from './types';

// ── Unités de taille ─────────────────────────────────────────────────────────
const UNITS: Record<Language, { mb: string; gb: string }> = {
  fr: { mb: 'Mo', gb: 'Go' },
  en: { mb: 'MB', gb: 'GB' },
  es: { mb: 'MB', gb: 'GB' },
  it: { mb: 'MB', gb: 'GB' },
};

/**
 * Formate une taille en octets selon la langue.
 * mode 'auto' : Mo < 1 Go ≤ Go ; mode 'gb' : toujours en Go.
 */
export function fmtBytes(bytes: number, lang: Language, mode: 'auto' | 'gb' = 'auto', mbDigits = 1): string {
  const u = UNITS[lang] ?? UNITS.fr;
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (mode === 'gb') return `${(b / 1073741824).toFixed(1)} ${u.gb}`;
  if (!b) return `0 ${u.mb}`;
  const mb = b / 1048576;
  return mb < 1024 ? `${mb.toFixed(mbDigits)} ${u.mb}` : `${(mb / 1024).toFixed(1)} ${u.gb}`;
}

export function mbUnit(lang: Language): string {
  return (UNITS[lang] ?? UNITS.fr).mb;
}

// ── Composants communs (design.tsx, Header, LanguageSelector) ────────────────
export interface CommonUi {
  paste: string; pastePath: string; browse: string; apiKeyLabel: string; optional: string; apiKeyPlaceholder: string;
  show: string; hide: string; validating: string; validate: string; nexusFree: string; languageSelect: string;
  reactError: string; reload: string; refresh: string;
}

export const COMMON_UI: Record<Language, CommonUi> = {
  fr: {
    paste: 'Coller', pastePath: 'Coller le chemin', browse: 'Parcourir', apiKeyLabel: 'Clé API Nexus Mods', optional: '(optionnel)',
    apiKeyPlaceholder: 'Collez votre clé API Nexus Mods ici…', show: 'Afficher', hide: 'Masquer',
    validating: '⏳ Validation…', validate: '✓ Valider', nexusFree: 'Nexus gratuit', languageSelect: 'Sélection de la langue',
    reactError: '❌ Erreur de l\'interface', reload: 'Recharger', refresh: 'Actualiser le catalogue',
  },
  en: {
    paste: 'Paste', pastePath: 'Paste path', browse: 'Browse', apiKeyLabel: 'Nexus Mods API key', optional: '(optional)',
    apiKeyPlaceholder: 'Paste your Nexus Mods API key here…', show: 'Show', hide: 'Hide',
    validating: '⏳ Validating…', validate: '✓ Validate', nexusFree: 'Nexus Free', languageSelect: 'Language selection',
    reactError: '❌ Interface error', reload: 'Reload', refresh: 'Refresh catalog',
  },
  es: {
    paste: 'Pegar', pastePath: 'Pegar la ruta', browse: 'Examinar', apiKeyLabel: 'Clave API de Nexus Mods', optional: '(opcional)',
    apiKeyPlaceholder: 'Pegue aquí su clave API de Nexus Mods…', show: 'Mostrar', hide: 'Ocultar',
    validating: '⏳ Validando…', validate: '✓ Validar', nexusFree: 'Nexus gratuito', languageSelect: 'Selección de idioma',
    reactError: '❌ Error de la interfaz', reload: 'Recargar', refresh: 'Actualizar el catálogo',
  },
  it: {
    paste: 'Incolla', pastePath: 'Incolla il percorso', browse: 'Sfoglia', apiKeyLabel: 'Chiave API Nexus Mods', optional: '(facoltativa)',
    apiKeyPlaceholder: 'Incollare qui la chiave API Nexus Mods…', show: 'Mostra', hide: 'Nascondi',
    validating: '⏳ Verifica…', validate: '✓ Verifica', nexusFree: 'Nexus gratuito', languageSelect: 'Selezione della lingua',
    reactError: '❌ Errore dell\'interfaccia', reload: 'Ricarica', refresh: 'Aggiorna il catalogo',
  },
};

// ── Inspecteur ───────────────────────────────────────────────────────────────
export interface InspectorUi {
  dropRelease: string; browseFile: string; createdBy: string; change: string; demoTooltip: string; demoBadge: string;
  requiredArchives: string; totalSize: string; directives: string; installedSize: string; inlined: string; inlinedDesc: string;
  patches: string; patchesDesc: string; tabArchives: string; tabDirectives: string; tabPlugins: string;
  all: string; ready: string; missing: string; search: string; statusReady: string; statusMissing: string; author: string;
  pluginsTitle: string; pluginsDesc: string; fullViewer: string;
}

export const INSPECTOR_UI: Record<Language, InspectorUi> = {
  fr: {
    dropRelease: 'Relâchez pour charger le fichier .wabbajack !', browseFile: 'Parcourir un fichier…', createdBy: 'Créé par',
    change: 'Changer', demoTooltip: 'Mode aperçu : chargez un vrai .wabbajack pour une installation réelle', demoBadge: '⚠ Démo',
    requiredArchives: 'Archives requises', totalSize: 'Taille totale :', directives: 'Directives d\'extraction',
    installedSize: 'Taille installée :', inlined: 'Fichiers inclus (inlined)', inlinedDesc: 'Configs & scripts intégrés',
    patches: 'Patchs binaires OctoDiff', patchesDesc: 'Différentiels à appliquer',
    tabArchives: 'Archives', tabDirectives: 'Directives', tabPlugins: 'Plugins',
    all: 'Tous', ready: 'Prêts', missing: 'Manquants', search: 'Rechercher…', statusReady: '✓ Prêt', statusMissing: '⚠️ Manquant',
    author: 'Auteur', pluginsTitle: 'plugins.txt prédéfini par le modlist',
    pluginsDesc: 'Cet ordre de chargement est généré automatiquement et sera copié dans votre dossier d\'installation.',
    fullViewer: 'Afficheur complet',
  },
  en: {
    dropRelease: 'Release to load the .wabbajack file!', browseFile: 'Browse for a file…', createdBy: 'Created by',
    change: 'Change', demoTooltip: 'Preview mode: load a real .wabbajack for an actual installation', demoBadge: '⚠ Demo',
    requiredArchives: 'Required archives', totalSize: 'Total size:', directives: 'Extraction directives',
    installedSize: 'Installed size:', inlined: 'Inlined files', inlinedDesc: 'Embedded configs & scripts',
    patches: 'OctoDiff binary patches', patchesDesc: 'Diffs to apply',
    tabArchives: 'Archives', tabDirectives: 'Directives', tabPlugins: 'Plugins',
    all: 'All', ready: 'Ready', missing: 'Missing', search: 'Search…', statusReady: '✓ Ready', statusMissing: '⚠️ Missing',
    author: 'Author', pluginsTitle: 'plugins.txt predefined by the modlist',
    pluginsDesc: 'This load order is generated automatically and will be copied into your installation folder.',
    fullViewer: 'Full viewer',
  },
  es: {
    dropRelease: '¡Suelte para cargar el archivo .wabbajack!', browseFile: 'Examinar un archivo…', createdBy: 'Creada por',
    change: 'Cambiar', demoTooltip: 'Modo vista previa: cargue un .wabbajack real para una instalación real', demoBadge: '⚠ Demo',
    requiredArchives: 'Archivos requeridos', totalSize: 'Tamaño total:', directives: 'Directivas de extracción',
    installedSize: 'Tamaño instalado:', inlined: 'Archivos incluidos (inlined)', inlinedDesc: 'Configs y scripts integrados',
    patches: 'Parches binarios OctoDiff', patchesDesc: 'Diferenciales por aplicar',
    tabArchives: 'Archivos', tabDirectives: 'Directivas', tabPlugins: 'Plugins',
    all: 'Todos', ready: 'Listos', missing: 'Faltantes', search: 'Buscar…', statusReady: '✓ Listo', statusMissing: '⚠️ Faltante',
    author: 'Autor', pluginsTitle: 'plugins.txt predefinido por la modlist',
    pluginsDesc: 'Este orden de carga se genera automáticamente y se copiará en su carpeta de instalación.',
    fullViewer: 'Visor completo',
  },
  it: {
    dropRelease: 'Rilasciare per caricare il file .wabbajack!', browseFile: 'Sfoglia un file…', createdBy: 'Creata da',
    change: 'Cambia', demoTooltip: 'Modalità anteprima: caricare un vero .wabbajack per un\'installazione reale', demoBadge: '⚠ Demo',
    requiredArchives: 'Archivi richiesti', totalSize: 'Dimensione totale:', directives: 'Direttive di estrazione',
    installedSize: 'Dimensione installata:', inlined: 'File inclusi (inlined)', inlinedDesc: 'Config e script integrati',
    patches: 'Patch binarie OctoDiff', patchesDesc: 'Differenziali da applicare',
    tabArchives: 'Archivi', tabDirectives: 'Direttive', tabPlugins: 'Plugin',
    all: 'Tutti', ready: 'Pronti', missing: 'Mancanti', search: 'Cerca…', statusReady: '✓ Pronto', statusMissing: '⚠️ Mancante',
    author: 'Autore', pluginsTitle: 'plugins.txt predefinito dalla modlist',
    pluginsDesc: 'Questo ordine di caricamento è generato automaticamente e verrà copiato nella cartella di installazione.',
    fullViewer: 'Visualizzatore completo',
  },
};

// ── Paramètres ───────────────────────────────────────────────────────────────
export interface SettingsUi {
  manualPathPrompt: string; pastePathPrompt: string; pasteKeyPrompt: string; keyPasted: string; keyPlaceholder: string;
  showKey: string; hideKey: string; pasteFromClipboard: string; paste: string; verifying: string; foldersSection: string;
  downloadsLabel: string; downloadsPickTitle: string; destLabel: string; destPickTitle: string; pastePath: string;
  selecting: string; browse: string; threadsHint: string; threads: string; recommended: string;
}

export const SETTINGS_UI: Record<Language, SettingsUi> = {
  fr: {
    manualPathPrompt: 'Entrez ou collez le chemin absolu ({title}) :', pastePathPrompt: 'Collez votre chemin de dossier ici (Cmd + V) :',
    pasteKeyPrompt: 'Collez votre clé API Nexus Mods / Vortex ici (Cmd + V) :', keyPasted: '✓ Clé collée',
    keyPlaceholder: 'Collez votre clé API Nexus / Vortex ici…', showKey: 'Afficher la clé', hideKey: 'Masquer la clé',
    pasteFromClipboard: 'Coller depuis le presse-papier', paste: 'Coller', verifying: 'Vérification…',
    foldersSection: 'Dossiers de travail par défaut', downloadsLabel: 'Dossier DOWNLOADS (archives de mods)',
    downloadsPickTitle: 'Dossier DOWNLOADS des archives', destLabel: 'Dossier READY TO PLAY (destination finale des mods et plugins.txt)',
    destPickTitle: 'Dossier READY TO PLAY de sortie', pastePath: 'Coller le chemin', selecting: 'Sélection…', browse: 'Parcourir…',
    threadsHint: 'Nombre de tâches en parallèle (adapté aux puces Apple Silicon M1/M2/M3/M4)', threads: 'threads', recommended: 'recommandé',
  },
  en: {
    manualPathPrompt: 'Enter or paste the absolute path ({title}):', pastePathPrompt: 'Paste your folder path here (Cmd + V):',
    pasteKeyPrompt: 'Paste your Nexus Mods / Vortex API key here (Cmd + V):', keyPasted: '✓ Key pasted',
    keyPlaceholder: 'Paste your Nexus / Vortex API key here…', showKey: 'Show key', hideKey: 'Hide key',
    pasteFromClipboard: 'Paste from clipboard', paste: 'Paste', verifying: 'Verifying…',
    foldersSection: 'Default working folders', downloadsLabel: 'DOWNLOADS folder (mod archives)',
    downloadsPickTitle: 'DOWNLOADS archive folder', destLabel: 'READY TO PLAY folder (final destination of mods and plugins.txt)',
    destPickTitle: 'READY TO PLAY output folder', pastePath: 'Paste path', selecting: 'Selecting…', browse: 'Browse…',
    threadsHint: 'Number of parallel tasks (tuned for Apple Silicon M1/M2/M3/M4 chips)', threads: 'threads', recommended: 'recommended',
  },
  es: {
    manualPathPrompt: 'Introduzca o pegue la ruta absoluta ({title}):', pastePathPrompt: 'Pegue aquí la ruta de la carpeta (Cmd + V):',
    pasteKeyPrompt: 'Pegue aquí su clave API de Nexus Mods / Vortex (Cmd + V):', keyPasted: '✓ Clave pegada',
    keyPlaceholder: 'Pegue aquí su clave API de Nexus / Vortex…', showKey: 'Mostrar la clave', hideKey: 'Ocultar la clave',
    pasteFromClipboard: 'Pegar desde el portapapeles', paste: 'Pegar', verifying: 'Verificando…',
    foldersSection: 'Carpetas de trabajo predeterminadas', downloadsLabel: 'Carpeta DOWNLOADS (archivos de mods)',
    downloadsPickTitle: 'Carpeta DOWNLOADS de archivos', destLabel: 'Carpeta READY TO PLAY (destino final de los mods y plugins.txt)',
    destPickTitle: 'Carpeta READY TO PLAY de salida', pastePath: 'Pegar la ruta', selecting: 'Seleccionando…', browse: 'Examinar…',
    threadsHint: 'Número de tareas en paralelo (adaptado a los chips Apple Silicon M1/M2/M3/M4)', threads: 'hilos', recommended: 'recomendado',
  },
  it: {
    manualPathPrompt: 'Inserire o incollare il percorso assoluto ({title}):', pastePathPrompt: 'Incollare qui il percorso della cartella (Cmd + V):',
    pasteKeyPrompt: 'Incollare qui la chiave API Nexus Mods / Vortex (Cmd + V):', keyPasted: '✓ Chiave incollata',
    keyPlaceholder: 'Incollare qui la chiave API Nexus / Vortex…', showKey: 'Mostra la chiave', hideKey: 'Nascondi la chiave',
    pasteFromClipboard: 'Incolla dagli appunti', paste: 'Incolla', verifying: 'Verifica…',
    foldersSection: 'Cartelle di lavoro predefinite', downloadsLabel: 'Cartella DOWNLOADS (archivi delle mod)',
    downloadsPickTitle: 'Cartella DOWNLOADS degli archivi', destLabel: 'Cartella READY TO PLAY (destinazione finale delle mod e di plugins.txt)',
    destPickTitle: 'Cartella READY TO PLAY di output', pastePath: 'Incolla il percorso', selecting: 'Selezione…', browse: 'Sfoglia…',
    threadsHint: 'Numero di attività in parallelo (ottimizzato per i chip Apple Silicon M1/M2/M3/M4)', threads: 'thread', recommended: 'consigliato',
  },
};

// ── plugins.txt ──────────────────────────────────────────────────────────────
export interface PluginsUi {
  title: string; subtitle: string; filter: string; copied: string; copyAll: string; download: string;
  noMatch: string; footerHint: string; close: string;
}

export const PLUGINS_UI: Record<Language, PluginsUi> = {
  fr: {
    title: 'plugins.txt • Ordre de chargement post-LOOT', subtitle: 'Généré selon l’ordre optimal défini par le modlist « {name} »',
    filter: 'Filtrer les plugins (ex. : SkyUI, Dawnguard)…', copied: 'Copié !', copyAll: 'Tout copier', download: 'Télécharger plugins.txt',
    noMatch: 'Aucun plugin ne correspond à votre filtre.', footerHint: 'Sous macOS / Wine, ce fichier se place généralement dans :', close: 'Fermer',
  },
  en: {
    title: 'plugins.txt • Post-LOOT load order', subtitle: 'Generated from the optimal order defined by the modlist "{name}"',
    filter: 'Filter plugins (e.g. SkyUI, Dawnguard)…', copied: 'Copied!', copyAll: 'Copy all', download: 'Download plugins.txt',
    noMatch: 'No plugin matches your filter.', footerHint: 'On macOS / Wine, this file usually goes in:', close: 'Close',
  },
  es: {
    title: 'plugins.txt • Orden de carga post-LOOT', subtitle: 'Generado según el orden óptimo definido por la modlist «{name}»',
    filter: 'Filtrar plugins (p. ej.: SkyUI, Dawnguard)…', copied: '¡Copiado!', copyAll: 'Copiar todo', download: 'Descargar plugins.txt',
    noMatch: 'Ningún plugin coincide con su filtro.', footerHint: 'En macOS / Wine, este archivo suele colocarse en:', close: 'Cerrar',
  },
  it: {
    title: 'plugins.txt • Ordine di caricamento post-LOOT', subtitle: 'Generato secondo l\'ordine ottimale definito dalla modlist «{name}»',
    filter: 'Filtra i plugin (es.: SkyUI, Dawnguard)…', copied: 'Copiato!', copyAll: 'Copia tutto', download: 'Scarica plugins.txt',
    noMatch: 'Nessun plugin corrisponde al filtro.', footerHint: 'Su macOS / Wine, questo file si trova di solito in:', close: 'Chiudi',
  },
};

// ── Galerie ──────────────────────────────────────────────────────────────────
export interface GalleryUi { all: string; otherGames: string; allOthers: string; preview: string; hideNsfw: string }

export const GALLERY_UI: Record<Language, GalleryUi> = {
  fr: { all: 'Tous', otherGames: 'Autres jeux', allOthers: 'Tous les autres jeux', preview: 'aperçu', hideNsfw: 'Masquer NSFW' },
  en: { all: 'All', otherGames: 'Other games', allOthers: 'All other games', preview: 'preview', hideNsfw: 'Hide NSFW' },
  es: { all: 'Todos', otherGames: 'Otros juegos', allOthers: 'Todos los otros juegos', preview: 'vista previa', hideNsfw: 'Ocultar NSFW' },
  it: { all: 'Tutti', otherGames: 'Altri giochi', allOthers: 'Tutti gli altri giochi', preview: 'anteprima', hideNsfw: 'Nascondi NSFW' },
};

// ── App (overlays, alertes, dialogues natifs) ────────────────────────────────
export interface AppUi {
  pickFileTitle: string; analysisError: string; loadModlistFirst: string; setDestFirst: string;
  dropTitle: string; dropSubtitle: string; downloading: string; downloadingHint: string; destFolderAlert: string;
}

export const APP_UI: Record<Language, AppUi> = {
  fr: {
    pickFileTitle: 'Sélectionnez votre fichier .wabbajack', analysisError: 'Erreur d\'analyse :',
    loadModlistFirst: 'Veuillez d’abord charger un modlist.', setDestFirst: 'Veuillez définir un dossier de destination.',
    dropTitle: 'Déposer le fichier .wabbajack', dropSubtitle: 'Relâchez pour analyser la modlist',
    downloading: 'Téléchargement en cours…', downloadingHint: 'Le fichier .wabbajack peut peser plusieurs centaines de Mo — merci de patienter.',
    destFolderAlert: 'Dossier READY TO PLAY :',
  },
  en: {
    pickFileTitle: 'Select your .wabbajack file', analysisError: 'Analysis error:',
    loadModlistFirst: 'Please load a modlist first.', setDestFirst: 'Please set a destination folder.',
    dropTitle: 'Drop the .wabbajack file', dropSubtitle: 'Release to analyze the modlist',
    downloading: 'Downloading…', downloadingHint: 'The .wabbajack file can weigh several hundred MB — please wait.',
    destFolderAlert: 'READY TO PLAY folder:',
  },
  es: {
    pickFileTitle: 'Seleccione su archivo .wabbajack', analysisError: 'Error de análisis:',
    loadModlistFirst: 'Cargue primero una modlist.', setDestFirst: 'Defina una carpeta de destino.',
    dropTitle: 'Soltar el archivo .wabbajack', dropSubtitle: 'Suelte para analizar la modlist',
    downloading: 'Descargando…', downloadingHint: 'El archivo .wabbajack puede pesar varios cientos de MB — espere, por favor.',
    destFolderAlert: 'Carpeta READY TO PLAY:',
  },
  it: {
    pickFileTitle: 'Selezionare il file .wabbajack', analysisError: 'Errore di analisi:',
    loadModlistFirst: 'Caricare prima una modlist.', setDestFirst: 'Definire una cartella di destinazione.',
    dropTitle: 'Rilascia il file .wabbajack', dropSubtitle: 'Rilasciare per analizzare la modlist',
    downloading: 'Download in corso…', downloadingHint: 'Il file .wabbajack può pesare diverse centinaia di MB — attendere.',
    destFolderAlert: 'Cartella READY TO PLAY:',
  },
};

/** Langue courante hors contexte React (ErrorBoundary). */
export function storedLanguage(): Language {
  try {
    const l = localStorage.getItem('mabbajack_language');
    return l === 'en' || l === 'es' || l === 'it' ? l : 'fr';
  } catch {
    return 'fr';
  }
}
