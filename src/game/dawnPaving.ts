import * as THREE from 'three';
import {FROST_NOISE} from './frostPaving';
import {onIslandPath,type IslandPath} from './islandPaths';
import {pavingGround} from './pavingLayout';

/*
 * Dawnharbor's streets: warm sandstone, laid the way a harbour town lays it. One mesh hugs the terrain under the
 * whole network (frostPaving.ts's technique, World IV's own module untouched) and its shader lays the stones:
 * small coursed setts across the main avenue, larger flags along the side streets, concentric fan courses on the
 * squares with a sun of rose and honey tesserae inlaid in the town square. Every course is cut from the segment's
 * own along/across frame, so winding lanes keep their courses square to the way. Long pale kerb stones line the
 * kerbed ways, set a little proud with a sand-filled gutter inside them. Feet polish the middle lighter and
 * smoother; sand blows in from the dunes, filling the joints first, then lying in drifts over the edges and the
 * free ends, so the paving never ends at a hard seam. The low sun is shadowed by the stones it skims (three taps).
 * Everything visible stays inside the paths' covers() test.
 */

/** Tile edge, metres: each pixel loops only over the segments its tile lists, at most TILE_K. */
const TILE = 3;
const TILE_K = 16;
const MAX_PLAZA = 24;
const TILE_REACH = 2;
const CELL = .5;
const LIFT = .03;
/** Visible paving ends this far past a path's edge: inside onIslandPath's trim margin (.3). */
const REACH = .27;
/** Kerb band width inside a kerbed path's edge, metres. */
const KERB = .34;

const fract = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** 0 clear, 1 a dune tongue has crossed the edge well into the street. */
export function dawnDrift(x: number, z: number): number {
  return smooth(.52, .76, vnoise(x * .13 + 9.1, z * .13 - 2.3) * .65 + vnoise(x * .37 - 4.7, z * .37 + 1.2) * .35);
}

interface Seg { ax: number; az: number; bx: number; bz: number; half: number; main: boolean; trim: boolean; along0: number; seed: number; path: number; first: boolean; last: boolean }

