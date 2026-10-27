import * as THREE from 'three';
import {FROST_NOISE} from './frostPaving';
import {DAWN_FIRE,DAWN_FIRE_HEAD,DAWN_FIRE_LIGHT} from './dawnFire';
import {CITADEL_ARENA,CITADEL_GATE,CITADEL_WALL} from './dawnCitadelLayout';
import {DAWN_BOUNCE} from './dawnPaving';

/*
 * Solarkan's sun-dial floor and the temple court round it. The floor is the old sun temple's dial: honey limestone
 * laid in concentric courses, three bands of polished black basalt let into it (minutes, the sun-and-moon hours, a
 * running flame scroll), twelve gilded hour lines between them, and at the centre a gold sun of sixteen rays with
 * the basalt moon of the stolen dawn sliding across it, only a crescent of gold left burning. Everything is drawn
 * in one shader on the boss platform's top (the `dawn-boss-platform` mesh keeps its name and size), carved: the
 * joints and band edges are cut in, their chamfers catch the low sun, gold is worn back to bronze where feet go,
 * and the boss's fire has left soot scorched across the stone. The court outside the curb is laid in the same
 * courses, dustier, with sand blown into the joints and drifted against the walls.
 */

const HEAD = /* glsl */ `
${FROST_NOISE}
uniform vec3 daCenter;
uniform float daTime;
uniform float daDetail;
uniform float daCourt;
uniform vec3 daBounce;
float daSandy;
varying vec3 vDaW;
float daGilt;float daBas;float daPolish;float daH;float daGlow;float daWorn;
float daBand(float r,float a,float b,float aa){return smoothstep(a-aa,a+aa,r)*(1.-smoothstep(b-aa,b+aa,r));}
float daSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
// A small sun (disc and eight rays) or a crescent moon, in glyph units (-1..1).
float daSun(vec2 q){float r=length(q),a=atan(q.y,q.x);float d=r-.34;float ray=abs(fract(a/6.2831853*8.+.5)-.5)/8.*6.2831853*r;
 float rays=max(max(ray-.06*(1.-r),.48-r),r-.92);return min(abs(d)-.07,rays)<0.?1.:0.;}
float daSunD(vec2 q){float r=length(q),a=atan(q.y,q.x);float ray=abs(fract(a/6.2831853*8.+.5)-.5)/8.*6.2831853*r;
 return min(abs(r-.34)-.08,max(max(ray-.07*(1.15-r),.5-r),r-.92));}
float daMoonD(vec2 q){return max(length(q)-.62,-(length(q-vec2(.28,.18))-.52));}
`;

