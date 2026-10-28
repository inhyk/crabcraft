import * as THREE from 'three';

/*
 * Lava that spreads and stops: a GPU heightfield relaxed by the yield-film rule of isaac_sim's HeapField::relaxFlow
 * (its viscous manure heaps), on the plateau at the foot of the volcano. The tongues on the cone feed it at their noses
 * in episodes; fronts advance, slow, stop as a dome with a step at the edge, crust over and cool; the next episode
 * breaks out beside or over the old lobe.
 *
 * State per 0.25 m cell (float32 ping-pong, two targets written in one pass):
 *   state R hot (mobile) thickness, G cold thickness (rock: lies on the ground like terrain and never moves),
 *         B temperature 0..1 (the hot layer's; on a cold cell it keeps cooling for the shading), A the cell's ground
 *         height and yield multiplier packed (static, carried through; -1 where lava may not go), so a pass reads
 *         one texture per neighbour
 *   flow  RG velocity (m/s, smoothed), B activity (smoothed flux), A the thickness the lava had when it last held
 *         hot lava (it froze at that), which subsidence does not touch: the crust's rope folds follow it, so they hold
 *         still on rock that is slowly subsiding; half float
 *
 * One pass, every pair of the 8 neighbours (diagonals sqrt 2 away, weight 1/sqrt 2):
 *   rest = min(4 d, 2 d D / (h_i + h_j))       the yield rule: a pair stands while h_mean * drop / D <= d
 *   gap  = |s_i - s_j| - rest                  s the surface (ground + cold + hot), h the hot thickness
 *   F    = K w min(gap, h_giver)               when gap > eps, from the higher cell to the lower
 * Both cells of a pair evaluate F from the same inputs in the same order, so what one loses the other gains (mass is
 * conserved up to float rounding; float32 targets, since half floats lose the small per-pass transfers), and
 * K sum(w) = 0.68 < 1 keeps every cell's outflow under its hot thickness. A free deposit rests as the dome
 * sqrt(2 d (R - r)) with an edge step of at most 4 d, and a level layer of any thickness stays where it is. Where isaac
 * holds a cell (no give, no take), a cold cell here still takes lava on top (its rock is ground), so new lava runs over
 * old lobes; blocked cells (outside the reach, the sanctuary, tree trunks) neither give nor take. Lava stiffens as it
 * cools (d up to 1.5x near freezing), so a cooling front slows into its dome rather than halting mid-stride.
 *
 * Speed: the rule fixes the shape, K and the pass rate fix how fast it gets there (isaac #1282): 30 steps/s of one pass,
 * decoupled from the frame rate, at most 4 steps a frame. That keeps a lobe close to its yield dome while it is fed, so
 * its front follows R ~ V^0.4: quick at first, slowing as it grows, still within a few seconds of the feed stopping.
 * More passes changed nothing visible (3 and 4 tried) and cost the GPU. The grid is 0.25 m, under 2 d = 0.28 m, so a
 * film keeps a gradient to carry its shear and lobes stop instead of thinning into a pancake (isaac
 * kResolvedFilmCells = 2).
 *
 * Episodes: each live tongue feeds for 34-46 s every 170-200 s. A source over old lava turns into a breakout at the
 * old field's margin (chosen from a CPU copy of the field read back without stalling every 3 s), and stops feeding cells
 * already 0.9-1.7 m thick, so lava spreads into lobes beside and over the old ones instead of stacking a tower.
 *
 * Bounded forever: lava only lives inside the reach discs (blocked outside, stiffer within 3 m of any border, so fronts
 * stop short of it), and cold lava subsides into the ground at 0.4 mm/s plus its thickness over 40 minutes (2-5 cm a
 * minute, nothing a frame can show), so the field settles where subsidence takes away what the episodes bring (an
 * hour's run levels off after ~25 min at 130-145 m3 over 250-272 m2 of the 1102 m2 reach, crests at most 1.6 m).
 * Nothing is ever removed at once.
 */

/** Cell size, m; must stay under 2 d. */
export const FLOW_CELL = .25;
/** Steps per second and relax passes per step. */
export const FLOW_STEP_HZ = 30;
const PASSES = 1;
const MAX_STEPS_PER_FRAME = 4;
const MAX_SOURCES = 6;
/** Radius of a source's feeding disc, m. */
const SOURCE_R = 1.5;
/** Feed temperature; cooling: dT/dt = -T (K0 + K1 / h); cold rock keeps darkening at KC; freezing below TF. */
const T_SRC = .92, K0 = .003, K1 = .003, KC = .0025, TF = .3;
/** Pair flux factor: 8 neighbours, sum of weights 6.83, so a pass moves at most K * 6.83 = 0.68 of a cell's hot layer,
 * and a single pair closes at most 2 K = 0.2 of its gap (no overshoot). */
