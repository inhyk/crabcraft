import * as THREE from 'three';
import {onIslandPath,type IslandPath} from './islandPaths';
import {pavingGround} from './pavingLayout';
import {SNOW_DEFORM_READ,type SnowDeform} from './snowDeform';

/*
 * Frostlight's streets: worn granite setts in random courses, half buried in snow. One mesh hugs the terrain under
 * the whole network and its shader lays the stones (rows of varying depth, stones of varying length, each a little
 * skew, with a rounded arris and a domed top: no grid, no tiling). Snow settles by height, so it fills the joints
 * first and the low stones next. Traffic keeps the middle bare: two cart ruts with black ice in them and a packed
 * crown down the main road, a beaten line down each street, a swept square where they cross; the sweepings bank
 * up at the sides and drifts cross the edges and bury the free ends. The low sun is shadowed by the stones it
 * skims (three taps along the light), and crabs print the road's snow from the snowfield's own deformation field.
 * Deep snow and the outer edge fade out so the snowfield itself shows, ripples and glints included, and the two
 * never meet at a seam. The kerbs lie under the banked snow, as they would.
 * Everything visible stays inside onIslandPath(), so prints, spray and covers() agree with what is drawn.
 * The snow glints follow snowSurface.ts's port of SNOWFLOW's grazing-angle glints (shading.wgsl, MIT, Copyright (c)
 * 2026 Maksymilian Dendura; see NOTICE.md), one octave.
 */

/** Tile edge, metres: each pixel loops only over the segments its tile lists (fpTileTex), at most TILE_K. */
const TILE = 3;
const TILE_K = 16;
/** Swept junctions and paved squares. */
const MAX_PLAZA = 24;
/** A segment joins a tile's list when its paved box comes this close: everything it shades lies within 1.5 m. */
const TILE_REACH = 2;
/** Grid step of the surface mesh, metres. */
const CELL = .5;
/** Above the rendered terrain, so the snowfield never pokes through. */
const LIFT = .03;
/** Visible paving ends this far past a path's edge: inside onIslandPath's trim margin (.3). */
const REACH = .27;

const fract = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** 0 clear, 1 a drift has crossed the edge and reaches well into the road. */
export function frostDrift(x: number, z: number): number {
  return smooth(.5, .74, vnoise(x * .15 + 3.1, z * .15 - 7.3) * .65 + vnoise(x * .41 - 1.7, z * .41 + 5.2) * .35);
}

interface Seg { ax: number; az: number; bx: number; bz: number; half: number; main: boolean; along0: number; seed: number; path: number; first: boolean; last: boolean }

/** Hash, gradient noise and fbm shared by Frostlight's ground shaders. */
export const FROST_NOISE = /* glsl */ `
vec2 fpHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float fpHash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float fpNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(fpHash22(i)*2.-1.,f),b=dot(fpHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(fpHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(fpHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float fpFbm(vec2 p){return fpNoise(p)*.55+fpNoise(p*2.03+7.1)*.3+fpNoise(p*4.11-3.7)*.15;}
`;

