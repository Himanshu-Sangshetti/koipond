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
  const [stars, setStars] = useState<number | null>(null);
  const [wall, setWall] = useState(false);       // the "use as wallpaper" sheet
  const [bare, setBare] = useState(false);       // ?wallpaper or full screen: only the pond
  useEffect(() => {
    if (new URLSearchParams(location.search).has("wallpaper")) setBare(true);
    fetch("https://api.github.com/repos/Himanshu-Sangshetti/koipond").then((r) => r.json()).then((d) => typeof d.stargazers_count === "number" && setStars(d.stargazers_count)).catch(() => {});
    const onFs = () => { if (!document.fullscreenElement) setBare(new URLSearchParams(location.search).has("wallpaper")); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const fullscreen = () => { setWall(false); document.documentElement.requestFullscreen?.().then(() => setBare(true)).catch(() => {}); };
  const wallUrl = "https://koipond-demo.vercel.app/?wallpaper";
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));
  useEffect(() => { const id = setTimeout(() => setHint(false), 7000); return () => clearTimeout(id); }, []);

  return (
    <>
      <KoiPond className="pond" look={look} fish={s.fish} fishSize={s.size} pads={s.pads ? 4 : 0} petals={s.petals ? 10 : 0} minnows={4} rain={s.rain} water={{ caustics: s.caustics, waves: s.waves }} />
      {!bare && <>
      <div className="title"><h1>koipond</h1><p style={{ opacity: hint ? 1 : 0 }}>glide · tap · double-tap to feed · scroll to stir</p></div>
      <nav className="links">
        <a href="https://github.com/Himanshu-Sangshetti/koipond" target="_blank" rel="noreferrer" aria-label="koipond on GitHub">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          <span className="star">★ {stars ?? "–"}</span>
        </a>
        <button className="linkbtn" onClick={() => setWall((w) => !w)}>Wallpaper</button>
      </nav>
      {wall && (
        <div className="wallsheet">
          <p className="wt">Make it your wallpaper</p>
          <button className="wrow" onClick={fullscreen}><b>Full screen</b><span>right now, in this tab</span></button>
          <a className="wrow" href="https://sindresorhus.com/plash" target="_blank" rel="noreferrer"><b>Mac desktop</b><span>with Plash: add the link below as a website</span></a>
          <a className="wrow" href="https://www.rocksdanister.com/lively/" target="_blank" rel="noreferrer"><b>Windows desktop</b><span>with Lively Wallpaper: add the link below</span></a>
          <button className="wcopy" onClick={() => navigator.clipboard?.writeText(wallUrl)}>{wallUrl.replace("https://", "")} <span>copy</span></button>
        </div>
      )}
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
      </>}
    </>
  );
}