/** Carved dial: sets diffuse, daGilt (gold), daBas (polished basalt), daH (height, for the normal), daGlow. */
const DIAL = /* glsl */ `
vec2 dP=vDaW.xz-daCenter.xz;
float dR=length(dP),dAng=atan(dP.x,dP.y);
float dFoot=max(length(fwidth(vDaW.xz)),1e-4);
float dAA=dFoot*.75;
float dNear=1.-smoothstep(.015,.06,dFoot);
daGilt=0.;daBas=0.;daH=0.;daGlow=0.;daPolish=0.;daWorn=.5;
vec3 dCol;
// ---- Limestone courses: rings 1.5 m wide, flags ~1.8 m long, every ring staggered, every flag its own.
float dR0=daCourt>.5?${CITADEL_ARENA.curb.toFixed(2)}:4.5,dCw=daCourt>.5?1.9:1.5;
float dRi=floor((dR-dR0)/dCw),dFr=fract((dR-dR0)/dCw);
float dRc=dR0+(dRi+.5)*dCw,dN=max(6.,floor(6.2831853*dRc/(daCourt>.5?2.3:1.8)));
float dU=(dAng/6.2831853+.5+fpHash12(vec2(dRi,3.1)))*dN,dFi=floor(dU),dFx=fract(dU);
float dJu=min(dFx,1.-dFx)*6.2831853*dRc/dN,dJr=min(dFr,1.-dFr)*dCw;
float dJw=.012+.01*fpNoise(vDaW.xz*3.)+daCourt*.015;
float dJoint=1.-smoothstep(dJw,dJw+dAA+.012,min(dJu,dJr));
float dH1=fpHash12(vec2(dFi,dRi*1.7+5.)),dH2=fpHash12(vec2(dRi*3.3,dFi*.71+2.));
vec3 dLime=vec3(.42,.335,.23)*(.84+.3*dH1)*(dH2<.15?vec3(1.04,.92,.9):dH2>.88?vec3(.94,.97,1.02):vec3(1.));
// The court: every third ring basalt, the flags dustier.
float dCourtBas=daCourt>.5&&mod(dRi,3.)==1.?1.:0.;
dCol=mix(dLime,vec3(.055,.05,.047)*(.85+.3*dH1),dCourtBas);
daBas=dCourtBas*.5;
// Wear on the flags: broad stain, fine grain, a chamfer at every joint (lit edge, dark cut).
dCol*=.84+.24*(fpNoise(vDaW.xz*.35+1.)*.5+.5);
if(dNear>0.)dCol*=mix(1.,.86+.26*(fpNoise(vDaW.xz*9.)*.5+.5),dNear);
float dEdge=smoothstep(dJw+.09,dJw,min(dJu,dJr));
daH-=dJoint*.6+dEdge*.25;
// Cracked flags here and there: a jagged hairline across.
if(daDetail>.5&&fpHash12(vec2(dFi*1.3,dRi+9.))>.86){
 vec2 cl=vec2(dFx*6.2831853*dRc/dN,dFr*dCw);float cc=abs(cl.y-dCw*.5-(fpNoise(cl*2.3+dFi)*.35+(cl.x-1.)*.25));
 dJoint=max(dJoint,(1.-smoothstep(.005,.005+dAA+.008,cc))*.8);
}
if(daCourt<.5){
 // ---- The dial proper; the medallion inside 4.45 m is one inlaid piece, no joints.
 if(dR<4.45){daH=0.;dJoint=0.;}
 // Centre: the gold sun, the basalt moon across it, rays on a basalt ground.
 float sunD=dR-1.7,moonD=length(dP-vec2(.52,-.36))-1.5;
 float inSun=1.-smoothstep(-dAA,dAA,sunD),inMoon=1.-smoothstep(-dAA,dAA,moonD);
 float rayU=fract(dAng/6.2831853*16.+.5)-.5,rayK=mod(floor(dAng/6.2831853*16.+.5),2.);
 float rayT=clamp((dR-1.75)/2.5,0.,1.);
 float wav=rayK*sin(dR*5.4)*.12*(1.-rayT);
 float rayW=(rayK>.5?.42:.56)*(1.-rayT)+.03;
 float rayD=(abs(rayU-wav)-rayW*.5)*6.2831853/16.*dR;
 float inRay=(1.-smoothstep(-dAA,dAA,rayD))*daBand(dR,1.75,4.3-rayK*.4,dAA);
 float inDisc=daBand(dR,1.7,4.38,dAA);
 float ring1=daBand(dR,4.38,4.52,dAA);
 // Band 1, minutes: 48 ticks, every fourth long.
 float b1=daBand(dR,5.55,6.55,dAA),tk=fract(dAng/6.2831853*48.+.5)-.5,tL=mod(floor(dAng/6.2831853*48.+.5),4.)==0.?.36:.18;
 float tick=(1.-smoothstep(.05,.05+dAA,abs(tk)*6.2831853*6.05/48.))*(1.-smoothstep(tL-dAA,tL+dAA,abs(dR-6.05)));
 // Band 2: the hours, sun and moon in turn; at the keep (north) the eclipse.
 float b2=daBand(dR,12.4,13.6,dAA),hu=dAng/6.2831853*24.+.5,hi=floor(hu),hx=fract(hu)-.5;
 vec2 gq=vec2(hx*6.2831853*13./24.,dR-13.)/.5;
 float gD=mod(hi,2.)==0.?daSunD(gq):daMoonD(gq);
 if(abs(abs(dAng)-3.14159)<.14)gD=max(abs(length(gq)-.62)-.08,-(length(gq-vec2(.18,.08))-.58));
 float glyph=1.-smoothstep(-.02,.02+dAA/.5,gD);
 // Band 3: a running flame scroll between two gilt fillets.
 float b3=daBand(dR,19.25,20.45,dAA);
 float scroll=abs(dR-19.85-.3*sin(dAng*20.*3.)+.05*sin(dAng*20.*9.));
 float scr=1.-smoothstep(.07,.07+dAA,scroll);
 // Hour lines: twelve gilt rays across the limestone between the bands.
 float hl=fract(dAng/6.2831853*12.+.5)-.5,hlD=abs(hl)*6.2831853*dR/12.;
 float hourL=(1.-smoothstep(.06,.06+dAA,hlD))*(daBand(dR,6.75,12.2,dAA)+daBand(dR,13.8,19.05,dAA));
 // Fillets: thin gold strips on every band edge.
 float fil=0.;
 for(int i=0;i<6;i++){float e=i==0?5.55:i==1?6.55:i==2?12.4:i==3?13.6:i==4?19.25:20.45;fil=max(fil,1.-smoothstep(.05,.05+dAA,abs(dR-e)));}
 float basalt=max(max(inDisc,b1),max(b2,b3));
 vec3 bas=vec3(.042,.039,.037)*(.85+.3*(fpNoise(vDaW.xz*1.7)*.5+.5));
 dCol=mix(dCol,bas,basalt);daBas=basalt;
 // Band edges cut in: a V-groove each side of every basalt band.
 float bE=0.;for(int i=0;i<6;i++){float e=i==0?5.55:i==1?6.55:i==2?12.4:i==3?13.6:i==4?19.25:20.45;bE=max(bE,1.-smoothstep(.0,.09,abs(abs(dR-e)-.07)));}
 daH-=bE*.5+basalt*.15;
 dJoint*=1.-basalt;
 float gold=max(max(max(inSun*(1.-inMoon),inRay*(1.-inSun)),ring1),max(max(tick*b1,glyph*b2),max(max(scr*b3,hourL),fil)));
 daGilt=gold;
 daPolish=exp(-pow((dR-10.)/5.,2.))*.6;
 if(gold>0.)daWorn=smoothstep(.3,.75,fpNoise(vDaW.xz*1.9+11.)*.5+.5+fpNoise(vDaW.xz*7.)*.2*dNear-daPolish);
 dCol=mix(dCol,mix(vec3(.86,.46,.09),vec3(.33,.18,.05),daWorn*.7),daGilt);
 // The moon over the sun: polished basalt, a thin burning rim (the corona) round it.
 dCol=mix(dCol,vec3(.025,.022,.022),inMoon*(1.-smoothstep(1.9,2.,dR)));
 daBas=max(daBas,inMoon);
 float cor=exp(-max(moonD,0.)*9.)*(1.-inMoon)*(1.-smoothstep(1.6,2.6,dR));
 daGlow=cor*(.8+.2*sin(daTime*1.3))+inSun*(1.-inMoon)*.35;
}else{
 // Sand blown into the court: in the joints, drifted against the walls and in the corners.
 vec2 w=vDaW.xz;
 float dWall=min(${(CITADEL_WALL.side - CITADEL_WALL.thick).toFixed(2)}-abs(w.x),min(w.y-(${(CITADEL_WALL.back + CITADEL_WALL.thick).toFixed(2)}),${(CITADEL_WALL.south - 1).toFixed(2)}-w.y));
 float sand=smoothstep(.45,.85,fpNoise(w*.16+3.)*.5+.5+exp(-max(dWall,0.)/2.6)*.55+fpNoise(w*.9)*.12);
 dCol=mix(dCol,vec3(.47,.37,.25)*(.88+.2*(fpNoise(w*3.)*.5+.5)),sand*.85);
 dJoint*=1.-sand*.6;
 daH+=sand*.3;
 if(dR<${(CITADEL_ARENA.r + .02).toFixed(2)})discard;
}
dCol*=mix(1.,.3,dJoint);
daSandy=0.;
if(daCourt<.5){
 // Sand blown up onto the dial: banked against the curb in tongues reaching a few metres in, in the joints first.
 float tongue=fpNoise(vec2(dAng*3.2,1.7))*.6+fpNoise(dP*.35+4.)*.4+.25*sin(dAng+.6);
 float reach=1.2+3.4*smoothstep(-.3,.8,tongue);
 float edge=smoothstep(${CITADEL_ARENA.r.toFixed(1)}-reach,${CITADEL_ARENA.r.toFixed(1)}-.2,dR+fpNoise(dP*1.3)*.35);
 float lvl=edge*1.25+dJoint*.6*smoothstep(${(CITADEL_ARENA.r - 6).toFixed(1)},${CITADEL_ARENA.r.toFixed(1)},dR)-.35+fpNoise(dP*2.1)*.15;
 daSandy=smoothstep(.05,.35,lvl);
 vec3 sandC=vec3(.72,.54,.3)*(.9+.14*(fpNoise(dP*3.3)*.5+.5));
 sandC*=1.-.05*(sin(dot(dP,vec2(.8,.6))*9.+fpNoise(dP*.7)*5.)*.5+.5)*daSandy;
 dCol=mix(dCol,sandC,daSandy);
 daGilt*=1.-daSandy;daBas*=1.-daSandy;daGlow*=1.-daSandy;daH=mix(daH,.2,daSandy);
}
// Soot: the boss's fire scorched across the stone in bursts.
if(daDetail>.5&&daCourt<.5){
 // One noise field, thresholded into bursts and streaked radially from the centre (the fight's fire).
 float soot=smoothstep(.35,.85,fpNoise(vec2(dAng*2.6,dR*.18)+3.)*.6+fpNoise(dP*.22+9.)*.5)*(1.-smoothstep(16.,20.,dR));
 dCol*=1.-soot*.5;
}
diffuseColor.rgb*=dCol;
`;

