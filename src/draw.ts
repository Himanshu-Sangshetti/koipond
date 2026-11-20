// koipond — drawing the scene (fish, pads, food, shadows) into a 2D canvas.
// The water itself, ripples and the dither are done afterwards on the GPU (see gl.ts).
import type { Fish, Pond, V } from "./sim";

const TAU = Math.PI * 2;

/** Half-width of the body at s (0 nose → 1 tail root), as a fraction of girth. Round head, long taper. */
function profile(s: number) {
  if (s < 0.22) return 0.6 + 0.4 * Math.sin((s / 0.22) * Math.PI * 0.5);
  const k = (s - 0.22) / 0.78;
  return 0.08 + 0.92 * Math.pow(Math.cos(k * Math.PI * 0.5), 1.1);
}

type Frame = { p: V[]; tx: number[]; ty: number[]; L: V[]; R: V[] };

function frame(pond: Pond, f: Fish): Frame {
  const p = pond.pose(f), n = p.length, tx: number[] = [], ty: number[] = [], L: V[] = [], R: V[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
    let x = a.x - b.x, y = a.y - b.y; const l = Math.hypot(x, y) || 1; x /= l; y /= l;
    tx.push(x); ty.push(y);
    const w = f.girth * profile(i / (n - 1));
    L.push({ x: p[i].x - y * w, y: p[i].y + x * w }); R.push({ x: p[i].x + y * w, y: p[i].y - x * w });
  }
  return { p, tx, ty, L, R };
}

function bodyPath(ctx: CanvasRenderingContext2D, g: Frame, f: Fish, ox = 0, oy = 0) {
  const { p, tx, ty, L, R } = g, n = p.length;
  ctx.beginPath();
  // rounded snout: an arc across the head
  const hw = f.girth * profile(0);
  const ang = Math.atan2(ty[0], tx[0]);
  ctx.arc(p[0].x + ox, p[0].y + oy, hw, ang - Math.PI / 2 - 0.0001, ang + Math.PI / 2 + 0.0001, true);
  for (let i = 0; i < n; i++) ctx.lineTo(R[i].x + ox, R[i].y + oy);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(L[i].x + ox, L[i].y + oy);
  ctx.closePath();
}

/** Point on the body at (u along, v across), using the posed spine. */
function onBody(g: Frame, f: Fish, u: number, v: number): { x: number; y: number; a: number; w: number } {
  const n = g.p.length, fi = u * (n - 1), i = Math.min(n - 2, Math.floor(fi)), k = fi - i;
  const x = g.p[i].x + (g.p[i + 1].x - g.p[i].x) * k, y = g.p[i].y + (g.p[i + 1].y - g.p[i].y) * k;
  const tx = g.tx[i], ty = g.ty[i], w = f.girth * profile(u);
  return { x: x - ty * w * v, y: y + tx * w * v, a: Math.atan2(ty, tx), w };
}

function tailFan(ctx: CanvasRenderingContext2D, g: Frame, f: Fish, ox = 0, oy = 0) {
  // a forked, flowing tail: two soft lobes that follow the trailing tail chain
  const n = g.p.length, root = g.p[n - 1], mid = f.tail[1], tip = f.tail[f.tail.length - 1];
  let dx = tip.x - root.x, dy = tip.y - root.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  const nx = -dy, ny = dx, spread = f.girth * 1.15, reach = f.girth * 0.7;
  const lobe = (side: number) => {
    const ex = tip.x + nx * spread * side + dx * reach, ey = tip.y + ny * spread * side + dy * reach;
    ctx.moveTo(root.x + nx * f.girth * 0.12 * side + ox, root.y + ny * f.girth * 0.12 * side + oy);
    ctx.bezierCurveTo(mid.x + nx * spread * 0.55 * side + ox, mid.y + ny * spread * 0.55 * side + oy, ex - dx * reach * 0.6 + ox, ey - dy * reach * 0.6 + oy, ex + ox, ey + oy);
    ctx.quadraticCurveTo(tip.x + dx * reach * 0.15 + nx * spread * 0.2 * side + ox, tip.y + dy * reach * 0.15 + ny * spread * 0.2 * side + oy, tip.x + ox, tip.y + oy);
    ctx.lineTo(root.x + ox, root.y + oy);
  };
  ctx.beginPath(); lobe(1); lobe(-1); ctx.closePath();
}

