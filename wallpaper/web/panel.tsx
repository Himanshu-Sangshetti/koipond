// The pop-up panel of the desktop app: looks, focus timer and settings.
// The native app owns the state; this page shows it (`panel.sync`) and sends changes back.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./panel.css";
import natural from "../../demo/public/style-natural.jpg";
import ink from "../../demo/public/style-ink.jpg";
import dither from "../../demo/public/style-dither.jpg";

type Settings = { look: string; fish: number; size: number; rain: boolean; rainAmount: number; pads: boolean; petals: boolean; interactive: boolean; quality: string; login: boolean; showIcon: boolean };
type Timer = { mode: "focus" | "break"; left: number; running: boolean };
type Support = { supporter: boolean; email: string; ask: boolean; busy: boolean; error: string };
type State = { settings: Settings; timer: Timer; support: Support };

declare global {
  interface Window { panel: { sync(s: State): void }; webkit?: { messageHandlers: { koi: { postMessage(m: unknown): void } } } }
}
const send = (m: Record<string, unknown>) => { try { window.webkit?.messageHandlers.koi.postMessage(m); } catch { /* not in the app */ } };
const set = (k: keyof Settings, v: unknown) => send({ t: "set", k, v });

let current: State = {
  settings: { look: "natural", fish: 14, size: 0.18, rain: true, rainAmount: 0.5, pads: true, petals: true, interactive: true, quality: "balanced", login: false, showIcon: true },
  timer: { mode: "focus", left: 25 * 60, running: false },
  support: { supporter: false, email: "", ask: false, busy: false, error: "" },
};
const listeners = new Set<(s: State) => void>();
window.panel = { sync(s) { current = s; listeners.forEach((l) => l(s)); } };

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <div className="row"><span>{label}</span><span>{show}</span></div>
      <div className="track">
        <div className="bar" /><div className="fill" style={{ width: `${pct}%` }} /><div className="knob" style={{ left: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </label>
  );
}
const Toggle = ({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) => (
  <button className={`toggle ${on ? "on" : ""}`} onClick={onClick}>{label}<span className="sw" /></button>
);

function Panel() {
  const [st, setSt] = useState(current);
  const [stars, setStars] = useState<number | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  useEffect(() => {
    fetch("https://api.github.com/repos/Himanshu-Sangshetti/koipond").then((r) => (r.ok ? r.json() : null)).then((d) => d && setStars(d.stargazers_count)).catch(() => {});
  }, []);
  useEffect(() => { listeners.add(setSt); send({ t: "ready" }); return () => { listeners.delete(setSt); }; }, []);
  // the app sizes its window to fit the panel (the optional support card and key box add height)
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheetRef.current; if (!el) return;
    let last = 0; // measured as content plus the border
    const ro = new ResizeObserver(() => { const h = Math.ceil(el.scrollHeight + el.offsetHeight - el.clientHeight); if (h !== last) { last = h; send({ t: "size", v: h }); } });
    ro.observe(el); [...el.children].forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  });
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && send({ t: "close" }); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const s = st.settings, t = st.timer, sup = st.support ?? current.support;
  const activate = () => key.trim() && send({ t: "activate", v: key.trim() });
  const mmss = `${String(Math.floor(t.left / 60)).padStart(2, "0")}:${String(t.left % 60).padStart(2, "0")}`;
  return (
    <div className="sheet" ref={sheetRef}>
      {sup.ask && !sup.supporter && (
        <div className="card ask">
          <p className="at">koipond is free for everyone</p>
          <p className="ad">If it makes your desk a little calmer, you can pay what you want. Supporters also get the new wallpapers as they come out, every 2 weeks to a month.</p>
          <div className="ab">
            <button className="primary" onClick={() => send({ t: "pay" })}>Pay what you want</button>
            <button className="plain" onClick={() => send({ t: "skip" })}>Continue free</button>
          </div>
        </div>
      )}
      <div>
        <p className="label">Look</p>
        <div className="looks">
          {([["natural", "Natural", natural], ["ink", "Ink", ink], ["violet", "Dither", dither]] as const).map(([id, name, img]) => (
            <button key={id} className={`look ${s.look === id ? "on" : ""}`} onClick={() => set("look", id)}><img src={img} alt="" />{name}</button>
          ))}
        </div>
      </div>

      <div className="card timer">
        <div>
          <div className="tt">{mmss}</div>
          <div className="tm">{t.mode === "focus" ? "focus" : "break"}</div>
        </div>
        <div className="grow" />
        <button className="ghost" onClick={() => send({ t: "timer", a: "reset" })} aria-label="Reset timer">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
        </button>
        <button className="round" onClick={() => send({ t: "timer", a: "toggle" })} aria-label={t.running ? "Pause timer" : "Start timer"}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">{t.running ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5l11 7-11 7z" />}</svg>
        </button>
      </div>


      <div>
        <Slider label="Koi" value={s.fish} min={1} max={24} step={1} show={String(s.fish)} onChange={(v) => set("fish", v)} />
        <Slider label="Size" value={s.size} min={0.08} max={0.26} step={0.01} show={s.size.toFixed(2)} onChange={(v) => set("size", v)} />
        <Slider label="Rain" value={s.rain ? s.rainAmount : 0} min={0} max={1} step={0.05} show={(s.rain ? s.rainAmount : 0).toFixed(2)} onChange={(v) => set("rainAmount", v)} />
      </div>
      <div className="toggles">
        <Toggle label="Lilies" on={s.pads} onClick={() => set("pads", !s.pads)} />
        <Toggle label="Sakura" on={s.petals} onClick={() => set("petals", !s.petals)} />
        <Toggle label="Mouse" on={s.interactive} onClick={() => set("interactive", !s.interactive)} />
        <Toggle label="At login" on={s.login} onClick={() => set("login", !s.login)} />
      </div>

      <div>
        <p className="label">Performance</p>
        <div className="seg">
          {([["smooth", "Smooth"], ["balanced", "Balanced"], ["saver", "Saver"]] as const).map(([id, name]) => (
            <button key={id} className={s.quality === id ? "on" : ""} onClick={() => set("quality", id)}>{name}</button>
          ))}
        </div>
      </div>

      {sup.ask && !sup.supporter ? null : sup.supporter ? (
        <div className="star thanks">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z" /></svg>
          <span>Supporter. Thank you!</span>
        </div>
      ) : (
        <div className="support">
          <button className="star paybtn" onClick={() => send({ t: "pay" })}>
            <span>Pay what you want</span><span className="from">from $3</span>
          </button>
          <p className="paynote">koipond is free. Supporters get the new wallpapers as they come out, every 2 weeks to a month.</p>
          {!keyOpen ? (
            <button className="havekey" onClick={() => setKeyOpen(true)}>I have a key</button>
          ) : (
            <div className="keyrow">
              <input autoFocus value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && activate()} placeholder="Paste your key" aria-label="Supporter key" spellCheck={false} />
              <button onClick={activate} disabled={sup.busy}>{sup.busy ? "Checking…" : "Activate"}</button>
            </div>
          )}
          {keyOpen && sup.error && <p className="keyerr">{sup.error}</p>}
        </div>
      )}
      <button className="star" onClick={() => send({ t: "open", v: "https://github.com/Himanshu-Sangshetti/koipond" })}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        <span>Star koipond on GitHub</span>{stars !== null && <span className="count">★ {stars}</span>}
      </button>

      <div className="foot">
        <button onClick={() => set("showIcon", !s.showIcon)}>{s.showIcon ? "Hide menu bar icon" : "Show menu bar icon"}</button>
        <button onClick={() => send({ t: "quit" })}>Quit</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Panel />);
