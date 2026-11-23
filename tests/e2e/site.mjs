// The demo site's "Desktop app" sheet: free install, optional pay-what-you-want checkout, thank-you screen.
// Serves demo/dist (run `npx vite build` in demo/ first) and clicks through it in headless Chrome.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, checks, wait } from "./cdp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "demo/dist");
const LIVE_PRODUCT = "pdt_0NsYIva9ea1hMacA3xaaB";
const INSTALL = "curl -fsSL https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.sh | sh";
const INSTALL_WIN = "irm https://raw.githubusercontent.com/Himanshu-Sangshetti/koipond/main/wallpaper/install.ps1 | iex";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { if (path.extname(f)) { res.writeHead(404).end(); return; } f = path.join(dist, "index.html"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const c = checks("site");
const p = await launch();
await p.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
const has = (sel) => p.eval(`!!document.querySelector(${JSON.stringify(sel)})`);
const clip = () => p.eval("navigator.clipboard.readText()");

// a Linux browser, the same on every machine that runs this
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
await p.size(1440, 900);
await p.open(origin + "/");
c.ok(await has("canvas"), "the pond renders");
c.ok(!(await has(".wallsheet")), "the sheet is closed on a normal visit");
await p.click("Desktop app");
c.ok(await has(".wallsheet"), "'Desktop app' opens the sheet");
c.ok((await p.eval("document.querySelector('.wallsheet').innerText")).includes("Free for everyone"), "the sheet says it is free");
c.ok(await p.eval("document.querySelector('.wos button.on')?.innerText === 'Linux'"), "this browser's system (Linux) is picked by default");
await p.click("Mac");
await p.click(".wallsheet .wcmd");
c.ok((await clip()) === INSTALL, "Mac: Copy copies the full install command");
c.ok((await p.eval("document.querySelector('.wsteps').innerText")).includes("Terminal"), "Mac: the steps say to open Terminal");
await p.click("Windows");
c.ok((await p.eval("document.querySelector('.wallsheet').innerText")).includes("PowerShell"), "Windows: says to use PowerShell");
await p.click(".wallsheet .wcmd");
c.ok((await clip()) === INSTALL_WIN, "Windows: Copy copies the PowerShell install command");
c.ok(await p.eval("document.querySelectorAll('.wsteps li').length === 3"), "Windows: three steps");
await p.click("Linux");
await p.click(".wallsheet .wcmd");
c.ok((await clip()) === INSTALL, "Linux: Copy copies the install command");
c.ok((await p.eval("document.querySelector('.wsteps').innerText")).includes("Shift"), "Linux: says to paste with Ctrl+Shift+V");
const pay = await p.eval("document.querySelector('.wpay')?.href");
const u = pay && new URL(pay);
c.ok(u && u.host === "checkout.dodopayments.com" && u.pathname === `/buy/${LIVE_PRODUCT}`, "'Pay what you want' goes to the live Dodo product", pay);
c.ok(u && u.searchParams.get("redirect_url") === "https://koipond-demo.vercel.app/?thanks", "checkout returns to the thank-you screen", u && u.searchParams.get("redirect_url"));
c.ok(await p.eval("document.querySelector('.wpay').target === '_blank'"), "checkout opens in a new tab");
await p.click("Desktop app");
c.ok(!(await has(".wallsheet")), "'Desktop app' closes the sheet again");

await p.open(origin + "/?get");
c.ok(await has(".wallsheet") && await has(".wpay"), "?get (the receipt link) opens the sheet");

await p.open(origin + "/?thanks&payment_id=pay_x&status=succeeded&license_key=11111111-2222-3333-4444-555555555555&email=a%40example.com");
const thanks = await p.eval("document.querySelector('.wallsheet')?.innerText || ''");
c.ok(thanks.includes("Thank you for supporting koipond"), "a paid return shows the thank-you screen");
c.ok(thanks.includes("11111111-2222-3333-4444-555555555555"), "the thank-you screen shows the key");
c.ok(!(await has(".wpay")), "no pay button after paying");
c.ok(thanks.includes("right-click the pond"), "the key instructions match the system (Linux)");
await p.click(".wallsheet .wcopy");
c.ok((await clip()) === "11111111-2222-3333-4444-555555555555", "Copy copies the key");

await p.open(origin + "/?thanks&status=failed");
const failed = await p.eval("document.querySelector('.wallsheet')?.innerText || ''");
c.ok(!failed.includes("Thank you") && (await has(".wpay")), "a failed payment shows the normal sheet so they can try again");

await p.size(390, 844, true);
await p.open(origin + "/?get");
c.ok(await p.eval("document.documentElement.scrollWidth <= innerWidth"), "no sideways scroll on a phone");
c.ok(await p.eval("(() => { const r = document.querySelector('.wallsheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()"), "the sheet fits a phone screen");
c.ok(p.errors.length === 0, "no script errors", p.errors);
p.close(); server.close(); c.done();
