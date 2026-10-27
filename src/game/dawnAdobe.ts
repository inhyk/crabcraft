import * as THREE from 'three';
import {FROST_NOISE} from './frostPaving';
import {addPatch} from '../world/materials';

/*
 * Goldsand Harbor's desert building kit (World III): the surfaces and the geometry the quarter (dawnHouses.ts) is
 * built from. Four materials carry the whole quarter, each one draw:
 *  - dawnPlaster: thick hand-laid walls in world space: whitewash worn through to mudbrick near the foot and the
 *    corners, coursed honey sandstone, raw mudbrick under patches of mud render; damp, sand-splashed feet, streaks
 *    under the roof edge, trowel sweeps, a bumped surface up close. Per vertex: tint, finish, height over the ground,
 *    depth under the parapet, occlusion.
 *  - dawnCraft: everything small and specific, chosen per vertex: the dark rooms behind openings (with a warm lamp
 *    glow), turned-wood lattice screens, painted plank doors with iron studs, glazed tiles, brass, terracotta and
 *    glazed jars, palm bark, spice heaps, woven baskets, iron.
 *  - dawnCloth: awnings, shade sails, rugs, carpets and laundry, swaying.
 *  - (dawnPalms.ts) palm fronds.
 * Geometry: Acc collects triangles with their attributes; block() raises a battered, round-cornered block with a
 * capped parapet and a roof slab, its faces cut by deep openings (rect or arched) with reveals and a back panel.
 */

const HEAD = `${FROST_NOISE}
vec3 adTri(vec3 n){vec3 a=abs(n);return a/(a.x+a.y+a.z);}
`;

/** Patch helper: varyings for world position and normal, plus the caller's attributes and code. */
function patch(mat: THREE.Material, key: string, o: {attrs?: string; vary?: string; vBody?: string; vBegin?: string; head?: string; color?: string; rough?: string; metal?: string; emissive?: string; normal?: string}) {
  addPatch(mat, key, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAdW;\nvarying vec3 vAdN;\n${o.attrs ?? ''}${o.vary ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vBegin ?? ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvAdW=(modelMatrix*vec4(transformed,1.)).xyz;vAdN=normalize(mat3(modelMatrix)*objectNormal);${o.vBody ?? ''}`);
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vAdW;\nvarying vec3 vAdN;\n${o.vary ?? ''}${HEAD}${o.head ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.color ?? ''}`);
    if (o.rough) f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.rough}`);
    if (o.metal) f = f.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${o.metal}`);
    if (o.emissive) f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.emissive}`);
    if (o.normal) f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.normal}`);
    shader.fragmentShader = f;
  });
  mat.customProgramCacheKey = () => key;
}

/** Bump the shading normal by a world-space height function H(vec3), strength k, fading out with distance. */
const bump = (fn: string, k: string, e = '.015', far = 34) => `{
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  float e=${e},h0=${fn}(vAdW);
  vec3 g=vec3(${fn}(vAdW+vec3(e,0.,0.))-h0,${fn}(vAdW+vec3(0.,e,0.))-h0,${fn}(vAdW+vec3(0.,0.,e))-h0)/e;
  g-=dot(g,nW)*nW;
  float fade=1.-smoothstep(${(far * .4).toFixed(1)},${far.toFixed(1)},length(vViewPosition));
  nW=normalize(nW-g*(${k})*fade);
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}`;

/** Wall finishes (aPlK): plaster over mudbrick, coursed sandstone, bare mudbrick. */
export const FIN = {plaster: 0, ashlar: 1, mudbrick: 2} as const;

