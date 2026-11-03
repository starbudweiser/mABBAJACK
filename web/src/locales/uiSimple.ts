/**
 * Libellés du mode Simple (parcours Choisir → Préparer → Installer → Terminé) et du réglage de présentation.
 * Vocabulaire volontairement sans jargon ; le français est rédigé en premier.
 */
import type { Language } from './types';

export interface SimpleUi {
  // en-tête et étapes
  stepsLabel: string; stepChoose: string; stepPrepare: string; stepInstall: string; stepDone: string;
  expertMode: string; settings: string;
  // 1. choisir
  chooseTitle: string; chooseSubtitle: string; search: string; loading: string; none: string;
  hideNsfw: string; openFile: string; onDisk: string; install: string; by: string;
  compatible: string; needsAE: string; needsSE: string; gameLine: string; noGameLine: string;
  // 2. préparer
  prepareTitle: string; back: string; yourGame: string; gameDetected: string; gameNotFound: string; gameMismatch: string;
  gameFolder: string; gameFolderHint: string; downloadsFolder: string; downloadsHint: string;
  destFolder: string; destHint: string; browse: string; paste: string; chooseFolder: string; pastePrompt: string;
  diskNeed: string; diskFree: string; diskLow: string;
  nexusTitle: string; nexusNoKey: string; nexusPremium: string; nexusFree: string; nexusAdd: string; nexusInvalid: string; nexusOffline: string;
  customize: string; start: string; startHint: string; changeModlist: string; preview: string;
  // 3. installer
  installTitle: string; starting: string; pause: string; resume: string; cancel: string; eta: string;
  showDetails: string; hideDetails: string; manualDownloads: string; paused: string;
  stageValidating: string; stageScanning: string; stageDownloading: string; stageExtracting: string; stageConfig: string;
  // 4. terminé
  doneTitleMissing: string; doneMissing: string; doneRelaunch: string; doneTitle: string; doneBody: string; doneHow: string; openFolder: string; pluginsTxt: string; another: string;
  failTitle: string; failHint: string; retry: string;
  // réglage de présentation
  modeLabel: string; modeSimple: string; modeExpert: string; modeHint: string;
}

