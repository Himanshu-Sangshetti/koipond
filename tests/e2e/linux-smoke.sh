#!/bin/sh
# Launches the Linux app for real on a virtual screen (Xvfb + a window manager) and checks it: the pond page
# loads and its canvas is up, the window sits on the desktop layer under other windows, the "pay what you
# want" card shows on first open, the key check reaches Dodo, and the one-line installer installs and starts it.
# Needs: xvfb, openbox, x11-utils, imagemagick, python3-gi, gir1.2-webkit2-4.1. Run from anywhere.
set -u
cd "$(dirname "$0")/../../wallpaper"
FAIL=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; FAIL=1; }
OUT=${KOI_SHOTS:-$(mktemp -d)}
export XDG_CONFIG_HOME=$(mktemp -d) HOME=$(mktemp -d) DISPLAY=:77
Xvfb :77 -screen 0 1280x800x24 >/dev/null 2>&1 & XV=$!
sleep 1; openbox >/dev/null 2>&1 & WM=$!; sleep 1
xsetroot -solid "#444444" 2>/dev/null || true

# run 1: a first launch, reporting after ~12 s
R=$(mktemp)
KOI_CARD_KEY=KOIPOND-NOT-A-REAL-KEY KOI_SMOKE=$R KOI_WEB=build/linux/web python3 build/linux/koipond.py >/tmp/koi-linux.log 2>&1 &
PID=$!
sleep 9
import -window root "$OUT/linux-desktop.png" 2>/dev/null
WIN=$(xprop -root _NET_CLIENT_LIST 2>/dev/null | grep -o '0x[0-9a-f]*' | while read w; do xprop -id "$w" _NET_WM_WINDOW_TYPE | grep -q DESKTOP && echo "$w"; done | head -1)
wait $PID
cat "$R"; echo
cat /tmp/koi-linux.log | grep -v "^$" | tail -5
python3 - "$R" <<'PY' || FAIL=1
import json, sys
r = json.load(open(sys.argv[1])); bad = 0
def c(name, ok):
    global bad; print(("ok    " if ok else "FAIL  ") + name); bad += 0 if ok else 1
c("the pond page loads", r["ready"])
c("the pond canvas is up (%spx wide)" % r["page"]["canvas"], r["page"]["canvas"] > 0)
print("note  frames %s -> %s (no GPU here; real desktops draw 30-60 a second)" % (r["framesBefore"], r["page"]["frames"]))
c("the window is on the desktop layer (%s)" % r["typeHint"], r["typeHint"] == "desktop" or r["layerShell"])
c("the pay-what-you-want card shows on first open", r["card"])
c("a key typed into the card is checked with Dodo and the answer shows (%s)" % r["cardError"], "wasn't found" in r["cardError"])
c("the right-click menu offers paying and a key", "Pay what you want…" in r["menu"] and "I have a key…" in r["menu"] and "Quit koipond" in r["menu"])
sys.exit(1 if bad else 0)
PY
[ -n "$WIN" ] && ok "the window manager sees a desktop-type window ($WIN)" || bad "the window manager sees a desktop-type window"
# the pond, not the grey root, fills the screen corner
PX=$(convert "$OUT/linux-desktop.png" -crop 1x1+1270+790 -format '%[pixel:p{0,0}]' info: 2>/dev/null)
case "$PX" in *"68,68,68"*|*"#444444"*|"") bad "the pond covers the desktop (corner pixel: ${PX:-none})" ;; *) ok "the pond covers the desktop (corner pixel: $PX)" ;; esac

# a supporter: no card, and the menu says thank you
python3 -c "import json,os; p=os.environ['XDG_CONFIG_HOME']+'/koipond/supporter-live.json'; json.dump({'key':'K','instanceID':'i','email':'e','since':''}, open(p,'w'))"
R3=$(mktemp)
KOI_SMOKE=$R3 KOI_WEB=build/linux/web python3 build/linux/koipond.py >/dev/null 2>&1
python3 -c "import json,sys; r=json.load(open('$R3')); sys.exit(0 if not r['card'] and 'Supporter. Thank you!' in r['menu'] and 'I have a key…' not in r['menu'] else 1)" && ok "a supporter sees no card and a thank-you in the menu" || bad "a supporter sees no card and a thank-you in the menu"
rm -f "$XDG_CONFIG_HOME/koipond/supporter-live.json"

# the asked count was saved: the next launch is quiet
R2=$(mktemp)
KOI_SMOKE=$R2 KOI_WEB=build/linux/web python3 build/linux/koipond.py >/dev/null 2>&1
python3 -c "import json,sys; sys.exit(0 if not json.load(open('$R2'))['card'] else 1)" && ok "no card on the next launch" || bad "no card on the next launch"

A=$(KOI_ACTIVATE=KOIPOND-NOT-A-REAL-KEY python3 build/linux/koipond.py)
case "$A" in "failed That key wasn't found"*) ok "a made-up key is checked with Dodo (not found)" ;; *) bad "key check: $A" ;; esac

# the installer, from a local copy of the release download
D=$(mktemp -d); B=$(mktemp -d)
KOI_URL="file://$PWD/build/koipond-linux.tar.gz" KOI_DEST="$D" KOI_BIN="$B" KOI_NO_OPEN=1 sh install.sh >/dev/null 2>&1
[ -f "$D/koipond.py" ] && [ -f "$D/web/index.html" ] && [ -x "$B/koipond" ] && ok "the installer puts the app in place" || bad "the installer puts the app in place"
grep -q "Exec=$B/koipond" "$HOME/.local/share/applications/koipond.desktop" 2>/dev/null && ok "the installer adds an app menu entry" || bad "the installer adds an app menu entry"
KOI_ACTIVATE=x "$B/koipond" | grep -q "^failed" && ok "the installed koipond command runs" || bad "the installed koipond command runs"

kill $WM $XV 2>/dev/null
[ $FAIL = 0 ] && echo "all Linux app checks passed" || echo "some Linux app checks failed"
exit $FAIL
