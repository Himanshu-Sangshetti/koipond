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
  const nx = -dy, ny = dx, spread = f.girth * 1.55, reach = f.girth * 1.25;
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
    for (const [u, size] of [[0.24, 1.45], [0.58, 0.6]] as const) {
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
/** `soft`: the layer is low-res and blurred later on the GPU, so skip the (slow) canvas blur filters. */
export function drawUnder(ctx: CanvasRenderingContext2D, pond: Pond, shadow = 0.8, fish = true, soft = false) {
  const W = ctx.canvas.width, H = ctx.canvas.height, sx = W / pond.w, sy = H / pond.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(sx, 0, 0, sy, 0, 0);
  const fishes = [...pond.fish].sort((a, b) => b.depth - a.depth);
  const frames = new Map(fishes.map((f) => [f, frame(pond, f)]));
  const unit = Math.min(pond.w, pond.h) * 0.11;

  // water plants on the floor: soft tapered blades, blurred by the water above them, swaying
  ctx.save();
  for (const w of pond.weeds) {
    const sway = Math.sin(pond.t * 0.6 + w.phase) * 0.3 + pond.current.x * 0.5, a = w.dir + sway, n = { x: -Math.sin(w.dir), y: Math.cos(w.dir) };
    const mx = w.x + Math.cos(w.dir + sway * 0.4) * w.len * 0.5, my = w.y + Math.sin(w.dir + sway * 0.4) * w.len * 0.5;
    const ex = w.x + Math.cos(a) * w.len, ey = w.y + Math.sin(a) * w.len, wd = w.len * 0.09;
    ctx.fillStyle = w.phase > 3 ? "rgba(52,82,46,0.5)" : "rgba(72,98,52,0.42)";
    ctx.beginPath(); ctx.moveTo(w.x + n.x * wd, w.y + n.y * wd);
    ctx.quadraticCurveTo(mx + n.x * wd * 1.4, my + n.y * wd * 1.4, ex, ey);
    ctx.quadraticCurveTo(mx - n.x * wd * 1.4, my - n.y * wd * 1.4, w.x - n.x * wd, w.y - n.y * wd);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // shadows: fish near the surface throw softer shadows further away; pads shade the floor too
  ctx.save();
  if (fish) for (const f of fishes) {
    const g = frames.get(f)!, off = unit * (0.1 + (1 - f.depth) * 0.3);
    if (!soft) ctx.filter = `blur(${Math.max(0.8, unit * (0.025 + (1 - f.depth) * 0.04) * sx)}px)`;
    ctx.fillStyle = `rgba(0,20,25,${shadow * (0.6 + f.depth * 0.3)})`;
    bodyPath(ctx, g, f, off * 0.45, off); ctx.fill(); tailFan(ctx, g, f, off * 0.45, off); ctx.fill(); fins(ctx, g, f, off * 0.45, off);
  }
  if (!soft) ctx.filter = `blur(${Math.max(1, unit * 0.12 * sx)}px)`; ctx.fillStyle = `rgba(0,0,0,${shadow * 0.75})`;
  for (const p of pond.pads) { padPath(ctx, p.x + p.r * 0.35, p.y + p.r * 0.5, p.r, p.angle, p.notch); ctx.fill(); }
  if (pond.border > 0) for (const st of stonesFor(pond).stones) { const g = ctx.createRadialGradient(st.x + st.rx * 0.3, st.y + st.ry * 0.45, st.rx * 0.3, st.x + st.rx * 0.3, st.y + st.ry * 0.45, st.rx * 1.35); g.addColorStop(0, `rgba(0,0,0,${shadow * 0.6})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(st.x + st.rx * 0.3, st.y + st.ry * 0.45, st.rx * 1.35, 0, TAU); ctx.fill(); }
  ctx.fillStyle = `rgba(0,0,0,${shadow * 0.5})`;
  for (const p of pond.petals) { const o = unit * (0.06 + p.z * 0.8); petalPath(ctx, p.x + o, p.y + o * 1.4, p.r * (1 + p.z * 0.6), p.angle); ctx.fill(); }
  ctx.restore();
  if (!fish) return;

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
export function drawTop(ctx: CanvasRenderingContext2D, pond: Pond, props?: HTMLCanvasElement | true) {
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
    // a sakura petal: pale pink, deeper at the base; larger and softer while still falling
    const r = p.r * (1 + p.z * 0.6), cx = Math.cos(p.angle), cy = Math.sin(p.angle);
    const grd = ctx.createLinearGradient(p.x - cx * r, p.y - cy * r, p.x + cx * r, p.y + cy * r);
    grd.addColorStop(0, scheme(pond).petal[0]); grd.addColorStop(1, scheme(pond).petal[1]);
    ctx.globalAlpha = p.z > 0 ? 0.92 : 1; ctx.fillStyle = grd; petalPath(ctx, p.x, p.y, r, p.angle); ctx.fill(); ctx.globalAlpha = 1;
  }
  // rain: faint streaks of falling drops
  if (pond.rain > 0) {
    ctx.strokeStyle = "rgba(235,245,240,0.22)"; ctx.lineWidth = Math.max(0.6, unit * 0.008);
    const n = Math.round(pond.rain * 40);
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = Math.random() * pond.w, y = Math.random() * pond.h, l = unit * (0.08 + Math.random() * 0.12); ctx.moveTo(x, y); ctx.lineTo(x + l * 0.25, y + l); }
    ctx.stroke();
  }
  // splash droplets and wake sparks: small points of light, fading
  for (const sp of pond.sparks) {
    if (sp.age < 0) continue; const k = sp.age / sp.life, arc = sp.drip ? Math.sin(k * Math.PI) : 1 - k;
    ctx.fillStyle = `rgba(240,250,248,${(sp.drip ? 0.75 : 0.6) * (sp.drip ? 0.4 + 0.6 * arc : arc)})`;
    ctx.beginPath(); ctx.arc(sp.x, sp.y - (sp.drip ? arc * unit * 0.08 : 0), sp.r * (sp.drip ? 0.7 + arc * 0.7 : 0.6 + arc * 0.5), 0, TAU); ctx.fill();
  }
  for (const fl of pond.flashes) { const k = 1 - fl.age / 0.3, R = unit * (0.12 + fl.age * 0.6); const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, R); g.addColorStop(0, `rgba(255,255,255,${0.3 * k})`); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fl.x, fl.y, R, 0, TAU); ctx.fill(); }
  for (const b of pond.bubbles) {
    if (b.age < 0) continue;
    const k = Math.min(1, b.age / 0.3), r = b.r * (0.6 + 0.4 * k);
    ctx.strokeStyle = `rgba(235,250,248,${0.55 * k})`; ctx.lineWidth = Math.max(0.6, r * 0.18);
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.7 * k})`; ctx.beginPath(); ctx.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.25, 0, TAU); ctx.fill();
  }
  if (props) {
    // lit 3D pads and rocks, then the flowers on top of their pads
    if (props !== true) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(props, 0, 0, W, H); ctx.restore(); }
    for (const p of pond.pads) if (p.flower) drawLily(ctx, p.x + Math.cos(p.angle + Math.PI) * p.r * 0.15, p.y + Math.sin(p.angle + Math.PI) * p.r * 0.15, p.r * 0.48, p.angle * 3, scheme(pond));
  } else {
    for (const p of pond.pads) drawPad(ctx, p, scheme(pond));
    if (pond.border > 0) drawBorder(ctx, pond, scheme(pond));
  }
}

// colours for floating things and the border, per art style, so they sit in the same world as the water
type Scheme = { pads: string[][]; vein: string; petal: [string, string]; lily: [string, string]; heart: [string, string]; stone: string[]; stoneDark: string; moss: string };
const SCHEMES: Record<string, Scheme> = {
  // woodblock print: sage/olive greens, pale sakura, cream lilies, slate and cream stones
  ink: { pads: [["#7f8d5c", "#66744a", "#4c5838"], ["#98a06a", "#7f8955", "#606a3f"], ["#6c7a55", "#566444", "#3f4a32"]], vein: "rgba(232,226,200,0.5)", petal: ["#e3aab3", "#f6e2e2"], lily: ["#efe8d6", "#fbf7ee"], heart: ["#e9b648", "#cf8f2c"], stone: ["#8e958f", "#a3a79c", "#767e7c", "#b6b3a4"], stoneDark: "#3a4250", moss: "#5f6d45" },
  // soft garden photo: dusty olive, khaki and rose pads (from the reference), muted sakura
  garden: { pads: [["#8c8f52", "#6b6e36", "#4b4d22"], ["#b3aa6b", "#9a9250", "#746c34"], ["#a88466", "#8c6a4e", "#654a36"]], vein: "rgba(235,228,190,0.5)", petal: ["#d9a4ad", "#f1dcdc"], lily: ["#f0e9da", "#fffaf0"], heart: ["#f0c45a", "#d99a2a"], stone: ["#8d8c80", "#a4a094", "#77786e", "#b5b0a0"], stoneDark: "#3e4038", moss: "#6b7246" },
  // deep stone pond: cool greens, pale petals
  natural: { pads: [["#4f7a52", "#3a6040", "#284430"], ["#6a8a56", "#527044", "#3a5232"], ["#5a6e4a", "#46583a", "#33402b"]], vein: "rgba(205,225,190,0.45)", petal: ["#dba6b2", "#f5e4e8"], lily: ["#eee9df", "#fbf9f4"], heart: ["#f0c45a", "#d99a2a"], stone: ["#6f7672", "#858a83", "#5d6462", "#9a9a90"], stoneDark: "#26302e", moss: "#4c6a44" },
};
const scheme = (p: Pond) => SCHEMES[p.style] ?? SCHEMES.natural;

function drawPad(ctx: CanvasRenderingContext2D, p: Pond["pads"][number], sc: Scheme) {
  const tone = sc.pads[p.tone < 0.45 ? 0 : p.tone < 0.75 ? 1 : 2];
  // leaf body: lit toward the upper left, darker at the edge
  const grd = ctx.createRadialGradient(p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.05, p.x, p.y, p.r * 1.02);
  grd.addColorStop(0, tone[0]); grd.addColorStop(0.7, tone[1]); grd.addColorStop(1, tone[2]);
  ctx.fillStyle = grd; padPath(ctx, p.x, p.y, p.r, p.angle, p.notch); ctx.fill();
  ctx.save(); padPath(ctx, p.x, p.y, p.r, p.angle, p.notch); ctx.clip();
  // veins: from the centre, gently curving, fading toward the rim
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = p.angle + p.notch * 0.5 + (i / n) * (TAU - p.notch), bend = 0.12 * Math.sin(i * 1.7);
    const g2 = ctx.createLinearGradient(p.x, p.y, p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r);
    g2.addColorStop(0, sc.vein); g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = g2; ctx.lineWidth = Math.max(0.4, p.r * 0.018);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + Math.cos(a + bend) * p.r * 0.5, p.y + Math.sin(a + bend) * p.r * 0.5, p.x + Math.cos(a) * p.r * 0.97, p.y + Math.sin(a) * p.r * 0.97); ctx.stroke();
  }
  // rim: a slightly raised, lighter edge
  ctx.strokeStyle = "rgba(60,55,25,0.35)"; ctx.lineWidth = Math.max(0.6, p.r * 0.04); padPath(ctx, p.x, p.y, p.r * 0.985, p.angle, p.notch); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.32, p.y - p.r * 0.36, p.r * 0.4, p.r * 0.2, -0.6, 0, TAU); ctx.fill();
  ctx.restore();
  if (p.flower) drawLily(ctx, p.x + Math.cos(p.angle + Math.PI) * p.r * 0.15, p.y + Math.sin(p.angle + Math.PI) * p.r * 0.15, p.r * 0.48, p.angle * 3, sc);
}