const PAVING_HEAD = /* glsl */ `
// Segments, three texels each: (ax, az, bx, bz), (half width, main, joins, buried ends) with each pair packed as
// start + 2 end, and (along, seed), which only the segments near the pixel need.
uniform sampler2D fpSegTex;
// One row per tile: the indices (plus one, 0 ends the list) of the segments that reach it, four per texel.
uniform sampler2D fpTileTex;
// Tile grid: origin x, z, 1 / tile size, tiles across; and tiles down.
uniform vec4 fpTileGrid;
uniform float fpTileRows;
#define FP_TILE_K ${TILE_K}
// Swept squares: where a street meets a main road (xz, swept radius, 0) and the paved squares (xz, swept, paved radius).
#define FP_MAX_PLAZA ${MAX_PLAZA}
uniform vec4 fpPlaza[FP_MAX_PLAZA];
uniform int fpPlazaCount;
float fpPick(vec4 v,int i){return i==0?v.x:i==1?v.y:i==2?v.z:v.w;}
uniform float fpDetail;
uniform vec3 fpSkyH;
uniform vec3 fpSkyZ;
uniform vec3 fpSun;
varying float vFpDrift;
varying vec3 vFpWorld;
${SNOW_DEFORM_READ}
${FROST_NOISE}
#define FP_RELIEF .03
float fpSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float fpEdgeAt(float k,float salt,float jit){return k+jit*(fpHash12(vec2(k,salt))-.5);}
// Random-course flags: rows of varying depth across the road, stones of varying length along each row, rounded
// corners. Signed distance to the stone's outline (m, negative inside), its id, offset from its centre, half
// size, and the outline's outward gradient.
float fpCourse(vec2 q,out float id,out vec2 local,out vec2 halfSz,out vec2 grad){
  const float RH=.31;
  float k=floor(q.y/RH),b0=fpEdgeAt(k,3.1,.4)*RH,b1=fpEdgeAt(k+1.,3.1,.4)*RH,row=k;
  if(q.y<b0){row=k-1.;b1=b0;b0=fpEdgeAt(k-1.,3.1,.4)*RH;}
  else if(q.y>=b1){row=k+1.;b0=b1;b1=fpEdgeAt(k+2.,3.1,.4)*RH;}
  float SL=mix(.3,.62,fpHash12(vec2(row,7.7))),off=fpHash12(vec2(row,1.3))*SL,xs=q.x-off,salt=row*1.618+.5;
  float j=floor(xs/SL),e0=fpEdgeAt(j,salt,.46)*SL,e1=fpEdgeAt(j+1.,salt,.46)*SL,col=j;
  if(xs<e0){col=j-1.;e1=e0;e0=fpEdgeAt(j-1.,salt,.46)*SL;}
  else if(xs>=e1){col=j+1.;e0=e1;e1=fpEdgeAt(j+2.,salt,.46)*SL;}
  id=fpHash12(vec2(col+row*57.31,row-col*.731));
  halfSz=vec2(e1-e0,b1-b0)*.5;
  local=vec2(xs-(e0+e1)*.5,q.y-(b0+b1)*.5);
  // Each stone sits a little skew and short of its neighbours, so no two joints run the same width.
  vec2 r=fpHash22(vec2(id*71.3,col-row)),r2=fpHash22(vec2(row*3.3+col,id*19.1));
  float a=(r.x-.5)*.08,ca=cos(a),sa=sin(a);
  local-=(r2-.5)*vec2(.018,.012);
  local=vec2(ca*local.x-sa*local.y,sa*local.x+ca*local.y);
  halfSz-=vec2(.003+.012*r.y,.003+.009*r2.x);
  float rc=mix(.03,.08,fract(id*7.31)),jw=.005+.007*fract(id*3.17);
  vec2 s=sign(local),dq=abs(local)-(halfSz-jw-rc),dp=max(dq,0.);
  float ol=length(dp);
  vec2 g=ol>0.?dp/ol*s:(dq.x>dq.y?vec2(s.x,0.):vec2(0.,s.y));
  grad=vec2(ca*g.x+sa*g.y,-sa*g.x+ca*g.y);
  return ol+min(max(dq.x,dq.y),0.)-rc;
}
// A worn cobble's height (stone units, 0 in the joint) from its outline distance: a short rounded arris, then a
// smooth elliptic crown (no crease along the stone's medial axis). Returns the arris slope and crown gradient.
float fpDome(float de,float id,vec2 l,vec2 h,out float slope,out vec2 crownG){
  const float R=.045;
  float x=clamp(de/R,0.,1.),e=1.-(1.-x)*(1.-x);
  vec2 tilt=(fpHash22(vec2(id*91.7,3.1))-.5)*.16,u=l/max(h,vec2(.05));
  float top=.84+.16*fract(id*5.3)+dot(l,tilt)-dot(u,u)*.3;
  slope=2.*(1.-x)/R*top;
  crownG=(tilt-.6*u/max(h,vec2(.05)))*e;
  return e*top;
}
// Stone height alone (no chipping), for the shadow taps.
float fpStoneAt(vec2 q){float id,sl;vec2 l,h,g,cg;float o=fpCourse(q,id,l,h,g);return fpDome(-o,id,l,h,sl,cg);}
`;

