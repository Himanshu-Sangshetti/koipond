"use client";
// koipond — <KoiPond />: a living koi pond for any page.
//
//   <KoiPond fish={9} look="violet" />
//
// Move the pointer slowly and curious koi come to look; move fast and the shy ones dart away.
// Tap the water for ripples, double-tap (or long-press) to drop food. Pauses when off screen and
// shows a still pond for people who prefer reduced motion.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { drawScene, drawTop, drawUnder } from "./draw";
import { createWater, type Look } from "./gl";
import { createRealWater } from "./water";
import { Pond, type V } from "./sim";

export const LOOKS: Record<string, Look> = {
  violet: { mode: "dither", palette: ["#09080f", "#2a2160", "#6c5ce7", "#e4dfff"], deep: "#05040a", shallow: "#15122a", pixel: 2 },
  ink: { mode: "dither", palette: ["#0c0c0c", "#3a3a3a", "#9a9a9a", "#f2f0ea"], deep: "#050505", shallow: "#1b1b1b", pixel: 2 },
  ember: { mode: "dither", palette: ["#0d0806", "#5a1f12", "#e2451c", "#fde6c8"], deep: "#070403", shallow: "#1c0f0a", pixel: 2 },
  natural: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#062a3c", shallow: "#14525a", tint: "#f2fbff", pixel: 1 },
};

export interface KoiPondHandle {
  feed(x: number, y: number): void;
  ripple(x: number, y: number): void;
  /** Hold a shape: one slot per fish (0..1 coordinates), plus the swim direction at each slot. */
  formation(slots: V[] | null, flow?: V[]): void;
  /** Push the water: fish and pads drift with it. */
  current(x: number, y: number): void;
  pond(): Pond | null;
}

export interface KoiPondProps {
  fish?: number;
  look?: keyof typeof LOOKS | Look;
  /** Fish size relative to the short side of the pond. */
  fishSize?: number;
  pads?: number;
  seed?: number;
  interactive?: boolean;
  /** Resolution of the simulation relative to the element (lower = chunkier, faster). */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const KoiPond = forwardRef<KoiPondHandle, KoiPondProps>(function KoiPond(
  { fish = 9, look = "violet", fishSize = 0.14, pads = 3, seed = 7, interactive = true, scale = 1, className, style }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<Pond | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  // the look can change at any time without disturbing the fish
  const themeRef = useRef<Look>(LOOKS.violet);
  themeRef.current = typeof look === "string" ? LOOKS[look] ?? LOOKS.violet : look;

  useImperativeHandle(ref, () => ({
    feed: (x, y) => pondRef.current?.feed(x * sizeRef.current.w, y * sizeRef.current.h),
    ripple: (x, y) => pondRef.current?.ripple(x * sizeRef.current.w, y * sizeRef.current.h, "tap"),
    formation: (slots, flow) => pondRef.current?.setFormation(slots && slots.map((s) => ({ x: s.x * sizeRef.current.w, y: s.y * sizeRef.current.h })), flow),
    current: (x, y) => { if (pondRef.current) pondRef.current.current = { x, y }; },
    pond: () => pondRef.current,
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // realistic WebGL2 water when available; the simple stylised water otherwise
    let real: ReturnType<typeof createRealWater> = null;
    try { real = createRealWater(canvas); } catch (e) { console.warn("koipond: realistic water unavailable", e); }
    const water = real ? null : createWater(canvas);
    if (!real && !water) return;
    const topLayer = document.createElement("canvas"), tctx = topLayer.getContext("2d")!;
    const scene = document.createElement("canvas"), sctx = scene.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let pond: Pond | null = null;

    const fit = () => {
      const r = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      scene.width = w; scene.height = h; topLayer.width = w; topLayer.height = h;
      if (!pond) { pond = new Pond({ width: w, height: h, fish, fishSize, pads, seed }); pondRef.current = pond; }
      else if (w !== pond.w || h !== pond.h) pond.resize(w, h);
      sizeRef.current = { w, h };
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(canvas);

    // pointer → pond coordinates
    const toPond = (e: PointerEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * pond!.w, y: ((e.clientY - r.top) / r.height) * pond!.h, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; };
    let press = 0, pressAt = { x: 0, y: 0 }, lastTap = 0;
    const onMove = (e: PointerEvent) => { if (!pond) return; const p = toPond(e); pond.setPointer(p.x, p.y, p.inside); };
    const onDown = (e: PointerEvent) => {
      if (!pond) return; const p = toPond(e); if (!p.inside) return;
      const now = performance.now();
      if (now - lastTap < 320) pond.feed(p.x, p.y); else pond.ripple(p.x, p.y, "tap");
      lastTap = now; press = now; pressAt = p;
    };
    const onUp = () => { press = 0; };
    if (interactive) { canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerdown", onDown); window.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", () => pond && pond.setPointer(pond.pointer.x, pond.pointer.y, false)); }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = performance.now(), acc = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);
    const loop = (now: number) => {
      raf = 0;
      if (!pond) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
      if (press && now - press > 550) { pond.feed(pressAt.x, pressAt.y); press = 0; } // long press drops food
      while (acc >= 1 / 60) { pond.step(1 / 60); acc -= 1 / 60; }
      if (real) { drawUnder(sctx, pond); drawTop(tctx, pond); real.render(scene, topLayer, pond.w, pond.h, pond.ripples, pond.t, themeRef.current, dpr); }
      else { drawScene(sctx, pond); water!.render(scene, pond.w, pond.h, pond.ripples, pond.t, themeRef.current, dpr); }
      if (visible && !reduced) raf = requestAnimationFrame(loop);
    };
    if (reduced) { for (let i = 0; i < 120; i++) pond!.step(1 / 60); }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); window.removeEventListener("pointerup", onUp);
      pondRef.current = null;
    };
  }, [fish, fishSize, pads, seed, interactive, scale]);

  return <canvas ref={canvasRef} className={className} style={{ display: "block", width: "100%", height: "100%", touchAction: "manipulation", ...style }} />;
});
