"""Checks for the Linux app's optional store: key answers, when the card shows, and Dodo's live key check.
Run: python3 linux/tests/test_store.py   (KOI_NETWORK=1 also calls the live key server with a made-up key)"""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["XDG_CONFIG_HOME"] = tempfile.mkdtemp()
os.environ.pop("KOI_STORE", None)
spec = importlib.util.spec_from_file_location("koipond", Path(__file__).resolve().parents[1] / "koipond.py")
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)

fails = 0


def check(name, ok):
    global fails
    print(("ok    " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1


body = lambda pid: json.dumps({"id": "lki_1", "product": {"product_id": pid}, "customer": {"email": "a@b.c"}})
check("live store by default", k.MODE == "live" and k.API == "https://live.dodopayments.com")
check("checkout goes to the live product", k.CHECKOUT.startswith("https://checkout.dodopayments.com/buy/pdt_0NsYIva9ea1hMacA3xaaB?quantity=1"))
check("checkout comes back to the thank-you page", "redirect_url=https%3A%2F%2Fkoipond-demo.vercel.app%2F%3Fthanks" in k.CHECKOUT)
ok, err = k.parse(body(k.PRODUCT_ID), 201, "  KEY-1 \n")
check("a good key makes a supporter", ok and ok["key"] == "KEY-1" and ok["instanceID"] == "lki_1" and err is None)
check("a key for another product is refused", k.parse(body("pdt_other"), 200, "K")[1] == "That key is for a different product.")
check("an unknown key", "wasn't found" in k.parse("", 404, "K")[1])
check("a refunded key", "turned off" in k.parse("", 403, "K")[1])
check("a key on too many computers", "5 computers" in k.parse("", 422, "K")[1])
check("a server error", "(500)" in k.parse("", 500, "K")[1])
check("a garbled answer", "(200)" in k.parse("not json", 200, "K")[1])

s = dict(k.DEFAULTS)
now = 1_800_000_000
check("the card shows on first open", k.ask_due(s, now))
s["asked"] = 1
check("not again the next day", not k.ask_due(s, now + 86400))
check("once more after a week", k.ask_due(s, now + 7 * 86400))
s["asked"] = 2
check("then never", not k.ask_due(s, now + 60 * 86400))
s["asked"] = 0
k.save_json(k.SUPPORTER_FILE, ok)
check("never for supporters", not k.ask_due(s, now) and k.supporter()["key"] == "KEY-1")

if os.environ.get("KOI_NETWORK") == "1":
    _, err = k.activate("KOIPOND-NOT-A-REAL-KEY")
    check("the live key server answers (made-up key: not found)", err is not None and "wasn't found" in err)

print("%d failed" % fails if fails else "all store checks passed")
sys.exit(1 if fails else 0)