/** A white water lily seen from above: two rings of pointed petals around a golden centre. */
function drawLily(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, sc: Scheme) {
  ctx.save();

  for (const [ring, count, len, wid, off] of [[0, 10, 1, 0.3, 0], [1, 9, 0.78, 0.26, 0.5]] as const) {
    for (let i = 0; i < count; i++) {
      const a = rot + ((i + off) / count) * TAU, L = r * len, W = r * wid;
      const tx = x + Math.cos(a) * L, ty = y + Math.sin(a) * L, nx = -Math.sin(a) * W, ny = Math.cos(a) * W;
      const g = ctx.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, sc.lily[0]); g.addColorStop(1, sc.lily[1]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + nx, y + Math.sin(a) * L * 0.5 + ny, tx, ty);
      ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.5 - nx, y + Math.sin(a) * L * 0.5 - ny, x, y);
      ctx.fill();
      if (ring === 0 && i === 0) { ctx.shadowColor = "transparent"; }
    }
  }
  ctx.shadowColor = "transparent";
  // golden centre with stamens
  const c = ctx.createRadialGradient(x - r * 0.05, y - r * 0.05, 0, x, y, r * 0.28);
  c.addColorStop(0, sc.heart[0]); c.addColorStop(1, sc.heart[1]);
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r * 0.26, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff0a0";
  for (let i = 0; i < 16; i++) { const a = rot + (i / 16) * TAU; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2, r * 0.03, 0, TAU); ctx.fill(); }
  ctx.restore();
}

