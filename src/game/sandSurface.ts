import * as THREE from 'three';
import type { SnowDeform } from './snowDeform';
import type { SandSpray } from './sandSpray';
import type { Unit } from './unit';
import { addPatch } from '../world/materials';
import { SAND_SURFACE_GLSL } from './sandTerrain';

/*
 * Goldsand's sand material, shaded as carefully as Frostlight's snow (snowSurface.ts) on a MeshStandardMaterial
 * whose vertices the clipmap (sandTerrain.ts) has already placed.
 *
 * Albedo follows what the wind does to sand. Crests the wind scours are paler and finer; troughs keep the coarse,
 * darker, redder lag, and the flattest interdunes are paved with varnished gravel; slip faces are a shade darker and
 * smooth, streaked by grain flows; stable flats carry a greyer crust where scrub once held them; the sea darkens and
 * glosses the sand it reaches. The dunes shade each other: the bake is marched toward the sun. The citadel's climb is scoria with sand drifted into it, and the bluffs are bedded sandstone.
 *
 * The normal sums slopes before it becomes a normal: the landform's slope read per pixel from the bake, the wind
 * ripples and megaripples (sandFine, band-limited to the pixel), the footprint field, and a grain at three scales.
 * Quartz grains glint only looking across the sand into the low sun; looking down at it they stay matte.
 */

export interface SandSurfaceOptions {
  /** Light the glints and back-scatter answer to. Its world direction and radiance are read every frame. */
  sun: THREE.DirectionalLight;
  /** The sky's horizon and zenith radiance, for the sky wet sand reflects. */
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
}

const SURFACE_FRAGMENT_HEAD = /* glsl */ `
uniform vec3 sandSunDir;
uniform vec3 sandSunColor;
uniform vec3 sandSkyHorizon;
uniform vec3 sandSkyZenith;
varying vec3 vSandWorld;
varying vec4 vSandInfo;
vec3 sdLin(vec3 c){return c*c*(c*.3+.7);}
// Cell noise: distance to the nearest jittered point and that cell's hash, for gravel, scrub tufts and glints.
vec3 sdCells(vec2 p){
  vec2 i=floor(p),f=fract(p);float best=8.;float id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)),o=sdHash22(i+g);
    vec2 r=g+o-f;float d=dot(r,r);
    if(d<best){best=d;id=snHash(i+g+vec2(13.7,4.1));}
  }
  return vec3(sqrt(best),id,0.);
}
// One octave of quartz facets: each world cell owns at most one jittered grain, nailed to the ground.
float sdGlintOctave(vec2 p,float cell,vec3 N,vec3 H,vec3 T,vec3 B,float sharp){
  vec2 id=floor(p/cell);
  vec2 r=sdHash22(id),r2=sdHash22(id+vec2(19.73,7.31));
  if(r2.x>.3)return 0.;
  vec2 c=(id+.5+(r-.5)*.72)*cell;
  float d=length(p-c)/(cell*.16);
  float disc=clamp(1.-d*d,0.,1.);
  if(disc<=0.)return 0.;
  float ang=r.y*6.2831853;
  vec3 facet=normalize(N+(T*cos(ang)+B*sin(ang))*(.12+r2.y*.3));
  return disc*pow(clamp(dot(facet,H),0.,1.),sharp);
}
// The dunes' own shadows: march the baked ground toward the sun. Steps grow with distance, so a crest a hundred
// metres off still shades the trough behind it; the edge softens with distance like a real penumbra.
float sandSunVis=1.;
// lattice is the clipmap's vertex spacing here: between coarse vertices the drawn surface sags under the bake's
// crests, so the march starts a lattice step out and lifts its ray by part of one, or it shades itself in stripes.
float sandHorizon(vec3 P,vec3 L,vec3 N,float lattice){
  // Facing away from the sun there is no direct light to shade.
  if(L.y<=0.||dot(N,L)<-.05)return 1.;
  #ifdef SAND_LOW
  const int N_=8;const float G=2.;
  #else
  const int N_=12;const float G=1.62;
  #endif
  float t=.45+lattice,vis=1.,lift=.01+lattice*.12;
  for(int i=0;i<N_;i++){
    vec3 q=P+L*t+vec3(0.,lift,0.);
    // Close steps read the fine bake; past a few metres the coarse one resolves any crest that can shade here.
    float h=t<6.?sandGroundAt(q.xz).x:textureLod(sandFarTex,sandFarUV(q.xz),0.).x+SAND_H0;
    vis=min(vis,smoothstep(-1.,1.,(q.y-h)/(t*.028+.02)));
    if(vis<=0.)break;
    t*=G;
  }
  return vis;
}
float sdGlints(vec2 p,vec3 N,vec3 V,vec3 L,float fp){
  vec3 H=normalize(V+L);
  vec3 up=abs(N.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.);
  vec3 T=normalize(cross(up,N)),B=cross(N,T);
  float graze=pow(1.-clamp(dot(N,V),0.,1.),3.5);
  float nl=clamp(dot(N,L),0.,1.);
  float gate=graze*smoothstep(.02,.3,nl);
  if(gate<=.001)return 0.;
  float a=.035,fa=1.-smoothstep(a*.5,a*2.,fp);
  if(fa<=.001)return 0.;
  float sum=0.;
  if(fa>.001)sum+=sdGlintOctave(p,a,N,H,T,B,900.)*fa;
  return sum*gate;
}
`;

