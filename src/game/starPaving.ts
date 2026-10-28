import * as THREE from 'three';
import {injectStarLight} from './starLight';
import {onIslandPath,type IslandPath} from './islandPaths';
import {pavingGround} from './pavingLayout';
import {STAR_DETAIL} from './starFieldLayout';

/*
 * Starhaven's streets by moonlight. One mesh hugs the ground under the whole network (the gameplay grid's own
 * triangles, a few centimetres up) and its shader lays the stones, so nothing tiles and nothing is a grid:
 * - the avenue, the market square and the lanes: worn granite setts in random courses, each stone a little skew,
 *   domed and rounded at the arris; the square's middle round the fountain is set in rings;
 * - the pilgrim trails: irregular flags with grass between them, thinning to stepping stones at the edges;
 * - long kerbstones sunk along the avenue and the square, the ground lapping over their outer edge, and a ring of
 *   them round the fountain.
 * Moss fills the joints where feet do not go, sand blows into the joints near the edges and in drifts over the
 * kerb, the worn middle is smooth and darker with dew, and a wet sheen gives back the sky and the lamps.
 * Everything visible stays inside onIslandPath() plus the plaza disc, so `covers` agrees with what is drawn.
 */

/** Tile edge, metres: each pixel loops only over the segments its tile lists, at most TILE_K. */
const TILE = 3;
const TILE_K = 12;
const MAX_PAD = 4;
const MAX_HOLE = 4;
/** A segment joins a tile's list when its box comes this close. */
const TILE_REACH = 1.6;
/** Grid step of the surface mesh, metres. */
const CELL = .5;
const LIFT = .03;
/** Visible paving ends this far past a path's edge: inside onIslandPath's trim margin (.3). */
const REACH = .26;
/** A dead end frays out over this many metres (star r5). */
const FRAY = 8;

interface Seg { ax: number; az: number; bx: number; bz: number; half: number; kind: number; trim: boolean; along0: number; first: boolean; last: boolean; fray: number }

const NOISE = /* glsl */ `
vec2 spHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float spHash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float spNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(spHash22(i)*2.-1.,f),b=dot(spHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(spHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(spHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
`;

