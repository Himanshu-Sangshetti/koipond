// The pond as a desktop wallpaper. The native app (Mac / Windows) loads this page behind the desktop
// icons, lets clicks pass through to the desktop, and forwards the real mouse to us through `koi.*`.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { KoiPond } from "koipond";

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
    };
  }
}

// --- frame gate: the app can pause the pond (desktop hidden, screen asleep) and cap the frame rate (battery)
let settings: Settings = { ...DEFAULTS, ...(window.__koiInit ?? {}) };
// render resolution: a wallpaper doesn't need full Retina; the pond reads devicePixelRatio once at start
if (settings.dpr) { const d = settings.dpr; Object.defineProperty(window, "devicePixelRatio", { get: () => d }); }
const raf0 = window.requestAnimationFrame.bind(window);
const held: FrameRequestCallback[] = [];
let lastFrame = 0;
window.requestAnimationFrame = (cb: FrameRequestCallback) =>
  raf0(function tick(t) {
    if (settings.paused) { held.push(cb); return; }
    if (t - lastFrame < 1000 / settings.fps - 2) { raf0(tick); return; }
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

const listeners = new Set<(s: Settings) => void>();
window.koi = {
  set(s) {
    const wasPaused = settings.paused;
    settings = { ...settings, ...s };
    if (wasPaused && !settings.paused) resume();
    listeners.forEach((l) => l(settings));
  },
  move: (x, y) => ptr("pointermove", x, y),
  down: (x, y) => { ptr("pointermove", x, y); ptr("pointerdown", x, y, 1); },
  up: (x, y) => ptr("pointerup", x, y),
  leave: () => canvas()?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })),
  wheel: (dx, dy) => window.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy })),
};

function Wallpaper() {
  const [s, setS] = useState(settings);
  useEffect(() => { listeners.add(setS); return () => { listeners.delete(setS); }; }, []);
  return (
    <KoiPond
      look={s.look}
      fish={s.fish}
      rain={s.rain}
      pads={s.pads ? 4 : 0}
      petals={s.petals ? 10 : 0}
      cursor={false}
      water={{ caustics: 2.1, waves: 1.9 }}
      style={{ position: "fixed", inset: 0 }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Wallpaper />);