const SAND_STATE = /* glsl */ `
  vec3 sW=vSandWorld;vec2 sXZ=sW.xz;
  vec3 sDx=dFdx(sW),sDy=dFdy(sW);
  // World size of this pixel, and its narrow axis (the one grazing views do not inflate).
  float sFoot=max(length(vec2(length(sDx.xz),length(sDy.xz))),1e-4);
  float sFootMin=max(min(length(sDx.xz),length(sDy.xz)),1e-4);
  float sOpen=vSandInfo.y,sRip=vSandInfo.z;
  // The landform's slope per pixel, filtered to the pixel's own footprint; and the height a few metres around
  // (a blurred mip), so crests and troughs can be told apart.
  vec2 sGUV=sandGroundUV(sXZ),sGdx=dFdx(sGUV),sGdy=dFdy(sGUV);
  float sNearW=sandNearW(sXZ);
  vec4 sG=vec4(sW.y,0.,0.,sOpen);float sAround=sW.y;
  if(sNearW>0.){sG=textureGrad(sandGroundTex,sGUV,sGdx,sGdy);sAround=textureLod(sandGroundTex,sGUV,5.).x+SAND_H0;}
  if(sNearW<1.){vec2 fu=sandFarUV(sXZ);if(sandIn(fu)){vec4 fg=textureGrad(sandFarTex,fu,dFdx(fu),dFdy(fu));sG=mix(fg,sG,sNearW);sAround=mix(textureLod(sandFarTex,fu,2.).x+SAND_H0,sAround,sNearW);}}
  vec2 sGrad=sG.yz;
  float sSlope=length(sGrad);
  // Lee slip faces: steep and falling downwind.
  float sLee=smoothstep(.3,.5,sSlope)*smoothstep(.1,.5,-dot(sGrad,SG_WIND)/max(sSlope,1e-4));
  // Crest (scoured) against trough (lag), metres above the blurred ground.
  float sCrest=clamp((sW.y-sAround)*.9,-1.,1.);
  // Footprint field: depression, berm. The gradient's step widens with the pixel.
  vec2 sDG=vec2(0.);float sDep=0.,sBerm=0.,sDepW=0.;
  float sFall=snowDeformFalloff(sXZ);
  if(sFall>.001){
    float texel=snowDeformSize/snowDeformRes,e=max(texel*2.,sFootMin*1.4),eu=e/snowDeformSize;
    vec2 uv=fract(sXZ/snowDeformSize);
    vec4 c=texture2D(snowDeformTex,uv),xa=texture2D(snowDeformTex,uv+vec2(eu,0.)),xb=texture2D(snowDeformTex,uv-vec2(eu,0.));
    vec4 za=texture2D(snowDeformTex,uv+vec2(0.,eu)),zb=texture2D(snowDeformTex,uv-vec2(0.,eu));
    sDG=vec2((xa.g-xa.r)-(xb.g-xb.r),(za.g-za.r)-(zb.g-zb.r))/(2.*e)*sFall*1.1;
    sDep=c.r*sFall;sBerm=c.g*sFall;
    sDepW=clamp(length(vec2(xa.r-xb.r,za.r-zb.r))/(2.*e)*sFall*1.4,0.,1.);
  }
  // Where the sand is: the sea's reach, the citadel's scoria climb, the bluffs.
  float sAbove=sW.y-SG_SEA;
  float sWet=1.-smoothstep(.06,.55+.25*snNoise(sXZ*.13),sAbove);
  float sDamp=(1.-smoothstep(.4,1.6,sAbove))*(1.-sWet);
  float sR=sgRadius(sXZ);
  // Scoria only where the citadel's rock breaks through: round the arena and under the walls, in broken patches.
  float sVolc=smoothstep(-46.,-58.,sXZ.y)*(1.-smoothstep(.8,.88,sR))*(1.-sOpen)*smoothstep(.35,.6,snNoise(sXZ*.045+vec2(5.,2.))+smoothstep(-60.,-80.,sXZ.y)*.4);
  float sCliff=smoothstep(.62,.95,sSlope)*(1.-sLee*.8);
  // Patch fields, tens of metres and metres across.
  float n1=snNoise(sXZ*.031+vec2(3.7,1.1)),n2=snNoise(sXZ*.13+vec2(-1.9,6.3)),n3=snNoise(sXZ*.61);
  float fG=1.-smoothstep(.02,.09,sFoot);
  float n4=fG>.001?mix(.5,snNoise(sXZ*4.3+vec2(2.2,9.1)),fG):.5;
  // Wind streaks: faint bands along the wind where finer, paler sand has been sorted out.
  vec2 sWq=vec2(dot(sXZ,SG_WIND),dot(sXZ,vec2(-SG_WIND.y,SG_WIND.x)));
  float streak=snNoise(sWq*vec2(.035,.42))*.65+snNoise(sWq*vec2(.09,1.3))*.35;
  // Warm golden ochre, never orange; value carries the form.
  // Quartz sand reflects a broad spectrum: the gold comes mostly from the low sun, so shade can still go blue.
  vec3 sand=sdLin(vec3(.82,.72,.53));
  vec3 pale=sdLin(vec3(.9,.83,.66)),lag=sdLin(vec3(.7,.58,.44)),red=sdLin(vec3(.84,.68,.5));
  vec3 alb=mix(sand,red,smoothstep(.3,.75,n1)*.3);
  alb=mix(alb,pale,smoothstep(.05,.7,sCrest)*.7);
  alb=mix(alb,lag,smoothstep(-.1,-.75,sCrest)*(.55+.3*n2));
  alb*=.94+.1*streak+.05*(n2-.5)+.05*(n3-.5);
  alb*=mix(1.,.9+.2*n4,fG);
  // Slip faces: a shade darker, streaked down the fall line by grain flows.
  if(sLee>.01){
    vec2 fall=-sGrad/max(sSlope,1e-4);vec2 q=vec2(dot(sXZ,fall),dot(sXZ,vec2(-fall.y,fall.x)));
    float flow=snNoise(q*vec2(.25,2.3)+vec2(4.,1.))*.6+snNoise(q*vec2(.6,6.1))*.4;
    alb=mix(alb,alb*(.86+.14*flow),sLee);
  }
  float sRough=.93;
  // Desert pavement in the flattest troughs: dark varnished gravel set in coarse sand.
  float pave=smoothstep(.66,.84,n1*.55+n2*.45)*smoothstep(-.05,-.5,sCrest)*(1.-smoothstep(.06,.16,sSlope))*sOpen*(1.-sWet-sDamp);
  if(pave>.01){
    // Pebbles a few centimetres across, resolved only up close; further off the patch is a darker, browner tone.
    float fS=1.-smoothstep(.012,.04,sFoot);
    vec3 grit=sdLin(vec3(.55,.42,.3));
    vec3 pv=mix(lag*.93,grit,.3);
    if(fS>.001){
      vec3 cg=sdCells(sXZ*13.);
      float stone=(1.-smoothstep(.25,.4,cg.x))*step(.35,cg.y);
      vec3 pebble=mix(sdLin(vec3(.6,.47,.34)),sdLin(vec3(.42,.3,.22)),cg.y);
      pv=mix(pv,mix(lag*.95,pebble,stone),fS);
    }
    alb=mix(alb,pv,pave*.85);
  }
  // Crusted patches on stable sand where dry scrub once held it: greyer, finely speckled with grit and twigs.
  float crust=smoothstep(.68,.84,snNoise(sXZ*.05+vec2(-7.,3.))*.7+n2*.3)*(1.-smoothstep(.12,.25,sSlope))*sOpen*(1.-sWet-sDamp)*(1.-sVolc);
  if(crust>.01){
    float speck=fG*smoothstep(.72,.9,snNoise(sXZ*19.+vec2(3.,8.)));
    alb=mix(alb,alb*sdLin(vec3(.9,.9,.86))*(1.-speck*.3),crust*.8);
  }
  // Damp and wet sand where the sea reaches; swash lines left by the last waves.
  alb=mix(alb,alb*sdLin(vec3(.74,.7,.66)),sDamp);
  float swash=smoothstep(.85,1.,sin((sAbove*9.+snNoise(sXZ*.4)*2.)*3.14159))*sWet*(1.-smoothstep(0.,.3,-sAbove));
  alb=mix(alb,sdLin(vec3(.47,.37,.27))*(.9+.15*n3),sWet*.85);
  alb=mix(alb,pale*.95,swash*.35);
  sRough=mix(sRough,.32,sWet*smoothstep(-.1,.2,-sAbove+.25));
  // Gameplay ground is trodden: packed, a shade darker, rippled only faintly (sandRippleAmp).
  alb=mix(alb,alb*sdLin(vec3(.93,.9,.88)),(1.-sOpen)*.6);
  // The citadel climb: scoria and basalt, with sand drifted into its hollows.
  if(sVolc>.01){
    // Rust-red cinders and dark basalt grit, with the sand drifted back over them.
    vec3 sc=mix(sdLin(vec3(.5,.33,.25)),sdLin(vec3(.68,.45,.32)),smoothstep(.3,.7,n2))*(.85+.3*n3)*(.8+.4*n4);
    sc=mix(sc,sdLin(vec3(.38,.3,.27)),smoothstep(.6,.85,n3)*.6);
    sc=mix(sc,alb,smoothstep(.4,.75,n1*.7+n4*.3+(-sCrest)*.4)*.6);
    alb=mix(alb,sc,sVolc*.85);
  }
  // Bluffs: bedded sandstone, projected on the face so the beds run level.
  if(sCliff>.01){
    vec2 nd=sGrad/max(sSlope,1e-4);vec2 fp=vec2(dot(sXZ,vec2(-nd.y,nd.x)),sW.y);
    float warp=snNoise(fp*vec2(.08,.3))*2.;
    float bed=snNoise(vec2(fp.x*.05,(fp.y+warp)*1.6));
    float crack=smoothstep(.6,.9,snNoise(fp*vec2(.9,.2)));
    vec3 rock=mix(sdLin(vec3(.7,.48,.33)),sdLin(vec3(.85,.66,.45)),bed)*(1.-crack*.3)*(.88+.2*n3);
    rock=mix(rock,mix(sdLin(vec3(.36,.26,.22)),sdLin(vec3(.5,.36,.29)),bed),sVolc);
    alb=mix(alb,rock,sCliff);sRough=mix(sRough,.86,sCliff);
  }
  // Prints: sand turned over is a touch darker in the hollow (moister below), paler on the thrown rim.
  alb*=1.-clamp(sDep*5.,0.,1.)*.2;
  alb=mix(alb,pale,clamp(sBerm*12.,0.,1.)*.35*(1.-sWet));
  diffuseColor.rgb=alb;
  sandSunVis=sandHorizon(sW,normalize(sandSunDir),normalize(vec3(-sGrad.x,1.,-sGrad.y)),vSandInfo.x);
`;

