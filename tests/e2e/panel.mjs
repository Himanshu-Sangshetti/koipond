// The desktop app's panel page: the optional "pay what you want" card, "I have a key", supporter state,
// and that every button sends the right message to the app. Run after `npm run build:web` in wallpaper/.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, checks, wait } from "./cdp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const url = "file://" + path.join(root, "wallpaper/build/web/panel.html");
const c = checks("panel");
const p = await launch();
await p.size(340, 900);
await p.open(url, "window.__sent=[];window.webkit={messageHandlers:{koi:{postMessage:(m)=>window.__sent.push(m)}}};");

const base = { settings: { look: "natural", fish: 14, size: 0.18, rain: true, rainAmount: 0.5, pads: true, petals: true, interactive: true, quality: "balanced", login: false, showIcon: true }, timer: { mode: "focus", left: 1500, running: false } };
const sync = async (support) => { await p.eval(`panel.sync(${JSON.stringify({ ...base, support: { supporter: false, email: "", ask: false, busy: false, error: "", ...support } })})`); await wait(300); };
// every height the panel asks for, kept across reads (the ResizeObserver reports a moment later)
const sizes = [];
const sent = async () => { const m = await p.eval("window.__sent.splice(0)"); sizes.push(...m.filter((x) => x.t === "size").map((x) => x.v)); return m; };
const has = (sel) => p.eval(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = () => p.eval("document.body.innerText");

c.ok((await sent()).some((m) => m.t === "ready"), "the panel tells the app it is ready");

await sync({ ask: true });
c.ok(await has(".ask"), "the card shows when the app asks for it");
c.ok((await text()).includes("koipond is free for everyone"), "the card says the app is free");
await sent(); const sizes0 = sizes.splice(0);
await p.click("Pay what you want");
c.ok((await sent()).some((m) => m.t === "pay"), "'Pay what you want' asks the app to open the checkout");
await p.click("Continue free");
c.ok((await sent()).some((m) => m.t === "skip"), "'Continue free' closes the card");

await sync({});
c.ok(!(await has(".ask")), "no card once it was answered");
for (let i = 0; i < 20 && !(sizes.length && sizes.at(-1) < Math.max(...sizes0)); i++) { await wait(100); await sent(); }
const sizes1 = sizes.splice(0);
c.ok(sizes0.length && sizes1.length && Math.max(...sizes0) > sizes1.at(-1), "the panel asks for less height without the card", { sizes0, sizes1 });
c.ok((await text()).includes("koipond is free.") && (await text()).includes("from $3"), "the support row is always there");
await p.click(".support .star");
c.ok((await sent()).some((m) => m.t === "pay"), "the support row opens the checkout too");

await p.click("I have a key");
c.ok(await has(".keyrow input"), "'I have a key' shows the key box");
await p.click(".keyrow input"); await p.type("  koipond-key-123  ");
await p.click("Activate");
const act = (await sent()).find((m) => m.t === "activate");
c.ok(act && act.v === "koipond-key-123", "Activate sends the trimmed key", act);
await p.click(".keyrow input"); await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await wait(200);
c.ok((await sent()).some((m) => m.t === "activate"), "Enter in the key box activates too");

await sync({ busy: true });
c.ok(await p.eval("document.querySelector('.keyrow button').disabled && document.querySelector('.keyrow button').innerText.includes('Checking')"), "the button waits while the key is checked");
await sync({ error: "That key wasn't found. Check it was pasted in full." });
c.ok((await text()).includes("That key wasn't found"), "a refused key shows why");

await sync({ supporter: true, email: "a@example.com" });
c.ok((await text()).includes("Supporter. Thank you!"), "a supporter sees the thank-you row");
c.ok(!(await text()).includes("Pay what you want") && !(await has(".keyrow")), "a supporter is never asked to pay");
await sync({ supporter: true, ask: true });
c.ok(!(await has(".ask")), "the card never shows for a supporter, even if asked");

// the rest of the panel still works
await p.click(".look:nth-child(2)");
c.ok((await sent()).some((m) => m.t === "set" && m.k === "look" && m.v === "ink"), "choosing a look tells the app");
await p.click("[aria-label='Start timer']");
c.ok((await sent()).some((m) => m.t === "timer" && m.a === "toggle"), "the timer button tells the app");
c.ok(await p.eval("(() => { const s = document.querySelector('.sheet'); return s.scrollHeight <= innerHeight + 1; })()"), "the whole panel fits once the app sizes the window");
c.ok(p.errors.length === 0, "no script errors", p.errors);
p.close(); c.done();
