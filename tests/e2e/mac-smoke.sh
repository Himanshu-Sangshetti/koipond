#!/bin/sh
# Launches the built Mac app for real and checks it: the pond page loads and keeps drawing, the
# "pay what you want" card shows on first open and closes on "Continue free", the key check reaches
# Dodo, and the one-line installer installs and opens the app.
# CI only: it starts a second wallpaper and the installer quits any running koipond.
set -u
[ "${CI:-}" = "true" ] || { echo "mac-smoke runs on CI only (it would touch the installed koipond)"; exit 0; }
cd "$(dirname "$0")/../../wallpaper"
APP=${KOI_SMOKE_APP:-build/koipond.app/Contents/MacOS/koipond}
DOMAIN=${KOI_SMOKE_DOMAIN:-com.hxlfed.koipond}
LOG=$(mktemp); FAIL=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; FAIL=1; }

defaults delete "$DOMAIN" >/dev/null 2>&1 || true
# a fresh install: the card should appear; the script then clicks "Continue free" like a user would
JS="setTimeout(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Continue free');b&&b.click()},2500)"
# run 1 keeps drawing even when windows cover the desktop (KOI_BENCH), to count frames
KOI_DEBUG=1 KOI_BENCH=1 "$APP" >"$LOG" 2>&1 &
PID=$!; sleep 12; kill $PID 2>/dev/null; wait $PID 2>/dev/null
# run 2 is a normal first launch
LOG2=$(mktemp)
KOI_DEBUG=1 KOI_PANEL_JS="$JS" "$APP" >"$LOG2" 2>&1 &
PID=$!; sleep 10; kill $PID 2>/dev/null; wait $PID 2>/dev/null
grep -q "koipond: page loaded" "$LOG" && ok "the pond page loads in the app" || bad "the pond page loads in the app"
F=$(grep -o "koipond: frames [0-9]*" "$LOG" | awk '{print $3}')
FIRST=$(echo "$F" | head -1); LAST=$(echo "$F" | tail -1)
[ -n "$FIRST" ] && [ "${LAST:-0}" -gt "${FIRST:-0}" ] && ok "the pond keeps drawing ($FIRST -> $LAST frames)" || bad "the pond keeps drawing (frames: $(echo $F | tr '\n' ' '))"
grep -q '"ask": true' "$LOG2" && ok "the pay-what-you-want card shows on first open" || bad "the pay-what-you-want card shows on first open"
grep 'support \[' "$LOG2" | tail -1 | grep -q '"ask": false' && ok "'Continue free' closes the card" || bad "'Continue free' closes the card"
grep -q "panel size .* -> 8[0-9][0-9]" "$LOG2" && ok "the panel sizes its window to fit" || bad "the panel sizes its window to fit"

OUT=$(KOI_ACTIVATE="koipond-ci-key-that-does-not-exist" "$APP" 2>/dev/null)
echo "$OUT" | grep -q "failed That key wasn't found" && ok "the app reaches Dodo's live key check (unknown key refused)" || bad "the app reaches Dodo's live key check ($OUT)"

if [ -z "${KOI_SMOKE_NO_INSTALL:-}" ]; then
DEST=$(mktemp -d)
KOI_URL="file://$PWD/build/koipond-mac.zip" KOI_DEST="$DEST" sh install.sh >/dev/null 2>&1
sleep 3
[ -x "$DEST/koipond.app/Contents/MacOS/koipond" ] && ok "the one-line installer installs the app" || bad "the one-line installer installs the app"
pgrep -f "$DEST/koipond.app" >/dev/null && ok "the installer opens it" || bad "the installer opens it"
xattr "$DEST/koipond.app" 2>/dev/null | grep -q quarantine && bad "installed app is quarantined (macOS would warn)" || ok "the installed app has no quarantine flag (no macOS warning)"
pkill -f "$DEST/koipond.app" 2>/dev/null || true
fi
defaults delete "$DOMAIN" >/dev/null 2>&1 || true

[ $FAIL = 0 ] && echo "mac-smoke: all checks passed" || { echo "mac-smoke: failed"; echo "--- app log"; tail -25 "$LOG"; echo "--- first launch log"; tail -25 "$LOG2"; }
exit $FAIL