function fins(ctx: CanvasRenderingContext2D, g: Frame, f: Fish, ox = 0, oy = 0) {
  // pectoral fins sweep with a slow paddle; the fin on the inside of a turn tucks in
  const paddle = 0.5 + 0.5 * Math.sin(f.finPhase * 2.2);
  for (const side of [1, -1]) {
    const tuck = 1 - Math.max(0, side * f.turn) * 0.35;
    for (const [u, size] of [[0.24, 1], [0.58, 0.5]] as const) {
      const b = onBody(g, f, u, side);
      const back = b.a + Math.PI, out = b.a + side * Math.PI / 2;
      const reach = f.girth * (0.9 + paddle * 0.5) * size * tuck;
      // the fin points out and back from the body
      const ang = Math.atan2(Math.sin(out) * 0.6 + Math.sin(back) * 0.4, Math.cos(out) * 0.6 + Math.cos(back) * 0.4);
      const tx = b.x + Math.cos(ang) * reach, ty = b.y + Math.sin(ang) * reach;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(b.a) * f.girth * 0.35 * size + ox, b.y + Math.sin(b.a) * f.girth * 0.35 * size + oy);
      ctx.quadraticCurveTo(tx + Math.cos(b.a) * reach * 0.4 + ox, ty + Math.sin(b.a) * reach * 0.4 + oy, tx + ox, ty + oy);
      ctx.lineTo(b.x - Math.cos(b.a) * f.girth * 0.5 * size + ox, b.y - Math.sin(b.a) * f.girth * 0.5 * size + oy);
      ctx.closePath(); ctx.fill();
    }
  }
}