const FLUX_K = .1;
/** Gaps under this do not move (isaac kFlowResolutionM): a dome reaches rest exactly instead of creeping forever. */
const FLUX_EPS = .0005;
/** Subsidence of cold lava: SUBSIDE m/s plus its thickness over SUBSIDE_T s, so tall old piles go faster. */
const SUBSIDE = .0004, SUBSIDE_T = 2400;
/** A source stops feeding cells already this thick (m, smoothly between the two), so each episode breaks out where the
 * old lava is thinnest instead of stacking a tower on the nose. */
const CAP0 = .9, CAP1 = 1.7;

export interface FlowSource {
  /** Nose of the feeding tongue on the ground, and its downhill direction (unit, xz). */
  x: number; z: number; dirX: number; dirZ: number;
  /** Volume rate while feeding, m3/s; episode length and period, s; phase, s (sim time 0 is `phase` into a period). */
  rate: number; feed: number; period: number; phase: number;
  seed: number;
}
/** An old cold lobe in the start state; `temp` is its rock temperature (0.3 just frozen, its deepest cracks still
 * glowing; under 0.1 cooled through), 0.3 if left out. */
export interface FlowDeposit { x: number; z: number; dirX: number; dirZ: number; volume: number; seed: number; temp?: number }
export interface FlowArea { x: number; z: number; radius: number }
export interface LavaFlowOptions {
  /** Ground under the lava (terrain and cone exactly as drawn). */
  ground: (x: number, z: number) => number;
  /** Discs the lava may reach. */
  areas: FlowArea[];
  /** Distance to anything lava must stay off (sanctuary, trees, island edge), m; <= 0 is blocked. */
  clearance: (x: number, z: number) => number;
  sources: FlowSource[];
  deposits: FlowDeposit[];
  /** Shear depth d, m. */
  d: number;
}
export interface FlowStats {
  time: number; steps: number;
  hot: number; cold: number; total: number;
  maxH: number; covered: number; area: number;
  /** Per source: farthest covered cell (h > 5 cm) from the source within 60 degrees of its direction, m. */
  fronts: number[];
}

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const QUAD_VERT = /* glsl */ `
in vec3 position;
void main(){gl_Position=vec4(position.xy,0.,1.);}
`;