/** The dial floor material on the boss platform; the court material for the paving outside the curb. */
function dialMaterial(name: string, court: boolean, uniforms: Record<string, THREE.IUniform>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .85, envMapIntensity: .6, ...(court ? {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2} : {})});
  m.name = name;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, DAWN_FIRE, {daCourt: {value: court ? 1 : 0}, daBounce: {value: DAWN_BOUNCE.clone().multiplyScalar(1.35)}});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDaW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvDaW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}\n${DAWN_FIRE_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${DIAL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float gWorn=daWorn;
        roughnessFactor=mix(mix(.86,.5,daBas),mix(.28,.55,gWorn),daGilt);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=daGilt*mix(.45,.25,gWorn);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.14)*daGlow*1.1+vec3(.36,.15,.02)*daGilt*(1.-gWorn*.7)*.6;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float h=daH*.012+fpNoise(vDaW.xz*.8)*.004;
          vec2 dpx=dFdx(vDaW.xz),dpy=dFdy(vDaW.xz);float dsx=dFdx(h),dsy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
          vec2 g=abs(det)>1e-12?clamp(vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det,-.5,.5):vec2(0.);
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          if(nW.y>.5){nW=normalize(nW+vec3(-g.x,0.,-g.y));normal=normalize((viewMatrix*vec4(nW,0.)).xyz);}
        }`)
      // Gold takes the warm sky, stone keeps a dull sheen (the low sun across a whole floor reads as plastic).
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(.45,1.,daGilt);
        // Golden bounce off the sunlit court walls and sand: the shade on the floor goes warm, not blue-grey.
        reflectedLight.indirectDiffuse+=diffuseColor.rgb*(1.-metalnessFactor)*daBounce*RECIPROCAL_PI;\n${DAWN_FIRE_LIGHT}`);
  };
  m.customProgramCacheKey = () => `dawn-dial-${court ? 'court' : 'floor'}`;
  return m;
}