const HEAD = /* glsl */ `
uniform sampler2D dpSegTex;
uniform sampler2D dpTileTex;
uniform vec4 dpTileGrid;
uniform float dpTileRows;
#define DP_TILE_K ${TILE_K}
#define DP_MAX_PLAZA ${MAX_PLAZA}
// Squares: (xz, swept radius, paved radius); junction sweeps have paved radius 0.
uniform vec4 dpPlaza[DP_MAX_PLAZA];
uniform int dpPlazaCount;
// The inlaid sun: centre xz, radius.
uniform vec3 dpSunInlay;
uniform float dpDetail;
uniform vec3 dpSun;
uniform vec3 dpSand;
uniform vec3 dpSkyH;
uniform vec3 dpBounce;
varying float vDpDrift;
varying vec3 vDpWorld;
${FROST_NOISE}
#define DP_RELIEF .028
float dpPick(vec4 v,int i){return i==0?v.x:i==1?v.y:i==2?v.z:v.w;}
float dpSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float dpEdgeAt(float k,float salt,float jit){return k+jit*(fpHash12(vec2(k,salt))-.5);}
// Random courses: rows RH deep (jittered) along q.y, stones SL0..SL1 long along q.x. Signed distance to the
// stone's rounded outline (m, negative inside), its id, offset from its centre, half size, outline gradient.
float dpCourse(vec2 q,float RH,float SL0,float SL1,float salt0,out float id,out vec2 local,out vec2 halfSz,out vec2 grad){
  float k=floor(q.y/RH),b0=dpEdgeAt(k,3.1+salt0,.36)*RH,b1=dpEdgeAt(k+1.,3.1+salt0,.36)*RH,row=k;
  if(q.y<b0){row=k-1.;b1=b0;b0=dpEdgeAt(k-1.,3.1+salt0,.36)*RH;}
  else if(q.y>=b1){row=k+1.;b0=b1;b1=dpEdgeAt(k+2.,3.1+salt0,.36)*RH;}
  float SL=mix(SL0,SL1,fpHash12(vec2(row,7.7+salt0))),off=fpHash12(vec2(row,1.3+salt0))*SL,xs=q.x-off,salt=row*1.618+.5+salt0;
  float j=floor(xs/SL),e0=dpEdgeAt(j,salt,.44)*SL,e1=dpEdgeAt(j+1.,salt,.44)*SL,col=j;
  if(xs<e0){col=j-1.;e1=e0;e0=dpEdgeAt(j-1.,salt,.44)*SL;}
  else if(xs>=e1){col=j+1.;e0=e1;e1=dpEdgeAt(j+2.,salt,.44)*SL;}
  id=fpHash12(vec2(col+row*57.31+salt0*13.1,row-col*.731));
  halfSz=vec2(e1-e0,b1-b0)*.5;
  local=vec2(xs-(e0+e1)*.5,q.y-(b0+b1)*.5);
  vec2 r=fpHash22(vec2(id*71.3,col-row)),r2=fpHash22(vec2(row*3.3+col,id*19.1));
  float a=(r.x-.5)*.06,ca=cos(a),sa=sin(a);
  local-=(r2-.5)*vec2(.016,.01);
  local=vec2(ca*local.x-sa*local.y,sa*local.x+ca*local.y);
  halfSz-=vec2(.004+.01*r.y,.004+.008*r2.x);
  float rc=mix(.025,.07,fract(id*7.31)),jw=.004+.006*fract(id*3.17);
  vec2 s=sign(local),dq=abs(local)-(halfSz-jw-rc),dp=max(dq,0.);
  float ol=length(dp);
  vec2 g=ol>0.?dp/ol*s:(dq.x>dq.y?vec2(s.x,0.):vec2(0.,s.y));
  grad=vec2(ca*g.x+sa*g.y,-sa*g.x+ca*g.y);
  return ol+min(max(dq.x,dq.y),0.)-rc;
}
// Irregular flags: a jittered cell grid, each point paved by its nearest centre. Signed distance to the flag's
// outline (bisector with the nearest neighbour, rounded), its id, offset from its centre, a nominal half size and
// the outline's outward direction.
float dpFlag(vec2 q,float S,float salt,out float id,out vec2 local,out vec2 halfSz,out vec2 grad){
  vec2 g=q/S,gi=floor(g),gf=fract(g);
  vec2 best=vec2(0.),bc=vec2(0.);float bd=1e9;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=vec2(float(i),float(j));vec2 o=c+.12+.76*fpHash22(gi+c+salt);vec2 d=o-gf;float dd=dot(d,d);if(dd<bd){bd=dd;best=d;bc=c;}}
  float ed=1e9;vec2 en=vec2(1.,0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=bc+vec2(float(i),float(j));vec2 o=c+.12+.76*fpHash22(gi+c+salt);vec2 d=o-gf;vec2 dv=d-best;if(dot(dv,dv)>1e-5){vec2 n=normalize(dv);float e=dot(.5*(best+d),n);if(e<ed){ed=e;en=n;}}}
  id=fpHash12(gi+bc+salt*1.7);
  local=-best*S;halfSz=vec2(S*.42);grad=en;
  // ed: distance to the nearest edge (cell units, positive inside). Joints a few centimetres wide, corners rounded.
  float jw=.018+.014*fract(id*3.17);
  return -(ed*S-jw);
}
// A worn stone's height (stone units, 0 in the joint): a rounded arris, then a gently domed, tilted top.
float dpDome(float de,float id,vec2 l,vec2 h,float crown,out float slope,out vec2 crownG){
  const float R=.04;
  float x=clamp(de/R,0.,1.),e=1.-(1.-x)*(1.-x);
  vec2 tilt=(fpHash22(vec2(id*91.7,3.1))-.5)*.12,u=l/max(h,vec2(.05));
  float top=.82+.18*fract(id*5.3)+dot(l,tilt)-dot(u,u)*crown;
  slope=2.*(1.-x)/R*top;
  crownG=(tilt-2.*crown*u/max(h,vec2(.05)))*e;
  return e*top;
}
`;

