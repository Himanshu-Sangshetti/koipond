// koipond — the things floating on the surface (petals, lily flowers, rain, splash droplets, bubbles,
// food) drawn on the GPU as instanced sprites into a render target. This replaces drawing them into a
// full-size 2D canvas and copying that canvas to the GPU every frame, which is slow in some browsers.
// Petals and lilies come from a small atlas drawn once per art style; the round things are drawn by
// the shader. The output matches drawTop() in draw.ts (same shapes, colours and order).
import * as THREE from "three";
import { drawFloaterAtlas } from "./draw";
import type { Pond } from "./sim";

const MAX = 512, CELL = 160;
const enum K { Petal = 0, Lily = 1, Disc = 2, Ring = 3, Glow = 4, Pellet = 5, Streak = 6 }

const VERT = `
in vec3 position; in vec2 iPos; in vec2 iSize; in float iRot; in float iKind; in vec4 iColor; in float iExtra;
uniform mat4 projectionMatrix;
out vec2 p; out float kind; out vec4 color; out float extra;
void main(){
  p = position.xy; kind = iKind; color = iColor; extra = iExtra;
  float c = cos(iRot), s = sin(iRot); vec2 q = position.xy * iSize;
  gl_Position = projectionMatrix * vec4(iPos + vec2(c * q.x - s * q.y, s * q.x + c * q.y), 0., 1.);
}`;
const FRAG = `
precision highp float;
in vec2 p; in float kind; in vec4 color; in float extra;
uniform sampler2D atlas;
out vec4 o;
void main(){
  float d = length(p), aa = max(fwidth(d), 1e-4);
  vec4 c = vec4(0.);                                   // premultiplied
  if (kind < .5 || kind < 1.5) {                      // petal / lily from the atlas (premultiplied)
    vec2 uv = p * .5 + .5; uv.x = (uv.x + (kind < .5 ? 0. : 1.)) * .5;
    c = texture(atlas, uv) * color.a;
  } else if (kind < 2.5) { float a = color.a * (1. - smoothstep(1. - aa, 1. + aa, d)); c = vec4(color.rgb * a, a); }
  else if (kind < 3.5) { float hw = extra; float a = color.a * (1. - smoothstep(hw - aa, hw + aa, abs(d - (1. - hw)))); c = vec4(color.rgb * a, a); }
  else if (kind < 4.5) { float a = color.a * clamp(1. - d, 0., 1.); c = vec4(color.rgb * a, a); }
  else if (kind < 5.5) {                               // food pellet: offset radial gradient
    float t = clamp((length(p - vec2(-.3)) - .1) / 1.2, 0., 1.);
    vec3 col = mix(vec3(.941, .843, .604), vec3(.612, .455, .212), t);
    float a = 1. - smoothstep(1. - aa, 1. + aa, d); c = vec4(col * a, a);
  } else {                                             // rain streak: a thin rounded line
    float a = color.a * (1. - smoothstep(1. - fwidth(p.y), 1., abs(p.y))); c = vec4(color.rgb * a, a);
  }
  o = c;
}`;

