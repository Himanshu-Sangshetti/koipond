// koipond — realistic water (WebGL2).
//
// Pipeline per frame:
//   1. Surface: a height field on the GPU (two ping-pong float textures). Each texel holds height and
//      velocity; a damped wave equation spreads every disturbance (taps, drops, nibbles, wakes) so rings
//      travel, reflect and interfere like real water.
//   2. Pond floor: generated in the shader: rounded stones in sand with silt and algae, lit from above.
//   3. Composite: the surface normal (wave field + fine wind ripples) refracts the floor and the drawn
//      fish; light is absorbed with depth (red first, so the water turns green-blue) and scattered back;
//      caustics from the moving surface play on the floor; the surface reflects a soft sky (Fresnel) and
//      catches sun glints. Floating things (pads) are drawn last, above the water.
//   4. Optional finishing look: a 4-colour ordered dither, for stylised sites.
import type { Pond, Ripple } from "./sim";
import { createFishRenderer } from "./fishgl";

const VERT = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }`;

// --- 1. wave equation step -------------------------------------------------------------------------
const WAVE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel;
uniform vec4 drops[16]; uniform int dropN;   // x, y (uv), radius (uv), strength
void main(){
  vec4 s = texture(state, uv);
  float h = s.r, v = s.g;
  float n = texture(state, uv + vec2(texel.x, 0)).r + texture(state, uv - vec2(texel.x, 0)).r
          + texture(state, uv + vec2(0, texel.y)).r + texture(state, uv - vec2(0, texel.y)).r;
  v += (n * .25 - h) * 1.9;
  v *= .992;
  h += v;
  h *= .9985;
  for (int i = 0; i < 16; i++) {
    if (i >= dropN) break;
    vec2 d = (uv - drops[i].xy) / vec2(1., texel.x / texel.y);
    float r = length(d) / drops[i].z;
    if (r < 1.) h -= (cos(r * 3.14159) * .5 + .5) * drops[i].w;
  }
  // soft edges: the pond wall absorbs a little so rings don't ring forever
  vec2 e = min(uv, 1. - uv); float edge = smoothstep(0., .02, min(e.x, e.y));
  o = vec4(h * edge, v * edge, 0, 1);
}`;

// --- 2+3. pond floor, refraction, absorption, caustics, sky, sun -------------------------------------
const COMPOSE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D waves, fish, top, fishgl;
uniform float useGL, fishPremul;
uniform vec2 res, pond, wtexel;
uniform float t, px, mode, bright, sand, causticAmt, clarity, waveAmt;
uniform vec3 waterDeep, waterShallow, tint, c0, c1, c2, c3;

float h21(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p + n)); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }

// stones: voronoi cells, each a rounded pebble with its own tone; returns colour + height (for shading)
vec4 stones(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y), c = g + .15 + .7 * h22(i + g);
    float d = length((f - c) * vec2(1., 1.25));
    if (d < d1){ d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  float gap = smoothstep(.0, .22, d2 - d1);              // dark seams between stones
  float dome = sqrt(max(0., 1. - d1 * 1.6));             // rounded top
  float r = h21(id);
  vec3 col = mix(vec3(.42,.39,.33), vec3(.30,.31,.29), r);
  col = mix(col, vec3(.52,.46,.36), step(.78, r));       // a few warm stones
  col = mix(col, vec3(.22,.24,.22), step(.9, h21(id+3.)));  // a few dark ones
  return vec4(col * (.55 + .45 * gap), dome * gap);
}

// pale sea sand: soft wind ripples in the sand, fine grain, a few pebbles and drifts of weed
vec3 sandFloor(vec2 q, out float height){
  vec2 w = q + vec2(fbm(q * .4), fbm(q * .4 + 9.)) * 1.4;
  float ripple = sin(w.x * 2.2 + w.y * .9 + fbm(q * .8) * 3.) * .5 + .5;
  float grain = vnoise(q * 40.) * .5 + vnoise(q * 90.) * .5;
  vec3 c = mix(vec3(.80, .76, .64), vec3(.92, .89, .78), fbm(q * .7));
  c *= .9 + .12 * ripple;
  c *= .94 + .1 * grain;
  // a few dark rocks: soft rounded blobs from low-frequency noise
  float rock = smoothstep(.74, .8, fbm(q * .45 + vec2(21., 7.)));
  c = mix(c, vec3(.36, .37, .33) * (.8 + .4 * vnoise(q * 6.)), rock * .85);
  float pebbles = rock;
  float weed = smoothstep(.72, .86, fbm(q * .5 + vec2(13., 4.)));
  c = mix(c, vec3(.32, .36, .22), weed * .55);
  height = ripple * .35 + pebbles * .6;
  return c;
}