const SAND_NORMAL = /* glsl */ `
  vec3 sN;
  {
    vec2 g=sGrad+sDG;
    float rip=sRip*(1.-sCliff)*(1.-sVolc*.7)*(1.-clamp(sDep*6.+sBerm*12.,0.,1.));
    // Band-limited to the pixel's wide axis: grazing views would otherwise alias ripples into moire.
    vec3 fn=sandFine(sXZ,sFoot,rip,1.);
    g+=fn.yz*(1.-sWet*.6);
    // Broken sand at a print's rim: clumps, not a bevel.
    if(sBerm+sDepW>.002){vec3 cl=snNoised(sXZ*24.);g+=cl.yz*.04*clamp(sBerm*10.+sDepW,0.,1.)*(1.-smoothstep(.01,.05,sFoot));}
    // Gravel and scrub stand proud of the sand.
    sN=normalize(vec3(-g.x,1.,-g.y));
  }
  normal=normalize((viewMatrix*vec4(sN,0.)).xyz);
`;

const SAND_AFTER = /* glsl */ `
  {
    vec3 sL=normalize(sandSunDir),sV=normalize(cameraPosition-vSandWorld);
    float nl=clamp(dot(sN,sL),0.,1.);
    // Out of the sun the sand is lit by the sky, and the sky is brightest low toward the sun: faces turned that way
    // (ripple stoss sides, sunward dune flanks) catch more of it, so shade keeps the ripples and the dune forms
    // instead of going flat. Quartz is near grey; its gold is mostly the sun's, so skylight on it reads lilac blue.
    {
      vec3 Ls=normalize(vec3(sL.x,.65,sL.z));
      float rel=(dot(sN,Ls)-Ls.y)*1.5;
      // Faces turned from the sun see the deep blue half of the sky: dimmer only a little, and bluer.
      vec3 relC=rel>0.?min(rel,.8)*vec3(1.,.95,.85):max(rel,-.5)*vec3(.3,.16,-.12);
      // Hollows see less sky than crests (the bake's height against its blur a few metres round).
      float open=clamp(sCrest*.18,-.16,.1);
      outgoingLight+=reflectedLight.indirectDiffuse*(vec3(-.3,-.1,.48)*(1.-sWet)+relC+open);
    }
    // Wet sand mirrors the sky.
    vec3 R=reflect(-sV,sN);
    vec3 sky=mix(sandSkyHorizon,sandSkyZenith,smoothstep(0.,.6,R.y));
    float fr=pow(1.-clamp(dot(sN,sV),0.,1.),5.);
    outgoingLight+=sky*fr*.5*sWet;
    // Rough grains throw light back toward the sun (the opposition surge): sand looking down-sun brightens.
    float back=pow(clamp(dot(sV,sL),0.,1.),6.)*nl;
    outgoingLight+=sandSunColor*diffuseColor.rgb*back*.06*sandSunVis*(1.-sWet);
    // Quartz glints, only into a low sun and only at grazing angles; a hint, not glitter.
    outgoingLight+=sandSunColor*sdGlints(sXZ,sN,sV,sL,sFoot)*.012*sandSunVis*(1.-sWet)*(1.-sVolc)*(1.-sCliff);
  }
`;

