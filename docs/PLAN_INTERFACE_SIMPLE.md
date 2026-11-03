# Plan : interface Simple / Expert

État au 03/11/2026. L'interface actuelle (Galerie, Inspecteur, Installation, Progression) devient le mode **Expert**,
inchangé. Le mode **Simple** est un parcours guidé en 4 écrans pour le joueur qui veut seulement installer une modlist et jouer.

## Constat (interface actuelle)

- Quatre onglets que l'utilisateur doit enchaîner lui-même, dans le bon ordre, sans que l'appli le guide.
- La galerie ne permet pas d'installer : il faut télécharger le .wabbajack ailleurs, puis l'ouvrir dans l'Inspecteur.
  Le serveur sait pourtant déjà le faire : `POST /api/wabbajack/install-from-url` télécharge et analyse le fichier, mais aucun écran ne s'en sert.
- Trois dossiers à choisir (DOWNLOADS, READY TO PLAY, jeu), dont deux en double dans les Paramètres.
- Vocabulaire technique visible partout : directives, octodiff, inlined, hash, staging, xxHash64.
- La progression est surtout un journal brut.

## Parcours Simple

1. **Choisir.** Galerie réduite : Skyrim et Enderal, l'édition du jeu installé est détectée (`/api/system/detect-skyrim`) et sert de filtre,
   sans barre de tags ni options NSFW (masqué par défaut). Grandes cartes avec : nom, image, taille sur disque, et un badge
   « Compatible avec votre jeu » ou « Demande Skyrim AE ». Un bouton **Installer** télécharge le .wabbajack (install-from-url).
2. **Préparer.** Un seul écran :
   - le jeu, détecté, et modifiable seulement en cas d'échec de la détection ;
   - les deux dossiers DOWNLOADS et READY TO PLAY, côte à côte, avec une phrase sur le rôle de chacun ;
   - l'espace disque nécessaire comparé à l'espace libre (`diskspace.js`) ;
   - la clé Nexus, qui n'apparaît que si elle manque, avec son effet expliqué : Premium = automatique, gratuit = un clic par archive ;
   - les mods optionnels avec les choix par défaut de la modlist, repliés derrière « Personnaliser ».
   Un seul bouton : **Lancer l'installation**.
3. **Installer.** Grande barre de progression, une phrase sur l'étape en cours (« Téléchargement des mods : 312 / 704 »),
   et le temps restant. Pause et Annuler. Journal replié derrière « Afficher les détails ».
   Les téléchargements manuels d'un compte gratuit deviennent une liste à cocher, archive par archive, avec un seul bouton Nexus chacune.
4. **Terminé.** Comment lancer le jeu, le dossier READY TO PLAY à ouvrir, plugins.txt déjà en place.
   En cas d'échec, le message en clair et l'action à faire, sans journal.

Absents du mode Simple : Inspecteur, archives et directives détaillées, réglage des threads, nettoyage des téléchargements, comparaison de mise à jour.
Ces outils restent dans le mode Expert, à un clic.

## Bascule Simple / Expert

- Menu natif **Affichage → Interface simple / Interface experte** (coche), à côté du menu « Langue ». Le passage se fait par
  `window.mabbajackMenu('mode:simple' | 'mode:expert')`, déjà branché.
- Le même réglage figure dans les Paramètres. Il est mémorisé dans `DATA_DIR/ui_mode.json` côté Python, comme `language.json`, et transmis par `?mode=`.
- Premier lancement : mode Simple.
- Une installation en cours continue quand on change de mode : seul l'affichage change.

## Architecture

1. Sortir l'état et les actions d'`App.tsx` (1 049 lignes) dans un hook `useMabbajack()` : modlist, chemins, compte Nexus,
   progression, et les actions charger, scanner, installer, pause. Le mode Expert le consomme sans changer de comportement.
2. Ajouter un `UiModeProvider` (`'simple' | 'expert'`), sur le modèle d'`I18nProvider`.
3. `src/simple/` : `SimpleApp.tsx` (étapes), `ChooseStep`, `PrepareStep`, `InstallStep`, `DoneStep`. Les composants
   existants sont réutilisés : `ManualDownloadModal` en version liste, `OptionalModsCard` replié, `fmtBytes`.
4. Textes : `locales/uiSimple.ts` en 4 langues (fr d'abord), vocabulaire sans jargon.
5. Python : coche du menu Affichage, `ui_mode.json`, libellés des menus en 4 langues (`lang_menu`).

Ordre conseillé : 1 (refonte sans changement visible, vérifiée par les tests et l'aperçu), puis 2 et 3 écran par écran, puis 5.
Étape 1 sur Opus (changement transverse) ; étapes 2 à 5 sur Sonnet.

## Décisions (03/11/2026)

- Premier lancement : mode **Simple**.
- Dossiers : **deux dossiers comme aujourd'hui** (DOWNLOADS et READY TO PLAY), pas de dossier unique. L'écran Préparer les présente côte à côte.
- Galerie Simple : **Skyrim et Enderal**.
- Bouton **Installer** de la galerie (téléchargement du .wabbajack par install-from-url) : **dans les deux modes**.

## Avancement

- [x] Étape 1 : état et actions sortis d'`App.tsx` dans `src/state/mabbajack.tsx` (`MabbajackProvider`, `useMabbajack()`,
  `useMabbajackEvents()` pour la navigation). Démo dans `src/state/demoModlist.ts`. `App.tsx` = présentation Expert (248 lignes).
  Au passage : glisser-déposer global branché (il n'était relié à rien), code mort retiré (sélection galerie synthétique, overlay de téléchargement jamais affiché).
- [x] Étape 2 : bouton Installer de la galerie (carte et fiche), dans les deux modes : `installFromGallery()` dans l'état, overlay partagé `GalleryDownloadOverlay`, progression par le flux SSE. Le serveur lit les fichiers du CDN Wabbajack par parties (l'adresse du catalogue est une page web, d'où l'échec constaté d'abord), et refuse toute adresse qui renvoie du HTML.
- [ ] Étape 3 : `UiModeProvider` + `src/simple/` écran par écran.
- [ ] Étape 4 : menu natif Affichage (coche Simple / Expert), `ui_mode.json`, réglage dans les Paramètres.
