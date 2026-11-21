// The pond as a desktop wallpaper. The native app (Mac / Windows) loads this page behind the desktop
// icons, lets clicks pass through to the desktop, and forwards the real mouse to us through `koi.*`.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { KoiPond, type KoiPondHandle } from "koipond";

type Settings = { look: "natural" | "ink" | "violet"; fish: number; rain: number; pads: boolean; petals: boolean; fps: number; paused: boolean; dpr?: number };
const DEFAULTS: Settings = { look: "natural", fish: 14, rain: 0.5, pads: true, petals: true, fps: 60, paused: false };

declare global {
  interface Window {
    __koiInit?: Partial<Settings>;
    koi: {
      set(s: Partial<Settings>): void;
      move(x: number, y: number): void;
      down(x: number, y: number): void;
      up(x: number, y: number): void;
      leave(): void;
      wheel(dx: number, dy: number): void;
      gather(): void;
      edge(near: number): void;
    };
  }
}

// --- frame gate: the app can pause the pond (desktop hidden, screen asleep) and cap the frame rate (battery)
let settings: Settings = { ...DEFAULTS, ...(window.__koiInit ?? {}) };
// render resolution: a wallpaper doesn't need full Retina; the pond reads devicePixelRatio once at start
if (settings.dpr) { const d = settings.dpr; Object.defineProperty(window, "devicePixelRatio", { get: () => d }); }
// while the mouse is on the pond it runs at full rate, so wakes and splashes follow the cursor smoothly;
// a couple of quiet seconds later it settles back to the chosen rate
let lastTouch = -1e9;
const fpsNow = () => (performance.now() - lastTouch < 2000 ? Math.max(settings.fps, 60) : settings.fps);
const raf0 = window.requestAnimationFrame.bind(window);
const held: FrameRequestCallback[] = [];
let lastFrame = 0;
window.requestAnimationFrame = (cb: FrameRequestCallback) =>
  raf0(function tick(t) {
    if (settings.paused) { held.push(cb); return; }
    // too early: sleep until the next frame is due instead of waking on every display refresh
    const wait = 1000 / fpsNow() - 2 - (t - lastFrame);
    if (wait > 0) { setTimeout(() => raf0(tick), Math.max(0, wait - 8)); return; }
    lastFrame = t;
    (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
    cb(t);
  });
const resume = () => { while (held.length) window.requestAnimationFrame(held.shift()!); };

// --- forwarded mouse: dispatch the same events a browser would, so the component needs no changes
const canvas = () => document.querySelector("canvas");
const ptr = (type: string, x: number, y: number, buttons = 0) => {
  const init = { clientX: x, clientY: y, pointerType: "mouse", isPrimary: true, pointerId: 1, bubbles: true, buttons };
  (type === "pointerup" ? window : canvas())?.dispatchEvent(new PointerEvent(type, init));
};

let pond: KoiPondHandle | null = null;
const listeners = new Set<(s: Settings) => void>();
window.koi = {
  set(s) {
    const wasPaused = settings.paused;
    settings = { ...settings, ...s };
    if (wasPaused && !settings.paused) resume();
    listeners.forEach((l) => l(settings));
  },
  move: (x, y) => { lastTouch = performance.now(); ptr("pointermove", x, y); },
  down: (x, y) => { lastTouch = performance.now(); ptr("pointermove", x, y); ptr("pointerdown", x, y, 1); },
  up: (x, y) => ptr("pointerup", x, y),
  leave: () => canvas()?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })),
  wheel: (dx, dy) => { lastTouch = performance.now(); window.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy })); },
  // a focus session ended: rings spread from the middle and the koi gather there
  // the panel's hidden edge: a faint handle that wakes up as the cursor comes near
  edge: (near) => { const h = document.getElementById("edge"); if (h) { h.style.opacity = String(0.22 + near * 0.6); h.style.transform = `translateY(-50%) scaleY(${1 + near * 0.5})`; } },
  gather: () => { pond?.ripple(0.5, 0.5); pond?.feed(0.5, 0.5); },
};

function Wallpaper() {
  const [s, setS] = useState(settings);
  const ref = useRef<KoiPondHandle>(null);
  useEffect(() => { pond = ref.current; });
  useEffect(() => { listeners.add(setS); return () => { listeners.delete(setS); }; }, []);
  return (
    <>
    <KoiPond
      ref={ref}
      look={s.look}
      fishSize={s.size ?? 0.18}
      fish={s.fish}
      rain={s.rain}
      pads={s.pads ? 4 : 0}
      petals={s.petals ? 10 : 0}
      cursor={false}
      water={{ caustics: 2.1, waves: 1.9 }}
      style={{ position: "fixed", inset: 0 }}
    />
    <div id="edge" style={{ position: "fixed", right: 3, top: "50%", width: 4, height: 56, borderRadius: 3, background: "rgba(255,255,255,.9)", opacity: 0.22, transform: "translateY(-50%)", transition: "opacity .25s, transform .25s", pointerEvents: "none", boxShadow: "0 0 10px rgba(255,255,255,.25)" }} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Wallpaper />);
