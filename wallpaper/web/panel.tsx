// The pop-up panel of the desktop app: looks, focus timer, music and settings.
// The native app owns the state; this page shows it (`panel.sync`) and sends changes back.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./panel.css";
import natural from "../../demo/public/style-natural.jpg";
import ink from "../../demo/public/style-ink.jpg";
import dither from "../../demo/public/style-dither.jpg";

type Settings = { look: string; fish: number; size: number; rain: boolean; rainAmount: number; pads: boolean; petals: boolean; interactive: boolean; quality: string; login: boolean; showIcon: boolean };
type Timer = { mode: "focus" | "break"; left: number; running: boolean };
type State = { settings: Settings; timer: Timer; music: string };

declare global {
  interface Window { panel: { sync(s: State): void }; webkit?: { messageHandlers: { koi: { postMessage(m: unknown): void } } } }
}
const send = (m: Record<string, unknown>) => { try { window.webkit?.messageHandlers.koi.postMessage(m); } catch { /* not in the app */ } };
const set = (k: keyof Settings, v: unknown) => send({ t: "set", k, v });

let current: State = {
  settings: { look: "natural", fish: 14, size: 0.18, rain: true, rainAmount: 0.5, pads: true, petals: true, interactive: true, quality: "balanced", login: false, showIcon: true },
  timer: { mode: "focus", left: 25 * 60, running: false }, music: "playlist/6jTot6wOCMCSfAnvg6WL5A",
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
  const [link, setLink] = useState("");
  useEffect(() => { listeners.add(setSt); send({ t: "ready" }); return () => { listeners.delete(setSt); }; }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && send({ t: "close" }); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const s = st.settings, t = st.timer;
  const mmss = `${String(Math.floor(t.left / 60)).padStart(2, "0")}:${String(t.left % 60).padStart(2, "0")}`;
  const playLink = () => {
    const m = link.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/);
    if (m) { send({ t: "music", v: `${m[1]}/${m[2]}` }); setLink(""); }
  };
  return (
    <div className="sheet">
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

      <div className="card music">
        <iframe title="Spotify" src={`https://open.spotify.com/embed/${st.music}?utm_source=generator&theme=0`} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
        <div className="mlink">
          <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playLink()} placeholder="paste a Spotify link" aria-label="Spotify link" />
          <button onClick={playLink}>Play</button>
        </div>
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

      <div className="foot">
        <button onClick={() => set("showIcon", !s.showIcon)}>{s.showIcon ? "Hide menu bar icon" : "Show menu bar icon"}</button>
        <button onClick={() => send({ t: "quit" })}>Quit</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Panel />);
