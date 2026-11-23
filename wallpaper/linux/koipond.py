#!/usr/bin/env python3
"""koipond wallpaper for Linux (GTK 3 + WebKitGTK).

One window per display, placed on the desktop layer under every other window, showing the pond page.
Because nothing sits above it, the pond gets the mouse directly. Right-click the pond for settings.

Wayland desktops with layer-shell (KDE Plasma, Sway, Hyprland) use the background layer; everywhere
else (X11, and GNOME on Wayland through XWayland) the window is a desktop-type window.

Supporting koipond is optional (pay what you want). A purchase comes with a key; entering it only stops
the "pay what you want" card from appearing. Nothing is locked. No secrets live here: the checkout link is
public, and keys are checked against Dodo Payments' public license endpoint.
"""
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread

if os.environ.get("XDG_SESSION_TYPE") == "wayland" and "GDK_BACKEND" not in os.environ:
    # GNOME has no layer-shell: there the pond runs through XWayland as a desktop-type window
    if "GNOME" in os.environ.get("XDG_CURRENT_DESKTOP", "").upper():
        os.environ["GDK_BACKEND"] = "x11"

import gi  # noqa: E402

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
for _v in ("4.1", "4.0"):
    try:
        gi.require_version("WebKit2", _v)
        break
    except ValueError:
        pass
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

try:
    gi.require_version("GtkLayerShell", "0.1")
    from gi.repository import GtkLayerShell
except (ImportError, ValueError):
    GtkLayerShell = None

HERE = Path(__file__).resolve().parent
WEB = Path(os.environ.get("KOI_WEB", HERE / "web")).resolve()
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "koipond"
AUTOSTART = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "autostart" / "koipond.desktop"


# --- store (same product and rules as the Mac and Windows apps)
PRODUCTS = {"test": "pdt_0NsYCacmTCBksDKMSi7PX", "live": "pdt_0NsYIva9ea1hMacA3xaaB"}
MODE = "test" if os.environ.get("KOI_STORE") == "test" or not PRODUCTS["live"] else "live"
PRODUCT_ID = PRODUCTS[MODE]
API = "https://live.dodopayments.com" if MODE == "live" else "https://test.dodopayments.com"
CHECKOUT = "https://%s/buy/%s?quantity=1&redirect_url=%s" % (
    "checkout.dodopayments.com" if MODE == "live" else "test.checkout.dodopayments.com",
    PRODUCT_ID, urllib.parse.quote("https://koipond-demo.vercel.app/?thanks", safe=""))


def load_json(p, default):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def save_json(p, data):
    try:
        CONFIG.mkdir(parents=True, exist_ok=True)
        Path(p).write_text(json.dumps(data))
    except OSError:
        pass


SETTINGS_FILE = CONFIG / "settings.json"
SUPPORTER_FILE = CONFIG / ("supporter-%s.json" % MODE)
DEFAULTS = {"look": "natural", "fish": 14, "rain": True, "pads": True, "petals": True, "paused": False, "firstSeen": None, "asked": 0}


def supporter():
    s = load_json(SUPPORTER_FILE, None)
    return s if isinstance(s, dict) and s.get("key") else None


def ask_due(settings, now=None):
    """The card shows the first time the app opens, and once more a week later; never for supporters."""
    now = now or time.time()
    if supporter():
        return False
    if not settings.get("firstSeen"):
        settings["firstSeen"] = now
        save_json(SETTINGS_FILE, settings)
    if settings.get("asked", 0) == 0:
        return True
    return settings.get("asked") == 1 and now - settings["firstSeen"] >= 7 * 86400


def parse(body, status, key):
    """(supporter, None) or (None, message) for Dodo's /licenses/activate answer."""
    if status == 403:
        return None, "That key has been turned off (for example after a refund)."
    if status == 404:
        return None, "That key wasn't found. Check it was pasted in full."
    if status == 422:
        return None, "That key is already in use on 5 computers."
    if status not in (200, 201):
        return None, "The key server had a problem (%d). Try again in a minute." % status
    try:
        b = json.loads(body)
        if b["product"]["product_id"] != PRODUCT_ID:
            return None, "That key is for a different product."
        return {"key": key.strip(), "instanceID": b["id"], "email": b["customer"]["email"],
                "since": datetime.now(timezone.utc).isoformat()}, None
    except (ValueError, KeyError, TypeError):
        return None, "The key server had a problem (%d). Try again in a minute." % status


