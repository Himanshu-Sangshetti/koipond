#!/bin/sh
# koipond wallpaper for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.sh | sh
# macOS: downloads the app from the latest GitHub release into /Applications (or ~/Applications) and opens it.
#   Uninstall: quit it from the menu bar fish, then delete koipond.app.
# Linux: installs into ~/.local/share/koipond with a `koipond` command and an app menu entry, then starts it.
#   Uninstall: right-click the pond, Quit, then delete ~/.local/share/koipond and ~/.local/bin/koipond.
# Windows has its own one-liner (install.ps1).
set -e
REL="https://github.com/Himanshu-Sangshetti/koipond/releases/latest/download"
if [ "$(uname)" = "Linux" ]; then
  URL="${KOI_URL:-$REL/koipond-linux.tar.gz}"
  if ! python3 -c 'import gi; gi.require_version("Gtk","3.0"); gi.require_version("WebKit2","4.1")' 2>/dev/null &&
     ! python3 -c 'import gi; gi.require_version("Gtk","3.0"); gi.require_version("WebKit2","4.0")' 2>/dev/null; then
    echo "koipond needs GTK and WebKitGTK for Python. Install them first:"
    echo "  Ubuntu/Debian: sudo apt install python3-gi gir1.2-webkit2-4.1"
    echo "  Fedora:        sudo dnf install python3-gobject webkit2gtk4.1"
    echo "  Arch:          sudo pacman -S python-gobject webkit2gtk-4.1"
    exit 1
  fi
  DEST="${KOI_DEST:-$HOME/.local/share/koipond}"
  BIN="${KOI_BIN:-$HOME/.local/bin}"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "Downloading koipond..."
  curl -fsSL "$URL" -o "$TMP/koipond.tar.gz"
  pkill -f "koipond/koipond.py" 2>/dev/null || true
  rm -rf "$DEST"; mkdir -p "$DEST" "$BIN"
  tar -xzf "$TMP/koipond.tar.gz" -C "$DEST"
  printf '#!/bin/sh\nexec python3 "%s/koipond.py" "$@"\n' "$DEST" > "$BIN/koipond"; chmod +x "$BIN/koipond"
  APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; mkdir -p "$APPS"
  printf '[Desktop Entry]\nType=Application\nName=koipond\nComment=A koi pond as your desktop wallpaper\nExec=%s/koipond\nIcon=%s/koipond.png\nCategories=Utility;\n' "$BIN" "$DEST" > "$APPS/koipond.desktop"
  [ "${KOI_NO_OPEN:-}" = "1" ] || (nohup python3 "$DEST/koipond.py" >/dev/null 2>&1 &)
  echo "koipond is running. Right-click the pond for settings. Installed to $DEST"
  exit 0
fi
URL="${KOI_URL:-$REL/koipond-mac.zip}"
[ "$(uname)" = "Darwin" ] || { echo "On Windows, run in PowerShell: irm https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.ps1 | iex"; exit 1; }
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
echo "koipond is running. Click the fish in the menu bar for settings. Installed to $DEST/koipond.app"