export const SIMPLE_UI: Record<Language, SimpleUi> = {
  fr: {
    stepsLabel: 'Étapes', stepChoose: 'Choisir', stepPrepare: 'Préparer', stepInstall: 'Installer', stepDone: 'Terminé',
    expertMode: 'Mode expert', settings: 'Paramètres',
    chooseTitle: 'Choisissez une modlist',
    chooseSubtitle: 'Une modlist est une collection de mods prête à jouer. mABBAJACK la télécharge et l’installe pour vous.',
    search: 'Rechercher une modlist…', loading: 'Chargement du catalogue…', none: 'Aucune modlist ne correspond.',
    hideNsfw: 'Masquer les modlists pour adultes', openFile: 'Ouvrir un fichier .wabbajack…', onDisk: 'sur disque', install: 'Installer', by: 'par',
    compatible: 'Compatible avec votre jeu', needsAE: 'Demande Skyrim AE', needsSE: 'Demande Skyrim SE',
    gameLine: 'Votre jeu : Skyrim {edition}', noGameLine: 'Skyrim n’a pas été trouvé sur ce Mac.',
    prepareTitle: 'Préparer l’installation', back: 'Retour', yourGame: 'Votre jeu',
    gameDetected: 'Skyrim {edition} détecté.', gameNotFound: 'Skyrim n’a pas été trouvé automatiquement. Indiquez son dossier.',
    gameMismatch: 'Cette modlist demande Skyrim {need} et vous avez Skyrim {have} : elle risque de ne pas fonctionner.',
    gameFolder: 'Dossier du jeu', gameFolderHint: 'Le dossier de Skyrim, celui qui contient « Data ».',
    downloadsFolder: 'Dossier des téléchargements', downloadsHint: 'Les mods sont téléchargés ici. Gardez-les : ils resservent aux mises à jour.',
    destFolder: 'Dossier de la modlist installée', destHint: 'La modlist prête à jouer est créée ici. Vous la copiez ensuite dans Skyrim.',
    browse: 'Parcourir', paste: 'Coller', chooseFolder: 'Choisir un dossier', pastePrompt: 'Collez le chemin du dossier :',
    diskNeed: 'Espace nécessaire : environ {size}.', diskFree: 'Espace libre sur ce disque : {size}.',
    diskLow: 'Espace insuffisant : {need} nécessaires, {free} libres.',
    nexusTitle: 'Compte Nexus Mods',
    nexusNoKey: 'Sans clé, vous téléchargerez chaque mod à la main : un clic par mod sur Nexus. Avec une clé Premium, tout est automatique.',
    nexusPremium: 'Compte Premium : les mods se téléchargent tout seuls.',
    nexusFree: 'Compte gratuit : un clic par mod sur Nexus, mABBAJACK récupère ensuite le fichier.',
    nexusAdd: 'Ajouter ma clé Nexus', nexusInvalid: 'Clé invalide.', nexusOffline: 'Nexus injoignable : clé non vérifiée.',
    customize: 'Personnaliser (mods optionnels)', start: 'Lancer l’installation',
    startHint: 'Choisissez les deux dossiers pour continuer.', changeModlist: 'Changer de modlist',
    preview: 'Aperçu : cette modlist est une démonstration, elle ne peut pas être installée.',
    installTitle: 'Installation en cours', starting: 'Démarrage…', pause: 'Pause', resume: 'Reprendre', cancel: 'Annuler',
    eta: 'Temps restant : {time}', showDetails: 'Afficher les détails', hideDetails: 'Masquer les détails',
    manualDownloads: 'Téléchargements à faire à la main ({n})', paused: 'En pause',
    stageValidating: 'Préparation des dossiers', stageScanning: 'Vérification des archives',
    stageDownloading: 'Téléchargement des mods', stageExtracting: 'Installation des fichiers', stageConfig: 'Écriture de la configuration',
    doneTitleMissing: 'Installation terminée, avec des manques', doneMissing: '{n} archive(s) n’ont pas pu être téléchargées automatiquement : les mods concernés seront incomplets tant que vous ne les aurez pas ajoutées.', doneRelaunch: 'Ajoutez-les dans le dossier des téléchargements, puis relancez l’installation .', doneTitle: 'Installation terminée !', doneBody: 'La modlist « {name} » est prête.',
    doneHow: 'Pour jouer : copiez le contenu du dossier dans le dossier Data de Skyrim, puis lancez le jeu.',
    openFolder: 'Ouvrir le dossier', pluginsTxt: 'Voir plugins.txt', another: 'Installer une autre modlist',
    failTitle: 'L’installation a échoué', failHint: 'Vous pouvez corriger le problème puis relancer : ce qui est déjà téléchargé est conservé.', retry: 'Revenir à la préparation',
    modeLabel: 'Présentation de l’interface', modeSimple: 'Simple', modeExpert: 'Expert',
    modeHint: 'Simple : un parcours guidé en 4 étapes. Expert : galerie, inspecteur, installation et progression.',
  },
  en: {
    stepsLabel: 'Steps', stepChoose: 'Choose', stepPrepare: 'Prepare', stepInstall: 'Install', stepDone: 'Done',
    expertMode: 'Expert mode', settings: 'Settings',
    chooseTitle: 'Choose a modlist',
    chooseSubtitle: 'A modlist is a ready-to-play collection of mods. mABBAJACK downloads and installs it for you.',
    search: 'Search for a modlist…', loading: 'Loading the catalog…', none: 'No modlist matches.',
    hideNsfw: 'Hide adult modlists', openFile: 'Open a .wabbajack file…', onDisk: 'on disk', install: 'Install', by: 'by',
    compatible: 'Compatible with your game', needsAE: 'Needs Skyrim AE', needsSE: 'Needs Skyrim SE',
    gameLine: 'Your game: Skyrim {edition}', noGameLine: 'Skyrim was not found on this Mac.',
    prepareTitle: 'Prepare the installation', back: 'Back', yourGame: 'Your game',
    gameDetected: 'Skyrim {edition} detected.', gameNotFound: 'Skyrim was not found automatically. Choose its folder.',
    gameMismatch: 'This modlist needs Skyrim {need} and you have Skyrim {have}: it may not work.',
    gameFolder: 'Game folder', gameFolderHint: 'The Skyrim folder, the one that contains “Data”.',
    downloadsFolder: 'Downloads folder', downloadsHint: 'Mods are downloaded here. Keep them: they are reused for updates.',
    destFolder: 'Installed modlist folder', destHint: 'The ready-to-play modlist is created here. You then copy it into Skyrim.',
    browse: 'Browse', paste: 'Paste', chooseFolder: 'Choose a folder', pastePrompt: 'Paste the folder path:',
    diskNeed: 'Space needed: about {size}.', diskFree: 'Free space on this disk: {size}.',
    diskLow: 'Not enough space: {need} needed, {free} free.',
    nexusTitle: 'Nexus Mods account',
    nexusNoKey: 'Without a key you download each mod by hand: one click per mod on Nexus. With a Premium key everything is automatic.',
    nexusPremium: 'Premium account: mods download by themselves.',
    nexusFree: 'Free account: one click per mod on Nexus, then mABBAJACK picks up the file.',
    nexusAdd: 'Add my Nexus key', nexusInvalid: 'Invalid key.', nexusOffline: 'Nexus unreachable: key not verified.',
    customize: 'Customize (optional mods)', start: 'Start the installation',
    startHint: 'Choose both folders to continue.', changeModlist: 'Change modlist',
    preview: 'Preview: this modlist is a demo and cannot be installed.',
    installTitle: 'Installing', starting: 'Starting…', pause: 'Pause', resume: 'Resume', cancel: 'Cancel',
    eta: 'Time left: {time}', showDetails: 'Show details', hideDetails: 'Hide details',
    manualDownloads: 'Downloads to do by hand ({n})', paused: 'Paused',
    stageValidating: 'Preparing the folders', stageScanning: 'Checking the archives',
    stageDownloading: 'Downloading the mods', stageExtracting: 'Installing the files', stageConfig: 'Writing the configuration',
    doneTitleMissing: 'Installation complete, with gaps', doneMissing: '{n} archive(s) could not be downloaded automatically: the mods concerned will be incomplete until you add them.', doneRelaunch: 'Add them to the downloads folder, then run the installation again.', doneTitle: 'Installation complete!', doneBody: 'The modlist “{name}” is ready.',
    doneHow: 'To play: copy the contents of the folder into Skyrim’s Data folder, then launch the game.',
    openFolder: 'Open the folder', pluginsTxt: 'View plugins.txt', another: 'Install another modlist',
    failTitle: 'The installation failed', failHint: 'You can fix the problem and start again: what is already downloaded is kept.', retry: 'Back to preparation',
    modeLabel: 'Interface layout', modeSimple: 'Simple', modeExpert: 'Expert',
    modeHint: 'Simple: a guided 4-step path. Expert: gallery, inspector, installation and progress.',
  },
  es: {
    stepsLabel: 'Pasos', stepChoose: 'Elegir', stepPrepare: 'Preparar', stepInstall: 'Instalar', stepDone: 'Listo',
    expertMode: 'Modo experto', settings: 'Ajustes',
    chooseTitle: 'Elija una modlist',
    chooseSubtitle: 'Una modlist es una colección de mods lista para jugar. mABBAJACK la descarga y la instala por usted.',
    search: 'Buscar una modlist…', loading: 'Cargando el catálogo…', none: 'Ninguna modlist coincide.',
    hideNsfw: 'Ocultar modlists para adultos', openFile: 'Abrir un archivo .wabbajack…', onDisk: 'en disco', install: 'Instalar', by: 'por',
    compatible: 'Compatible con su juego', needsAE: 'Requiere Skyrim AE', needsSE: 'Requiere Skyrim SE',
    gameLine: 'Su juego: Skyrim {edition}', noGameLine: 'No se encontró Skyrim en este Mac.',
    prepareTitle: 'Preparar la instalación', back: 'Volver', yourGame: 'Su juego',
    gameDetected: 'Skyrim {edition} detectado.', gameNotFound: 'No se encontró Skyrim automáticamente. Indique su carpeta.',
    gameMismatch: 'Esta modlist requiere Skyrim {need} y usted tiene Skyrim {have}: puede que no funcione.',
    gameFolder: 'Carpeta del juego', gameFolderHint: 'La carpeta de Skyrim, la que contiene «Data».',
    downloadsFolder: 'Carpeta de descargas', downloadsHint: 'Los mods se descargan aquí. Consérvelos: se reutilizan en las actualizaciones.',
    destFolder: 'Carpeta de la modlist instalada', destHint: 'La modlist lista para jugar se crea aquí. Después la copia en Skyrim.',
    browse: 'Examinar', paste: 'Pegar', chooseFolder: 'Elegir una carpeta', pastePrompt: 'Pegue la ruta de la carpeta:',
    diskNeed: 'Espacio necesario: unos {size}.', diskFree: 'Espacio libre en este disco: {size}.',
    diskLow: 'Espacio insuficiente: {need} necesarios, {free} libres.',
    nexusTitle: 'Cuenta de Nexus Mods',
    nexusNoKey: 'Sin clave, descargará cada mod a mano: un clic por mod en Nexus. Con una clave Premium todo es automático.',
    nexusPremium: 'Cuenta Premium: los mods se descargan solos.',
    nexusFree: 'Cuenta gratuita: un clic por mod en Nexus, y mABBAJACK recoge el archivo.',
    nexusAdd: 'Añadir mi clave de Nexus', nexusInvalid: 'Clave no válida.', nexusOffline: 'Nexus inaccesible: clave sin verificar.',
    customize: 'Personalizar (mods opcionales)', start: 'Iniciar la instalación',
    startHint: 'Elija las dos carpetas para continuar.', changeModlist: 'Cambiar de modlist',
    preview: 'Vista previa: esta modlist es una demostración y no se puede instalar.',
    installTitle: 'Instalando', starting: 'Iniciando…', pause: 'Pausa', resume: 'Reanudar', cancel: 'Cancelar',
    eta: 'Tiempo restante: {time}', showDetails: 'Mostrar detalles', hideDetails: 'Ocultar detalles',
    manualDownloads: 'Descargas a hacer a mano ({n})', paused: 'En pausa',
    stageValidating: 'Preparando las carpetas', stageScanning: 'Comprobando los archivos',
    stageDownloading: 'Descargando los mods', stageExtracting: 'Instalando los archivos', stageConfig: 'Escribiendo la configuración',
    doneTitleMissing: 'Instalación terminada, con carencias', doneMissing: '{n} archivo(s) no se pudieron descargar automáticamente: los mods afectados estarán incompletos hasta que los añada.', doneRelaunch: 'Añádalos a la carpeta de descargas y vuelva a lanzar la instalación.', doneTitle: '¡Instalación terminada!', doneBody: 'La modlist «{name}» está lista.',
    doneHow: 'Para jugar: copie el contenido de la carpeta en la carpeta Data de Skyrim y abra el juego.',
    openFolder: 'Abrir la carpeta', pluginsTxt: 'Ver plugins.txt', another: 'Instalar otra modlist',
    failTitle: 'La instalación ha fallado', failHint: 'Puede corregir el problema y volver a empezar: lo ya descargado se conserva.', retry: 'Volver a la preparación',
    modeLabel: 'Presentación de la interfaz', modeSimple: 'Simple', modeExpert: 'Experto',
    modeHint: 'Simple: un recorrido guiado en 4 pasos. Experto: galería, inspector, instalación y progreso.',
  },
  it: {
    stepsLabel: 'Passaggi', stepChoose: 'Scegli', stepPrepare: 'Prepara', stepInstall: 'Installa', stepDone: 'Fatto',
    expertMode: 'Modalità esperto', settings: 'Impostazioni',
    chooseTitle: 'Scegli una modlist',
    chooseSubtitle: 'Una modlist è una raccolta di mod pronta da giocare. mABBAJACK la scarica e la installa per te.',
    search: 'Cerca una modlist…', loading: 'Caricamento del catalogo…', none: 'Nessuna modlist corrisponde.',
    hideNsfw: 'Nascondi le modlist per adulti', openFile: 'Apri un file .wabbajack…', onDisk: 'su disco', install: 'Installa', by: 'di',
    compatible: 'Compatibile con il tuo gioco', needsAE: 'Richiede Skyrim AE', needsSE: 'Richiede Skyrim SE',
    gameLine: 'Il tuo gioco: Skyrim {edition}', noGameLine: 'Skyrim non è stato trovato su questo Mac.',
    prepareTitle: 'Prepara l’installazione', back: 'Indietro', yourGame: 'Il tuo gioco',
    gameDetected: 'Skyrim {edition} rilevato.', gameNotFound: 'Skyrim non è stato trovato automaticamente. Indica la sua cartella.',
    gameMismatch: 'Questa modlist richiede Skyrim {need} e hai Skyrim {have}: potrebbe non funzionare.',
    gameFolder: 'Cartella del gioco', gameFolderHint: 'La cartella di Skyrim, quella che contiene «Data».',
    downloadsFolder: 'Cartella dei download', downloadsHint: 'Le mod vengono scaricate qui. Conservale: servono per gli aggiornamenti.',
    destFolder: 'Cartella della modlist installata', destHint: 'La modlist pronta da giocare viene creata qui. Poi la copi in Skyrim.',
    browse: 'Sfoglia', paste: 'Incolla', chooseFolder: 'Scegli una cartella', pastePrompt: 'Incolla il percorso della cartella:',
    diskNeed: 'Spazio necessario: circa {size}.', diskFree: 'Spazio libero su questo disco: {size}.',
    diskLow: 'Spazio insufficiente: {need} necessari, {free} liberi.',
    nexusTitle: 'Account Nexus Mods',
    nexusNoKey: 'Senza chiave scaricherai ogni mod a mano: un clic per mod su Nexus. Con una chiave Premium tutto è automatico.',
    nexusPremium: 'Account Premium: le mod si scaricano da sole.',
    nexusFree: 'Account gratuito: un clic per mod su Nexus, poi mABBAJACK recupera il file.',
    nexusAdd: 'Aggiungi la mia chiave Nexus', nexusInvalid: 'Chiave non valida.', nexusOffline: 'Nexus non raggiungibile: chiave non verificata.',
    customize: 'Personalizza (mod opzionali)', start: 'Avvia l’installazione',
    startHint: 'Scegli entrambe le cartelle per continuare.', changeModlist: 'Cambia modlist',
    preview: 'Anteprima: questa modlist è una dimostrazione e non può essere installata.',
    installTitle: 'Installazione in corso', starting: 'Avvio…', pause: 'Pausa', resume: 'Riprendi', cancel: 'Annulla',
    eta: 'Tempo rimanente: {time}', showDetails: 'Mostra i dettagli', hideDetails: 'Nascondi i dettagli',
    manualDownloads: 'Download da fare a mano ({n})', paused: 'In pausa',
    stageValidating: 'Preparazione delle cartelle', stageScanning: 'Verifica degli archivi',
    stageDownloading: 'Download delle mod', stageExtracting: 'Installazione dei file', stageConfig: 'Scrittura della configurazione',
    doneTitleMissing: 'Installazione completata, con lacune', doneMissing: '{n} archivio/i non sono stati scaricati automaticamente: le mod interessate saranno incomplete finché non li aggiungi.', doneRelaunch: 'Aggiungili alla cartella dei download, poi rilancia l’installazione.', doneTitle: 'Installazione completata!', doneBody: 'La modlist «{name}» è pronta.',
    doneHow: 'Per giocare: copia il contenuto della cartella nella cartella Data di Skyrim, poi avvia il gioco.',
    openFolder: 'Apri la cartella', pluginsTxt: 'Vedi plugins.txt', another: 'Installa un’altra modlist',
    failTitle: 'L’installazione non è riuscita', failHint: 'Puoi risolvere il problema e riprovare: ciò che è già stato scaricato viene conservato.', retry: 'Torna alla preparazione',
    modeLabel: 'Aspetto dell’interfaccia', modeSimple: 'Semplice', modeExpert: 'Esperto',
    modeHint: 'Semplice: un percorso guidato in 4 passi. Esperto: galleria, ispettore, installazione e avanzamento.',
  },
};

export const fillText = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
