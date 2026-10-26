<p align="center"><img src="docs/screenshots/icon.png" width="128" alt="mABBAJACK"></p>

# mABBAJACK

🇫🇷 [Français](#-français) · 🇬🇧 [English](#-english)

---

## 🇫🇷 Français

### Présentation
**mABBAJACK** est un installateur de modlists **Wabbajack** natif pour **macOS**. Il permet d'installer des listes de mods (Skyrim SE/AE/VR, Enderal et de nombreux autres jeux) directement sur un Mac, sans machine virtuelle Windows.

Fonctionnalités :
- Galerie des modlists officielles (≈ 226) avec filtres par jeu (SE, AE, VR, Enderal, « Autres jeux »), tags, recherche et tri (taille, nom, date).
- Inspecteur de fichier `.wabbajack` (glisser-déposer).
- Installation complète : extraction (7zz / unar, lecteur BSA natif), patchs OctoDiff, textures transformées converties avec texconv (DirectXTex natif), création de BSA native, fichiers originaux du jeu copiés sans décompression.
- Mise à jour d'une liste déjà installée : au chargement d'une nouvelle version, mods ajoutés / supprimés / modifiés et archives à télécharger ; seuls les fichiers nouveaux ou modifiés sont réinstallés, les fichiers retirés sont supprimés (état de l'installation enregistré dans `.mabbajack/`).
- Téléchargements Nexus automatiques (compte **Premium**) ; avec un compte gratuit, le bouton **Mod Manager Download** de Nexus envoie le fichier directement à mABBAJACK (liens `nxm://`). Sources Wabbajack CDN, Google Drive, MediaFire, ModDB et Mega prises en charge.
- Clé API Nexus rangée dans le **trousseau macOS**.
- Fusions zEdit (`MergedPatch`) créées.
- Organisation des téléchargements « à la Vortex » (`<dossier>/skyrimse`).
- Détection automatique du jeu (Steam, CrossOver, `/Volumes/*/GAMES`).
- Journal en direct (filtres Tous / Avertissements / Erreurs), journaux enregistrés dans `~/Library/Logs/mABBAJACK/`.
- Interface en 4 langues : français, anglais, espagnol, italien.
- Application autonome : fenêtre native, Node, 7zz, unar et texconv embarqués.

![Galerie](docs/screenshots/gallery.png)

### Nouveautés de la 1.1.0

- Clé API Nexus dans le trousseau macOS (l'ancienne clé est déplacée automatiquement).
- Comptes gratuits : liens `nxm://` (Mod Manager Download). La fenêtre des téléchargements manuels prévient si une autre appli (Vortex, mORTEX…) reçoit les liens Nexus.
- Fusions zEdit (`MergedPatch`) maintenant créées ; elles étaient ignorées sans message.
- Correctif : MediaFire et ModDB téléchargeaient la page web au lieu du fichier. Nouveau : Mega.
- Avertissement de nouvelle version (GitHub, une fois par jour). Historique : [CHANGELOG.md](CHANGELOG.md).

### Pourquoi cette application ?
Wabbajack est uniquement disponible sous Windows. Les utilisateurs de Mac devaient passer par une VM lourde et lente. mABBAJACK a été créé pour offrir une installation native, simple, sans VM, avec des fichiers directement utilisables (par exemple via CrossOver).

### Mode d'emploi rapide
1. Ouvrez `mABBAJACK.app` (premier lancement : clic droit → **Ouvrir**).
2. **Paramètres** : saisissez votre clé API Nexus et choisissez les dossiers *DOWNLOADS* et *READY TO PLAY*.
3. Choisissez une modlist dans la **galerie** (ou glissez un fichier `.wabbajack`).
4. Onglet **Installation** : vérifiez les 3 dossiers et le dossier du jeu (détecté automatiquement).
5. Lancez l'installation et suivez le **journal** dans la console.
6. Si compte standard : téléchargez manuellement les archives listées dans le dossier DOWNLOADS, puis relancez.

![Installation](docs/screenshots/install.png)

### Limites
- Projet non affilié à Wabbajack. Une copie légale du jeu est requise.
- Les BSA recréés (`CreateBSA`) ne sont pas compressés.
- Skyrim SE ne lit pas les fichiers rangés au-delà de 2 Go dans un BSA : ceux d'un BSA recréé plus gros sont installés en fichiers libres à côté de l'archive (prioritaires sur les BSA).
- Modlists volumineuses (40 à 65 Go chacune).
- Les masters du Stock Game peuvent différer du manifeste (conservés avec avertissement).

---

## 🇬🇧 English

### Overview
**mABBAJACK** is a native **macOS** installer for **Wabbajack** modlists. It installs mod lists (Skyrim SE/AE/VR, Enderal and many other games) directly on a Mac, with no Windows virtual machine.

Features:
- Gallery of official modlists (≈ 226) with game filters (SE, AE, VR, Enderal, "Other games"), tags, search and sorting (size, name, date).
- `.wabbajack` file inspector (drag & drop).
- Full install: extraction (7zz / unar, native BSA reader), OctoDiff patches, transformed textures converted with texconv (native DirectXTex), native BSA writer, original game files copied without decompression.
- Updating an installed list: when a new version is loaded, mods added / removed / changed and archives to download are listed; only new or changed files are reinstalled, removed files are deleted (installation state saved in `.mabbajack/`).
- Automatic Nexus downloads (**Premium** account); with a free account, Nexus's **Mod Manager Download** button sends the file straight to mABBAJACK (`nxm://` links). Wabbajack CDN, Google Drive, MediaFire, ModDB and Mega sources are supported.
- Nexus API key stored in the **macOS Keychain**.
- zEdit merges (`MergedPatch`) are created.
- Vortex-style download layout (`<folder>/skyrimse`).
- Automatic game detection (Steam, CrossOver, `/Volumes/*/GAMES`).
- Live log (All / Warnings / Errors filters); logs saved in `~/Library/Logs/mABBAJACK/`.
- 4 UI languages: French, English, Spanish, Italian.
- Standalone app: native window, bundled Node, 7zz, unar and texconv.

### What's new in 1.1.0

- Nexus API key stored in the macOS Keychain (an existing key is moved automatically).
- Free accounts: `nxm://` links (Mod Manager Download). The manual download window warns you if another app (Vortex, mORTEX…) receives Nexus links.
- zEdit merges (`MergedPatch`) are now created; they used to be skipped without a message.
- Fix: MediaFire and ModDB downloaded the web page instead of the file. New: Mega.
- New-version notice (GitHub, once a day). History: [CHANGELOG.md](CHANGELOG.md).

### Why?
Wabbajack only runs on Windows. Mac users had to rely on a heavy, slow VM. mABBAJACK provides a native, simple, VM-free install producing files ready to use (e.g. through CrossOver).

### Quick start
1. Open `mABBAJACK.app`.
2. **Settings**: enter your Nexus API key and pick the *DOWNLOADS* and *READY TO PLAY* folders.
3. Pick a modlist in the **gallery** (or drop a `.wabbajack` file).
4. **Install** tab: check the 3 folders and the game folder (auto-detected).
5. Start the install and follow the **log** in the console.
6. Free account: manually download the listed archives into DOWNLOADS, then restart.

![Console](docs/screenshots/console.png)

### Limitations
- Not affiliated with Wabbajack. A legitimate copy of the game is required.
- Recreated BSAs (`CreateBSA`) are uncompressed.
- Skyrim SE cannot read files stored past 2 GB inside a BSA: in a larger recreated BSA, those files are installed as loose files next to the archive (they override BSAs).
- Large modlists (40–65 GB each).
- Stock Game masters may differ from the manifest (kept with a warning).