def activate(raw):
    key = raw.strip()
    req = urllib.request.Request(API + "/licenses/activate", method="POST",
                                 data=json.dumps({"license_key": key, "name": socket.gethostname()}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return parse(r.read(), r.status, key)
    except urllib.error.HTTPError as e:
        return parse(e.read(), e.code, key)
    except (urllib.error.URLError, OSError) as e:
        return None, "Couldn't reach the key server: %s" % getattr(e, "reason", e)


# --- the support card
CSS = b"""
.koi { background: #0e1e24; color: #e8f0ee; }
.koi .title { font-size: 15pt; font-weight: 600; }
.koi .dim { color: #96afac; }
.koi .err { color: #f08c5a; }
.koi button { background: #22343a; color: #e8f0ee; border: none; box-shadow: none; padding: 6px 14px; }
.koi button.link { background: transparent; padding: 0; }
.koi button.primary { background: #f08c5a; color: #141414; }
.koi entry { background: #182a30; color: #e8f0ee; border: 1px solid #2e464d; }
"""


class SupportCard(Gtk.Window):
    def __init__(self, app, key_first=False):
        super().__init__(title="koipond")
        self.app = app
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_resizable(False)
        self.set_keep_above(True)
        self.get_style_context().add_class("koi")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin=22)
        t = Gtk.Label(label="koipond is free for everyone", xalign=0)
        t.get_style_context().add_class("title")
        d = Gtk.Label(label="If it makes your desk a little calmer, you can pay what you want.\nIt's optional and nothing is locked.", xalign=0)
        d.get_style_context().add_class("dim")
        row = Gtk.Box(spacing=10, margin_top=8)
        pay = Gtk.Button(label="Pay what you want")
        pay.get_style_context().add_class("primary")
        pay.connect("clicked", lambda *_: (webbrowser.open(CHECKOUT), self.destroy()))
        free = Gtk.Button(label="Continue free")
        free.connect("clicked", lambda *_: self.destroy())
        row.pack_start(pay, False, False, 0)
        row.pack_start(free, False, False, 0)
        have = Gtk.LinkButton(uri="", label="I have a key", halign=Gtk.Align.START)
        have.get_style_context().add_class("link")
        have.connect("activate-link", self.show_key)
        self.keyrow = Gtk.Box(spacing=10, no_show_all=True)
        self.entry = Gtk.Entry(placeholder_text="Paste your key", width_chars=36)
        self.entry.connect("activate", self.check)
        self.btn = Gtk.Button(label="Activate")
        self.btn.connect("clicked", self.check)
        self.keyrow.pack_start(self.entry, True, True, 0)
        self.keyrow.pack_start(self.btn, False, False, 0)
        self.err = Gtk.Label(xalign=0, wrap=True, max_width_chars=48, no_show_all=True)
        self.err.get_style_context().add_class("err")
        for w in (t, d, row, have, self.keyrow, self.err):
            box.pack_start(w, False, False, 0)
        self.add(box)
        self.show_all()
        if key_first:
            self.show_key()
        self.have = have
        test_key = os.environ.get("KOI_CARD_KEY")  # testing: press "I have a key", enter this key, press Enter
        if test_key:
            GLib.timeout_add(1000, lambda: (self.have.clicked(), self.entry.set_text(test_key), self.entry.activate()) and False)

    def show_key(self, *_):
        self.keyrow.show_all()
        self.entry.grab_focus()
        return True

    def check(self, *_):
        key = self.entry.get_text().strip()
        if not key or not self.btn.get_sensitive():
            return
        self.btn.set_sensitive(False)
        self.btn.set_label("Checking…")
        self.err.hide()

        def work():
            ok, err = activate(key)
            GLib.idle_add(self.done, ok, err)
        Thread(target=work, daemon=True).start()

    def done(self, ok, err):
        self.btn.set_sensitive(True)
        self.btn.set_label("Activate")
        if ok:
            save_json(SUPPORTER_FILE, ok)
            self.destroy()
        else:
            self.err.set_text(err)
            self.err.show()


# --- the wallpaper
def on_battery():
    try:
        for p in Path("/sys/class/power_supply").iterdir():
            if (p / "type").read_text().strip() == "Mains":
                return (p / "online").read_text().strip() == "0"
    except OSError:
        pass
    return False


class Pond(Gtk.Window):
    def __init__(self, app, monitor):
        super().__init__(title="koipond")
        self.app = app
        geo = monitor.get_geometry()
        self.set_decorated(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)
        self.layer = False
        if GtkLayerShell and GtkLayerShell.is_supported():
            GtkLayerShell.init_for_window(self)
            GtkLayerShell.set_layer(self, GtkLayerShell.Layer.BACKGROUND)
            GtkLayerShell.set_monitor(self, monitor)
            for edge in (GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT):
                GtkLayerShell.set_anchor(self, edge, True)
            GtkLayerShell.set_exclusive_zone(self, -1)
            self.layer = True
        else:
            self.set_type_hint(Gdk.WindowTypeHint.DESKTOP)
            self.set_keep_below(True)
            self.stick()
            self.move(geo.x, geo.y)
        self.set_default_size(geo.width, geo.height)

        ucm = WebKit2.UserContentManager()
        ucm.add_script(WebKit2.UserScript("window.__koiInit = %s;" % json.dumps(app.page_settings()),
                                          WebKit2.UserContentInjectedFrames.TOP_FRAME,
                                          WebKit2.UserScriptInjectionTime.START, None, None))
        self.web = WebKit2.WebView.new_with_user_content_manager(ucm)
        s = self.web.get_settings()
        s.set_enable_webgl(True)
        s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        s.set_allow_file_access_from_file_urls(True)
        s.set_enable_developer_extras(False)
        self.web.set_background_color(Gdk.RGBA(6 / 255, 42 / 255, 51 / 255, 1))
        self.ready = False
        self.web.connect("load-changed", lambda _w, ev: setattr(self, "ready", self.ready or ev == WebKit2.LoadEvent.FINISHED))
        self.web.connect("context-menu", lambda *_: True)  # no browser menu
        self.web.connect("button-press-event", self.on_press)
        self.web.connect("web-process-terminated", lambda w, *_: w.reload())
        self.add(self.web)
        self.web.load_uri((WEB / "index.html").as_uri())
        self.show_all()
        if not self.layer:
            self.move(geo.x, geo.y)
            self.resize(geo.width, geo.height)

    def js(self, script):
        if self.ready:
            try:
                self.web.evaluate_javascript(script, -1, None, None, None, None, None)
            except AttributeError:  # WebKitGTK before 2.40
                self.web.run_javascript(script, None, None, None)

    def on_press(self, _w, ev):
        if ev.button == 3:
            self.app.menu().popup_at_pointer(ev)
            return True
        return False


class App:
    def __init__(self):
        self.settings = {**DEFAULTS, **load_json(SETTINGS_FILE, {})}
        self.ponds = []
        prov = Gtk.CssProvider()
        prov.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), prov, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.display = Gdk.Display.get_default()
        self.build()
        self.display.connect("monitor-added", lambda *_: self.build())
        self.display.connect("monitor-removed", lambda *_: self.build())
        self.card = None
        if ask_due(self.settings) and "KOI_NOASK" not in os.environ:
            GLib.timeout_add(2500, self.first_ask)
        GLib.timeout_add_seconds(30, self.watch_power)
        self.battery = on_battery()
        smoke = os.environ.get("KOI_SMOKE")
        if smoke:
            GLib.timeout_add(8000, self.smoke_a, smoke)

    def build(self):
        for p in self.ponds:
            p.destroy()
        self.ponds = [Pond(self, self.display.get_monitor(i)) for i in range(self.display.get_n_monitors())]

    def page_settings(self):
        s = self.settings
        return {"look": s["look"], "fish": s["fish"], "rain": 0.5 if s["rain"] else 0, "pads": s["pads"],
                "petals": s["petals"], "fps": 30 if on_battery() else 60, "paused": s["paused"]}

    def push(self):
        save_json(SETTINGS_FILE, self.settings)
        for p in self.ponds:
            p.js("window.koi && koi.set(%s)" % json.dumps(self.page_settings()))

    def watch_power(self):
        b = on_battery()
        if b != self.battery:
            self.battery = b
            self.push()
        return True

    def first_ask(self):
        self.settings["asked"] = self.settings.get("asked", 0) + 1
        save_json(SETTINGS_FILE, self.settings)
        self.show_card(False)
        return False

    def show_card(self, key_first):
        if self.card:
            self.card.present()
            return
        self.card = SupportCard(self, key_first)
        self.card.connect("destroy", lambda *_: setattr(self, "card", None))

    def menu(self):
        m = Gtk.Menu()

        def item(label, cb=None, check=None, sensitive=True):
            it = Gtk.CheckMenuItem(label=label) if check is not None else Gtk.MenuItem(label=label)
            if check is not None:
                it.set_active(check)
            it.set_sensitive(sensitive)
            if cb:
                it.connect("activate", lambda *_: cb())
            m.append(it)
            return it

        def setter(k, v):
            def cb():
                self.settings[k] = v
                self.push()
            return cb

        item("koipond", sensitive=False)
        if supporter():
            item("Supporter. Thank you!", sensitive=False)
        else:
            item("Pay what you want…", lambda: webbrowser.open(CHECKOUT))
            item("I have a key…", lambda: self.show_card(True))
        m.append(Gtk.SeparatorMenuItem())
        for k, name in (("natural", "Natural"), ("ink", "Ink"), ("violet", "Dither")):
            item(name, setter("look", k), check=self.settings["look"] == k)
        m.append(Gtk.SeparatorMenuItem())
        koi = Gtk.MenuItem(label="Koi")
        sub = Gtk.Menu()
        for n in (6, 10, 14, 18, 24):
            it = Gtk.CheckMenuItem(label=str(n))
            it.set_active(self.settings["fish"] == n)
            it.connect("activate", lambda _i, n=n: setter("fish", n)())
            sub.append(it)
        koi.set_submenu(sub)
        m.append(koi)
        item("Rain", setter("rain", not self.settings["rain"]), check=self.settings["rain"])
        item("Sakura", setter("petals", not self.settings["petals"]), check=self.settings["petals"])
        item("Lily pads", setter("pads", not self.settings["pads"]), check=self.settings["pads"])
        m.append(Gtk.SeparatorMenuItem())
        item("Resume" if self.settings["paused"] else "Pause", setter("paused", not self.settings["paused"]))
        item("Open at login", self.toggle_login, check=AUTOSTART.exists())
        m.append(Gtk.SeparatorMenuItem())
        item("Quit koipond", Gtk.main_quit)
        m.show_all()
        return m

    def menu_labels(self):
        m = self.menu()
        labels = [i.get_label() for i in m.get_children() if i.get_label()]
        m.destroy()
        return labels

    def toggle_login(self):
        if AUTOSTART.exists():
            AUTOSTART.unlink()
        else:
            AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
            AUTOSTART.write_text("[Desktop Entry]\nType=Application\nName=koipond\nExec=%s %s\nX-GNOME-Autostart-enabled=true\n"
                                 % (sys.executable, Path(__file__).resolve()))

    # testing: KOI_SMOKE=<file> writes what the pond is doing after a few seconds, then quits
    def smoke_a(self, out):
        p = self.ponds[0]
        p.web.evaluate_javascript("window.__frames || 0", -1, None, None, None,
                                  lambda w, r, _d: self.smoke_b(out, w.evaluate_javascript_finish(r).to_int32()), None)
        return False

    def smoke_b(self, out, before):
        def report():
            p = self.ponds[0]
            js = "JSON.stringify({frames: window.__frames || 0, canvas: document.querySelector('canvas') ? document.querySelector('canvas').width : 0})"

            def got(w, r, _d):
                gw = p.get_window()
                hint = p.get_type_hint().value_nick
                Path(out).write_text(json.dumps({
                    "ready": p.ready, "framesBefore": before, "page": json.loads(w.evaluate_javascript_finish(r).to_string()),
                    "layerShell": p.layer, "typeHint": hint, "keepBelow": bool(gw and gw.get_state() & Gdk.WindowState.BELOW),
                    "backend": type(self.display).__name__, "webkit": "%d.%d.%d" % (WebKit2.get_major_version(), WebKit2.get_minor_version(), WebKit2.get_micro_version()),
                    "card": bool(self.card and self.card.get_visible()), "ponds": len(self.ponds),
                    "cardError": self.card.err.get_text() if self.card and self.card.err.get_visible() else "",
                    "menu": self.menu_labels()}))
                Gtk.main_quit()
            p.web.evaluate_javascript(js, -1, None, None, None, got, None)
            return False
        GLib.timeout_add(4000, report)


def main():
    key = os.environ.get("KOI_ACTIVATE")
    if key is not None:  # testing: check a key with the store, print the result and quit
        ok, err = activate(key)
        print("activated %s %s %s" % (MODE, ok["instanceID"], ok["email"]) if ok else "failed %s" % err)
        return
    if not (WEB / "index.html").exists():
        sys.exit("koipond: the pond page is missing (%s)" % WEB)
    # one copy at a time
    lock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        lock.bind("\0koipond-wallpaper-%d" % os.getuid())
    except OSError:
        print("koipond is already running. Right-click the pond for settings.")
        return
    App()
    Gtk.main()


if __name__ == "__main__":
    main()