export interface DawnArena {
  floor: THREE.MeshStandardMaterial;
  court: THREE.Mesh;
  update(time: number, quality: 'high' | 'low'): void;
}

/** The dial material (for the boss platform) and the court paving mesh, conformed to `height`. */
export function dawnArena(height: (x: number, z: number) => number): DawnArena {
  const uniforms = {daCenter: {value: new THREE.Vector3(CITADEL_ARENA.x, CITADEL_ARENA.y, CITADEL_ARENA.z)}, daTime: {value: 0}, daDetail: {value: 1}};
  const floor = dialMaterial('dawn-sundial-floor', false, uniforms);
  // The court: a grid over the walled ground and the gate passage, a few centimetres over the terrain, triangles
  // wholly inside the dial left out (the shader cuts the rest at its edge).
  const W = CITADEL_WALL, G = CITADEL_GATE, step = .75;
  const pos: number[] = [], idx: number[] = [];
  const grid = (x0: number, x1: number, z0: number, z1: number, keep = (_x: number, _z: number) => true) => {
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), base = pos.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz; pos.push(x, height(x, z) + .035, z); }
    const inside = (k: number) => Math.hypot(pos[(base + k) * 3] - CITADEL_ARENA.x, pos[(base + k) * 3 + 2] - CITADEL_ARENA.z) < CITADEL_ARENA.r - .6;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      if (inside(a) && inside(b) && inside(c) && inside(d)) continue;
      const mx = (pos[(base + a) * 3] + pos[(base + d) * 3]) / 2, mz = (pos[(base + a) * 3 + 2] + pos[(base + d) * 3 + 2]) / 2;
      if (!keep(mx, mz)) continue;
      idx.push(base + a, base + c, base + b, base + b, base + c, base + d);
    }
  };
  // The court runs from the back wall to the low south wall, and between the gate towers on to the gate's back.
  grid(-(W.side - W.thick) - .4, W.side - W.thick + .4, W.back + W.thick - .4, G.back, (x, z) => z < W.south - .9 || Math.abs(x) < G.half + 2.2);
  grid(-G.open - .3, G.open + .3, G.back - .2, G.front + 1.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const court = new THREE.Mesh(g, dialMaterial('dawn-temple-court', true, uniforms));
  court.name = 'dawn-temple-court'; court.receiveShadow = true;
  return {floor, court, update(time, quality) { uniforms.daTime.value = time; uniforms.daDetail.value = quality === 'high' ? 1 : 0; }};
}
