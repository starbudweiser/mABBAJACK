/**
 * Traduction déterministe du journal des opérations.
 *
 * Le serveur et App.tsx émettent les messages en français (langue source).
 * Chaque entrée ci-dessous associe un gabarit FR à ses équivalents EN / ES / IT.
 * Les gabarits FR sont compilés en expressions régulières ancrées :
 *   - {0}, {1}… = valeurs dynamiques (chemins, nombres, noms) recopiées telles quelles
 *   - les espaces sont tolérants (1 ou plusieurs)
 *   - l'indentation de tête du message est conservée
 * La première entrée qui correspond gagne → placer les gabarits spécifiques avant les génériques.
 * Message sans correspondance → affiché tel quel (FR).
 *
 * ⚠ Maintenance : toute modification d'un texte de log côté serveur doit être reportée ici.
 */
import type { Language } from './types';

type Entry = [fr: string, en: string, es: string, it: string];

const ENTRIES: Entry[] = [
  ['📄 Fichier .wabbajack d\'origine retrouvé : {0}', '📄 Original .wabbajack file found: {0}', '📄 Archivo .wabbajack original encontrado: {0}', '📄 File .wabbajack originale trovato: {0}'],
  ['⚠ Fichier .wabbajack chargé par une copie temporaire et original introuvable : dossier dédié = {0}', '⚠ .wabbajack file loaded from a temporary copy and original not found: list folder = {0}', '⚠ Archivo .wabbajack cargado desde una copia temporal y original no encontrado: carpeta dedicada = {0}', '⚠ File .wabbajack caricato da una copia temporanea e originale non trovato: cartella dedicata = {0}'],
  ['🎮 Dossier(s) de jeu de l\'instance MO2 : {0} → racine de l\'installation.', '🎮 MO2 instance game folder(s): {0} → installation root.', '🎮 Carpeta(s) del juego de la instancia MO2: {0} → raíz de la instalación.', '🎮 Cartella/e di gioco dell\'istanza MO2: {0} → radice dell\'installazione.'],
  ['⚠ {0} fichier(s) de {1} mod(s) désactivé(s) présent(s) dans l\'installation : {2}', '⚠ {0} file(s) from {1} disabled mod(s) found in the installation: {2}', '⚠ {0} archivo(s) de {1} mod(s) desactivado(s) presente(s) en la instalación: {2}', '⚠ {0} file di {1} mod disattivata/e presente/i nell\'installazione: {2}'],
  ['→ Restes d\'une installation précédente : videz le dossier d\'installation avant de relancer (liste dans CONTROLE_INSTALLATION.txt).', '→ Leftovers from a previous installation: empty the installation folder before restarting (list in CONTROLE_INSTALLATION.txt).', '→ Restos de una instalación anterior: vacíe la carpeta de instalación antes de volver a lanzar (lista en CONTROLE_INSTALLATION.txt).', '→ Residui di un\'installazione precedente: svuota la cartella di installazione prima di riavviare (elenco in CONTROLE_INSTALLATION.txt).'],
  // ── Vérification des archives (taille + hash) et contrôle post-installation ──
  ['📂 Dossier dédié à la liste (prioritaire) : {0}', '📂 List-specific folder (takes priority): {0}', '📂 Carpeta dedicada a la lista (prioritaria): {0}', '📂 Cartella dedicata alla lista (prioritaria): {0}'],
  ['🔎 Vérification de {0} archive(s) : taille puis hash Wabbajack (mis en cache après le premier calcul)…', '🔎 Checking {0} archive(s): size then Wabbajack hash (cached after the first computation)…', '🔎 Verificando {0} archivo(s): tamaño y luego hash de Wabbajack (en caché tras el primer cálculo)…', '🔎 Verifica di {0} archivio/i: dimensione poi hash Wabbajack (in cache dopo il primo calcolo)…'],
  ['✓ Archives vérifiées : {0} correcte(s), {1} de même nom mais d\'une autre version, {2} absente(s) — {3} hash calculé(s), {4} lu(s) en cache.', '✓ Archives checked: {0} correct, {1} with the same name but another version, {2} missing — {3} hash(es) computed, {4} read from cache.', '✓ Archivos verificados: {0} correcto(s), {1} con el mismo nombre pero otra versión, {2} faltante(s) — {3} hash calculado(s), {4} leído(s) de la caché.', '✓ Archivi verificati: {0} corretto/i, {1} con lo stesso nome ma un\'altra versione, {2} mancante/i — {3} hash calcolato/i, {4} letto/i dalla cache.'],
  ['Scan : {0}/{1} archives correctes, {2} absente(s) ou incorrecte(s).', 'Scan: {0}/{1} archives correct, {2} missing or incorrect.', 'Escaneo: {0}/{1} archivos correctos, {2} faltante(s) o incorrecto(s).', 'Scansione: {0}/{1} archivi corretti, {2} mancante/i o errato/i.'],
  ['✗ Mauvaise version : {0} — {1}', '✗ Wrong version: {0} — {1}', '✗ Versión incorrecta: {0} — {1}', '✗ Versione errata: {0} — {1}'],
  ['"{0}" fait {1} au lieu de {2}', '"{0}" is {1} instead of {2}', '"{0}" ocupa {1} en lugar de {2}', '"{0}" è di {1} invece di {2}'],
  ['"{0}" a la bonne taille mais un autre contenu (hash {1} au lieu de {2})', '"{0}" has the right size but different content (hash {1} instead of {2})', '"{0}" tiene el tamaño correcto pero otro contenido (hash {1} en lugar de {2})', '"{0}" ha la dimensione giusta ma un contenuto diverso (hash {1} invece di {2})'],
  ['→ Source inconnue — copiez manuellement "{0}" dans : {1}', '→ Unknown source — manually copy "{0}" into: {1}', '→ Fuente desconocida — copie manualmente "{0}" en: {1}', '→ Fonte sconosciuta — copiare manualmente "{0}" in: {1}'],
  ['→ Enregistré dans le dossier dédié à la liste : {0}', '→ Saved in the list-specific folder: {0}', '→ Guardado en la carpeta dedicada a la lista: {0}', '→ Salvato nella cartella dedicata alla lista: {0}'],
  ['✓ Téléchargé et vérifié : {0}', '✓ Downloaded and verified: {0}', '✓ Descargado y verificado: {0}', '✓ Scaricato e verificato: {0}'],
  ['⚠ Avant déploiement : {0} archive(s) absente(s) ou incorrecte(s) — {1} fichier(s) de la modlist ne pourront pas être installés :', '⚠ Before deployment: {0} missing or incorrect archive(s) — {1} modlist file(s) cannot be installed:', '⚠ Antes del despliegue: {0} archivo(s) faltante(s) o incorrecto(s) — {1} archivo(s) de la modlist no podrán instalarse:', '⚠ Prima del deploy: {0} archivio/i mancante/i o errato/i — {1} file della modlist non potranno essere installati:'],
  ['• {0} — mauvaise version — {1} directive(s)', '• {0} — wrong version — {1} directive(s)', '• {0} — versión incorrecta — {1} directiva(s)', '• {0} — versione errata — {1} direttiva/e'],
  ['• {0} — absente — {1} directive(s)', '• {0} — missing — {1} directive(s)', '• {0} — faltante — {1} directiva(s)', '• {0} — mancante — {1} direttiva/e'],
  ['• {0} — mauvaise version : {1}', '• {0} — wrong version: {1}', '• {0} — versión incorrecta: {1}', '• {0} — versione errata: {1}'],
  ['🔍 Contrôle : {0} fichier(s) vérifié(s) — {1} absent(s) à cause d\'archives manquantes, {2} autre(s) absent(s), {3} de taille différente.', '🔍 Check: {0} file(s) verified — {1} missing because of missing archives, {2} other missing, {3} with a different size.', '🔍 Control: {0} archivo(s) verificado(s) — {1} faltante(s) por archivos ausentes, {2} otro(s) faltante(s), {3} de tamaño distinto.', '🔍 Controllo: {0} file verificato/i — {1} mancante/i per archivi assenti, {2} altro/i mancante/i, {3} di dimensione diversa.'],
  ['• {0} : {1} fichier(s) absent(s) ou différent(s)', '• {0}: {1} file(s) missing or different', '• {0}: {1} archivo(s) faltante(s) o distinto(s)', '• {0}: {1} file mancante/i o diverso/i'],
  ['… et {0} autre(s) mod(s) — détail dans CONTROLE_INSTALLATION.txt', '… and {0} other mod(s) — details in CONTROLE_INSTALLATION.txt', '… y {0} mod(s) más — detalle en CONTROLE_INSTALLATION.txt', '… e altre {0} mod — dettagli in CONTROLE_INSTALLATION.txt'],
  ['⚠ Contrôle post-installation impossible : {0}', '⚠ Post-install check failed: {0}', '⚠ Control posterior a la instalación imposible: {0}', '⚠ Controllo post-installazione impossibile: {0}'],
  ['ℹ {0} plugin(s) de mods activés par vos choix ajoutés à plugins.txt.', 'ℹ {0} plugin(s) from mods enabled by your choices added to plugins.txt.', 'ℹ {0} plugin(s) de mods activados por sus elecciones añadido(s) a plugins.txt.', 'ℹ {0} plugin di mod attivate dalle tue scelte aggiunto/i a plugins.txt.'],
  ['→ Archives de mods : téléchargez-les, placez-les sous leur nom exact dans le dossier dédié à la liste {0} (prioritaire sur le cache commun), puis relancez le déploiement.', '→ Mod archives: download them, place them under their exact name in the list-specific folder {0} (takes priority over the shared cache), then restart the deployment.', '→ Archivos de mods: descárguelos, colóquelos con su nombre exacto en la carpeta dedicada a la lista {0} (prioritaria sobre la caché común) y vuelva a lanzar el despliegue.', '→ Archivi di mod: scaricali, mettili con il nome esatto nella cartella dedicata alla lista {0} (prioritaria sulla cache comune), poi riavvia il deploy.'],
  ['Vérification des archives', 'Checking archives', 'Verificación de archivos', 'Verifica degli archivi'],
  ['Vérification de {0} archive(s)…', 'Checking {0} archive(s)…', 'Verificando {0} archivo(s)…', 'Verifica di {0} archivio/i…'],
  ['Contrôle de l\'installation', 'Installation check', 'Control de la instalación', 'Controllo dell\'installazione'],
  ['Contrôle des fichiers installés…', 'Checking installed files…', 'Comprobando los archivos instalados…', 'Controllo dei file installati…'],
  ['Contrôle des fichiers installés : {0}/{1}', 'Checking installed files: {0}/{1}', 'Comprobando los archivos instalados: {0}/{1}', 'Controllo dei file installati: {0}/{1}'],
  ['Directive {0}/{1} — {2}', 'Directive {0}/{1} — {2}', 'Directiva {0}/{1} — {2}', 'Direttiva {0}/{1} — {2}'],
  ['Aucune installation en cours.', 'No installation in progress.', 'Ninguna instalación en curso.', 'Nessuna installazione in corso.'],
  ['Installation suspendue.', 'Installation paused.', 'Instalación en pausa.', 'Installazione sospesa.'],
  ['Reprise…', 'Resuming…', 'Reanudando…', 'Ripresa…'],
  ['Une installation est déjà en cours.', 'An installation is already in progress.', 'Ya hay una instalación en curso.', 'Un\'installazione è già in corso.'],
  ['Langue non prise en charge.', 'Language not supported.', 'Idioma no compatible.', 'Lingua non supportata.'],
  // ── App (client) ───────────────────────────────────────────────────────────
  ['mABBAJACK Initialisé - Moteur macOS prêt', 'mABBAJACK initialized - macOS engine ready', 'mABBAJACK inicializado - Motor macOS listo', 'mABBAJACK inizializzato - Motore macOS pronto'],
  ['Récupération du catalogue Wabbajack…', 'Fetching Wabbajack catalog…', 'Obteniendo el catálogo de Wabbajack…', 'Recupero del catalogo Wabbajack…'],
  ['{0} modlists chargés depuis le serveur local.', '{0} modlists loaded from the local server.', '{0} modlists cargadas desde el servidor local.', '{0} modlist caricate dal server locale.'],
  ['Serveur local indisponible — agrégation directe depuis GitHub…', 'Local server unavailable — aggregating directly from GitHub…', 'Servidor local no disponible — agregando directamente desde GitHub…', 'Server locale non disponibile — aggregazione diretta da GitHub…'],
  ['{0} modlists agrégés depuis GitHub ({1} dépôts).', '{0} modlists aggregated from GitHub ({1} repositories).', '{0} modlists agregadas desde GitHub ({1} repositorios).', '{0} modlist aggregate da GitHub ({1} repository).'],
  ['GitHub inaccessible : {0}', 'GitHub unreachable: {0}', 'GitHub inaccesible: {0}', 'GitHub irraggiungibile: {0}'],
  ['Catalogue partiel : {0} modlists officielles seulement.', 'Partial catalog: {0} official modlists only.', 'Catálogo parcial: solo {0} modlists oficiales.', 'Catalogo parziale: solo {0} modlist ufficiali.'],
  ['Impossible de charger le catalogue. Vérifiez votre connexion internet.', 'Unable to load the catalog. Check your internet connection.', 'No se pudo cargar el catálogo. Compruebe su conexión a internet.', 'Impossibile caricare il catalogo. Verificare la connessione internet.'],
  ['Validation de la clé API Nexus Mods / Vortex...', 'Validating Nexus Mods / Vortex API key...', 'Validando la clave API de Nexus Mods / Vortex...', 'Verifica della chiave API Nexus Mods / Vortex...'],
  ['Compte Nexus vérifié : {0} ({1})', 'Nexus account verified: {0} ({1})', 'Cuenta Nexus verificada: {0} ({1})', 'Account Nexus verificato: {0} ({1})'],
  ['Compte Nexus validé : {0} ({1})', 'Nexus account validated: {0} ({1})', 'Cuenta Nexus validada: {0} ({1})', 'Account Nexus convalidato: {0} ({1})'],
  ['Clé API Nexus invalide.', 'Invalid Nexus API key.', 'Clave API de Nexus no válida.', 'Chiave API Nexus non valida.'],
  ['Nexus injoignable : clé non vérifiée.', 'Nexus unreachable: key not verified.', 'Nexus inaccesible: clave no verificada.', 'Nexus irraggiungibile: chiave non verificata.'],
  ['Nexus injoignable', 'Nexus unreachable', 'Nexus inaccesible', 'Nexus irraggiungibile'],
  ['Inspection directe de : {0}...', 'Direct inspection of: {0}...', 'Inspección directa de: {0}...', 'Ispezione diretta di: {0}...'],
  ['Modlist "{0}" analysé : {1} archives, {2} plugins.', 'Modlist "{0}" analyzed: {1} archives, {2} plugins.', 'Modlist "{0}" analizada: {1} archivos, {2} plugins.', 'Modlist "{0}" analizzata: {1} archivi, {2} plugin.'],
  ['Modlist "{0}" analysé : {1} archives.', 'Modlist "{0}" analyzed: {1} archives.', 'Modlist "{0}" analizada: {1} archivos.', 'Modlist "{0}" analizzata: {1} archivi.'],
  ['Erreur dialogue natif : {0}', 'Native dialog error: {0}', 'Error del diálogo nativo: {0}', 'Errore finestra di dialogo nativa: {0}'],
  ['Envoi au serveur pour analyse : {0} ({1} Mo)...', 'Sending to server for analysis: {0} ({1} MB)...', 'Enviando al servidor para análisis: {0} ({1} MB)...', 'Invio al server per l\'analisi: {0} ({1} MB)...'],
  ['Fichier réel : {0}', 'Actual file: {0}', 'Archivo real: {0}', 'File effettivo: {0}'],
  ['Erreur lors de l\'analyse du fichier .wabbajack : {0}', 'Error while analyzing the .wabbajack file: {0}', 'Error al analizar el archivo .wabbajack: {0}', 'Errore durante l\'analisi del file .wabbajack: {0}'],
  ['Modlist Démo "{0}" chargé avec succès.', 'Demo modlist "{0}" loaded successfully.', 'Modlist de demostración "{0}" cargada correctamente.', 'Modlist demo "{0}" caricata con successo.'],
  ['🔄 Scan DOWNLOADS : {0}...', '🔄 Scanning DOWNLOADS: {0}...', '🔄 Escaneando DOWNLOADS: {0}...', '🔄 Scansione DOWNLOADS: {0}...'],
  ['✓ {0}/{1} archives détectées dans DOWNLOADS.', '✓ {0}/{1} archives detected in DOWNLOADS.', '✓ {0}/{1} archivos detectados en DOWNLOADS.', '✓ {0}/{1} archivi rilevati in DOWNLOADS.'],
  ['⚠ Aucune archive trouvée dans {0}. Vérifiez le chemin.', '⚠ No archive found in {0}. Check the path.', '⚠ No se encontró ningún archivo en {0}. Compruebe la ruta.', '⚠ Nessun archivio trovato in {0}. Verificare il percorso.'],
  ['⚠ {0} fichier(s) original(aux) du jeu introuvable(s) : {1}', '⚠ {0} original game file(s) not found: {1}', '⚠ {0} archivo(s) original(es) del juego no encontrado(s): {1}', '⚠ {0} file originale/i del gioco non trovato/i: {1}'],
  ['→ Renseignez « Dossier du jeu Skyrim » (dossier contenant Data/).', '→ Fill in "Skyrim game folder" (the folder containing Data/).', '→ Indique «Carpeta del juego Skyrim» (la carpeta que contiene Data/).', '→ Compilare «Cartella del gioco Skyrim» (la cartella che contiene Data/).'],
  ['Scan impossible (serveur HTTP {0}).', 'Scan failed (server HTTP {0}).', 'Escaneo imposible (servidor HTTP {0}).', 'Scansione impossibile (server HTTP {0}).'],
  ['Scan impossible : {0}', 'Scan failed: {0}', 'Escaneo imposible: {0}', 'Scansione impossibile: {0}'],
  ['Démarrage de l\'installation Ready to Play pour "{0}"...', 'Starting Ready to Play installation for "{0}"...', 'Iniciando la instalación Ready to Play de "{0}"...', 'Avvio dell\'installazione Ready to Play per "{0}"...'],
  ['Installation initiée côté serveur avec succès.', 'Installation successfully started on the server.', 'Instalación iniciada correctamente en el servidor.', 'Installazione avviata con successo sul server.'],
  ['Serveur HTTP {0} : {1}', 'Server HTTP {0}: {1}', 'Servidor HTTP {0}: {1}', 'Server HTTP {0}: {1}'],
  ['Erreur réseau : {0}', 'Network error: {0}', 'Error de red: {0}', 'Errore di rete: {0}'],
  ['📋 "{0}" sélectionné depuis la galerie — configurez les chemins puis lancez le déploiement.', '📋 "{0}" selected from the gallery — set the paths, then start the deployment.', '📋 "{0}" seleccionada desde la galería — configure las rutas y luego inicie el despliegue.', '📋 "{0}" selezionata dalla galleria — configurare i percorsi, poi avviare il deployment.'],
  ['🔗 Fichier .wabbajack sera téléchargé depuis : {0}', '🔗 The .wabbajack file will be downloaded from: {0}', '🔗 El archivo .wabbajack se descargará desde: {0}', '🔗 Il file .wabbajack verrà scaricato da: {0}'],
  ['"{0}" : aucune URL CDN disponible — glissez le fichier .wabbajack manuellement.', '"{0}": no CDN URL available — drop the .wabbajack file manually.', '"{0}": ninguna URL CDN disponible — arrastre el archivo .wabbajack manualmente.', '"{0}": nessun URL CDN disponibile — trascinare manualmente il file .wabbajack.'],
  ['Fichier non reconnu : "{0}". Seuls les fichiers .wabbajack sont acceptés.', 'Unrecognized file: "{0}". Only .wabbajack files are accepted.', 'Archivo no reconocido: "{0}". Solo se aceptan archivos .wabbajack.', 'File non riconosciuto: "{0}". Sono accettati solo file .wabbajack.'],
  ['Installation mise en pause.', 'Installation paused.', 'Instalación en pausa.', 'Installazione in pausa.'],
  ['Installation reprise.', 'Installation resumed.', 'Instalación reanudada.', 'Installazione ripresa.'],
  ['Installation annulée par l’utilisateur.', 'Installation cancelled by the user.', 'Instalación cancelada por el usuario.', 'Installazione annullata dall\'utente.'],

  // ── Serveur : en-tête d'installation ──────────────────────────────────────
  ['mABBAJACK v3 — Moteur de directives Wabbajack', 'mABBAJACK v3 — Wabbajack directive engine', 'mABBAJACK v3 — Motor de directivas Wabbajack', 'mABBAJACK v3 — Motore di direttive Wabbajack'],
  ['Modlist : "{0}" v{1}', 'Modlist: "{0}" v{1}', 'Modlist: "{0}" v{1}', 'Modlist: "{0}" v{1}'],
  ['Dossier : {0}', 'Folder: {0}', 'Carpeta: {0}', 'Cartella: {0}'],
  ['📂 Sous-dossier : {0}', '📂 Subfolder: {0}', '📂 Subcarpeta: {0}', '📂 Sottocartella: {0}'],
  ['📥 DOWNLOADS : {0}', '📥 DOWNLOADS: {0}', '📥 DOWNLOADS: {0}', '📥 DOWNLOADS: {0}'],
  ['📂 Organisation Vortex détectée : les téléchargements sont enregistrés dans "{0}" ({1}).', '📂 Vortex layout detected: downloads are saved in "{0}" ({1}).', '📂 Estructura Vortex detectada: las descargas se guardan en "{0}" ({1}).', '📂 Struttura Vortex rilevata: i download vengono salvati in "{0}" ({1}).'],
  ['🚀 READY TO PLAY : {0}', '🚀 READY TO PLAY: {0}', '🚀 READY TO PLAY: {0}', '🚀 READY TO PLAY: {0}'],
  ['✓ DOWNLOADS : "{0}"', '✓ DOWNLOADS: "{0}"', '✓ DOWNLOADS: "{0}"', '✓ DOWNLOADS: "{0}"'],
  ['⬇ {0} ({1} Mo)', '⬇ {0} ({1} MB)', '⬇ {0} ({1} MB)', '⬇ {0} ({1} MB)'],
  ['🎮 Cible : {0} ({1})', '🎮 Target: {0} ({1})', '🎮 Objetivo: {0} ({1})', '🎮 Destinazione: {0} ({1})'],
  ['⚠ DOWNLOADS inaccessible : {0}', '⚠ DOWNLOADS not accessible: {0}', '⚠ DOWNLOADS inaccesible: {0}', '⚠ DOWNLOADS non accessibile: {0}'],
  ['✓ Répertoire d\'installation créé : "{0}"', '✓ Installation folder created: "{0}"', '✓ Carpeta de instalación creada: "{0}"', '✓ Cartella di installazione creata: "{0}"'],
  ['⚠ READY TO PLAY contient déjà {0} entrée(s) — les fichiers existants seront écrasés ou coexisteront.', '⚠ READY TO PLAY already contains {0} item(s) — existing files will be overwritten or kept alongside.', '⚠ READY TO PLAY ya contiene {0} elemento(s) — los archivos existentes se sobrescribirán o coexistirán.', '⚠ READY TO PLAY contiene già {0} elemento/i — i file esistenti verranno sovrascritti o coesisteranno.'],
  ['→ Si vous observez un dossier trop volumineux, videz READY TO PLAY manuellement avant relancer.', '→ If the folder grows too large, empty READY TO PLAY manually before restarting.', '→ Si la carpeta crece demasiado, vacíe READY TO PLAY manualmente antes de relanzar.', '→ Se la cartella diventa troppo grande, svuotare manualmente READY TO PLAY prima di riavviare.'],
  ['✓ 7zz disponible : {0}', '✓ 7zz available: {0}', '✓ 7zz disponible: {0}', '✓ 7zz disponibile: {0}'],
  ['⚠ 7zz introuvable — extraction impossible. Installez via : brew install sevenzip', '⚠ 7zz not found — extraction impossible. Install with: brew install sevenzip', '⚠ 7zz no encontrado — extracción imposible. Instálelo con: brew install sevenzip', '⚠ 7zz non trovato — estrazione impossibile. Installare con: brew install sevenzip'],
  ['✓ unar disponible (fallback RAR5) : {0}', '✓ unar available (RAR5 fallback): {0}', '✓ unar disponible (alternativa RAR5): {0}', '✓ unar disponibile (fallback RAR5): {0}'],

  // ── Serveur : scan / fichiers du jeu / téléchargements ────────────────────
  ['✓ Fichier du jeu trouvé : {0}', '✓ Game file found: {0}', '✓ Archivo del juego encontrado: {0}', '✓ File del gioco trovato: {0}'],
  ['⚠ Taille différente de l\'original (version du jeu ≠ {0}) — utilisé quand même.', '⚠ Size differs from the original (game version ≠ {0}) — used anyway.', '⚠ Tamaño distinto del original (versión del juego ≠ {0}) — se usa de todos modos.', '⚠ Dimensione diversa dall\'originale (versione del gioco ≠ {0}) — usato comunque.'],
  ['🎮 Fichiers originaux du jeu : {0}/{1} identifiés — copie directe, aucune décompression.', '🎮 Original game files: {0}/{1} identified — direct copy, no decompression.', '🎮 Archivos originales del juego: {0}/{1} identificados — copia directa, sin descompresión.', '🎮 File originali del gioco: {0}/{1} identificati — copia diretta, nessuna decompressione.'],
  ['🎮 Fichiers originaux du jeu : {0}/{1} identifiés dans {2}', '🎮 Original game files: {0}/{1} identified in {2}', '🎮 Archivos originales del juego: {0}/{1} identificados en {2}', '🎮 File originali del gioco: {0}/{1} identificati in {2}'],
  ['🎮 Fichiers originaux du jeu : {0}/{1} identifiés', '🎮 Original game files: {0}/{1} identified', '🎮 Archivos originales del juego: {0}/{1} identificados', '🎮 File originali del gioco: {0}/{1} identificati'],
  ['🎮 {0}/{1} fichiers originaux du jeu identifiés dans {2} — copiés tels quels, sans décompression.', '🎮 {0}/{1} original game files identified in {2} — copied as-is, without decompression.', '🎮 {0}/{1} archivos originales del juego identificados en {2} — copiados tal cual, sin descompresión.', '🎮 {0}/{1} file originali del gioco identificati in {2} — copiati così come sono, senza decompressione.'],
  ['ℹ {0} fichier(s) du jeu diffèrent de la version {1} (ex. masters déjà nettoyés) — contrôlés via les patchs du manifeste.', 'ℹ {0} game file(s) differ from version {1} (e.g. already-cleaned masters) — checked against the manifest patches.', 'ℹ {0} archivo(s) del juego difieren de la versión {1} (p. ej. masters ya limpiados) — verificados con los parches del manifiesto.', 'ℹ {0} file del gioco differiscono dalla versione {1} (es. master già puliti) — verificati tramite le patch del manifest.'],
  ['⚠ Copie impossible : {0} → {1} — {2}', '⚠ Copy failed: {0} → {1} — {2}', '⚠ Copia imposible: {0} → {1} — {2}', '⚠ Copia impossibile: {0} → {1} — {2}'],
  ['⚠ {0} est un fichier du jeu, pas une archive — {1} chemin(s) interne(s) ignoré(s)', '⚠ {0} is a game file, not an archive — {1} internal path(s) skipped', '⚠ {0} es un archivo del juego, no un archivo comprimido — {1} ruta(s) interna(s) omitida(s)', '⚠ {0} è un file del gioco, non un archivio — {1} percorso/i interno/i ignorato/i'],
  ['🎮 {0} fichier(s) original(aux) du jeu copié(s) directement (sans décompression).', '🎮 {0} original game file(s) copied directly (no decompression).', '🎮 {0} archivo(s) original(es) del juego copiado(s) directamente (sin descompresión).', '🎮 {0} file originale/i del gioco copiato/i direttamente (senza decompressione).'],
  ['📄 {0} fichier(s) copié(s) tel(s) quel(s) depuis DOWNLOADS (téléchargement direct, sans archive).', '📄 {0} file(s) copied as-is from DOWNLOADS (direct download, no archive).', '📄 {0} archivo(s) copiado(s) tal cual desde DOWNLOADS (descarga directa, sin archivo comprimido).', '📄 {0} file copiato/i così com\'è da DOWNLOADS (download diretto, senza archivio).'],
  ['🔧 Patchs OctoDiff : {0} appliqué(s), {1} déjà à jour, {2} non applicable(s).', '🔧 OctoDiff patches: {0} applied, {1} already up to date, {2} not applicable.', '🔧 Parches OctoDiff: {0} aplicado(s), {1} ya actualizado(s), {2} no aplicable(s).', '🔧 Patch OctoDiff: {0} applicata/e, {1} già aggiornata/e, {2} non applicabile/i.'],
  ['⚠ Version du fichier de base différente — fichier conservé sans patch : {0}', '⚠ Different base file version — file kept unpatched: {0}', '⚠ Versión distinta del archivo base — archivo conservado sin parche: {0}', '⚠ Versione del file di base diversa — file mantenuto senza patch: {0}'],
  ['⚠ {0} patch(s) absent(s) du .wabbajack — fichier de base conservé.', '⚠ {0} patch(es) missing from the .wabbajack — base file kept.', '⚠ {0} parche(s) ausente(s) del .wabbajack — archivo base conservado.', '⚠ {0} patch mancante/i nel .wabbajack — file di base mantenuto.'],
  ['🖼 {0} texture(s) transformée(s) : texconv introuvable, texture source copiée telle quelle (non redimensionnée / recompressée).', '🖼 {0} transformed texture(s): texconv not found, source texture copied as-is (not resized / recompressed).', '🖼 {0} textura(s) transformada(s): texconv no encontrado, textura de origen copiada tal cual (sin redimensionar / recomprimir).', '🖼 {0} texture trasformata/e: texconv non trovato, texture sorgente copiata così com\'è (non ridimensionata / ricompressa).'],
  ['✓ texconv disponible (textures transformées) : {0}', '✓ texconv available (transformed textures): {0}', '✓ texconv disponible (texturas transformadas): {0}', '✓ texconv disponibile (texture trasformate): {0}'],
  // ── Mise à jour d'une liste installée ──
  ['🔄 Mode mise à jour : seuls les fichiers nouveaux ou modifiés seront installés, les fichiers retirés de la liste seront supprimés.', '🔄 Update mode: only new or changed files will be installed, files removed from the list will be deleted.', '🔄 Modo actualización: solo se instalarán los archivos nuevos o modificados, los archivos retirados de la lista se eliminarán.', '🔄 Modalità aggiornamento: verranno installati solo i file nuovi o modificati, i file rimossi dalla lista verranno eliminati.'],
  ['⚠ Mise à jour impossible sans fichier .wabbajack local : installation complète.', '⚠ Update impossible without a local .wabbajack file: full installation.', '⚠ Actualización imposible sin archivo .wabbajack local: instalación completa.', '⚠ Aggiornamento impossibile senza file .wabbajack locale: installazione completa.'],
  ['⚠ Comparaison avec l\'installation existante impossible : {0} — installation complète.', '⚠ Comparison with the existing installation failed: {0} — full installation.', '⚠ Comparación con la instalación existente imposible: {0} — instalación completa.', '⚠ Confronto con l\'installazione esistente impossibile: {0} — installazione completa.'],
  ['⏭ Mise à jour : {0} archive(s) inutile(s) (fichiers inchangés) — ni vérifiées ni téléchargées.', '⏭ Update: {0} unneeded archive(s) (unchanged files) — neither checked nor downloaded.', '⏭ Actualización: {0} archivo(s) innecesario(s) (archivos sin cambios) — ni verificados ni descargados.', '⏭ Aggiornamento: {0} archivio/i non necessario/i (file invariati) — né verificati né scaricati.'],
  ['🗑 {0} fichier(s) retiré(s) de la liste supprimé(s).', '🗑 {0} file(s) removed from the list deleted.', '🗑 {0} archivo(s) retirado(s) de la lista eliminado(s).', '🗑 {0} file rimosso/i dalla lista eliminato/i.'],
  ['🔄 Mise à jour : {0} directive(s) à traiter, {1} fichier(s) inchangé(s) conservé(s).', '🔄 Update: {0} directive(s) to process, {1} unchanged file(s) kept.', '🔄 Actualización: {0} directiva(s) por procesar, {1} archivo(s) sin cambios conservado(s).', '🔄 Aggiornamento: {0} direttiva/e da elaborare, {1} file invariato/i conservato/i.'],
  ['✓ Aucun fichier à mettre à jour : l\'installation est déjà à jour.', '✓ No file to update: the installation is already up to date.', '✓ Ningún archivo por actualizar: la instalación ya está al día.', '✓ Nessun file da aggiornare: l\'installazione è già aggiornata.'],
  ['✓ État de l\'installation enregistré ({0} fichier(s)) : base des prochaines mises à jour.', '✓ Installation state saved ({0} file(s)): baseline for future updates.', '✓ Estado de la instalación guardado ({0} archivo(s)): base de las próximas actualizaciones.', '✓ Stato dell\'installazione salvato ({0} file): base dei prossimi aggiornamenti.'],
  ['⚠ État de l\'installation non enregistré : {0}', '⚠ Installation state not saved: {0}', '⚠ Estado de la instalación no guardado: {0}', '⚠ Stato dell\'installazione non salvato: {0}'],
  ['🔄 Base de comparaison : état enregistré de l\'installation (v{0}, {1} fichier(s)).', '🔄 Comparison baseline: saved installation state (v{0}, {1} file(s)).', '🔄 Base de comparación: estado guardado de la instalación (v{0}, {1} archivo(s)).', '🔄 Base di confronto: stato salvato dell\'installazione (v{0}, {1} file).'],
  ['🔄 Base de comparaison : version précédente {0}.', '🔄 Comparison baseline: previous version {0}.', '🔄 Base de comparación: versión anterior {0}.', '🔄 Base di confronto: versione precedente {0}.'],
  ['🔄 Aucune version précédente connue : comparaison avec les fichiers présents (taille, puis hash Wabbajack). Cette première comparaison peut être longue.', '🔄 No known previous version: comparing with the files present (size, then Wabbajack hash). This first comparison can be slow.', '🔄 Ninguna versión anterior conocida: comparación con los archivos presentes (tamaño y luego hash de Wabbajack). Esta primera comparación puede ser lenta.', '🔄 Nessuna versione precedente nota: confronto con i file presenti (dimensione, poi hash Wabbajack). Questo primo confronto può essere lento.'],
  ['🔄 Comparaison : {0} fichier(s) absent(s) à installer, {1} modifié(s), {2} inchangé(s), {3} à supprimer.', '🔄 Comparison: {0} missing file(s) to install, {1} changed, {2} unchanged, {3} to delete.', '🔄 Comparación: {0} archivo(s) ausente(s) por instalar, {1} modificado(s), {2} sin cambios, {3} por eliminar.', '🔄 Confronto: {0} file mancante/i da installare, {1} modificato/i, {2} invariato/i, {3} da eliminare.'],
  ['→ {0} fichier(s) vérifié(s) par hash.', '→ {0} file(s) checked by hash.', '→ {0} archivo(s) verificado(s) por hash.', '→ {0} file verificato/i tramite hash.'],
  ['⚠ texconv introuvable — les textures transformées seront copiées sans conversion.', '⚠ texconv not found — transformed textures will be copied without conversion.', '⚠ texconv no encontrado — las texturas transformadas se copiarán sin conversión.', '⚠ texconv non trovato — le texture trasformate saranno copiate senza conversione.'],
  ['🖼 {0} texture(s) TransformedTexture déjà au bon format — copiées telles quelles.', '🖼 {0} TransformedTexture texture(s) already in the right format — copied as-is.', '🖼 {0} textura(s) TransformedTexture ya en el formato correcto — copiadas tal cual.', '🖼 {0} texture TransformedTexture già nel formato corretto — copiate così come sono.'],
  ['🖼 Conversion de {0} texture(s) (TransformedTexture, {1} format(s) cible(s)) avec texconv…', '🖼 Converting {0} texture(s) (TransformedTexture, {1} target format(s)) with texconv…', '🖼 Convirtiendo {0} textura(s) (TransformedTexture, {1} formato(s) de destino) con texconv…', '🖼 Conversione di {0} texture (TransformedTexture, {1} formato/i di destinazione) con texconv…'],
  ['🖼 Textures : {0}/{1} ({2} %)', '🖼 Textures: {0}/{1} ({2} %)', '🖼 Texturas: {0}/{1} ({2} %)', '🖼 Texture: {0}/{1} ({2} %)'],
  ['✓ {0}/{1} texture(s) convertie(s) en {2} s.', '✓ {0}/{1} texture(s) converted in {2} s.', '✓ {0}/{1} textura(s) convertida(s) en {2} s.', '✓ {0}/{1} texture convertita/e in {2} s.'],
  ['⚠ {0} texture(s) non convertie(s) — source copiée telle quelle : {1}', '⚠ {0} texture(s) not converted — source copied as-is: {1}', '⚠ {0} textura(s) no convertida(s) — origen copiado tal cual: {1}', '⚠ {0} texture non convertita/e — sorgente copiata così com\'è: {1}'],
  ['⚠ {0} texture(s) convertie(s) d\'une taille différente du manifeste : {1}', '⚠ {0} converted texture(s) with a size different from the manifest: {1}', '⚠ {0} textura(s) convertida(s) con un tamaño distinto del manifiesto: {1}', '⚠ {0} texture convertita/e con una dimensione diversa dal manifesto: {1}'],
  ['📝 {0} fichier(s) de configuration adapté(s) à cette machine (chemins remplacés).', '📝 {0} configuration file(s) adapted to this machine (paths replaced).', '📝 {0} archivo(s) de configuración adaptado(s) a este equipo (rutas reemplazadas).', '📝 {0} file di configurazione adattato/i a questa macchina (percorsi sostituiti).'],
  ['⚠ {0} chemin(s) non résolu(s) dans les fichiers de configuration (dossier jeu / téléchargements non renseigné).', '⚠ {0} unresolved path(s) in configuration files (game / downloads folder not set).', '⚠ {0} ruta(s) sin resolver en archivos de configuración (carpeta del juego / descargas no indicada).', '⚠ {0} percorso/i non risolto/i nei file di configurazione (cartella gioco / download non indicata).'],
  ['🎛 Options : {0} mod(s) optionnel(s) ignoré(s), {1} activé(s) — profil « {2} ».', '🎛 Options: {0} optional mod(s) skipped, {1} enabled — profile "{2}".', '🎛 Opciones: {0} mod(s) opcional(es) omitido(s), {1} activado(s) — perfil «{2}».', '🎛 Opzioni: {0} mod opzionale/i ignorato/i, {1} attivato/i — profilo «{2}».'],
  ['⏭ {0} archive(s) réservée(s) aux mods optionnels ignorées (non téléchargées).', '⏭ {0} archive(s) reserved for optional mods skipped (not downloaded).', '⏭ {0} archivo(s) reservado(s) a mods opcionales omitido(s) (no descargados).', '⏭ {0} archivio/i riservato/i a mod opzionali ignorato/i (non scaricato/i).'],
  ['⚠ Options non appliquées : {0}', '⚠ Options not applied: {0}', '⚠ Opciones no aplicadas: {0}', '⚠ Opzioni non applicate: {0}'],
  ['💾 Espace requis ≈ {0} (téléchargements {1} + installation {2}) — libre : {3}.', '💾 Space required ≈ {0} (downloads {1} + installation {2}) — free: {3}.', '💾 Espacio necesario ≈ {0} (descargas {1} + instalación {2}) — libre: {3}.', '💾 Spazio richiesto ≈ {0} (download {1} + installazione {2}) — libero: {3}.'],
  ['⚠ Espace disque limite : il manque ≈ {0} sur {1}.', '⚠ Disk space tight: short by ≈ {0} out of {1}.', '⚠ Espacio en disco justo: faltan ≈ {0} de {1}.', '⚠ Spazio su disco al limite: mancano ≈ {0} su {1}.'],
  ['❌ Espace disque insuffisant : il manque ≈ {0} sur {1}.', '❌ Not enough disk space: short by ≈ {0} out of {1}.', '❌ Espacio en disco insuficiente: faltan ≈ {0} de {1}.', '❌ Spazio su disco insufficiente: mancano ≈ {0} su {1}.'],
  ['⚖ Priorités MO2 : {0} fichier(s) en conflit résolus (le mod le plus prioritaire l\'emporte).', '⚖ MO2 priorities: {0} conflicting file(s) resolved (the highest-priority mod wins).', '⚖ Prioridades MO2: {0} archivo(s) en conflicto resuelto(s) (gana el mod de mayor prioridad).', '⚖ Priorità MO2: {0} file in conflitto risolto/i (vince il mod con priorità maggiore).'],
  ['ℹ {0} plugin(s) de mods ignorés retirés de plugins.txt.', 'ℹ {0} plugin(s) from skipped mods removed from plugins.txt.', 'ℹ {0} plugin(s) de mods omitidos eliminado(s) de plugins.txt.', 'ℹ {0} plugin di mod ignorati rimosso/i da plugins.txt.'],
  ['📝 modlist.txt écrit ({0} mod(s) actifs).', '📝 modlist.txt written ({0} active mod(s)).', '📝 modlist.txt escrito ({0} mod(s) activo(s)).', '📝 modlist.txt scritto ({0} mod attivo/i).'],
  ['Scan : {0}/{1} archives présentes, {2} manquantes.', 'Scan: {0}/{1} archives present, {2} missing.', 'Escaneo: {0}/{1} archivos presentes, {2} faltantes.', 'Scansione: {0}/{1} archivi presenti, {2} mancanti.'],
  ['✗ Manquant : {0} — fichier original du jeu (attendu : {1})', '✗ Missing: {0} — original game file (expected at: {1})', '✗ Falta: {0} — archivo original del juego (esperado en: {1})', '✗ Mancante: {0} — file originale del gioco (atteso in: {1})'],
  ['✗ Manquant : {0} — archive de mod', '✗ Missing: {0} — mod archive', '✗ Falta: {0} — archivo de mod', '✗ Mancante: {0} — archivio di mod'],
  ['→ Nexus Standard : téléchargement manuel requis', '→ Nexus Standard: manual download required', '→ Nexus Standard: descarga manual necesaria', '→ Nexus Standard: download manuale richiesto'],
  ['⚠ Nexus Standard : téléchargement manuel requis', '⚠ Nexus Standard: manual download required', '⚠ Nexus Standard: descarga manual necesaria', '⚠ Nexus Standard: download manuale richiesto'],
  ['→ Manuel : {0}', '→ Manual: {0}', '→ Manual: {0}', '→ Manuale: {0}'],
  ['→ Copiez manuellement "{0}" dans : {1}', '→ Manually copy "{0}" into: {1}', '→ Copie manualmente "{0}" en: {1}', '→ Copiare manualmente "{0}" in: {1}'],
  ['→ Copiez "{0}" dans : {1}', '→ Copy "{0}" into: {1}', '→ Copie "{0}" en: {1}', '→ Copiare "{0}" in: {1}'],
  ['→ Source inconnue — copiez manuellement dans DOWNLOADS', '→ Unknown source — copy it manually into DOWNLOADS', '→ Fuente desconocida — cópielo manualmente en DOWNLOADS', '→ Fonte sconosciuta — copiarlo manualmente in DOWNLOADS'],
  ['✓ Téléchargé : {0}', '✓ Downloaded: {0}', '✓ Descargado: {0}', '✓ Scaricato: {0}'],
  ['✗ Échec téléchargement GitHub : {0}', '✗ GitHub download failed: {0}', '✗ Error de descarga de GitHub: {0}', '✗ Download da GitHub non riuscito: {0}'],
  ['✗ Échec téléchargement Nexus : {0}', '✗ Nexus download failed: {0}', '✗ Error de descarga de Nexus: {0}', '✗ Download da Nexus non riuscito: {0}'],
  ['✗ Échec : {0}', '✗ Failed: {0}', '✗ Error: {0}', '✗ Non riuscito: {0}'],
  ['{0} — Connexion interrompue', '{0} — Connection interrupted', '{0} — Conexión interrumpida', '{0} — Connessione interrotta'],
  ['{0} — Délai dépassé', '{0} — Timed out', '{0} — Tiempo de espera agotado', '{0} — Tempo scaduto'],
  ['{0} — Téléchargement incomplet ({1} octets)', '{0} — Incomplete download ({1} bytes)', '{0} — Descarga incompleta ({1} bytes)', '{0} — Download incompleto ({1} byte)'],
  ['⬇ {0} — {1} / {2} Mo (+{3} en cours)', '⬇ {0} — {1} / {2} MB (+{3} in progress)', '⬇ {0} — {1} / {2} MB (+{3} en curso)', '⬇ {0} — {1} / {2} MB (+{3} in corso)'],
  ['⬇ {0} — {1} / {2} Mo', '⬇ {0} — {1} / {2} MB', '⬇ {0} — {1} / {2} MB', '⬇ {0} — {1} / {2} MB'],
  ['Origine refusée', 'Origin refused', 'Origen rechazado', 'Origine rifiutata'],
  ['Connexion interrompue', 'Connection interrupted', 'Conexión interrumpida', 'Connessione interrotta'],
  ['Délai dépassé', 'Timed out', 'Tiempo de espera agotado', 'Tempo scaduto'],
  ['Téléchargement incomplet ({0} octets)', 'Incomplete download ({0} bytes)', 'Descarga incompleta ({0} bytes)', 'Download incompleto ({0} byte)'],
  ['Échec : {0}', 'Failed: {0}', 'Error: {0}', 'Non riuscito: {0}'],
  ['✓ {0} archive(s) téléchargée(s).', '✓ {0} archive(s) downloaded.', '✓ {0} archivo(s) descargado(s).', '✓ {0} archivio/i scaricato/i.'],

  // ── Serveur : acquisition du .wabbajack ───────────────────────────────────
  ['PHASE PRINCIPALE : Déploiement des directives', 'MAIN PHASE: Deploying directives', 'FASE PRINCIPAL: Despliegue de directivas', 'FASE PRINCIPALE: Deployment delle direttive'],
  ['Chaque fichier est extrait précisément selon', 'Each file is extracted exactly according to', 'Cada archivo se extrae exactamente según', 'Ogni file viene estratto esattamente secondo'],
  ['les choix FOMOD pré-enregistrés par l\'auteur.', 'the FOMOD choices pre-recorded by the author.', 'las elecciones FOMOD pregrabadas por el autor.', 'le scelte FOMOD preregistrate dall\'autore.'],
  ['🔍 Recherche releases GitHub : {0}…', '🔍 Searching GitHub releases: {0}…', '🔍 Buscando releases de GitHub: {0}…', '🔍 Ricerca release GitHub: {0}…'],
  ['⚠ GitHub API inaccessible : {0}', '⚠ GitHub API unreachable: {0}', '⚠ API de GitHub inaccesible: {0}', '⚠ API GitHub irraggiungibile: {0}'],
  ['⚠ GitHub API : {0}', '⚠ GitHub API: {0}', '⚠ API de GitHub: {0}', '⚠ API GitHub: {0}'],
  ['✓ Version exacte trouvée : {0} ({1} Mo) — Release {2}', '✓ Exact version found: {0} ({1} MB) — Release {2}', '✓ Versión exacta encontrada: {0} ({1} MB) — Release {2}', '✓ Versione esatta trovata: {0} ({1} MB) — Release {2}'],
  ['⚠ Version {0} introuvable sur GitHub — tentative Nexus Mods…', '⚠ Version {0} not found on GitHub — trying Nexus Mods…', '⚠ Versión {0} no encontrada en GitHub — probando Nexus Mods…', '⚠ Versione {0} non trovata su GitHub — tentativo su Nexus Mods…'],
  ['⚠ GitHub fallback : release {0} disponible (pas la v{1}).', '⚠ GitHub fallback: release {0} available (not v{1}).', '⚠ Alternativa GitHub: release {0} disponible (no la v{1}).', '⚠ Fallback GitHub: release {0} disponibile (non la v{1}).'],
  ['⚠ Aucun asset .wabbajack dans les releases de {0}', '⚠ No .wabbajack asset in the releases of {0}', '⚠ Ningún asset .wabbajack en las releases de {0}', '⚠ Nessun asset .wabbajack nelle release di {0}'],
  ['⚠ Nexus : clé API manquante — impossible de chercher le .wabbajack', '⚠ Nexus: API key missing — cannot search for the .wabbajack', '⚠ Nexus: falta la clave API — imposible buscar el .wabbajack', '⚠ Nexus: chiave API mancante — impossibile cercare il .wabbajack'],
  ['🔍 Recherche .wabbajack sur Nexus Mods : {0}…', '🔍 Searching .wabbajack on Nexus Mods: {0}…', '🔍 Buscando .wabbajack en Nexus Mods: {0}…', '🔍 Ricerca .wabbajack su Nexus Mods: {0}…'],
  ['⚠ Aucun fichier .wabbajack trouvé sur Nexus mods/{0}', '⚠ No .wabbajack file found on Nexus mods/{0}', '⚠ No se encontró ningún archivo .wabbajack en Nexus mods/{0}', '⚠ Nessun file .wabbajack trovato su Nexus mods/{0}'],
  ['✓ Trouvé sur Nexus : {0} ({1}) — file_id={2}', '✓ Found on Nexus: {0} ({1}) — file_id={2}', '✓ Encontrado en Nexus: {0} ({1}) — file_id={2}', '✓ Trovato su Nexus: {0} ({1}) — file_id={2}'],
  ['✓ URL directe Nexus obtenue (Premium)', '✓ Direct Nexus URL obtained (Premium)', '✓ URL directa de Nexus obtenida (Premium)', '✓ URL diretto Nexus ottenuto (Premium)'],
  ['⚠ Nexus API inaccessible : {0}', '⚠ Nexus API unreachable: {0}', '⚠ API de Nexus inaccesible: {0}', '⚠ API Nexus irraggiungibile: {0}'],
  ['📁 Fichier .wabbajack local : {0}', '📁 Local .wabbajack file: {0}', '📁 Archivo .wabbajack local: {0}', '📁 File .wabbajack locale: {0}'],
  ['⚠ L\'URL CDN Wabbajack est une page web (non téléchargeable directement).', '⚠ The Wabbajack CDN URL is a web page (not directly downloadable).', '⚠ La URL CDN de Wabbajack es una página web (no descargable directamente).', '⚠ L\'URL CDN Wabbajack è una pagina web (non scaricabile direttamente).'],
  ['→ [1/3] Tentative via GitHub Releases…', '→ [1/3] Trying GitHub Releases…', '→ [1/3] Probando GitHub Releases…', '→ [1/3] Tentativo tramite GitHub Releases…'],
  ['⬇ Téléchargement depuis GitHub (version exacte) : {0}', '⬇ Downloading from GitHub (exact version): {0}', '⬇ Descargando desde GitHub (versión exacta): {0}', '⬇ Download da GitHub (versione esatta): {0}'],
  ['✓ .wabbajack téléchargé depuis GitHub : {0}', '✓ .wabbajack downloaded from GitHub: {0}', '✓ .wabbajack descargado desde GitHub: {0}', '✓ .wabbajack scaricato da GitHub: {0}'],
  ['→ [2/3] Tentative via Nexus Mods…', '→ [2/3] Trying Nexus Mods…', '→ [2/3] Probando Nexus Mods…', '→ [2/3] Tentativo tramite Nexus Mods…'],
  ['⬇ Téléchargement depuis Nexus : {0}', '⬇ Downloading from Nexus: {0}', '⬇ Descargando desde Nexus: {0}', '⬇ Download da Nexus: {0}'],
  ['✓ .wabbajack téléchargé depuis Nexus : {0}', '✓ .wabbajack downloaded from Nexus: {0}', '✓ .wabbajack descargado desde Nexus: {0}', '✓ .wabbajack scaricato da Nexus: {0}'],
  ['⚠ Compte Nexus Standard — URL de téléchargement manuel : {0}', '⚠ Nexus Standard account — manual download URL: {0}', '⚠ Cuenta Nexus Standard — URL de descarga manual: {0}', '⚠ Account Nexus Standard — URL di download manuale: {0}'],
  ['→ [3/3] Utilisation de la version GitHub inexacte en dernier recours…', '→ [3/3] Using the inexact GitHub version as a last resort…', '→ [3/3] Usando la versión inexacta de GitHub como último recurso…', '→ [3/3] Uso della versione GitHub non esatta come ultima risorsa…'],
  ['⚠ ATTENTION : version {0} introuvable — utilisation d\'une version antérieure.', '⚠ WARNING: version {0} not found — using an earlier version.', '⚠ ATENCIÓN: versión {0} no encontrada — se usa una versión anterior.', '⚠ ATTENZIONE: versione {0} non trovata — uso di una versione precedente.'],
  ['⚠ Les directives peuvent ne pas correspondre à vos archives téléchargées.', '⚠ Directives may not match your downloaded archives.', '⚠ Las directivas pueden no coincidir con sus archivos descargados.', '⚠ Le direttive potrebbero non corrispondere agli archivi scaricati.'],
  ['✓ .wabbajack (version inexacte) téléchargé : {0}', '✓ .wabbajack (inexact version) downloaded: {0}', '✓ .wabbajack (versión inexacta) descargado: {0}', '✓ .wabbajack (versione non esatta) scaricato: {0}'],
  ['⚠ Téléchargement automatique impossible.', '⚠ Automatic download impossible.', '⚠ Descarga automática imposible.', '⚠ Download automatico impossibile.'],
  ['┌─ ACTION REQUISE {0}', '┌─ ACTION REQUIRED {0}', '┌─ ACCIÓN NECESARIA {0}', '┌─ AZIONE RICHIESTA {0}'],
  ['│ Option A — Nexus Mods (onglet Files) :', '│ Option A — Nexus Mods (Files tab):', '│ Opción A — Nexus Mods (pestaña Files):', '│ Opzione A — Nexus Mods (scheda Files):'],
  ['│ Option {0} — CDN Wabbajack (connexion requise) :', '│ Option {0} — Wabbajack CDN (login required):', '│ Opción {0} — CDN de Wabbajack (inicio de sesión necesario):', '│ Opzione {0} — CDN Wabbajack (accesso richiesto):'],
  ['│ 1. Téléchargez le fichier .wabbajack', '│ 1. Download the .wabbajack file', '│ 1. Descargue el archivo .wabbajack', '│ 1. Scaricare il file .wabbajack'],
  ['│ 2. Chargez-le via 📁 Ouvrir (Inspecteur mABBAJACK)', '│ 2. Load it via 📁 Open (mABBAJACK Inspector)', '│ 2. Cárguelo mediante 📁 Abrir (Inspector de mABBAJACK)', '│ 2. Caricarlo tramite 📁 Apri (Ispettore mABBAJACK)'],
  ['│ 3. Relancez l\'installation', '│ 3. Restart the installation', '│ 3. Relance la instalación', '│ 3. Riavviare l\'installazione'],
  ['→ Installation continue sans directives (plugins.txt seulement).', '→ Installation continues without directives (plugins.txt only).', '→ La instalación continúa sin directivas (solo plugins.txt).', '→ L\'installazione prosegue senza direttive (solo plugins.txt).'],
  ['⚠ L\'URL retourne du HTML, pas un fichier .wabbajack : {0}', '⚠ The URL returns HTML, not a .wabbajack file: {0}', '⚠ La URL devuelve HTML, no un archivo .wabbajack: {0}', '⚠ L\'URL restituisce HTML, non un file .wabbajack: {0}'],
  ['⬇ Téléchargement direct .wabbajack…', '⬇ Direct .wabbajack download…', '⬇ Descarga directa del .wabbajack…', '⬇ Download diretto del .wabbajack…'],
  ['✓ .wabbajack téléchargé : {0}', '✓ .wabbajack downloaded: {0}', '✓ .wabbajack descargado: {0}', '✓ .wabbajack scaricato: {0}'],
  ['✗ Erreur téléchargement .wabbajack : {0}', '✗ .wabbajack download error: {0}', '✗ Error de descarga del .wabbajack: {0}', '✗ Errore di download del .wabbajack: {0}'],
  ['📁 Lecture du fichier .wabbajack : {0}', '📁 Reading .wabbajack file: {0}', '📁 Leyendo el archivo .wabbajack: {0}', '📁 Lettura del file .wabbajack: {0}'],
  ['✓ .wabbajack chargé ({0} entrées)', '✓ .wabbajack loaded ({0} entries)', '✓ .wabbajack cargado ({0} entradas)', '✓ .wabbajack caricato ({0} voci)'],
  ['📋 Directives parsées : {0} directives, {1} archives', '📋 Directives parsed: {0} directives, {1} archives', '📋 Directivas analizadas: {0} directivas, {1} archivos', '📋 Direttive analizzate: {0} direttive, {1} archivi'],
  ['⚠ Impossible de parser modlist depuis zip : {0}', '⚠ Unable to parse modlist from zip: {0}', '⚠ No se pudo analizar la modlist desde el zip: {0}', '⚠ Impossibile analizzare la modlist dallo zip: {0}'],
  ['⚠ Impossible de charger le .wabbajack : {0}', '⚠ Unable to load the .wabbajack: {0}', '⚠ No se pudo cargar el .wabbajack: {0}', '⚠ Impossibile caricare il .wabbajack: {0}'],
  ['Taille : {0} Ko — probablement pas un ZIP valide.', 'Size: {0} KB — probably not a valid ZIP.', 'Tamaño: {0} KB — probablemente no es un ZIP válido.', 'Dimensione: {0} KB — probabilmente non è uno ZIP valido.'],
  ['⚠ Aucune référence .wabbajack — les directives InlineFile seront ignorées.', '⚠ No .wabbajack reference — InlineFile directives will be skipped.', '⚠ Ninguna referencia .wabbajack — las directivas InlineFile se ignorarán.', '⚠ Nessun riferimento .wabbajack — le direttive InlineFile verranno ignorate.'],
  ['Chargez le .wabbajack via le bouton 📁 dans l\'Inspecteur.', 'Load the .wabbajack with the 📁 button in the Inspector.', 'Cargue el .wabbajack con el botón 📁 del Inspector.', 'Caricare il .wabbajack con il pulsante 📁 nell\'Ispettore.'],
  ['🔄 Reconstruction de la liste des archives depuis le .wabbajack…', '🔄 Rebuilding the archive list from the .wabbajack…', '🔄 Reconstruyendo la lista de archivos desde el .wabbajack…', '🔄 Ricostruzione dell\'elenco degli archivi dal .wabbajack…'],
  ['→ {0} archives : {1} présentes, {2} manquantes.', '→ {0} archives: {1} present, {2} missing.', '→ {0} archivos: {1} presentes, {2} faltantes.', '→ {0} archivi: {1} presenti, {2} mancanti.'],

  // ── Serveur : moteur de directives ────────────────────────────────────────
  ['📋 Directives à traiter : {0} FromArchive, {1} InlineFile, {2} PatchedFromArchive, {3} autres', '📋 Directives to process: {0} FromArchive, {1} InlineFile, {2} PatchedFromArchive, {3} others', '📋 Directivas a procesar: {0} FromArchive, {1} InlineFile, {2} PatchedFromArchive, {3} otras', '📋 Direttive da elaborare: {0} FromArchive, {1} InlineFile, {2} PatchedFromArchive, {3} altre'],
  ['📎 Traitement des fichiers inline ({0})...', '📎 Processing inline files ({0})...', '📎 Procesando archivos inline ({0})...', '📎 Elaborazione dei file inline ({0})...'],
  ['→ {0} inline écrits, {1} ignorés', '→ {0} inline written, {1} skipped', '→ {0} inline escritos, {1} ignorados', '→ {0} inline scritti, {1} ignorati'],
  ['📦 Extraction sélective des fichiers FromArchive ({0})...', '📦 Selective extraction of FromArchive files ({0})...', '📦 Extracción selectiva de archivos FromArchive ({0})...', '📦 Estrazione selettiva dei file FromArchive ({0})...'],
  ['⚠ Archive non disponible : "{0}" — {1} fichier(s) ignoré(s)', '⚠ Archive not available: "{0}" — {1} file(s) skipped', '⚠ Archivo no disponible: "{0}" — {1} archivo(s) ignorado(s)', '⚠ Archivio non disponibile: "{0}" — {1} file ignorato/i'],
  ['⚠ BSA illisible : {0} — {1}', '⚠ Unreadable BSA: {0} — {1}', '⚠ BSA ilegible: {0} — {1}', '⚠ BSA illeggibile: {0} — {1}'],
  ['✗ {0} : 0/{1} extrait(s) — vérifiez l\'archive', '✗ {0}: 0/{1} extracted — check the archive', '✗ {0}: 0/{1} extraído(s) — compruebe el archivo', '✗ {0}: 0/{1} estratto/i — verificare l\'archivio'],
  ['✓ {0} : {1}/{2} fichier(s) extrait(s)', '✓ {0}: {1}/{2} file(s) extracted', '✓ {0}: {1}/{2} archivo(s) extraído(s)', '✓ {0}: {1}/{2} file estratto/i'],
  ['↩ Archive RAR → unar : {0}', '↩ RAR archive → unar: {0}', '↩ Archivo RAR → unar: {0}', '↩ Archivio RAR → unar: {0}'],
  ['↩ Fallback unar pour {0} (RAR5)...', '↩ unar fallback for {0} (RAR5)...', '↩ Alternativa unar para {0} (RAR5)...', '↩ Fallback unar per {0} (RAR5)...'],
  ['↩ Extraction sélective failed ({0}), tentative extraction complète…', '↩ Selective extraction failed ({0}), trying full extraction…', '↩ Falló la extracción selectiva ({0}), probando extracción completa…', '↩ Estrazione selettiva non riuscita ({0}), tentativo di estrazione completa…'],
  ['⚠ BSA: fichier introuvable après extraction: {0}', '⚠ BSA: file not found after extraction: {0}', '⚠ BSA: archivo no encontrado tras la extracción: {0}', '⚠ BSA: file non trovato dopo l\'estrazione: {0}'],
  ['⚠ BSA extract: {0}', '⚠ BSA extract: {0}', '⚠ Extracción BSA: {0}', '⚠ Estrazione BSA: {0}'],
  ['⚠ BSA introuvable dans tmpDir: {0}', '⚠ BSA not found in tmpDir: {0}', '⚠ BSA no encontrado en tmpDir: {0}', '⚠ BSA non trovato in tmpDir: {0}'],
  ['⚠ Erreur batch {0} : {1}', '⚠ Batch error {0}: {1}', '⚠ Error de lote {0}: {1}', '⚠ Errore batch {0}: {1}'],
  ['🔧 Directives PatchedFromArchive : {0} fichier(s)...', '🔧 PatchedFromArchive directives: {0} file(s)...', '🔧 Directivas PatchedFromArchive: {0} archivo(s)...', '🔧 Direttive PatchedFromArchive: {0} file...'],
  ['⚡ {0} : base extraite (patch OctoDiff non appliqué — fichier fonctionnel)', '⚡ {0}: base extracted (OctoDiff patch not applied — file usable)', '⚡ {0}: base extraída (parche OctoDiff no aplicado — archivo funcional)', '⚡ {0}: base estratta (patch OctoDiff non applicata — file funzionante)'],
  ['⚠ {0} fichier(s) patchés ignorés (archive manquante ou source inconnue)', '⚠ {0} patched file(s) skipped (missing archive or unknown source)', '⚠ {0} archivo(s) parcheado(s) ignorado(s) (archivo faltante o fuente desconocida)', '⚠ {0} file patchato/i ignorato/i (archivio mancante o fonte sconosciuta)'],
  ['ℹ Les patches OctoDiff sont des modifications mineures (ini, configs). L\'installation reste jouable.', 'ℹ OctoDiff patches are minor changes (ini, configs). The installation remains playable.', 'ℹ Los parches OctoDiff son cambios menores (ini, configs). La instalación sigue siendo jugable.', 'ℹ Le patch OctoDiff sono modifiche minori (ini, config). L\'installazione resta giocabile.'],
  ['✓ {0} fichier(s) patchés traités (base extraite)', '✓ {0} patched file(s) processed (base extracted)', '✓ {0} archivo(s) parcheado(s) procesado(s) (base extraída)', '✓ {0} file patchato/i elaborato/i (base estratta)'],
  ['✓ BSA créé : {0} ({1} fichiers)', '✓ BSA created: {0} ({1} files)', '✓ BSA creado: {0} ({1} archivos)', '✓ BSA creato: {0} ({1} file)'],
  ['⚠ BSA {0} : {1} fichier(s) manquant(s) ignoré(s)', '⚠ BSA {0}: {1} missing file(s) skipped', '⚠ BSA {0}: {1} archivo(s) faltante(s) omitido(s)', '⚠ BSA {0}: {1} file mancante/i ignorato/i'],
  ['⚠ CreateBSA échoué ({0} : {1})', '⚠ CreateBSA failed ({0}: {1})', '⚠ CreateBSA falló ({0}: {1})', '⚠ CreateBSA non riuscito ({0}: {1})'],
  ['🧹 Nettoyage post-installation...', '🧹 Post-installation cleanup...', '🧹 Limpieza posinstalación...', '🧹 Pulizia post-installazione...'],
  ['✓ {0} fichier(s) .modgroups supprimés (métadonnées MO2)', '✓ {0} .modgroups file(s) removed (MO2 metadata)', '✓ {0} archivo(s) .modgroups eliminado(s) (metadatos MO2)', '✓ {0} file .modgroups rimosso/i (metadati MO2)'],
  ['✓ Aucun fichier .modgroups à nettoyer', '✓ No .modgroups file to clean', '✓ Ningún archivo .modgroups que limpiar', '✓ Nessun file .modgroups da pulire'],
  ['⚠ Erreur nettoyage .modgroups : {0}', '⚠ .modgroups cleanup error: {0}', '⚠ Error al limpiar .modgroups: {0}', '⚠ Errore di pulizia .modgroups: {0}'],
  ['Catalogue : {0} modlists — SE:{1} AE:{2} VR:{3} Autres:{4}', 'Catalog: {0} modlists — SE:{1} AE:{2} VR:{3} Other:{4}', 'Catálogo: {0} modlists — SE:{1} AE:{2} VR:{3} Otras:{4}', 'Catalogo: {0} modlist — SE:{1} AE:{2} VR:{3} Altre:{4}'],

  // ── Serveur : fin d'installation & rapport ────────────────────────────────
  ['✓ Directives : {0} traitée(s), {1} ignorée(s), {2} erreur(s).', '✓ Directives: {0} processed, {1} skipped, {2} error(s).', '✓ Directivas: {0} procesada(s), {1} ignorada(s), {2} error(es).', '✓ Direttive: {0} elaborata/e, {1} ignorata/e, {2} errore/i.'],
  ['⚠ Aucune directive — installation plugins.txt seulement.', '⚠ No directive — plugins.txt-only installation.', '⚠ Ninguna directiva — instalación solo de plugins.txt.', '⚠ Nessuna direttiva — installazione solo plugins.txt.'],
  ['📄 plugins.txt récupéré depuis les directives inline.', '📄 plugins.txt retrieved from inline directives.', '📄 plugins.txt recuperado de las directivas inline.', '📄 plugins.txt recuperato dalle direttive inline.'],
  ['✓ plugins.txt ({0} plugins) écrit.', '✓ plugins.txt ({0} plugins) written.', '✓ plugins.txt ({0} plugins) escrito.', '✓ plugins.txt ({0} plugin) scritto.'],
  ['✓ loadorder.txt et README créés.', '✓ loadorder.txt and README created.', '✓ loadorder.txt y README creados.', '✓ loadorder.txt e README creati.'],
  ['✓ Fichier de version créé : {0}', '✓ Version file created: {0}', '✓ Archivo de versión creado: {0}', '✓ File di versione creato: {0}'],
  ['⚠ Fichier de version non créé : {0}', '⚠ Version file not created: {0}', '⚠ Archivo de versión no creado: {0}', '⚠ File di versione non creato: {0}'],
  ['🎉 Déploiement terminé — "{0}"', '🎉 Deployment complete — "{0}"', '🎉 Despliegue terminado — "{0}"', '🎉 Deployment completato — "{0}"'],
  ['⚠ {0} fichier(s) source introuvable(s) — {1} fichier(s) de la modlist n\'ont pas été installés :', '⚠ {0} source file(s) not found — {1} modlist file(s) were not installed:', '⚠ {0} archivo(s) fuente no encontrado(s) — {1} archivo(s) de la modlist no se instalaron:', '⚠ {0} file sorgente non trovato/i — {1} file della modlist non sono stati installati:'],
  ['• {0} — fichier original du jeu ({1})', '• {0} — original game file ({1})', '• {0} — archivo original del juego ({1})', '• {0} — file originale del gioco ({1})'],
  ['• {0} — fichier original du jeu', '• {0} — original game file', '• {0} — archivo original del juego', '• {0} — file originale del gioco'],
  ['• {0} — archive de mod', '• {0} — mod archive', '• {0} — archivo de mod', '• {0} — archivio di mod'],
  ['Emplacement attendu : {0}', 'Expected location: {0}', 'Ubicación esperada: {0}', 'Posizione attesa: {0}'],
  ['Téléchargement : source inconnue', 'Download: unknown source', 'Descarga: fuente desconocida', 'Download: fonte sconosciuta'],
  ['Téléchargement : {0}', 'Download: {0}', 'Descarga: {0}', 'Download: {0}'],
  ['Impact : aucun fichier de la modlist n\'en dépend', 'Impact: no modlist file depends on it', 'Impacto: ningún archivo de la modlist depende de él', 'Impatto: nessun file della modlist ne dipende'],
  ['Impact : {0} fichier(s) manquant(s) dans {1}', 'Impact: {0} file(s) missing in {1}', 'Impacto: {0} archivo(s) faltante(s) en {1}', 'Impatto: {0} file mancante/i in {1}'],
  ['ℹ Conséquence : le jeu démarrera, mais les mods listés ci-dessus seront incomplets.', 'ℹ Consequence: the game will start, but the mods listed above will be incomplete.', 'ℹ Consecuencia: el juego arrancará, pero los mods indicados arriba estarán incompletos.', 'ℹ Conseguenza: il gioco si avvierà, ma le mod elencate sopra saranno incomplete.'],
  ['→ Fichiers du jeu : indiquez le dossier du jeu (celui qui contient Data/) dans « Dossier du jeu Skyrim », puis relancez le déploiement.', '→ Game files: set the game folder (the one containing Data/) in "Skyrim game folder", then restart the deployment.', '→ Archivos del juego: indique la carpeta del juego (la que contiene Data/) en «Carpeta del juego Skyrim» y relance el despliegue.', '→ File del gioco: indicare la cartella del gioco (quella che contiene Data/) in «Cartella del gioco Skyrim», poi riavviare il deployment.'],
  ['→ Archives de mods : téléchargez-les, placez-les dans {0} sous leur nom exact, puis relancez le déploiement.', '→ Mod archives: download them, place them in {0} under their exact name, then restart the deployment.', '→ Archivos de mods: descárguelos, colóquelos en {0} con su nombre exacto y relance el despliegue.', '→ Archivi di mod: scaricarli, metterli in {0} con il nome esatto, poi riavviare il deployment.'],
  ['⛔ Installation annulée.', '⛔ Installation cancelled.', '⛔ Instalación cancelada.', '⛔ Installazione annullata.'],
  ['⛔ Annulé.', '⛔ Cancelled.', '⛔ Cancelado.', '⛔ Annullato.'],
  ['⏸ Installation suspendue.', '⏸ Installation paused.', '⏸ Instalación suspendida.', '⏸ Installazione sospesa.'],
  ['▶ Installation reprise.', '▶ Installation resumed.', '▶ Instalación reanudada.', '▶ Installazione ripresa.'],
  ['Pause impossible : {0}', 'Cannot pause: {0}', 'No se puede pausar: {0}', 'Impossibile sospendere: {0}'],
  ['Reprise impossible : {0}', 'Cannot resume: {0}', 'No se puede reanudar: {0}', 'Impossibile riprendere: {0}'],
  ['Annulation impossible : {0}', 'Cannot cancel: {0}', 'No se puede cancelar: {0}', 'Impossibile annullare: {0}'],

  // ── Progression (stageName / currentTask) ─────────────────────────────────
  ['En attente', 'Waiting', 'En espera', 'In attesa'],
  ['Prêt', 'Ready', 'Listo', 'Pronto'],
  ['Initialisation', 'Initialization', 'Inicialización', 'Inizializzazione'],
  ['Vérification des répertoires...', 'Checking folders...', 'Comprobando carpetas...', 'Verifica delle cartelle...'],
  ['Création des répertoires', 'Creating folders', 'Creando carpetas', 'Creazione delle cartelle'],
  ['Création DOWNLOADS et READY TO PLAY...', 'Creating DOWNLOADS and READY TO PLAY...', 'Creando DOWNLOADS y READY TO PLAY...', 'Creazione di DOWNLOADS e READY TO PLAY...'],
  ['Scan DOWNLOADS', 'Scanning DOWNLOADS', 'Escaneo de DOWNLOADS', 'Scansione DOWNLOADS'],
  ['Inventaire des archives...', 'Taking inventory of archives...', 'Inventario de archivos...', 'Inventario degli archivi...'],
  ['Téléchargements', 'Downloads', 'Descargas', 'Download'],
  ['{0} archive(s) à télécharger...', '{0} archive(s) to download...', '{0} archivo(s) por descargar...', '{0} archivio/i da scaricare...'],
  ['Déploiement des directives (extraction sélective)', 'Deploying directives (selective extraction)', 'Despliegue de directivas (extracción selectiva)', 'Deployment delle direttive (estrazione selettiva)'],
  ['Traitement de {0} directive(s) Wabbajack…', 'Processing {0} Wabbajack directive(s)…', 'Procesando {0} directiva(s) de Wabbajack…', 'Elaborazione di {0} direttiva/e Wabbajack…'],
  ['Directive {0}/{1} — {2}', 'Directive {0}/{1} — {2}', 'Directiva {0}/{1} — {2}', 'Direttiva {0}/{1} — {2}'],
  ['📦 [{0}] {1} — {2} fichier(s)', '📦 [{0}] {1} — {2} file(s)', '📦 [{0}] {1} — {2} archivo(s)', '📦 [{0}] {1} — {2} file'],
  ['📁 [{0}] {1} — {2} fichiers', '📁 [{0}] {1} — {2} files', '📁 [{0}] {1} — {2} archivos', '📁 [{0}] {1} — {2} file'],
  ['🖼 Conversion des textures : {0}/{1}', '🖼 Converting textures: {0}/{1}', '🖼 Convirtiendo texturas: {0}/{1}', '🖼 Conversione delle texture: {0}/{1}'],
  ['⚙️ [{0}] Décompression : {1}', '⚙️ [{0}] Decompressing: {1}', '⚙️ [{0}] Descomprimiendo: {1}', '⚙️ [{0}] Decompressione: {1}'],
  ['Génération plugins.txt', 'Generating plugins.txt', 'Generando plugins.txt', 'Generazione di plugins.txt'],
  ['Écriture des fichiers de configuration Skyrim...', 'Writing Skyrim configuration files...', 'Escribiendo los archivos de configuración de Skyrim...', 'Scrittura dei file di configurazione di Skyrim...'],
  ['Déploiement terminé !', 'Deployment complete!', '¡Despliegue terminado!', 'Deployment completato!'],
  ['✅ "{0}" prêt dans "{1}"', '✅ "{0}" ready in "{1}"', '✅ "{0}" listo en "{1}"', '✅ "{0}" pronto in "{1}"'],
  ['Annulé.', 'Cancelled.', 'Cancelado.', 'Annullato.'],
  ['Annulé', 'Cancelled', 'Cancelado', 'Annullato'],
  ['Erreur d\'installation', 'Installation error', 'Error de instalación', 'Errore di installazione'],
  ['Prêt pour l’installation', 'Ready for installation', 'Listo para la instalación', 'Pronto per l\'installazione'],
  ['Préparation du fichier .wabbajack…', 'Preparing the .wabbajack file…', 'Preparando el archivo .wabbajack…', 'Preparazione del file .wabbajack…'],
  ['Téléchargement .wabbajack depuis GitHub (version exacte)…', 'Downloading .wabbajack from GitHub (exact version)…', 'Descargando .wabbajack desde GitHub (versión exacta)…', 'Download del .wabbajack da GitHub (versione esatta)…'],
  ['Téléchargement .wabbajack depuis Nexus Mods…', 'Downloading .wabbajack from Nexus Mods…', 'Descargando .wabbajack desde Nexus Mods…', 'Download del .wabbajack da Nexus Mods…'],
  ['⬇ {0} (version inexacte) — {1} Mo', '⬇ {0} (inexact version) — {1} MB', '⬇ {0} (versión inexacta) — {1} MB', '⬇ {0} (versione inesatta) — {1} MB'],
  ['⬇️ Téléchargement de {0}.wabbajack…', '⬇️ Downloading {0}.wabbajack…', '⬇️ Descargando {0}.wabbajack…', '⬇️ Download di {0}.wabbajack…'],
  ['⬇️ Téléchargement {0} — {1}% ({2} Mo / {3} Mo)', '⬇️ Downloading {0} — {1}% ({2} MB / {3} MB)', '⬇️ Descargando {0} — {1}% ({2} MB / {3} MB)', '⬇️ Download {0} — {1}% ({2} MB / {3} MB)'],
  ['🔍 Analyse de {0}.wabbajack…', '🔍 Analyzing {0}.wabbajack…', '🔍 Analizando {0}.wabbajack…', '🔍 Analisi di {0}.wabbajack…'],

  // ── Erreurs API serveur / client (réponses JSON, exceptions) ──────────────────
  ['Dossier introuvable', 'Folder not found', 'Carpeta no encontrada', 'Cartella non trovata'],
  ['URL invalide', 'Invalid URL', 'URL no válida', 'URL non valido'],
  ['url manquant', 'missing url', 'falta la url', 'url mancante'],
  ['Fichier .wabbajack introuvable', '.wabbajack file not found', 'Archivo .wabbajack no encontrado', 'File .wabbajack non trovato'],
  ['Manifest introuvable dans le .wabbajack', 'Manifest not found in the .wabbajack file', 'Manifiesto no encontrado en el .wabbajack', 'Manifest non trovato nel .wabbajack'],
  ['Aucun fichier reçu.', 'No file received.', 'No se ha recibido ningún archivo.', 'Nessun file ricevuto.'],
  ['Téléchargement échoué : HTTP {0}', 'Download failed: HTTP {0}', 'Descarga fallida: HTTP {0}', 'Download non riuscito: HTTP {0}'],
  ['Catalogue GitHub inaccessible.', 'GitHub catalog unreachable.', 'Catálogo de GitHub inaccesible.', 'Catalogo GitHub irraggiungibile.'],
  ['Paramètres manquants.', 'Missing parameters.', 'Faltan parámetros.', 'Parametri mancanti.'],
  ['Impossible de lire le dossier : {0}', 'Unable to read the folder: {0}', 'No se puede leer la carpeta: {0}', 'Impossibile leggere la cartella: {0}'],
  ['Clé absente', 'Missing key', 'Falta la clave', 'Chiave mancante'],
  ['Modlist et dossier READY TO PLAY requis.', 'Modlist and READY TO PLAY folder required.', 'Se requieren la modlist y la carpeta READY TO PLAY.', 'Modlist e cartella READY TO PLAY obbligatorie.'],
  ['Erreur serveur {0}', 'Server error {0}', 'Error del servidor {0}', 'Errore del server {0}'],
  ['Réponse serveur invalide', 'Invalid server response', 'Respuesta del servidor no válida', 'Risposta del server non valida'],
  ['Connexion au serveur interrompue', 'Connection to the server interrupted', 'Conexión con el servidor interrumpida', 'Connessione al server interrotta'],
  ['Envoi annulé', 'Upload cancelled', 'Envío cancelado', 'Invio annullato'],
  ['Scan interrompu', 'Scan interrupted', 'Escaneo interrumpido', 'Scansione interrotta'],
  ['⚠ {0} archive(s) présente(s) mais de taille différente (incomplète ou autre version) : à retélécharger.', '⚠ {0} archive(s) found but with a different size (incomplete or another version): to re-download.', '⚠ {0} archivo(s) presente(s) pero de tamaño distinto (incompleto u otra versión): volver a descargar.', '⚠ {0} archivio/i presente/i ma di dimensione diversa (incompleto o altra versione): da riscaricare.'],
  ['Scan impossible', 'Scan failed', 'No se pudo escanear', 'Scansione non riuscita'],
  ['Échec : {0}', 'Failed: {0}', 'Error: {0}', 'Errore: {0}'],
];

