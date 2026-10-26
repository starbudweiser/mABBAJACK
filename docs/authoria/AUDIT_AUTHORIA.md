# Audit — Authoria : Requiem Reforged (v2.9.9) vs mABBAJACK

Source analysée : `tests/Authoria - Requiem Reforged.wabbajack` (3,06 Go), README, guides, `modlists.json`.

## 1. Chiffres clés du `.wabbajack`

| Élément | Valeur |
|---|---|
| Archives | 3 504 (269,6 Go) — **3 398 Nexus**, 75 fichiers du jeu, 22 CDN Wabbajack, 6 HTTP, 3 Google Drive |
| Directives | 770 146 (≈ 546 Go installés) |
| `FromArchive` | 711 483 (dont 775 imbriqués : archive → BSA → fichier) |
| `PatchedFromArchive` | 47 335 (18,6 Go) |
| `InlineFile` | 8 139 |
| **`TransformedTexture`** | **2 882 (9,6 Go)** |
| **`RemappedInlineFile`** | **173** |
| `CreateBSA` | 134 (97 470 fichiers, **72 Go** de staging `TEMP_BSA_FILES`) |
| Mods MO2 / profil | 3 571 mods, 1 profil unique `Authoria - Requiem Reforged` |
| Mods désactivés par défaut | **230** (≈ 21,9 Go installés) |

## 2. Mods optionnels (Ultra-wide, NSFW, ENB, etc.)

**Constat :** il n'y a pas de « choix » dans le `.wabbajack`. Tout est installé ; les options sont des mods **désactivés (`-`) dans `profiles/<nom>/modlist.txt`**, regroupés sous des séparateurs MO2. L'utilisateur les active ensuite dans MO2 (README : « Enable all the disabled mods in the separator »).

Séparateurs contenant des mods désactivés :

| Séparateur | Désactivés | Rôle |
|---|---|---|
| Character Visuals – NPC Appearances – Face Swaps | 13 (19,2 Go !) | Face swaps |
| Character Visuals – NPC Appearances – Base | 11 | Remplaceurs NPC (gérés par NPC Plugin Chooser) |
| ENB Presets / ENB Frame Generation | 6 + 1 | Cabbage, Kauz, Rudy, AMON, ELDEREN, Berserkyr |
| Controller Setup | 5 | Manette |
| Reshade | 3 | Reshade |
| Weaker Followers | 3 | Suiveurs nerfés |
| `-- Widescreen 21x9 & 32x9 ---` | 3 | Ultra-wide |
| Misc | 5 | Divers |
| Essential – LOD Tools | 2 | Ressources xLODGen |

