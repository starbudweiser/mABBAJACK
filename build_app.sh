#!/bin/bash
# Compile mABBAJACK.app : application macOS TOTALEMENT autonome (arm64).
#   - fenêtre native (pywebview/WKWebView) : aucun navigateur
#   - Node.js, 7zz, unar et texconv (textures transformées) embarqués : aucune installation requise sur la machine cible
# Usage : ./build_app.sh        → produit ./mABBAJACK.app à la racine du projet
# Prérequis de COMPILATION : python3, npm, 7zz et unar (Homebrew), accès réseau.
# Tous les fichiers temporaires (venv, cache, __pycache__) sont supprimés en fin de build ; dist/ est conservé (preview Vite).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.21.0}"   # LTS
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BUILD="$ROOT/.build-app"
VENV="$BUILD/venv"
CACHE="$BUILD/cache"
PAYLOAD="$BUILD/payload"
APP_NAME="mABBAJACK.app"

cleanup() {
  rm -rf "$BUILD" "$ROOT/python_app/__pycache__" 2>/dev/null \
    || { sleep 2; rm -rf "$BUILD" "$ROOT/python_app/__pycache__" 2>/dev/null \
    || echo "⚠ Nettoyage incomplet : supprimer manuellement $BUILD"; }
}
trap cleanup EXIT

SEVENZ="$(command -v 7zz || true)"; [ -n "$SEVENZ" ] || { echo "7zz introuvable (brew install sevenzip)"; exit 1; }
UNAR="$(command -v unar || true)";  [ -n "$UNAR" ]   || { echo "unar introuvable (brew install unar)"; exit 1; }
SEVENZ="$(readlink -f "$SEVENZ")"; UNAR="$(readlink -f "$UNAR")"
TEXCONV="$(cd "$ROOT/.." && pwd)/_tools/texconv/texconv-mac"   # recompilation : _tools/texconv/build.sh
[ -x "$TEXCONV" ] || echo "⚠ texconv-mac introuvable ($TEXCONV) : textures transformées copiées sans conversion"

rm -rf "$BUILD" "$ROOT/$APP_NAME"
mkdir -p "$CACHE" "$PAYLOAD/bin"

echo "▶ Environnement Python de compilation"
python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pywebview pyinstaller

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

echo "▶ Serveur + interface + dépendances de production"
cp -R web/server web/package.json web/package-lock.json "$PAYLOAD/"
cp -R dist "$PAYLOAD/dist"
( cd "$PAYLOAD" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent )

echo "▶ PyInstaller"
"$VENV/bin/python" -m PyInstaller --noconfirm --clean --windowed \
  --name mABBAJACK \
  --icon "$ROOT/assets/icon.icns" \
  --osx-bundle-identifier com.mabbajack.app \
  --distpath "$BUILD/dist" --workpath "$BUILD/work" --specpath "$BUILD" \
  "$ROOT/python_app/mabbajack_app.py" >/dev/null

APP="$BUILD/dist/$APP_NAME"
mkdir -p "$APP/Contents/Resources"
cp -R "$PAYLOAD" "$APP/Contents/Resources/payload"

echo "▶ Signature (certificat local stable)"
"$(cd "$ROOT/.." && pwd)/_tools/sign_app.sh" "$APP"

mv "$APP" "$ROOT/$APP_NAME"
echo "OK : $ROOT/$APP_NAME ($(du -sh "$ROOT/$APP_NAME" | cut -f1))"