export function dawnPlaster(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-plaster', color: '#ffffff', roughness: .93, vertexColors: true});
  const plane = /* glsl */ `
    vec2 adPlane(vec3 p,vec3 n,out float vert){vert=1.-smoothstep(.55,.8,abs(n.y));
      vec2 f=vec2(abs(n.x)>abs(n.z)?p.z:p.x,p.y);return mix(p.xz,f,vert);}
    // Running-bond courses: brick id and the distance to the nearest joint.
    vec3 adBond(vec2 q,vec2 size){float row=floor(q.y/size.y);vec2 b=vec2(q.x/size.x+.5*mod(row,2.),q.y/size.y);vec2 f=fract(b);
      vec2 d=min(f,1.-f)*size;return vec3(floor(b),min(d.x,d.y));}`;
  patch(m, 'goldsand-plaster', {
    attrs: 'attribute vec3 aPl;\nattribute float aPlK;\nattribute vec2 aPlUv;\n',
    vary: 'varying vec3 vPl;\nvarying float vPlK;\nvarying vec2 vPlE;\n',
    vBody: 'vPl=aPl;vPlK=aPlK;vPlE=aPlUv;',
    head: plane + /* glsl */ `
    float adH(vec3 p){vec3 n=normalize(vAdN);float vt;vec2 q=adPlane(p,n,vt);
      float h=fpNoise(q*2.3)*.5+fpNoise(q*7.1)*.18;
      if(vPlK>.5&&vPlK<1.5){float row=floor(q.y/.34),yy=q.y-row*.34,bl=.55+.35*fpHash12(vec2(row,7.)),bx=q.x/bl+fpHash12(vec2(row,3.));
        float jd=min(min(fract(bx),1.-fract(bx))*bl,min(yy,.34-yy));h+=smoothstep(0.,.02,jd)*.55+fpNoise(q*16.)*.25;}
      else if(vPlK>1.5){vec3 b=adBond(q,vec2(.4,.13));h+=smoothstep(0.,.025,b.z)*.9+fpNoise(q*16.)*.25;}
      return h*.012;}`,
    color: /* glsl */ `{
      vec3 n=normalize(vAdN);float vert;vec2 q=adPlane(vAdW,n,vert);
      vec3 tint=diffuseColor.rgb;
      float mott=fpFbm(q*.3)*.5+.5,fine=fpNoise(q*6.3)*.5+.5,gr=fpNoise(q*23.)*.5+.5;
      vec3 c=tint*(.86+.22*mott)*(.94+.09*fine)*(.97+.05*gr);
      // Metres to the nearest corner along the wall; the corner arris itself is 0.
      float corner=1.-smoothstep(.0,.75+.5*fine,min(vPlE.x,vPlE.y));
      // Coats of limewash laid years apart: broad patches a shade creamier or greyer, a faint lip where one ends.
      float coat=(fpNoise(q*.17+31.)*.65+fpNoise(q*.43+7.)*.35)*.5+.5;
      c*=mix(vec3(1.),mix(vec3(.93,.9,.86),vec3(1.02,.99,.93),smoothstep(.35,.65,coat)),vert);
      c*=1.-.035*(1.-smoothstep(0.,.025,abs(coat-.5)))*vert;
      // Trowel sweeps.
      c*=1.+.03*sin(q.x*1.9+fpNoise(q*.8)*4.+q.y*2.6)*vert;
      if(vPlK<.5){
        // Whitewash worn through to mudbrick: more near the foot, a dark lip of plaster round each patch.
        float wn=fpFbm(q*.5+17.)*.5+.5,wb=wn+.24*(1.-smoothstep(0.,1.4,vPl.x))-.05+.22*corner;
        float wear=smoothstep(.7,.712,wb)*vert;
        vec3 bd=adBond(q,vec2(.4,.13));
        vec3 brick=vec3(.6,.4,.25)*(.8+.3*fpHash12(bd.xy))*(.9+.15*gr);
        brick=mix(vec3(.46,.35,.25),brick,smoothstep(.006,.016,bd.z));
        c=mix(c,brick,wear);
        c*=1.-.22*(smoothstep(.665,.7,wb)-wear)*vert;
      }else if(vPlK<1.5){
        // Coursed sandstone: courses of two heights, blocks of varied length, each its own shade; thin sanded joints;
        // faint bedding streaks.
        float row=floor(q.y/.34),ch=mod(row,2.)<.5?.3:.38,yy=q.y-row*.34;
        float bl=.55+.35*fpHash12(vec2(row,7.)),bx=q.x/bl+fpHash12(vec2(row,3.));vec2 bid=vec2(floor(bx),row);
        float jx=min(fract(bx),1.-fract(bx))*bl,jy=min(yy,.34-yy),jd=min(jx,jy);
        float k=fpHash12(bid+3.);
        vec3 sc=c*(.93+.12*k)*(1.+.05*sin(q.y*28.+fpNoise(q*1.5)*3.));
        float joint=1.-smoothstep(.004,.012,jd);
        c=mix(c,mix(sc,c*vec3(1.08,1.04,.98),joint*.8),vert);
        c*=1.-.08*(1.-smoothstep(0.,.04,jd))*vert;
      }else{
        // Mudbrick under patches of mud render.
        vec3 bd=adBond(q,vec2(.4,.13));
        float render=smoothstep(.48,.52,fpFbm(q*.45+4.)*.5+.5);
        vec3 brick=c*(.82+.3*fpHash12(bd.xy))*mix(vec3(1.),vec3(1.04,.97,.92),fpHash12(bd.xy+1.));
        brick=mix(c*vec3(.8,.76,.72),brick,smoothstep(.006,.018,bd.z));
        c=mix(brick,c*1.05,render*vert+(1.-vert));
      }
      // Damp, sand-splashed foot, and the band of blown sand and dirt the wind piles against it (20 to 40 cm,
      // ragged top, the splash speckled above it).
      float foot=1.-smoothstep(0.,.4+.45*(fpNoise(q*1.6)*.5+.5),vPl.x);
      c=mix(c,c*vec3(.76,.64,.5),foot*.7*vert);
      float bandTop=.2+.2*(fpNoise(vec2(q.x*.9,3.))*.5+.5)+.05*fpNoise(vec2(q.x*7.,1.));
      float band=1.-smoothstep(bandTop-.04,bandTop+.02,vPl.x);
      float speck=smoothstep(.62,.8,fpNoise(q*vec2(9.,14.))*.5+.5)*(1.-smoothstep(bandTop,bandTop+.5,vPl.x));
      vec3 dirt=vec3(.62,.47,.32)*(.85+.25*fine);
      c=mix(c,dirt,(band*.85+speck*.35)*vert);
      // Corners and arrises: handled, rubbed and dusty.
      c*=1.-.1*corner*vert;
      // Streaks under the roof edge.
      float st=smoothstep(.45,.9,fpNoise(vec2(q.x*1.4,7.))*.5+.5+.25*fpNoise(vec2(q.x*8.,q.y*.5)));
      c*=1.-.17*st*(1.-smoothstep(0.,2.4,vPl.y))*step(.04,vPl.y)*vert;
      // Long tea-coloured runs from the parapet's spouts and the sills, a few metres down the wash.
      float run=smoothstep(.7,.92,fpNoise(vec2(q.x*2.6,1.7))*.5+.5)*(.6+.4*(fpNoise(vec2(q.x*11.,q.y*.35))*.5+.5));
      c=mix(c,c*vec3(.8,.72,.62),run*.38*(1.-smoothstep(.3,4.8,vPl.y))*step(.04,vPl.y)*vert);
      // Roof slabs and caps: smooth mud plaster in the wall's hue, trodden darker in patches.
      vec3 mud=mix(tint,vec3(.8,.68,.52),.45)*(.86+.18*mott)*(.95+.06*fine);
      c=mix(mud,c,smoothstep(.15,.6,vert));
      c*=vPl.z;
      // Lime is never paper white: the brightest wash keeps its warm cream and stays under 0.8 albedo, so a wall
      // square to the low sun rolls off gold instead of clipping (dawn-polish).
      float cm=max(c.r,max(c.g,c.b));c*=cm>.7?(.7+(.8-.7)*(1.-exp(-(cm-.7)/.1)))/cm:1.;
      diffuseColor.rgb=c;
    }`,
    rough: 'roughnessFactor=mix(.95,.86,step(.5,vPlK)*step(vPlK,1.5));',
    normal: bump('adH', '1.'),
  });
  return m;
}