const PAVING_COLOR = /* glsl */ `
vec2 fpP=vFpWorld.xz;
// The pixel's footprint on the ground: its two screen axes, and their summed size (the long axis dominates).
vec2 fpDpx=dFdx(fpP),fpDpy=dFdy(fpP);
float fpFoot=length(abs(fpDpx)+abs(fpDpy));
// The network: a filleted union of the paths; two cart ruts with a packed crown between them down the main road,
// a beaten line down each street; how far a free end lies buried.
float fpSd=1e3,fpTrod=0.,fpRut=0.,fpWear=0.,fpEnd=0.;
ivec2 fpTc=clamp(ivec2(floor((fpP-fpTileGrid.xy)*fpTileGrid.z)),ivec2(0),ivec2(int(fpTileGrid.w)-1,int(fpTileRows)-1));
int fpTile=fpTc.y*int(fpTileGrid.w)+fpTc.x;
for(int k=0;k<FP_TILE_K;k++){
  int si=int(fpPick(texelFetch(fpTileTex,ivec2(k/4,fpTile),0),k-k/4*4))-1;
  if(si<0)break;
  vec4 s=texelFetch(fpSegTex,ivec2(0,si),0),info=texelFetch(fpSegTex,ivec2(1,si),0);
  // Joins (1 where the path runs on into its next segment) and buried free ends, start and end.
  vec2 jn=vec2(mod(info.z,2.),floor(info.z*.5)),ends=vec2(mod(info.w,2.),floor(info.w*.5));
  vec2 ab=s.zw-s.xy;float L=length(ab);vec2 dir=ab/L,ap=fpP-s.xy;
  float t=dot(ap,dir),across=dot(ap,vec2(dir.y,-dir.x));
  // The outline: square at a path's own ends, round past a joint where the next segment carries on, so a winding
  // path of short segments keeps its full depth inside (a union of boxes would not) and closes the outside of bends.
  float ovA=-t,ovB=t-L,ovJ=max(max(ovA*jn.x,ovB*jn.y),0.);
  vec2 bd=vec2(abs(across)-info.x,max(mix(ovA,-1e3,jn.x),mix(ovB,-1e3,jn.y)));
  fpSd=fpSmin(fpSd,ovJ>0.?length(vec2(ovJ,across))-info.x:length(max(bd,0.))+min(max(bd.x,bd.y),0.),.3);
  if(bd.x>1.5||max(ovA-jn.x*1.2,ovB-jn.y*1.2)>1.5)continue;
  vec2 as=texelFetch(fpSegTex,ivec2(2,si),0).xy;
  float along=t+as.x,inside=1.-smoothstep(-.3,.4,max(-t-jn.x*1.2,t-L-jn.y*1.2));
  float c=fpNoise(vec2(along*.045,as.y))*.9+fpNoise(vec2(along*.17,as.y+3.))*.16;
  if(info.y>.5){
    float x=across-c*.45,r=abs(abs(x)-.82)+fpNoise(vec2(along*.9,as.y))*.05;
    float rut=1.-smoothstep(.1,.3,r);
    fpRut=max(fpRut,rut*inside);
    float crown=(1.-smoothstep(.25,.55,abs(x)))*.5,verge=(1.-smoothstep(1.1,2.5,abs(x)))*.32;
    fpTrod=max(fpTrod,max(rut,max(crown,verge))*inside);
    fpWear=max(fpWear,(1.-smoothstep(1.5,2.7,abs(x)+fpNoise(vec2(along*.11,as.y+9.))*.7))*inside);
  }else{
    float x=across-c*.3;
    fpTrod=max(fpTrod,(1.-smoothstep(.25,1.05,abs(x)))*.82*inside);
    fpWear=max(fpWear,(1.-smoothstep(.8,1.6,abs(x)+fpNoise(vec2(along*.13,as.y+9.))*.45))*inside);
  }
  float tn=t+fpNoise(vec2(across*.8,as.y+5.))*.9+fpNoise(vec2(across*2.6,as.y))*.25;
  float buried=max(ends.x*smoothstep(2.4,-.3,tn),ends.y*smoothstep(L-2.4,L+.3,tn));
  fpEnd=max(fpEnd,buried*(1.-smoothstep(-.2,.4,bd.x)));
}
float fpN1=fpFbm(fpP*.3+1.7),fpN2=fpNoise(fpP*1.6+4.);
for(int i=0;i<FP_MAX_PLAZA;i++){if(i>=fpPlazaCount)break;vec4 q=fpPlaza[i];float d=length(fpP-q.xy);if(q.w>0.)fpSd=fpSmin(fpSd,d-q.w,.3);fpWear=max(fpWear,1.-smoothstep(q.z*.55,q.z,d+fpN1*1.4+fpN2*.3));}
// Snow level, same units: bare in the worn middle, banked white at the sides with a narrow ragged band between,
// here and there a shovelled clump on the stones, swept up against the kerbs, drifted in across the edges and over
// the free ends.
float fpS=1.5-fpWear*1.7+fpN1*.55+fpN2*.18;
fpS+=smoothstep(.62,.86,fpNoise(fpP*.55+11.)*.5+.5+fpN2*.06)*1.6;
fpS-=fpTrod*(.45+fpN2*.25);
fpS+=smoothstep(-1.3,-.05,fpSd)*.45;
// The last hand's width under the kerb is always snow, so the surface never fades out over bare stone.
float fpLip=smoothstep(-.42+fpN2*.12,.06,fpSd)*1.9;
fpS+=fpLip;
fpS+=smoothstep(.25,1.,vFpDrift)*smoothstep(-3.6-fpN1*1.5,-.2,fpSd)*2.2;
fpS+=fpEnd*(2.+fpN1*.6);
// Deep snow hands over to the snowfield itself (its prints, ripples and glints), as does the edge.
float fpAlpha=(1.-smoothstep(1.6,2.3,fpS))*(1.-smoothstep(.04,${REACH.toFixed(2)},fpSd+fpNoise(fpP*1.9)*.05));
// The snow surface's slope from screen derivatives of its smooth level (much deeper in the drifts), taken
// before any neighbour can be discarded.
vec2 fpGSnow;
{
  vec2 dpx=fpDpx,dpy=fpDpy;
  float sN=fpS-fpLip*.85,h=min(sN,1.)*FP_RELIEF+max(sN-1.,0.)*.07,dsx=dFdx(h),dsy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  fpGSnow=abs(det)>1e-12?clamp(vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det,-.6,.6):vec2(0.);
}
if(fpAlpha<.004)discard;
// Stones. The courses bend a little along their length and every outline is chipped.
vec2 fpQ=fpP+vec2(fpNoise(fpP*2.3),fpNoise(fpP*2.3+7.))*.016;
fpQ.y+=fpNoise(vec2(fpP.x*.19,fpP.y*.03+5.))*.13;
float fpId;vec2 fpLoc,fpHalf,fpG;
float fpOut=fpCourse(fpQ,fpId,fpLoc,fpHalf,fpG)+fpNoise(fpP*13.+fpId*9.)*.006;
// Height in stone units (1 = FP_RELIEF m) and its gradient in metres per metre.
float fpSlope;vec2 fpCG;float fpH=fpDome(-fpOut,fpId,fpLoc,fpHalf,fpSlope,fpCG);
// Filter widths. fpFw is the pixel's extent across the nearest outline (from its analytic gradient), so a joint
// seen side-on stays crisp while one seen edge-on at a grazing angle is filtered. fpFar: the arris and the relief
// are finer than that. fpBlur: whole stones are under two pixels along the long axis, so only their average shows.
float fpFw=max(abs(dot(fpDpx,fpG))+abs(dot(fpDpy,fpG)),1e-4);
float fpFar=smoothstep(.012,.05,fpFw);
float fpBlur=smoothstep(.09,.3,fpFoot);
float fpBev=smoothstep(0.,.02+fpFw,-fpOut);
// The joint: an antialiased 2 cm line whose contrast falls as it narrows below the pixel, so its area holds.
float fpJc=(1.-smoothstep(-fpFw,fpFw,-fpOut-.006))*min(1.,.03/fpFw)*(1.-fpBlur*.6);
float fpTop=.84+.16*fract(fpId*5.3);
vec2 fpGS=(-fpG*fpSlope+fpCG)*FP_RELIEF*(1.-fpFar);
// Where snow lies on a stone: its arris (not the whole crown), each stone a little higher or lower than the next,
// and a ragged noise, so a half-buried course shows patches and filled joints, not a ring round every stone.
float fpAx=clamp(-fpOut/.045,0.,1.),fpArr=1.-(1.-fpAx)*(1.-fpAx);
float fpHs=mix(fpH,fpTop*fpArr,.6)+(fract(fpId*13.7)-.5)*.34*(1.-fpBlur)+(fpNoise(fpP*5.1+fpId)*.6+fpNoise(fpP*11.3)*.4)*.16*(1.-fpFar);
// Height averages that no longer resolve go to their mean. The snow line's edge is as wide as the pixel's step
// across the arris (stone units per pixel), so it never snaps from stone to stone.
float fpSw=max(.05,mix(fpSlope,fpTop*2.*(1.-fpAx)/.045,.6)*fpFw*.8)+fpFar*.1+fpBlur*.25;
fpH=mix(fpH,.62,fpFar);fpHs=mix(fpHs,.62,fpBlur);
// Meltwater keeps some joints open (only where the snow is thin enough for it to matter).
if(fpS<1.05)fpS-=(1.-fpBev)*(.2+.4*(fpNoise(fpP*3.3+fpId)*.5+.5))*(1.-fpFar)*(1.-smoothstep(.55,1.05,fpS));
float fpSnow=smoothstep(-fpSw,fpSw,fpS-fpHs+fpNoise(fpP*7.3)*.06*(1.-fpBlur)-.04);
float fpFresh=smoothstep(1.,1.9,fpS);
float fpPack=clamp(fpWear*.8+fpTrod*.5,0.,1.)*(1.-fpFresh);
// Thin snow keeps the shape of the stones under it.
float fpThin=1.-smoothstep(0.,.7,fpS-fpH);
// How far the visible surface sits below the stone tops around it: joints and hollows see less sky.
float fpRecess=clamp((fpTop*.92-max(fpS,fpH))/.55,0.,1.)*(1.-fpFar*.75)*(1.-fpSnow*.8);
// Granite from several quarries, a few warm and slate flags; dark where the shoulder meets the joint.
float fpV=fract(fpId*17.13);
vec3 fpStone=mix(vec3(.13,.125,.12),vec3(.3,.285,.265),fract(fpId*3.7));
fpStone=mix(fpStone,vec3(.31,.235,.17),step(.86,fpV)*.75);
fpStone=mix(fpStone,vec3(.13,.145,.17),step(fpV,.12)*.8);
fpStone*=.82+.36*(fpNoise(fpP*4.7+fpId*13.)*.5+.5);
// Under two pixels a stone is the quarry's mean, varied only at the scale of whole patches of road.
fpStone=mix(fpStone,vec3(.205,.194,.182)*(.86+.28*(fpNoise(fpP*.9+3.)*.5+.5)),fpBlur);
float fpNear=1.-smoothstep(.006,.03,fpFoot);
if(fpNear>0.)fpStone*=1.+(fpNoise(fpP*41.)*.22+fpNoise(fpP*97.)*.16)*fpNear;
float fpWet=smoothstep(.35,.9,fpTrod)*(1.-fpSnow);
fpStone*=mix(1.,.66,fpWet);
// Rime on stone that lies close under the snow line.
fpStone=mix(fpStone,vec3(.5,.56,.64),smoothstep(-.25,0.,fpS-fpH)*(1.-fpWet)*.35);
// Black ice where meltwater froze in the ruts.
float fpIce=0.;
if(fpRut>0.)fpIce=fpRut*smoothstep(.6,.8,fpNoise(fpP*.45+2.)*.5+.5+fpNoise(fpP*2.1)*.08)*(1.-fpSnow);
vec3 fpJoint=mix(vec3(.045,.045,.05),vec3(.085,.08,.075),fpN1*.5+.5);
vec3 fpRock=mix(fpStone,fpJoint,fpJc);
// Snow: fresh in the drifts (the snowfield's own albedo), packed and greyer on the road, dirtied in the ruts.
vec3 fpSnowC=mix(vec3(.84,.93,1.)*.97,vec3(.6,.655,.74),smoothstep(.2,1.,fpPack));
fpSnowC=mix(fpSnowC,vec3(.43,.43,.44),fpRut*.5*(1.-fpFresh));
// Prints: the snowfield's deformation field, shallower in packed snow, none in stone.
vec4 fpD=snowDeformAt(fpP)*snowDeformFalloff(fpP);
float fpPrint=fpSnow*(1.-fpPack*.55);
float fpPit=clamp(fpD.r/.12,0.,1.)*fpPrint;
fpSnowC*=mix(vec3(1.),vec3(.78,.86,1.),fpPit*.8+fpD.b*.1*fpPrint);
vec3 fpCol=mix(fpRock,fpSnowC,fpSnow);
fpCol*=1.-fpRecess*.45;
fpCol=mix(fpCol,vec3(.05,.065,.085),fpIce*.8);
diffuseColor.rgb*=fpCol;
diffuseColor.a*=fpAlpha;
// Low sun: the stone (or snow) between here and the sun blocks it.
float fpShade=1.;
if(fpDetail>.5&&fpSnow<.99&&fpFar<.99){
  float sl=max(length(fpSun.xz),1e-3);vec2 sd=fpSun.xz/sl;float tanE=fpSun.y/sl,h0=max(fpH,fpS*fpSnow),occ=0.;
  for(int k=1;k<=3;k++){float d=float(k*k)*.013,hk=fpStoneAt(fpQ+sd*d);occ=max(occ,clamp(((hk-h0)*FP_RELIEF-d*tanE)/.005,0.,1.));}
  fpShade=1.-occ*.8;
}
`;

