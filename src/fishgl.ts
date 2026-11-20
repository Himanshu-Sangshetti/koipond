// koipond — koi drawn on the GPU as real meshes, at full screen resolution.
//
// Each fish becomes a smooth triangle strip along its posed spine (resampled with Catmull-Rom so the
// outline is round, not faceted), with coordinates on the body: u from nose (0) to tail root (1) and
// v across (-1 … 1). The fragment shader treats the body as a rounded form lit from above: a soft
// highlight runs along the back, the flanks fall into shade, fine scales catch the light, and the koi's
// markings are grown from noise in body space so every fish has organic, unique patches that bend with
// it. Fins and the tail are separate translucent strips with rays. The result is written to a texture
// (colour + alpha) that the water pass refracts, tints with depth and uses to cast shadows.
import type { Fish, Pond, V } from "./sim";

const VERT = `#version 300 es
in vec2 pos; in vec4 body; in vec3 cBase; in vec3 cA; in vec3 cB; in vec4 meta;
uniform vec2 pond;
out vec4 vBody; out vec3 vBase; out vec3 vA; out vec3 vB; out vec4 vMeta;
void main(){
  vBody = body; vBase = cBase; vA = cA; vB = cB; vMeta = meta;
  vec2 c = pos / pond * 2. - 1.;
  gl_Position = vec4(c.x, c.y, 0, 1);   // pond top → texture row 0, matching the other layers
}`;

// body: (u, v, kind, finRay) · meta: (seed, depth, cover, variety)
const FRAG = `#version 300 es
precision highp float;
in vec4 vBody; in vec3 vBase; in vec3 vA; in vec3 vB; in vec4 vMeta;
out vec4 o;
float h21(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
void main(){
  float u = vBody.x, v = vBody.y, kind = vBody.z, seed = vMeta.x, depth = vMeta.y, cover = vMeta.z, variety = vMeta.w;
  if (kind > .5){
    // fins and tail: thin, translucent, ribbed with rays, fading toward the edge
    float rays = .9 + .1 * cos(vBody.w * 46.);
    float edge = smoothstep(1., .7, abs(v)) * smoothstep(1.05, .78, u);
    vec3 c = mix(vBase, vec3(1.), .18) * rays;
    float a = .5 * edge * (.8 + .2 * rays);
    o = vec4(c * a, a);
    return;
  }
  float av = abs(v);
  // rounded body lit from above-left: soft back highlight, flanks in shade
  float nz = sqrt(max(0., 1. - av * av));
  float light = .48 + .55 * nz + .12 * (-v);
  float spine = exp(-pow((v + .18) / .22, 2.)) * smoothstep(.95, .2, u) * .32;
  // markings grown from noise in body space (they bend with the fish)
  vec2 p = vec2(u * 5.2, v * 1.25) + seed * 17.;
  float n = fbm(p) + .35 * fbm(p * 2.3 + 4.);
  float th = .95 - cover * .6;
  float mA = smoothstep(th, th + .06, n) * step(.02, cover);
  float n2 = fbm(p * 1.9 + 31.);
  float mB = smoothstep(.83, .88, n2) * step(.5, length(vB));      // small accent spots (sumi / second colour)
  // tancho: a single round crown on the head
  if (variety > 4.5 && variety < 5.5) mA = smoothstep(.12, .1, length(vec2((u - .08) * 3.2, v * .62)));
  vec3 c = vBase;
  c = mix(c, vA, mA);
  c = mix(c, vB, mB * (1. - mA * .6));
  // fine scales: offset rows of small arcs, a little darker at their edges
  vec2 sc = vec2(u * 46., v * 7. + floor(u * 46.) * .5);
  float sd = length(fract(sc) - vec2(.5, .15));
  float scales = smoothstep(.42, .5, sd) * smoothstep(.62, .5, sd) * smoothstep(.12, .2, u);
  c *= light * (1. - scales * .1);
  c += spine * vec3(1.);
  // head: slightly darker around the eyes, and the eyes themselves
  vec2 e = vec2((u - .065) * 9., (av - .58) * 2.2);
  float eye = smoothstep(.36, .26, length(e));
  c = mix(c, vec3(.05, .04, .05), eye);
  c += eye * smoothstep(.12, .0, length(e - vec2(-.08, -.1))) * .6;
  // the darker flank toward the very edge, then a soft anti-aliased outline
  c *= .82 + .18 * smoothstep(1., .65, av);
  float a = smoothstep(1., .9, av);
  // deeper fish are hazier
  c = mix(c, vec3(.16, .25, .24), depth * .35);
  o = vec4(c * a, a);
}`;

