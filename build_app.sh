#!/bin/bash
# Compile mABBAJACK.app : application macOS TOTALEMENT autonome (arm64).
#   - enveloppe Swift (AppKit + WKWebView, macos/) : fenêtre native, aucun navigateur
#   - Node.js, 7zz, unar et texconv (textures transformées) embarqués : aucune installation requise sur la machine cible
# Usage : ./build_app.sh        → produit ./mABBAJACK.app à la racine du projet
# Prérequis de COMPILATION : python3 (génération des traductions), npm, Xcode, accès réseau. 7zz et unar sont compilés pour macOS 13+
# par scripts/build_portable_tools.sh (les binaires Homebrew ne tournent que sur la version de macOS de la machine).
# Tous les fichiers temporaires (cache, payload) sont supprimés en fin de build ; dist/ est conservé (preview Vite).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.21.0}"   # LTS
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BUILD="$ROOT/.build-app"
CACHE="$BUILD/cache"
PAYLOAD="$BUILD/payload"
APP_NAME="mABBAJACK.app"

cleanup() {
  rm -rf "$BUILD" 2>/dev/null \
    || { sleep 2; rm -rf "$BUILD" 2>/dev/null \
    || echo "⚠ Nettoyage incomplet : supprimer manuellement $BUILD"; }
}
trap cleanup EXIT

PORTABLE="$(cd "$ROOT/.." && pwd)/_tools/portable"
[ -x "$PORTABLE/7zz" ] && [ -x "$PORTABLE/unar" ] || "$ROOT/scripts/build_portable_tools.sh"
SEVENZ="$PORTABLE/7zz"; UNAR="$PORTABLE/unar"
TEXCONV="$(cd "$ROOT/.." && pwd)/_tools/texconv/texconv-mac"   # recompilation : _tools/texconv/build.sh
[ -x "$TEXCONV" ] || echo "⚠ texconv-mac introuvable ($TEXCONV) : textures transformées copiées sans conversion"

rm -rf "$BUILD" "$ROOT/$APP_NAME"
mkdir -p "$CACHE" "$PAYLOAD/bin"

echo "▶ Icône"
[ -f assets/icon.icns ] || { echo "assets/icon.icns introuvable"; exit 1; }

echo "▶ Interface (npm run build)"
( cd web && { [ -d node_modules ] || npm ci; } && npm run build )

echo "▶ Binaires embarqués"
NODE_DIR="node-$NODE_VERSION-darwin-arm64"
NODE_TGZ="$CACHE/$NODE_DIR.tar.gz"
curl -fL "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIR.tar.gz" -o "$NODE_TGZ"
tar -xzf "$NODE_TGZ" -C "$CACHE" "$NODE_DIR/bin/node"
cp "$CACHE/$NODE_DIR/bin/node" "$PAYLOAD/bin/node"
cp "$SEVENZ" "$PAYLOAD/bin/7zz"
cp "$UNAR" "$PAYLOAD/bin/unar"
[ -x "$TEXCONV" ] && cp "$TEXCONV" "$PAYLOAD/bin/texconv"
chmod 755 "$PAYLOAD/bin/"*
mkdir -p "$PAYLOAD/licenses"
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$PORTABLE/7zz-License.txt" "$PAYLOAD/licenses/"
[ -f "$PORTABLE/unar-License.txt" ] && cp "$PORTABLE/unar-License.txt" "$PAYLOAD/licenses/"

echo "▶ Serveur + interface + dépendances de production"
cp -R web/server web/package.json web/package-lock.json "$PAYLOAD/"
# Moteur Mac commun : seul server/mackit/engine.mjs (empaqueté par « npm run build » ci-dessus) sert à l'exécution
rm -f "$PAYLOAD"/server/mackit/*.ts "$PAYLOAD/server/macengine.ts"
[ -f "$PAYLOAD/server/mackit/engine.mjs" ] || { echo "Moteur Mac absent (web/server/mackit/engine.mjs)"; exit 1; }
cp -R dist "$PAYLOAD/dist"
( cd "$PAYLOAD" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent )

echo "▶ Enveloppe Swift"
python3 macos/gen_strings.py
swift test --package-path macos -q 2>&1 | tail -3
swift build --package-path macos -c release -q
BIN="$(swift build --package-path macos -c release --show-bin-path)/mABBAJACK"

APP="$BUILD/dist/$APP_NAME"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/mABBAJACK"
cp assets/icon.icns "$APP/Contents/Resources/icon.icns"
cp macos/Resources/splash.html macos/Resources/splash-icon.png "$APP/Contents/Resources/"
cp -R "$PAYLOAD" "$APP/Contents/Resources/payload"

VERSION="$(node -p "require('$ROOT/web/package.json').version")"
PLIST="$APP/Contents/Info.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.mabbajack.app</string>
  <key>CFBundleName</key><string>mABBAJACK</string>
  <key>CFBundleDisplayName</key><string>mABBAJACK</string>
  <key>CFBundleExecutable</key><string>mABBAJACK</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PL
# Liens nxm:// (bouton « Mod Manager Download » de Nexus) : mABBAJACK les reçoit
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" \
  -c "Add :CFBundleURLTypes:0 dict" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.mabbajack.nxm" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string nxm" "$PLIST"
# Langues de l'appli : sans elles, macOS écrit en anglais les entrées qu'il ajoute aux menus (Dictée, Emoji…)
/usr/libexec/PlistBuddy -c "Add :CFBundleLocalizations array" "$PLIST"
for lang in fr en es it; do
  mkdir -p "$APP/Contents/Resources/$lang.lproj"
  /usr/libexec/PlistBuddy -c "Add :CFBundleLocalizations: string $lang" "$PLIST"
done

echo "▶ Signature (certificat local stable)"
"$(cd "$ROOT/.." && pwd)/_tools/sign_app.sh" "$APP" "$VERSION"

mv "$APP" "$ROOT/$APP_NAME"
echo "OK : $ROOT/$APP_NAME ($(du -sh "$ROOT/$APP_NAME" | cut -f1))"