const HEAD = /* glsl */ `
uniform sampler2D spSegTex;
uniform sampler2D spTileTex;
uniform vec4 spTileGrid;
uniform float spTileRows;
#define SP_TILE_K ${TILE_K}
#define SP_MAX_PAD ${MAX_PAD}
#define SP_MAX_HOLE ${MAX_HOLE}
#define SP_FRAY ${FRAY.toFixed(1)}
// Paved squares (x, z, paved radius, rings radius) and clear holes (x, z, radius, ring kerb width).
uniform vec4 spPad[SP_MAX_PAD];
uniform int spPadCount;
uniform vec4 spHole[SP_MAX_HOLE];
uniform int spHoleCount;
uniform vec3 spSkyH;
uniform vec3 spSkyZ;
uniform float sgDetail;
#define spDetail sgDetail
varying vec3 vSpW;
${NOISE}
float spPick(vec4 v,int i){return i==0?v.x:i==1?v.y:i==2?v.z:v.w;}
float spSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float spEdgeAt(float k,float salt,float jit){return k+jit*(spHash12(vec2(k,salt))-.5);}
// Random-course setts: rows of varying depth, stones of varying length along each row, each a little skew and
// rounded. Signed distance to the stone's outline (m, negative inside), its id, offset from centre, half size.
float spCourse(vec2 q,float rh,vec2 len,out float id,out vec2 local,out vec2 halfSz){
  float k=floor(q.y/rh),b0=spEdgeAt(k,3.1,.36)*rh,b1=spEdgeAt(k+1.,3.1,.36)*rh,row=k;
  if(q.y<b0){row=k-1.;b1=b0;b0=spEdgeAt(k-1.,3.1,.36)*rh;}
  else if(q.y>=b1){row=k+1.;b0=b1;b1=spEdgeAt(k+2.,3.1,.36)*rh;}
  float SL=mix(len.x,len.y,spHash12(vec2(row,7.7))),off=spHash12(vec2(row,1.3))*SL,xs=q.x-off,salt=row*1.618+.5;
  float j=floor(xs/SL),e0=spEdgeAt(j,salt,.42)*SL,e1=spEdgeAt(j+1.,salt,.42)*SL,col=j;
  if(xs<e0){col=j-1.;e1=e0;e0=spEdgeAt(j-1.,salt,.42)*SL;}
  else if(xs>=e1){col=j+1.;e0=e1;e1=spEdgeAt(j+2.,salt,.42)*SL;}
  id=spHash12(vec2(col+row*57.31,row-col*.731));
  halfSz=vec2(e1-e0,b1-b0)*.5;
  local=vec2(xs-(e0+e1)*.5,q.y-(b0+b1)*.5);
  vec2 r=spHash22(vec2(id*71.3,col-row));
  float a=(r.x-.5)*.09,ca=cos(a),sa=sin(a);
  local=vec2(ca*local.x-sa*local.y,sa*local.x+ca*local.y);
  halfSz-=vec2(.004+.014*r.y,.004+.01*fract(id*9.1));
  float rc=mix(.03,.075,fract(id*7.31)),jw=.008+.008*fract(id*3.17);
  vec2 dq=abs(local)-(halfSz-jw-rc);
  return length(max(dq,0.))+min(max(dq.x,dq.y),0.)-rc;
}
// Irregular flags: a cellular tiling, each stone the cell shrunk by a joint; returns distance to the outline.
float spFlags(vec2 q,float size,out float id,out vec2 local){
  vec2 p=q/size,i=floor(p),f=fract(p);float f1=8.,f2=8.;vec2 c1=vec2(0.),c2=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)),o=.12+.76*spHash22(i+g),d=g+o-f;float l=dot(d,d);
    if(l<f1){f2=f1;c2=c1;f1=l;c1=i+g+o;}else if(l<f2){f2=l;c2=i+g+o;}
  }
  // Distance to the bisector between the two nearest cell points: the stone's edge, in metres.
  vec2 m=(c1+c2)*.5,n=normalize(c2-c1);
  float edge=dot(p-m,n)*size;
  id=spHash12(c1*1.37);
  local=(p-c1)*size;
  return edge+.025+.03*fract(id*5.3);
}
// A worn stone's height (0 in the joint, about 1 on top): a short rounded arris, then a gentle crown.
float spDome(float de,float id,vec2 l,vec2 h){
  float x=clamp(de/.04,0.,1.),e=1.-(1.-x)*(1.-x);
  vec2 u=l/max(h,vec2(.05));
  return e*(.82+.18*fract(id*5.3)-dot(u,u)*.22);
}
`;