/** Single-canvas drawing (used by the simple, stylised water). */
export function drawScene(ctx: CanvasRenderingContext2D, pond: Pond, shadow = 0.5) {
  drawUnder(ctx, pond, shadow);
  const top = document.createElement("canvas"); top.width = ctx.canvas.width; top.height = ctx.canvas.height;
  drawTop(top.getContext("2d")!, pond);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(top, 0, 0);
}

// a border of rounded stones around the pond: bigger and piled up in the corners, a dark wet edge
// at the water line and their shadow falling onto the water. Stones are seeded, so they never move.
type Stone = { x: number; y: number; rx: number; ry: number; a: number; c: number; moss: boolean; wob: number[] };
let stoneCache: { key: string; stones: Stone[]; shoreline: [number, number][] } | null = null;
export function stonesFor(pond: Pond) {
  const key = `${Math.round(pond.w)}x${Math.round(pond.h)}:${pond.border.toFixed(1)}`;
  if (stoneCache?.key === key) return stoneCache;
  let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const B = pond.border, stones: Stone[] = [];
  const make = (x: number, y: number, s: number) => stones.push({ x, y, rx: s * (0.8 + rnd() * 0.45), ry: s * (0.6 + rnd() * 0.3), a: rnd() * Math.PI, c: Math.floor(rnd() * 4), moss: rnd() < 0.35, wob: Array.from({ length: 12 }, () => 0.92 + rnd() * 0.12) });
  // one natural cluster in the lower-left corner: two big rocks, a few smaller ones tumbling out
  make(B * 1.2, pond.h - B * 1.0, B * 1.9); make(B * 3.0, pond.h - B * 0.6, B * 1.3); make(B * 0.6, pond.h - B * 2.9, B * 1.2);
  for (let k = 0; k < 7; k++) { const a = rnd() * Math.PI * 0.5, d = B * (2.4 + rnd() * 1.6); make(Math.cos(a) * d, pond.h - Math.sin(a) * d, B * (0.35 + rnd() * 0.4)); }
  stones.sort((p, q) => q.rx - p.rx);
  stoneCache = { key, stones, shoreline: [] };
  return stoneCache;
}