// a bed of rounded river pebbles: each its own tone (sage, slate, sand, umber), soft dark gaps
vec3 pebbleFloor(vec2 q, out float height){
  vec2 p = q * (2.6 + .9 * step(.5, vnoise(q * .3))), i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y), c = g + .2 + .6 * h22(i + g);
    float d = length((f - c) * vec2(1., 1.15 + .3 * h21(i + g)));
    if (d < d1){ d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  float r = h21(id), r2 = h21(id + 7.);
  vec3 col = r < .3 ? vec3(.55,.6,.52) : r < .55 ? vec3(.46,.5,.5) : r < .8 ? vec3(.66,.62,.52) : vec3(.48,.4,.32);
  col = mix(col, vec3(dot(col, vec3(.33))), .5) * (.9 + .2 * r2);
  float gap = smoothstep(.02, .35, d2 - d1);
  float dome = sqrt(max(0., 1. - d1 * 1.3));
  col = mix(col * .7, col * (.85 + .2 * dome), gap);
  col *= .9 + .12 * vnoise(q * 30.);                   // speckle
  height = dome * gap;
  return col;
}

vec3 floorColour(vec2 q, out float height){
  if (sand > 1.5) return pebbleFloor(q, height);
  if (sand > .5) return sandFloor(q, height);
  vec4 s = stones(q * 1.0);
  vec4 s2 = stones(q * 2.3 + 11.);                       // smaller gravel between
  float sand = fbm(q * 3.) ;
  vec3 sandC = mix(vec3(.36,.33,.26), vec3(.46,.42,.33), sand);
  float big = smoothstep(.35, .7, fbm(q * .35 + 5.));    // where big stones lie
  vec3 c = mix(mix(sandC, s2.rgb, .55), s.rgb, big * smoothstep(.0, .25, s.a));
  height = mix(s2.a * .4, s.a, big);
  // silt and algae: dark green patches that soften the floor
  float algae = smoothstep(.55, .8, fbm(q * .6 + vec2(3., 9.)));
  c = mix(c, vec3(.14,.19,.15), algae * .6);
  return c;
}

// caustic light on the floor: a soft web of light where the waving surface focuses the sun.
// Cell edges of a slowly morphing network give the web; sampling it three times with slightly
// different offsets blurs the lines and splits colour a touch, like real dispersion.
float web(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y), o2 = h22(i + g); o2 = .5 + .38 * sin(t * .45 + 6.2831 * o2);
    float d = length(g + o2 - f); if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float e = d2 - d1;
  return exp(-e * e * 90.) * .8 + exp(-e * 9.) * .25;
}
// lagoon caustics: curving filaments of bright light, like sun through clear shallow sea.
// The cell network is warped by smooth noise so edges bend, lines are thin with a soft glow, and
// their brightness swells and fades along their length as the surface moves.
float webCrisp(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y), o2 = h22(i + g); o2 = .5 + .4 * sin(t * .55 + 6.2831 * o2);
    float d = length(g + o2 - f); if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float e = d2 - d1;
  return exp(-e * e * 420.) * .75 + exp(-e * 10.) * .16;
}
vec3 lagoonCaustic(vec2 p, vec2 bend){
  p += bend * .12;
  p += (vec2(fbm(p * .3 + t * .04), fbm(p * .3 - t * .035 + 6.)) - .5) * 1.8;
  float swell = .55 + .7 * vnoise(p * .9 + vec2(t * .2, -t * .16));
  vec3 c = vec3(webCrisp(p + vec2(.008, 0)), webCrisp(p), webCrisp(p - vec2(.008, 0))) * swell;
  return c;
}
vec3 caustic(vec2 p, vec2 bend){
  p += bend * 3.;
  p += vec2(vnoise(p * .35 + t * .03), vnoise(p * .35 - t * .03 + 5.)) * .6;
  vec3 c = vec3(web(p + vec2(.012, 0)), web(p), web(p - vec2(.012, 0)));
  vec2 p2 = p * 1.6 + 4.2;
  c += .45 * vec3(web(p2 + vec2(.015, 0)), web(p2), web(p2 - vec2(.015, 0)));
  return c * c * .9;
}

