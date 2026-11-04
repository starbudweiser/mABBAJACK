# Changelog — mABBAJACK

Notes de version / release notes (EN + FR). Translations in IT and ES: see the Nexus Mods page.

## Unreleased

**English**

- New "Mac adaptation" card before the installation (checked by default): it lists every fix that will be applied for Skyrim on macOS (DXMT graphics engine, DLSS bridge, SSE Display Tweaks, DLLs duplicated by Bottled Shaders, shader compiler, Wine DLL overrides). Nothing is written before the installation ends.
- New "Mac report" card at the end of the installation: for each fix, applied, failed or skipped, with an Undo button per fix and for all. Original files are kept in the game's `_MAC_BACKUP` folder.
- Bottled Shaders 1.0.26 or later can be downloaded from the report with your Nexus API key (never bundled with the app).
- Shared Mac engine (the same one as mORTEX and mO2FLATTENER), bundled into the app's server.

**Français**

- Nouvelle carte « Adaptation au Mac » avant l'installation (cochée par défaut) : elle liste chaque correctif appliqué pour Skyrim sous macOS (moteur graphique DXMT, pont DLSS, SSE Display Tweaks, DLL en double avec Bottled Shaders, compilateur de shaders, substitutions de DLL Wine). Rien n'est écrit avant la fin de l'installation.
- Nouvelle carte « Bilan Mac » à la fin de l'installation : pour chaque correctif, appliqué, échoué ou ignoré, avec un bouton Annuler par correctif et pour tout. Les fichiers d'origine sont gardés dans le dossier `_MAC_BACKUP` du jeu.
- Bottled Shaders 1.0.26 ou plus récent se télécharge depuis le bilan avec votre clé API Nexus (jamais embarqué dans l'appli).
- Moteur Mac commun (le même que mORTEX et mO2FLATTENER), empaqueté dans le serveur de l'appli.

## 1.3.0

**English**

- New "Simple" interface, shown at first launch: a guided path in 3 steps (Choose, Prepare, Install). The previous layout remains available as "Expert".
- The gallery has an Install button that downloads the .wabbajack file for you.
- The game folder you pick by hand is now checked and recognized; Whisky is no longer searched (unsupported).
- The window can no longer be wider than your smallest screen; the top buttons no longer wrap.
- The "Done" screen warns when archives are missing; the manual-download counter is now exact.

**Français**

- Nouvelle interface « Simple », proposée au premier lancement : un parcours guidé en 3 étapes (Choisir, Préparer, Installer). L'ancienne présentation reste disponible sous le nom « Expert ».
- La galerie a un bouton Installer qui télécharge pour vous le fichier .wabbajack.
- Le dossier du jeu choisi à la main est maintenant vérifié et reconnu ; Whisky n'est plus cherché (non supporté).
- La fenêtre ne peut plus être plus large que votre plus petit écran ; les boutons du haut ne passent plus à la ligne.
- L'écran « Terminé » signale les archives manquantes ; le compteur de téléchargements manuels est désormais exact.

## 1.2.0

**English**

- Signed with a Developer ID and notarized by Apple: macOS now opens the app without a security warning.
- The app's launcher is now compiled from source when the app is built, instead of using PyInstaller's generic prebuilt launcher, which antivirus scanners tend to flag. No change in features.
- New animated splash screen at launch.
- The first letter of the app's name now uses the colour of its logo everywhere it appears.
- The new-version notice now opens mABBAJACK's new page in Nexus Mods' Modding Tools section.

**Français**

- Signée avec un certificat Developer ID et notarisée par Apple : macOS ouvre désormais l'appli sans avertissement de sécurité.
- Le lanceur de l'appli est maintenant compilé depuis les sources à la construction de l'appli, au lieu du lanceur générique précompilé de PyInstaller, souvent signalé par les antivirus. Aucun changement de fonctionnalités.
- Nouvel écran de lancement animé.
- La première lettre du nom de l'appli prend la couleur de son logo partout où il est écrit.
- L'avis de nouvelle version ouvre maintenant la nouvelle page de mABBAJACK dans la section Modding Tools de Nexus Mods.

<!-- gen_changelogs : entrées ci-dessous conservées -->

## 1.0.0

First public release. / Première version publique.
