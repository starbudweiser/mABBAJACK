/**
 * Libellés d'interface complémentaires (écran d'installation + fenêtre de téléchargement manuel).
 * Regroupés par écran et par langue pour éviter d'alourdir Translations.
 */
import type { Language } from './types';

export interface InstallerUi {
  title: string; subtitle: string; modlistLoaded: string; by: string; loaded: string; requiredVersion: string;
  noModlist: string; previewTitle: string; previewBody1: string; previewBody2: string; previewBody3: string;
  previewOpenBtn: string; downloadsTitle: string; downloadsHint: string; downloadsSelect: string;
  cache: string; archivesReady: string; missing: string; allPresent: string; destTitle: string; destBadge: string;
  destHint: string; destSelect: string; nexusInfoPremium: string; nexusInfoStandard: string; pasteKeyPrompt: string;
  keyPasted: string; keyInvalid: string; keyError: string; premiumAuto: string; standardManual: string;
  blockedTitle: string; blockedBody: string; launch: string; footer: string; pathPrompt: string; pastePrompt: string;
}

export interface ManualUi {
  title: string; missingCount: string; subtitle: string; search: string; scanning: string; verify: string;
  copyPath: string; pathCopied: string; allReady: string; noMatch: string; author: string; googleSearch: string;
  footer: string; close: string; gameFile: string; gameFileHint: string; expectedAt: string;
}

