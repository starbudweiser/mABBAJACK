# Port Linux / Linux port (plan)

## 🇫🇷 Français
**Faisable.** Le cœur (Node + React) est portable. À adapter :
- Appels macOS : `osascript` (sélecteur de dossier), `pbpaste` (presse-papiers), `open`, chemins Homebrew.
- Détection du jeu : Steam/Proton au lieu de CrossOver/Whisky.
- Empaquetage : AppImage ou `.deb` avec Node, 7zz et unar embarqués.
- Fenêtre native : pywebview (GTK/Qt) ou équivalent.
- Compilation sur Linux ou en CI (PyInstaller ne compile pas pour une autre plateforme).
- Tests nécessaires sur une vraie machine Linux.

## 🇬🇧 English
**Feasible.** The core (Node + React) is portable. To adapt:
- macOS calls: `osascript` (folder picker), `pbpaste` (clipboard), `open`, Homebrew paths.
- Game detection: Steam/Proton instead of CrossOver/Whisky.
- Packaging: AppImage or `.deb` bundling Node, 7zz and unar.
- Native window: pywebview (GTK/Qt) or equivalent.
- Build on Linux or in CI (PyInstaller cannot cross-compile).
- Needs testing on a real Linux machine.
