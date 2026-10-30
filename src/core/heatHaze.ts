// Heat haze: a refraction shimmer in the air right above hot surfaces (World V's lava).
//
// A world registers a HeatHazeSource; while its root is shown in the scene the engine renders, at the high tier, the
// engine adds a HeatHazeEffect to its EffectPass (engine.ts). Views without a shown source build exactly the chain they
// built before.
//
// Two parts:
// - A displacement map at a quarter of the frame size (long side at most 480 texels), drawn in the effect's update():
//   per texel, the view ray from the camera to the depth buffer's surface (or 160 m into the sky) is cut into 13
//   segments; each reads the source's layers (a heat and the hot surface's height at a point) and integrates an
//   exponential layer of hot air above that surface (scale height 2.2 m, so it is gone by about 6 m) exactly over the
//   segment, so a thin layer seen at a grazing angle is not missed between samples. Hot air nearer than 6-14 m to the
//   camera and beyond 110-160 m counts for nothing; strength m = 1 - exp(-k * metres of hot air). The map holds m times
//   two octaves of value noise that rise at ~1.6 cells/s and wobble, anchored to the camera's yaw and pitch, so turning
//   the camera does not drag a fixed pattern across the screen. Texels nearer the camera than the source's `focus`
//   (the player) plus 2.5 m hold zero, so the player stays sharp.
// - In the EffectPass, before bloom and tone mapping: where the map holds a displacement, the frame is read again at
//   the displaced UV (one bilinear map read per pixel otherwise).
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

export interface HeatHazeSource {
  /** The haze shows while this object and every ancestor up to the rendered scene are visible. */
  readonly root: THREE.Object3D;
  /**
   * GLSL defining `vec4 hazeLayers(vec2 xz)`: two layers of hot air at a world point, (heat A, surface height A,
   * heat B, surface height B). Heat 1 is the air right above molten lava; 0 none.
   */
  readonly glsl: string;
  /** The uniforms `glsl` reads (shared objects; the source keeps them current). */
  readonly uniforms: Record<string, THREE.IUniform>;
  /** World height above which no ray finds hot air (the highest hot surface plus a few scale heights). */
  readonly top: number;
  /** A world point kept clear of the haze (the player), or null. */
  readonly focus: THREE.Vector3 | null;
  /** Once a frame before the haze map renders (lazy bakes, live textures). */
  prepare?(): void;
}

/** Weak references: a world that is thrown away (a new game) needs no unregistering. */
const sources = new Set<WeakRef<HeatHazeSource>>();

export function registerHeatHaze(source: HeatHazeSource): void {
  sources.add(new WeakRef(source));
}

function shown(o: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (!n.visible) return false;
    if (n === scene) return true;
  }
  return false;
}

/** The registered source shown in `scene`, if any. Cheap enough to call every frame. */
export function shownHeatHaze(scene: THREE.Object3D): HeatHazeSource | null {
  for (const ref of sources) {
    const s = ref.deref();
    if (!s) { sources.delete(ref); continue; }
    if (shown(s.root, scene)) return s;
  }
  return null;
}

/** The displacement map: a quarter of the frame in each direction, its long side at most 480 texels (a 2x frame
 * gains nothing from more: the noise cells span 5 to 8 texels either way). */
const MAP_SCALE = 0.25;
const MAP_MAX = 480;

const mapVert = /* glsl */ `
varying vec2 vUv;
void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}
`;

