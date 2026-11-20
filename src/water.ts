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
import type { Ripple } from "./sim";

const VERT = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }`;

// --- 1. wave equation step -------------------------------------------------------------------------
export const WAVE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel;
uniform vec4 drops[16]; uniform int dropN;   // x, y (uv), radius (uv), strength
void main(){
  vec4 s = texture(state, uv);
  float h = s.r, v = s.g;
  float n = texture(state, uv + vec2(texel.x, 0)).r + texture(state, uv - vec2(texel.x, 0)).r
          + texture(state, uv + vec2(0, texel.y)).r + texture(state, uv - vec2(0, texel.y)).r;
  // a slow wave: rings spread at walking pace and linger, the way they do on a real pond
  v += (n * .25 - h) * .42;
  v *= .9965;
  h += v;
  h *= .9992;
  h = clamp(h, -.6, .6);
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
export const COMPOSE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D waves, fish, top, fishgl, props;
uniform float useGL, fishPremul, fishLinear, useProps, flipT, bakeMode, useBake;
uniform sampler2D floorTex;
// three.js keeps canvas and render-target images with their top row at v = 1; the pond's y runs down
vec4 T(sampler2D s, vec2 v){ return texture(s, flipT > .5 ? vec2(v.x, 1. - v.y) : v); }
uniform vec2 res, pond, wtexel;
uniform float t, px, mode, bright, sand, causticAmt, clarity, waveAmt, film;
uniform vec3 absorbK;
uniform vec3 waterDeep, waterShallow, tint, c0, c1, c2, c3;

float h21(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p + n)); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float fbm2(vec2 p){ return vnoise(p) * .62 + vnoise(p * 2.03 + 17.1) * .38; }

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
    float d = length((f - c) * vec2(1., 1.25 + .45 * h21(i + g)));
    if (d < d1){ d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  float r = h21(id), r2 = h21(id + 7.);
  vec3 col = r < .35 ? vec3(.62,.66,.56) : r < .6 ? vec3(.55,.6,.54) : r < .85 ? vec3(.7,.68,.58) : vec3(.5,.5,.44);
  col = mix(col, vec3(dot(col, vec3(.33))), .5) * (.9 + .2 * r2);
  float gap = smoothstep(.0, .45, d2 - d1);
  float dome = sqrt(max(0., 1. - d1 * 1.2));
  col = mix(col * .86, col * (.9 + .12 * dome), gap);
  col = mix(vec3(.6, .63, .55), col, .55);              // pebbles stay quiet under the water
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
  return vec3(webCrisp(p)) * swell;
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
  // bake pass: write the lit floor (static) once, then exit
  if (bakeMode > .5){
    float bh; vec3 bf = floorColour(q, bh);
    float bh2; floorColour(q + vec2(.02, .0), bh2); float bh3; floorColour(q + vec2(.0, .02), bh3);
    vec3 bn = normalize(vec3((bh - bh2) * 3., (bh - bh3) * 3., 1.));
    vec3 BL = normalize(vec3(-.5, -.6, .8));
    float bd = .55 + .35 * fbm(q * .18 + 2.) + .2 * smoothstep(.2, .9, length((st - .5) * vec2(1.3, 1.)));
    o = vec4(srgb(lin(bf) * (.45 + .6 * max(0., dot(bn, BL))) * .9), bd);
    return;
  }
  // fine wind ripples: two cheap noise octaves, differenced for a slope
  vec2 wq = st * pond / unit * 9.;
  vec2 wa = wq + vec2(t * .25, t * .11), wb = wq * 1.7 - vec2(t * .18, -t * .21);
  float w1 = fbm2(wa), w2 = fbm2(wb);
  g += waveAmt * (vec2(fbm2(wa + vec2(.05, 0)) - w1, fbm2(wa + vec2(0, .05)) - w1) * 1.1 + vec2(fbm2(wb + vec2(.05, 0)) - w2, fbm2(wb + vec2(0, .05)) - w2) * .7) * 1.6;
  vec3 n = normalize(vec3(-g * 1.5, 1.));

  // depth of water over the floor: deeper in the middle and in a few hollows
  float depth = useBake > .5 ? texture(floorTex, vec2(st.x, 1. - st.y)).a : .55 + .35 * fbm(q * .18 + 2.) + .2 * smoothstep(.2, .9, length((st - .5) * vec2(1.3, 1.)));
  depth *= sand > .5 ? .55 : 1.;

  // refraction: the floor and the fish shift with the surface slope (floor more, it is further down)
  vec2 refrFloor = n.xy * .045 * depth, refrFish = n.xy * .02;
  vec3 fl;
  if (useBake > .5) {
    // the lit floor was baked once; refraction just shifts where we read it
    vec2 fs = clamp(st + refrFloor * unit / pond, vec2(.001), vec2(.999)); fl = lin(texture(floorTex, vec2(fs.x, 1. - fs.y)).rgb);
  } else {
    float fh; fl = floorColour(q + refrFloor * 6., fh);
    vec3 L = normalize(vec3(-.5, -.6, .8));
    float fh2; floorColour(q + refrFloor * 6. + vec2(.02, .0), fh2); float fh3; floorColour(q + refrFloor * 6. + vec2(.0, .02), fh3);
    vec3 fn = normalize(vec3((fh - fh2) * 3., (fh - fh3) * 3., 1.));
    fl = lin(fl) * (.45 + .6 * max(0., dot(fn, L))) * .9;
  }
  bool lagoon = sand > .5 && sand < 1.5;
  vec3 cau = lagoonCaustic(q * (lagoon ? 1.45 : .9), n.xy);
  fl *= sand > .5 && sand < 1.5 ? .62 + .25 * vnoise(q * .5 + t * .05) : 1.;          // cell interiors sit in shade
  if (!lagoon) fl += cau * lin(vec3(.6, .66, .64)) * .62 * causticAmt * (1. - depth * .5);

  // fish and their shadows, drawn in 2D, seen through the water
  vec4 f = T(fish, clamp(st + refrFish, vec2(.001), vec2(.999)));
  vec3 frgb = lin(f.rgb);
  float shadowA = 0.;
  if (useGL > .5){
    // floor shadows of the GPU-drawn koi: their own silhouettes, offset by the sun and softened
    vec2 so = vec2(.012, .02) * vec2(pond.y / pond.x, 1.);
    float sa = 0.;
    for (int k = 0; k < 8; k++){ float a = float(k) * .785; sa += T(fishgl, clamp(st + refrFloor * .4 - so + vec2(cos(a), sin(a)) * .006, vec2(.001), vec2(.999))).a; }
    sa /= 8.; shadowA = sa;
    // pad and petal shadows come from the 2D layer (dark, with alpha)
    vec3 floorLit = mix(fl, frgb, f.a) * (1. - sa * .6);
    vec4 g2 = T(fishgl, clamp(st + refrFish, vec2(.001), vec2(.999)));
    vec3 fishRaw = fishPremul > .5 ? g2.rgb / max(g2.a, .001) : g2.rgb;
    vec3 fishCol = fishLinear > .5 ? fishRaw : lin(fishRaw);
    fl = floorLit; f = vec4(fishCol, g2.a); frgb = fishCol;
  }
  // the fish layer's alpha is how close to the surface it is; shadows are dark with low alpha
  vec3 under = mix(fl, frgb * (1. + cau * .25), f.a);
  float fishNear = f.a;

  // absorption with depth (red goes first) and light scattered back from the water body
  vec3 absorb = absorbK;
  float isFish = useGL > .5 ? f.a : fishNear * step(.12, dot(f.rgb, vec3(.33)));   // shadows (dark) stay on the floor
  float path = mix(depth, .02, isFish);
  vec3 trans = exp(-absorb * path * 1.7 * clarity);
  vec3 scatter = lin(mix(waterShallow, waterDeep, clamp(depth * .9, 0., 1.)) * tint);
  vec3 col = under * trans + scatter * (1. - trans) * (1. - isFish * .85);
  // in clear shallow sea the light web is brighter than anything: add it after the water colour
  if (lagoon) col += cau * lin(vec3(.78, .96, .92)) * .5 * causticAmt * (1. - isFish * .7) * (1. - depth * .4);
  // sunlight comes through unevenly: broad brighter and darker patches drift slowly
  float dapple = fbm2(st * pond / unit * (film > .5 ? .35 : .9) + vec2(t * .015, -t * .01));
  col *= film > .5 ? .5 + .75 * smoothstep(.3, .72, dapple) : .78 + .5 * smoothstep(.25, .8, dapple);

  // surface: soft sky reflection by Fresnel, drifting cloud light, and sun glints on the ripples
  vec3 V = vec3(0, 0, 1);
  float fres = .02 + .98 * pow(1. - max(0., dot(n, V)), 5.);
  vec3 sky = lin(mix(vec3(.62, .74, .78), vec3(.88, .92, .9), fbm2(st * 2.5 + vec2(t * .01, 0))));
  col = mix(col, sky, clamp(fres * 1.3 + .015, 0., .3));
  vec3 S = normalize(vec3(.35, -.45, .82));
  float spec = pow(max(0., dot(reflect(-S, n), V)), 380.);
  col += vec3(1., .98, .92) * spec * 1.6;
  col += vec3(.9, .95, 1.) * pow(max(0., dot(reflect(-S, n), V)), 40.) * .05;
  // light caught on the slopes of every ripple and wake, so they read as bright rings
  float ripL = length(vec2(hr - hl, hu - hd)) * 70.;
  col += lin(vec3(.92, 1., .96)) * smoothstep(.12, .8, ripL) * .22;

  vec4 tp = T(top, st);
  if (useProps > .5){
    // lit 3D pads and rocks (a linear render target, premultiplied) sit under the 2D floaters
    vec4 pr = T(props, st);
    vec3 prc = srgb(pr.rgb / max(pr.a, .001));
    tp = vec4(mix(prc, tp.rgb, tp.a), tp.a + pr.a * (1. - tp.a));
  }

  // gentle vignette, exposure
  col *= 1. - .35 * pow(length((st - .5) * vec2(1.1, 1.)), 2.2);
  col *= bright;


  // ---------------------------------------------------------------- INK: a woodblock-print pond
  if (mode > 1.5){
    vec3 INK = vec3(.11, .12, .2), DEEP = vec3(.16, .22, .33), MID = vec3(.27, .38, .44), SAGE = vec3(.5, .6, .55), CREAM = vec3(.93, .89, .8);
    // bokashi: deep indigo in the middle of the pond, lighter toward the banks, in a few soft steps
    float bank = smoothstep(.1, .9, length((st - .5) * vec2(1.25, 1.)));
    float stepB = floor((bank + fbm(st * 3. + 2.) * .25) * 4.) / 4.;
    vec3 wc = mix(DEEP, mix(MID, SAGE, .55), stepB);
    // the floor shows as faint printed stones
    float fhI; floorColour(q, fhI);
    wc = mix(wc, wc * 1.08, step(.45, fhI));
    // light on the floor as cream print lines; ripples as printed rings
    float web2 = lagoonCaustic(q * .9, n.xy).g;
    wc = mix(wc, mix(wc, CREAM, .32), smoothstep(.62, .82, web2) * (1. - bank * .4));
    vec2 gw = vec2(hr - hl, hu - hd) * 70.;
    float ring = smoothstep(.35, .55, length(gw)) * (1. - smoothstep(.55, 1.1, length(gw)) * .5);
    wc = mix(wc, CREAM, ring * .75);
    // shadows of koi and pads: flat indigo
    vec4 sh = T(fish, clamp(st, vec2(.001), vec2(.999)));
    wc = mix(wc, INK, max(shadowA * .55, (1. - step(.12, dot(sh.rgb, vec3(.33)))) * sh.a * .45));
    // koi: their colours in three flat tone bands, with an ink outline
    vec2 px2 = 1.6 / res;
    vec4 fk = T(fishgl, clamp(st + refrFish, vec2(.001), vec2(.999)));
    vec3 fc = fishPremul > .5 ? fk.rgb / max(fk.a, .001) : fk.rgb;
    if (fishLinear > .5) fc = srgb(fc);
    float fl0 = dot(fc, vec3(.299, .587, .114));
    // snap to the print palette (cream, vermilion, orange, gold, ink), then shade in two flat bands
    vec3 P[5] = vec3[5](CREAM, vec3(.84, .25, .12), vec3(.92, .47, .16), vec3(.9, .66, .24), INK);
    float best = 9.; vec3 fq = CREAM;
    vec3 fn2 = fc / max(fl0, .05) * .6;
    for (int k = 0; k < 5; k++){ float d = distance(fn2, P[k] / max(dot(P[k], vec3(.299, .587, .114)), .05) * .6) + abs(fl0 - dot(P[k], vec3(.299, .587, .114))) * .8; if (d < best){ best = d; fq = P[k]; } }
    fq *= fl0 < dot(fq, vec3(.299, .587, .114)) * .72 ? .8 : 1.;
    float aN = 0., aX = 1.;
    for (int k = 0; k < 4; k++){ vec2 o = vec2(k == 0 ? 1. : k == 1 ? -1. : 0., k == 2 ? 1. : k == 3 ? -1. : 0.) * px2; float a2 = T(fishgl, clamp(st + refrFish + o, vec2(.001), vec2(.999))).a; aN = max(aN, a2); aX = min(aX, a2); }
    // fins are thinner than the body (part alpha): a pale membrane, then the solid body on top
    float finM = smoothstep(.12, .3, fk.a) * (1. - step(.75, fk.a));
    vec3 ic = mix(wc, mix(wc, CREAM, .62), finM);
    ic = mix(ic, fq, step(.75, fk.a));
    ic = mix(ic, INK, smoothstep(.3, .6, aN - aX));
    // floating things: pads and petals posterised, outlined
    float tN = 0., tX = 1.;
    for (int k = 0; k < 4; k++){ vec2 o = vec2(k == 0 ? 1. : k == 1 ? -1. : 0., k == 2 ? 1. : k == 3 ? -1. : 0.) * px2; float a2 = T(top, st + o).a; tN = max(tN, a2); tX = min(tX, a2); }
    vec3 tc = tp.rgb; float tl = dot(tc, vec3(.299, .587, .114));
    tc = tc * (tl < .3 ? .8 : tl < .6 ? 1. : 1.08);
    ic = mix(ic, tc, step(.5, tp.a));
    ic = mix(ic, INK, smoothstep(.3, .6, tN - tX));
    // paper: fine grain and fibres
    float grain = vnoise(gl_FragCoord.xy * .9) * .5 + vnoise(gl_FragCoord.xy * .15 + 7.) * .5;
    ic *= .92 + .09 * grain;
    ic = mix(ic, ic * vec3(1.02, 1., .95), .5);
    o = vec4(ic, 1);
    return;
  }
  if (mode < .5){
    col = mix(srgb(col), tp.rgb, tp.a);
    float l = pow(clamp(dot(col, vec3(.299, .587, .114)) * 1.05, 0., 1.), 1.1);
    // the water sits low (dark, quiet); the koi are lifted into the light tones so they read clearly,
    // whites to the brightest colour, red and orange patches one step down, sumi stays dark
    float fl0 = dot(srgb(frgb), vec3(.299, .587, .114));
    float koiL = fl0 > .62 ? .98 : fl0 > .3 ? .7 : .22;
    l = mix(l * .72, koiL, smoothstep(.5, .85, isFish) * (1. - tp.a));
    float k = clamp(l * 3. + bayer(gl_FragCoord.xy / px) - .5, 0., 3.);
    o = vec4(k < 1. ? mix(c0, c1, step(.5, k)) : k < 2. ? mix(c1, c2, step(1.5, k)) : mix(c2, c3, step(2.5, k)), 1);
  } else {
    // filmic tone curve (ACES fit) and a whisper of grain
    col *= 1.5;
    col = srgb(clamp((col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14), 0., 1.));
    if (film > .5) {
      // the reference's look: a little desaturated, warm, faded blacks, soft highlights
      float l = dot(col, vec3(.299, .587, .114));
      col = mix(vec3(l), col, mix(.8, 1.15, isFish));
      col = (col - .45) * 1.12 + .45;
      col = col * vec3(.9, .91, .84) + vec3(.045, .05, .03);
    }
    // things floating on top (lily pads, food) are not under water: drawn after the tone curve
    col = mix(col, tp.rgb * (1. - .35 * pow(length((st - .5) * vec2(1.1, 1.)), 2.2)), tp.a);
    col += (h21(gl_FragCoord.xy + fract(t) * 91.) - .5) * .018;
    o = vec4(col, 1);
  }
}`;

export const hex = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export interface WaterLook { mode: "dither" | "color" | "ink"; palette: [string, string, string, string]; deep: string; shallow: string; tint?: string; pixel: number; bright?: number; floor?: "sand" | "stones" | "pebbles"; caustics?: number; clarity?: number; waves?: number; film?: boolean; absorb?: [number, number, number] }

export const STRENGTH: Record<Ripple["kind"], [number, number]> = { tap: [0.03, 1.4], drop: [0.012, 0.7], nibble: [0.01, 0.5], wake: [0.012, 0.45] }; // radius (of short side), strength