export function createSprites(renderer: THREE.WebGLRenderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  const atlasCanvas = document.createElement("canvas"); atlasCanvas.width = CELL * 2; atlasCanvas.height = CELL;
  const atlas = new THREE.Texture(atlasCanvas);
  atlas.flipY = false; atlas.premultiplyAlpha = true; atlas.colorSpace = THREE.NoColorSpace; atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.generateMipmaps = true;
  let atlasStyle = "";

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const pos = new Float32Array(MAX * 2), size = new Float32Array(MAX * 2), rot = new Float32Array(MAX), kind = new Float32Array(MAX), col = new Float32Array(MAX * 4), extra = new Float32Array(MAX);
  const attrs = {
    iPos: new THREE.InstancedBufferAttribute(pos, 2), iSize: new THREE.InstancedBufferAttribute(size, 2), iRot: new THREE.InstancedBufferAttribute(rot, 1),
    iKind: new THREE.InstancedBufferAttribute(kind, 1), iColor: new THREE.InstancedBufferAttribute(col, 4), iExtra: new THREE.InstancedBufferAttribute(extra, 1),
  };
  for (const [k, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: { atlas: { value: atlas } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  mat.forceSinglePass = true;
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);

  let n = 0;
  const put = (k: K, x: number, y: number, sx: number, sy: number, r: number, c: readonly [number, number, number, number], e = 0) => {
    if (n >= MAX) return;
    pos[n * 2] = x; pos[n * 2 + 1] = y; size[n * 2] = sx; size[n * 2 + 1] = sy; rot[n] = r; kind[n] = k; extra[n] = e;
    col.set(c, n * 4); n++;
  };
  const WHITE = [1, 1, 1, 1] as const;

  return {
    texture: target.texture,
    render(pond: Pond, w: number, h: number) {
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      if (atlasStyle !== pond.style) { drawFloaterAtlas(atlasCanvas.getContext("2d")!, CELL, pond.style); atlas.needsUpdate = true; atlasStyle = pond.style; }
      cam.left = 0; cam.right = pond.w; cam.top = 0; cam.bottom = pond.h; cam.updateProjectionMatrix();
      const unit = Math.min(pond.w, pond.h) * 0.11, k47 = 0.5 / 0.47;
      n = 0;
      for (const p of pond.pellets) { const r = Math.max(0.8, unit * 0.04); put(K.Pellet, p.x, p.y, r, r, 0, WHITE); }
      for (const p of pond.petals) { const r = p.r * (1 + p.z * 0.6) * k47; put(K.Petal, p.x, p.y, r, r, p.angle, [1, 1, 1, p.z > 0 ? 0.92 : 1]); }
      if (pond.rain > 0) {
        const lw = Math.max(0.6, unit * 0.008), cnt = Math.round(pond.rain * 40);
        for (let i = 0; i < cnt; i++) {
          const x = Math.random() * pond.w, y = Math.random() * pond.h, l = unit * (0.08 + Math.random() * 0.12), dx = l * 0.25, dy = l;
          put(K.Streak, x + dx / 2, y + dy / 2, Math.hypot(dx, dy) / 2 + lw / 2, lw / 2, Math.atan2(dy, dx), [235 / 255, 245 / 255, 240 / 255, 0.22]);
        }
      }
      for (const sp of pond.sparks) {
        if (sp.age < 0) continue; const k = sp.age / sp.life, arc = sp.drip ? Math.sin(k * Math.PI) : 1 - k;
        const a = (sp.drip ? 0.75 : 0.6) * (sp.drip ? 0.4 + 0.6 * arc : arc), r = sp.r * (sp.drip ? 0.7 + arc * 0.7 : 0.6 + arc * 0.5);
        put(K.Disc, sp.x, sp.y - (sp.drip ? arc * unit * 0.08 : 0), r, r, 0, [240 / 255, 250 / 255, 248 / 255, a]);
      }
      for (const fl of pond.flashes) { const k = 1 - fl.age / 0.3, R = unit * (0.12 + fl.age * 0.6); put(K.Glow, fl.x, fl.y, R, R, 0, [1, 1, 1, 0.3 * k]); }
      for (const b of pond.bubbles) {
        if (b.age < 0) continue;
        const k = Math.min(1, b.age / 0.3), r = b.r * (0.6 + 0.4 * k), lw = Math.max(0.6, r * 0.18), R = r + lw / 2;
        put(K.Ring, b.x, b.y, R, R, 0, [235 / 255, 250 / 255, 248 / 255, 0.55 * k], (lw / 2) / R);
        put(K.Disc, b.x - r * 0.35, b.y - r * 0.35, r * 0.25, r * 0.25, 0, [1, 1, 1, 0.7 * k]);
      }
      for (const p of pond.pads) if (p.flower) {
        const r = p.r * 0.48 * k47; put(K.Lily, p.x + Math.cos(p.angle + Math.PI) * p.r * 0.15, p.y + Math.sin(p.angle + Math.PI) * p.r * 0.15, r, r, p.angle * 3, WHITE);
      }
      geo.instanceCount = n;
      for (const a of Object.values(attrs)) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); if (n) renderer.render(scene, cam); renderer.setRenderTarget(null);
    },
    dispose() { target.dispose(); atlas.dispose(); geo.dispose(); mat.dispose(); },
  };
}