/** dawnCraft kinds (aCr.x). */
export const CR = {room: 0, lattice: 1, door: 2, tile: 3, brass: 4, clay: 5, glaze: 6, bark: 7, spice: 8, basket: 9, iron: 10} as const;

export function dawnCraft(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-craft', color: '#ffffff', roughness: .8, vertexColors: true});
  patch(m, 'goldsand-craft', {
    attrs: 'attribute vec3 aCr;\nattribute vec2 aCrUv;\n',
    vary: 'varying vec3 vCr;\nvarying vec2 vCrUv;\n',
    vBody: 'vCr=aCr;vCrUv=aCrUv;',
    head: /* glsl */ `float crRough=.8,crMetal=0.;vec3 crEm=vec3(0.);
      vec3 crRoom(vec2 uv,float glow,float seed){
        vec3 c=vec3(.03,.026,.028)*(1.+.4*fpNoise(uv*2.+seed));
        crEm=vec3(1.,.5,.2)*glow*(.25+.75*(1.-smoothstep(0.,1.3,uv.y)))*(.7+.3*fpNoise(uv*1.5+seed*3.));
        return c;}`,
    color: /* glsl */ `{
      float kind=vCr.x;vec2 uv=vCrUv;vec3 tint=diffuseColor.rgb;vec3 c=tint;float seed=vCr.z;
      float fine=fpNoise(uv*31.+seed)*.5+.5;
      if(kind<.5){c=crRoom(uv,vCr.y,seed);crRough=.95;}
      else if(kind<1.5){
        // Turned-wood lattice over a dark room.
        vec2 g=uv/.085,f=fract(g)-.5;float bar=max(abs(f.x),abs(f.y)),bead=length(f);
        float wood=max(smoothstep(.33,.37,bar),1.-smoothstep(.13,.17,bead));
        vec3 w=tint*(.75+.3*fpNoise(vec2(uv.x*40.,uv.y*3.)+seed))*(.8+.35*smoothstep(.4,.5,bar)*0.+.3*(1.-bead*2.));
        c=mix(crRoom(uv,vCr.y,seed),w,wood);crEm*=1.-wood;crRough=.82;}
      else if(kind<2.5){
        // Painted planks: seams, paint chipped to grey wood low and at the edges, iron straps and studs.
        float pw=.17,px=fract(uv.x/pw),seam=smoothstep(0.,.05,px)*smoothstep(1.,.95,px);
        vec3 wood=vec3(.42,.36,.3)*(.8+.3*fpNoise(vec2(uv.x*6.,uv.y*.6)+seed));
        float chip=smoothstep(.66,.7,fpFbm(uv*vec2(10.,3.5)+seed)*.5+.5+.18*(1.-smoothstep(0.,.35,uv.y)));
        c=mix(tint*(.88+.2*fpNoise(vec2(uv.x*3.,uv.y*25.))),wood,chip)*mix(.45,1.,seam);
        float strap=0.;for(int i=0;i<2;i++){float y=i==0?.4:1.75;strap=max(strap,1.-smoothstep(.03,.04,abs(uv.y-y)));}
        vec2 sd=vec2(fract(uv.x/pw)-.5,0.);float stud=0.;for(int i=0;i<3;i++){float y=.4+float(i)*.68;stud=max(stud,1.-smoothstep(.018,.026,length(vec2(sd.x*pw,uv.y-y))));}
        float iron=max(strap,stud);c=mix(c,vec3(.06,.055,.05)*(1.+fine*.5),iron);crRough=mix(.78,.45,iron);crMetal=iron*.6;}
      else if(kind<3.5){
        // Glazed tiles: turquoise diamonds on cobalt and cream, grout lines, a glaze sheen.
        vec2 g=uv/.11,f=fract(g)-.5,id=floor(g);float dmd=abs(f.x)+abs(f.y);
        vec3 tq=vec3(.04,.5,.48),cb=vec3(.05,.17,.42),cr=vec3(.86,.8,.66);
        c=mix(mod(id.x+id.y,2.)<.5?cr:cb,tq,1.-smoothstep(.3,.33,dmd));
        c=mix(c,vec3(.55,.5,.42),1.-smoothstep(.43,.46,max(abs(f.x),abs(f.y)))*1.);
        c*=.88+.2*fpNoise(id*.7+seed);crRough=.22;}
      else if(kind<4.5){c=vec3(.78,.58,.24)*(.85+.25*fine);c=mix(c,vec3(.25,.42,.33),smoothstep(.6,.8,fpNoise(uv*9.+seed)*.5+.5)*.5);crRough=.32;crMetal=.9;}
      else if(kind<5.5){
        // Terracotta: darker low, a lime crust at the rim, faint wheel bands.
        c=tint*(.85+.2*fine)*(.92+.08*sin(uv.y*55.));c*=mix(.62,1.,smoothstep(0.,.25,uv.y));
        c=mix(c,vec3(.8,.75,.66),smoothstep(.85,.97,fpNoise(uv*7.+seed)*.5+.5+uv.y*.15)*.6);crRough=.9;}
      else if(kind<6.5){
        // Glazed jar: glaze stops short of the foot in drips.
        float edge=.18+.06*fpNoise(vec2(uv.x*7.,seed));float gl=smoothstep(edge-.02,edge+.02,uv.y);
        c=mix(vec3(.62,.36,.22)*(.8+.3*fine),tint*(.85+.25*fpNoise(uv*4.+seed)),gl);crRough=mix(.85,.18,gl);}
      else if(kind<7.5){
        // Date palm bark: stubs of old leaf bases in rings, fibre between.
        float r=fract(uv.y/.17+fpNoise(vec2(uv.x*2.,uv.y))*.15);float scar=smoothstep(.0,.25,r)*smoothstep(1.,.7,r);
        c=mix(vec3(.24,.17,.11),vec3(.5,.39,.27),scar)*(.8+.35*fpNoise(vec2(uv.x*14.,uv.y*30.)+seed));
        c=mix(c,vec3(.55,.5,.44),.25*smoothstep(.3,.8,fpNoise(uv*.8+seed)));crRough=.97;}
      else if(kind<8.5){c=tint*(.78+.35*fpNoise(uv*60.+seed))*(.9+.1*fine);crRough=1.;}
      else if(kind<9.5){
        // Woven palm-leaf basket.
        vec2 g=uv*vec2(14.,18.);vec2 id=floor(g);float o=mod(id.x+id.y,2.);vec2 f=fract(g);
        float s=o<.5?sin(f.x*3.14):sin(f.y*3.14);c=tint*(.6+.45*s)*(.85+.2*fpHash12(id+seed));crRough=.9;}
      else{c=vec3(.07,.065,.06)*(1.+fine*.6);crRough=.55;crMetal=.5;}
      diffuseColor.rgb=c;
    }`,
    rough: 'roughnessFactor=crRough;',
    metal: 'metalnessFactor=crMetal;',
    emissive: 'totalEmissiveRadiance+=crEm;',
  });
  return m;
}

