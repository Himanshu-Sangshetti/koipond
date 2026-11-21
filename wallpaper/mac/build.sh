#!/bin/sh
# Builds build/koipond.app (universal: Apple silicon + Intel), ad-hoc signed, and build/koipond-mac.zip.
# Needs only the Xcode command line tools. Run `npx vite build` first (or `npm run build:mac`).
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('../package.json').version")
OUT=build/koipond.app
rm -rf "$OUT" build/koipond-mac.zip
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources/web"

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" mac/main.swift -o "build/koipond-$arch" \
    -framework Cocoa -framework WebKit -framework IOKit -framework ServiceManagement
done
lipo -create build/koipond-arm64 build/koipond-x86_64 -output "$OUT/Contents/MacOS/koipond"
rm build/koipond-arm64 build/koipond-x86_64

cp build/web/index.html "$OUT/Contents/Resources/web/index.html"
sed "s/__VERSION__/$VERSION/g" mac/Info.plist > "$OUT/Contents/Info.plist"

# app icon from the demo's icon
ICONSET=build/koipond.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../demo/public/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) ../demo/public/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/Contents/Resources/koipond.icns"
rm -rf "$ICONSET"

# free ad-hoc signature (required on Apple silicon; no Apple developer account involved)
codesign --force --deep --sign - "$OUT"
(cd build && ditto -c -k --keepParent koipond.app koipond-mac.zip)
echo "built $OUT ($VERSION)"