const PAVING_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(mix(.8,.42,fpWet),.14,fpIce),mix(.95,.66,fpPack),fpSnow*(1.-fpIce));
`;

const PAVING_NORMAL = /* glsl */ `
{
  // Snow from its smooth level (fpGSnow); stones from their analytic arris and crown, softened under thin snow;
  // prints; ripples on fresh snow continue the snowfield's.
  vec2 gS=fpGSnow+fpGS*.14*fpThin*fpThin;
  vec2 gSt=fpGS*(1.-fpIce*.8);
  if(fpFresh>0.){
    vec2 wd=vec2(.8,.6);float ph=dot(fpP,wd)*2.4+sdNoise2(fpP*.31)*2.6,amp=.03*(.55+.45*sdNoise2(fpP*.11+3.7));
    gS+=wd*cos(ph)*2.4*amp*smoothstep(1.,.25,fpFoot)*fpFresh;
  }
  if(fpDetail>.5){
    if(fpSnow>0.){
      float e=snowDeformSize/snowDeformRes,fall=snowDeformFalloff(fpP)*1.15*(1.-fpPack*.55);
      gS+=vec2(snowDeformHeight(fpP+vec2(e,0.))-snowDeformHeight(fpP-vec2(e,0.)),snowDeformHeight(fpP+vec2(0.,e))-snowDeformHeight(fpP-vec2(0.,e)))/(2.*e)*fall;
    }
    if(fpNear>0.){
      float q=.02,n0=fpNoise(fpP*9.),nx=fpNoise((fpP+vec2(q,0.))*9.),nz=fpNoise((fpP+vec2(0.,q))*9.);
      vec2 gn=vec2(nx-n0,nz-n0)/q*fpNear;
      gSt+=gn*.004*fpBev;gS+=gn*.0025*(1.-fpFresh);
    }
  }
  vec2 g=mix(gSt,gS,fpSnow);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

/** A low sun skimming wet stone and ice must not bloom out; the sky comes back through Fresnel instead. */
const PAVING_LIGHT = /* glsl */ `#include <lights_fragment_end>
reflectedLight.directDiffuse*=fpShade;
reflectedLight.directSpecular=min(reflectedLight.directSpecular*fpShade,vec3(.3));`;

const PAVING_OUT = /* glsl */ `{
  vec3 nW=inverseTransformDirection(normal,viewMatrix),V=normalize(cameraPosition-vFpWorld),R=reflect(-V,nW);
  float F=.04+.96*pow(1.-clamp(dot(nW,V),0.,1.),5.);
  outgoingLight+=mix(fpSkyH,fpSkyZ,smoothstep(0.,.6,R.y))*F*(fpIce*.5+fpWet*.25)*(1.-fpSnow)*.5;
  // Snow crystals catch the sun when looking across the snow towards it (as the snowfield's do).
  if(fpDetail>.5&&fpSnow>.01){
    vec2 id=floor(fpP/.12),r=sdHash22(id),r2=sdHash22(id+vec2(19.73,7.31));
    vec2 c=(id+.5+(r-.5)*.72)*.12;float dd=length(fpP-c)/.0264,disc=clamp(1.-dd*dd,0.,1.)*step(r2.x,.62);
    if(disc>0.){
      vec3 L=normalize(fpSun),H=normalize(V+L),T=normalize(cross(vec3(0.,0.,1.),nW)),B=cross(nW,T);
      float a=r.y*6.2831853;vec3 f=normalize(nW+(T*cos(a)+B*sin(a))*(.1+r2.y*.26));
      float gl=disc*pow(clamp(dot(f,H),0.,1.),420.)*pow(1.-clamp(dot(nW,V),0.,1.),2.2)*(1.-smoothstep(.066,.26,fpFoot));
      outgoingLight+=reflectedLight.directDiffuse/max(diffuseColor.rgb,vec3(.05))*gl*fpSnow*14.;
    }
  }
}
#include <opaque_fragment>`;

/**
 * Rough-cut granite with snow caps and frost where it meets the drift. Geometry needs vertex colours (the
 * stone's tint), `aGround`, the snow line under each stone, and `aSnow`, how readily its top holds snow (0..1).
 */
export function graniteMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .86});
  material.name = name;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aSnow;\nvarying float vKG;\nvarying float vKS;\nvarying vec3 vKW;\nvarying vec3 vKN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvKG=aGround;vKS=aSnow;vKW=(modelMatrix*vec4(transformed,1.)).xyz;vKN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying float vKG;\nvarying float vKS;\nvarying vec3 vKW;\nvarying vec3 vKN;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 kNW=normalize(vKN),kA=abs(kNW)/(abs(kNW.x)+abs(kNW.y)+abs(kNW.z));
        #define K3(f,o) (fpNoise(vKW.zy*f+o)*kA.x+fpNoise(vKW.xz*f+o)*kA.y+fpNoise(vKW.xy*f+o)*kA.z)
        float kN=K3(3.1,0.);
        // Snow lies in patches on the flat tops only; frost creeps a finger's width up from the snow line.
        float kSnow=smoothstep(.85,.95,kNW.y+kN*.1)*smoothstep(.1,.25,fpNoise(vKW.xz*2.3+7.)*.9+vKS-.75+kN*.25);
        float kFrost=(1.-smoothstep(.0,.018+kN*.01,vKW.y-vKG))*.8;
        // Broad mottling, dark and light grains, lichen-dark streaks down the faces.
        float kGrain=K3(38.,5.)*.5+.5,kGrain2=K3(91.,9.)*.5+.5,kNear=1.-smoothstep(.004,.02,length(fwidth(vKW)));
        diffuseColor.rgb*=.66+.42*(K3(6.,2.)*.5+.5);
        diffuseColor.rgb*=mix(1.,mix(1.,.55,smoothstep(.62,.8,kGrain))*mix(1.,1.35,smoothstep(.66,.84,kGrain2)),kNear);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.93,1.),max(kSnow,kFrost));
        float kWhite=max(kSnow,kFrost);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.8,.92,kWhite);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Chisel marks: a small world-space bump, weaker under snow.
          #define KF(q) (fpNoise((q).zy*14.+1.)*kA.x+fpNoise((q).xz*14.+1.)*kA.y+fpNoise((q).xy*14.+1.)*kA.z)
          float e=.012,f0=KF(vKW);
          vec3 g=vec3(KF(vKW+vec3(e,0.,0.))-f0,KF(vKW+vec3(0.,e,0.))-f0,KF(vKW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.012*(1.-kWhite*.7);
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'frostlight-granite';
  return material;
}

export interface FrostPavingOptions {
  /** Sky colours the wet stone and black ice reflect, and the direction to the sun (SnowSky's). */
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  sunDir: THREE.Vector3;
  /** Prints in the road's snow come from the snowfield's own deformation field. */
  deform: SnowDeform;
  /** Paved squares, each one disc of its outline; swept bare in the middle. */
  pads?: readonly {x: number; z: number; r: number}[];
}

export interface FrostPaving {
  root: THREE.Group;
  /** 'low' drops the micro relief. */
  setQuality(q: 'high' | 'low'): void;
}

/** Signed distance to a segment's stones (the shader's twin): square at its path's ends, round past a joint. */
function segBox(s: Seg, x: number, z: number): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = x - s.ax, pz = z - s.az;
  const t = px * ux + pz * uz, across = Math.abs(px * uz - pz * ux), ovJ = Math.max(s.first ? 0 : -t, s.last ? 0 : t - L, 0);
  if (ovJ > 0) return Math.hypot(ovJ, across) - s.half;
  const bx = across - s.half, by = Math.max(s.first ? -t : -1e3, s.last ? t - L : -1e3);
  return Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
}
/** Distance from segment a-b to the rectangle [x0, x1] x [z0, z1] (0 when they meet). */
function segRect(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): number {
  const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  if (inside(ax, az) || inside(bx, bz)) return 0;
  const sd = (px: number, pz: number) => { const dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  const rd = (px: number, pz: number) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(z0 - pz, 0, pz - z1));
  // Crossing an edge: the segment meets the rectangle's boundary.
  const cross = (cx: number, cz: number, ex: number, ez: number) => {
    const d1x = bx - ax, d1z = bz - az, d2x = ex - cx, d2z = ez - cz, den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den, u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  if (cross(x0, z0, x1, z0) || cross(x1, z0, x1, z1) || cross(x1, z1, x0, z1) || cross(x0, z1, x0, z0)) return 0;
  return Math.min(rd(ax, az), rd(bx, bz), sd(x0, z0), sd(x1, z0), sd(x0, z1), sd(x1, z1));
}

/** Frostlight's paths and squares (same `covers` contract as islandPaths), dressed as snowed-in village streets. */
export function frostPaving(height: (x: number, z: number) => number, paths: IslandPath[], opts: FrostPavingOptions): FrostPaving {
  const root = new THREE.Group(); root.name = 'world4-snow-paving';
  const pads = opts.pads ?? [];
  const segs: Seg[] = [];
  paths.forEach((path, pi) => {
    let along = 0;
    for (let k = 1; k < path.points.length; k++) {
      const [ax, az] = path.points[k - 1], [bx, bz] = path.points[k], len = Math.hypot(bx - ax, bz - az);
      if (len < .001) continue;
      segs.push({ax, az, bx, bz, half: path.width / 2, main: path.width >= 6, along0: along, seed: pi * 7.31 + 1.3, path: pi, first: k === 1, last: k === path.points.length - 1});
      along += len;
    }
  });
  // Tiles: each lists the segments whose paved box comes within TILE_REACH of it.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.ax - s.half - 1, s.bx - s.half - 1); maxX = Math.max(maxX, s.ax + s.half + 1, s.bx + s.half + 1);
    minZ = Math.min(minZ, s.az - s.half - 1, s.bz - s.half - 1); maxZ = Math.max(maxZ, s.az + s.half + 1, s.bz + s.half + 1);
  }
  for (const p of pads) { minX = Math.min(minX, p.x - p.r - 1); maxX = Math.max(maxX, p.x + p.r + 1); minZ = Math.min(minZ, p.z - p.r - 1); maxZ = Math.max(maxZ, p.z + p.r + 1); }
  minX = Math.floor(minX / CELL) * CELL; minZ = Math.floor(minZ / CELL) * CELL;
  const tx = Math.ceil((maxX - minX) / TILE), tz = Math.ceil((maxZ - minZ) / TILE);
  const tiles: number[][] = [];
  for (let j = 0; j < tz; j++) for (let i = 0; i < tx; i++) {
    const x0 = minX + i * TILE, z0 = minZ + j * TILE, list: number[] = [];
    segs.forEach((s, k) => { if (segRect(s.ax, s.az, s.bx, s.bz, x0, z0, x0 + TILE, z0 + TILE) - s.half < TILE_REACH) list.push(k); });
    if (list.length > TILE_K) throw new Error(`frostPaving: ${list.length} segments reach tile ${i},${j}, max ${TILE_K}`);
    tiles.push(list);
  }
  const tileOf = (x: number, z: number) => tiles[Math.min(tz - 1, Math.max(0, Math.floor((z - minZ) / TILE))) * tx + Math.min(tx - 1, Math.max(0, Math.floor((x - minX) / TILE)))];
  const padDist = (x: number, z: number) => pads.reduce((d, p) => Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r), Infinity);
  // A free end is a path's first or last point that no other path's paving, and no square, reaches.
  const free = (s: Seg, x: number, z: number) => padDist(x, z) >= .5 && !segs.some(o => o.path !== s.path && segBox(o, x, z) < .5);
  const sdNet = (x: number, z: number) => tileOf(x, z).reduce((d, k) => Math.min(d, segBox(segs[k], x, z)), padDist(x, z));
  // Swept squares: the paved squares themselves, and small ones where a street meets a main road.
  const plazas: THREE.Vector4[] = pads.map(p => new THREE.Vector4(p.x, p.z, p.r * .95, p.r));
  // A street's end that lies on a main road's stones: swept round the foot of it on the main road's centreline.
  for (const s of segs.filter(s => !s.main && (s.first || s.last))) for (const [x, z] of [...(s.first ? [[s.ax, s.az]] : []), ...(s.last ? [[s.bx, s.bz]] : [])]) {
    let best: THREE.Vector4 | null = null, bestD = Infinity;
    for (const m of segs.filter(m => m.main)) {
      const dx = m.bx - m.ax, dz = m.bz - m.az, t = Math.min(1, Math.max(0, ((x - m.ax) * dx + (z - m.az) * dz) / (dx * dx + dz * dz))), fx = m.ax + dx * t, fz = m.az + dz * t, d = Math.hypot(x - fx, z - fz);
      if (d < m.half && d < bestD) { bestD = d; best = new THREE.Vector4(fx, fz, m.half * 1.25, 0); }
    }
    if (best) plazas.push(best);
  }
  if (plazas.length > MAX_PLAZA) throw new Error(`frostPaving: ${plazas.length} squares, max ${MAX_PLAZA}`);
  const ground = (x: number, z: number) => pavingGround(height, x, z, 4);

  // Surface: grid cells over the network, one vertex per grid point, so overlapping paths never double up.
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos: number[] = [], drift: number[] = [], index: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) { const x = minX + i * CELL, z = minZ + j * CELL; vid[k] = pos.length / 3; pos.push(x, ground(x, z) + LIFT, z); drift.push(frostDrift(x, z)); }
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (sdNet(minX + (i + .5) * CELL, minZ + (j + .5) * CELL) > REACH + CELL * .72) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDrift', new THREE.Float32BufferAttribute(drift, 1));
  geo.setIndex(index); geo.computeVertexNormals(); geo.computeBoundingSphere();

  const segData = new Float32Array(segs.length * 12);
  let freeEnds = 0;
  segs.forEach((s, i) => {
    const endA = s.first && free(s, s.ax, s.az) ? 1 : 0, endB = s.last && free(s, s.bx, s.bz) ? 1 : 0;
    freeEnds += endA + endB;
    segData.set([s.ax, s.az, s.bx, s.bz, s.half, s.main ? 1 : 0, (s.first ? 0 : 1) + (s.last ? 0 : 2), endA + endB * 2, s.along0, s.seed, 0, 0], i * 12);
  });
  const tileData = new Float32Array(tiles.length * TILE_K);
  tiles.forEach((list, t) => list.forEach((k, j) => { tileData[t * TILE_K + j] = k + 1; }));
  const tex = (data: Float32Array, w: number, h: number) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  const uniforms = {
    fpSegTex: {value: tex(segData, 3, segs.length)},
    fpTileTex: {value: tex(tileData, TILE_K / 4, tiles.length)},
    fpTileGrid: {value: new THREE.Vector4(minX, minZ, 1 / TILE, tx)},
    fpTileRows: {value: tz},
    fpPlaza: {value: Array.from({length: MAX_PLAZA}, (_, i) => plazas[i] ?? new THREE.Vector4())},
    fpPlazaCount: {value: plazas.length},
    fpDetail: {value: 1},
    fpSkyH: {value: opts.skyHorizon},
    fpSkyZ: {value: opts.skyZenith},
    fpSun: {value: opts.sunDir},
    ...opts.deform.uniforms,
  };
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .85, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  material.name = 'frostlight-snow-paving';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDrift;\nvarying float vFpDrift;\nvarying vec3 vFpWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFpDrift=aDrift;vFpWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PAVING_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PAVING_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${PAVING_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${PAVING_NORMAL}`)
      .replace('#include <lights_fragment_end>', PAVING_LIGHT)
      .replace('#include <opaque_fragment>', PAVING_OUT);
  };
  material.customProgramCacheKey = () => 'frostlight-snow-paving';
  const surface = new THREE.Mesh(geo, material);
  surface.name = 'frostlight-paving-surface'; surface.receiveShadow = true; surface.renderOrder = -1;
  root.add(surface);

  // Whether (x, z) is on the stones, kerbs included: the paths' own test, the bends' outsides and the squares.
  root.userData.covers = (x: number, z: number) => onIslandPath(paths, x, z) || padDist(x, z) <= .3 || tileOf(x, z).some(k => segBox(segs[k], x, z) <= .3);
  root.userData.stats = {segments: segs.length, plazas: plazas.length - pads.length, pads: pads.length, freeEnds, cells: index.length / 6, vertices: pos.length / 3, tiles: tiles.length, maxPerTile: Math.max(...tiles.map(t => t.length))};
  return {root, setQuality(q) { uniforms.fpDetail.value = q === 'low' ? 0 : 1; }};
}
