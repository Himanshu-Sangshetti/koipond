import { useEffect, useRef, useState } from "react";
import { KoiPond, type KoiPondHandle } from "koipond";

const STYLES = [
  { id: "natural", label: "Natural", thumb: "/style-natural.jpg" },
  { id: "ink", label: "Ink", thumb: "/style-ink.jpg" },
  { id: "violet", label: "Dither", thumb: "/style-dither.jpg" },
] as const;
type StyleId = (typeof STYLES)[number]["id"];
type Settings = { fish: number; size: number; caustics: number; waves: number; rain: number; pads: boolean; petals: boolean };
const DEFAULTS: Settings = { fish: 18, size: 0.18, caustics: 2.1, waves: 1.9, rain: 0.65, pads: true, petals: true };

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
  // small screens get fewer koi so the pond doesn't feel crowded
  const [s, setS] = useState<Settings>(() => ({ ...DEFAULTS, fish: typeof window !== "undefined" && Math.min(innerWidth, innerHeight) < 700 ? 9 : DEFAULTS.fish }));
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const [stars, setStars] = useState<number | null>(null);
  const [bare, setBare] = useState(false);       // full screen: only the pond
  const pondRef = useRef<KoiPondHandle>(null);
  // music: Spotify's own embedded player (no login needed; full tracks for signed-in Spotify users)
  const [music, setMusic] = useState(false);
  const [embed, setEmbed] = useState("playlist/6jTot6wOCMCSfAnvg6WL5A");
  const [link, setLink] = useState("");
  const playLink = () => { const m = link.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/); if (m) { setEmbed(`${m[1]}/${m[2]}`); setLink(""); } };
  // pomodoro: 25 min focus, 5 min break
  const [timer, setTimer] = useState({ mode: "focus" as "focus" | "break", left: 25 * 60, running: false });
  useEffect(() => {
    if (!timer.running) { document.title = "koipond"; return; }
    const id = setInterval(() => setTimer((t) => {
      if (t.left > 1) return { ...t, left: t.left - 1 };
      // the session is over: the koi gather and the water rings
      pondRef.current?.ripple(0.5, 0.5); pondRef.current?.feed(0.5, 0.5);
      return t.mode === "focus" ? { mode: "break", left: 5 * 60, running: true } : { mode: "focus", left: 25 * 60, running: false };
    }), 1000);
    return () => clearInterval(id);
  }, [timer.running]);
  const mmss = `${String(Math.floor(timer.left / 60)).padStart(2, "0")}:${String(timer.left % 60).padStart(2, "0")}`;
  useEffect(() => { if (timer.running) document.title = `${mmss} · ${timer.mode} · koipond`; }, [mmss, timer.running, timer.mode]);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setBare(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const fullscreen = () => document.documentElement.requestFullscreen?.().then(() => setBare(true)).catch(() => setBare(true));
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));
  useEffect(() => { const id = setTimeout(() => setHint(false), 7000); return () => clearTimeout(id); }, []);
  // star count: GitHub first, shields.io if GitHub is rate-limited; the last known count is remembered
  useEffect(() => {
    try { const c = localStorage.getItem("koipond-stars"); if (c) setStars(Number(c)); } catch { /* storage off */ }
    const keep = (n: number) => { setStars(n); try { localStorage.setItem("koipond-stars", String(n)); } catch { /* storage off */ } };
    fetch("https://api.github.com/repos/Himanshu-Sangshetti/koipond").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => keep(d.stargazers_count))
      .catch(() => fetch("https://img.shields.io/github/stars/Himanshu-Sangshetti/koipond.json").then((r) => r.json()).then((d) => { const n = parseInt(d.value, 10); if (!Number.isNaN(n)) keep(n); }).catch(() => {}));
  }, []);

  return (
    <>
      <KoiPond ref={pondRef} className="pond" look={look} fish={s.fish} fishSize={s.size} pads={s.pads ? 4 : 0} petals={s.petals ? 10 : 0} minnows={4} rain={s.rain} water={{ caustics: s.caustics, waves: s.waves }} />
      {/* the music player stays mounted (keeps playing) in full screen */}
      <div className={`music ${music ? "" : "closed"}`}>
        <iframe title="Spotify" src={`https://open.spotify.com/embed/${embed}?utm_source=generator&theme=0`} width="100%" height="152" frameBorder={0} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
        <div className="mlink">
          <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playLink()} placeholder="paste a Spotify link" aria-label="Spotify link" />
          <button onClick={playLink}>Play</button>
        </div>
      </div>
      {/* timer and music stay with you in full screen */}
      <div className="dock">
        <div className={`timer ${timer.running ? "on" : ""}`}>
          <button className="tmain" onClick={() => setTimer((t) => ({ ...t, running: !t.running }))} aria-label={timer.running ? "Pause timer" : "Start timer"}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">{timer.running ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5l11 7-11 7z" />}</svg>
            <span className="tt">{mmss}</span><span className="tm">{timer.mode}</span>
          </button>
          <button className="treset" onClick={() => setTimer({ mode: "focus", left: 25 * 60, running: false })} aria-label="Reset timer">↺</button>
        </div>
        {bare && (
          <button className="musicbtn" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); setBare(false); }} aria-label="Exit full screen">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
          </button>
        )}
        <button className={`musicbtn ${music ? "on" : ""}`} onClick={() => setMusic((m) => !m)} aria-label="Music">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
        </button>
      </div>
      {!bare && <>
      <div className="title"><h1>koipond</h1><p style={{ opacity: hint ? 1 : 0 }}>{touch ? "tap · double-tap to feed · swipe to stir" : "glide · tap · double-tap to feed · scroll to stir"}</p></div>
      <nav className="links">
        <a href="https://github.com/Himanshu-Sangshetti/koipond" target="_blank" rel="noreferrer" aria-label="koipond on GitHub">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          {stars !== null && <span className="star">★ {stars}</span>}
        </a>
        <button className="linkbtn" onClick={fullscreen} aria-label="Full screen">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </nav>
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