export const INSTALLER_UI: Record<Language, InstallerUi> = {
  fr: {
    title: 'Installation Ready to Play', subtitle: 'Déploiement direct des mods selon les directives Wabbajack.',
    modlistLoaded: 'Modlist chargé', by: 'par', loaded: '✓ Chargé', requiredVersion: 'Version requise :',
    noModlist: '⚠ Glissez un fichier .wabbajack sur l\'écran, ou chargez-en un depuis la Galerie ou l\'Inspecteur.',
    previewTitle: 'Mode Aperçu — Données fictives uniquement',
    previewBody1: 'Ce modlist a été chargé depuis la Galerie sans fichier .wabbajack réel.',
    previewBody2: 'Les archives, directives et plugins affichés sont générés automatiquement — ils ne correspondent pas à la vraie liste.',
    previewBody3: '👉 Téléchargez le fichier .wabbajack officiel depuis wabbajack.org, puis chargez-le via le bouton',
    previewOpenBtn: '📁 Ouvrir fichier… dans l\'en-tête.',
    downloadsTitle: '1. Dossier DOWNLOADS', downloadsHint: 'Stockage des archives .7z/.zip/.rar téléchargées (mods bruts).',
    downloadsSelect: 'Sélectionnez le dossier DOWNLOADS',
    cache: 'Cache :', archivesReady: 'archives prêtes', missing: 'manquantes →', allPresent: '✓ Toutes présentes',
    destTitle: '2. Dossier READY TO PLAY', destBadge: 'Destination finale',
    destHint: 'Les fichiers seront extraits ici selon les directives Wabbajack. Copiez ensuite dans votre Skyrim/Data.',
    destSelect: 'Sélectionnez le dossier READY TO PLAY',
    nexusInfoPremium: 'Compte Premium : téléchargements automatiques.', nexusInfoStandard: 'Compte Standard : URLs manuelles générées dans le journal.',
    pasteKeyPrompt: 'Collez votre clé API Nexus Mods :', keyPasted: '✓ Clé collée', keyInvalid: '✕ Clé invalide', keyError: '✕ Erreur de validation',
    premiumAuto: 'Premium ⭐ (téléchargements automatiques)', standardManual: 'Standard (URLs manuelles générées)',
    blockedTitle: '⛔ Installation bloquée',
    blockedBody: 'Aucun fichier .wabbajack réel chargé. Chargez d\'abord le vrai fichier pour débloquer l\'installation.',
    launch: 'Lancer le Déploiement Ready to Play',
    footer: 'Extraction sélective selon les directives Wabbajack · plugins.txt & loadorder.txt générés',
    pathPrompt: 'Chemin pour :', pastePrompt: 'Chemin (collez avec Cmd+V) :',
  },
  en: {
    title: 'Ready to Play Installation', subtitle: 'Direct mod deployment following Wabbajack directives.',
    modlistLoaded: 'Loaded modlist', by: 'by', loaded: '✓ Loaded', requiredVersion: 'Required version:',
    noModlist: '⚠ Drop a .wabbajack file on the window, or load one from the Gallery or the Inspector.',
    previewTitle: 'Preview mode — Placeholder data only',
    previewBody1: 'This modlist was loaded from the Gallery without a real .wabbajack file.',
    previewBody2: 'The archives, directives and plugins shown are generated automatically — they do not match the real list.',
    previewBody3: '👉 Download the official .wabbajack file from wabbajack.org, then load it with the button',
    previewOpenBtn: '📁 Open file… in the header.',
    downloadsTitle: '1. DOWNLOADS folder', downloadsHint: 'Storage for downloaded .7z/.zip/.rar archives (raw mods).',
    downloadsSelect: 'Select the DOWNLOADS folder',
    cache: 'Cache:', archivesReady: 'archives ready', missing: 'missing →', allPresent: '✓ All present',
    destTitle: '2. READY TO PLAY folder', destBadge: 'Final destination',
    destHint: 'Files are extracted here following Wabbajack directives. Then copy them into your Skyrim/Data.',
    destSelect: 'Select the READY TO PLAY folder',
    nexusInfoPremium: 'Premium account: automatic downloads.', nexusInfoStandard: 'Standard account: manual URLs listed in the log.',
    pasteKeyPrompt: 'Paste your Nexus Mods API key:', keyPasted: '✓ Key pasted', keyInvalid: '✕ Invalid key', keyError: '✕ Validation error',
    premiumAuto: 'Premium ⭐ (automatic downloads)', standardManual: 'Standard (manual URLs generated)',
    blockedTitle: '⛔ Installation blocked',
    blockedBody: 'No real .wabbajack file loaded. Load the actual file first to unlock the installation.',
    launch: 'Start Ready to Play Deployment',
    footer: 'Selective extraction following Wabbajack directives · plugins.txt & loadorder.txt generated',
    pathPrompt: 'Path for:', pastePrompt: 'Path (paste with Cmd+V):',
  },
  es: {
    title: 'Instalación Ready to Play', subtitle: 'Despliegue directo de mods según las directivas de Wabbajack.',
    modlistLoaded: 'Modlist cargada', by: 'por', loaded: '✓ Cargada', requiredVersion: 'Versión requerida:',
    noModlist: '⚠ Arrastre un archivo .wabbajack a la ventana, o cárguelo desde la Galería o el Inspector.',
    previewTitle: 'Modo vista previa — Solo datos ficticios',
    previewBody1: 'Esta modlist se cargó desde la Galería sin un archivo .wabbajack real.',
    previewBody2: 'Los archivos, directivas y plugins mostrados se generan automáticamente — no corresponden a la lista real.',
    previewBody3: '👉 Descargue el archivo .wabbajack oficial desde wabbajack.org y cárguelo con el botón',
    previewOpenBtn: '📁 Abrir archivo… del encabezado.',
    downloadsTitle: '1. Carpeta DOWNLOADS', downloadsHint: 'Almacenamiento de los archivos .7z/.zip/.rar descargados (mods en bruto).',
    downloadsSelect: 'Seleccione la carpeta DOWNLOADS',
    cache: 'Caché:', archivesReady: 'archivos listos', missing: 'faltantes →', allPresent: '✓ Todos presentes',
    destTitle: '2. Carpeta READY TO PLAY', destBadge: 'Destino final',
    destHint: 'Los archivos se extraen aquí según las directivas de Wabbajack. Luego cópielos en su Skyrim/Data.',
    destSelect: 'Seleccione la carpeta READY TO PLAY',
    nexusInfoPremium: 'Cuenta Premium: descargas automáticas.', nexusInfoStandard: 'Cuenta Standard: URL manuales indicadas en el registro.',
    pasteKeyPrompt: 'Pegue su clave API de Nexus Mods:', keyPasted: '✓ Clave pegada', keyInvalid: '✕ Clave no válida', keyError: '✕ Error de validación',
    premiumAuto: 'Premium ⭐ (descargas automáticas)', standardManual: 'Standard (URL manuales generadas)',
    blockedTitle: '⛔ Instalación bloqueada',
    blockedBody: 'No se ha cargado ningún archivo .wabbajack real. Cargue primero el archivo real para desbloquear la instalación.',
    launch: 'Iniciar el despliegue Ready to Play',
    footer: 'Extracción selectiva según las directivas de Wabbajack · plugins.txt y loadorder.txt generados',
    pathPrompt: 'Ruta para:', pastePrompt: 'Ruta (pegue con Cmd+V):',
  },
  it: {
    title: 'Installazione Ready to Play', subtitle: 'Deployment diretto delle mod secondo le direttive Wabbajack.',
    modlistLoaded: 'Modlist caricata', by: 'di', loaded: '✓ Caricata', requiredVersion: 'Versione richiesta:',
    noModlist: '⚠ Trascinare un file .wabbajack nella finestra, o caricarlo dalla Galleria o dall\'Ispettore.',
    previewTitle: 'Modalità anteprima — Solo dati fittizi',
    previewBody1: 'Questa modlist è stata caricata dalla Galleria senza un vero file .wabbajack.',
    previewBody2: 'Archivi, direttive e plugin mostrati sono generati automaticamente — non corrispondono alla lista reale.',
    previewBody3: '👉 Scaricare il file .wabbajack ufficiale da wabbajack.org, poi caricarlo con il pulsante',
    previewOpenBtn: '📁 Apri file… nell\'intestazione.',
    downloadsTitle: '1. Cartella DOWNLOADS', downloadsHint: 'Archivio dei file .7z/.zip/.rar scaricati (mod grezze).',
    downloadsSelect: 'Seleziona la cartella DOWNLOADS',
    cache: 'Cache:', archivesReady: 'archivi pronti', missing: 'mancanti →', allPresent: '✓ Tutti presenti',
    destTitle: '2. Cartella READY TO PLAY', destBadge: 'Destinazione finale',
    destHint: 'I file vengono estratti qui secondo le direttive Wabbajack. Copiarli poi in Skyrim/Data.',
    destSelect: 'Seleziona la cartella READY TO PLAY',
    nexusInfoPremium: 'Account Premium: download automatici.', nexusInfoStandard: 'Account Standard: URL manuali indicati nel registro.',
    pasteKeyPrompt: 'Incollare la chiave API di Nexus Mods:', keyPasted: '✓ Chiave incollata', keyInvalid: '✕ Chiave non valida', keyError: '✕ Errore di convalida',
    premiumAuto: 'Premium ⭐ (download automatici)', standardManual: 'Standard (URL manuali generati)',
    blockedTitle: '⛔ Installazione bloccata',
    blockedBody: 'Nessun vero file .wabbajack caricato. Caricare prima il file reale per sbloccare l\'installazione.',
    launch: 'Avvia il deployment Ready to Play',
    footer: 'Estrazione selettiva secondo le direttive Wabbajack · plugins.txt e loadorder.txt generati',
    pathPrompt: 'Percorso per:', pastePrompt: 'Percorso (incolla con Cmd+V):',
  },
};