const SIM_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uState;
uniform sampler2D uFlow;
uniform vec4 uSrc[${MAX_SOURCES}]; // x, z, radius, thickness rate at full weight (m/s)
uniform vec2 uOrigin;
uniform float uDt, uCell, uK0, uK1, uKc, uTf, uSub, uSubT, uTsrc, uCap0, uCap1;
layout(location=0) out highp vec4 oState;
layout(location=1) out highp vec4 oFlow;
const ivec2 OFF[8]=ivec2[8](ivec2(1,0),ivec2(-1,0),ivec2(0,1),ivec2(0,-1),ivec2(1,1),ivec2(-1,-1),ivec2(1,-1),ivec2(-1,1));
const float WT[8]=float[8](1.,1.,1.,1.,.70710678,.70710678,.70710678,.70710678);
const float DS[8]=float[8](1.,1.,1.,1.,1.41421356,1.41421356,1.41421356,1.41421356);
float stiff(float t){return mix(1.5,1.,smoothstep(.35,.85,t));}
uniform float uK, uD, uEps;
// state.a = yield step * 128 + ground (ground under 128 m, the multiplier 1 + step / 8).
float groundOf(float a){return a-floor(a/128.)*128.;}
float dmulOf(float a){return 1.+floor(a/128.)/8.;}
// The flux from cell A to cell B (negative: B to A), A the one first in row order, so both cells of a pair run the same
// instructions on the same operands in the same roles and get the same number (GPU compilers reassociate freely).
// x the flux, y the giver's temperature.
vec2 pairFlux(vec4 a,vec4 b,float D,float W){
  float Ha=groundOf(a.a)+a.g+a.r,Hb=groundOf(b.a)+b.g+b.r;
  bool give=Ha>Hb;
  float hg=give?a.r:b.r,hr=give?b.r:a.r,tg=give?a.b:b.b;
  if(hg<=0.)return vec2(0.);
  float d=uD*((dmulOf(a.a)+dmulOf(b.a))*.5)*stiff(tg);
  float rest=min(4.*d,2.*d*D/(hg+hr));
  float gap=abs(Ha-Hb)-rest;
  if(gap<=uEps)return vec2(0.);
  float F=uK*W*min(gap,hg);
  return vec2(give?F:-F,tg);
}
void main(){
  ivec2 c=ivec2(gl_FragCoord.xy);
  ivec2 sz=textureSize(uState,0);
  vec4 s0=texelFetch(uState,c,0);
  if(s0.a<0.){oState=s0;oFlow=vec4(0.);return;}
  vec4 f0=texelFetch(uFlow,c,0);
  float dh=0.,dE=0.,flux=0.;
  vec2 mom=vec2(0.);
  for(int n=0;n<8;n++){
    ivec2 cn=c+OFF[n];
    if(cn.x<0||cn.y<0||cn.x>=sz.x||cn.y>=sz.y)continue;
    vec4 sn=texelFetch(uState,cn,0);
    if(sn.a<0.)continue;
    bool first=OFF[n].y>0||(OFF[n].y==0&&OFF[n].x>0);
    vec2 r=pairFlux(first?s0:sn,first?sn:s0,DS[n]*uCell,WT[n]);
    // Out of this cell: positive when this cell is A and gives, or is B and A takes from it.
    float go=first?r.x:-r.x;
    vec2 dir=vec2(OFF[n])/DS[n];
    dh-=go;dE-=go*r.y;mom+=go*dir;flux+=abs(go);
  }
  // Feeding: full weight inside 0.4 of a source's radius, smoothly none at its edge (the CPU normalises the volume).
  vec2 p=uOrigin+(vec2(c)+.5)*uCell;
  float feed=0.;
  for(int i=0;i<${MAX_SOURCES};i++){
    vec4 s=uSrc[i];
    if(s.w<=0.)continue;
    feed+=s.w*(1.-smoothstep(.4*s.z,s.z,length(p-s.xy)));
  }
  feed*=uDt*(1.-smoothstep(uCap0,uCap1,s0.r+s0.g));
  float hh=max(s0.r+dh+feed,0.);
  float E=s0.r*s0.b+dE+feed*uTsrc;
  float T=hh>1e-7?clamp(E/hh,0.,1.):s0.b;
  float hc=s0.g;
  // Cooling, faster when thin; below the freezing point the hot layer becomes rock where it lies.
  if(hh>0.)T*=exp(-uDt*(uK0+uK1/max(hh,.05)));else T*=exp(-uDt*uKc);
  if(hh>0.&&T<uTf){hc+=hh;hh=0.;}
  hc=max(hc-(uSub+hc/uSubT)*uDt,0.);
  // Velocity: flux per unit width over the thickness, in and out averaged, smoothed over ~0.4 s; exactly 0 at rest.
  vec2 vi=mom*uCell/(max(hh,.05)*uDt)*.5;
  vec2 v=mix(f0.xy,vi,.04);
  float act=mix(f0.z,min(flux/(max(hh,.02)*uDt)*.25,1.),.04);
  if(dot(v,v)<1e-8)v=vec2(0.);
  if(act<2e-4)act=0.;
  oState=vec4(hh,hc,T,s0.a);
  oFlow=vec4(v,act,hh>0.?hh+hc:f0.w);
}
`;

/** Loads the start state (old lobes) into the ping-pong targets. */
const INIT_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uInit;
layout(location=0) out highp vec4 oState;
layout(location=1) out highp vec4 oFlow;
void main(){vec4 s=texelFetch(uInit,ivec2(gl_FragCoord.xy),0);oState=s;oFlow=vec4(0.,0.,0.,s.a<0.?0.:s.r+s.g);}
`;

/** What the meshes read (half float, linear): R0 total thickness, 5x5-blurred thickness (normals, halo, clinker),
 * temperature, 3x3-blurred thickness (the rounded front of the drawn surface); R1 velocity, activity, 5x5-blurred
 * thickness at freezing (the rope folds). Empty cells take their thickest neighbour's
 * temperature, velocity and activity, so filtering across the edge does not fade the front. */
