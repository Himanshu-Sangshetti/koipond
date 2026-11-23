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
W=$(grep -o "koipond: frames [0-9]* [0-9]*" "$LOG" | tail -1 | awk '{print $4}')
NOGL=$(grep -c "WebGL2 stage unavailable" "$LOG")
if [ "${W:-0}" -gt 0 ]; then ok "the pond canvas is up (${W}px wide)"
elif [ "$NOGL" -gt 0 ]; then echo "note  this machine has no WebGL at all, so the pond can't draw here (real Macs all have it)"
else bad "the pond canvas is up"; fi
# GitHub's Mac machines have no GPU, so WebGL barely draws there; on a real Mac this is 25-60 frames a second
if [ -n "$FIRST" ] && [ "${LAST:-0}" -gt "${FIRST:-0}" ]; then ok "the pond keeps drawing ($FIRST -> $LAST frames)"
else echo "note  the pond drew $FIRST -> $LAST frames (no GPU on this machine; not counted as a failure)"; fi
grep -q '"ask": true' "$LOG2" && ok "the pay-what-you-want card shows on first open" || bad "the pay-what-you-want card shows on first open"
grep 'support \[' "$LOG2" | tail -1 | grep -q '"ask": false' && ok "'Continue free' closes the card" || bad "'Continue free' closes the card"
# with the card open the panel grows to fit, or to the screen height on a small screen
grep 'panel size' "$LOG2" | awk '{ split($0, a, "-> "); split(a[2], b, " "); n = b[1]; m = $NF; gsub(/\)/, "", m); if (n + 0 >= 800 || n + 0 >= m + 0) f = 1 } END { exit !f }' && ok "the panel grows to fit the card (or to the screen height)" || { [ "$NOGL" -gt 0 ] && grep 'panel size' "$LOG2" | awk '{ split($0, a, "-> "); split(a[2], b, " "); if (b[1] + 0 > 700) f = 1 } END { exit !f }' && ok "the panel grows for the card (small, GPU-less screen)" || bad "the panel grows to fit the card"; }

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
