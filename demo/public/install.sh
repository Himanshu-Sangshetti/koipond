#!/bin/sh
# koipond wallpaper for macOS: curl -fsSL https://koipond-demo.vercel.app/install.sh | sh
# Downloads the app from the latest GitHub release into /Applications (or ~/Applications) and opens it.
# Uninstall: quit it from the menu bar fish, then delete koipond.app.
set -e
URL="${KOI_URL:-https://github.com/Himanshu-Sangshetti/koipond/releases/latest/download/koipond-mac.zip}"
[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS. On Windows run: irm https://koipond-demo.vercel.app/install.ps1 | iex"; exit 1; }
DEST="${KOI_DEST:-/Applications}"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "Downloading koipond..."
curl -fsSL "$URL" -o "$TMP/koipond.zip"
ditto -x -k "$TMP/koipond.zip" "$TMP"
pkill -x koipond 2>/dev/null || true
rm -rf "$DEST/koipond.app"
mv "$TMP/koipond.app" "$DEST/koipond.app"
open "$DEST/koipond.app"
echo "koipond is running: it lives in the menu bar (the fish). Installed to $DEST/koipond.app"
