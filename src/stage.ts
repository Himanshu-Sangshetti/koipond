// koipond — the whole pond on ONE three.js renderer, so nothing is copied between GPU contexts.
//   1. ripple simulation: two half-float render targets, ping-ponged
//   2. koi: three.js meshes rendered into a render target
//   3. lily pads and rocks: three.js meshes rendered into a render target
//   4. the 2D layers (floor shadows; petals, flowers, sparks) are uploaded as canvas textures
//   5. one full-screen pass composites water, floor, koi, light and floaters onto the screen
import * as THREE from "three";
import { COMPOSE, STRENGTH, WAVE, hex, type WaterLook } from "./water";
import type { Pond, Ripple } from "./sim";

const VERT = `in vec3 position; out vec2 uv; void main(){ uv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;
const strip = (src: string) => src.replace(/^#version 300 es\s*/, "");

export function createStage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  // 1. ripples
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping } as const;
  let WW = 0, WH = 0, cur = 0;
  let states = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
  const drops = Array.from({ length: 16 }, () => new THREE.Vector4());
  const waveMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: strip(WAVE), depthTest: false, depthWrite: false,
    uniforms: { state: { value: null }, texel: { value: new THREE.Vector2() }, drops: { value: drops }, dropN: { value: 0 } },
  });
  const waveScene = new THREE.Scene(); waveScene.add(new THREE.Mesh(quadGeo, waveMat));
  const sizeWaves = (aspect: number) => {
    const w = 384, h = Math.max(32, Math.round(384 / aspect));
    if (w === WW && h === WH) return;
    WW = w; WH = h;
    states.forEach((s) => s.dispose());
    states = [new THREE.WebGLRenderTarget(w, h, rtOpts), new THREE.WebGLRenderTarget(w, h, rtOpts)];
    for (const s of states) { renderer.setRenderTarget(s); renderer.setClearColor(0x000000, 1); renderer.clear(); }
    renderer.setRenderTarget(null);
  };

  // 4. 2D layers as textures (uploaded each frame; no read-back)
  const mkCanvasTex = () => { const t = new THREE.Texture(); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; return t; };
  let underTex = mkCanvasTex(), topTex = mkCanvasTex(), underKey = "", topKey = "";

  // 5. composite
  const composeMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: strip(COMPOSE), depthTest: false, depthWrite: false,
    uniforms: {
      waves: { value: null }, fish: { value: underTex }, top: { value: topTex }, fishgl: { value: null }, props: { value: null },
      bakeMode: { value: 0 }, useBake: { value: 0 }, floorTex: { value: null },
      useGL: { value: 1 }, fishPremul: { value: 1 }, fishLinear: { value: 1 }, useProps: { value: 0 }, flipT: { value: 1 },
      res: { value: new THREE.Vector2() }, pond: { value: new THREE.Vector2() }, wtexel: { value: new THREE.Vector2() },
      t: { value: 0 }, px: { value: 1 }, mode: { value: 1 }, bright: { value: 1 }, sand: { value: 0 }, causticAmt: { value: 1 }, clarity: { value: 1 }, waveAmt: { value: 1 }, film: { value: 0 },
      absorbK: { value: new THREE.Vector3(2.4, 0.92, 0.78) }, waterDeep: { value: new THREE.Vector3() }, waterShallow: { value: new THREE.Vector3() }, tint: { value: new THREE.Vector3(1, 1, 1) },
      c0: { value: new THREE.Vector3() }, c1: { value: new THREE.Vector3() }, c2: { value: new THREE.Vector3() }, c3: { value: new THREE.Vector3() },
    },
  });
  const composeScene = new THREE.Scene(); composeScene.add(new THREE.Mesh(quadGeo, composeMat));
  const injected = new WeakSet<Ripple>();
  // style changes: the new look spreads out from a point as a widening ripple; both looks render meanwhile
  const blendMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, depthTest: false, depthWrite: false,
    uniforms: { fromTex: { value: null }, toTex: { value: null }, origin: { value: new THREE.Vector2(0.5, 0.5) }, radius: { value: 0 }, aspect: { value: 1 } },
    fragmentShader: `precision highp float; in vec2 uv; out vec4 o;
      uniform sampler2D fromTex, toTex; uniform vec2 origin; uniform float radius, aspect;
      void main(){
        vec2 d = (uv - origin) * vec2(aspect, 1.); float r = length(d);
        float edge = r - radius;
        // a soft, wobbling wavefront: the old look bends a little just ahead of it
        vec2 bend = normalize(d + 1e-5) * exp(-edge * edge * 900.) * .012;
        vec4 a = texture(fromTex, uv + bend / vec2(aspect, 1.)), b = texture(toTex, uv);
        float k = smoothstep(.012, -.012, edge);
        vec4 c = mix(a, b, k);
        c.rgb += exp(-edge * edge * 2500.) * .18;   // light caught on the wavefront
        o = vec4(c.rgb, 1.);
      }`,
  });
  const blendScene = new THREE.Scene(); blendScene.add(new THREE.Mesh(quadGeo, blendMat));
  let rtFrom: THREE.WebGLRenderTarget | null = null, rtTo: THREE.WebGLRenderTarget | null = null;
  let shown: WaterLook | null = null, shownKey = "", trans: { from: WaterLook; t0: number; origin: [number, number] } | null = null;
  const lookKey = (l: WaterLook) => JSON.stringify([l.mode, l.deep, l.shallow, l.floor, l.palette, l.film, l.pixel]);
  // the floor is static: bake it (lit) into a texture whenever the look or pond size changes
  let floorRT: THREE.WebGLRenderTarget | null = null, floorKey = "";
  const v3 = (u: THREE.Vector3, h: string) => { const [r, g, b] = hex(h); u.set(r, g, b); };

  return {
    renderer,
    setSize(w: number, h: number) { renderer.setSize(w, h, false); },
    render(o: { under: HTMLCanvasElement; top: HTMLCanvasElement; pond: Pond; look: WaterLook; dpr: number; fish: THREE.Texture | null; props: THREE.Texture | null; origin?: [number, number] }) {
      const { pond } = o; let look = o.look;
      const nk = lookKey(o.look);
      if (shown && nk !== shownKey && !trans) trans = { from: shown, t0: pond.t, origin: o.origin ?? [0.5, 0.5] };
      if (nk !== shownKey) { shown = o.look; shownKey = nk; }
      sizeWaves(pond.w / pond.h);
      // new disturbances become drops in the height field
      let n = 0; const short = Math.min(pond.w, pond.h);
      for (const r of pond.ripples) {
        if (injected.has(r) || r.age < 0 || n >= 16) continue;
        injected.add(r);
        const [rad, str] = STRENGTH[r.kind];
        drops[n++].set(r.x / pond.w, r.y / pond.h, (rad * short) / pond.w, str * r.power * 0.05);
      }
      waveMat.uniforms.texel.value.set(1 / WW, 1 / WH);
      for (let i = 0; i < 2; i++) {
        waveMat.uniforms.state.value = states[cur].texture; waveMat.uniforms.dropN.value = i === 0 ? n : 0;
        renderer.setRenderTarget(states[1 - cur]); renderer.render(waveScene, quadCam); cur = 1 - cur;
      }
      renderer.setRenderTarget(null);
      // layers
      // three.js fixes a texture's size when it is first uploaded: after a resize, start fresh textures
      const uk = `${o.under.width}x${o.under.height}`, tk = `${o.top.width}x${o.top.height}`;
      if (uk !== underKey) { underTex.dispose(); underTex = mkCanvasTex(); composeMat.uniforms.fish.value = underTex; underKey = uk; }
      if (tk !== topKey) { topTex.dispose(); topTex = mkCanvasTex(); composeMat.uniforms.top.value = topTex; topKey = tk; }
      underTex.image = o.under; underTex.needsUpdate = true;
      topTex.image = o.top; topTex.needsUpdate = true;
      const U = composeMat.uniforms, size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const setLook = (lk: WaterLook) => { look = lk;
      U.waves.value = states[cur].texture; U.fishgl.value = o.fish; U.useGL.value = o.fish ? 1 : 0;
      U.props.value = o.props; U.useProps.value = o.props ? 1 : 0;
      U.res.value.copy(size); U.pond.value.set(pond.w, pond.h); U.wtexel.value.set(1 / WW, 1 / WH);
      U.t.value = pond.t; U.px.value = Math.max(1, look.pixel * o.dpr);
      U.mode.value = look.mode === "dither" ? 0 : look.mode === "ink" ? 2 : 1; U.bright.value = look.bright ?? 1;
      U.sand.value = look.floor === "pebbles" ? 2 : look.floor === "sand" ? 1 : 0; U.causticAmt.value = look.caustics ?? 1;
      U.clarity.value = look.clarity ?? 1; U.film.value = look.film ? 1 : 0; U.waveAmt.value = look.waves ?? 1;
      const ab = look.absorb ?? [2.4, 0.92, 0.78]; U.absorbK.value.set(ab[0], ab[1], ab[2]);
      v3(U.waterDeep.value, look.deep); v3(U.waterShallow.value, look.shallow); v3(U.tint.value, look.tint ?? "#ffffff");
      look.palette.forEach((c, i) => v3(U[`c${i}`].value, c)); };
      setLook(o.look);
      const fk = `${look.floor}|${pond.w.toFixed(0)}x${pond.h.toFixed(0)}`;
      if (fk !== floorKey) {
        floorKey = fk;
        const bw = Math.min(2048, Math.round(size.x)), bh = Math.round(bw * size.y / size.x);
        floorRT?.dispose(); floorRT = new THREE.WebGLRenderTarget(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
        U.bakeMode.value = 1; U.res.value.set(bw, bh); U.mode.value = 1; renderer.setRenderTarget(floorRT); renderer.render(composeScene, quadCam); renderer.setRenderTarget(null);
        U.bakeMode.value = 0; U.res.value.copy(size); U.mode.value = look.mode === "dither" ? 0 : look.mode === "ink" ? 2 : 1;
      }
      U.floorTex.value = floorRT!.texture; U.useBake.value = 1;
      if (!trans) { renderer.render(composeScene, quadCam); return; }
      // transition: draw both looks, then reveal the new one from the origin outward
      const k = (pond.t - trans.t0) / 1.25;
      if (k >= 1) { trans = null; renderer.render(composeScene, quadCam); return; }
      const mk = (rt: THREE.WebGLRenderTarget | null) => { if (!rt || rt.width !== size.x || rt.height !== size.y) { rt?.dispose(); return new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false }); } return rt; };
      rtFrom = mk(rtFrom); rtTo = mk(rtTo);
      renderer.setRenderTarget(rtTo); renderer.render(composeScene, quadCam);
      setLook(trans.from); renderer.setRenderTarget(rtFrom); renderer.render(composeScene, quadCam);
      renderer.setRenderTarget(null);
      const B = blendMat.uniforms, asp = size.x / size.y;
      B.fromTex.value = rtFrom.texture; B.toTex.value = rtTo.texture; B.aspect.value = asp;
      B.origin.value.set(trans.origin[0], 1 - trans.origin[1]);
      const far = Math.hypot(Math.max(trans.origin[0], 1 - trans.origin[0]) * asp, Math.max(trans.origin[1], 1 - trans.origin[1]));
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      B.radius.value = e * (far + 0.05);
      renderer.render(blendScene, quadCam);
    },
    dispose() { states.forEach((s) => s.dispose()); renderer.dispose(); },
  };
}
