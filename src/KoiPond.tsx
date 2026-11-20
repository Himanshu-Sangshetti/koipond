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
import { createFish3D } from "./fish3d";
import { Pond, type V } from "./sim";

export const LOOKS: Record<string, Look> = {
  ink: { mode: "ink", palette: ["#000", "#000", "#000", "#000"], deep: "#283850", shallow: "#80998c", tint: "#ffffff", pixel: 1, floor: "pebbles", caustics: 1, clarity: 1, waves: 1 },
  garden: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#46544b", shallow: "#7f9c86", tint: "#ffffff", pixel: 1, floor: "pebbles", caustics: .4, clarity: .55, waves: .8, bright: .78, film: true, absorb: [1.25, .78, 1.15] },
  lagoon: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#08758c", shallow: "#25b8b4", tint: "#ffffff", pixel: 1, floor: "sand", caustics: 1.2, clarity: 1.0, waves: 1.3, bright: .85 },
  violet: { mode: "dither", palette: ["#09080f", "#2a2160", "#6c5ce7", "#e4dfff"], deep: "#05040a", shallow: "#15122a", pixel: 2 },
  mono: { mode: "dither", palette: ["#0c0c0c", "#3a3a3a", "#9a9a9a", "#f2f0ea"], deep: "#050505", shallow: "#1b1b1b", pixel: 2 },
  ember: { mode: "dither", palette: ["#0d0806", "#5a1f12", "#e2451c", "#fde6c8"], deep: "#070403", shallow: "#1c0f0a", pixel: 2 },
  natural: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#062a3c", shallow: "#14525a", tint: "#f2fbff", pixel: 1, caustics: .4, waves: .8 },
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
  petals?: number;
  minnows?: number;
  seed?: number;
  interactive?: boolean;
  /** 0..1 rain on the surface. */
  rain?: number;
  /** Override parts of the look: water colours, light (caustics), waves. */
  water?: { shallow?: string; deep?: string; caustics?: number; waves?: number; clarity?: number };
  /** Scrolling (wheel or swipe) over the pond pushes the water: fish, petals and pads stream with it. */
  scrollCurrent?: boolean;
  /** Replace the pointer over the pond with a droplet that stretches as it moves through the water. */
  cursor?: boolean;
  /** Resolution of the simulation relative to the element (lower = chunkier, faster). */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const KoiPond = forwardRef<KoiPondHandle, KoiPondProps>(function KoiPond(
  { fish = 9, look = "violet", fishSize = 0.14, pads = 3, petals = 9, minnows = 0, seed = 7, interactive = true, scale = 1, rain = 0, water, cursor = true, scrollCurrent = true, className, style }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<Pond | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  // the look can change at any time without disturbing the fish
  const themeRef = useRef<Look>(LOOKS.violet);
  const base = typeof look === "string" ? LOOKS[look] ?? LOOKS.violet : look;
  themeRef.current = water ? { ...base, ...Object.fromEntries(Object.entries(water).filter(([, v]) => v !== undefined)) } : base;
  if (pondRef.current) pondRef.current.rain = rain;
  const rainRef = useRef(rain); rainRef.current = rain;
  const dropRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

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
    let fish3d: ReturnType<typeof createFish3D> | null = null;
    if (real) { try { fish3d = createFish3D(); } catch (e) { console.warn("koipond: 3D koi unavailable", e); } }
    if (fish3d && location.search.includes("pondraw")) (window as unknown as { __koi3d?: HTMLCanvasElement }).__koi3d = fish3d.canvas;
    const scene = document.createElement("canvas"), sctx = scene.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let pond: Pond | null = null;

    const fit = () => {
      const r = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      scene.width = w; scene.height = h; topLayer.width = canvas.width; topLayer.height = canvas.height;
      if (!pond) { pond = new Pond({ width: w, height: h, fish, fishSize, pads, petals, minnows, seed }); pond.rain = rainRef.current; pondRef.current = pond; }
      else if (w !== pond.w || h !== pond.h) pond.resize(w, h);
      sizeRef.current = { w, h };
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(canvas);

    // pointer → pond coordinates
    const toPond = (e: PointerEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * pond!.w, y: ((e.clientY - r.top) / r.height) * pond!.h, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; };
    let press = 0, pressAt = { x: 0, y: 0 }, lastTap = 0;
    const drop = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, shown: false, down: false };
    const onMove = (e: PointerEvent) => {
      if (!pond) return; const p = toPond(e); pond.setPointer(p.x, p.y, p.inside);
      const r = canvas.getBoundingClientRect(); drop.tx = e.clientX - r.left; drop.ty = e.clientY - r.top; drop.shown = p.inside && e.pointerType !== "touch";
    };
    const onDown = (e: PointerEvent) => {
      if (!pond) return; const p = toPond(e); if (!p.inside) return;
      const now = performance.now();
      if (now - lastTap < 320) pond.feed(p.x, p.y); else pond.ripple(p.x, p.y, "tap");
      lastTap = now; press = now; pressAt = p; drop.down = true;
    };
    const onUp = () => { press = 0; drop.down = false; };
    if (interactive) { canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerdown", onDown); window.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", () => pond && pond.setPointer(pond.pointer.x, pond.pointer.y, false)); }

    // scroll becomes a current through the water; it eases off when you stop
    const flow = { x: 0, y: 0 };
    let lastTouch: { x: number; y: number } | null = null;
    const onWheel = (e: WheelEvent) => { flow.x += e.deltaX * 0.0016; flow.y += e.deltaY * 0.0016; };
    const onTouchMove = (e: TouchEvent) => { const t0 = e.touches[0]; if (!t0) return; if (lastTouch) { flow.x -= (t0.clientX - lastTouch.x) * 0.004; flow.y -= (t0.clientY - lastTouch.y) * 0.004; } lastTouch = { x: t0.clientX, y: t0.clientY }; };
    const onTouchEnd = () => { lastTouch = null; };
    if (scrollCurrent) { window.addEventListener("wheel", onWheel, { passive: true }); window.addEventListener("touchmove", onTouchMove, { passive: true }); window.addEventListener("touchend", onTouchEnd); }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = performance.now(), acc = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);
    const loop = (now: number) => {
      raf = 0;
      if (!pond) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
      if (press && now - press > 550) { pond.feed(pressAt.x, pressAt.y); press = 0; } // long press drops food
      const el = dropRef.current;
      if (el) {
        // a ring that trails the pointer and lies flat on the water, with a small dot at the exact point
        drop.x += (drop.tx - drop.x) * 0.16; drop.y += (drop.ty - drop.y) * 0.16;
        el.style.opacity = drop.shown ? "1" : "0";
        const sc = drop.down ? 1.35 : 1;
        el.style.transform = `translate(${drop.x}px, ${drop.y}px) translate(-50%, -50%) scale(${sc})`;
        if (dotRef.current) { dotRef.current.style.opacity = drop.shown ? "1" : "0"; dotRef.current.style.transform = `translate(${drop.tx}px, ${drop.ty}px) translate(-50%, -50%)`; }
      }
      const fl = Math.hypot(flow.x, flow.y); if (fl > 1.6) { flow.x *= 1.6 / fl; flow.y *= 1.6 / fl; }
      flow.x *= Math.exp(-dt * 1.4); flow.y *= Math.exp(-dt * 1.4);
      if (scrollCurrent) pond.current = { x: flow.x, y: flow.y };
      while (acc >= 1 / 60) { pond.step(1 / 60); acc -= 1 / 60; }
      if (real) { drawUnder(sctx, pond, 0.8, false); drawTop(tctx, pond); fish3d?.render(pond, canvas.width, canvas.height); real.render(scene, topLayer, pond.w, pond.h, pond.ripples, pond.t, themeRef.current, dpr, 2, pond, fish3d?.canvas); }
      else { drawScene(sctx, pond); water!.render(scene, pond.w, pond.h, pond.ripples, pond.t, themeRef.current, dpr); }
      if (visible && !reduced) raf = requestAnimationFrame(loop);
    };
    if (reduced) { for (let i = 0; i < 120; i++) pond!.step(1 / 60); }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener("wheel", onWheel); window.removeEventListener("touchmove", onTouchMove); window.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); window.removeEventListener("pointerup", onUp);
      pondRef.current = null; fish3d?.dispose();
    };
  }, [fish, fishSize, pads, petals, minnows, seed, interactive, scale, scrollCurrent]);

  return (
    <div className={className} style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", ...style }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "manipulation", cursor: cursor && interactive ? "none" : undefined }} />
      {cursor && interactive && (
        <>
          <div ref={dropRef} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 30, height: 30, borderRadius: "50%", pointerEvents: "none", opacity: 0, transition: "opacity .3s", border: "1px solid rgba(255,255,255,.6)", boxShadow: "0 0 12px rgba(255,255,255,.12)" }} />
          <div ref={dotRef} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 5, height: 5, borderRadius: "50%", pointerEvents: "none", opacity: 0, transition: "opacity .3s", background: "rgba(255,255,255,.95)", boxShadow: "0 0 6px rgba(255,255,255,.6)" }} />
        </>
      )}
    </div>
  );
});
