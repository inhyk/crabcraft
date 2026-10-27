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
dpS+=smoothstep(-dpB-.25,-dpB+.3,dpSd)*1.1*(1.-dpKerb*.75);
dpS+=smoothstep(.3,1.,vDpDrift)*smoothstep(-2.4-dpN1*1.2,-.2,dpSd)*1.7;
dpS+=dpEnd*(2.+dpN1*.6);
float dpAlpha=(1.-smoothstep(1.7,2.4,dpS))*(1.-smoothstep(.03,${REACH.toFixed(2)},dpSd+fpNoise(dpP*1.9)*.05));
if(dpAlpha<.004)discard;
// Courses in the owner's frame: setts across the avenue, flags along the streets, fans on the squares.
vec2 dpQ;float dpRH,dpS0,dpS1,dpSalt;
// The frame's axes in world xz, so the shadow taps can walk towards the sun in course space.
vec2 dpAx1,dpAx2;
if(dpRing>.5){vec2 v=dpP-dpRingC;float r=length(v);dpQ=vec2(atan(v.y,v.x)*max(r,.6),r);dpRH=.36;dpS0=.34;dpS1=.56;dpSalt=31.;dpAx2=v/max(r,1e-3);dpAx1=vec2(-dpAx2.y,dpAx2.x);}
else if(dpMain>.5){dpQ=vec2(dpAcross,dpAlong);dpRH=.27;dpS0=.24;dpS1=.44;dpSalt=0.;dpAx1=vec2(dpDir.y,-dpDir.x);dpAx2=dpDir;}
else{dpQ=vec2(dpAlong,dpAcross+dpHalf);dpRH=.52;dpS0=.48;dpS1=.86;dpSalt=dpSeed*3.7;dpAx1=dpDir;dpAx2=vec2(dpDir.y,-dpDir.x);}
dpQ+=vec2(fpNoise(dpP*2.3),fpNoise(dpP*2.3+7.))*.014;
float dpId;vec2 dpLoc,dpHalfS,dpG;
float dpOut=dpCourse(dpQ,dpRH,dpS0,dpS1,dpSalt,dpId,dpLoc,dpHalfS,dpG);
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
float dpSandJ=smoothstep(-dpSw,dpSw,dpS-dpHs-.05)*(1.-dpKerb*.5);
float dpSB=dpS+fpNoise(dpP*2.7+5.1)*.12+fpNoise(dpP*7.3)*.06,dpBw=max(fwidth(dpSB),1e-4);
float dpBlanket=clamp((dpSB-1.05)/(dpBw*1.4)+.5,0.,1.);
float dpSandA=max(dpSandJ,dpBlanket);
// The sun inlay in the town square: honey rays on rose, in small square tesserae.
float dpInlay=0.;vec3 dpInlayC=vec3(0.);
{
  vec2 v=dpP-dpSunInlay.xy;float r=length(v);
  if(dpSunInlay.z>0.&&r<dpSunInlay.z+.12){
    vec2 tq=v/.11,tc=floor(tq),tf=fract(tq)-.5;vec2 cv=(tc+.5)*.11;float cr=length(cv),ca=atan(cv.y,cv.x);
    float R=dpSunInlay.z,ray=abs(fract(ca/6.2831853*12.)-.5)*2.;
    float rayLen=mix(.6,1.,step(.5,fract(ca/6.2831853*6.+.25)));
    float disc=step(cr,R*.34),rim=step(abs(cr-R*.4),.06),rayM=step(R*.44,cr)*step(cr,R*rayLen)*step(ray,(1.-(cr-R*.44)/(R*rayLen-R*.44))*.75);
    float band=step(abs(cr-R+.08),.07);
    float th=fpHash12(tc);
    vec3 rose=vec3(.42,.17,.11),honey=vec3(.68,.45,.16),cream=vec3(.62,.55,.42),deep=vec3(.2,.11,.07);
    dpInlayC=mix(cream,rose,step(.5,th*.4+.3))*.9;
    dpInlayC=mix(dpInlayC,honey,max(disc,rayM));
    dpInlayC=mix(dpInlayC,deep,max(rim,band));
    dpInlayC*=.84+.3*fract(th*7.1);
    float te=max(abs(tf.x),abs(tf.y));
    dpInlay=step(cr,R)*(1.-smoothstep(.5-.08,.5,te)*.7*(1.-dpBlur));
    dpInlayC=mix(dpInlayC,vec3(.16,.13,.1),smoothstep(.42,.5,te)*(1.-dpBlur)*.7);
  }
}
// Sandstone from several beds: honey, cream, rose and ochre, now and then a dark basalt sett.
float dpV=fract(dpId*17.13),dpW2=fract(dpId*3.7);
vec3 dpStone=mix(vec3(.36,.24,.13),vec3(.5,.39,.25),dpW2);
dpStone=mix(dpStone,vec3(.42,.21,.14),step(.8,dpV)*.8);
dpStone=mix(dpStone,vec3(.5,.34,.14),step(.66,dpV)*step(dpV,.8)*.6);
dpStone=mix(dpStone,vec3(.13,.12,.115),step(dpV,.05)*dpMain*(1.-dpRing));
if(dpKerb>.5)dpStone=mix(vec3(.55,.5,.41),vec3(.64,.58,.47),dpW2);
// Bedding: faint parallel laminae across each block, the grain of a sandstone.
dpStone*=.9+.14*sin(dot(dpLoc,vec2(.3,1.))*48.+dpId*30.+fpNoise(dpP*3.)*2.)*(1.-dpFar);
dpStone*=.84+.32*(fpNoise(dpP*4.7+dpId*13.)*.5+.5);
dpStone=mix(dpStone,vec3(.4,.29,.18)*(.88+.24*(fpNoise(dpP*.9+3.)*.5+.5)),dpBlur);
float dpNear=1.-smoothstep(.006,.03,dpFoot);
if(dpNear>0.)dpStone*=1.+fpNoise(dpP*41.)*.18*(1.-smoothstep(.008,.017,dpFoot))+fpNoise(dpP*97.)*.12*(1.-smoothstep(.0035,.0075,dpFoot));
// Feet polish the middle: paler, less grain, a soft sheen.
float dpPolish=smoothstep(.25,.9,dpTrod)*(1.-dpKerb);
dpStone=mix(dpStone,mix(vec3(dot(dpStone,vec3(.33))),dpStone,.75)*1.16,dpPolish*.7);
dpStone=mix(dpStone,dpInlayC,dpInlay*(1.-dpRing*0.)*step(.5,dpInlay));
vec3 dpJoint=mix(vec3(.11,.085,.06),vec3(.2,.16,.11),dpN1*.5+.5);
vec3 dpRock=mix(dpStone,dpJoint,dpJc*(1.-step(.5,dpInlay)));
// Sand: dry and pale on the drifts, darker and finer packed in the joints.
vec3 dpSandC=dpSand*(.92+.12*fpNoise(dpP*3.1));
dpSandC=mix(dpSandC*.8,dpSandC,smoothstep(.0,.6,dpS-dpHs));
vec3 dpCol=mix(dpRock,dpSandC,dpSandA);
float dpRecess=clamp((dpTop*.9-max(dpS,dpH))/.55,0.,1.)*(1.-dpFar*.75)*(1.-dpSandA*.8);
dpCol*=1.-dpRecess*.35;
// Sand ripples on the drifts.
float dpRip=sin(dot(dpP,vec2(.8,.6))*9.+fpNoise(dpP*.7)*5.)*.5+.5;
dpCol*=1.-dpBlanket*dpRip*.06*(1.-dpBlur);
diffuseColor.rgb*=dpCol;
diffuseColor.a*=dpAlpha;
float dpShade=1.;
if(dpDetail>.5&&dpSandA<.99&&dpFar<.99&&dpKerb<.5){
  float sl=max(length(dpSun.xz),1e-3);vec2 sd=dpSun.xz/sl;float tanE=dpSun.y/sl,h0=max(dpH,dpS*dpSandA),occ=0.;
  for(int k=1;k<=3;k++){float d=float(k*k)*.012;float id2;vec2 l2,h2,g2,cg2;float sl2;float o2=dpCourse(dpQ+vec2(dot(sd,dpAx1),dot(sd,dpAx2))*d,dpRH,dpS0,dpS1,dpSalt,id2,l2,h2,g2);float hk=dpDome(-o2,id2,l2,h2,.3,sl2,cg2);occ=max(occ,clamp(((hk-h0)*DP_RELIEF-d*tanE)/.005,0.,1.));}
  dpShade=1.-occ*.75;
}
`;

const ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.86,.62,dpPolish),.97,dpSandA);
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
reflectedLight.directDiffuse*=dpShade;
reflectedLight.directSpecular=min(reflectedLight.directSpecular*dpShade,vec3(.25));`;

export interface DawnPavingOptions {
  /** Paved squares; `sun` inlays the dawn sun at the centre of that one. */
  pads?: readonly {x: number; z: number; r: number; sun?: number}[];
  /** Linear albedo of the blown sand, matched to the beach. */
  sand?: THREE.Color;
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
    dpSand: {value: opts.sand ?? new THREE.Color(.6, .49, .31)},
    dpSkyH: {value: new THREE.Color(.9, .7, .5)},
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