const N = 34; // samples along the body

function catmull(p: V[], t: number): V {
  const n = p.length - 1, x = t * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(n, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  const k = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  return { x: k(p0.x, p1.x, p2.x, p3.x), y: k(p0.y, p1.y, p2.y, p3.y) };
}

/** Half-width along the body: a round head, the widest point just behind it, a long taper. */
function profile(s: number) {
  if (s < 0.2) return Math.sqrt(Math.max(0, 1 - Math.pow((0.2 - s) / 0.2, 2))) * 0.92 + 0.02;
  return 0.06 + 0.94 * Math.pow(Math.cos(((s - 0.2) / 0.8) * Math.PI * 0.5), 1.15);
}

const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const VARIETY_INDEX: Record<string, number> = { kohaku: 0, sanke: 1, showa: 2, ogon: 3, chagoi: 4, tancho: 5, asagi: 6, yamabuki: 7 };

export function createFishRenderer(gl: WebGL2RenderingContext) {
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "fish shader"); return s; };
  const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "fish link");
  const STRIDE = 2 + 4 + 3 + 3 + 3 + 4; // pos, body, cBase, cA, cB, meta
  const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let off = 0;
  for (const [name, size] of [["pos", 2], ["body", 4], ["cBase", 3], ["cA", 3], ["cB", 3], ["meta", 4]] as const) {
    const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4); off += size;
  }
  gl.bindVertexArray(null);
  let data = new Float32Array(1 << 16), count = 0;
  const push = (x: number, y: number, u: number, v: number, kind: number, ray: number, f: Fish, cb: number[], ca: number[], cbb: number[], cover: number) => {
    if ((count + 1) * STRIDE > data.length) { const d = new Float32Array(data.length * 2); d.set(data); data = d; }
    data.set([x, y, u, v, kind, ray, ...cb, ...ca, ...cbb, f.id * 0.618 % 1, f.depth, cover, VARIETY_INDEX[f.variety.name] ?? 0], count * STRIDE); count++;
  };
  // triangles from a strip of (left, right) pairs
  const strip = (L: number[][], R: number[][], meta: (i: number, side: number) => [number, number, number, number], f: Fish, cb: number[], ca: number[], cbb: number[], cover: number) => {
    for (let i = 0; i < L.length - 1; i++) {
      const q = [[L[i], meta(i, -1)], [R[i], meta(i, 1)], [L[i + 1], meta(i + 1, -1)], [R[i], meta(i, 1)], [R[i + 1], meta(i + 1, 1)], [L[i + 1], meta(i + 1, -1)]] as const;
      for (const [p, m] of q) push(p[0], p[1], m[0], m[1], m[2], m[3], f, cb, ca, cbb, cover);
    }
  };

  const fbo = gl.createFramebuffer()!, tex = gl.createTexture()!;
  let W = 0, H = 0;
  const size = (w: number, h: number) => {
    if (w === W && h === H) return; W = w; H = h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    texture: tex,
    render(pond: Pond, w: number, h: number) {
      size(w, h); count = 0;
      const fishes = [...pond.fish].sort((a, b) => b.depth - a.depth);
      for (const f of fishes) {
        const pose = pond.pose(f), v = f.variety;
        const cb = hex(v.base), ca = hex(v.spots[0] ?? v.base), cbb = v.spots.length > 1 ? hex(v.spots[v.spots.length - 1]) : [0, 0, 0];
        const cover = v.name === "tancho" ? 0.5 : v.spotCover, fin = hex(v.fin);
        // smooth spine, extended a little beyond the first joint for a round snout
        const pts: V[] = [], tg: V[] = [];
        for (let i = 0; i <= N; i++) pts.push(catmull(pose, i / N));
        for (let i = 0; i <= N; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)], l = Math.hypot(a.x - b.x, a.y - b.y) || 1; tg.push({ x: (a.x - b.x) / l, y: (a.y - b.y) / l }); }
        const L: number[][] = [], R: number[][] = [];
        for (let i = 0; i <= N; i++) { const wdt = f.girth * profile(i / N), nx = -tg[i].y, ny = tg[i].x; L.push([pts[i].x + nx * wdt, pts[i].y + ny * wdt]); R.push([pts[i].x - nx * wdt, pts[i].y - ny * wdt]); }
        // fins first (under the body): pectorals and pelvics as fanned strips
        for (const [s0, size, back] of [[0.24, 1.6, 0.55], [0.6, 0.75, 0.4]] as const) {
          const i = Math.round(s0 * N), base = pts[i], t = tg[i], paddle = 0.85 + 0.25 * Math.sin(f.finPhase * 2.2);
          for (const side of [1, -1]) {
            const nx = -t.y * side, ny = t.x * side, reach = f.girth * size * paddle * (1 - Math.max(0, side * f.turn) * 0.3);
            const FL: number[][] = [], FR: number[][] = [];
            for (let k = 0; k <= 6; k++) {
              const s = k / 6, ang = s * 1.1, dirx = nx * Math.cos(ang * back) - t.x * Math.sin(ang * back), diry = ny * Math.cos(ang * back) - t.y * Math.sin(ang * back);
              const rootx = base.x + nx * f.girth * 0.7 + t.x * f.girth * (0.45 - s * 0.9), rooty = base.y + ny * f.girth * 0.7 + t.y * f.girth * (0.45 - s * 0.9);
              FL.push([rootx, rooty]); FR.push([rootx + dirx * reach * (1 - Math.pow(s - 0.35, 2)), rooty + diry * reach * (1 - Math.pow(s - 0.35, 2))]);
            }
            strip(FL, FR, (k, sd) => [sd > 0 ? 0.95 : 0, (k / 6) * 2 - 1, 1, k / 6], f, fin, ca, cbb, cover);
          }
        }
        // tail: two flowing lobes following the spring-driven tail chain
        const root = pts[N], chain = [root, ...f.tail];
        let dx = chain[chain.length - 1].x - root.x, dy = chain[chain.length - 1].y - root.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const TL: number[][] = [], TR: number[][] = [], M = 12;
        for (let k = 0; k <= M; k++) {
          const s = k / M, c = catmull(chain, s), spread = f.girth * (0.12 + 1.75 * Math.pow(s, 0.8)), fork = s > 0.8 ? (s - 0.8) * 5 : 0;
          TL.push([c.x - dy * spread + dx * f.girth * fork * 0.6, c.y + dx * spread + dy * f.girth * fork * 0.6]);
          TR.push([c.x + dy * spread + dx * f.girth * fork * 0.6, c.y - dx * spread + dy * f.girth * fork * 0.6]);
        }
        strip(TL, TR, (k, sd) => [k / M, sd, 1, (sd + 1) * 0.5 + k * 0.01], f, fin, ca, cbb, cover);
        // dorsal fin: a thin ribbon along the back
        const DL: number[][] = [], DR: number[][] = [];
        for (let k = 0; k <= 8; k++) { const i = Math.round((0.3 + k * 0.035) * N), wdt = f.girth * 0.18 * Math.sin((k / 8) * Math.PI) + 0.3; DL.push([pts[i].x - tg[i].y * wdt, pts[i].y + tg[i].x * wdt]); DR.push([pts[i].x + tg[i].y * wdt, pts[i].y - tg[i].x * wdt]); }
        // body on top
        strip(L, R, (i, sd) => [i / N, sd, 0, 0], f, cb, ca, cbb, cover);
        strip(DL, DR, (k, sd) => [0.5, sd * 0.6, 1, k / 8], f, fin, ca, cbb, cover);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog); gl.uniform2f(gl.getUniformLocation(prog, "pond"), pond.w, pond.h);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
  };
}