/** dawnCloth patterns (aCl.y): plain, striped, rug, carpet. */
export const CL = {plain: 0, stripe: 1, rug: 2, kilim: 3} as const;

export function dawnCloth(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-cloth', color: '#ffffff', roughness: .95, vertexColors: true, side: THREE.DoubleSide});
  const u = {clTime: {value: 0}};
  patch(m, 'goldsand-cloth', {
    attrs: 'attribute vec3 aCl;\nattribute vec2 aClUv;\nuniform float clTime;\n',
    vary: 'varying vec3 vCl;\nvarying vec2 vClUv;\n',
    vBegin: '{float ph=aCl.z*6.1+position.x*.35+position.z*.27;transformed+=vec3(.55,.25,.45)*aCl.x*(.09*sin(clTime*1.5+ph)+.035*sin(clTime*3.7+ph*1.9));}',
    vBody: 'vCl=aCl;vClUv=aClUv;',
    color: /* glsl */ `{
      vec2 uv=vClUv;float pat=vCl.y;vec3 tint=diffuseColor.rgb;
      // Weave and sun fading.
      float weave=.92+.08*sin(vAdW.x*190.+vAdW.z*170.)*sin(vAdW.y*210.);
      vec3 c=tint;
      if(pat>.5&&pat<1.5){float s=step(.5,fract(uv.x/.36));c=mix(tint,vec3(.9,.84,.72),s*.85);}
      else if(pat>2.5){
        // Kilim: bands across the rug, stepped zigzags in the wide ones, a plain selvedge.
        float y=uv.y*7.,band=floor(y),fy=fract(y);
        vec3 ind=vec3(.09,.12,.3),sf=vec3(.8,.55,.12),cr=vec3(.86,.78,.62);
        float k=mod(band,4.);
        c=k<1.?tint:k<2.?cr:k<3.?tint*.7:ind;
        float zz=abs(fract(uv.x*5.+(k<2.?.0:.5))-.5)*2.;zz=floor(zz*4.)/4.;
        c=mix(c,k<2.?sf:cr,step(abs(fy-.5)*2.,zz*.7)*step(.5,mod(band,2.)));
        c=mix(c,ind,1.-smoothstep(.04,.05,min(uv.x,1.-uv.x)));
        c*=.9+.1*fpNoise(uv*30.);
      }
      else if(pat>1.5){
        // Rug: field, guard stripes and a border, a stepped diamond medallion. uv is 0..1 across the rug.
        vec2 d=min(uv,1.-uv);float e=min(d.x,d.y);
        vec3 ind=vec3(.09,.12,.3),sf=vec3(.8,.55,.12),cr=vec3(.86,.78,.62);
        float med=abs(uv.x-.5)*1.4+abs(uv.y-.5);
        c=tint;
        c=mix(c,ind,1.-smoothstep(.27,.29,med));c=mix(c,sf,1.-smoothstep(.17,.19,med));c=mix(c,cr,1.-smoothstep(.07,.09,med));
        c=mix(c,ind,1.-smoothstep(.13,.135,e));
        c=mix(c,sf*.95,(1.-smoothstep(.095,.1,e))*smoothstep(.06,.065,e));
        c=mix(c,cr,1.-smoothstep(.035,.04,e));
        float tooth=step(.5,fract((uv.x+uv.y)*14.));c=mix(c,mix(cr,ind,tooth),(1.-smoothstep(.1,.105,e))*smoothstep(.065,.07,e)*.0);
        c*=.9+.1*fpNoise(uv*30.);
      }
      c*=weave*(.9+.12*(fpNoise(vAdW.xz*1.3+vAdW.y)*.5+.5));
      // Sun-bleached on top.
      c=mix(c,c*.6+vec3(.33,.3,.25),.18*smoothstep(.2,1.,normalize(vAdN).y)*step(pat,1.5));
      if(!gl_FrontFacing)c*=.82;
      diffuseColor.rgb=c;
    }`,
  });
  m.userData.time = u.clTime;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => { prev.call(m, s, r); Object.assign(s.uniforms, u); };
  return m;
}