const COLOR = /* glsl */ `
vec2 spP=vSpW.xz;
vec2 spDpx=dFdx(spP),spDpy=dFdy(spP);
float spFoot=length(abs(spDpx)+abs(spDpy));
// The network as a filleted union; the segment the pixel is deepest inside gives the pattern and its frame.
float spSd=1e3,spBest=1e3,spKind=0.,spTrim=0.,spAlong=0.,spAcross=0.,spHalf=1.,spFray=1e3;
ivec2 spTc=clamp(ivec2(floor((spP-spTileGrid.xy)*spTileGrid.z)),ivec2(0),ivec2(int(spTileGrid.w)-1,int(spTileRows)-1));
int spTile=spTc.y*int(spTileGrid.w)+spTc.x;
for(int q=0;q<SP_TILE_K/4;q++){
 vec4 ids=texelFetch(spTileTex,ivec2(q,spTile),0);
 for(int c=0;c<4;c++){
  int si=int(spPick(ids,c))-1;
  if(si<0)break;
  vec4 s=texelFetch(spSegTex,ivec2(0,si),0),info=texelFetch(spSegTex,ivec2(1,si),0);
  vec2 jn=vec2(mod(info.w,2.),floor(info.w*.5));
  vec2 ab=s.zw-s.xy;float L=length(ab);vec2 dir=ab/L,ap=spP-s.xy;
  float t=dot(ap,dir),across=dot(ap,vec2(dir.y,-dir.x));
  float ovA=-t,ovB=t-L,ovJ=max(max(ovA*jn.x,ovB*jn.y),0.);
  vec2 bd=vec2(abs(across)-info.x,max(mix(ovA,-1e3,jn.x),mix(ovB,-1e3,jn.y)));
  float d=ovJ>0.?length(vec2(ovJ,across))-info.x:length(max(bd,0.))+min(max(bd.x,bd.y),0.);
  // A dead end frays out (star r5): over its last few metres the way narrows to a rounded tongue, ragged at the edge.
  float fr=texelFetch(spSegTex,ivec2(2,si),0).y,frA=mod(fr,2.),frB=floor(fr*.5),tEnd=min(frA>.5?t:1e3,frB>.5?L-t:1e3);
  if(tEnd<SP_FRAY+2.){
    float hw=info.x*mix(.66,1.,smoothstep(0.,SP_FRAY,tEnd+spNoise(spP*.7+3.)*1.2)),he=info.x*.66,ov=he-tEnd;
    d=ov>0.?length(vec2(ov,across))-he:abs(across)-hw;
  }
  spSd=spSmin(spSd,d,.25);
  // Prefer the wider way where two meet, so the avenue's kerbs and courses run through the junctions.
  float rank=d-info.x*.08;
  if(rank<spBest){spBest=rank;spKind=info.y;spTrim=info.z;spAlong=t+texelFetch(spSegTex,ivec2(2,si),0).x;spAcross=across;spHalf=info.x;spFray=tEnd;}
 }
 if(ids.w<.5)break;
}
float spPadD=1e3,spRing=0.;vec2 spPadC=vec2(0.);
for(int i=0;i<SP_MAX_PAD;i++){if(i>=spPadCount)break;vec4 q=spPad[i];float d=length(spP-q.xy)-q.z;spSd=spSmin(spSd,d,.4);if(d<spPadD){spPadD=d;spPadC=q.xy;spRing=q.w;}}
float spHoleD=1e3,spHoleK=0.,spHoleR=1.;vec2 spHoleC=vec2(0.);
for(int i=0;i<SP_MAX_HOLE;i++){if(i>=spHoleCount)break;vec4 q=spHole[i];float d=length(spP-q.xy)-q.z;if(d<spHoleD){spHoleD=d;spHoleC=q.xy;spHoleK=q.w;spHoleR=q.z;}}
if(spHoleD<0.)discard;
// Large-scale variation shared by everything below.
float spN1=spNoise(spP*.31+1.7)*.6+spNoise(spP*.83-4.1)*.4,spN2=spNoise(spP*2.3+4.);
float spEdgeRag=spNoise(spP*1.1+2.3)*.6+spNoise(spP*3.7)*.4;
// Fraying: 0 on the made way, 1 at its frayed tip.
float spFr=1.-smoothstep(0.,SP_FRAY,spFray);
float spAlpha=1.-smoothstep(-.02,${REACH.toFixed(2)},spSd+spEdgeRag*mix(.06,.32,spFr));
if(spAlpha<.004)discard;
// Pattern. Trails (kind 2): irregular flags in grass. Elsewhere world-aligned courses (no seams at junctions),
// rings round a plaza's middle, and kerbs in the outer band of trimmed ways and round the holes.
float spKerbW=.34;
bool spInPadRing=spRing>0.&&length(spP-spPadC)<spRing;
float spKerbBand=spTrim>.5&&!spInPadRing&&spFray>SP_FRAY*.75?1.-step(spKerbW,-spSd):0.;
float spHoleBand=spHoleK>0.?1.-step(spHoleK,spHoleD):0.;
float spId,spOut;vec2 spLoc,spHalfS;
vec2 spQ=spP+vec2(spNoise(spP*2.1),spNoise(spP*2.1+7.))*.02;
if(spHoleBand>.5){
  // Kerb ring round a hole: long curved stones.
  vec2 d=spP-spHoleC;float r=length(d),a=atan(d.y,d.x);
  float R=spHoleR+spHoleK*.5,n=floor(R*6.2831/.85),k=floor(a/6.2831*n);
  float ca=(k+.5)/n*6.2831,arc=(a-ca)*R;
  spId=spHash12(vec2(k,R*7.));spLoc=vec2(arc,r-R);spHalfS=vec2(3.1416*R/n,spHoleK*.5);
  vec2 dq=abs(spLoc)-(spHalfS-vec2(.012,.01)-.04);spOut=length(max(dq,0.))+min(max(dq.x,dq.y),0.)-.04;
}else if(spKerbBand>.5){
  // Kerbstones: long, along the way, sunk at the outer edge.
  float k=floor(spAlong/.95),u=spAlong-(k+.5)*.95;
  spId=spHash12(vec2(k,sign(spAcross)*3.1+spHalf));
  float w=spKerbW*.5;spLoc=vec2(u,-spSd-w);spHalfS=vec2(.475,w);
  vec2 dq=abs(spLoc)-(spHalfS-vec2(.012+.01*fract(spId*3.3),.008)-.035);spOut=length(max(dq,0.))+min(max(dq.x,dq.y),0.)-.035;
}else if(spInPadRing){
  vec2 d=spP-spPadC;float r=length(d),a=atan(d.y,d.x);
  spOut=spCourse(vec2(a*r,r),.27,vec2(.26,.44),spId,spLoc,spHalfS);
}else if(spKind>1.5){
  spOut=spFlags(spQ,.78,spId,spLoc);spHalfS=vec2(.36);
}else{
  spOut=spKind>.5?spCourse(spQ,.29,vec2(.26,.52),spId,spLoc,spHalfS):spCourse(spQ.yx,.33,vec2(.36,.62),spId,spLoc,spHalfS);
}
spOut+=spNoise(spP*13.+spId*9.)*.007;
float spH=spDome(-spOut,spId,spLoc,spHalfS);
// Filters: a joint narrower than a pixel keeps its area by losing contrast; far off, only the mean shows.
float spFw=max(spFoot*.5,1e-4);
float spBlur=smoothstep(.08,.28,spFoot);
float spJ=(1.-smoothstep(-spFw,spFw,-spOut-.004))*min(1.,.025/spFw)*(1.-spBlur*.7);
// Trails: the stones thin out toward the edges, grass between them and over the missing ones.
float spSkip=spKind>1.5?step(fract(spId*13.7),.06+.7*smoothstep(-.9,-.05,spSd)):0.;
// A frayed end loses its stones toward the tip and at its edges: packed earth and grass come through.
spSkip=max(spSkip,step(fract(spId*13.7),spFr*spFr*(.75+.25*smoothstep(-1.2,-.1,spSd))+spFr*.15));
// Wear: the middle of each way and the plaza are trodden smooth; moss holds where feet do not go.
float spMid=spKind>1.5?1.-smoothstep(.2,1.,abs(spAcross)):1.-smoothstep(.3,.95,abs(spAcross)/max(spHalf,.5));
spMid=max(spMid*(1.-spKerbBand),(1.-smoothstep(1.,6.,spPadD+6.))*.8);
float spMossy=clamp((1.-spMid)*.9+spN1*.35+(spKind>1.5?.4:0.),0.,1.)*(1.-spHoleBand*.5);
float spSandy=smoothstep(-.9,.1,spSd+spEdgeRag*.7)*smoothstep(.0,.6,spN1*.5+.5+spEdgeRag*.3)+smoothstep(.6,.9,spN2*.5+.5)*.2;
// Stone: granite from several quarries, a few warm sandstone and dark basalt pieces; kerbs paler and longer.
float spV=fract(spId*17.13);
vec3 spStone=mix(vec3(.17,.17,.19),vec3(.32,.31,.32),fract(spId*3.7));
spStone=mix(spStone,vec3(.36,.30,.24),step(.84,spV)*.8);
spStone=mix(spStone,vec3(.1,.1,.125),step(spV,.1)*.8);
spStone=mix(spStone,vec3(.3,.29,.31)*(.85+.3*fract(spId*5.)),max(spKerbBand,spHoleBand));
spStone*=.84+.32*(spNoise(spP*5.3+spId*13.)*.5+.5);
float spNear=1.-smoothstep(.006,.03,spFoot);
if(spNear>0.)spStone*=1.+spNoise(spP*43.)*.18*spNear+spNoise(spP*97.)*.12*(1.-smoothstep(.003,.008,spFoot));
spStone=mix(spStone,vec3(.16,.155,.17)*(.85+.3*(spN1*.5+.5)),spBlur);
// Lichen on the crowns of stones off the beaten line; worn ones polished darker.
float spLichen=smoothstep(.55,.8,spNoise(spP*3.1+spId*5.)*.5+.5)*spMossy*(1.-spBlur)*.55;
spStone=mix(spStone,vec3(.36,.42,.33),spLichen*.5);
spStone*=mix(1.,.82,spMid*.6);
// Joints: moss where it is damp and undisturbed, sand toward the edges, dark grit in the trodden middle.
vec3 spMossC=mix(vec3(.05,.1,.075),vec3(.1,.17,.11),spN2*.5+.5);
vec3 spSandC=vec3(.25,.235,.25)*(.85+.3*spN2);
vec3 spGrit=vec3(.06,.058,.065);
vec3 spJoint=mix(spGrit,spMossC,smoothstep(.25,.6,spMossy));
spJoint=mix(spJoint,spSandC,smoothstep(.35,.8,spSandy)*.85);
// Trail gaps are meadow, not joints.
vec3 spTurf=mix(vec3(.05,.085,.06),vec3(.085,.11,.07),spN2*.5+.5);
float spGap=spKind>1.5?max(1.-smoothstep(-.03,.02,-spOut),spSkip):spSkip;
// Where a frayed way has lost its stones the gap is trodden earth with grit, turf only at the edges.
spTurf=mix(spTurf,mix(vec3(.13,.115,.105),vec3(.2,.19,.2),step(.7,spNoise(spP*9.)*.5+.5))*(.8+.4*spN2),spFr*(1.-smoothstep(-.9,-.2,spSd))*step(spKind,1.5));
vec3 spCol=mix(spStone,spJoint,spJ);
spCol=mix(spCol,spTurf*(.8+.4*spNoise(spP*7.)),spGap*(1.-spBlur*.5));
// Blown sand drifts over the stones from the edges and lies in the hollows.
float spDrift=smoothstep(.55,.85,spSandy+spNoise(spP*.9+3.)*.3-spH*.3);
spCol=mix(spCol,spSandC,spDrift*.8);
// The kerb's outer lip sinks under the turf and the sand.
float spLip=smoothstep(-.12,.0,spSd+spEdgeRag*.05)*(1.-spFr);
spCol=mix(spCol,mix(spTurf,spSandC,spSandy*.5),spLip*.8);
float spRecess=(1.-smoothstep(0.,.4,spH))*(1.-spDrift)*(1.-spBlur)*.35;
spCol*=1.-spRecess;
// Dew: patches where the stone tops are wet, more in the worn middle.
float spWet=smoothstep(.15,.6,spN1*.6+spNoise(spP*.6+9.)*.5+spMid*.25)*(1.-spDrift)*(1.-spGap);
spCol*=mix(1.,.78,spWet);
diffuseColor.rgb=spCol;
diffuseColor.a*=spAlpha;
`;