/** Patch the clipmap's sand material in place. Call the returned function once a frame before it draws. */
export function applySandSurface(material: THREE.MeshStandardMaterial, deform: SnowDeform, opts: SandSurfaceOptions): () => void {
  const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color();
  const uniforms = {
    ...deform.uniforms,
    sandSunDir: { value: sunDir },
    sandSunColor: { value: sunColor },
    sandSkyHorizon: { value: opts.skyHorizon },
    sandSkyZenith: { value: opts.skyZenith },
  };
  const tmp = new THREE.Vector3();
  material.userData.sandSurface = uniforms;
  // The scene's environment map belongs to another world; the sand is lit by Goldsand's sky alone.
  material.envMapIntensity = 0;
  const refresh = () => {
    opts.sun.getWorldPosition(sunDir);
    opts.sun.target.getWorldPosition(tmp);
    sunDir.sub(tmp).normalize();
    sunColor.copy(opts.sun.color).multiplyScalar(opts.sun.intensity);
  };
  addPatch(material, 'goldsand-sand-surface', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SAND_SURFACE_GLSL}\n${SURFACE_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SAND_STATE}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('? getShadow( directionalShadowMap[ i ]', '? sandSunVis * getShadow( directionalShadowMap[ i ]'))
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=sRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SAND_NORMAL}`)
      .replace('#include <opaque_fragment>', `${SAND_AFTER}\n#include <opaque_fragment>`);
  });
  refresh();
  return refresh;
}