const mapFrag = (layers: string) => /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 projInv;
uniform mat4 camWorld;
uniform float hazeK;
uniform float hazeTop;
uniform float hazeAspect;
uniform vec3 hazeMotion; // time (s, wrapped), anchor u, anchor v
uniform float hazeProtect;
varying vec2 vUv;
${layers}
const float H=2.2;
// Hot air density exp(-(y-base)/H) integrated over a segment whose height runs linearly from ya to yb.
float hzLayer(float ya,float yb,float base,float L){
  float a=max(ya-base,0.),b=max(yb-base,0.),ea=exp(-a/H),eb=exp(-b/H),d=b-a;
  return abs(d)>1e-3?L*H*(ea-eb)/d:L*ea;
}
float hzSeg(vec3 o,vec3 dir,float ta,float tb,float ts){
  float w=smoothstep(6.,14.,ts)*(1.-smoothstep(110.,160.,ts));
  if(w<=0.)return 0.;
  vec4 l=hazeLayers((o+dir*ts).xz);
  float ya=o.y+dir.y*ta,yb=o.y+dir.y*tb,L=tb-ta;
  return w*(l.x*hzLayer(ya,yb,l.y,L)+l.z*hzLayer(ya,yb,l.w,L));
}
float hzHash(vec2 p){p=fract(p*vec2(.1031,.1030));p+=dot(p,p.yx+33.33);return fract((p.x+p.y)*p.x);}
float hzNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hzHash(i),hzHash(i+vec2(1.,0.)),f.x),mix(hzHash(i+vec2(0.,1.)),hzHash(i+1.),f.x),f.y);
}
void main(){
  float d=texture2D(tDepth,vUv).r;
  vec4 v=projInv*vec4(vUv*2.-1.,d*2.-1.,1.);v.xyz/=v.w;
  float dist=d>=.99999?1e4:length(v.xyz);
  vec3 dir=normalize(mat3(camWorld)*v.xyz),o=camWorld[3].xyz;
  float t0=6.,t1=min(dist,160.),acc=0.;
  // The player and anything nearer the camera stay sharp; rays that stay above every hot surface see no haze.
  if(t1>t0&&-v.z>hazeProtect&&min(o.y+dir.y*t0,o.y+dir.y*t1)<hazeTop){
    // The last 4 m before the surface get a segment of their own, its heat read right at the surface.
    float te=max(t0,t1-4.);
    for(int i=0;i<12;i++){float ta=mix(t0,te,float(i)/12.),tb=mix(t0,te,float(i+1)/12.);acc+=hzSeg(o,dir,ta,tb,.5*(ta+tb));}
    acc+=hzSeg(o,dir,te,t1,t1-.3);
  }
  float m=(1.-exp(-acc*hazeK))*smoothstep(hazeProtect,hazeProtect+4.,-v.z);
  if(m<.003){gl_FragColor=vec4(0.);return;}
  // Cells about 3 % of the frame height, taller than wide (rising streaks); the pattern rises and wobbles.
  float t=hazeMotion.x;
  vec2 q=(vUv+hazeMotion.yz)*vec2(hazeAspect*44.,30.);
  vec2 a=q+vec2(.35*sin(t*1.3+q.y*.21),-1.6*t);
  vec2 b=q*vec2(1.6,1.7)+vec2(3.7,-2.4*t);
  vec2 n=vec2(hzNoise(a)+.5*hzNoise(b),hzNoise(a+vec2(17.3,5.1))+.5*hzNoise(b+vec2(-9.2,11.7)));
  gl_FragColor=vec4((n/1.5-.5)*2.*m,m,1.);
}
`;

// The first effect in the pass (its DEPTH attribute sorts it first), so inputColor is the frame as rendered. Only where
// the map holds a displacement is the frame read again, displaced; elsewhere the map read is the whole cost. (A mainUv
// displaces every later read in the pass too, so they all wait on the map read; it measured about 0.6 ms more than
// this at 2880 x 1800, on a busy shared GPU.)
const hazeFrag = /* glsl */ `
uniform sampler2D hazeMap;
uniform vec2 hazeAmp;
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
  vec2 o=texture2D(hazeMap,uv).xy;
  // Under 2 % of the peak (a twentieth of a pixel at most) is not worth the second read.
  outputColor=dot(o,o)>4e-4?texture2D(inputBuffer,uv+o*hazeAmp):inputColor;
}
`;

/** The heat haze in the main EffectPass; see the top of this file. */
export class HeatHazeEffect extends Effect {
  /** Peak displacement, in frame heights. */
  amplitude = 0.0026;
  private readonly map: THREE.WebGLRenderTarget;
  private readonly mapMat: THREE.ShaderMaterial;
  private readonly mapScene = new THREE.Scene();
  private readonly mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fwd = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private time = 0;
  private yaw = 0;
  private lastYaw = NaN;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly source: HeatHazeSource) {
    // Half floats: no displacement is exactly zero (an 8-bit signed encoding would shift every pixel a little).
    const map = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    map.texture.name = 'HeatHaze.Map';
    super('HeatHazeEffect', hazeFrag, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['hazeMap', new THREE.Uniform(map.texture)],
        ['hazeAmp', new THREE.Uniform(new THREE.Vector2())],
      ]),
    });
    this.map = map;
    this.mapMat = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: mapFrag(source.glsl),
      uniforms: {
        ...source.uniforms,
        tDepth: { value: null },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        hazeK: { value: 0.16 },
        hazeTop: { value: source.top },
        hazeAspect: { value: 1 },
        hazeMotion: { value: new THREE.Vector3() },
        hazeProtect: { value: 6 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(tri, this.mapMat);
    mesh.frustumCulled = false;
    this.mapScene.add(mesh);
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.mapMat.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    const s = Math.min(MAP_SCALE, MAP_MAX / Math.max(width, height, 1));
    this.map.setSize(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  }

  override update(renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, deltaTime?: number): void {
    const cam = this.camera, s = this.source, mu = this.mapMat.uniforms;
    s.prepare?.();
    // Wrapped hourly (the pattern jumps once an hour) so the noise coordinates keep their float precision.
    this.time = (this.time + (deltaTime ?? 0)) % 3600;
    // Anchor: the camera's turn and tilt in frame widths and heights, the yaw unwrapped so it never jumps.
    cam.getWorldDirection(this.fwd);
    const yaw = Math.atan2(this.fwd.x, -this.fwd.z), pitch = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
    if (Number.isFinite(this.lastYaw)) { let d = yaw - this.lastYaw; d -= Math.PI * 2 * Math.round(d / (Math.PI * 2)); this.yaw = (this.yaw + d) % (Math.PI * 64); }
    this.lastYaw = yaw;
    const vfov = THREE.MathUtils.degToRad(cam.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    mu.hazeMotion.value.set(this.time, this.yaw / hfov, pitch / vfov);
    mu.hazeAspect.value = cam.aspect;
    cam.getWorldPosition(this.camPos);
    mu.hazeProtect.value = s.focus ? Math.max(6, this.camPos.distanceTo(s.focus) + 2.5) : 6;
    mu.projInv.value.copy(cam.projectionMatrixInverse);
    mu.camWorld.value.copy(cam.matrixWorld);
    (this.uniforms.get('hazeAmp')!.value as THREE.Vector2).set(this.amplitude / cam.aspect, this.amplitude * 0.75);
    renderer.setRenderTarget(this.map);
    renderer.render(this.mapScene, this.mapCam);
  }

  override dispose(): void {
    super.dispose();
    this.map.dispose();
    this.mapMat.dispose();
    (this.mapScene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