function stonePath(ctx: CanvasRenderingContext2D, s: Stone, dx = 0, dy = 0, grow = 1) {
  const n = s.wob.length; ctx.beginPath();
  for (let i = 0; i <= n + 1; i++) {
    const k = i % n, a = (k / n) * Math.PI * 2, r = s.wob[k] * grow;
    const px = s.x + dx + Math.cos(s.a) * Math.cos(a) * s.rx * r - Math.sin(s.a) * Math.sin(a) * s.ry * r;
    const py = s.y + dy + Math.sin(s.a) * Math.cos(a) * s.rx * r + Math.cos(s.a) * Math.sin(a) * s.ry * r;
    if (i === 0) ctx.moveTo(px, py); else { const pk = (k + n - 1) % n, pa = (pk / n) * Math.PI * 2; const mx = (px + s.x + dx + Math.cos(s.a) * Math.cos(pa) * s.rx * s.wob[pk] * grow - Math.sin(s.a) * Math.sin(pa) * s.ry * s.wob[pk] * grow) / 2; const my = (py + s.y + dy + Math.sin(s.a) * Math.cos(pa) * s.rx * s.wob[pk] * grow + Math.cos(s.a) * Math.sin(pa) * s.ry * s.wob[pk] * grow) / 2; ctx.quadraticCurveTo(mx, my, (mx + px) / 2, (my + py) / 2); }
  }
  ctx.closePath();
}