export const MANUAL_UI: Record<Language, ManualUi> = {
  fr: {
    title: 'Téléchargement manuel d\'archives', missingCount: '{n} manquantes ({size})',
    subtitle: 'Téléchargez les archives de mods et déposez-les dans votre dossier DOWNLOADS. Les fichiers du jeu, eux, sont lus dans le dossier du jeu.',
    search: 'Rechercher une archive manquante…', scanning: 'Scan en cours…', verify: 'Vérifier les fichiers',
    copyPath: 'Copier le chemin du dossier', pathCopied: 'Chemin copié dans le presse-papier :',
    allReady: 'Toutes les archives sont prêtes !', noMatch: 'Aucune archive manquante ne correspond à votre recherche.',
    author: 'Auteur', googleSearch: 'Recherche Google',
    footer: 'Après avoir déposé les fichiers, cliquez sur « Vérifier les fichiers ».', close: 'Fermer',
    gameFile: 'Fichier du jeu', gameFileHint: 'Non téléchargeable : renseignez « Dossier du jeu Skyrim ».', expectedAt: 'Attendu :',
  },
  en: {
    title: 'Manual archive download', missingCount: '{n} missing ({size})',
    subtitle: 'Download the mod archives and drop them into your DOWNLOADS folder. Game files are read from the game folder instead.',
    search: 'Search a missing archive…', scanning: 'Scanning…', verify: 'Verify files',
    copyPath: 'Copy folder path', pathCopied: 'Path copied to clipboard:',
    allReady: 'All archives are ready!', noMatch: 'No missing archive matches your search.',
    author: 'Author', googleSearch: 'Google search',
    footer: 'Once the files are in place, click "Verify files".', close: 'Close',
    gameFile: 'Game file', gameFileHint: 'Not downloadable: fill in "Skyrim game folder".', expectedAt: 'Expected at:',
  },
  es: {
    title: 'Descarga manual de archivos', missingCount: '{n} faltantes ({size})',
    subtitle: 'Descargue los archivos de mods y colóquelos en su carpeta DOWNLOADS. Los archivos del juego se leen desde la carpeta del juego.',
    search: 'Buscar un archivo faltante…', scanning: 'Escaneando…', verify: 'Verificar archivos',
    copyPath: 'Copiar la ruta de la carpeta', pathCopied: 'Ruta copiada al portapapeles:',
    allReady: '¡Todos los archivos están listos!', noMatch: 'Ningún archivo faltante coincide con su búsqueda.',
    author: 'Autor', googleSearch: 'Búsqueda en Google',
    footer: 'Cuando los archivos estén en su sitio, pulse «Verificar archivos».', close: 'Cerrar',
    gameFile: 'Archivo del juego', gameFileHint: 'No descargable: indique «Carpeta del juego Skyrim».', expectedAt: 'Esperado en:',
  },
  it: {
    title: 'Download manuale degli archivi', missingCount: '{n} mancanti ({size})',
    subtitle: 'Scaricare gli archivi delle mod e metterli nella cartella DOWNLOADS. I file del gioco vengono invece letti dalla cartella del gioco.',
    search: 'Cerca un archivio mancante…', scanning: 'Scansione in corso…', verify: 'Verifica file',
    copyPath: 'Copia il percorso della cartella', pathCopied: 'Percorso copiato negli appunti:',
    allReady: 'Tutti gli archivi sono pronti!', noMatch: 'Nessun archivio mancante corrisponde alla ricerca.',
    author: 'Autore', googleSearch: 'Ricerca Google',
    footer: 'Dopo aver inserito i file, fare clic su «Verifica file».', close: 'Chiudi',
    gameFile: 'File del gioco', gameFileHint: 'Non scaricabile: compilare «Cartella del gioco Skyrim».', expectedAt: 'Atteso in:',
  },
};

