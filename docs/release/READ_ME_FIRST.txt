mABBAJACK — Wabbajack modlist installer for macOS (Apple Silicon, macOS 13.5 or later)
==========================================================================================

INSTALL
1. Move mABBAJACK.app to your Applications folder.
2. The app is not notarized by Apple, so macOS blocks the first launch. Either:
   - open it once, then go to System Settings > Privacy & Security and click "Open Anyway";
   - or run in Terminal:  xattr -dr com.apple.quarantine /Applications/mABBAJACK.app
3. Open Settings: enter your Nexus Mods API key and choose the DOWNLOADS and READY TO PLAY folders.
4. Pick a modlist, check the game folder in the Install tab, start.

Nothing else to install: Node.js, 7-Zip, unar and texconv are bundled.
Logs: ~/Library/Logs/mABBAJACK/   — Your API key is never written to the logs.
The app only listens on 127.0.0.1 (port 38300) and refuses requests from web pages.

------------------------------------------------------------------------------------------

mABBAJACK — installateur de modlists Wabbajack pour macOS (Apple Silicon, macOS 13.5 ou plus récent)

INSTALLATION
1. Placez mABBAJACK.app dans le dossier Applications.
2. L'appli n'est pas notariée par Apple : macOS bloque le premier lancement. Au choix :
   - ouvrez-la une fois, puis Réglages Système > Confidentialité et sécurité > « Ouvrir quand même » ;
   - ou dans le Terminal :  xattr -dr com.apple.quarantine /Applications/mABBAJACK.app
3. Ouvrez les Paramètres : clé API Nexus Mods, dossiers DOWNLOADS et READY TO PLAY.
4. Choisissez une modlist, vérifiez le dossier du jeu dans l'onglet Installation, lancez.

Licence MIT — composants tiers : voir THIRD_PARTY_NOTICES.md.