const ROUGH = /* glsl */ `
// Each stone wet to its own degree (no two neighbours shine alike, so the middle never reads as one bright band), and
// the worn middle a little duller.
roughnessFactor=mix(mix(.78,.42+.34*fract(spId*7.31)+.12*spMid,spWet),.9,max(spDrift,spGap));
roughnessFactor=mix(roughnessFactor,.95,spJ*(1.-spWet));
`;

const NORMAL = /* glsl */ `
if(spDetail>.5){
  // Stone relief from screen derivatives of the dome (5 cm proud), joint and drift; flattened where it blurs.
  float h=(spH*(1.-spDrift*.8)*(1.-spGap)*.05+spNoise(spP*9.)*.003*spNear)*(1.-spBlur);
  vec2 dpx=spDpx,dpy=spDpy;float dhx=dFdx(h),dhy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dhx*dpy.y-dhy*dpx.y,dpx.x*dhy-dpy.x*dhx)/det,-1.,1.):vec2(0.);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const OUT = /* glsl */ `{
  // Wet stone gives back the night sky.
  vec3 nW=inverseTransformDirection(normal,viewMatrix),V=normalize(cameraPosition-vSpW),R=reflect(-V,nW);
  float F=.04+.96*pow(1.-clamp(dot(nW,V),0.,1.),5.);
  // Half as strong down the worn middle, where the wet stones line up into one stripe seen along the avenue.
  float spSheen=spWet*(1.-.5*spMid)*(.55+.45*fract(spId*7.31));
  outgoingLight+=mix(spSkyH,spSkyZ,smoothstep(0.,.6,R.y))*F*spSheen*.45;
  // And the lanterns, as long warm smears down the wet stones of the street.
  outgoingLight+=starLampGlint(vSpW,nW,V,mix(18.,90.,spWet))*(.08+.5*spSheen)*F*3.;
}
#include <opaque_fragment>`;

