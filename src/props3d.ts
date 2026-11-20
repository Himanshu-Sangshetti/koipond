// koipond — floating lily pads and the corner rocks as lit 3D objects (three.js), drawn from straight
// above into a transparent canvas that sits on top of the water.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Pad, Pond } from "./sim";

function rand(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// value noise for rock surfaces
function noise3(x: number, y: number, z: number, seed: number) {
  const h = (i: number, j: number, k: number) => { let n = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v), l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

/** A leaf texture: base colour with mottling, radiating veins, a darker rim and a few blemishes. */
function leafTexture(tone: [string, string, string], seed: number): THREE.CanvasTexture {
  const S = 1024, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!, r = rand(seed), C = S / 2;
  const grd = g.createRadialGradient(C, C, S * 0.02, C, C, S * 0.5);
  grd.addColorStop(0, tone[0]); grd.addColorStop(0.75, tone[1]); grd.addColorStop(1, tone[2]);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // mottling
  for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, d = r() * S * 0.45; g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,220,0.05)"; g.beginPath(); g.ellipse(C + Math.cos(a) * d, C + Math.sin(a) * d, S * (0.02 + r() * 0.06), S * (0.015 + r() * 0.04), r() * 3, 0, Math.PI * 2); g.fill(); }
  // veins: main ones from the centre, branching near the rim
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.05, bend = (r() - 0.5) * 0.15;
    g.strokeStyle = "rgba(230,235,190,0.42)"; g.lineWidth = S * 0.0045;
    g.beginPath(); g.moveTo(C, C);
    const mx = C + Math.cos(a + bend) * S * 0.25, my = C + Math.sin(a + bend) * S * 0.25, ex = C + Math.cos(a) * S * 0.48, ey = C + Math.sin(a) * S * 0.48;
    g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
    g.lineWidth = S * 0.002; g.strokeStyle = "rgba(230,235,190,0.25)";
    for (const side of [-1, 1]) { const bx = C + Math.cos(a) * S * 0.36, by = C + Math.sin(a) * S * 0.36; g.beginPath(); g.moveTo(bx, by); g.lineTo(C + Math.cos(a + side * 0.07) * S * 0.48, C + Math.sin(a + side * 0.07) * S * 0.48); g.stroke(); }
  }
  // blemishes and a slightly darker, worn rim
  for (let i = 0; i < 5; i++) { const a = r() * Math.PI * 2, d = S * (0.2 + r() * 0.25); g.fillStyle = "rgba(90,60,25,0.35)"; g.beginPath(); g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, S * (0.005 + r() * 0.012), 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = "rgba(40,30,10,0.35)"; g.lineWidth = S * 0.012; g.beginPath(); g.arc(C, C, S * 0.493, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const PAD_TONES: Record<string, [string, string, string][]> = {
  natural: [["#5e8a52", "#45703e", "#30522d"], ["#7a9654", "#5f7c42", "#455c31"], ["#6b7f4c", "#54683c", "#3c4c2c"]],
  ink: [["#8a9864", "#707e50", "#55603c"], ["#a0a56e", "#868c58", "#686e42"], ["#76845c", "#5e6c4a", "#475238"]],
  garden: [["#8c8f52", "#6b6e36", "#4b4d22"], ["#b3aa6b", "#9a9250", "#746c34"], ["#a88466", "#8c6a4e", "#654a36"]],
};
const ROCK_TONES: Record<string, string[]> = { natural: ["#6f7471", "#858a83", "#5c6260"], ink: ["#8e958f", "#a3a79c", "#767e7c"], garden: ["#8d8c80", "#a4a094", "#77786e"] };

/** A lily pad: a thin disc with the notch cut out and the rim gently turned up. */
function padGeometry(notch: number) {
  const shape = new THREE.Shape(), N = 96;
  shape.moveTo(0, 0);
  for (let i = 0; i <= N; i++) { const a = notch * 0.5 + (i / N) * (Math.PI * 2 - notch); shape.lineTo(Math.cos(a), Math.sin(a)); }
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape, 24);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute, uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), d = Math.hypot(x, y);
    pos.setZ(i, 0.06 * Math.pow(d, 4) + 0.015 * Math.sin(Math.atan2(y, x) * 7) * d * d); // rim turned up, slight waviness
    uv.setXY(i, x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A rock: a lumpy, flattened sphere with speckled colour and moss on top. */
function rockGeometry(seed: number, tones: string[]) {
  const geo = new THREE.IcosahedronGeometry(1, 5), pos = geo.getAttribute("position") as THREE.BufferAttribute, r = rand(seed);
  const cols = new Float32Array(pos.count * 3), base = tones.map((t) => new THREE.Color(t)), moss = new THREE.Color("#5c6e42");
  const sx = 0.9 + r() * 0.4, sy = 0.7 + r() * 0.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise3(x * 1.6, y * 1.6, z * 1.6, seed) * 0.32 + noise3(x * 5, y * 5, z * 5, seed + 9) * 0.07;
    const k = 0.8 + n;
    pos.setXYZ(i, x * k * sx, y * k * sy, Math.max(-0.2, z * k * 0.55));
    const c = base[0].clone().lerp(base[1], noise3(x * 3, y * 3, z * 3, seed + 3)).lerp(base[2], noise3(x * 9, y * 9, z * 9, seed + 5) * 0.6);
    const speck = noise3(x * 30, y * 30, z * 30, seed + 7);
    c.multiplyScalar(0.85 + speck * 0.3);
    if (z > 0.35 && noise3(x * 2.5, y * 2.5, 0, seed + 11) > 0.55) c.lerp(moss, 0.6);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createProps3D() {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.25;
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4); sun.position.set(-0.45, 0.6, 1); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xe8f0ea, 0x445544, 0.9));
  const cam = new THREE.OrthographicCamera(0, 1, 0, 1, -500, 500); cam.position.set(0, 0, 100); cam.lookAt(0, 0, 0);
  const pads = new Map<Pad, THREE.Mesh>();
  let rocks: { key: string; group: THREE.Group } | null = null, style = "";

  return {
    canvas,
    frame: 0,
    render(pond: Pond, w: number, h: number, rockList: { x: number; y: number; rx: number; ry: number; a: number }[]) {
      if ((this.frame++ & 1) === 1 && canvas.width === w) return; // pads drift slowly: half rate is plenty
      if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
      cam.left = 0; cam.right = pond.w; cam.top = pond.h; cam.bottom = 0; cam.updateProjectionMatrix(); // y up; pond y is flipped below
      const st = PAD_TONES[pond.style] ? pond.style : "natural";
      if (st !== style) { for (const [, m] of pads) { scene.remove(m); (m.material as THREE.Material).dispose(); } pads.clear(); if (rocks) { scene.remove(rocks.group); rocks = null; } style = st; }
      // pads: one mesh each, following the simulation
      const alive = new Set<Pad>();
      pond.pads.forEach((p, i) => {
        alive.add(p);
        let m = pads.get(p);
        if (!m) {
          const tone = PAD_TONES[st][p.tone < 0.45 ? 0 : p.tone < 0.75 ? 1 : 2];
          m = new THREE.Mesh(padGeometry(p.notch), new THREE.MeshPhysicalMaterial({ map: leafTexture(tone, 31 + i * 17), roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.3, side: THREE.DoubleSide }));
          scene.add(m); pads.set(p, m);
        }
        m.position.set(p.x, pond.h - p.y, 2); m.rotation.z = -p.angle; m.scale.set(p.r, p.r, p.r);
      });
      for (const [p, m] of pads) if (!alive.has(p)) { scene.remove(m); pads.delete(p); }
      // rocks: built once for the current layout
      const key = rockList.map((s) => `${s.x.toFixed(0)},${s.y.toFixed(0)}`).join("|") + st;
      if (rocks?.key !== key) {
        if (rocks) scene.remove(rocks.group);
        const group = new THREE.Group();
        rockList.forEach((s, i) => {
          const mesh = new THREE.Mesh(rockGeometry(101 + i * 13, ROCK_TONES[st]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
          mesh.position.set(s.x, pond.h - s.y, 1); mesh.rotation.z = -s.a; mesh.scale.set(s.rx, s.ry, (s.rx + s.ry) * 0.5);
          group.add(mesh);
        });
        scene.add(group); rocks = { key, group };
      }
      renderer.render(scene, cam);
    },
    dispose() { renderer.dispose(); pmrem.dispose(); },
  };
}