vec3 lin(vec3 c){ return pow(max(c, 0.), vec3(2.2)); }
vec3 srgb(vec3 c){ return pow(max(c, 0.), vec3(1. / 2.2)); }

float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer(vec2 a){ return bayer2(a * .125) * .015625 + bayer2(a * .25) * .0625 + bayer2(a * .5) * .25 + bayer2(a); }

void main(){
  vec2 cell = mode < .5 ? floor(gl_FragCoord.xy / px) * px + px * .5 : gl_FragCoord.xy;
  vec2 st = vec2(cell.x / res.x, 1. - cell.y / res.y);  // y down
  float unit = min(pond.x, pond.y);
  vec2 q = st * pond / unit * 6.;                         // floor coordinates

  // surface normal: GPU wave field + fine wind ripples
  float hl = texture(waves, st - vec2(wtexel.x, 0)).r, hr = texture(waves, st + vec2(wtexel.x, 0)).r;
  float hd = texture(waves, st - vec2(0, wtexel.y)).r, hu = texture(waves, st + vec2(0, wtexel.y)).r;
  vec2 g = vec2(hr - hl, hu - hd) * 70.;
  vec2 wq = st * pond / unit * 9.;
  float w1 = fbm(wq + vec2(t * .25, t * .11)), w2 = fbm(wq * 1.7 - vec2(t * .18, -t * .21));
  g *= 1.;
  g += waveAmt * (vec2(fbm(wq + .05 + vec2(t*.25,t*.11)) - w1, fbm(wq + vec2(.0,.05) + vec2(t*.25,t*.11)) - w1) * 1.1
      + vec2(fbm(wq*1.7 + .05 - vec2(t*.18,-t*.21)) - w2, fbm(wq*1.7 + vec2(.0,.05) - vec2(t*.18,-t*.21)) - w2) * .7);
  vec3 n = normalize(vec3(-g * 1.5, 1.));

  // depth of water over the floor: deeper in the middle and in a few hollows
  float depth = .55 + .35 * fbm(q * .18 + 2.) + .2 * smoothstep(.2, .9, length((st - .5) * vec2(1.3, 1.)));
  depth *= sand > .5 ? .55 : 1.;

  // refraction: the floor and the fish shift with the surface slope (floor more, it is further down)
  vec2 refrFloor = n.xy * .045 * depth, refrFish = n.xy * .02;
  float fh; vec3 fl = floorColour(q + refrFloor * 6., fh);
  // light the floor stones from the upper left, then caustics
  vec3 L = normalize(vec3(-.5, -.6, .8));
  float fh2; floorColour(q + refrFloor * 6. + vec2(.02, .0), fh2); float fh3; floorColour(q + refrFloor * 6. + vec2(.0, .02), fh3);
  vec3 fn = normalize(vec3((fh - fh2) * 3., (fh - fh3) * 3., 1.));
  fl = lin(fl) * (.45 + .6 * max(0., dot(fn, L))) * .9;
  bool lagoon = sand > .5 && sand < 1.5;
  vec3 cau = lagoonCaustic(q * (lagoon ? 1.45 : .9), n.xy);
  fl *= sand > .5 && sand < 1.5 ? .62 + .25 * vnoise(q * .5 + t * .05) : 1.;          // cell interiors sit in shade
  if (!lagoon) fl += cau * lin(vec3(.6, .66, .64)) * .62 * causticAmt * (1. - depth * .5);

  // fish and their shadows, drawn in 2D, seen through the water
  vec4 f = texture(fish, clamp(st + refrFish, vec2(.001), vec2(.999)));
  vec3 frgb = lin(f.rgb);
  if (useGL > .5){
    // floor shadows of the GPU-drawn koi: their own silhouettes, offset by the sun and softened
    vec2 so = vec2(.012, .02) * vec2(pond.y / pond.x, 1.);
    float sa = 0.;
    for (int k = 0; k < 8; k++){ float a = float(k) * .785; sa += texture(fishgl, clamp(st + refrFloor * .4 - so + vec2(cos(a), sin(a)) * .006, vec2(.001), vec2(.999))).a; }
    sa /= 8.;
    // pad and petal shadows come from the 2D layer (dark, with alpha)
    vec3 floorLit = mix(fl, frgb, f.a) * (1. - sa * .6);
    vec4 g2 = texture(fishgl, clamp(st + refrFish, vec2(.001), vec2(.999)));
    vec3 fishCol = lin(fishPremul > .5 ? g2.rgb / max(g2.a, .001) : g2.rgb);
    fl = floorLit; f = vec4(fishCol, g2.a); frgb = fishCol;
  }
  // the fish layer's alpha is how close to the surface it is; shadows are dark with low alpha
  vec3 under = mix(fl, frgb * (1. + cau * .25), f.a);
  float fishNear = f.a;

  // absorption with depth (red goes first) and light scattered back from the water body
  vec3 absorb = vec3(2.4, .92, .78);
  float isFish = useGL > .5 ? f.a : fishNear * step(.12, dot(f.rgb, vec3(.33)));   // shadows (dark) stay on the floor
  float path = mix(depth, .02, isFish);
  vec3 trans = exp(-absorb * path * 1.7 * clarity);
  vec3 scatter = lin(mix(waterShallow, waterDeep, clamp(depth * .9, 0., 1.)) * tint);
  vec3 col = under * trans + scatter * (1. - trans) * (1. - isFish * .85);
  // in clear shallow sea the light web is brighter than anything: add it after the water colour
  if (lagoon) col += cau * lin(vec3(.78, .96, .92)) * .5 * causticAmt * (1. - isFish * .7) * (1. - depth * .4);
  // sunlight comes through unevenly: broad brighter and darker patches drift slowly
  float dapple = fbm(st * pond / unit * .9 + vec2(t * .015, -t * .01));
  col *= .78 + .5 * smoothstep(.25, .8, dapple);

  // surface: soft sky reflection by Fresnel, drifting cloud light, and sun glints on the ripples
  vec3 V = vec3(0, 0, 1);
  float fres = .02 + .98 * pow(1. - max(0., dot(n, V)), 5.);
  vec3 sky = lin(mix(vec3(.62, .74, .78), vec3(.88, .92, .9), fbm(st * 2.5 + vec2(t * .01, 0))));
  col = mix(col, sky, clamp(fres * 1.3 + .015, 0., .3));
  vec3 S = normalize(vec3(.35, -.45, .82));
  float spec = pow(max(0., dot(reflect(-S, n), V)), 380.);
  col += vec3(1., .98, .92) * spec * 1.6;
  col += vec3(.9, .95, 1.) * pow(max(0., dot(reflect(-S, n), V)), 40.) * .05;

  vec4 tp = texture(top, st);

  // gentle vignette, exposure
  col *= 1. - .35 * pow(length((st - .5) * vec2(1.1, 1.)), 2.2);
  col *= bright;

  if (mode < .5){
    col = mix(srgb(col), tp.rgb, tp.a);
    float l = pow(clamp(dot(col, vec3(.299, .587, .114)) * 1.05, 0., 1.), 1.1);
    float k = clamp(l * 3. + bayer(gl_FragCoord.xy / px) - .5, 0., 3.);
    o = vec4(k < 1. ? mix(c0, c1, step(.5, k)) : k < 2. ? mix(c1, c2, step(1.5, k)) : mix(c2, c3, step(2.5, k)), 1);
  } else {
    // filmic tone curve (ACES fit) and a whisper of grain
    col *= 1.5;
    col = srgb(clamp((col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14), 0., 1.));
    // things floating on top (lily pads, food) are not under water: drawn after the tone curve
    col = mix(col, tp.rgb * (1. - .35 * pow(length((st - .5) * vec2(1.1, 1.)), 2.2)), tp.a);
    col += (h21(gl_FragCoord.xy + fract(t) * 91.) - .5) * .018;
    o = vec4(col, 1);
  }
}`;

const hex = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export interface WaterLook { mode: "dither" | "color"; palette: [string, string, string, string]; deep: string; shallow: string; tint?: string; pixel: number; bright?: number; floor?: "sand" | "stones" | "pebbles"; caustics?: number; clarity?: number; waves?: number }

const STRENGTH: Record<Ripple["kind"], [number, number]> = { tap: [0.03, 1], drop: [0.014, 0.55], nibble: [0.01, 0.4], wake: [0.018, 0.42] }; // radius (of short side), strength

export function createRealWater(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const halfFloat = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
  if (!halfFloat) return null;
  const compile = (vs: string, fs: string) => {
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
    const p = gl.createProgram()!; gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    return p;
  };
  const wave = compile(VERT, WAVE), compose = compile(VERT, COMPOSE);
  const fishR = createFishRenderer(gl);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindAttribLocation(wave, 0, "p"); gl.bindAttribLocation(compose, 0, "p"); gl.linkProgram(wave); gl.linkProgram(compose);

  const tex = (w: number, h: number, float: boolean) => {
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let WW = 0, WH = 0, states: WebGLTexture[] = [], fbos: WebGLFramebuffer[] = [], cur = 0;
  const sizeWaves = (aspect: number) => {
    const w = 384, h = Math.max(32, Math.round(384 / aspect));
    if (w === WW && h === WH) return;
    WW = w; WH = h;
    states = [tex(w, h, true), tex(w, h, true)];
    fbos = states.map((s) => { const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s, 0); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return f; });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const fishTex = tex(1, 1, false), topTex = tex(1, 1, false), fish3dTex = tex(1, 1, false);
  const injected = new WeakSet<Ripple>();
  const drops = new Float32Array(64);
  const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

  return {
    render(fish: HTMLCanvasElement, top: HTMLCanvasElement, pondW: number, pondH: number, ripples: Ripple[], t: number, look: WaterLook, dpr: number, steps = 2, pond?: Pond, fish3d?: HTMLCanvasElement) {
      if (pond && !fish3d) fishR.render(pond, canvas.width, canvas.height);
      sizeWaves(pondW / pondH);
      // new disturbances become drops in the height field
      let n = 0;
      const short = Math.min(pondW, pondH);
      for (const r of ripples) {
        if (injected.has(r) || r.age < 0 || n >= 16) continue; // (up to 16 new disturbances per frame)
        injected.add(r);
        const [rad, str] = STRENGTH[r.kind];
        drops.set([r.x / pondW, r.y / pondH, (rad * short) / pondW, str * r.power * 0.05], n * 4); n++;
      }
      // wave steps (more steps = faster travelling rings)
      gl.bindVertexArray(vao);
      gl.useProgram(wave); gl.viewport(0, 0, WW, WH);
      gl.uniform2f(U(wave, "texel"), 1 / WW, 1 / WH);
      for (let i = 0; i < steps; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[1 - cur]);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[cur]); gl.uniform1i(U(wave, "state"), 0);
        gl.uniform4fv(U(wave, "drops"), drops); gl.uniform1i(U(wave, "dropN"), i === 0 ? n : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        cur = 1 - cur;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // composite
      gl.bindVertexArray(vao);
      gl.useProgram(compose); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[cur]); gl.uniform1i(U(compose, "waves"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fishTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fish); gl.uniform1i(U(compose, "fish"), 1);
      gl.activeTexture(gl.TEXTURE3);
      if (fish3d) { gl.bindTexture(gl.TEXTURE_2D, fish3dTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fish3d); }
      else gl.bindTexture(gl.TEXTURE_2D, fishR.texture);
      gl.uniform1i(U(compose, "fishgl"), 3); gl.uniform1f(U(compose, "useGL"), pond || fish3d ? 1 : 0); gl.uniform1f(U(compose, "fishPremul"), fish3d ? 0 : 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, topTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, top); gl.uniform1i(U(compose, "top"), 2);
      gl.uniform2f(U(compose, "res"), canvas.width, canvas.height); gl.uniform2f(U(compose, "pond"), pondW, pondH); gl.uniform2f(U(compose, "wtexel"), 1 / WW, 1 / WH);
      gl.uniform1f(U(compose, "t"), t); gl.uniform1f(U(compose, "px"), Math.max(1, look.pixel * dpr)); gl.uniform1f(U(compose, "mode"), look.mode === "dither" ? 0 : 1);
      gl.uniform1f(U(compose, "bright"), look.bright ?? 1);
      gl.uniform1f(U(compose, "sand"), look.floor === "pebbles" ? 2 : look.floor === "sand" ? 1 : 0); gl.uniform1f(U(compose, "causticAmt"), look.caustics ?? 1);
      gl.uniform1f(U(compose, "clarity"), look.clarity ?? 1); gl.uniform1f(U(compose, "waveAmt"), look.waves ?? 1);
      gl.uniform3fv(U(compose, "waterDeep"), hex(look.deep)); gl.uniform3fv(U(compose, "waterShallow"), hex(look.shallow)); gl.uniform3fv(U(compose, "tint"), hex(look.tint ?? "#ffffff"));
      look.palette.forEach((c, i) => gl.uniform3fv(U(compose, `c${i}`), hex(c)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