/** Signed distance to a segment's paved box (the shader's twin): square at its path's ends, round past a joint. */
function segBox(s: Seg, x: number, z: number): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = x - s.ax, pz = z - s.az;
  const t = px * ux + pz * uz, across = Math.abs(px * uz - pz * ux), ovJ = Math.max(s.first ? 0 : -t, s.last ? 0 : t - L, 0);
  if (ovJ > 0) return Math.hypot(ovJ, across) - s.half;
  const bx = across - s.half, by = Math.max(s.first ? -t : -1e3, s.last ? t - L : -1e3);
  return Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
}
function segRectDist(s: Seg, x0: number, z0: number, x1: number, z1: number): number {
  // Conservative: distance from the rectangle's centre to the segment minus its half diagonal.
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dx = s.bx - s.ax, dz = s.bz - s.az;
  const t = Math.min(1, Math.max(0, ((cx - s.ax) * dx + (cz - s.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(cx - s.ax - dx * t, cz - s.az - dz * t) - Math.hypot(x1 - x0, z1 - z0) / 2;
}

export interface StarPavingOptions {
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  /** Round paved squares: centre, radius, and the radius inside which the stones are laid in rings. */
  pads?: readonly {x: number; z: number; r: number; rings: number}[];
  /** Round clearances (a fountain's basin), with a ring of kerbstones `kerb` wide round each. */
  holes?: readonly {x: number; z: number; r: number; kerb: number}[];
  /** Dead ends (a path's first or last point) that fray out into earth instead of stopping square. */
  frays?: readonly {x: number; z: number}[];
}
export interface StarPaving { root: THREE.Group }

/** Starhaven's ways (same `covers` contract as islandPaths). Ways 6 m wide or more are avenues, `trim` ones get kerbs, 2.4 m ones off the trims are trails. */
export function starPaving(height: (x: number, z: number) => number, paths: IslandPath[], trails: number, opts: StarPavingOptions): StarPaving {
  const root = new THREE.Group(); root.name = 'world2-moonlit-paving';
  const pads = opts.pads ?? [], holes = opts.holes ?? [], frays = opts.frays ?? [];
  const segs: Seg[] = [];
  paths.forEach((path, pi) => {
    let along = 0;
    const kind = pi >= paths.length - trails ? 2 : path.width >= 6 ? 1 : 0;
    for (let k = 1; k < path.points.length; k++) {
      const [ax, az] = path.points[k - 1], [bx, bz] = path.points[k], len = Math.hypot(bx - ax, bz - az);
      if (len < .001) continue;
      const frayAt = (x: number, z: number) => frays.some((f) => Math.hypot(f.x - x, f.z - z) < .1);
      const fray = (k === 1 && frayAt(ax, az) ? 1 : 0) + (k === path.points.length - 1 && frayAt(bx, bz) ? 2 : 0);
      segs.push({ax, az, bx, bz, half: path.width / 2, kind, trim: !!path.trim, along0: along, first: k === 1, last: k === path.points.length - 1, fray});
      along += len;
    }
  });
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
    segs.forEach((s, k) => { if (segRectDist(s, x0, z0, x0 + TILE, z0 + TILE) - s.half < TILE_REACH) list.push(k); });
    if (list.length > TILE_K) throw new Error(`starPaving: ${list.length} segments reach tile ${i},${j}, max ${TILE_K}`);
    tiles.push(list);
  }
  const tileOf = (x: number, z: number) => tiles[Math.min(tz - 1, Math.max(0, Math.floor((z - minZ) / TILE))) * tx + Math.min(tx - 1, Math.max(0, Math.floor((x - minX) / TILE)))];
  const padDist = (x: number, z: number) => pads.reduce((d, p) => Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r), Infinity);
  const holeDist = (x: number, z: number) => holes.reduce((d, p) => Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r), Infinity);
  const sdNet = (x: number, z: number) => tileOf(x, z).reduce((d, k) => Math.min(d, segBox(segs[k], x, z)), padDist(x, z));
  const ground = (x: number, z: number) => pavingGround(height, x, z, 2);

  // Surface: grid cells over the network, one vertex per grid point, so overlapping ways never double up.
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos: number[] = [], index: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) { const x = minX + i * CELL, z = minZ + j * CELL; vid[k] = pos.length / 3; pos.push(x, ground(x, z) + LIFT, z); }
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = minX + (i + .5) * CELL, cz = minZ + (j + .5) * CELL;
    if (sdNet(cx, cz) > REACH + CELL * .72 || holeDist(cx, cz) < -CELL * .72) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index); geo.computeVertexNormals(); geo.computeBoundingSphere();

  const segData = new Float32Array(segs.length * 12);
  segs.forEach((s, i) => segData.set([s.ax, s.az, s.bx, s.bz, s.half, s.kind, s.trim ? 1 : 0, (s.first ? 0 : 1) + (s.last ? 0 : 2), s.along0, s.fray, 0, 0], i * 12));
  const tileData = new Float32Array(tiles.length * TILE_K);
  tiles.forEach((list, t) => list.forEach((k, j) => { tileData[t * TILE_K + j] = k + 1; }));
  const tex = (data: Float32Array, w: number, h: number) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  if (pads.length > MAX_PAD || holes.length > MAX_HOLE) throw new Error('starPaving: too many pads or holes');
  const uniforms = {
    spSegTex: {value: tex(segData, 3, segs.length)},
    spTileTex: {value: tex(tileData, TILE_K / 4, tiles.length)},
    spTileGrid: {value: new THREE.Vector4(minX, minZ, 1 / TILE, tx)},
    spTileRows: {value: tz},
    spPad: {value: Array.from({length: MAX_PAD}, (_, i) => pads[i] ? new THREE.Vector4(pads[i].x, pads[i].z, pads[i].r, pads[i].rings) : new THREE.Vector4())},
    spPadCount: {value: pads.length},
    spHole: {value: Array.from({length: MAX_HOLE}, (_, i) => holes[i] ? new THREE.Vector4(holes[i].x, holes[i].z, holes[i].r, holes[i].kerb) : new THREE.Vector4())},
    spHoleCount: {value: holes.length},
    sgDetail: STAR_DETAIL,
    spSkyH: {value: opts.skyHorizon},
    spSkyZ: {value: opts.skyZenith},
  };
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .8, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  material.name = 'starhaven-moonlit-paving';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSpW=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
      .replace('#include <opaque_fragment>', OUT);
    injectStarLight(shader, 'vSpW');
  };
  material.customProgramCacheKey = () => 'starhaven-moonlit-paving';
  const surface = new THREE.Mesh(geo, material);
  surface.name = 'starhaven-paving-surface'; surface.receiveShadow = true; surface.renderOrder = -1;
  root.add(surface);
  // Where stones are actually laid (the frayed tongues narrower than the ways' boxes): the meadow grows up to it.
  const frayed = (s: Seg, x: number, z: number) => {
    const d = segBox(s, x, z);if (!s.fray) return d;
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), t = ((x - s.ax) * dx + (z - s.az) * dz) / L, across = Math.abs(((x - s.ax) * dz - (z - s.az) * dx) / L);
    const tEnd = Math.min(s.fray & 1 ? t : 1e3, s.fray & 2 ? L - t : 1e3);
    if (tEnd >= FRAY + 2) return d;
    const hw = s.half * (.66 + .34 * THREE.MathUtils.smoothstep(tEnd, 0, FRAY)), he = s.half * .66, ov = he - tEnd;
    return ov > 0 ? Math.hypot(ov, across) - he : across - hw;
  };
  root.userData.paved = (x: number, z: number) => holeDist(x, z) >= 0 && (tileOf(x, z).some((k) => frayed(segs[k], x, z) <= .12) || padDist(x, z) <= .12);
  root.userData.covers = (x: number, z: number) => holeDist(x, z) >= 0 && (onIslandPath(paths, x, z) || padDist(x, z) <= .3);
  root.userData.stats = {segments: segs.length, pads: pads.length, holes: holes.length, cells: index.length / 6, vertices: pos.length / 3, tiles: tiles.length, maxPerTile: Math.max(...tiles.map(t => t.length))};
  return {root};
}
