"use client";
// koipond — <KoiPond />: a living koi pond for any page.
//
//   <KoiPond fish={9} look="violet" />
//
// Move the pointer slowly and curious koi come to look; move fast and the shy ones dart away.
// Tap the water for ripples, double-tap (or long-press) to drop food. Pauses when off screen and
// shows a still pond for people who prefer reduced motion.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { drawScene, drawTop, drawUnder, stonesFor } from "./draw";
import { createProps3D } from "./props3d";
import { createWater, type Look } from "./gl";
import { createStage } from "./stage";
import { createFish3D } from "./fish3d";
import { Pond, type V } from "./sim";

export const LOOKS: Record<string, Look> = {
  ink: { mode: "ink", palette: ["#000", "#000", "#000", "#000"], deep: "#283850", shallow: "#80998c", tint: "#ffffff", pixel: 1, floor: "pebbles", caustics: 1, clarity: 1, waves: 1 },
  garden: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#4a5552", shallow: "#8a9a91", tint: "#ffffff", pixel: 1, floor: "pebbles", caustics: .45, clarity: .6, waves: .8, bright: .8, film: true, absorb: [1.1, .95, 1.02] },
  lagoon: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#08758c", shallow: "#25b8b4", tint: "#ffffff", pixel: 1, floor: "sand", caustics: 1.2, clarity: 1.0, waves: 1.3, bright: .85 },
  violet: { mode: "dither", palette: ["#09080f", "#2a2160", "#6c5ce7", "#e4dfff"], deep: "#05040a", shallow: "#15122a", pixel: 2 },
  mono: { mode: "dither", palette: ["#0c0c0c", "#3a3a3a", "#9a9a9a", "#f2f0ea"], deep: "#050505", shallow: "#1b1b1b", pixel: 2 },
  ember: { mode: "dither", palette: ["#0d0806", "#5a1f12", "#e2451c", "#fde6c8"], deep: "#070403", shallow: "#1c0f0a", pixel: 2 },
  natural: { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#0a5a6e", shallow: "#2bb3ae", tint: "#f2fffd", pixel: 1, caustics: .7, waves: .8, bright: 1.14, absorb: [2.1, .62, .58] },
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
  /** Number of koi. */
  fish?: number;
  /** Art style: "natural", "ink", "garden", "violet", "ember", "mono", or your own Look. Can change live. */
  look?: keyof typeof LOOKS | Look;
  /** Fish size relative to the short side of the pond. */
  fishSize?: number;
  /** Floating lily pads (some flower). */
  pads?: number;
  /** Sakura petals drifting down onto the water. */
  petals?: number;
  /** Small dark fish darting between the koi. */
  minnows?: number;
  /** Same seed, same pond. */
  seed?: number;
  /** Pointer, taps, feeding and scroll. */
  interactive?: boolean;
  /** 0..1 rain on the surface. */
  rain?: number;
  /** Override parts of the look: water colours, light (caustics), waves. */
  water?: { shallow?: string; deep?: string; caustics?: number; waves?: number; clarity?: number };
  /** A small cluster of rocks in the lower-left corner. */
  border?: boolean;
  /** Scrolling (wheel or swipe) over the pond pushes the water: fish, petals and pads stream with it. */
  scrollCurrent?: boolean;
  /** Over the pond, the pointer becomes a soft ring with a dot (hidden on touch screens). */
  cursor?: boolean;
  /** Resolution of the simulation relative to the element (lower = chunkier, faster). */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const KoiPond = forwardRef<KoiPondHandle, KoiPondProps>(function KoiPond(
  { fish = 12, look = "natural", fishSize = 0.18, pads = 4, petals = 10, minnows = 4, seed = 7, interactive = true, scale = 1, rain = 0.4, water, cursor = true, scrollCurrent = true, border = true, className, style }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<Pond | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  // the look can change at any time without disturbing the fish
  const themeRef = useRef<Look>(LOOKS.violet);
  const base = typeof look === "string" ? LOOKS[look] ?? LOOKS.violet : look;
  themeRef.current = water ? { ...base, ...Object.fromEntries(Object.entries(water).filter(([, v]) => v !== undefined)) } : base;
  if (pondRef.current) pondRef.current.rain = rain;
  const styleName = typeof look === "string" ? look : "natural";
  const styleRef = useRef(styleName); styleRef.current = styleName;
  const borderRef = useRef(border); borderRef.current = border;
  const rainRef = useRef(rain); rainRef.current = rain;
  const dropRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  // where the last tap or click was (0..1): a style change spreads out from there
  const lastTapRef = useRef<[number, number]>([0.5, 0.5]);

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
    // everything on one shared three.js renderer (no copies between GPU contexts)
    let stage: ReturnType<typeof createStage> | null = null;
    try { stage = createStage(canvas); } catch (e) { console.warn("koipond: WebGL2 stage unavailable", e); }
    const water = stage ? null : createWater(canvas);
    if (!stage && !water) return;
    const topLayer = document.createElement("canvas"), tctx = topLayer.getContext("2d")!;
    let fish3d: ReturnType<typeof createFish3D> | null = null;
    if (stage) { try { fish3d = createFish3D(stage.renderer); } catch (e) { console.warn("koipond: 3D koi unavailable", e); } }
    let props3d: ReturnType<typeof createProps3D> | null = null;
    if (stage) { try { props3d = createProps3D(stage.renderer); } catch (e) { console.warn("koipond: 3D props unavailable", e); } }
    const scene = document.createElement("canvas"), sctx = scene.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let pond: Pond | null = null;

    const fit = () => {
      const r = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      if (stage) stage.setSize(Math.round(r.width * dpr), Math.round(r.height * dpr)); else { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
      scene.width = w; scene.height = h; topLayer.width = Math.round(r.width * Math.min(dpr, 1)); topLayer.height = Math.round(r.height * Math.min(dpr, 1));
      if (!pond) { pond = new Pond({ width: w, height: h, fish, fishSize, pads, petals, minnows, seed }); pond.rain = rainRef.current; pondRef.current = pond; }
      else if (w !== pond.w || h !== pond.h) pond.resize(w, h);
      sizeRef.current = { w, h };
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(canvas);

    // pointer → pond coordinates
    const toPond = (e: PointerEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * pond!.w, y: ((e.clientY - r.top) / r.height) * pond!.h, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; };
    let press = 0, pressAt = { x: 0, y: 0 }, lastTap = 0;
    const drop: { x: number; y: number; vx: number; vy: number; tx: number; ty: number; shown: boolean; down: boolean; s?: number } = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, shown: false, down: false };
    const onMove = (e: PointerEvent) => {
      if (!pond) return; const p = toPond(e); pond.setPointer(p.x, p.y, p.inside);
      const r = canvas.getBoundingClientRect(); drop.tx = e.clientX - r.left; drop.ty = e.clientY - r.top; drop.shown = p.inside && e.pointerType !== "touch";
    };
    const onDown = (e: PointerEvent) => {
      if (!pond) return; const p = toPond(e); if (!p.inside) return;
      const now = performance.now();
      if (now - lastTap < 320) pond.feed(p.x, p.y); else pond.splash(p.x, p.y);
      lastTap = now; press = now; pressAt = p; drop.down = true; lastTapRef.current = [p.x / pond.w, p.y / pond.h];
    };
    const onUp = () => { press = 0; drop.down = false; };
    const onAnyDown = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); lastTapRef.current = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    window.addEventListener("pointerdown", onAnyDown);
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
    const manualMode = !!(window as unknown as { __koiManual?: boolean }).__koiManual;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf && !manualMode) { last = performance.now(); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);
    const loop = (now: number) => {
      raf = 0;
      if (!pond) return;
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now; acc += dt;
      if (press && now - press > 550) { pond.feed(pressAt.x, pressAt.y); press = 0; } // long press drops food
      const el = dropRef.current;
      if (el) {
        // a ring that trails the pointer and lies flat on the water, with a small dot at the exact point
        const ease = 1 - Math.exp(-dt * 14);
        drop.x += (drop.tx - drop.x) * ease; drop.y += (drop.ty - drop.y) * ease;
        el.style.opacity = drop.shown ? "1" : "0";
        drop.s = (drop.s ?? 1) + ((drop.down ? 0.72 : 1) - (drop.s ?? 1)) * (1 - Math.exp(-dt * 18));
        const sc = drop.s;
        el.style.transform = `translate(${drop.x}px, ${drop.y}px) translate(-50%, -50%) scale(${sc})`;
        if (dotRef.current) { dotRef.current.style.opacity = drop.shown ? "1" : "0"; dotRef.current.style.transform = `translate(${drop.tx}px, ${drop.ty}px) translate(-50%, -50%)`; }
        el.style.willChange = "transform";
      }
      const fl = Math.hypot(flow.x, flow.y); if (fl > 1.6) { flow.x *= 1.6 / fl; flow.y *= 1.6 / fl; }
      flow.x *= Math.exp(-dt * 1.4); flow.y *= Math.exp(-dt * 1.4);
      if (scrollCurrent) pond.current = { x: flow.x, y: flow.y };
      pond.style = styleRef.current; pond.border = borderRef.current ? Math.min(pond.w, pond.h) * 0.06 : 0;
      while (acc >= 1 / 60) { pond.step(1 / 60); acc -= 1 / 60; }
      if (stage) {
        const cssW = Math.round(canvas.width / dpr), cssH = Math.round(canvas.height / dpr);
        drawUnder(sctx, pond, 0.8, false);
        props3d?.render(pond, cssW, cssH, pond.border > 0 ? stonesFor(pond).stones : []);
        drawTop(tctx, pond, props3d ? true : undefined);
        fish3d?.render(pond, cssW, cssH);
        stage.render({ under: scene, top: topLayer, pond, look: themeRef.current, dpr, fish: fish3d?.texture ?? null, props: props3d?.texture ?? null, origin: lastTapRef.current });
      }
      else { drawScene(sctx, pond); water!.render(scene, pond.w, pond.h, pond.ripples, pond.t, themeRef.current, dpr); }
      if (visible && !reduced) raf = requestAnimationFrame(loop);
    };
    if (reduced) { for (let i = 0; i < 120; i++) pond!.step(1 / 60); }
    // frame-exact capture (for recording videos): the page drives frames itself via window.__koiFrame(dt)
    const manual = (window as unknown as { __koiManual?: boolean }).__koiManual;
    if (manual) {
      let simNow = performance.now(); last = simNow;
      (window as unknown as { __koiFrame?: (dt: number) => void }).__koiFrame = (dt: number) => { last = simNow; simNow += dt * 1000; visible = false; loop(simNow); };
    } else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointerdown", onAnyDown);
      window.removeEventListener("wheel", onWheel); window.removeEventListener("touchmove", onTouchMove); window.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); window.removeEventListener("pointerup", onUp);
      pondRef.current = null; fish3d?.dispose(); props3d?.dispose(); stage?.dispose();
    };
  }, [minnows, seed, interactive, scale, scrollCurrent]); // eslint-disable-line react-hooks/exhaustive-deps

  // live settings: the pond eases into the new values instead of being rebuilt
  useEffect(() => { pondRef.current?.setFishCount(fish); }, [fish]);
  useEffect(() => { pondRef.current?.setFishSize(fishSize); }, [fishSize]);
  useEffect(() => { pondRef.current?.setPadCount(pads); }, [pads]);
  useEffect(() => { pondRef.current?.setPetalCount(petals); }, [petals]);

  return (
    <div className={className} style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", ...style }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "manipulation", cursor: cursor && interactive ? "none" : undefined }} />
      {cursor && interactive && (
        <>
          <div ref={dropRef} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 30, height: 30, borderRadius: "50%", pointerEvents: "none", opacity: 0, transition: "opacity .3s", border: "1.5px solid rgba(255,255,255,.7)", willChange: "transform", boxShadow: "0 0 12px rgba(255,255,255,.12)" }} />
          <div ref={dotRef} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 5, height: 5, borderRadius: "50%", pointerEvents: "none", opacity: 0, transition: "opacity .3s", background: "rgba(255,255,255,.95)", boxShadow: "0 0 6px rgba(255,255,255,.6)" }} />
        </>
      )}
    </div>
  );
});
