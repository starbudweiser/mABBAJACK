#!/bin/zsh
# Compile 7zz et unar pour macOS 13+ (arm64) à partir des sources officielles, pour l'appli publiée.
# Les binaires Homebrew ne visent que la version de macOS de cette machine : inutilisables ailleurs.
# Résultat : _tools/portable/{7zz,unar} (réutilisés par build_app.sh). Usage : build_portable_tools.sh [clean]
set -euo pipefail
export MACOSX_DEPLOYMENT_TARGET=13.0
ROOT=${0:A:h:h}
OUT="$(cd "$ROOT/.." && pwd)/_tools/portable"
SRC="$OUT/src"
SEVENZ_VER=2604                  # 7-Zip 26.04 (LGPL + restriction unRAR)
XAD_TAG=v1.10.8                  # XADMaster / unar (LGPL 2.1)
UD_TAG=1.1                       # universal-detector (dépendance de unar)

[[ "${1:-}" == clean ]] && rm -rf "$OUT"
mkdir -p "$SRC"

if [[ ! -x "$OUT/7zz" ]]; then
  echo "▶ 7-Zip $SEVENZ_VER"
  rm -rf "$SRC/7z" && mkdir -p "$SRC/7z"
  curl -fsSL "https://www.7-zip.org/a/7z$SEVENZ_VER-src.tar.xz" | tar xJ -C "$SRC/7z"
  ( cd "$SRC/7z/CPP/7zip/Bundles/Alone2" && make -j"$(sysctl -n hw.ncpu)" -f ../../cmpl_mac_arm64.mak >/dev/null )
  cp "$SRC/7z/CPP/7zip/Bundles/Alone2/b/m_arm64/7zz" "$OUT/7zz"
  cp "$SRC/7z/DOC/License.txt" "$OUT/7zz-License.txt"
fi

if [[ ! -x "$OUT/unar" ]]; then
  echo "▶ unar $XAD_TAG"
  rm -rf "$SRC/xad" && mkdir -p "$SRC/xad/XADMaster" "$SRC/xad/UniversalDetector"
  curl -fsSL "https://github.com/MacPaw/XADMaster/archive/refs/tags/$XAD_TAG.tar.gz" | tar xz -C "$SRC/xad/XADMaster" --strip-components 1
  curl -fsSL "https://github.com/MacPaw/universal-detector/archive/refs/tags/$UD_TAG.tar.gz" | tar xz -C "$SRC/xad/UniversalDetector" --strip-components 1
  cd "$SRC/xad/XADMaster"
  sed -i '' 's/libstdc++\.6\.dylib/libc++.1.dylib/g' XADMaster.xcodeproj/project.pbxproj
  for t in XADMaster unar; do
    xcodebuild -quiet -target $t -project XADMaster.xcodeproj SYMROOT="$PWD/build" -configuration Release \
      MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET ARCHS=arm64 ONLY_ACTIVE_ARCH=YES >/dev/null
  done
  cp build/Release/unar "$OUT/unar"
  cp LICENSE "$OUT/unar-License.txt" 2>/dev/null || true
fi

for b in 7zz unar; do
  m=$(vtool -show-build "$OUT/$b" | awk '/minos/{print $2; exit}')
  echo "OK : $OUT/$b (macOS $m+)"
done