let borderLayer: { key: string; canvas: HTMLCanvasElement } | null = null;
function drawBorder(ctx: CanvasRenderingContext2D, pond: Pond, sc: Scheme) {
  // drawn once into its own canvas (it never moves), then stamped each frame
  const W = ctx.canvas.width, H = ctx.canvas.height, key = `${W}x${H}:${pond.style}:${pond.border.toFixed(1)}`;
  if (borderLayer?.key !== key) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d")!; g.setTransform(W / pond.w, 0, 0, H / pond.h, 0, 0);
    const { stones } = stonesFor(pond), B = pond.border;
    g.save(); g.fillStyle = "rgba(0,0,0,0.3)"; g.filter = `blur(${B * 0.3 * (W / pond.w)}px)`;
    for (const s of stones) { stonePath(g, s, B * 0.15, B * 0.28, 1.06); g.fill(); }
    g.restore();
    for (const s of stones) {
      const grd = g.createRadialGradient(s.x - s.rx * 0.35, s.y - s.ry * 0.4, s.rx * 0.1, s.x, s.y, s.rx * 1.15);
      grd.addColorStop(0, sc.stone[s.c]); grd.addColorStop(0.7, sc.stone[(s.c + 2) % 4]); grd.addColorStop(1, sc.stoneDark);
      g.fillStyle = grd; stonePath(g, s); g.fill();
      if (s.moss) { g.save(); stonePath(g, s); g.clip(); g.fillStyle = sc.moss; g.globalAlpha = 0.6; g.beginPath(); g.ellipse(s.x - s.rx * 0.3, s.y - s.ry * 0.45, s.rx * 0.6, s.ry * 0.4, s.a, 0, Math.PI * 2); g.fill(); g.restore(); }
    }
    borderLayer = { key, canvas: c };
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(borderLayer.canvas, 0, 0); ctx.restore();
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

/** For the GPU floaters (see sprites.ts): one petal and one lily, drawn once into a two-cell atlas (cell size C). */
export function drawFloaterAtlas(ctx: CanvasRenderingContext2D, C: number, style: string) {
  const sc = SCHEMES[style] ?? SCHEMES.natural, r = C * 0.47;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, C * 2, C);
  const grd = ctx.createLinearGradient(C / 2 - r, C / 2, C / 2 + r, C / 2);
  grd.addColorStop(0, sc.petal[0]); grd.addColorStop(1, sc.petal[1]);
  ctx.fillStyle = grd; petalPath(ctx, C / 2, C / 2, r, 0); ctx.fill();
  drawLily(ctx, C * 1.5, C / 2, r, 0, sc);
}
