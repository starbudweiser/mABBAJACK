#!/bin/zsh
# Paquet de publication (Nexus Mods, GitHub) : release/mABBAJACK-<version>-macOS-arm64.zip
# Contient l'appli compilée (build_all.sh), un LISEZMOI d'installation et les licences.
# Usage : package_release.sh [chemin/vers/mABBAJACK.app]
set -euo pipefail
ROOT=${0:A:h:h}
APP=${1:-"$HOME/Applications/Skyrim Tools/mABBAJACK.app"}
[[ -d "$APP" ]] || { echo "Appli introuvable : $APP (lancer d'abord build_all.sh mABBAJACK)"; exit 1; }
VERSION=$(node -p "require('$ROOT/web/package.json').version")
PLIST_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
[[ "$VERSION" == "$PLIST_VERSION" ]] || { echo "Appli en version $PLIST_VERSION, sources en $VERSION : recompiler"; exit 1; }

# Les outils embarqués doivent tourner sur macOS 13+
for b in "$APP/Contents/Resources/payload/bin/"*; do
  m=$(vtool -show-build "$b" | awk '/minos/{print $2; exit}')
  [[ "${m%%.*}" -le 13 ]] || { echo "$b exige macOS $m : lancer scripts/build_portable_tools.sh puis recompiler"; exit 1; }
done
codesign --verify --deep --strict "$APP"

NAME="mABBAJACK-$VERSION-macOS-arm64"
STAGE="$ROOT/release/$NAME"
rm -rf "$STAGE" "$ROOT/release/$NAME.zip"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/mABBAJACK.app"
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/"
cp "$ROOT/docs/release/READ_ME_FIRST.txt" "$STAGE/"
( cd "$ROOT/release" && ditto -c -k --sequesterRsrc --keepParent "$NAME" "$NAME.zip" )
rm -rf "$STAGE"
shasum -a 256 "$ROOT/release/$NAME.zip" | tee "$ROOT/release/$NAME.zip.sha256"
echo "OK : $ROOT/release/$NAME.zip ($(du -h "$ROOT/release/$NAME.zip" | cut -f1))"