const PREP_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uState;
uniform sampler2D uFlow;
layout(location=0) out highp vec4 o0;
layout(location=1) out highp vec4 o1;
void main(){
  ivec2 c=ivec2(gl_FragCoord.xy);
  ivec2 sz=textureSize(uState,0);
  vec4 s=texelFetch(uState,c,0);
  vec4 f=texelFetch(uFlow,c,0);
  float h=s.r+s.g;
  float blur=0.,wsum=0.,b3=0.,best=h,fz=0.;
  vec4 bs=s,bf=f;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){
    ivec2 q=clamp(c+ivec2(i,j),ivec2(0),sz-1);
    vec4 sq=texelFetch(uState,q,0);
    float hq=sq.r+sq.g;
    float w=float((i==0?6:abs(i)==1?4:1)*(j==0?6:abs(j)==1?4:1));
    blur+=hq*w;wsum+=w;fz+=texelFetch(uFlow,q,0).a*w;
    if(abs(i)<=1&&abs(j)<=1)b3+=hq*float((i==0?2:1)*(j==0?2:1));
    if(abs(i)<=1&&abs(j)<=1&&h<1e-4&&hq>best){best=hq;bs=sq;bf=texelFetch(uFlow,q,0);}
  }
  o0=vec4(h,blur/wsum,bs.b,b3/16.);
  o1=vec4(bf.xy,bf.z,fz/wsum);
}
`;

interface Pass { scene: THREE.Scene; mat: THREE.RawShaderMaterial }

export class LavaFlow {
  readonly nx: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  readonly d: number;
  /** Ground height, allowed (1/0) and the yield multiplier of every cell (CPU copy of the base texture). */
  readonly base: Float32Array;
  readonly sources: FlowSource[];
  /** Read by the lava, halo and clinker shaders. */
  readonly uniforms = {
    uFR0: { value: null as THREE.Texture | null },
    uFR1: { value: null as THREE.Texture | null },
    uFBase: { value: null as THREE.Texture | null },
    uFGrid: { value: new THREE.Vector4() }, // origin x, origin z, size x (m), size z (m)
    uFTexel: { value: new THREE.Vector2() },
  };
  /** Sim time, s, and steps taken. */
  time = 0;
  steps = 0;
  /** Debug knobs: sources and subsidence can be switched off (mass-conservation test). */
  feeding = true;
  subsiding = true;
  /** QA: holds the real-time stepping (time-lapse capture steps it with advance()). */
  paused = false;
  /** QA: replaces the episode schedule, (source index, sim time) -> m3/s. */
  override: ((source: number, t: number) => number) | null = null;
  supported = true;
  private readonly baseTex: THREE.DataTexture;
  private readonly initTex: THREE.DataTexture;
  private readonly empty: THREE.DataTexture;
  private targets: THREE.WebGLRenderTarget[] = [];
  private render: THREE.WebGLRenderTarget | null = null;
  private read = 0;
  private readonly sim: Pass;
  private readonly init: Pass;
  private readonly prep: Pass;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly srcVec: THREE.Vector4[] = [];
  /** Per source and episode: the source centre (jittered sideways each episode) and the volume normalisation. */
  private readonly srcNorm = new Map<string, { x: number; z: number; norm: number }>();
  private bank = 0;
  private last = -1;
  private snap: Float32Array | null = null;
  private snapPending = false;
  private snapAt = -1e9;
  private ready = false;

  constructor(readonly opts: LavaFlowOptions) {
    this.d = opts.d;
    this.sources = opts.sources.slice(0, MAX_SOURCES);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const a of opts.areas) { minX = Math.min(minX, a.x - a.radius); maxX = Math.max(maxX, a.x + a.radius); minZ = Math.min(minZ, a.z - a.radius); maxZ = Math.max(maxZ, a.z + a.radius); }
    const C = FLOW_CELL;
    this.x0 = Math.floor(minX / C) * C - C; this.z0 = Math.floor(minZ / C) * C - C;
    this.nx = Math.ceil((maxX - this.x0) / C) + 2; this.nz = Math.ceil((maxZ - this.z0) / C) + 2;
    const { nx, nz } = this;
    const base = this.base = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = this.x0 + (i + .5) * C, z = this.z0 + (j + .5) * C, k = (j * nx + i) * 4;
      // Distance inside the reach (positive inside any disc) and to whatever lava must keep off.
      let inside = -1e9;
      for (const a of opts.areas) inside = Math.max(inside, a.radius - Math.hypot(x - a.x, z - a.z));
      const room = Math.min(inside, opts.clearance(x, z));
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      base[k] = opts.ground(x, z);
      base[k + 1] = room > 0 && !edge ? 1 : 0;
      // Stiffer towards any border: within 3 m the yield depth rises to 5x, so a front stops short of it.
      base[k + 2] = 1 + 4 * (1 - smooth(0, 3, room));
    }
    this.baseTex = new THREE.DataTexture(base, nx, nz, THREE.RGBAFormat, THREE.FloatType);
    this.baseTex.minFilter = this.baseTex.magFilter = THREE.NearestFilter;
    this.baseTex.needsUpdate = true;
    this.initTex = new THREE.DataTexture(this.startState(opts.deposits), nx, nz, THREE.RGBAFormat, THREE.FloatType);
    this.initTex.minFilter = this.initTex.magFilter = THREE.NearestFilter;
    this.initTex.needsUpdate = true;
    // Until the first frame renders the targets, the meshes read an empty field.
    this.empty = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.empty.needsUpdate = true;
    this.uniforms.uFR0.value = this.uniforms.uFR1.value = this.empty;
    this.uniforms.uFBase.value = this.baseTex;
    this.uniforms.uFGrid.value.set(this.x0, this.z0, nx * C, nz * C);
    this.uniforms.uFTexel.value.set(1 / nx, 1 / nz);
    for (let i = 0; i < MAX_SOURCES; i++) this.srcVec.push(new THREE.Vector4());
    // The sim and prep passes only draw the cells the lava can reach (44 % of the grid), as runs along each row; the
    // others stay zero in both targets.
    this.sim = this.pass(SIM_FRAG, {
      uState: { value: null }, uFlow: { value: null }, uSrc: { value: this.srcVec },
      uOrigin: { value: new THREE.Vector2(this.x0, this.z0) }, uK: { value: FLUX_K }, uD: { value: opts.d }, uEps: { value: FLUX_EPS },
      uDt: { value: 1 / (FLOW_STEP_HZ * PASSES) }, uCell: { value: C }, uK0: { value: K0 }, uK1: { value: K1 }, uKc: { value: KC },
      uTf: { value: TF }, uSub: { value: SUBSIDE }, uSubT: { value: SUBSIDE_T }, uTsrc: { value: T_SRC }, uCap0: { value: CAP0 }, uCap1: { value: CAP1 },
    }, this.runs(0));
    this.init = this.pass(INIT_FRAG, { uInit: { value: this.initTex } });
    this.prep = this.pass(PREP_FRAG, { uState: { value: null }, uFlow: { value: null } }, this.runs(3));
  }

  /** Cell index of a world point, or -1 outside the grid. */
  cellAt(x: number, z: number) {
    const i = Math.floor((x - this.x0) / FLOW_CELL), j = Math.floor((z - this.z0) / FLOW_CELL);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  allowed(i: number, j: number) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.base[(j * this.nx + i) * 4 + 1] > .5; }

  /** Old cold lobes to start from: Bingham domes sized from their volume with a wandering outline, clipped to the reach. */
  private startState(deposits: FlowDeposit[]) {
    const { nx, nz, d } = this, C = FLOW_CELL, st = new Float32Array(nx * nz * 4);
    for (let k = 0; k < nx * nz; k++) {
      const b = this.base;
      st[k * 4 + 3] = b[k * 4 + 1] > .5 ? Math.round((b[k * 4 + 2] - 1) * 8) * 128 + Math.min(Math.max(b[k * 4], 0), 127.99) : -1;
    }
    for (const dep of deposits) {
      const R = Math.pow(15 * dep.volume / (8 * Math.PI * Math.sqrt(2 * d)), .4);
      // Elongated downhill, the outline wandering by up to 18 %.
      const ax = dep.dirX, az = dep.dirZ;
      const ph = [hash(dep.seed * 3.1) * 6.28, hash(dep.seed * 5.7) * 6.28, hash(dep.seed * 7.3) * 6.28];
      const i0 = Math.max(0, Math.floor((dep.x - this.x0 - R * 1.6) / C)), i1 = Math.min(nx - 1, Math.ceil((dep.x - this.x0 + R * 1.6) / C));
      const j0 = Math.max(0, Math.floor((dep.z - this.z0 - R * 1.6) / C)), j1 = Math.min(nz - 1, Math.ceil((dep.z - this.z0 + R * 1.6) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!this.allowed(i, j)) continue;
        const x = this.x0 + (i + .5) * C - dep.x, z = this.z0 + (j + .5) * C - dep.z;
        const u = (x * ax + z * az) / 1.25, v = -x * az + z * ax, r = Math.hypot(u, v), th = Math.atan2(v, u);
        const Rt = R * (1 + .1 * Math.sin(3 * th + ph[0]) + .05 * Math.sin(5 * th + ph[1]) + .03 * Math.sin(9 * th + ph[2]));
        const dist = Rt - r;
        if (dist <= 0) continue;
        // Dome with its edge step, the step softened over 0.3 m so the start state is not a cut-out disc.
        const h = Math.sqrt(2 * d * (dist + 2 * d)) * smooth(0, .3, dist);
        const k = (j * nx + i) * 4;
        st[k + 1] = Math.max(st[k + 1], h);
        // A recent lobe is still warm inside: its deepest cracks glow a dull red for the first minutes.
        st[k + 2] = Math.max(st[k + 2], dep.temp ?? .3);
      }
    }
    return st;
  }

  /** Quads in clip space over the runs of reachable cells along each row, dilated by `grow` cells. */
  private runs(grow: number) {
    const { nx, nz } = this, pos: number[] = [], idx: number[] = [];
    const near = (i: number, j: number) => { for (let b = -grow; b <= grow; b++) for (let a = -grow; a <= grow; a++) if (this.allowed(i + a, j + b)) return true; return false; };
    for (let j = 0; j < nz; j++) {
      let i = 0;
      while (i < nx) {
        if (!near(i, j)) { i++; continue; }
        const i0 = i;
        while (i < nx && near(i, j)) i++;
        const x0 = i0 / nx * 2 - 1, x1 = i / nx * 2 - 1, y0 = j / nz * 2 - 1, y1 = (j + 1) / nz * 2 - 1, v = pos.length / 3;
        pos.push(x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0);
        idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  private pass(frag: string, uniforms: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry = new THREE.PlaneGeometry(2, 2)): Pass {
    const mat = new THREE.RawShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(geometry, mat);
    quad.frustumCulled = false;
    scene.add(quad);
    return { scene, mat };
  }

  /** Creates the targets and loads the start state; false (and `supported` off) without float render targets. */
  private setup(renderer: THREE.WebGLRenderer): boolean {
    if (this.targets.length) return true;
    if (!this.supported) return false;
    if (!renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) { this.supported = false; return false; }
    const mk = (type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter) => {
      const t = new THREE.WebGLRenderTarget(this.nx, this.nz, { count: 2, type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
      return t;
    };
    this.targets = [mk(THREE.FloatType, THREE.NearestFilter), mk(THREE.FloatType, THREE.NearestFilter)];
    for (const t of this.targets) t.textures[1].type = THREE.HalfFloatType;
    this.render = mk(THREE.HalfFloatType, THREE.LinearFilter);
    this.reset(renderer);
    return true;
  }

  /** One pass into a target, without clearing it first (the passes cover what they write). */
  private draw(renderer: THREE.WebGLRenderer, p: Pass, target: THREE.WebGLRenderTarget) {
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(p.scene, this.cam);
    renderer.autoClear = clear;
  }

  /** Back to the start state at sim time 0. `deposits` false starts from bare ground. */
  reset(renderer: THREE.WebGLRenderer, deposits = true) {
    if (!this.targets.length) { if (!this.setup(renderer)) return; }
    if (!deposits) { (this.initTex.image.data as Float32Array).set(this.startState([])); this.initTex.needsUpdate = true; }
    const prev = renderer.getRenderTarget();
    // Both targets: cells outside the runs are never drawn again and must hold the blocked mark.
    this.draw(renderer, this.init, this.targets[1]);
    this.draw(renderer, this.init, this.targets[0]);
    this.read = 0;
    this.time = 0; this.steps = 0; this.bank = 0; this.srcNorm.clear();
    this.prepare(renderer);
    // The first snapshot is the start state itself, copied on the CPU (no read-back stall), so the first episodes can
    // break out of the old lobes too.
    this.snap = new Float32Array(this.initTex.image.data as Float32Array); this.snapAt = 0;
    renderer.setRenderTarget(prev);
    if (!deposits) { (this.initTex.image.data as Float32Array).set(this.startState(this.opts.deposits)); this.initTex.needsUpdate = true; }
    this.ready = true;
  }

  /** Source rate at sim time t, m3/s, and the episode it belongs to. */
  sourceRate(s: FlowSource, t: number) {
    const tt = t + s.phase, ep = Math.floor(tt / s.period), u = tt - ep * s.period;
    const env = smooth(0, 4, u) * (1 - smooth(s.feed - 6, s.feed, u));
    return { rate: s.rate * env, episode: ep };
  }

  /** Where a source feeds in an episode. On bare ground (or before the first snapshot) just ahead of its nose. Over old
   * lava it is a breakout: rays fan out from the nose (+-70 degrees), each finds where the lava on it ends, and one of
   * those margins is picked (downhill and nearer ones likelier); the new lava wells up 0.7 m
   * inside that margin, as if fed through the old lobe. One episode in four piles over the nose instead. */
  private sourceAt(si: number, ep: number) {
    const key = `${si}:${ep}`;
    let e = this.srcNorm.get(key);
    if (e) return e;
    const s = this.sources[si], C = FLOW_CELL, R = SOURCE_R, snap = this.snap;
    const h = (x: number, z: number) => { const k = this.cellAt(x, z); return k < 0 || !snap ? 0 : snap[k * 4] + snap[k * 4 + 1]; };
    const room = (x: number, z: number) => { const k = this.cellAt(x, z); return k >= 0 && this.base[k * 4 + 1] > .5 && this.base[k * 4 + 2] < 1.6; };
    let x = s.x + s.dirX * .6, z = s.z + s.dirZ * .6;
    if (snap && h(x, z) > .15 && hash(s.seed * 5.3 + ep * 1.9) > .25) {
      const picks: { x: number; z: number; w: number }[] = [];
      for (let a = -70; a <= 70; a += 10) {
        const th = a * Math.PI / 180, dx = s.dirX * Math.cos(th) - s.dirZ * Math.sin(th), dz = s.dirZ * Math.cos(th) + s.dirX * Math.sin(th);
        for (let d = .6; d < 11; d += C) {
          const px = s.x + dx * d, pz = s.z + dz * d;
          if (!room(px, pz)) break;
          if (h(px, pz) < .12) {
            if (d > 1) picks.push({ x: px - dx * .7, z: pz - dz * .7, w: Math.exp(-d / 7) * (.15 + Math.cos(th) ** 2) * (.3 + hash(s.seed * 7.7 + ep * 2.3 + a)) });
            break;
          }
        }
      }
      if (picks.length) {
        let total = 0; for (const q of picks) total += q.w;
        let u = hash(s.seed * 3.1 + ep * 4.7) * total;
        for (const q of picks) { u -= q.w; if (u <= 0) { x = q.x; z = q.z; break; } }
      }
    }
    let norm = 0;
    for (let j = Math.floor((z - this.z0 - R) / C); j <= Math.ceil((z - this.z0 + R) / C); j++) for (let i = Math.floor((x - this.x0 - R) / C); i <= Math.ceil((x - this.x0 + R) / C); i++) {
      if (!this.allowed(i, j)) continue;
      const r = Math.hypot(this.x0 + (i + .5) * C - x, this.z0 + (j + .5) * C - z);
      norm += (1 - smooth(.4 * R, R, r)) * C * C;
    }
    e = { x, z, norm: Math.max(norm, 1e-3) };
    if (this.srcNorm.size > 256) this.srcNorm.clear();
    this.srcNorm.set(key, e);
    return e;
  }

  /** Keeps a copy of the field on the CPU for choosing breakouts, read back without stalling every 3 s of sim time. */
  private refreshSnapshot(renderer: THREE.WebGLRenderer) {
    if (this.snapPending || this.time - this.snapAt < 3) return;
    this.snapPending = true; this.snapAt = this.time;
    const buf = new Float32Array(this.nx * this.nz * 4);
    renderer.readRenderTargetPixelsAsync(this.targets[this.read], 0, 0, this.nx, this.nz, buf, undefined, 0)
      .then(b => { this.snap = b as Float32Array; })
      .catch(() => { /* a lost context or an unreadable target: keep feeding at the noses */ })
      .finally(() => { this.snapPending = false; });
  }

  /** One step: PASSES relax passes with the sources at this step's rate. */
  private step(renderer: THREE.WebGLRenderer) {
    for (let i = 0; i < MAX_SOURCES; i++) {
      const v = this.srcVec[i];
      const s = this.sources[i];
      if (!s || !this.feeding) { v.set(0, 0, 1, 0); continue; }
      const { rate, episode } = this.override ? { rate: this.override(i, this.time), episode: 0 } : this.sourceRate(s, this.time);
      if (rate <= 0) { v.set(0, 0, 1, 0); continue; }
      const at = this.sourceAt(i, episode);
      v.set(at.x, at.z, SOURCE_R, rate / at.norm);
    }
    const u = this.sim.mat.uniforms;
    u.uSub.value = this.subsiding ? SUBSIDE : 0;
    u.uSubT.value = this.subsiding ? SUBSIDE_T : 1e30;
    for (let p = 0; p < PASSES; p++) {
      u.uState.value = this.targets[this.read].textures[0];
      u.uFlow.value = this.targets[this.read].textures[1];
      this.draw(renderer, this.sim, this.targets[1 - this.read]);
      this.read = 1 - this.read;
    }
    this.time += 1 / FLOW_STEP_HZ;
    this.steps++;
  }

  private prepare(renderer: THREE.WebGLRenderer) {
    const u = this.prep.mat.uniforms;
    u.uState.value = this.targets[this.read].textures[0];
    u.uFlow.value = this.targets[this.read].textures[1];
    this.draw(renderer, this.prep, this.render!);
    this.uniforms.uFR0.value = this.render!.textures[0];
    this.uniforms.uFR1.value = this.render!.textures[1];
  }

  /** Advance by the frame's time: whole steps at the fixed rate, at most 4 a frame (the rest is dropped). */
  update(renderer: THREE.WebGLRenderer, now: number) {
    if (!this.ready && !this.setup(renderer)) return;
    const dt = this.last < 0 || this.paused ? 0 : Math.max(0, now - this.last);
    this.last = now;
    this.bank += Math.min(dt, .5);
    let n = 0;
    const prev = renderer.getRenderTarget();
    while (this.bank >= 1 / FLOW_STEP_HZ && n < MAX_STEPS_PER_FRAME) { this.step(renderer); this.bank -= 1 / FLOW_STEP_HZ; n++; }
    if (n === MAX_STEPS_PER_FRAME) this.bank = Math.min(this.bank, 1 / FLOW_STEP_HZ);
    if (n) { this.prepare(renderer); this.refreshSnapshot(renderer); }
    renderer.setRenderTarget(prev);
  }

  /** Run `steps` steps at once (start-up history, QA time-lapse). A synchronous snapshot every 3 s of sim time stands
   * in for the async one (`snapshots` false skips it, for timing the passes alone). */
  advance(renderer: THREE.WebGLRenderer, steps: number, snapshots = true) {
    if (!this.ready && !this.setup(renderer)) return;
    const prev = renderer.getRenderTarget();
    for (let i = 0; i < steps; i++) { this.step(renderer); if (snapshots && this.time - this.snapAt >= 3) { this.snap = this.readState(renderer); this.snapAt = this.time; } }
    this.prepare(renderer);
    renderer.setRenderTarget(prev);
  }

  /** Reads the state back (QA only: it stalls the GPU). */
  readState(renderer: THREE.WebGLRenderer) {
    const out = new Float32Array(this.nx * this.nz * 4);
    if (!this.targets.length) return out;
    renderer.readRenderTargetPixels(this.targets[this.read], 0, 0, this.nx, this.nz, out, undefined, 0);
    return out;
  }

  stats(renderer: THREE.WebGLRenderer): FlowStats {
    const st = this.readState(renderer), C = FLOW_CELL, a = C * C;
    let hot = 0, cold = 0, maxH = 0, covered = 0, area = 0;
    const fronts = this.sources.map(() => 0);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = (j * this.nx + i) * 4, h = st[k] + st[k + 1];
      if (this.base[k + 1] > .5) area += a;
      hot += st[k] * a; cold += st[k + 1] * a; maxH = Math.max(maxH, h);
      if (h <= .05) continue;
      covered += a;
      const x = this.x0 + (i + .5) * C, z = this.z0 + (j + .5) * C;
      this.sources.forEach((s, si) => {
        const dx = x - s.x, dz = z - s.z, r = Math.hypot(dx, dz);
        if (r < 14 && dx * s.dirX + dz * s.dirZ >= .5 * r) fronts[si] = Math.max(fronts[si], r);
      });
    }
    return { time: this.time, steps: this.steps, hot, cold, total: hot + cold, maxH, covered, area, fronts };
  }

  /** The grid mesh the lava is drawn on: one vertex per cell at ground level (the shader lifts it), quads only where
   * the lava may reach. `stride` 2 is the low-detail mesh over every other cell; both share the vertex buffer. */
  meshGeometry(stride: 1 | 2, shared?: THREE.BufferGeometry): THREE.BufferGeometry {
    const { nx, nz } = this, C = FLOW_CELL;
    const g = new THREE.BufferGeometry();
    if (shared) { g.setAttribute('position', shared.getAttribute('position')); g.setAttribute('aCell', shared.getAttribute('aCell')); }
    else {
      const pos = new Float32Array(nx * nz * 3), cell = new Float32Array(nx * nz * 2);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const v = j * nx + i, k = v * 4;
        pos.set([this.x0 + (i + .5) * C, this.base[k], this.z0 + (j + .5) * C], v * 3);
        cell.set([(i + .5) / nx, (j + .5) / nz], v * 2);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aCell', new THREE.BufferAttribute(cell, 2));
    }
    const idx: number[] = [];
    const near = (i: number, j: number, r: number) => { for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) if (this.allowed(i + a, j + b)) return true; return false; };
    for (let j = 0; j + stride < nz; j += stride) for (let i = 0; i + stride < nx; i += stride) {
      if (!near(i, j, stride + 1) && !near(i + stride, j + stride, stride + 1)) continue;
      const a = j * nx + i, b = a + stride, c = a + stride * nx, d = c + stride;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    // Positions sit on the ground; the lava rises above it by a few metres at most, empty cells sink under it.
    g.computeBoundingBox();
    g.boundingBox!.max.y += 4; g.boundingBox!.min.y -= 1;
    g.boundingSphere = g.boundingBox!.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  /** Clinker crumb candidates: about 11 per m2 over the reach, jittered; the shader shows the ones at a margin. */
  clinkerSpots() {
    const out: { x: number; z: number; y: number; seed: number }[] = [];
    for (let j = 0; j < this.nz; j += 2) for (let i = 0; i < this.nx; i += 2) {
      if (!this.allowed(i, j) && !this.allowed(i + 1, j + 1)) continue;
      for (let n = 0; n < 4; n++) {
        if (n && hash((j * this.nx + i) * 5.1 + n * 1.7) > .62) continue;
        const s = (j * this.nx + i) * 4 + n, x = this.x0 + (i + hash(s * 1.37) * 2) * FLOW_CELL, z = this.z0 + (j + hash(s * 2.11) * 2) * FLOW_CELL;
        out.push({ x, z, y: this.opts.ground(x, z), seed: hash(s * 3.3) });
      }
    }
    return out;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.render?.dispose();
    this.baseTex.dispose(); this.initTex.dispose(); this.empty.dispose();
    for (const p of [this.sim, this.init, this.prep]) { p.mat.dispose(); (p.scene.children[0] as THREE.Mesh).geometry.dispose(); }
  }
}