const COLOR = /* glsl */ `
vec2 dpP=vDpWorld.xz;
vec2 dpDpx=dFdx(dpP),dpDpy=dFdy(dpP);
float dpFoot=length(abs(dpDpx)+abs(dpDpy));
float dpSd=1e3,dpTrod=0.,dpWear=0.,dpEnd=0.;
// The segment that owns the pixel (deepest inside, main roads first): its frame lays the courses.
float dpOwn=1e3,dpAlong=0.,dpAcross=0.,dpMain=0.,dpSeed=0.,dpHalf=1.;vec2 dpDir=vec2(0.,1.);
// The kerb: distance in from a kerbed edge, and the position along it.
float dpKIn=1e3,dpKAlong=0.;vec2 dpKAx1=vec2(1.,0.),dpKAx2=vec2(0.,1.);
float dpRag=fpNoise(dpP*.55+2.3)*.6+fpNoise(dpP*1.7)*.4;
ivec2 dpTc=clamp(ivec2(floor((dpP-dpTileGrid.xy)*dpTileGrid.z)),ivec2(0),ivec2(int(dpTileGrid.w)-1,int(dpTileRows)-1));
int dpTile=dpTc.y*int(dpTileGrid.w)+dpTc.x;
for(int q=0;q<DP_TILE_K/4;q++){
 vec4 ids=texelFetch(dpTileTex,ivec2(q,dpTile),0);
 for(int c4=0;c4<4;c4++){
  int si=int(dpPick(ids,c4))-1;
  if(si<0)break;
  vec4 s=texelFetch(dpSegTex,ivec2(0,si),0),info=texelFetch(dpSegTex,ivec2(1,si),0);
  vec2 jn=vec2(mod(info.z,2.),floor(info.z*.5)),ends=vec2(mod(info.w,2.),floor(info.w*.5));
  float isMain=mod(info.y,2.),isTrim=floor(info.y*.5);
  vec2 ab=s.zw-s.xy;float L=length(ab);vec2 dir=ab/L,ap=dpP-s.xy;
  float t=dot(ap,dir),across=dot(ap,vec2(dir.y,-dir.x));
  float ovA=-t,ovB=t-L,ovJ=max(max(ovA*jn.x,ovB*jn.y),0.);
  vec2 bd=vec2(abs(across)-info.x,max(mix(ovA,-1e3,jn.x),mix(ovB,-1e3,jn.y)));
  float sdS=ovJ>0.?length(vec2(ovJ,across))-info.x:length(max(bd,0.))+min(max(bd.x,bd.y),0.);
  dpSd=dpSmin(dpSd,sdS,.3);
  if(bd.x>1.5||max(ovA-jn.x*1.2,ovB-jn.y*1.2)>1.5)continue;
  vec2 as=texelFetch(dpSegTex,ivec2(2,si),0).xy;
  float along=t+as.x;
  // Ownership: main roads win wherever they are paved, then whichever box holds the pixel deepest.
  float own=sdS-isMain*2.;
  if(own<dpOwn){dpOwn=own;dpAlong=along;dpAcross=across;dpMain=isMain;dpSeed=as.y;dpHalf=info.x;dpDir=dir;}
  if(isTrim>.5&&t>-.05&&t<L+.05){float kin=info.x-abs(across);if(kin>-.02&&kin<dpKIn){float sg=across<0.?-1.:1.;dpKIn=kin;dpKAlong=along*sg+as.y*3.;dpKAx1=dir*sg;dpKAx2=-sg*vec2(dir.y,-dir.x);}}
  float inside=1.-smoothstep(-.3,.4,max(-t-jn.x*1.2,t-L-jn.y*1.2));
  float cw=fpNoise(vec2(along*.05,as.y))*.9;
  float x=across-cw*(isMain>.5?.5:.25);
  float lane=isMain>.5?2.2:info.x*.75;
  dpTrod=max(dpTrod,(1.-smoothstep(.2,lane*.6,abs(x)))*inside);
  dpWear=max(dpWear,(1.-smoothstep(lane*.75,lane*1.1,abs(x)+fpNoise(vec2(along*.12,as.y+9.))*.6+dpRag*.8))*inside);
  float tn=t+fpNoise(vec2(across*.8,as.y+5.))*.9+fpNoise(vec2(across*2.6,as.y))*.25;
  float buried=max(ends.x*smoothstep(2.6,-.3,tn),ends.y*smoothstep(L-2.6,L+.3,tn));
  dpEnd=max(dpEnd,buried*(1.-smoothstep(-.2,.4,bd.x)));
 }
 if(ids.w<.5)break;
}
float dpN1=fpFbm(dpP*.3+1.7),dpN2=fpNoise(dpP*1.6+4.);
// Squares: fan courses inside the paved ones, swept by the crowd.
float dpRing=0.;vec2 dpRingC=vec2(0.);float dpRingR=0.;
for(int i=0;i<DP_MAX_PLAZA;i++){if(i>=dpPlazaCount)break;vec4 q=dpPlaza[i];float d=length(dpP-q.xy);
 if(q.w>0.){dpSd=dpSmin(dpSd,d-q.w,.3);if(d<q.w-.02&&dpRing<.5){dpRing=1.;dpRingC=q.xy;dpRingR=q.w;}}
 dpWear=max(dpWear,1.-smoothstep(q.z*.5,q.z,d+dpN1*1.3+dpN2*.3+dpRag*.5));}
// The kerb belongs to the network's outline only: never across a junction.
float dpKerb=step(dpKIn,${KERB.toFixed(2)})*step(-.42,dpSd)*(1.-dpRing);
// Sand level, stone units: little in the worn middle, more at the sides, drifts at the edge and over free ends.
float dpS=.5-dpWear*1.1+dpN1*.45+dpN2*.16;
dpS+=smoothstep(.7,.9,fpNoise(dpP*.5+11.)*.5+.5+dpN2*.06)*.8;
dpS-=dpTrod*(.4+dpN2*.2);
float dpB=.12+.6*smoothstep(-.1,.8,dpRag)+dpN2*.08;
dpS+=smoothstep(-dpB-.25,-dpB+.3,dpSd)*1.1*(1.-dpKerb*.35);
// The open desert drifts a metre in over every edge, deeper where a tongue of it has crossed.
dpS+=smoothstep(-1.-dpN1*.4,-.05,dpSd)*(.55+dpN2*.3)*(1.-dpKerb*.25);
dpS+=smoothstep(.3,1.,vDpDrift)*smoothstep(-2.4-dpN1*1.2,-.2,dpSd)*1.7;
dpS+=dpEnd*(2.+dpN1*.6);
float dpAlpha=(1.-smoothstep(1.7,2.4,dpS))*(1.-smoothstep(.03,${REACH.toFixed(2)},dpSd+fpNoise(dpP*1.9)*.05));
if(dpAlpha<.004)discard;
// Courses in the owner's frame: setts across the avenue, flags along the streets, fans on the squares.
vec2 dpQ;float dpRH,dpS0,dpS1,dpSalt;
// The frame's axes in world xz, so the shadow taps can walk towards the sun in course space.
vec2 dpAx1,dpAx2;
dpQ=dpP;dpRH=dpRing>.5?.92:dpMain>.5?.62:.78;dpS0=0.;dpS1=0.;dpSalt=dpRing>.5?31.:dpMain>.5?0.:7.;dpAx1=vec2(1.,0.);dpAx2=vec2(0.,1.);
dpQ+=vec2(fpNoise(dpP*2.3),fpNoise(dpP*2.3+7.))*.014;
float dpId;vec2 dpLoc,dpHalfS,dpG;
float dpOut=dpFlag(dpQ,dpRH,dpSalt,dpId,dpLoc,dpHalfS,dpG);
float dpCrown=.3;
// Kerb stones: long, pale, set proud, with a gutter joint between them and the paving.
if(dpKerb>.5){
  vec2 kq=vec2(dpKAlong,dpKIn);float kL=mix(.7,1.15,fpHash12(vec2(floor(dpKAlong/.9),dpSalt+5.)));
  float kk=floor(kq.x/kL);vec2 kl=vec2(kq.x-(kk+.5)*kL,kq.y-${(KERB / 2).toFixed(3)});vec2 kh=vec2(kL*.5-.006,${(KERB / 2 - .02).toFixed(3)});
  vec2 dq=abs(kl)-(kh-.05),dp=max(dq,0.);float ol=length(dp);vec2 s=sign(kl);
  vec2 g=ol>0.?dp/ol*s:(dq.x>dq.y?vec2(s.x,0.):vec2(0.,s.y));
  dpOut=ol+min(max(dq.x,dq.y),0.)-.05;dpId=fpHash12(vec2(kk,7.3+dpSalt));dpLoc=kl;dpHalfS=kh;dpG=g;dpCrown=.55;dpAx1=dpKAx1;dpAx2=dpKAx2;
}
dpOut+=fpNoise(dpP*13.+dpId*9.)*.006;
float dpSlope;vec2 dpCG;float dpH=dpDome(-dpOut,dpId,dpLoc,dpHalfS,dpCrown,dpSlope,dpCG);
if(dpKerb>.5)dpH=dpH*1.5+.2;
float dpFw=max(abs(dot(dpDpx,dpG))+abs(dot(dpDpy,dpG)),1e-4);
float dpFar=smoothstep(.012,.05,dpFw),dpBlur=smoothstep(.09,.3,dpFoot);
float dpBev=smoothstep(0.,.02+dpFw,-dpOut);
float dpJc=(1.-smoothstep(-dpFw,dpFw,-dpOut-.005))*min(1.,.03/dpFw)*(1.-dpBlur*.6);
float dpTop=.82+.18*fract(dpId*5.3);
vec2 dpGq=(-dpG*dpSlope+dpCG)*DP_RELIEF*(1.-dpFar)*(1.+dpKerb);
vec2 dpGS=dpGq.x*dpAx1+dpGq.y*dpAx2;
float dpAx=clamp(-dpOut/.04,0.,1.),dpArr=1.-(1.-dpAx)*(1.-dpAx);
float dpHs=mix(dpH,dpTop*dpArr,.25)+(fract(dpId*13.7)-.5)*.12*(1.-dpBlur)+(fpNoise(dpP*5.1+dpId)*.6+fpNoise(dpP*11.3)*.4)*.14*(1.-dpFar);
float dpSw=max(.05,dpSlope*dpFw*.8)+dpFar*.1+dpBlur*.25;
dpH=mix(dpH,.6,dpFar);dpHs=mix(dpHs,.6,dpBlur);
// Sand: grains settle in the joints round every stone first, then a drift closes over whole stones.
float dpSandJ=smoothstep(-dpSw,dpSw,dpS-dpHs-.05)*(1.-dpKerb*.3);
float dpSB=dpS+fpNoise(dpP*2.7+5.1)*.12+fpNoise(dpP*7.3)*.06,dpBw=max(fwidth(dpSB),1e-4);
float dpBlanket=clamp((dpSB-1.05)/(dpBw*1.4)+.5,0.,1.);
// Toward the margin whole stones are gone, taken or buried, more of them the nearer the edge (up to about 70 %):
// the paving frays into the sand instead of ending on a line. Kerbs, set deeper, go less often.
{float gone=step(fpHash12(vec2(dpId*7.31+dpSalt,3.7)),(.7-dpKerb*.25)*smoothstep(-1.4,-.1,dpSd+dpN1*.35));
 dpBlanket=max(dpBlanket,gone*smoothstep(.0,.03+dpFw,-dpOut+.02));}
float dpSandA=max(dpSandJ,dpBlanket);
// The sun inlay in the town square: a carved sun of honey limestone set in rose sandstone, brass fillets round every
// piece and a basalt rim. Large pieces with cut joints, no small tesserae (at a grazing view those read as a checker).
float dpInlay=0.,dpBrass=0.;vec3 dpInlayC=vec3(0.);
{
  vec2 v=dpP-dpSunInlay.xy;float r=length(v);
  if(dpSunInlay.z>0.&&r<dpSunInlay.z+.2){
    float R=dpSunInlay.z,a=atan(v.y,v.x),aa=max(dpFoot*.7,.004),u=a/6.2831853*12.;
    float k=floor(u+.5),longR=mod(k,2.)<.5?R*.9:R*.68,ru=abs(u-k)/12.*6.2831853*r;
    float hw=.36*(1.-clamp((r-R*.36)/(longR-R*.36),0.,1.))+.012;
    float dRay=max(ru-hw,max(R*.38-r,r-longR));
    float inRay=1.-smoothstep(-aa,aa,dRay),disc=1.-smoothstep(R*.33-aa,R*.33+aa,r);
    float rim=smoothstep(R-.24-aa,R-.24+aa,r);
    // Field pieces: 24 radial flags in two rings; their joints.
    float fu=a/6.2831853*24.,fj=min(abs(fract(fu)-.5)*2.,1.)*6.2831853*r/24.*.5;
    float jr=abs(r-R*.66);
    float fieldJ=(1.-smoothstep(.006,.006+aa,min(abs(.5-fract(fu))*6.2831853*r/24.,jr)))*(1.-rim)*(1.-inRay)*(1.-disc);
    float fid=fpHash12(vec2(floor(fu),step(R*.66,r)));
    vec3 rose=vec3(.4,.19,.12)*(.88+.22*fid),honey=vec3(.66,.45,.21),basalt=vec3(.07,.06,.055);
    dpInlayC=mix(rose,honey*(.92+.12*fpNoise(dpP*3.)),max(inRay,disc));
    dpInlayC=mix(dpInlayC,basalt*(.9+.2*fpNoise(dpP*5.)),rim);
    dpInlayC*=1.-fieldJ*.55;
    // Brass fillets: round the rays, the disc and both edges of the rim; a brass boss in the middle.
    float fil=max(1.-smoothstep(.016,.016+aa,abs(dRay)),max(1.-smoothstep(.016,.016+aa,abs(r-R*.33)),max(1.-smoothstep(.018,.018+aa,abs(r-R+.24)),1.-smoothstep(.018,.018+aa,abs(r-R+.02)))));
    fil=max(fil,1.-smoothstep(R*.12-aa,R*.12+aa,r));
    dpBrass=fil*(1.-smoothstep(R-.02,R+.02,r));
    dpInlayC=mix(dpInlayC,vec3(.72,.5,.2)*(.85+.25*fpNoise(dpP*7.)),dpBrass);
    dpInlay=1.-smoothstep(R-aa,R+aa,r);
    dpBrass*=dpInlay;
  }
}
// Sandstone from several beds: honey, cream, rose and ochre, now and then a darker umber flag.
float dpV=fract(dpId*17.13),dpW2=fract(dpId*3.7);
vec3 dpStone=mix(vec3(.5,.35,.18),vec3(.64,.5,.29),dpW2);
dpStone=mix(dpStone,vec3(.44,.29,.17),step(.86,dpV)*.6);
dpStone=mix(dpStone,vec3(.56,.4,.18),step(.7,dpV)*step(dpV,.86)*.5);

if(dpKerb>.5)dpStone=mix(vec3(.6,.45,.28),vec3(.68,.52,.33),dpW2);
// Bedding: faint parallel laminae across each block, the grain of a sandstone.
dpStone*=.97+.05*sin(dot(dpLoc,vec2(.3,1.))*40.+dpId*30.+fpNoise(dpP*3.)*3.)*(1.-dpFar);
dpStone*=.84+.32*(fpNoise(dpP*4.7+dpId*13.)*.5+.5);
dpStone=mix(dpStone,vec3(.55,.37,.19)*(.88+.24*(fpNoise(dpP*.9+3.)*.5+.5)),dpBlur);
float dpNear=1.-smoothstep(.006,.03,dpFoot);
if(dpNear>0.)dpStone*=1.+fpNoise(dpP*41.)*.18*(1.-smoothstep(.008,.017,dpFoot))+fpNoise(dpP*97.)*.12*(1.-smoothstep(.0035,.0075,dpFoot));
// Feet polish the middle: paler, smoother, a soft sheen; off the trodden line the flags keep a darker patina.
float dpPolish=smoothstep(.25,.9,dpTrod)*(1.-dpKerb);
dpStone=mix(dpStone,mix(vec3(dot(dpStone,vec3(.33))),dpStone,.82)*1.14,dpPolish*.6);
dpStone*=mix(.88,1.,max(dpWear,dpPolish));
// Cracked flags: a jagged hairline across one flag in six, sand in the crack.
if(dpFar<.99&&fpHash12(vec2(dpId*3.1,5.7))>.83){
  vec2 cl=dpLoc/max(dpHalfS,vec2(.05));float cc=abs(cl.y-(fpNoise(cl*1.9+dpId*7.)*.55+cl.x*(fract(dpId*9.3)-.5)));
  dpStone*=1.-(1.-smoothstep(.004,.01+dpFw*1.5,cc*min(dpHalfS.x,dpHalfS.y)))*.5*(1.-dpFar)*(1.-smoothstep(.7,.95,abs(cl.x)));
}
dpStone=mix(dpStone,dpInlayC,dpInlay);
vec3 dpJoint=mix(dpSand*.5,dpSand*.7,dpN1*.5+.5);
vec3 dpRock=mix(dpStone,dpJoint,dpJc*(1.-dpInlay));
float dpRecess=clamp((dpTop*.9-max(dpS,dpH))/.55,0.,1.)*(1.-dpFar*.75)*(1.-dpSandA*.8);
vec3 dpCol=dpRock*(1.-dpRecess*.35);
// Sand over the stones is the desert's own: where it lies the paving thins away and the terrain's sand shows through,
// so the drifts, the free ends and the edges match the dunes in colour, grain and light (no seam, no rectangle).
// Carts and walkers have pressed their tracks into it: two wheel ruts wandering along each way and footprints.
float dpTrack=0.;
if(dpSandA>.02){
  float w=fpNoise(vec2(dpAlong*.035,dpSeed+1.))*(dpMain>.5?1.6:.45),g=dpMain>.5?.78:.62;
  float rut=1.-smoothstep(.045,.09+dpFoot*2.,abs(abs(dpAcross-w)-g));
  rut*=smoothstep(.2,.55,fpNoise(vec2(dpAlong*.4,dpSeed))*.5+.5+.25);
  float st=.66,k=floor(dpAlong/st),side=mod(k,2.)*2.-1.;
  vec2 fc=vec2((k+.5)*st,w*.6-.9+side*.12+fpNoise(vec2(k*.7,dpSeed+9.))*.08);
  vec2 fd=(vec2(dpAlong,dpAcross)-fc)/vec2(.13,.06);
  float print=(1.-smoothstep(.7,1.,length(fd)))*step(.35,fpHash12(vec2(k,dpSeed+4.)))*(1.-smoothstep(.04,.09,dpFoot));
  dpTrack=max(rut*.85,print*.7)*(1.-dpKerb)*smoothstep(.3,.9,dpSandA);
}
diffuseColor.rgb*=mix(dpCol,dpSand*.62,dpTrack);
diffuseColor.a*=dpAlpha*max(1.-dpSandA*.97,dpTrack*.42);
float dpShade=1.;
if(dpDetail>.5&&dpSandA<.99&&dpFar<.99&&dpKerb<.5&&dpFoot<.05){
  float sl=max(length(dpSun.xz),1e-3);vec2 sd=dpSun.xz/sl;float tanE=dpSun.y/sl,h0=max(dpH,dpS*dpSandA),occ=0.;
  for(int k=1;k<=2;k++){float d=float(k*k)*.016;float id2;vec2 l2,h2,g2,cg2;float sl2;vec2 q2=dpQ+vec2(dot(sd,dpAx1),dot(sd,dpAx2))*d;float o2=dpFlag(q2,dpRH,dpSalt,id2,l2,h2,g2);float hk=dpDome(-o2,id2,l2,h2,.3,sl2,cg2);occ=max(occ,clamp(((hk-h0)*DP_RELIEF-d*tanE)/.005,0.,1.));}
  dpShade=1.-occ*.75;
}
`;