// ── Compilation ──────────────────────────────────────────────────────────────
const LANG_INDEX: Record<Exclude<Language, 'fr'>, 1 | 2 | 3> = { en: 1, es: 2, it: 3 };

interface Compiled { re: RegExp; order: number[]; entry: Entry }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(entry: Entry): Compiled {
  const fr = entry[0];
  const order: number[] = [];
  let src = '';
  let last = 0;
  const ph = /\{(\d+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ph.exec(fr)) !== null) {
    src += escapeRe(fr.slice(last, m.index)) + '(.*?)';
    order.push(Number(m[1]));
    last = m.index + m[0].length;
  }
  src += escapeRe(fr.slice(last));
  src = src.replace(/ +/g, '\\s+'); // tolérance sur les espaces multiples
  return { re: new RegExp(`^${src}$`, 's'), order, entry };
}

const COMPILED: Compiled[] = ENTRIES.map(compile);
const cache = new Map<string, string>();

/** Traduit un message de journal (FR source) dans la langue de l'interface. */
export function translateLog(message: string | undefined | null, lang: Language, depth = 0): string {
  if (!message) return message ?? '';
  if (lang === 'fr') return message;
  const key = `${lang}\u0000${message}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const lead = message.match(/^\s*/)?.[0] ?? '';
  const body = message.slice(lead.length).trimEnd();
  let out = message;
  for (const c of COMPILED) {
    const m = c.re.exec(body);
    if (!m) continue;
    const tpl = c.entry[LANG_INDEX[lang]];
    out = lead + tpl.replace(/\{(\d+)\}/g, (_, n: string) => {
      const idx = c.order.indexOf(Number(n));
      const val = idx >= 0 ? (m[idx + 1] ?? '') : '';
      // Valeur insérée elle-même traduisible (ex. message d'erreur serveur) — profondeur limitée
      return depth < 2 && /[A-Za-zÀ-ÿ]{3,}\s/.test(val) ? translateLog(val, lang, depth + 1) : val;
    });
    break;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

// ── Libellés de l'écran de progression ───────────────────────────────────────
export const PROGRESS_UI: Record<Language, {
  all: string; warnings: string; errors: string; waitingOps: string; files: string; data: string;
  copied: string; editRetry: string; edit: string; interruptedAt: string; diskError: string;
  commonFixes: string; fixVolume: string; fixVolumeDesc: string; fixNtfs: string; fixNtfsDesc: string;
  fixPerms: string; fixPermsDesc: string; processing: string;
}> = {
  fr: {
    all: 'Tous', warnings: 'Avertissements', errors: 'Erreurs', waitingOps: 'En attente d\'opérations…',
    files: 'Fichiers', data: 'Données', copied: '✓ Copié', editRetry: 'Modifier & Réessayer', edit: 'Modifier',
    interruptedAt: 'Déploiement interrompu à', diskError: 'Échec lors de l\'accès au disque.',
    commonFixes: 'Solutions courantes :', fixVolume: 'Volume non monté', fixVolumeDesc: 'vérifiez que le disque est visible dans le Finder.',
    fixNtfs: 'NTFS en lecture seule', fixNtfsDesc: 'reformatez en APFS ou ExFAT.',
    fixPerms: 'Permissions macOS', fixPermsDesc: 'Réglages Système › Confidentialité › Accès complet au disque.',
    processing: 'Traitement en cours…',
  },
  en: {
    all: 'All', warnings: 'Warnings', errors: 'Errors', waitingOps: 'Waiting for operations…',
    files: 'Files', data: 'Data', copied: '✓ Copied', editRetry: 'Edit & Retry', edit: 'Edit',
    interruptedAt: 'Deployment interrupted at', diskError: 'Disk access failure.',
    commonFixes: 'Common fixes:', fixVolume: 'Volume not mounted', fixVolumeDesc: 'make sure the disk is visible in Finder.',
    fixNtfs: 'Read-only NTFS', fixNtfsDesc: 'reformat as APFS or ExFAT.',
    fixPerms: 'macOS permissions', fixPermsDesc: 'System Settings › Privacy › Full Disk Access.',
    processing: 'Processing…',
  },
  es: {
    all: 'Todos', warnings: 'Avisos', errors: 'Errores', waitingOps: 'Esperando operaciones…',
    files: 'Archivos', data: 'Datos', copied: '✓ Copiado', editRetry: 'Modificar y reintentar', edit: 'Modificar',
    interruptedAt: 'Despliegue interrumpido al', diskError: 'Error al acceder al disco.',
    commonFixes: 'Soluciones habituales:', fixVolume: 'Volumen no montado', fixVolumeDesc: 'compruebe que el disco aparece en el Finder.',
    fixNtfs: 'NTFS de solo lectura', fixNtfsDesc: 'formatee en APFS o ExFAT.',
    fixPerms: 'Permisos de macOS', fixPermsDesc: 'Ajustes del Sistema › Privacidad › Acceso total al disco.',
    processing: 'Procesando…',
  },
  it: {
    all: 'Tutti', warnings: 'Avvisi', errors: 'Errori', waitingOps: 'In attesa di operazioni…',
    files: 'File', data: 'Dati', copied: '✓ Copiato', editRetry: 'Modifica e riprova', edit: 'Modifica',
    interruptedAt: 'Deployment interrotto al', diskError: 'Errore di accesso al disco.',
    commonFixes: 'Soluzioni comuni:', fixVolume: 'Volume non montato', fixVolumeDesc: 'verificare che il disco sia visibile nel Finder.',
    fixNtfs: 'NTFS in sola lettura', fixNtfsDesc: 'riformattare in APFS o ExFAT.',
    fixPerms: 'Permessi macOS', fixPermsDesc: 'Impostazioni di Sistema › Privacy › Accesso completo al disco.',
    processing: 'Elaborazione in corso…',
  },
};