export interface OptionsUi {
  title: string; hint: string; loading: string; error: string; profile: string;
  selected: string; checkAll: string; uncheckAll: string; note: string;
  none: string; debugTitle: string; debugHint: string; locked: string; requires: string;
  profilesHint: string; choicesTitle: string; format: string; formatDetected: string; family: string; variant: string;
}

export const OPTIONS_UI: Record<Language, OptionsUi> = {
  fr: {
    none: 'Aucun',
    debugTitle: 'Outils de débogage (déconseillé)', debugHint: "Outils de test de l'auteur de la liste : inutiles pour jouer, ils peuvent ralentir le jeu.", locked: "{n} mod(s) non proposé(s) : « {sep} », consigne de la liste (ne pas activer).", requires: 'Nécessite : {deps}',
    profilesHint: 'Un seul profil peut être installé.', choicesTitle: 'Choix exclusifs', format: "Format d'écran", formatDetected: 'détecté : {ratio}', family: 'Interface {tag}', variant: '{label}',
    title: 'Mods optionnels', hint: 'Désactivés par défaut dans la modlist (ex. ultra-wide, manette, ENB, contenus NSFW). Seuls les mods cochés seront installés.',
    loading: 'Analyse des options…', error: 'Options indisponibles pour ce fichier.', profile: 'Profil',
    selected: '{n} / {total} sélectionné(s) · {size}', checkAll: 'Tout cocher', uncheckAll: 'Tout décocher',
    note: 'Les mods non cochés ne sont ni téléchargés ni installés.',
  },
  en: {
    none: 'None',
    debugTitle: 'Debugging tools (not recommended)', debugHint: "The list author's test tools: not needed to play, they can slow the game down.", locked: '{n} mod(s) not offered: “{sep}”, per the list instructions (do not enable).', requires: 'Requires: {deps}',
    profilesHint: 'Only one profile can be installed.', choicesTitle: 'Exclusive choices', format: 'Screen format', formatDetected: 'detected: {ratio}', family: 'Interface {tag}', variant: '{label}',
    title: 'Optional mods', hint: 'Disabled by default in the modlist (e.g. ultra-wide, controller, ENB, NSFW content). Only checked mods will be installed.',
    loading: 'Analyzing options…', error: 'Options unavailable for this file.', profile: 'Profile',
    selected: '{n} / {total} selected · {size}', checkAll: 'Check all', uncheckAll: 'Uncheck all',
    note: 'Unchecked mods are neither downloaded nor installed.',
  },
  es: {
    none: 'Ninguno',
    debugTitle: 'Herramientas de depuración (desaconsejado)', debugHint: 'Herramientas de prueba del autor de la lista: no son necesarias para jugar y pueden ralentizar el juego.', locked: '{n} mod(s) no ofrecido(s): «{sep}», según las instrucciones de la lista (no activar).', requires: 'Requiere: {deps}',
    profilesHint: 'Solo se puede instalar un perfil.', choicesTitle: 'Opciones exclusivas', format: 'Formato de pantalla', formatDetected: 'detectado: {ratio}', family: 'Interfaz {tag}', variant: '{label}',
    title: 'Mods opcionales', hint: 'Desactivados por defecto en la modlist (p. ej. ultra-wide, mando, ENB, contenido NSFW). Solo se instalarán los mods marcados.',
    loading: 'Analizando opciones…', error: 'Opciones no disponibles para este archivo.', profile: 'Perfil',
    selected: '{n} / {total} seleccionado(s) · {size}', checkAll: 'Marcar todo', uncheckAll: 'Desmarcar todo',
    note: 'Los mods sin marcar no se descargan ni se instalan.',
  },
  it: {
    none: 'Nessuno',
    debugTitle: 'Strumenti di debug (sconsigliato)', debugHint: "Strumenti di test dell'autore della lista: non servono per giocare e possono rallentare il gioco.", locked: '{n} mod non proposta/e: «{sep}», secondo le istruzioni della lista (non attivare).', requires: 'Richiede: {deps}',
    profilesHint: 'È possibile installare un solo profilo.', choicesTitle: 'Scelte esclusive', format: 'Formato schermo', formatDetected: 'rilevato: {ratio}', family: 'Interfaccia {tag}', variant: '{label}',
    title: 'Mod opzionali', hint: 'Disattivate per impostazione predefinita nella modlist (es. ultra-wide, controller, ENB, contenuti NSFW). Verranno installate solo le mod selezionate.',
    loading: 'Analisi delle opzioni…', error: 'Opzioni non disponibili per questo file.', profile: 'Profilo',
    selected: '{n} / {total} selezionata/e · {size}', checkAll: 'Seleziona tutto', uncheckAll: 'Deseleziona tutto',
    note: 'Le mod non selezionate non vengono né scaricate né installate.',
  },
};

