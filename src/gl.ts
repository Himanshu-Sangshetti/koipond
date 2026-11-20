// koipond — the water pass on the GPU. Takes the drawn scene as a texture and adds:
// the water (depth, drifting light, caustics), ripples that bend everything under them and catch the
// light, and finally the look: an ordered dither to a 4-colour palette, or natural colour with grain.
import type { Ripple } from "./sim";

const MAX_RIPPLES = 24;

const VERT = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;

const FRAG = `precision highp float;
varying vec2 uv;
uniform sampler2D scene;
uniform vec2 res, pond;
uniform float t, px, mode;
uniform vec3 deep, shallow, c0, c1, c2, c3;
uniform vec4 rip[${MAX_RIPPLES}];
uniform vec2 ripKind[${MAX_RIPPLES}];
uniform int ripN;

float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
// light through a moving surface: two warped sine lattices, sharpened where they cross
float caustic(vec2 q){
  vec2 w=q+vec2(noise(q*.7+t*.05),noise(q*.7-t*.04))*1.6;
  float a=abs(sin(w.x*2.1+t*.35)+sin(w.y*1.7-t*.28)+sin((w.x+w.y)*1.3+t*.2));
  return pow(clamp(1.-a*.42,0.,1.),6.);
}
// 8x8 ordered dither threshold
float bayer2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float bayer(vec2 a){return bayer2(a*.125)*.015625+bayer2(a*.25)*.0625+bayer2(a*.5)*.25+bayer2(a);}

void main(){
  vec2 cell=floor(gl_FragCoord.xy/px)*px+px*.5;
  vec2 st=vec2(cell.x/res.x,1.-cell.y/res.y);           // 0..1, y down
  vec2 pp=st*pond;                                       // pond pixels
  float unit=min(pond.x,pond.y);
  vec2 bend=vec2(0.);float glint=0.;
  for(int i=0;i<${MAX_RIPPLES};i++){
    if(i>=ripN)break;
    vec4 r=rip[i];if(r.z<0.)continue;
    float speed=ripKind[i].x*unit,life=ripKind[i].y;
    vec2 d=pp-r.xy;float dist=length(d);
    float front=r.z*speed,lambda=unit*.035;
    float x=(dist-front)/lambda;
    // a short wave packet travelling outward, fading with age and distance
    float env=exp(-x*x*.35)*r.w*(1.-r.z/life)*(1.-r.z/life);
    float wave=sin(x*2.4)*env;
    bend+=d/max(dist,1.)*wave*unit*.012;
    glint+=max(0.,-cos(x*2.4))*env;
  }
  vec2 sp=(pp+bend)/pond;
  vec4 s=texture2D(scene,clamp(sp,vec2(.001),vec2(.999)));
  // water: deeper toward the edges, slow light drifting across, caustics on the floor
  vec2 q=pp/unit*3.;
  float depth=smoothstep(.0,.75,length((st-.5)*vec2(1.2,1.)));
  vec3 water=mix(shallow,deep,depth*.8+noise(q*.35+t*.02)*.2);
  water+=caustic(q)*.08*(1.-depth*.6);
  vec3 col=mix(water,s.rgb,s.a);
  col+=glint*.22;
  if(mode<.5){
    float l=dot(col,vec3(.299,.587,.114));
    l=pow(clamp(l*1.25,0.,1.),.85);
    float th=bayer(gl_FragCoord.xy/px)-.5;
    float k=clamp(l*3.+th,0.,3.);
    vec3 o=k<1.?mix(c0,c1,step(.5,k)):k<2.?mix(c1,c2,step(1.5,k)):mix(c2,c3,step(2.5,k));
    gl_FragColor=vec4(o,1.);
  }else{
    float g=(hash(cell+fract(t))-.5)*.035;
    gl_FragColor=vec4(col+g,1.);
  }
}`;

const hex = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const KIND: Record<Ripple["kind"], [number, number]> = { tap: [0.42, 2.6], drop: [0.3, 1.6], nibble: [0.22, 1.0], wake: [0.25, 1.0] };

export interface Look { mode: "dither" | "color"; palette: [string, string, string, string]; deep: string; shallow: string; tint?: string; pixel: number; bright?: number; floor?: "sand" | "stones" | "pebbles"; caustics?: number; clarity?: number; waves?: number }

export function createWater(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const rip = new Float32Array(MAX_RIPPLES * 4), kinds = new Float32Array(MAX_RIPPLES * 2);

  return {
    render(scene: HTMLCanvasElement, pondW: number, pondH: number, ripples: Ripple[], t: number, look: Look, dpr: number) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      const n = Math.min(MAX_RIPPLES, ripples.length);
      for (let i = 0; i < n; i++) {
        const r = ripples[ripples.length - n + i];
        rip.set([r.x, r.y, r.age, r.power], i * 4); kinds.set(KIND[r.kind], i * 2);
      }
      gl.uniform4fv(U("rip"), rip); gl.uniform2fv(U("ripKind"), kinds); gl.uniform1i(U("ripN"), n);
      gl.uniform2f(U("res"), canvas.width, canvas.height); gl.uniform2f(U("pond"), pondW, pondH);
      gl.uniform1f(U("t"), t); gl.uniform1f(U("px"), Math.max(1, look.pixel * dpr)); gl.uniform1f(U("mode"), look.mode === "dither" ? 0 : 1);
      gl.uniform3fv(U("deep"), hex(look.deep)); gl.uniform3fv(U("shallow"), hex(look.shallow));
      look.palette.forEach((c, i) => gl.uniform3fv(U(`c${i}`), hex(c)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