const FEET = ['LM', 'RM', 'LR', 'RR'] as const;
/** `ux, uz` is the body at frame `seen`, `vx, vz` its smoothed ground velocity. */
interface FootState { nodes: THREE.Object3D[]; down: boolean[]; last: Float32Array; ux: number; uz: number; vx: number; vz: number; seen: number }
type LinkedRig = { linkNode?: (name: string) => THREE.Object3D };

/**
 * Turns walking crabs into prints in the sand (SnowFootfalls, sand's numbers): a foot leaves one print when it
 * touches down, another only after it has slid a stride while still down. Dry sand gives way less than powder and
 * slumps back into a shallow bowl with a low rim. Paving and other bare ground (`bare`) take no print and throw no
 * sand; everywhere else each print kicks sand into `spray`, so the two always come from the same footfall.
 */
export class SandFootfalls {
  readonly stats = { prints: 0, bare: 0 };
  private readonly state = new WeakMap<Unit, FootState | null>();
  private readonly p = new THREE.Vector3();
  private frame = 0;

  constructor(private readonly bare: (x: number, z: number) => boolean) {}

  update(units: readonly Unit[], deform: SnowDeform, height: (x: number, z: number) => number, cx: number, cz: number, spray?: SandSpray, dt = 1 / 60): void {
    const reach = deform.size * 0.42;
    this.frame++;
    for (const u of units) {
      if (!u.alive || u.hidden || !u.rig.root.visible) continue;
      const pos = u.pos;
      if (Math.abs(pos.x - cx) > reach || Math.abs(pos.z - cz) > reach) continue;
      let st = this.state.get(u);
      if (st === undefined) { st = this.bind(u); this.state.set(u, st); }
      if (!st) continue;
      // Body velocity from its own motion; a body out of range last frame, or one that teleported, starts at rest.
      if (dt > 1e-4) {
        const mx = (pos.x - st.ux) / dt, mz = (pos.z - st.uz) / dt, w = 1 - Math.exp(-dt * 10);
        if (st.seen !== this.frame - 1 || mx * mx + mz * mz > 900) { st.vx = 0; st.vz = 0; } else { st.vx += (mx - st.vx) * w; st.vz += (mz - st.vz) * w; }
      }
      st.ux = pos.x;
      st.uz = pos.z;
      st.seen = this.frame;
      const s = THREE.MathUtils.clamp(u.height, 0.5, 4);
      for (let i = 0; i < st.nodes.length; i++) {
        st.nodes[i].getWorldPosition(this.p);
        const ground = height(this.p.x, this.p.z);
        const contact = this.p.y - ground < 0.09 * s;
        if (contact) {
          const dx = this.p.x - st.last[i * 2], dz = this.p.z - st.last[i * 2 + 1];
          if (!st.down[i] || dx * dx + dz * dz > (0.2 * s) ** 2) {
            st.last[i * 2] = this.p.x;
            st.last[i * 2 + 1] = this.p.z;
            if (this.bare(this.p.x, this.p.z)) { this.stats.bare++; continue; }
            deform.brush({ x: this.p.x, z: this.p.z, radius: 0.1 * s, elongation: 1.25, yaw: u.yaw, depth: 0.05 * s, berm: 0.022 * s, compression: 0.4, roughness: 0.85, seed: (this.p.x * 7.13 + this.p.z * 3.71) % 97 });
            spray?.kick(this.p.x, ground, this.p.z, st.vx, st.vz, s, !st.down[i]);
            this.stats.prints++;
          }
        }
        st.down[i] = contact;
      }
    }
  }

  private bind(u: Unit): FootState | null {
    const rig = u.rig as unknown as LinkedRig;
    if (typeof rig.linkNode !== 'function') return null;
    try {
      const nodes = FEET.map((f) => rig.linkNode!(`${f}_foot_tip_link`));
      return { nodes, down: nodes.map(() => true), last: new Float32Array(nodes.length * 2).fill(1e6), ux: u.pos.x, uz: u.pos.z, vx: 0, vz: 0, seen: -1 };
    } catch {
      return null;
    }
  }
}
