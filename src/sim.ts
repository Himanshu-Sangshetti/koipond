// koipond — the simulation. Pure TypeScript, no DOM. Units are pond pixels.
//
// How a fish works here:
//   • Mood: every fish has a temperament (bold ↔ shy, lazy ↔ restless) that shapes all its choices.
//   • Intent: a small set of activities (drift, cruise, dart, rest, investigate, feed, flee), chosen by
//     weighted chance from its mood and what is happening around it, each lasting a while.
//   • Steering: the activity sets a goal heading and speed; neighbours, walls and the water current
//     bend that goal. The fish turns toward it with limited, speed-dependent turning (a heavy body).
//   • Body: a chain of joints pulled along by the head, with a cap on how sharply any joint can bend,
//     so the body curves through turns but can never kink or fold. A muscle wave travels nose → tail
//     with an amplitude that rises toward the tail and with how hard the fish is swimming.
//   • Tail fin: its own short chain on springs, so it trails and flicks after the body (follow-through).

export type V = { x: number; y: number };
const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export class Random {
  private s: number;
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  /** mulberry32 */
  next() { let t = (this.s = (this.s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  between(a: number, b: number) { return a + (b - a) * this.next(); }
  pick<T>(xs: readonly T[]) { return xs[Math.floor(this.next() * xs.length)]; }
}

export type Activity = "drift" | "cruise" | "dart" | "rest" | "investigate" | "feed" | "flee";

export interface Variety { name: string; base: string; spots: string[]; fin: string; spotCover: number }
export const MINNOW: Variety = { name: "minnow", base: "#4c5a55", spots: [], fin: "#7c8c86", spotCover: 0 };
export const VARIETIES: Variety[] = [
  // the palette of the reference pond: vivid orange-red on cream, a few with sumi black, warm orange and gold
  { name: "kohaku", base: "#f2ebdf", spots: ["#e04a1f"], fin: "#f2ebdf", spotCover: 0.85 },
  { name: "sanke", base: "#f2ebdf", spots: ["#e04a1f", "#e04a1f", "#1c1a1e"], fin: "#f2ebdf", spotCover: 0.8 },
  { name: "yamabuki", base: "#ec7a2a", spots: ["#f2ebdf"], fin: "#f3c79a", spotCover: 0.25 },
  { name: "kohaku", base: "#f2ebdf", spots: ["#e8642a"], fin: "#f2ebdf", spotCover: 0.95 },
  { name: "ogon", base: "#eaa53c", spots: ["#f2ebdf"], fin: "#f2cf8a", spotCover: 0.12 },
  { name: "tancho", base: "#f2ebdf", spots: [], fin: "#f2ebdf", spotCover: 0 },
  { name: "sanke", base: "#f2ebdf", spots: ["#d94420", "#1c1a1e"], fin: "#f2ebdf", spotCover: 0.75 },
  { name: "showa", base: "#1c1a1e", spots: ["#e04a1f", "#f2ebdf"], fin: "#d9d3cc", spotCover: 0.7 },
];

/** A spot on the body, in body coordinates: u along the body (0 nose, 1 tail root), v across (-1..1). */
export interface Spot { u: number; v: number; ru: number; rv: number; color: string }

export interface Fish {
  id: number; variety: Variety; spots: Spot[];
  length: number; girth: number;              // body length, max half-width
  bold: number; restless: number;             // temperament 0..1
  x: number; y: number; heading: number; speed: number; turn: number;
  activity: Activity; activityLeft: number; goalHeading: number; goalSpeed: number; target: V | null;
  effort: number; beat: number;               // swim effort 0..1+, muscle wave phase
  depth: number; depthGoal: number;           // 0 surface .. 1 deep
  joints: V[]; tail: V[]; tailVel: V[];
  finPhase: number; lastGulp: number;
  /** 0..1 how present the fish is (grows in when added, shrinks away when removed); body ratios for live resizing. */
  presence: number; leaving: boolean; lenRatio: number; girthRatio: number;
}

export interface Bubble { x: number; y: number; r: number; age: number; life: number }
export interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; drip?: boolean }
export interface Pellet { x: number; y: number; vx: number; vy: number; age: number; eaten: boolean }
export interface Ripple { x: number; y: number; age: number; power: number; kind: "tap" | "drop" | "nibble" | "wake" }
export interface Pad { x: number; y: number; r: number; spin: number; angle: number; vx: number; vy: number; notch: number; tone: number; flower: boolean; hx: number; hy: number; rRatio: number; presence: number; leaving: boolean }
export interface Petal { x: number; y: number; r: number; spin: number; angle: number; vx: number; vy: number; z: number }
export interface Weed { x: number; y: number; len: number; phase: number; dir: number }

export interface PondOptions {
  width: number; height: number; fish?: number; seed?: number;
  /** Size of the fish relative to the pond's short side (default 0.11). */
  fishSize?: number;
  pads?: number;
  /** Floating blossom petals (or leaves). */
  petals?: number;
  /** A small school of tiny dark fish. */
  minnows?: number;
  /** Rectangles (pond pixels) fish prefer to stay out of, e.g. behind a headline. */
  keepClear?: { x: number; y: number; w: number; h: number }[];
}

const JOINTS = 16, TAIL = 4;

export class Pond {
  w: number; h: number; t = 0;
  fish: Fish[] = []; sparks: Spark[] = []; flashes: { x: number; y: number; age: number }[] = []; bubbles: Bubble[] = []; pellets: Pellet[] = []; ripples: Ripple[] = []; pads: Pad[] = []; petals: Petal[] = []; weeds: Weed[] = [];
  private petalMax = 0; private nextPetal = 0;
  current: V = { x: 0, y: 0 };
  /** Width of the stone border around the pond (pond pixels); 0 = no border. */
  border = 0;
  /** How far a point is toward the shore: 0 at the centre, 1 on the water line (pond shape = rounded, slightly irregular). */
  shore(x: number, y: number) {
    // only a small stone cluster in the lower-left corner: fish and floaters keep off it
    if (this.border <= 0) return 0;
    const r = this.border * 4.2, d = len(x - 0, y - this.h);
    return d < r ? 1.2 - d / r * 0.4 : 0;
  }
  private shoreUnused(x: number, y: number) {
    if (this.border <= 0) return 0;
    const a = this.w / 2 - this.border * 1.1, b = this.h / 2 - this.border * 1.1, dx = (x - this.w / 2) / a, dy = (y - this.h / 2) / b;
    const ang = Math.atan2(dy, dx), wob = 1 + 0.035 * Math.sin(ang * 3 + 1.3) + 0.025 * Math.sin(ang * 5 + 0.4);
    return Math.pow(Math.pow(Math.abs(dx), 3.2) + Math.pow(Math.abs(dy), 3.2), 1 / 3.2) / wob;
  }
  /** Which art style the pond is drawn in (drawing reads this for its colours). */
  style = "natural";
  /** 0..1: how hard it is raining. */
  rain = 0;
  private lastWake: V = { x: -1e9, y: -1e9 };
  pointer: { x: number; y: number; still: number; speed: number; inside: boolean } = { x: 0, y: 0, still: 0, speed: 0, inside: false };
  keepClear: NonNullable<PondOptions["keepClear"]>;
  private rnd: Random;
  private nextId = 0;
  private fishSizeRatio = 0.14;
  private unit: number;
  private nextDrop = 2;
  private formation: { slots: V[]; flow: V[]; owner: number[] } | null = null;

  constructor(o: PondOptions) {
    this.w = o.width; this.h = o.height; this.rnd = new Random(o.seed ?? 7);
    this.fishSizeRatio = o.fishSize ?? 0.14;
    this.unit = Math.min(o.width, o.height) * this.fishSizeRatio;
    this.keepClear = o.keepClear ?? [];
    for (let i = 0; i < (o.fish ?? 9); i++) this.fish.push(this.makeFish(i));
    for (let i = 0; i < (o.minnows ?? 0); i++) {
      const m = this.makeFish(1000 + i);
      m.variety = MINNOW; m.spots = []; m.lenRatio = this.rnd.between(0.24, 0.32); m.girthRatio = 0.13; m.length = this.unit * m.lenRatio; m.girth = m.length * 0.13;
      m.bold = 0.1; m.restless = 0.95; m.depth = this.rnd.between(0.3, 0.6);
      const seg = m.length / (JOINTS - 1); m.joints.forEach((j, k) => { j.x = m.x - Math.cos(m.heading) * seg * k; j.y = m.y - Math.sin(m.heading) * seg * k; });
      m.tail.forEach((j, k) => { j.x = m.x - Math.cos(m.heading) * (m.length + seg * 0.8 * (k + 1)); j.y = m.y - Math.sin(m.heading) * (m.length + seg * 0.8 * (k + 1)); });
      this.fish.push(m);
    }
    for (let i = 0; i < (o.pads ?? 3); i++) { const pad = this.makePad(); if (i === 0) { pad.flower = true; pad.tone = 0.3; } this.pads.push(pad); }
    this.petalMax = o.petals ?? 9;
    for (let i = 0; i < this.petalMax; i++) this.petals.push(this.makePetal(0));
    // water plants rooted on the floor, in loose clumps
    for (let c = 0; c < 4; c++) { const cx = this.rnd.between(0.05, 0.95) * this.w, cy = this.rnd.between(0.05, 0.95) * this.h;
      for (let k = 0; k < 9; k++) this.weeds.push({ x: cx + this.rnd.between(-1, 1) * this.unit * 0.25, y: cy + this.rnd.between(-1, 1) * this.unit * 0.25, len: this.unit * this.rnd.between(0.5, 1.1), phase: this.rnd.between(0, TAU), dir: this.rnd.between(0, TAU) }); }
  }

  private makeFish(id: number): Fish {
    const r = this.rnd, variety = VARIETIES[id % VARIETIES.length];
    const lenRatio = r.between(0.78, 1.25), length = this.unit * lenRatio, girthRatio = r.between(0.1, 0.12), girth = length * girthRatio;
    const x = r.between(0.1, 0.9) * this.w, y = r.between(0.12, 0.88) * this.h, heading = r.between(-Math.PI, Math.PI);
    const joints: V[] = [], seg = length / (JOINTS - 1);
    for (let i = 0; i < JOINTS; i++) joints.push({ x: x - Math.cos(heading) * seg * i, y: y - Math.sin(heading) * seg * i });
    const last = joints[JOINTS - 1], tail: V[] = [], tailVel: V[] = [];
    for (let i = 1; i <= TAIL; i++) { tail.push({ x: last.x - Math.cos(heading) * seg * 0.8 * i, y: last.y - Math.sin(heading) * seg * 0.8 * i }); tailVel.push({ x: 0, y: 0 }); }
    // spots: a few soft blobs; tancho gets its single red crown
    const spots: Spot[] = [];
    if (variety.name === "tancho") spots.push({ u: 0.07, v: 0, ru: 0.055, rv: 0.55, color: "#dc4f26" });
    let cover = 0;
    while (cover < variety.spotCover) {
      const ru = r.between(0.06, 0.15), rv = r.between(0.4, 0.95);
      const u0 = r.between(0.05, 0.85), v0 = r.between(-0.5, 0.5), color = r.pick(variety.spots);
      spots.push({ u: u0, v: v0, ru, rv, color });
      for (let k = 0; k < 2; k++) spots.push({ u: u0 + r.between(-ru, ru) * 0.8, v: v0 + r.between(-0.35, 0.35), ru: ru * r.between(0.45, 0.75), rv: rv * r.between(0.5, 0.85), color });
      cover += ru * rv * 1.1;
    }
    return {
      id, variety, spots, length, girth, bold: r.next(), restless: r.next(),
      x, y, heading, speed: 0, turn: 0, activity: "drift", activityLeft: r.between(0.5, 3), goalHeading: heading, goalSpeed: 0, target: null,
      effort: 0.3, beat: r.between(0, TAU), depth: r.between(0.1, 0.6), depthGoal: 0.3, joints, tail, tailVel, finPhase: r.between(0, TAU), lastGulp: -99, presence: 1, leaving: false, lenRatio, girthRatio,
    };
  }

  private makePetal(z: number): Petal {
    const r = this.rnd;
    return { x: r.between(0, 1) * this.w, y: r.between(0, 1) * this.h, r: this.unit * r.between(0.055, 0.085), spin: r.between(-0.6, 0.6), angle: r.between(0, TAU), vx: 0, vy: 0, z };
  }

  private makePad(): Pad {
    const r = this.rnd;
    // each pad has a home inside the frame it drifts back to, so it never wanders off screen for long
    const hx = r.between(0.04, 0.96) * this.w, hy = r.between(0.06, 0.94) * this.h, rr = r.between(0.42, 0.68);
    return { x: hx, y: hy, r: this.unit * rr, spin: r.between(-0.03, 0.03), angle: r.between(0, TAU), vx: 0, vy: 0, notch: r.between(0.3, 0.5), tone: r.next(), flower: r.next() < 0.45, hx, hy, rRatio: rr, presence: 1, leaving: false };
  }

  // ------------------------------------------------------------------------------------- events
  /** A tap lands: a crown of droplets thrown out, a brief flash, and the ring. */
  splash(x: number, y: number) {
    const u = this.unit;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + this.rnd.between(-0.2, 0.2), sp = u * this.rnd.between(0.5, 1.1); this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: -this.rnd.between(0, 0.04), life: this.rnd.between(0.32, 0.5), r: u * this.rnd.between(0.02, 0.03), drip: true }); }
    this.flashes.push({ x, y, age: 0 });
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
    this.ripple(x, y, "tap", 1);
  }

  ripple(x: number, y: number, kind: Ripple["kind"] = "tap", power = 1) {
    const rings = kind === "tap" ? 3 : 1;
    for (let i = 0; i < rings; i++) this.ripples.push({ x, y, age: -i * 0.09, power: power * (1 - i * 0.22), kind });
    if (this.ripples.length > 48) this.ripples.splice(0, this.ripples.length - 48);
    // a ripple pushes floating pads and startles shy fish nearby
    for (const p of this.pads) { const dx = p.x - x, dy = p.y - y, d = len(dx, dy) || 1; if (d < this.unit * 2.2) { const f = (1 - d / (this.unit * 2.2)) * this.unit * 0.6 * power; p.vx += dx / d * f; p.vy += dy / d * f; } }
    for (const p of this.petals) { const dx = p.x - x, dy = p.y - y, d = len(dx, dy) || 1; if (d < this.unit * 2.5) { const f = (1 - d / (this.unit * 2.5)) * this.unit * 1.4 * power; p.vx += dx / d * f; p.vy += dy / d * f; p.spin += (this.rnd.next() - 0.5) * 1.5 * power; } }
    if (kind === "tap") for (const f of this.fish) { const d = len(f.x - x, f.y - y); if (d < this.unit * 1.6 && f.bold < 0.45) this.setActivity(f, "flee", 0.9, { x, y }); }
  }

  /** Scatter a few food pellets around a point; nearby fish come to feed. */
  feed(x: number, y: number, n = 5) {
    for (let i = 0; i < n; i++) { const a = this.rnd.between(0, TAU), s = this.rnd.between(4, 22); this.pellets.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, eaten: false }); }
    if (this.pellets.length > 40) this.pellets.splice(0, this.pellets.length - 40);
    this.ripple(x, y, "drop", 0.8);
  }

  setPointer(x: number, y: number, inside: boolean) {
    const p = this.pointer, moved = len(x - p.x, y - p.y);
    p.speed = p.speed * 0.6 + moved * 0.4; p.x = x; p.y = y; p.inside = inside;
    if (moved > 0.5) p.still = 0;
    // a finger moving through the water drags a wake behind it
    if (inside && len(x - this.lastWake.x, y - this.lastWake.y) > this.unit * 0.06) {
      const d = len(x - this.lastWake.x, y - this.lastWake.y), fresh = this.lastWake.x < -1e8 || d > this.unit * 3;
      if (!fresh) {
        const steps = Math.min(4, Math.ceil(d / (this.unit * 0.08))), power = Math.min(1, 0.35 + d / (this.unit * 0.3));
        for (let q = 1; q <= steps; q++) this.ripple(this.lastWake.x + (x - this.lastWake.x) * q / steps, this.lastWake.y + (y - this.lastWake.y) * q / steps, "wake", power);
        // a few points of light peel away to either side, like a boat's wake
        const nx = -(y - this.lastWake.y) / d, ny = (x - this.lastWake.x) / d;
        for (const side of [1, -1]) this.sparks.push({ x, y, vx: nx * side * this.unit * 0.25, vy: ny * side * this.unit * 0.25, age: 0, life: 0.6, r: this.unit * 0.012 });
      }
      this.lastWake = { x, y };
    }
    if (!inside) this.lastWake = { x: -1e9, y: -1e9 };
  }

  /** Ask the fish to hold a shape: a slot for each fish and the direction to swim through it. */
  setFormation(slots: V[] | null, flow?: V[]) {
    if (!slots) { if (this.formation) for (const f of this.fish) this.setActivity(f, this.rnd.next() < 0.5 ? "dart" : "cruise"); this.formation = null; return; }
    if (!this.formation) {
      const free = slots.map((_, i) => i), owner: number[] = [];
      for (const f of this.fish) {
        if (!free.length) { owner.push(-1); continue; }
        let best = 0, bd = Infinity;
        free.forEach((s, k) => { const d = len(slots[s].x - f.x, slots[s].y - f.y); if (d < bd) { bd = d; best = k; } });
        owner.push(free.splice(best, 1)[0]);
      }
      this.formation = { slots, flow: flow ?? slots.map(() => ({ x: 1, y: 0 })), owner };
    } else { this.formation.slots = slots; if (flow) this.formation.flow = flow; }
  }

  /** Change the pond while it lives: koi, size, pads and petals ease in or out instead of resetting. */
  setFishSize(fishSize: number) { this.fishSizeRatio = fishSize; this.unit = Math.min(this.w, this.h) * fishSize; }
  setFishCount(n: number) {
    const koi = this.fish.filter((f) => f.variety !== MINNOW && !f.leaving);
    if (koi.length < n) {
      for (let i = koi.length; i < n; i++) {
        const id = 2000 + (this.nextId++), f = this.makeFish(id);
        f.presence = 0; f.depth = 0.9; f.depthGoal = 0.3; // rises up from the deep
        this.fish.push(f);
      }
    } else for (const f of koi.slice(n)) { f.leaving = true; f.depthGoal = 1; }
  }
  setPadCount(n: number) {
    const live = this.pads.filter((p) => !p.leaving);
    if (live.length < n) for (let i = live.length; i < n; i++) { const p = this.makePad(); p.presence = 0; p.r = 0.01; this.pads.push(p); }
    else for (const p of live.slice(n)) p.leaving = true;
  }
  setPetalCount(n: number) { this.petalMax = n; if (n === 0) for (const p of this.petals) p.z = Math.min(p.z, 0); }

  resize(w: number, h: number) {
    const sx = w / this.w, sy = h / this.h;
    // sizes follow the new screen (koi and pads ease to them); homes move with it
    this.unit = Math.min(w, h) * this.fishSizeRatio;
    for (const p of this.pads) { p.hx *= sx; p.hy *= sy; }
    for (const f of this.fish) { f.x *= sx; f.y *= sy; for (const j of [...f.joints, ...f.tail]) { j.x *= sx; j.y *= sy; } }
    for (const p of [...this.pads, ...this.petals]) { p.x *= sx; p.y *= sy; }
    this.w = w; this.h = h;
  }

  // ---------------------------------------------------------------------------------- behaviour
  private setActivity(f: Fish, a: Activity, seconds?: number, target: V | null = null) {
    f.activity = a; f.target = target;
    const span: Record<Activity, [number, number]> = { drift: [2, 6], cruise: [2.5, 7], dart: [0.35, 0.8], rest: [1.2, 4], investigate: [2, 5], feed: [3, 8], flee: [0.6, 1.2] };
    f.activityLeft = seconds ?? this.rnd.between(span[a][0], span[a][1]) * (a === "rest" ? 1.4 - f.restless : 1);
    if (a === "dart") f.goalHeading = f.heading + this.rnd.between(-0.9, 0.9);
  }

  private choose(f: Fish) {
    // food first, then curiosity about a still pointer, otherwise mood decides
    const pellet = this.nearestPellet(f, this.unit * 4);
    if (pellet) return this.setActivity(f, "feed", undefined, pellet);
    const p = this.pointer;
    if (p.inside && p.still > 1.2 && len(p.x - f.x, p.y - f.y) < this.unit * 3.5 && this.rnd.next() < 0.35 + f.bold * 0.5) return this.setActivity(f, "investigate", undefined, { x: p.x, y: p.y });
    const r = this.rnd.next(), rest = 0.18 * (1 - f.restless), dart = 0.08 + 0.12 * f.restless, cruise = 0.32 + 0.2 * f.restless;
    this.setActivity(f, r < rest ? "rest" : r < rest + dart ? "dart" : r < rest + dart + cruise ? "cruise" : "drift");
  }

  private nearestPellet(f: Fish, within: number): Pellet | null {
    let best: Pellet | null = null, bd = within;
    for (const p of this.pellets) { if (p.eaten) continue; const d = len(p.x - f.x, p.y - f.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  step(dt: number) {
    this.t += dt;
    const u = this.unit, ptr = this.pointer;
    ptr.still += dt; ptr.speed *= Math.exp(-dt * 6);

    // ambient life: an occasional drop on the surface
    this.nextDrop -= dt;
    while (this.nextDrop < 0) { this.ripple(this.rnd.between(0, this.w), this.rnd.between(0, this.h), "drop", 0.55 + this.rain * 0.3); this.nextDrop += this.rnd.between(2.5, 6) / (1 + this.rain * 40); }

    // bubbles: now and then a koi breathes out a few; they surface, sit a moment, and pop
    for (const f of this.fish) if (f.variety !== MINNOW && this.rnd.next() < dt * 0.12) {
      const n = 1 + Math.floor(this.rnd.next() * 3);
      for (let k = 0; k < n; k++) this.bubbles.push({ x: f.x + this.rnd.between(-1, 1) * f.girth, y: f.y + this.rnd.between(-1, 1) * f.girth, r: u * this.rnd.between(0.025, 0.05), age: -k * 0.25, life: this.rnd.between(1.5, 3.5) });
    }
    for (const b of this.bubbles) { b.age += dt; b.x += this.current.x * u * 0.2 * dt; b.y += this.current.y * u * 0.2 * dt; if (b.age > b.life) this.ripple(b.x, b.y, "nibble", 0.25); }
    this.bubbles = this.bubbles.filter((b) => b.age <= b.life).slice(-60);
    for (const sp of this.sparks) { sp.age += dt; if (sp.age > 0) { sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vx *= Math.exp(-dt * 3); sp.vy *= Math.exp(-dt * 3); } }
    for (const sp of this.sparks) if (sp.drip && sp.age >= sp.life) this.ripple(sp.x, sp.y, "nibble", 0.35);
    this.sparks = this.sparks.filter((sp) => sp.age < sp.life);
    for (const fl of this.flashes) fl.age += dt;
    this.flashes = this.flashes.filter((fl) => fl.age < 0.3);
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < (r.kind === "tap" ? 2.6 : r.kind === "drop" ? 1.6 : 1.0));

    for (const p of this.pellets) { p.age += dt; p.x += p.vx * dt + this.current.x * 6 * dt; p.y += p.vy * dt + this.current.y * 6 * dt; p.vx *= Math.exp(-dt * 2.5); p.vy *= Math.exp(-dt * 2.5); }
    this.pellets = this.pellets.filter((p) => !p.eaten && p.age < 40);

    for (const p of this.pads) {
      p.vx += (this.current.x * u * 0.9 - p.vx) * dt * 1.2; p.vy += (this.current.y * u * 0.9 - p.vy) * dt * 1.2;
      p.vx *= Math.exp(-dt * 0.8); p.vy *= Math.exp(-dt * 0.8);
      p.x += p.vx * dt + Math.sin(this.t * 0.1 + p.angle) * u * 0.02 * dt; p.y += p.vy * dt + Math.cos(this.t * 0.08 + p.angle) * u * 0.02 * dt;
      p.angle += p.spin * dt;
      // a gentle pull back toward home, and a soft bounce off the frame edges
      p.vx += (p.hx - p.x) * dt * 0.05; p.vy += (p.hy - p.y) * dt * 0.05;
      const m = 0; // a pad may drift half off the edge before it turns back
      if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * 0.5; } if (p.x > this.w - m) { p.x = this.w - m; p.vx = -Math.abs(p.vx) * 0.5; }
      if (p.y < m) { p.y = m; p.vy = Math.abs(p.vy) * 0.5; } if (p.y > this.h - m) { p.y = this.h - m; p.vy = -Math.abs(p.vy) * 0.5; }
      p.presence += ((p.leaving ? 0 : 1) - p.presence) * (1 - Math.exp(-dt * 2.5));
      p.r += (this.unit * p.rRatio * Math.max(0.01, p.presence) - p.r) * (1 - Math.exp(-dt * 3));
      if (this.border > 0 && !((p as unknown as { z?: number }).z! > 0) && this.shore(p.x, p.y) > 0.9) { const cx = this.w / 2 - p.x, cy = this.h / 2 - p.y, d = len(cx, cy) || 1; p.vx = cx / d * this.unit * 0.15; p.vy = cy / d * this.unit * 0.15; p.x += cx / d * 1.5; p.y += cy / d * 1.5; }
      if (false) { const b = this.border + p.r; if (p.x < b) { p.x = b; p.vx = Math.abs(p.vx); } if (p.x > this.w - b) { p.x = this.w - b; p.vx = -Math.abs(p.vx); } if (p.y < b) { p.y = b; p.vy = Math.abs(p.vy); } if (p.y > this.h - b) { p.y = this.h - b; p.vy = -Math.abs(p.vy); } }
    }

    // sakura: every so often a petal drifts down from above and settles on the water
    this.nextPetal -= dt;
    if (this.petalMax > 0 && this.nextPetal < 0) {
      this.petals.push(this.makePetal(1)); this.nextPetal = this.rnd.between(0.7, 1.8);
      const floating = this.petals.filter((q) => q.z <= 0);
      if (floating.length > this.petalMax * 2) this.petals.splice(this.petals.indexOf(floating[0]), 1);
    }
    for (const p of this.petals) {
      if (p.z > 0) {
        p.z -= dt * 0.28; p.angle += dt * 2.2 * Math.sign(p.spin || 1);
        p.x += Math.sin(this.t * 1.7 + p.r * 50) * u * 0.25 * dt + u * 0.12 * dt; p.y += u * 0.08 * dt;
        if (p.z <= 0) { p.z = 0; this.ripple(p.x, p.y, "nibble", 0.3); }
        continue;
      }
      p.vx += (this.current.x * u * 1.4 + Math.sin(this.t * 0.13 + p.angle) * u * 0.03 - p.vx) * dt * 0.5;
      p.vy += (this.current.y * u * 1.4 + Math.cos(this.t * 0.11 + p.r) * u * 0.03 - p.vy) * dt * 0.5;
      p.x += p.vx * dt; p.y += p.vy * dt; p.angle += p.spin * dt; p.spin *= Math.exp(-dt * 0.6);
      const m = p.r * 2; if (p.x < -m) p.x = this.w + m; if (p.x > this.w + m) p.x = -m; if (p.y < -m) p.y = this.h + m; if (p.y > this.h + m) p.y = -m;
      if (this.border > 0 && !((p as unknown as { z?: number }).z! > 0) && this.shore(p.x, p.y) > 0.9) { const cx = this.w / 2 - p.x, cy = this.h / 2 - p.y, d = len(cx, cy) || 1; p.vx = cx / d * this.unit * 0.15; p.vy = cy / d * this.unit * 0.15; p.x += cx / d * 1.5; p.y += cy / d * 1.5; }
      if (false) { const b = this.border + p.r; if (p.x < b) { p.x = b; p.vx = Math.abs(p.vx); } if (p.x > this.w - b) { p.x = this.w - b; p.vx = -Math.abs(p.vx); } if (p.y < b) { p.y = b; p.vy = Math.abs(p.vy); } if (p.y > this.h - b) { p.y = this.h - b; p.vy = -Math.abs(p.vy); } }
    }
    // koi ease toward their size; arriving koi grow in, leaving koi sink and shrink away
    for (const f of this.fish) {
      f.presence += ((f.leaving ? 0 : 1) - f.presence) * (1 - Math.exp(-dt * 1.6));
      const L = this.unit * f.lenRatio * (0.25 + 0.75 * f.presence);
      f.length += (L - f.length) * (1 - Math.exp(-dt * 3)); f.girth = f.length * f.girthRatio * (0.4 + 0.6 * f.presence);
    }
    this.fish = this.fish.filter((f) => !(f.leaving && f.presence < 0.04));
    this.pads = this.pads.filter((p) => !(p.leaving && p.presence < 0.04));
    if (this.petalMax === 0) this.petals = this.petals.filter((p) => p.z > 0 ? false : (p.r *= 0.97) > this.unit * 0.01);
    const fm = this.formation;
    this.fish.forEach((f, idx) => {
      f.activityLeft -= dt;
      const slot = fm && fm.owner[idx] >= 0 ? fm.slots[fm.owner[idx]] : null;

      // a fast pointer close by is a threat; a still one is interesting
      const pd = len(ptr.x - f.x, ptr.y - f.y);
      if (ptr.inside && ptr.speed > u * 0.4 && pd < u * (0.6 + 0.5 * (1 - f.bold)) && f.activity !== "flee" && !slot) this.setActivity(f, "flee", 0.6, { x: ptr.x, y: ptr.y });
      if (f.activityLeft <= 0 && !slot) this.choose(f);
      if (f.activity === "feed" && (!f.target || (f.target as Pellet).eaten)) this.choose(f);

      // ----- what does it want?
      let gx = Math.cos(f.heading), gy = Math.sin(f.heading), want = 0;
      const wander = Math.sin(this.t * (0.21 + f.restless * 0.2) + f.id * 3.1) * 0.6 + Math.sin(this.t * 0.07 + f.id) * 0.4;
      switch (f.activity) {
        case "drift": gx = Math.cos(f.heading + wander * 0.9); gy = Math.sin(f.heading + wander * 0.9); want = u * 0.32; break;
        case "cruise": gx = Math.cos(f.heading + wander * 0.5); gy = Math.sin(f.heading + wander * 0.5); want = u * (0.55 + f.restless * 0.25); break;
        case "dart": gx = Math.cos(f.goalHeading); gy = Math.sin(f.goalHeading); want = u * 2.1; break;
        case "rest": want = u * 0.04; break;
        case "investigate": case "feed": {
          const tg = f.target!; const dx = tg.x - f.x, dy = tg.y - f.y, d = len(dx, dy) || 1;
          gx = dx / d; gy = dy / d; want = clamp(d * 0.9, u * 0.1, u * (f.activity === "feed" ? 1.3 : 0.6));
          if (f.activity === "feed" && d < f.girth * 1.6) { (tg as Pellet).eaten = true; this.ripple(tg.x, tg.y, "nibble", 0.7); f.lastGulp = this.t; this.setActivity(f, "drift", 1.2); }
          if (f.activity === "investigate" && d < f.length * 0.55) { want = 0; if (this.t - f.lastGulp > 2.5 && this.rnd.next() < dt * 0.8) { this.ripple(f.x + gx * f.girth, f.y + gy * f.girth, "nibble", 0.5); f.lastGulp = this.t; } }
          break;
        }
        case "flee": { const tg = f.target!; const dx = f.x - tg.x, dy = f.y - tg.y, d = len(dx, dy) || 1; gx = dx / d; gy = dy / d; want = u * 2.6; break; }
      }
      if (slot) {
        const dx = slot.x - f.x, dy = slot.y - f.y, d = len(dx, dy) || 1, fl = fm!.flow[fm!.owner[idx]];
        const arrive = clamp(d / (f.length * 1.2), 0, 1);
        gx = dx / d * arrive + fl.x * (1 - arrive); gy = dy / d * arrive + fl.y * (1 - arrive);
        want = clamp(d * 1.8, u * 0.45, u * 2.4);
      }

      // ----- the world bends the wish: neighbours, walls, keep-clear areas, current
      let ax = 0, ay = 0;
      for (const o of this.fish) {
        if (o === f) continue;
        // keep clear of the other fish's whole body (sampled joints), not just its head
        for (let j = 0; j < JOINTS; j += 5) {
          const dx = f.x - o.joints[j].x, dy = f.y - o.joints[j].y, d = len(dx, dy), R = (f.length + o.length) * 0.32;
          if (d > 0 && d < R) { const k = (1 - d / R) ** 2 * 3; ax += dx / d * k; ay += dy / d * k; }
        }
        if (!slot && f.activity !== "flee") { const d = len(o.x - f.x, o.y - f.y); if (d < u * 2.2) { const k = (1 - d / (u * 2.2)) * 0.18; ax += Math.cos(o.heading) * k; ay += Math.sin(o.heading) * k; } }
      }
      const look = f.length * (0.8 + f.speed / (u * 2)), lx = f.x + Math.cos(f.heading) * look, ly = f.y + Math.sin(f.heading) * look, m = u * 0.45;
      if (this.border > 0) { const v = this.shore(lx, ly); if (v > 0.82) { const cx = this.w / 2 - f.x, cy = this.h / 2 - f.y, d = len(cx, cy) || 1, k = (v - 0.82) * 14; ax += cx / d * k; ay += cy / d * k; } }
      const m2 = u * 0.45; if (lx < m2) ax += (m2 - lx) / m2 * 2.5; if (lx > this.w - m) ax -= (lx - (this.w - m)) / m * 2.5;
      if (ly < m) ay += (m - ly) / m * 2.5; if (ly > this.h - m) ay -= (ly - (this.h - m)) / m * 2.5;
      if (!slot) for (const z of this.keepClear) {
        if (lx > z.x && lx < z.x + z.w && ly > z.y && ly < z.y + z.h) { const cx = z.x + z.w / 2, cy = z.y + z.h / 2, dx = f.x - cx, dy = (f.y - cy) * (z.w / Math.max(1, z.h)), d = len(dx, dy) || 1; ax += dx / d * 1.4; ay += dy / d * 1.4; }
      }
      gx += ax + this.current.x * 2.6; gy += ay + this.current.y * 2.6;
      want += len(this.current.x, this.current.y) * u * 1.6;
      f.goalSpeed = want;

      // ----- heavy body: turning is limited, faster when moving, sharper in a dart
      const goal = Math.atan2(gy, gx), err = angleDiff(goal, f.heading);
      const agility = (0.9 + 2.4 * clamp(f.speed / (u * 1.2), 0, 1)) * (f.activity === "dart" || f.activity === "flee" ? 1.6 : 1);
      f.turn += (clamp(err * 3, -agility, agility) - f.turn) * (1 - Math.exp(-dt * 6));
      f.heading += f.turn * dt;
      const accel = f.goalSpeed > f.speed ? (f.activity === "dart" || f.activity === "flee" ? 7 : 1.6) : 1.1;
      f.speed += (f.goalSpeed - f.speed) * (1 - Math.exp(-dt * accel));
      f.x += Math.cos(f.heading) * f.speed * dt; f.y += Math.sin(f.heading) * f.speed * dt;

      // swim effort: thrust when speeding up or turning hard, near-still tail while gliding
      const thrust = clamp((f.goalSpeed - f.speed) / (u * 0.6), 0, 1) + Math.abs(f.turn) * 0.25 + f.speed / (u * 3);
      f.effort += (clamp(thrust, 0.06, 1.3) - f.effort) * (1 - Math.exp(-dt * 3));
      f.beat += dt * (1.2 + f.effort * 7.5);
      f.finPhase += dt * (1.4 + (f.activity === "rest" || f.activity === "investigate" ? 2.2 : 0));

      // depth drifts slowly; feeding and curiosity bring a fish up to the surface
      if (this.rnd.next() < dt * 0.06) f.depthGoal = this.rnd.next() < 0.3 ? this.rnd.between(0.55, 0.85) : this.rnd.between(0.05, 0.35);
      const goalDepth = f.activity === "feed" || f.activity === "investigate" || slot ? 0.05 : f.depthGoal;
      f.depth += (goalDepth - f.depth) * (1 - Math.exp(-dt * 0.4));

      // a fast fish close to the surface leaves a faint wake
      if (f.depth < 0.25 && f.speed > u * 1.4 && this.rnd.next() < dt * 6) this.ripple(f.joints[3].x, f.joints[3].y, "wake", 0.35);

      this.updateBody(f, dt);
    });
  }

  private updateBody(f: Fish, dt: number) {
    const seg = f.length / (JOINTS - 1), J = f.joints, maxBend = 0.13; // radians per joint: ~110° across the whole body at most
    J[0].x = f.x; J[0].y = f.y;
    let prevAng = f.heading + Math.PI; // direction pointing backward from the head
    for (let i = 1; i < JOINTS; i++) {
      let ang = Math.atan2(J[i].y - J[i - 1].y, J[i].x - J[i - 1].x);
      const bend = angleDiff(ang, prevAng);
      if (Math.abs(bend) > maxBend) ang = prevAng + Math.sign(bend) * maxBend;
      J[i].x = J[i - 1].x + Math.cos(ang) * seg; J[i].y = J[i - 1].y + Math.sin(ang) * seg;
      prevAng = ang;
    }
    // tail fin: springs toward where a straight continuation of the body would put it
    let ax = J[JOINTS - 1].x, ay = J[JOINTS - 1].y, dir = prevAng;
    for (let i = 0; i < TAIL; i++) {
      const rest = { x: ax + Math.cos(dir) * seg * 0.8, y: ay + Math.sin(dir) * seg * 0.8 }, p = f.tail[i], v = f.tailVel[i];
      v.x += (rest.x - p.x) * 140 * dt; v.y += (rest.y - p.y) * 140 * dt; v.x *= Math.exp(-dt * 14); v.y *= Math.exp(-dt * 14);
      p.x += v.x * dt; p.y += v.y * dt;
      const dx = p.x - ax, dy = p.y - ay, d = len(dx, dy) || 1; p.x = ax + dx / d * seg * 0.8; p.y = ay + dy / d * seg * 0.8;
      dir = Math.atan2(p.y - ay, p.x - ax); ax = p.x; ay = p.y;
    }
  }

  /** Spine with the muscle wave applied, for drawing. */
  pose(f: Fish): V[] {
    const out: V[] = [];
    for (let i = 0; i < JOINTS; i++) {
      const s = i / (JOINTS - 1), a = f.joints[Math.max(0, i - 1)], b = f.joints[Math.min(JOINTS - 1, i + 1)];
      let tx = a.x - b.x, ty = a.y - b.y; const tl = len(tx, ty) || 1; tx /= tl; ty /= tl;
      // amplitude: a little at the head, rising through the tail; strongest when working hard
      const amp = f.girth * (0.12 + 1.5 * s * s) * (0.15 + 0.85 * clamp(f.effort, 0, 1.2));
      const w = Math.sin(f.beat - s * 5.4) * amp;
      out.push({ x: f.joints[i].x - ty * w, y: f.joints[i].y + tx * w });
    }
    return out;
  }
}