export interface ImportUi {
  title: string; uploading: string; analyzing: string; analyzingHint: string; elapsed: string;
}

export const IMPORT_UI: Record<Language, ImportUi> = {
  fr: {
    title: 'Chargement de la modlist', uploading: 'Envoi du fichier au serveur…', analyzing: 'Analyse du manifeste…',
    analyzingHint: 'Les très grosses modlists (plusieurs Go) peuvent demander une minute. Ne fermez pas l\'application.',
    elapsed: 'Temps écoulé : {s} s',
  },
  en: {
    title: 'Loading modlist', uploading: 'Sending file to the server…', analyzing: 'Analyzing manifest…',
    analyzingHint: 'Very large modlists (several GB) can take a minute. Do not close the app.',
    elapsed: 'Elapsed: {s} s',
  },
  es: {
    title: 'Cargando la modlist', uploading: 'Enviando el archivo al servidor…', analyzing: 'Analizando el manifiesto…',
    analyzingHint: 'Las modlists muy grandes (varios GB) pueden tardar un minuto. No cierre la aplicación.',
    elapsed: 'Tiempo transcurrido: {s} s',
  },
  it: {
    title: 'Caricamento della modlist', uploading: 'Invio del file al server…', analyzing: 'Analisi del manifesto…',
    analyzingHint: 'Le modlist molto grandi (diversi GB) possono richiedere un minuto. Non chiudere l\'applicazione.',
    elapsed: 'Tempo trascorso: {s} s',
  },
};

