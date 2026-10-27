# Changelog — mABBAJACK

Notes de version / release notes (EN + FR). Translations in IT and ES: see the Nexus Mods page.

## Unreleased

**English**

- Animated splash screen at launch (shared Socle rule): the main window opens after 2 seconds, the splash leaves after 4 seconds. Fixed splash when "Reduce motion" is on.

**Français**

- Écran de lancement animé (règle commune Socle) : la fenêtre principale s'ouvre au bout de 2 secondes, le splash disparaît au bout de 4 secondes. Splash fixe si « Réduire les animations » est activé.

## 1.1.0

**English**

- Your Nexus API key is now stored in the macOS Keychain instead of the app's web storage (an existing key is moved automatically).
- Free Nexus accounts: click "Mod Manager Download" on the Nexus page and mABBAJACK receives the nxm:// link and downloads the file into DOWNLOADS. The manual download window warns you if another app (Vortex, mORTEX...) receives Nexus links and offers to switch.
- zEdit merges (MergedPatch directives) are now created. They used to be skipped without a message.
- Fix: MediaFire and ModDB downloads fetched the web page instead of the file. The real link is now read from the page (ModDB mirrors are tried from the least to the most loaded).
- New: Mega downloads.
- New-version notice: the app checks the latest GitHub release once a day and offers to open the Nexus page, remind you later or skip that version. Nothing is downloaded or installed.

**Français**

- La clé API Nexus est désormais rangée dans le trousseau macOS et non plus dans le stockage web de l'appli (une clé existante est déplacée automatiquement).
- Comptes Nexus gratuits : cliquez sur « Mod Manager Download » sur la page Nexus, mABBAJACK reçoit le lien nxm:// et télécharge le fichier dans DOWNLOADS. La fenêtre des téléchargements manuels prévient si une autre appli (Vortex, mORTEX…) reçoit les liens Nexus et propose de basculer.
- Les fusions zEdit (directives MergedPatch) sont maintenant créées. Elles étaient ignorées sans message.
- Correctif : les téléchargements MediaFire et ModDB récupéraient la page web au lieu du fichier. Le vrai lien est maintenant lu dans la page (miroirs ModDB essayés du moins chargé au plus chargé).
- Nouveau : téléchargements Mega.
- Avertissement de nouvelle version : l'appli consulte la dernière release GitHub une fois par jour et propose d'ouvrir la page Nexus, de rappeler plus tard ou d'ignorer cette version. Rien n'est téléchargé ni installé.

<!-- gen_changelogs : entrées ci-dessous conservées -->

## 1.0.0

First public release. / Première version publique.