/** Darken a hex colour (for flanks) or lighten it (for the back). */
function shade(hexc: string, k: number) {
  const n = parseInt(hexc.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Everything under the surface: shadows on the floor, then the fish (deepest first). */
export function drawUnder(ctx: CanvasRenderingContext2D, pond: Pond, shadow = 0.55) {
  const W = ctx.canvas.width, H = ctx.canvas.height, sx = W / pond.w, sy = H / pond.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(sx, 0, 0, sy, 0, 0);
  const fishes = [...pond.fish].sort((a, b) => b.depth - a.depth);
  const frames = new Map(fishes.map((f) => [f, frame(pond, f)]));
  const unit = Math.min(pond.w, pond.h) * 0.11;

  // shadows: fish near the surface throw softer shadows further away; pads shade the floor too
  ctx.save();
  for (const f of fishes) {
    const g = frames.get(f)!, off = unit * (0.1 + (1 - f.depth) * 0.3);
    ctx.filter = `blur(${Math.max(1, unit * (0.05 + (1 - f.depth) * 0.08) * sx)}px)`;
    ctx.fillStyle = `rgba(0,0,0,${shadow * (0.45 + f.depth * 0.4)})`;
    bodyPath(ctx, g, f, off * 0.45, off); ctx.fill(); tailFan(ctx, g, f, off * 0.45, off); ctx.fill(); fins(ctx, g, f, off * 0.45, off);
  }
  ctx.filter = `blur(${Math.max(1, unit * 0.12 * sx)}px)`; ctx.fillStyle = `rgba(0,0,0,${shadow * 0.75})`;
  for (const p of pond.pads) { padPath(ctx, p.x + p.r * 0.35, p.y + p.r * 0.5, p.r, p.angle, p.notch); ctx.fill(); }
  ctx.fillStyle = `rgba(0,0,0,${shadow * 0.5})`;
  for (const p of pond.petals) { petalPath(ctx, p.x + unit * 0.06, p.y + unit * 0.09, p.r, p.angle); ctx.fill(); }
  ctx.restore();

  for (const f of fishes) {
    const g = frames.get(f)!, v = f.variety, fade = 1;
    // fins and tail: thin and translucent, with rays
    ctx.globalAlpha = 0.66; ctx.fillStyle = shade(v.fin, 0.3); tailFan(ctx, g, f); ctx.fill(); fins(ctx, g, f);
    ctx.save(); tailFan(ctx, g, f); ctx.clip();
    ctx.globalAlpha = fade * 0.25; ctx.strokeStyle = shade(v.fin, 0.4); ctx.lineWidth = Math.max(0.3, f.girth * 0.05);
    const root = g.p[g.p.length - 1];
    for (let k = -4; k <= 4; k++) { const tip = f.tail[f.tail.length - 1], dx = tip.x - root.x, dy = tip.y - root.y, l = Math.hypot(dx, dy) || 1; ctx.beginPath(); ctx.moveTo(root.x, root.y); ctx.lineTo(tip.x + (-dy / l) * f.girth * 0.3 * k + dx * 0.4, tip.y + (dx / l) * f.girth * 0.3 * k + dy * 0.4); ctx.stroke(); }
    ctx.restore();

    // body: base colour, then volume — darker flanks, a lit back
    ctx.globalAlpha = fade; ctx.fillStyle = v.base; bodyPath(ctx, g, f); ctx.fill();
    ctx.save(); bodyPath(ctx, g, f); ctx.clip();
    for (const s of f.spots) {
      const b = onBody(g, f, s.u, s.v);
      ctx.filter = `blur(${Math.max(0.3, f.girth * 0.05 * sx)}px)`; ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, f.length * s.ru, Math.max(0.5, b.w * s.rv), b.a, 0, TAU); ctx.fill();
    }
    ctx.filter = `blur(${Math.max(0.5, f.girth * 0.35 * sx)}px)`;
    ctx.strokeStyle = shade(v.base, -0.42); ctx.globalAlpha = fade * 0.5; ctx.lineWidth = f.girth * 0.75; bodyPath(ctx, g, f); ctx.stroke();
    ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = fade * 0.3; ctx.lineWidth = f.girth * 0.55; ctx.lineCap = "round";
    ctx.beginPath(); const s0 = onBody(g, f, 0.08, 0); ctx.moveTo(s0.x, s0.y); for (const u of [0.2, 0.34, 0.48, 0.62]) { const b = onBody(g, f, u, 0); ctx.lineTo(b.x, b.y); } ctx.stroke();
    // scales: a faint net of small arcs over the body
    ctx.filter = "none"; ctx.globalAlpha = fade * 0.12; ctx.strokeStyle = shade(v.base, -0.5); ctx.lineWidth = Math.max(0.25, f.girth * 0.04);
    for (let u = 0.16; u < 0.86; u += 0.055) for (let vv = -0.7; vv <= 0.71; vv += 0.35) {
      const b = onBody(g, f, u + (Math.round(vv / 0.35) % 2 ? 0.027 : 0), vv), r = f.girth * 0.17;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, b.a + Math.PI * 0.5, b.a + Math.PI * 1.5); ctx.stroke();
    }
    // deeper fish are seen through more water: a green-blue haze over the body
    ctx.globalAlpha = Math.min(0.45, f.depth * 0.45); ctx.fillStyle = "#123c3c"; ctx.fillRect(f.x - f.length * 2, f.y - f.length * 2, f.length * 4, f.length * 4);
    ctx.restore();
    // a small wet glint on the head and shoulders
    ctx.globalAlpha = fade * 0.5; ctx.fillStyle = "#ffffff"; ctx.filter = `blur(${Math.max(0.4, f.girth * 0.12 * sx)}px)`;
    { const b = onBody(g, f, 0.14, -0.25); ctx.beginPath(); ctx.ellipse(b.x, b.y, f.girth * 0.45, f.girth * 0.16, b.a, 0, TAU); ctx.fill(); }
    ctx.filter = "none";
    // eyes
    ctx.globalAlpha = fade * 0.9; ctx.fillStyle = "#0b0a0d";
    for (const side of [1, -1]) { const e = onBody(g, f, 0.07, side * 0.66); ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(0.4, f.girth * 0.12), 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

/** Things floating on the surface: food and lily pads. */
export function drawTop(ctx: CanvasRenderingContext2D, pond: Pond) {
  const W = ctx.canvas.width, H = ctx.canvas.height, sx = W / pond.w, sy = H / pond.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(sx, 0, 0, sy, 0, 0);
  const unit = Math.min(pond.w, pond.h) * 0.11;
  for (const p of pond.pellets) {
    const r = Math.max(0.8, unit * 0.04);
    const grd = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
    grd.addColorStop(0, "#f0d79a"); grd.addColorStop(1, "#9c7436");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }
  for (const p of pond.petals) {
    // a cherry-blossom petal: pale pink, deeper at the base, a little curled
    const grd = ctx.createLinearGradient(p.x - Math.cos(p.angle) * p.r, p.y - Math.sin(p.angle) * p.r, p.x + Math.cos(p.angle) * p.r, p.y + Math.sin(p.angle) * p.r);
    grd.addColorStop(0, "#e9a8b8"); grd.addColorStop(1, "#fbeef0");
    ctx.fillStyle = grd; petalPath(ctx, p.x, p.y, p.r, p.angle); ctx.fill();
  }
  for (const p of pond.pads) {
    // leaf: deep green, lighter towards the centre, waxy rim, radiating veins
    const grd = ctx.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.25, p.r * 0.1, p.x, p.y, p.r);
    grd.addColorStop(0, "#3d6534"); grd.addColorStop(0.65, "#2b4e27"); grd.addColorStop(1, "#1c3519");
    ctx.fillStyle = grd; padPath(ctx, p.x, p.y, p.r, p.angle, p.notch); ctx.fill();
    ctx.strokeStyle = "rgba(170,205,130,0.28)"; ctx.lineWidth = Math.max(0.4, p.r * 0.035); padPath(ctx, p.x, p.y, p.r * 0.97, p.angle, p.notch); ctx.stroke();
    ctx.strokeStyle = "rgba(120,160,95,0.3)"; ctx.lineWidth = Math.max(0.3, p.r * 0.02);
    ctx.beginPath(); for (let i = 1; i < 12; i++) { const a = p.angle + p.notch * 0.5 + (i / 12) * (TAU - p.notch); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * p.r * 0.9, p.y + Math.sin(a) * p.r * 0.9); } ctx.stroke();
    // mottling: a few darker blotches and a lighter centre
    ctx.save(); padPath(ctx, p.x, p.y, p.r, p.angle, p.notch); ctx.clip();
    for (let k = 0; k < 7; k++) { const a = p.angle * 7 + k * 2.1, rr = p.r * (0.3 + ((k * 37) % 10) / 16); ctx.fillStyle = k % 2 ? "rgba(20,40,15,0.18)" : "rgba(120,150,70,0.12)"; ctx.beginPath(); ctx.ellipse(p.x + Math.cos(a) * rr * 0.8, p.y + Math.sin(a) * rr * 0.8, p.r * 0.22, p.r * 0.14, a, 0, TAU); ctx.fill(); }
    ctx.restore();
    // a wet highlight
    ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.35, p.r * 0.18, -0.5, 0, TAU); ctx.fill();
  }
}

/** Single-canvas drawing (used by the simple, stylised water). */
export function drawScene(ctx: CanvasRenderingContext2D, pond: Pond, shadow = 0.5) {
  drawUnder(ctx, pond, shadow);
  const top = document.createElement("canvas"); top.width = ctx.canvas.width; top.height = ctx.canvas.height;
  drawTop(top.getContext("2d")!, pond);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(top, 0, 0);
}

function petalPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  const c = Math.cos(a), s = Math.sin(a), P = (u: number, v: number) => [x + c * u - s * v, y + s * u + c * v] as const;
  ctx.beginPath();
  ctx.moveTo(...P(-r, 0));
  ctx.bezierCurveTo(...P(-r * 0.4, -r * 0.75), ...P(r * 0.7, -r * 0.7), ...P(r, -r * 0.12));
  ctx.lineTo(...P(r * 0.82, 0));
  ctx.lineTo(...P(r, r * 0.12));
  ctx.bezierCurveTo(...P(r * 0.7, r * 0.7), ...P(-r * 0.4, r * 0.75), ...P(-r, 0));
  ctx.closePath();
}

function padPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, notch: number) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, angle + notch * 0.5, angle + TAU - notch * 0.5); ctx.closePath();
}
