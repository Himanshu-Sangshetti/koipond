// koipond — koi as real 3D geometry, rendered with three.js.
//
// Each koi body is a tube built around its posed spine: at every point along the body a rounded
// cross-section (wider than tall, like a real koi seen from above), so the surface has true normals.
// It is lit by a low sun and a soft sky with a physically based material: a painted pattern texture
// (unique per fish), a wet clear-coat sheen, metallic scales on gold koi, and a fine scale relief.
// Fins and the tail are thin translucent membranes with rays that bend with the body.
// The scene is drawn from straight above into its own transparent canvas; the water pass then
// refracts it, fades it with depth and uses its silhouette for the shadows on the pond floor.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Fish, Pond, V } from "./sim";

const RINGS = 40, SIDES = 22;

function catmull(p: V[], t: number): V {
  const n = p.length - 1, x = t * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(n, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  const k = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  return { x: k(p0.x, p1.x, p2.x, p3.x), y: k(p0.y, p1.y, p2.y, p3.y) };
}

/** Body half-width along its length: blunt rounded head, fullest at the shoulders, long taper to the tail. */
function width(s: number) {
  if (s < 0.24) { const k = s / 0.24; return 0.36 + 0.64 * Math.sqrt(1 - (1 - k) * (1 - k)); }
  const k = (s - 0.24) / 0.76; return 0.1 + 0.9 * Math.pow(Math.cos(k * Math.PI * 0.5), 1.25);
}

// ------------------------------------------------------------------------------- textures (per fish)
function rand(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** The koi's skin unrolled: u along the body (x), around the body (y, back in the middle). */
function skin(f: Fish): THREE.CanvasTexture {
  const W = 512, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!, r = rand(f.id * 7919 + 13), v = f.variety;
  g.fillStyle = v.base; g.fillRect(0, 0, W, H);
  // markings: clusters of soft-edged blobs, mostly over the back, never on the belly edges
  const blob = (x: number, y: number, rx: number, ry: number, col: string) => {
    g.save(); g.filter = "blur(2px)"; g.fillStyle = col; g.beginPath();
    const n = 9; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, wob = 0.75 + r() * 0.5; const px = x + Math.cos(a) * rx * wob, py = y + Math.sin(a) * ry * wob; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath(); g.fill(); g.restore();
  };
  if (v.name === "minnow") { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  if (v.name === "tancho") blob(W * 0.07, H * 0.5, W * 0.05, H * 0.22, "#e2380f");
  let cover = 0;
  while (cover < v.spotCover) {
    const x = W * (0.04 + r() * 0.82), y = H * (0.5 + (r() - 0.5) * 0.45), rx = W * (0.05 + r() * 0.09), ry = H * (0.16 + r() * 0.2), col = v.spots[Math.floor(r() * v.spots.length)];
    blob(x, y, rx, ry, col); blob(x + (r() - 0.5) * rx, y + (r() - 0.5) * ry, rx * 0.6, ry * 0.7, col);
    cover += (rx / W) * (ry / H) * 4;
  }
  // a darker line down the back and paler flanks, as real koi have
  const back = g.createLinearGradient(0, 0, 0, H);
  back.addColorStop(0, "rgba(255,255,255,0.18)"); back.addColorStop(0.5, "rgba(0,0,0,0.08)"); back.addColorStop(1, "rgba(255,255,255,0.18)");
  g.fillStyle = back; g.fillRect(0, 0, W, H);
  // eyes on the sides of the head
  g.fillStyle = "#0a090c";
  for (const y of [H * 0.2, H * 0.8]) { g.beginPath(); g.ellipse(W * 0.05, y, 4, 5, 0, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

let scaleTex: THREE.CanvasTexture | null = null;
/** A shared relief of small overlapping scales, used as a bump map. */
function scales(): THREE.CanvasTexture {
  if (scaleTex) return scaleTex;
  const W = 512, H = 128, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!; g.fillStyle = "#808080"; g.fillRect(0, 0, W, H);
  const sx = 11, sy = 9;
  for (let row = 0; row < H / sy + 1; row++) for (let col = 0; col < W / sx + 1; col++) {
    const x = col * sx + (row % 2) * sx * 0.5, y = row * sy;
    const grd = g.createRadialGradient(x - 2, y, 0, x, y, sx * 0.8);
    grd.addColorStop(0, "#b0b0b0"); grd.addColorStop(0.8, "#808080"); grd.addColorStop(1, "#505050");
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, sx * 0.75, -Math.PI / 2, Math.PI / 2); g.fill();
  }
  scaleTex = new THREE.CanvasTexture(c); scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping;
  return scaleTex;
}

let finTex: THREE.CanvasTexture | null = null;
/** Fin membrane: rays fanning out, thin and bright, darker at the frayed edge. */
function fins(): THREE.CanvasTexture {
  if (finTex) return finTex;
  const W = 256, H = 256, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, "rgba(255,255,255,0.75)"); grd.addColorStop(0.75, "rgba(255,255,255,0.45)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.2;
  for (let i = 0; i <= 26; i++) { const y = (i / 26) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W * 0.98, y + (i - 13) * 1.5); g.stroke(); }
  finTex = new THREE.CanvasTexture(c); finTex.colorSpace = THREE.SRGBColorSpace;
  return finTex;
}

// ------------------------------------------------------------------------------- the renderer
type Koi = { body: THREE.Mesh; fins: THREE.Mesh[]; tail: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; finMat: THREE.MeshBasicMaterial };

function strip(n: number) {
  // a grid of (n+1) x 2 vertices with triangles, used for fins and the tail
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let i = 0; i <= n; i++) { uv.set([0, i / n, 1, i / n], i * 4); }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  return geo;
}

export function createFish3D() {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.18;
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7); sun.position.set(-0.45, -0.6, 1); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xf2efe4, 0x8a8a70, 1.25));
  const cam = new THREE.OrthographicCamera(0, 1, 0, 1, -500, 500);
  cam.position.set(0, 0, 100); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
  const kois = new Map<number, Koi>();

  const build = (f: Fish): Koi => {
    const geo = new THREE.BufferGeometry();
    const nv = (RINGS + 1) * (SIDES + 1);
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i <= RINGS; i++) for (let j = 0; j <= SIDES; j++) uv.set([i / RINGS, j / SIDES], (i * (SIDES + 1) + j) * 2);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SIDES; j++) { const a = i * (SIDES + 1) + j, b = a + SIDES + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    geo.setIndex(idx);
    const gold = f.variety.name === "ogon" || f.variety.name === "yamabuki";
    const mat = new THREE.MeshPhysicalMaterial({
      map: skin(f), bumpMap: scales(), bumpScale: 0.35, roughness: gold ? 0.4 : 0.55, metalness: gold ? 0.3 : 0.0,
      clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(geo, mat); scene.add(body);
    const finMat = new THREE.MeshBasicMaterial({ map: fins(), color: new THREE.Color(f.variety.fin).lerp(new THREE.Color("#f3eee4"), 0.25), transparent: true, opacity: 0.68, side: THREE.DoubleSide, depthWrite: false, premultipliedAlpha: true });
    const fms: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(strip(8), finMat); scene.add(m); fms.push(m); }
    const dorsal = new THREE.Mesh(strip(10), finMat); scene.add(dorsal); fms.push(dorsal);
    const tailGeo = strip(14), tuv = tailGeo.getAttribute("uv") as THREE.BufferAttribute;
    for (let q = 0; q <= 14; q++) { tuv.setXY(q * 2, q / 14, 0); tuv.setXY(q * 2 + 1, q / 14, 1); } // rays run along the tail
    const tail = new THREE.Mesh(tailGeo, finMat); scene.add(tail);
    return { body, fins: fms, tail, mat, finMat };
  };

  const water = new THREE.Color("#3b5e58");
  return {
    canvas,
    render(pond: Pond, w: number, h: number) {
      if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
      cam.left = 0; cam.right = pond.w; cam.top = 0; cam.bottom = pond.h; cam.updateProjectionMatrix();
      const alive = new Set<number>();
      for (const f of pond.fish) {
        alive.add(f.id);
        const k = kois.get(f.id) ?? (kois.set(f.id, build(f)), kois.get(f.id)!);
        const pose = pond.pose(f), pts: V[] = [], tg: V[] = [];
        for (let i = 0; i <= RINGS; i++) pts.push(catmull(pose, i / RINGS));
        for (let i = 0; i <= RINGS; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(RINGS, i + 1)], l = Math.hypot(a.x - b.x, a.y - b.y) || 1; tg.push({ x: (a.x - b.x) / l, y: (a.y - b.y) / l }); }
        const z0 = -f.depth * f.girth * 3; // deeper fish sit lower
        // body: rounded cross-sections, a little flatter on the back than a circle
        const pos = k.body.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i <= RINGS; i++) {
          const s = i / RINGS, wd = f.girth * width(s), ht = wd * 0.78, nx = -tg[i].y, ny = tg[i].x;
          for (let j = 0; j <= SIDES; j++) {
            const th = (j / SIDES) * Math.PI, cx = Math.cos(th), cz = Math.sin(th);
            // nose: pull the first ring in so the snout is rounded, not cut off
            const nose = i === 0 ? 0.0 : 1;
            pos.setXYZ(i * (SIDES + 1) + j, pts[i].x + nx * cx * wd * nose + tg[i].x * (i === 0 ? f.girth * 0.25 : 0), pts[i].y + ny * cx * wd * nose + tg[i].y * (i === 0 ? f.girth * 0.25 : 0), z0 + cz * ht);
          }
        }
        pos.needsUpdate = true; k.body.geometry.computeVertexNormals();
        k.mat.color.copy(new THREE.Color(1, 1, 1).lerp(water, f.depth * 0.18));
        k.finMat.opacity = 0.68 - f.depth * 0.15;
        // pectoral and pelvic fins: membranes swept back from the body, paddling gently
        const paddle = 0.85 + 0.2 * Math.sin(f.finPhase * 2.2);
        let fi = 0;
        for (const [s0, size, sweep] of [[0.25, 1.9, 0.75], [0.6, 0.95, 0.6]] as const) {
          const i = Math.round(s0 * RINGS), base = pts[i], t = tg[i];
          for (const side of [1, -1]) {
            const nx = -t.y * side, ny = t.x * side, reach = f.girth * size * paddle * (1 - Math.max(0, side * f.turn) * 0.3);
            const geo = k.fins[fi++].geometry, p = geo.getAttribute("position") as THREE.BufferAttribute;
            for (let q = 0; q <= 8; q++) {
              const u = q / 8, root = { x: base.x + nx * f.girth * width(s0) * 0.8 + t.x * f.girth * (0.5 - u), y: base.y + ny * f.girth * width(s0) * 0.8 + t.y * f.girth * (0.5 - u) };
              const ang = sweep * (0.4 + u), dx = nx * Math.cos(ang) - t.x * Math.sin(ang), dy = ny * Math.cos(ang) - t.y * Math.sin(ang), len = reach * Math.sin(Math.PI * (0.15 + u * 0.85)) ** 0.7;
              p.setXYZ(q * 2, root.x, root.y, z0 + f.girth * 0.1); p.setXYZ(q * 2 + 1, root.x + dx * len, root.y + dy * len, z0 - f.girth * 0.05);
            }
            p.needsUpdate = true;
          }
        }
        // dorsal fin: a low ribbon on the back
        { const geo = k.fins[4].geometry, p = geo.getAttribute("position") as THREE.BufferAttribute;
          for (let q = 0; q <= 10; q++) { const i = Math.round((0.3 + q * 0.03) * RINGS), wd = f.girth * 0.22 * Math.sin((q / 10) * Math.PI) + 0.2, nx = -tg[i].y, ny = tg[i].x; p.setXYZ(q * 2, pts[i].x - nx * wd, pts[i].y - ny * wd, z0 + f.girth * 0.8); p.setXYZ(q * 2 + 1, pts[i].x + nx * wd, pts[i].y + ny * wd, z0 + f.girth * 0.8); }
          p.needsUpdate = true; }
        // tail: a broad, forked membrane that trails on the spring-driven tail chain
        { const geo = k.tail.geometry, p = geo.getAttribute("position") as THREE.BufferAttribute;
          const root = pts[RINGS], chain = [root, ...f.tail];
          let dx = chain[chain.length - 1].x - root.x, dy = chain[chain.length - 1].y - root.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
          for (let q = 0; q <= 14; q++) {
            const s = q / 14, c = catmull(chain, Math.min(1, s * 1.15)), spread = f.girth * (0.12 + 1.15 * Math.pow(s, 1.1)), fork = Math.max(0, s - 0.6) * 4 * f.girth;
            p.setXYZ(q * 2, c.x - dy * spread + dx * fork, c.y + dx * spread + dy * fork, z0);
            p.setXYZ(q * 2 + 1, c.x + dy * spread + dx * fork, c.y - dx * spread + dy * fork, z0);
          }
          p.needsUpdate = true; }
      }
      for (const [id, k] of kois) if (!alive.has(id)) { scene.remove(k.body, k.tail, ...k.fins); kois.delete(id); }
      renderer.render(scene, cam);
    },
    dispose() { renderer.dispose(); pmrem.dispose(); },
  };
}
