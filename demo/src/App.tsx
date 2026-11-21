import { useEffect, useState } from "react";
import { KoiPond } from "koipond";

const STYLES = [
  { id: "natural", label: "Natural", thumb: "/style-natural.jpg" },
  { id: "ink", label: "Ink", thumb: "/style-ink.jpg" },
  { id: "violet", label: "Dither", thumb: "/style-dither.jpg" },
] as const;
type StyleId = (typeof STYLES)[number]["id"];
type Settings = { fish: number; size: number; caustics: number; waves: number; rain: number; pads: boolean; petals: boolean };
const DEFAULTS: Settings = { fish: 15, size: 0.18, caustics: 2.1, waves: 1.9, rain: 0.65, pads: true, petals: true };

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <div className="row"><span>{label}</span><span>{Number.isInteger(step) ? value : value.toFixed(1)}</span></div>
      <div className="track">
        <div className="bar" /><div className="fill" style={{ width: `${pct}%` }} /><div className="knob" style={{ left: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </label>
  );
}

export function App() {
  const [look, setLook] = useState<StyleId>("natural");
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));
  useEffect(() => { const id = setTimeout(() => setHint(false), 7000); return () => clearTimeout(id); }, []);

  return (
    <>
      <KoiPond className="pond" look={look} fish={s.fish} fishSize={s.size} pads={s.pads ? 4 : 0} petals={s.petals ? 10 : 0} minnows={4} rain={s.rain} water={{ caustics: s.caustics, waves: s.waves }} />
      <div className="title"><h1>koipond</h1><p style={{ opacity: hint ? 1 : 0 }}>glide · tap · double-tap to feed · scroll to stir</p></div>
      <nav className="links"><a href="https://github.com/Himanshu-Sangshetti/koipond" target="_blank" rel="noreferrer">GitHub</a></nav>
      <div className="switch">
        {STYLES.map((st) => (
          <button key={st.id} className={look === st.id ? "on" : ""} onClick={() => setLook(st.id)} title={st.label}>
            <img src={st.thumb} alt="" /><span className="label">{st.label}</span>
          </button>
        ))}
      </div>
      <div className="settings">
        <div className={`panel ${open ? "" : "closed"}`}>
          <Slider label="Koi" value={s.fish} min={1} max={24} step={1} onChange={(v) => set("fish", v)} />
          <Slider label="Size" value={s.size} min={0.08} max={0.26} step={0.01} onChange={(v) => set("size", v)} />
          <Slider label="Light" value={s.caustics} min={0} max={2.5} step={0.1} onChange={(v) => set("caustics", v)} />
          <Slider label="Waves" value={s.waves} min={0} max={3} step={0.1} onChange={(v) => set("waves", v)} />
          <Slider label="Rain" value={s.rain} min={0} max={1} step={0.05} onChange={(v) => set("rain", v)} />
          <div className="toggles">
            <button className={`toggle ${s.pads ? "on" : ""}`} onClick={() => set("pads", !s.pads)}>Lilies<span className="sw" /></button>
            <button className={`toggle ${s.petals ? "on" : ""}`} onClick={() => set("petals", !s.petals)}>Sakura<span className="sw" /></button>
          </div>
          <button className="reset" onClick={() => setS(DEFAULTS)}>Reset</button>
        </div>
        <button className={`gear ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={open ? "Close settings" : "Open settings"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>}
          </svg>
        </button>
      </div>
    </>
  );
}