export interface ScanUi {
  listing: string; matching: string; hint: string; availability: string; noFolder: string;
  missingN: string; scanning: string; showMore: string; showLess: string;
}

export const SCAN_UI: Record<Language, ScanUi> = {
  fr: {
    listing: 'Lecture du dossier de téléchargement…', matching: 'Recherche des archives de la modlist…',
    hint: 'Peut durer une à deux minutes sur un grand dossier : l\'application n\'a pas planté.',
    availability: 'Archives locales', noFolder: 'Dossier de téléchargement non défini (Installation).',
    missingN: '{n} manquante(s)', scanning: 'Scan en cours…', showMore: 'Voir plus', showLess: 'Réduire',
  },
  en: {
    listing: 'Reading the download folder…', matching: 'Matching the modlist archives…',
    hint: 'This can take a minute or two on a large folder: the app has not crashed.',
    availability: 'Local archives', noFolder: 'Download folder not set (Install tab).',
    missingN: '{n} missing', scanning: 'Scanning…', showMore: 'Show more', showLess: 'Show less',
  },
  es: {
    listing: 'Leyendo la carpeta de descargas…', matching: 'Buscando los archivos de la modlist…',
    hint: 'Puede tardar uno o dos minutos en una carpeta grande: la aplicación no se ha bloqueado.',
    availability: 'Archivos locales', noFolder: 'Carpeta de descargas no definida (pestaña Instalación).',
    missingN: '{n} faltante(s)', scanning: 'Escaneando…', showMore: 'Ver más', showLess: 'Reducir',
  },
  it: {
    listing: 'Lettura della cartella dei download…', matching: 'Ricerca degli archivi della modlist…',
    hint: 'Può richiedere uno o due minuti su una cartella grande: l\'applicazione non si è bloccata.',
    availability: 'Archivi locali', noFolder: 'Cartella dei download non definita (scheda Installazione).',
    missingN: '{n} mancante/i', scanning: 'Scansione in corso…', showMore: 'Mostra altro', showLess: 'Riduci',
  },
};