const ROUGH = /* glsl */ `
roughnessFactor=mix(mix(mix(.86,.62,dpPolish),.97,dpSandA),.38,dpBrass);
`;

const METAL = /* glsl */ `
metalnessFactor=dpBrass*.75;
`;

const NORMAL = /* glsl */ `
{
  vec2 gSt=dpGS;
  vec2 gS=vec2(0.);
  if(dpDetail>.5&&dpNear>0.){
    float q=.02,n0=fpNoise(dpP*9.),nx=fpNoise((dpP+vec2(q,0.))*9.),nz=fpNoise((dpP+vec2(0.,q))*9.);
    vec2 gn=vec2(nx-n0,nz-n0)/q*dpNear;
    gSt+=gn*.005*dpBev*(1.-dpPolish*.6);gS+=gn*.002;
  }
  // Wind ripples on the drifts.
  vec2 wd=vec2(.8,.6);float ph=dot(dpP,wd)*9.+fpNoise(dpP*.7)*5.;
  gS+=wd*cos(ph)*.05*dpBlanket*smoothstep(.3,.08,dpFoot);
  vec2 g=mix(gSt,gS,dpSandA);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

const LIGHT = /* glsl */ `#include <lights_fragment_end>
// Golden bounce: the sunlit sand and walls all round throw warm light into the street (the sky alone left it blue-grey).
reflectedLight.indirectDiffuse+=diffuseColor.rgb*(1.-dpBrass*.75)*dpBounce*RECIPROCAL_PI;
reflectedLight.directDiffuse*=dpShade;
reflectedLight.directSpecular=min(reflectedLight.directSpecular*dpShade,vec3(.25));`;

/** Linear albedo of the town's blown sand (style sheet sand mid #c9955a, a little paler). Shared with the rocks. */
export const DAWN_SAND = new THREE.Color(.62, .4, .2);
/** The street's golden bounce (linear irradiance): the low sun off the sand and the walls, into the shade. */
export const DAWN_BOUNCE = new THREE.Color(1., .74, .38);

export interface DawnPavingOptions {
  /** Paved squares; `sun` inlays the dawn sun at the centre of that one. */
  pads?: readonly {x: number; z: number; r: number; sun?: number}[];
  /** Linear albedo of the blown sand, matched to the beach. */
  sand?: THREE.Color;
  /** Linear irradiance of the warm bounce off the sunlit sand and walls (indirect, added to the sky's). */
  bounce?: THREE.Color;
}
export interface DawnPaving {
  root: THREE.Group;
  setQuality(q: 'high' | 'low'): void;
  /** The light's direction (towards the sun) for the stones' shadow taps. */
  setSun(dir: THREE.Vector3): void;
}

function segBox(s: Seg, x: number, z: number): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = x - s.ax, pz = z - s.az;
  const t = px * ux + pz * uz, across = Math.abs(px * uz - pz * ux), ovJ = Math.max(s.first ? 0 : -t, s.last ? 0 : t - L, 0);
  if (ovJ > 0) return Math.hypot(ovJ, across) - s.half;
  const bx = across - s.half, by = Math.max(s.first ? -t : -1e3, s.last ? t - L : -1e3);
  return Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
}
function segRect(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): number {
  const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  if (inside(ax, az) || inside(bx, bz)) return 0;
  const sd = (px: number, pz: number) => { const dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  const rd = (px: number, pz: number) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(z0 - pz, 0, pz - z1));
  const cross = (cx: number, cz: number, ex: number, ez: number) => {
    const d1x = bx - ax, d1z = bz - az, d2x = ex - cx, d2z = ez - cz, den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den, u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  if (cross(x0, z0, x1, z0) || cross(x1, z0, x1, z1) || cross(x1, z1, x0, z1) || cross(x0, z1, x0, z0)) return 0;
  return Math.min(rd(ax, az), rd(bx, bz), sd(x0, z0), sd(x1, z0), sd(x0, z1), sd(x1, z1));
}

/** Dawnharbor's streets and squares (islandPaths' `covers` contract), one mesh and one draw. */
export function dawnPaving(height: (x: number, z: number) => number, paths: IslandPath[], opts: DawnPavingOptions = {}): DawnPaving {
  const root = new THREE.Group(); root.name = 'world3-sandstone-paving';
  const pads = opts.pads ?? [];
  const segs: Seg[] = [];
  paths.forEach((path, pi) => {
    let along = 0;
    for (let k = 1; k < path.points.length; k++) {
      const [ax, az] = path.points[k - 1], [bx, bz] = path.points[k], len = Math.hypot(bx - ax, bz - az);
      if (len < .001) continue;
      segs.push({ax, az, bx, bz, half: path.width / 2, main: path.width >= 6, trim: !!path.trim, along0: along, seed: pi * 7.31 + 1.3, path: pi, first: k === 1, last: k === path.points.length - 1});
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
    segs.forEach((s, k) => { if (segRect(s.ax, s.az, s.bx, s.bz, x0, z0, x0 + TILE, z0 + TILE) - s.half < TILE_REACH) list.push(k); });
    if (list.length > TILE_K) throw new Error(`dawnPaving: ${list.length} segments reach tile ${i},${j}, max ${TILE_K}`);
    tiles.push(list);
  }
  const tileOf = (x: number, z: number) => tiles[Math.min(tz - 1, Math.max(0, Math.floor((z - minZ) / TILE))) * tx + Math.min(tx - 1, Math.max(0, Math.floor((x - minX) / TILE)))];
  const padDist = (x: number, z: number) => pads.reduce((d, p) => Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r), Infinity);
  const free = (s: Seg, x: number, z: number) => padDist(x, z) >= .5 && !segs.some(o => o.path !== s.path && segBox(o, x, z) < .5);
  const sdNet = (x: number, z: number) => tileOf(x, z).reduce((d, k) => Math.min(d, segBox(segs[k], x, z)), padDist(x, z));
  const plazas: THREE.Vector4[] = pads.map(p => new THREE.Vector4(p.x, p.z, p.r * .95, p.r));
  for (const s of segs.filter(s => !s.main && (s.first || s.last))) for (const [x, z] of [...(s.first ? [[s.ax, s.az]] : []), ...(s.last ? [[s.bx, s.bz]] : [])]) {
    let best: THREE.Vector4 | null = null, bestD = Infinity;
    for (const m of segs.filter(m => m.main)) {
      const dx = m.bx - m.ax, dz = m.bz - m.az, t = Math.min(1, Math.max(0, ((x - m.ax) * dx + (z - m.az) * dz) / (dx * dx + dz * dz))), fx = m.ax + dx * t, fz = m.az + dz * t, d = Math.hypot(x - fx, z - fz);
      if (d < m.half && d < bestD) { bestD = d; best = new THREE.Vector4(fx, fz, m.half * 1.2, 0); }
    }
    if (best) plazas.push(best);
  }
  if (plazas.length > MAX_PLAZA) throw new Error(`dawnPaving: ${plazas.length} squares, max ${MAX_PLAZA}`);
  const ground = (x: number, z: number) => pavingGround(height, x, z, 3);

  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos: number[] = [], drift: number[] = [], index: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) { const x = minX + i * CELL, z = minZ + j * CELL; vid[k] = pos.length / 3; pos.push(x, ground(x, z) + LIFT, z); drift.push(dawnDrift(x, z)); }
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
    segData.set([s.ax, s.az, s.bx, s.bz, s.half, (s.main ? 1 : 0) + (s.trim ? 2 : 0), (s.first ? 0 : 1) + (s.last ? 0 : 2), endA + endB * 2, s.along0, s.seed, 0, 0], i * 12);
  });
  const tileData = new Float32Array(tiles.length * TILE_K);
  tiles.forEach((list, t) => list.forEach((k, j) => { tileData[t * TILE_K + j] = k + 1; }));
  const tex = (data: Float32Array, w: number, h: number) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  const sunPad = pads.find(p => p.sun);
  const uniforms = {
    dpSegTex: {value: tex(segData, 3, segs.length)},
    dpTileTex: {value: tex(tileData, TILE_K / 4, tiles.length)},
    dpTileGrid: {value: new THREE.Vector4(minX, minZ, 1 / TILE, tx)},
    dpTileRows: {value: tz},
    dpPlaza: {value: Array.from({length: MAX_PLAZA}, (_, i) => plazas[i] ?? new THREE.Vector4())},
    dpPlazaCount: {value: plazas.length},
    dpSunInlay: {value: new THREE.Vector3(sunPad?.x ?? 0, sunPad?.z ?? 0, sunPad?.sun ?? 0)},
    dpDetail: {value: 1},
    dpSun: {value: new THREE.Vector3(-.4, .9, .2).normalize()},
    dpSand: {value: opts.sand ?? DAWN_SAND.clone()},
    dpSkyH: {value: new THREE.Color(.9, .7, .5)},
    dpBounce: {value: opts.bounce ?? DAWN_BOUNCE.clone()},
  };
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .85, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  material.name = 'dawnharbor-sandstone-paving';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDrift;\nvarying float vDpDrift;\nvarying vec3 vDpWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvDpDrift=aDrift;vDpWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${METAL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
      .replace('#include <lights_fragment_end>', LIGHT);
  };
  material.customProgramCacheKey = () => 'dawnharbor-sandstone-paving';
  const surface = new THREE.Mesh(geo, material);
  surface.name = 'dawnharbor-paving-surface'; surface.receiveShadow = true; surface.renderOrder = -1;
  root.add(surface);
  root.userData.covers = (x: number, z: number) => onIslandPath(paths, x, z) || padDist(x, z) <= .3 || tileOf(x, z).some(k => segBox(segs[k], x, z) <= .3);
  root.userData.stats = {segments: segs.length, plazas: plazas.length - pads.length, pads: pads.length, freeEnds, cells: index.length / 6, vertices: pos.length / 3, tiles: tiles.length, maxPerTile: Math.max(...tiles.map(t => t.length)), kerbed: segs.filter(s => s.trim).length};
  return {root, setQuality(q) { uniforms.dpDetail.value = q === 'low' ? 0 : 1; }, setSun(dir) { uniforms.dpSun.value.copy(dir).normalize(); }};
}
