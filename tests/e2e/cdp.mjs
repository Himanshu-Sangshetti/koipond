// A tiny Chrome DevTools client for the end-to-end checks: no dependencies, just Chrome and Node 22+.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || ({
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
}[process.platform] ?? "google-chrome");

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koi-e2e-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await wait(150);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!target) throw new Error("Chrome did not start (set CHROME to its path)");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, (d) => (d.error ? j(new Error(method + ": " + d.error.message)) : r(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const page = {
    send, errors,
    async eval(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    async size(width, height, mobile = false) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }); },
    async open(url, beforeLoad) { if (beforeLoad) await send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad }); await send("Page.navigate", { url }); await wait(400); for (let i = 0; i < 60; i++) { if (await page.eval("document.readyState") === "complete") break; await wait(100); } await wait(600); },
    /** a real mouse click in the middle of the first element matching the selector (or a button with that exact text) */
    async click(selOrText) {
      const box = await page.eval(`(() => { const t = ${JSON.stringify(selOrText)}; const e = document.querySelector(t.startsWith("text=") ? "x-none" : t) || [...document.querySelectorAll("button,a")].find((b) => b.innerText.trim() === t.replace(/^text=/, "")); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      if (!box) throw new Error("nothing to click: " + selOrText);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
      await wait(250);
    },
    async type(text) { await send("Input.insertText", { text }); await wait(150); },
    async shot(file) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return page;
}

/** Collects named checks and exits non-zero if any failed. */
export function checks(name) {
  let failed = 0;
  return {
    ok(cond, what, detail) { console.log(`${cond ? "ok  " : "FAIL"}  ${what}${!cond && detail !== undefined ? "  (" + JSON.stringify(detail) + ")" : ""}`); if (!cond) failed++; },
    done() { console.log(failed ? `${name}: ${failed} check(s) failed` : `${name}: all checks passed`); process.exitCode = failed ? 1 : 0; },
  };
}