const V = THREE.Vector3;
const Y = new V(0, 1, 0);

/**
 * Triangle soup with per-vertex colour, a vec2 and a vec3 attribute and a float: the four materials name them.
 * `aux` fills the vec3 (for walls: height over the ground, depth under the parapet top, occlusion).
 */
export class Acc {
  P: number[] = []; N: number[] = []; C: number[] = []; T: number[] = []; A: number[] = []; K: number[] = [];
  col = new THREE.Color(1, 1, 1);
  /** Walls: ground and parapet-top heights for aux. */
  gy = 0; top = 0; ao = 1; k = 0;
  /** Non-wall uses: aux vector written as is. */
  a3: [number, number, number] | null = null;
  /**
   * When set, every vertex takes this uv whatever the caller passes. The walls lock it far (9, 9) and unlock it only
   * where face() and block() write the distances along the wall to its two ends (corner wear in dawnPlaster).
   */
  uvLock: [number, number] | null = null;
  /** Placement applied to everything emitted (a turned block), with its normal matrix; null for none. */
  xf: THREE.Matrix4 | null = null; nm = new THREE.Matrix3();
  constructor(readonly names: {uv: string; aux: string; k?: string}) {}
  vert(p: THREE.Vector3, n: THREE.Vector3, u = 0, v = 0, ao = this.ao) {
    if (this.xf) { p = _xp.copy(p).applyMatrix4(this.xf); n = _xn.copy(n).applyMatrix3(this.nm).normalize(); }
    if (this.uvLock) { u = this.uvLock[0]; v = this.uvLock[1]; }
    this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.C.push(this.col.r, this.col.g, this.col.b); this.T.push(u, v);
    if (this.a3) this.A.push(this.a3[0], this.a3[1], this.a3[2]); else this.A.push(p.y - this.gy, this.top - p.y, ao);
    this.K.push(this.k);
  }
  /** Quad a-b-c-d; flipped if its winding disagrees with `want`. uvs per corner, ao per corner. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, want?: THREE.Vector3, uv?: number[], ao?: number[]) {
    const n = _n.subVectors(b, a).cross(_m.subVectors(d, a));
    if (n.lengthSq() < 1e-12) n.subVectors(c, a).cross(_m.subVectors(d, b));
    n.normalize();
    const U = uv ?? [0, 0, 0, 0, 0, 0, 0, 0], O = ao ?? [this.ao, this.ao, this.ao, this.ao];
    if (want && n.dot(want) < 0) {
      n.negate();
      this.vert(a, n, U[0], U[1], O[0]); this.vert(c, n, U[4], U[5], O[2]); this.vert(b, n, U[2], U[3], O[1]);
      this.vert(a, n, U[0], U[1], O[0]); this.vert(d, n, U[6], U[7], O[3]); this.vert(c, n, U[4], U[5], O[2]);
      return;
    }
    this.vert(a, n, U[0], U[1], O[0]); this.vert(b, n, U[2], U[3], O[1]); this.vert(c, n, U[4], U[5], O[2]);
    this.vert(a, n, U[0], U[1], O[0]); this.vert(c, n, U[4], U[5], O[2]); this.vert(d, n, U[6], U[7], O[3]);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, want?: THREE.Vector3, uv?: number[]) {
    const n = _n.subVectors(b, a).cross(_m.subVectors(c, a)).normalize(), U = uv ?? [0, 0, 0, 0, 0, 0];
    if (want && n.dot(want) < 0) { n.negate(); this.vert(a, n, U[0], U[1]); this.vert(c, n, U[4], U[5]); this.vert(b, n, U[2], U[3]); return; }
    this.vert(a, n, U[0], U[1]); this.vert(b, n, U[2], U[3]); this.vert(c, n, U[4], U[5]);
  }
  /** Append a geometry placed by m (its own normals and uvs kept; uv scaled to metres by uvScale). */
  geo(g: THREE.BufferGeometry, m: THREE.Matrix4, uvScale = 1) {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute('position'), n = src.getAttribute('normal'), t = src.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      const P = _a.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(m), N = _b.fromBufferAttribute(n as THREE.BufferAttribute, i).applyMatrix3(nm).normalize();
      this.vert(P, N, t ? t.getX(i) * uvScale : 0, t ? t.getY(i) * uvScale : 0);
    }
    if (src !== g) src.dispose();
  }
  get count() { return this.P.length / 3; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute(this.names.uv, new THREE.Float32BufferAttribute(this.T, 2));
    g.setAttribute(this.names.aux, new THREE.Float32BufferAttribute(this.A, 3));
    if (this.names.k) g.setAttribute(this.names.k, new THREE.Float32BufferAttribute(this.K, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const _n = new V(), _m = new V(), _a = new V(), _b = new V(), _xp = new V(), _xn = new V();

/** An opening in a face, in metres: u along the face, v over the ground at the face. */
export interface Hole {
  u0: number; u1: number; v0: number; v1: number; arch?: boolean; depth: number;
  /** Craft kind of the back panel and its glow, colour (doors, lattice wood). */
  kind: number; glow?: number; color?: THREE.ColorRepresentation;
  /** Spandrels of an arch in glazed tile (the shrine's door). */
  tiled?: boolean;
}

/** A face of a block: bottom-left origin at the block's base, along-face U, outward N (horizontal). */
export interface Face { O: THREE.Vector3; U: THREE.Vector3; N: THREE.Vector3; L: number; H: number; bat: number; ground: number; /** Its ends are a block's corners (wear there). */ ends?: boolean }

/** Point on a face: u along, v over the ground (battered inward with height). */
export function facePoint(f: Face, u: number, v: number, out = new V()): THREE.Vector3 {
  const vv = v + f.ground;
  return out.copy(f.O).addScaledVector(f.U, u).addScaledVector(Y, vv).addScaledVector(f.N, -f.bat * vv / f.H);
}

/** Emit a face cut by holes: wall rectangles, arch spandrels, reveals (walls) and back panels (craft). */
export function face(wall: Acc, craft: Acc, f: Face, holes: Hole[]) {
  const nf = new V().copy(f.N).multiplyScalar(f.H).addScaledVector(Y, f.bat).normalize();
  const vMin = -f.ground, vMax = f.H - f.ground;
  // Wall rectangles between the holes.
  const ys = [...new Set([vMin, vMax, ...holes.flatMap(h => [h.v0, h.v1])])].filter(y => y >= vMin && y <= vMax).sort((a, b) => a - b);
  const p = [new V(), new V(), new V(), new V()];
  for (let i = 1; i < ys.length; i++) {
    const ya = ys[i - 1], yb = ys[i];
    if (yb - ya < 1e-4) continue;
    const block = holes.filter(h => h.v0 <= ya + 1e-4 && h.v1 >= yb - 1e-4).sort((a, b) => a.u0 - b.u0);
    let u = 0;
    for (const h of [...block, {u0: f.L, u1: f.L}]) {
      // uv: metres to each end of the wall, the corners (both interpolate exactly; their min peaks mid-wall).
      const lock = wall.uvLock, e0 = f.ends ? 0 : 9;
      wall.uvLock = null;
      if (h.u0 - u > 1e-4) wall.quad(facePoint(f, u, ya, p[0]), facePoint(f, h.u0, ya, p[1]), facePoint(f, h.u0, yb, p[2]), facePoint(f, u, yb, p[3]), nf, [u + e0, f.L - u + e0, h.u0 + e0, f.L - h.u0 + e0, h.u0 + e0, f.L - h.u0 + e0, u + e0, f.L - u + e0]);
      wall.uvLock = lock;
      u = Math.max(u, h.u1);
    }
  }
  for (const h of holes) hole(wall, craft, f, h, nf);
}

const ARCH_SEG = 8;
function hole(wall: Acc, craft: Acc, f: Face, h: Hole, nf: THREE.Vector3) {
  const w = h.u1 - h.u0, rr = w / 2, uc = (h.u0 + h.u1) / 2, vs = h.arch ? h.v1 - rr : h.v1;
  // Outline (u, v) round the hole.
  const pts: [number, number][] = [[h.u0, h.v0], [h.u1, h.v0], [h.u1, vs]];
  if (h.arch) for (let i = 1; i < ARCH_SEG; i++) { const t = i / ARCH_SEG * Math.PI; pts.push([uc + rr * Math.cos(t), vs + rr * Math.sin(t)]); }
  pts.push([h.u0, vs]);
  // Spandrels: the face between the arch and the hole's rectangle.
  if (h.arch) {
    const sp = h.tiled ? craft : wall, prevA3 = craft.a3, prevCol = craft.col.clone();
    if (h.tiled) { craft.a3 = [CR.tile, 0, 1]; craft.col.set('#ffffff'); }
    for (const [cu, from, to] of [[h.u0, Math.PI, Math.PI / 2], [h.u1, Math.PI / 2, 0]] as const) {
      const C = facePoint(f, cu, h.v1), n = ARCH_SEG / 2;
      for (let i = 0; i < n; i++) {
        const t0 = from + (to - from) * i / n, t1 = from + (to - from) * (i + 1) / n;
        const u0 = uc + rr * Math.cos(t0), v0 = vs + rr * Math.sin(t0), u1 = uc + rr * Math.cos(t1), v1 = vs + rr * Math.sin(t1);
        sp.tri(C, facePoint(f, u0, v0), facePoint(f, u1, v1), nf, [cu - h.u0, h.v1 - h.v0, u0 - h.u0, v0 - h.v0, u1 - h.u0, v1 - h.v0]);
      }
    }
    craft.a3 = prevA3; craft.col.copy(prevCol);
  }
  // Reveals: from the face back to the panel, darker inside.
  const D = new V().copy(f.N).multiplyScalar(-h.depth), cen = facePoint(f, uc, (h.v0 + vs) / 2);
  const back = (q: THREE.Vector3) => q.clone().add(D);
  for (let i = 0; i < pts.length; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
    const a = facePoint(f, u0, v0), b = facePoint(f, u1, v1), want = new V().copy(cen).sub(_a.copy(a).lerp(b, .5));
    want.addScaledVector(f.N, -want.dot(f.N));
    // Deep reveals: the sky reaches only the outer lip; a room's reveal is dark at the back.
    const deep = h.kind === CR.room ? (h.depth > 1.5 ? .06 : h.depth > .6 ? .15 : .24) : .36;
    const front = h.depth > 1.5 ? .5 : h.depth > .6 ? .7 : .86;
    wall.quad(a, b, back(b), back(a), want, undefined, [front, front, deep, deep]);
  }
  // Back panel: the room, the door leaf or the screen.
  const prevA3 = craft.a3, prevCol = craft.col.clone();
  craft.a3 = [h.kind, h.glow ?? 0, (uc * 7.3 + h.v0 * 3.1) % 17];
  craft.col.set(h.color ?? '#ffffff');
  const C = back(cen), cuv = [uc - h.u0, (h.v0 + vs) / 2 - h.v0];
  for (let i = 0; i < pts.length; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
    craft.tri(C, back(facePoint(f, u0, v0)), back(facePoint(f, u1, v1)), f.N, [cuv[0], cuv[1], u0 - h.u0, v0 - h.v0, u1 - h.u0, v1 - h.v0]);
  }
  craft.a3 = prevA3; craft.col.copy(prevCol);
}

/** Rounded-rectangle ring (corner arcs of `seg` segments), starting at the +z face's east end, clockwise from above. */
export function ring(cx: number, cz: number, hx: number, hz: number, rad: number, y: number, seg = 4): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const cs: [number, number, number][] = [[1, 1, 0], [1, -1, Math.PI / 2], [-1, -1, Math.PI], [-1, 1, Math.PI * 1.5]];
  for (const [sx, sz, a0] of cs) {
    const ox = cx + sx * (hx - rad), oz = cz + sz * (hz - rad);
    for (let i = 0; i <= seg; i++) { const a = a0 + Math.PI / 2 * i / seg; out.push(new V(ox + Math.sin(a) * rad, y, oz + Math.cos(a) * rad)); }
  }
  return out;
}

/** Strip between two rings of equal length (closed), facing `outward` (+1) or inward (-1) from the centre. */
export function strip(acc: Acc, lo: THREE.Vector3[], hi: THREE.Vector3[], cx: number, cz: number, outward: 1 | -1, aoLo?: number, aoHi?: number) {
  for (let i = 0; i < lo.length; i++) {
    const j = (i + 1) % lo.length, a = lo[i], b = lo[j], c = hi[j], d = hi[i];
    const want = _b.set((a.x + b.x) / 2 - cx, 0, (a.z + b.z) / 2 - cz).multiplyScalar(outward);
    if (a.distanceToSquared(b) < 1e-10 && d.distanceToSquared(c) < 1e-10) continue;
    acc.quad(a, b, c, d, want.lengthSq() > 1e-8 ? want.clone() : undefined, undefined, aoLo !== undefined ? [aoLo, aoLo, aoHi!, aoHi!] : undefined);
  }
}

/** A block's frame: four faces (N, U, origin, length) of a battered round-cornered box. */
export interface BlockFrame { faces: Record<'x+' | 'x-' | 'z+' | 'z-', Face>; cx: number; cz: number; hw: number; hd: number; base: number; ground: number; top: number; roof: number; bat: number; r: number; rb: number }

/**
 * Battered, round-cornered block from `base` (below the ground) to the parapet top; a capped parapet `para` high
 * round a roof slab at `roof`. `holes` per face. `cap` false leaves the top open (a tower continues it). Returns the
 * frame for placing details.
 */
export function block(wall: Acc, craft: Acc, o: {cx: number; cz: number; w: number; d: number; base: number; ground: number; roof: number; para: number; batter?: number; r?: number; holes?: Partial<Record<'x+' | 'x-' | 'z+' | 'z-', Hole[]>>; cap?: boolean; soffit?: boolean; thick?: number}): BlockFrame {
  const {cx, cz, base, ground} = o, hw = o.w / 2, hd = o.d / 2, top = o.roof + o.para;
  const Hf = top - .08 - base, bat = Math.min(.32, (o.batter ?? .022) * (top - ground)), r = o.r ?? .3, rb = r + bat;
  wall.gy = ground; wall.top = top;
  const g = ground - base;
  const faces = {
    'z+': {O: new V(cx - (hw - rb), base, cz + hd), U: new V(1, 0, 0), N: new V(0, 0, 1), L: 2 * (hw - rb), H: Hf, bat, ground: g, ends: true},
    'x+': {O: new V(cx + hw, base, cz + (hd - rb)), U: new V(0, 0, -1), N: new V(1, 0, 0), L: 2 * (hd - rb), H: Hf, bat, ground: g, ends: true},
    'z-': {O: new V(cx + (hw - rb), base, cz - hd), U: new V(-1, 0, 0), N: new V(0, 0, -1), L: 2 * (hw - rb), H: Hf, bat, ground: g, ends: true},
    'x-': {O: new V(cx - hw, base, cz - (hd - rb)), U: new V(0, 0, 1), N: new V(-1, 0, 0), L: 2 * (hd - rb), H: Hf, bat, ground: g, ends: true},
  };
  for (const k of ['z+', 'x+', 'z-', 'x-'] as const) face(wall, craft, faces[k], o.holes?.[k] ?? []);
  // Corners: ruled strips from the bottom radius to the top one.
  const lo = ring(cx, cz, hw, hd, rb, base), hi = ring(cx, cz, hw - bat, hd - bat, r, top - .08);
  const lock = wall.uvLock;wall.uvLock = [0, 0];
  for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
    const a = lo[c * 5 + i], b = lo[c * 5 + i + 1], cc = hi[c * 5 + i + 1], d = hi[c * 5 + i];
    wall.quad(a, b, cc, d, _b.set((a.x + b.x) / 2 - cx, 0, (a.z + b.z) / 2 - cz).clone());
  }
  wall.uvLock = lock;
  if (o.cap !== false) {
    // Parapet cap with rounded arrises, the inner face, and the roof slab.
    const t = o.thick ?? .3, hx = hw - bat, hz = hd - bat;
    const rings = [
      hi,
      ring(cx, cz, hx - .05, hz - .05, Math.max(.05, r - .05), top - .015),
      ring(cx, cz, hx - .13, hz - .13, Math.max(.05, r - .13), top),
      ring(cx, cz, hx - t + .13, hz - t + .13, Math.max(.05, r - t + .13), top),
      ring(cx, cz, hx - t + .05, hz - t + .05, Math.max(.05, r - t + .05), top - .015),
      ring(cx, cz, hx - t, hz - t, Math.max(.05, r - t), top - .08),
      ring(cx, cz, hx - t, hz - t, Math.max(.05, r - t), o.roof),
    ];
    for (let i = 1; i < rings.length; i++) {
      // Up-facing cap rings; the last two face inward.
      if (i < 5) {
        for (let k = 0; k < rings[i].length; k++) {
          const j = (k + 1) % rings[i].length, a = rings[i - 1][k], b = rings[i - 1][j], c = rings[i][j], d = rings[i][k];
          if (a.distanceToSquared(b) < 1e-10 && c.distanceToSquared(d) < 1e-10) continue;
          wall.quad(a, b, c, d, Y);
        }
      } else strip(wall, rings[i - 1], rings[i], cx, cz, -1, i === 6 ? .9 : 1, i === 6 ? .62 : .9);
    }
    // Roof slab (a fan: the ring is convex).
    const slab = rings[6], C = new V(cx, o.roof, cz);
    for (let k = 0; k < slab.length; k++) wall.tri(C, slab[k], slab[(k + 1) % slab.length], Y);
  }
  if (o.soffit) {
    const s = lo, C = new V(cx, base, cz);
    for (let k = 0; k < s.length; k++) wall.tri(C, s[k], s[(k + 1) % s.length], new V(0, -1, 0));
  }
  return {faces, cx, cz, hw, hd, base, ground, top, roof: o.roof, bat, r, rb};
}

/** Box into an Acc (walls: plaster mouldings, steps, benches), axis aligned after yaw about Y. */
export function box(acc: Acc, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, faces = 63) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (x: number, y: number, z: number) => new V(cx + x * c + z * s, cy + y, cz - x * s + z * c);
  const X = sx / 2, H = sy / 2, Z = sz / 2;
  const q = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3, w: THREE.Vector3) => acc.quad(a, b, cc, d, w);
  if (faces & 1) q(P(-X, -H, Z), P(X, -H, Z), P(X, H, Z), P(-X, H, Z), new V(s, 0, c));
  if (faces & 2) q(P(X, -H, -Z), P(-X, -H, -Z), P(-X, H, -Z), P(X, H, -Z), new V(-s, 0, -c));
  if (faces & 4) q(P(X, -H, Z), P(X, -H, -Z), P(X, H, -Z), P(X, H, Z), new V(c, 0, -s));
  if (faces & 8) q(P(-X, -H, -Z), P(-X, -H, Z), P(-X, H, Z), P(-X, H, -Z), new V(-c, 0, s));
  if (faces & 16) q(P(-X, H, Z), P(X, H, Z), P(X, H, -Z), P(-X, H, -Z), Y);
  if (faces & 32) q(P(-X, -H, -Z), P(X, -H, -Z), P(X, -H, Z), P(-X, -H, Z), new V(0, -1, 0));
}

/** Matrix placing local x along U, y up, z along N at p. */
export function frame(p: THREE.Vector3, U: THREE.Vector3, N: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(U, Y, N).setPosition(p);
}