Le contenu NSFW (Kaidan NSFW, OStim…) est **activé** dans le profil standard ; il existe un profil/Output « NSFW » cité dans le guide Pandora mais **un seul profil est présent** dans ce `.wabbajack` (pas de choix SFW/NSFW dans l'installateur).

### Opportunités pour mABBAJACK
1. **Écran « Options de la modlist »** après lecture du `.wabbajack` : parser `profiles/*/modlist.txt`, grouper par séparateur (`*_separator`), proposer des cases à cocher (désactivés par défaut), et **réécrire `modlist.txt`** (`+`/`-`) à l'installation. Aucun changement de contenu installé : simple pré-configuration du profil.
2. **Option « Ne pas installer les mods désactivés »** : exclure leurs directives (`To = mods/<nom>/…`) → économie jusqu'à ~22 Go d'écriture. Les archives utilisées *uniquement* par des mods désactivés (20 archives, 1,4 Go) ne sont pas téléchargées. Attention : mods nécessaires aux outils (NPC Plugin Chooser, LOD) → avertissement « non save-safe » à afficher.
3. **Profils multiples** : détecter plusieurs dossiers `profiles/*` et laisser choisir le profil actif (ici un seul, mais fréquent ailleurs, ex. SFW/NSFW).
4. Afficher dans l'UI un résumé des **pré-requis de la modlist** (lus dans `Readme`/`Description`, ici : Skyrim **AE** + Creation Club téléchargé, Creation Kit installé, langue anglaise, SSD interne).

## 3. Lacunes du code actuel (priorité haute)

### 3.1 `TransformedTexture` — ignoré silencieusement (2 882 fichiers, 9,6 Go)
Dans [server.js](file:///Volumes/SKYRIM/TOOLS/MAC/mABBAJACK/server/server.js) (catégorisation ~L816 et boucle « autres directives » ~L1257), tout type inconnu tombe dans `skipped++`.
- Impact : textures manquantes dans les mods **et** 2 510 d'entre elles sont destinées à des **BSA créés** (`TEMP_BSA_FILES`) → BSA incomplets.
- Les données sont dans l'archive source (`ArchiveHashPath`), à recompresser/redimensionner selon `ImageState` (Width, Height, Format `BC7_UNORM` 67 %, `BC3`, `BC4`, `BC1`, `BC2`, `BC6H`, `R8G8B8A8`, MipLevels).
- **Correctif minimal (recommandé d'abord)** : traiter comme `FromArchive` (copie de la texture source) avec avertissement « texture non redimensionnée » → fichier valide mais plus lourd en VRAM.
- **Correctif complet** : réencodage DDS (BC7 via un encodeur natif embarqué type `bc7enc`/`texconv` compilé macOS ou ImageMagick pour BC1/3/5) ; coûteux, à traiter plus tard.

### 3.2 `RemappedInlineFile` — ignoré (173 fichiers)
Ce sont des fichiers inline contenant des chemins absolus à remplacer (`%%GAME_PATH_MAGIC_BACK%%`, `%%DOWNLOAD…%%`, `%%MO2…%%`, etc.) : `ModOrganizer.ini`, `*.compiler_settings`, configs d'outils. Sans eux, **MO2/outils ne trouvent ni le jeu ni les dossiers**.
- Correctif : charger comme `InlineFile` (`SourceDataID`), puis remplacer les « magic strings » par les chemins réels (jeu, dossier d'installation, téléchargements), avec séparateurs `\\` ou `/` selon le cas (chemins Windows/Wine pour CrossOver).

### 3.3 Téléchargements non-Nexus
- Types présents : `HttpDownloader` (6, ex. MO2, NifSkope sur GitHub), `GoogleDriveDownloader` (3), `WabbajackCDNDownloader+State` (22 : Kaidan, Bethini Pie, ENB…).
- À vérifier/ajouter : `HttpDownloader` (déjà via `state.Url` ~L2121), **Google Drive** (confirmation de virus pour gros fichiers) et **CDN Wabbajack** (`definition.json.gz` + téléchargement par chunks, vérification xxHash64 par chunk).
- Aucun de ces cas ne doit passer par « téléchargement manuel » : c'est 31 archives.

### 3.4 Compte Nexus **Premium obligatoire** en pratique
3 398 archives Nexus : en compte gratuit, ce serait 3 398 liens manuels. L'UI devrait afficher clairement, avant installation, `N archives Nexus → Premium requis` et estimer le temps/volume (270 Go).

## 4. Optimisations

| # | Sujet | Détail |
|---|---|---|
| 1 | **Staging CreateBSA** | 72 Go temporaires (97 470 fichiers). Vérifier l'espace disque libre **avant** (staging + BSA + mods ≈ 120 Go de plus), et écrire les fichiers du staging par lien dur/`clonefile` quand ils viennent d'une archive extraite. |
| 2 | **BSA non compressés** | 70 BSA ont `ArchiveFlags=7` (compression activée). Notre écrivain produit du non compressé : plus gros sur disque, charge OK. Ajouter la compression zlib (v105 = LZ4 frame) pour fidélité et gain d'espace. |
| 3 | **Espace disque** | Calculer et afficher *Téléchargement ≈ 270 Go + Installé ≈ 546 Go + staging 72 Go* avant de lancer ; bloquer avec message clair si insuffisant (README : ~720 Go total). |
| 4 | **Fichiers du jeu / Stock Game** | 75 archives `GameFileSource` (CC `cc*`, Skyrim.esm…) : confirmer que les ESL Creation Club AE sont bien présents (le README exige le téléchargement du CC avant l'installation) ; message explicite si absents. |
| 5 | **Archives imbriquées** | 775 directives à 3 niveaux (archive → BSA → fichier) : déjà gérées via `BsaInternalPath` ; ajouter un test dédié. |
| 6 | **Volumétrie des patchs** | 47 335 `PatchedFromArchive` (18,6 Go) : déjà OctoDiff ; ajouter statistiques de fallback dans le résumé final. |
| 7 | **Création de dossiers** | Chemins très longs MO2 (`mods/<nom très long>/…`) : tronquage non nécessaire sur APFS, mais vérifier la limite de 255 octets par composant. |
| 8 | **Post-install MO2** | Fichiers `ModOrganizer.ini` + `profiles/<nom>/` : s'assurer que `modlist.txt`, `plugins.txt`, `loadorder.txt`, `lockedorder.txt`, `settings.ini`, `Skyrim*.ini` sont écrits tels quels (ils sont tous `InlineFile`). Les copies datées (`*.2026_09_xx`) peuvent être ignorées (≈ 20 fichiers inutiles). |
| 9 | **Outils Windows** | `tools/` (5 412 fichiers : BodySlide, Pandora, Reqtificator, Synthesis, DynDOLOD, NPC Plugin Chooser…) s'exécute **dans CrossOver ; prévoir un guide post-installation Mac et la détection « bouteille ». |
| 10 | **Prérequis de la modlist** | Parser le README pour afficher (Skyrim AE, Creation Kit, SSD, langue, VRAMr) dans la console avant l'installation. |

## 5. Points sans changement
- Fichiers MO2 ignorés volontairement (`shadercache`, `nemesis_engine`, `plugins`, `translations`, `stylesheets`) : cohérent (ici 1 966 + 701 + 343 fichiers).
- Les guides (Tool Running Guide, Gameplay Guide, Changelog) sont informatifs : rien à intégrer au code.
- `modlists.json` : entrée de dépôt **non officielle** (`official: false`, tag « NSFW »). La galerie de mABBAJACK n'affiche que le catalogue officiel → proposer « Afficher les listes non officielles » (équivalent Wabbajack) en lisant le même dépôt.

## 6. Plan proposé (ordre)
1. `TransformedTexture` : fallback copie source + avertissement (rapide, supprime 2 882 fichiers manquants et les BSA incomplets).
2. `RemappedInlineFile` : remplacement des chemins magiques (critique pour lancer MO2).
3. Téléchargeurs Google Drive et CDN Wabbajack.
4. Écran d'options (séparateurs/mods désactivés, profil, exclusion) + réécriture de `modlist.txt`.
5. Contrôle d'espace disque et résumé des pré-requis.
6. Compression BSA ; encodeur DDS complet (plus tard).
7. Galerie : listes non officielles.

## 7. État d'avancement

| # | Point | État |
|---|---|---|
| 1 | `TransformedTexture` (copie source + avertissement) | ✅ fait |
| 2 | `RemappedInlineFile` (chemins magiques → `Z:\…`) | ✅ fait |
| 3 | Téléchargeurs CDN Wabbajack + Google Drive | ✅ fait |
| 4 | Mods optionnels, profil, priorités MO2, `modlist.txt` | ✅ fait |
| 5 | Contrôle d'espace disque (bloquant < 90 %) | ✅ fait ; résumé des pré-requis : à faire |
| 6 | Compression BSA ; encodeur DDS | ⏸ reporté : BSA non compressés lus normalement par le jeu (seul coût : espace disque) ; compresseur LZ4 impossible à valider sans le jeu |
| 7 | Galerie : listes non officielles | ✅ déjà couvert : `/api/modlists` agrège tous les dépôts de `repositories.json` (Authoria y figure : `Auhtoria-Requiem-Reforged`), badge « Officiel » seulement pour les listes officielles |

Aucune installation complète d'Authoria (≈ 270 Go) n'a été exécutée : validation par tests unitaires (`scripts/test-*.mjs`).
