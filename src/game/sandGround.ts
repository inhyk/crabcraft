import { CZ, DAWN_SEA, HARBOUR, DAWN_WIND, DUNE_DRIFT, DUNE_FIELD, DUNE_SEA, KEEP_DISCS, KEEP_SEGS, RX, RZ, SAND_ROCKS } from '../sim/world/dawnGround';
import { DAWN_ARENA_HEIGHT } from '../sim/world/ground';

/*
 * GLSL twin of src/sim/world/dawnGround.ts, line for line: Goldsand's ground height (the dawn coast kept on gameplay
 * ground, the wind-shaped desert everywhere else) and the mask of where gameplay keeps its ground. The clipmap bakes
 * it once on the GPU (sandTerrain.ts). Keep the two in step: tools/qa-dawn-sand.mjs holds the GPU to dawnHeight().
 * The integer hash runs on uints, so the lattice is bit-identical; the rest is float maths a few ulps apart.
 */

const f = (v: number) => (Number.isInteger(v) ? `${v}.` : `${+v.toFixed(8)}`);
const duneConst = (name: string, k: { lambda: number; height: number; slip: number; crest: number; seed: number }) =>
  `const vec4 ${name}=vec4(${f(k.lambda)},${f(k.height)},${f(k.slip)},${f(k.crest)});const float ${name}_SEED=${f(k.seed)};`;

export const SAND_GROUND_GLSL = /* glsl */ `
const float SG_RX=${f(RX)},SG_RZ=${f(RZ)},SG_CZ=${f(CZ)};
const float SG_SEA=${f(DAWN_SEA)};
const float SG_ARENA=${f(DAWN_ARENA_HEIGHT)};
const vec2 SG_WIND=vec2(${f(DAWN_WIND[0])},${f(DAWN_WIND[1])});
const vec2 SG_COAST_WIND=vec2(.34,-.94);
${duneConst('SG_DUNE_SEA', DUNE_SEA)}
${duneConst('SG_DUNE_FIELD', DUNE_FIELD)}
${duneConst('SG_DUNE_DRIFT', DUNE_DRIFT)}
const vec4 SG_KEEP_SEGS[${KEEP_SEGS.length}]=vec4[${KEEP_SEGS.length}](${KEEP_SEGS.map((s) => `vec4(${f(s[0])},${f(s[1])},${f(s[2])},${f(s[3])})`).join(',')});
const float SG_KEEP_SEGW[${KEEP_SEGS.length}]=float[${KEEP_SEGS.length}](${KEEP_SEGS.map((s) => f(s[4])).join(',')});
const vec3 SG_KEEP_DISCS[${KEEP_DISCS.length}]=vec3[${KEEP_DISCS.length}](${KEEP_DISCS.map((d) => `vec3(${f(d[0])},${f(d[1])},${f(d[2])})`).join(',')});
const vec3 SG_ROCKS[${SAND_ROCKS.length}]=vec3[${SAND_ROCKS.length}](${SAND_ROCKS.map((d) => `vec3(${f(d[0])},${f(d[1])},${f(d[2])})`).join(',')});
float sg01(float t){t=clamp(t,0.,1.);return t*t*(3.-2.*t);}
float sgStep(float x,float a,float b){return sg01((x-a)/(b-a));}
float sgHash(vec2 p){
  ivec2 i=ivec2(p);
  uint h=uint(i.x)*0x27d4eb2du^uint(i.y)*0x165667b1u;
  h=(h^(h>>15u))*0x2c1b3c6du;
  h=(h^(h>>12u))*0x297a2d39u;
  h^=h>>15u;
  return float(h>>8u)/16777216.;
}
// Quintic value noise, -1..1 (dawnNoise).
float sgNoise(vec2 p){
  vec2 i=floor(p),q=p-i,u=q*q*q*(q*(q*6.-15.)+10.);
  float a=sgHash(i),b=sgHash(i+vec2(1.,0.)),c=sgHash(i+vec2(0.,1.)),d=sgHash(i+vec2(1.));
  return (a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y)*2.-1.;
}
float sgFbm(vec2 p,int octaves){
  float s=0.,a=.5,n=0.;
  for(int i=0;i<3;i++){
    if(i>=octaves)break;
    s+=a*sgNoise(p);n+=a;
    p=vec2(1.6*p.x+1.2*p.y+7.3,-1.2*p.x+1.6*p.y-3.1);a*=.5;
  }
  return s/n;
}
float sgSegDist(vec2 p,vec4 s){vec2 d=s.zw-s.xy,q=p-s.xy;float l2=dot(d,d),t=l2>0.?clamp(dot(q,d)/l2,0.,1.):0.;return length(q-d*t);}
// keepCore: the town block, the lanes and every kept point (negative inside).
float sgKeepCore(vec2 p){
  float qx=abs(p.x)-50.,qz=abs(p.y-68.)-54.;
  float d=length(max(vec2(qx,qz),0.))+min(max(qx,qz),0.);
  for(int i=0;i<${KEEP_SEGS.length};i++)d=min(d,sgSegDist(p,SG_KEEP_SEGS[i])-SG_KEEP_SEGW[i]);
  for(int i=0;i<${KEEP_DISCS.length};i++)d=min(d,length(p-SG_KEEP_DISCS[i].xy)-SG_KEEP_DISCS[i].z);
  return d;
}
float sgRadius(vec2 p){return length(vec2(p.x/SG_RX,(p.y-SG_CZ)/SG_RZ));}
float sgOldInland(vec2 p){
  float upland=13.*sgStep(-p.y,5.,55.);
  float hills=sin(p.x*.045)*sin(p.y*.04)*2.*(1.-exp(-p.x*p.x/400.));
  return 4.+upland+hills;
}
float sgShoreStart(vec2 p){
  float a=atan(p.x/SG_RX,(p.y-SG_CZ)/SG_RZ);
  float n=sgFbm(vec2(cos(a)*1.9+4.1,sin(a)*1.9-2.7),3);
  return .845+.075*sg01(n*.9+.45);
}
// The dawn coast's dune rim behind the southern beaches.
float sgCoastDunes(vec2 p){
  float a=dot(p,SG_COAST_WIND),c=-p.x*SG_COAST_WIND.y+p.y*SG_COAST_WIND.x;
  float warp=sgNoise(vec2(c*.03+5.2,a*.02-1.9))*2.2;
  float r=1.-abs(sgNoise(vec2(a/17.+warp,c/42.+3.7)));
  return r*r*(3.-2.*r)*sg01(sgNoise(p/36.+vec2(-8.1,2.4))*1.2+.55);
}
float sgShore(vec2 p,float h,float t){
  if(t<=0.)return h;
  float cliff=sgStep(h,6.5,10.5);
  float beach=t<.06?h+(SG_SEA-.55-h)*sg01(t/.06):SG_SEA-.55-(t-.06)*60.;
  float face=.024,foot=.9+sgNoise(p*.2)*.5;
  float bluff=t<face?h+(foot-h)*pow(sg01(t/face),.8):foot-(t-face)*75.;
  return max(-16.,beach+(bluff-beach)*cliff);
}
float sgCoastGround(vec2 p){
  float r=sgRadius(p);
  float open=sg01(max(0.,min(sgKeepCore(p),p.y+30.))/12.);
  float h=sgOldInland(p);
  if(open>0.){
    float rolling=sgFbm(p/42.+vec2(1.7,-6.3),3)*3.1;
    float south=sgStep(p.y,10.,70.);
    float rim=sgStep(r,.56,.8)*(3.6-1.6*south);
    float dune=sgCoastDunes(p)*2.3*south*sgStep(r,.6,.76);
    h+=open*(rolling+rim+dune);
  }
  h=sgShore(p,h,r-sgShoreStart(p));
  // The harbour keeps the old island's ground (dawnGround.ts oldGround, harbourBlend).
  float old=r>.86?4.-max(0.,r-.83)*65.:sgOldInland(p);
  vec2 hd=max(max(vec2(${f(HARBOUR[0])},${f(HARBOUR[2])})-p,p-vec2(${f(HARBOUR[1])},${f(HARBOUR[3])})),vec2(0.));
  float keep=sg01(length(hd)/12.);
  return old+(h-old)*keep;
}
float sgSmin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
// One dune class riding on the smaller dunes under it (dune() in dawnGround.ts).
float sgDune(float a,float c,vec4 k,float seed,float amp,float under){
  float L=k.x;
  float seg=sg01((sgNoise(vec2(c/(1.7*L)+seed,a/(4.3*L)-seed))+.25)/.7);
  float H=k.y*amp*seg;
  float phase=a/L+.55*sgNoise(vec2(c/(2.6*L)-seed,a/(5.1*L)+2.3))+.12*sgNoise(vec2(c/(.9*L)+5.1,a/(6.*L)-seed))-.2*(1.-seg);
  float t=phase-floor(phase);
  float d=(t-k.w)*L,stoss=k.w*L;
  float kc=.1+.07*H,kf=.25+.2*H;
  float u=clamp(1.-abs(d)/stoss,0.,1.),s=u*u*(2.-u);
  float ys=under+(H+kf)*s-kf,yl=H-k.z*d;
  float e=sgSmin(ys,yl,kc)-under;
  return under+(e>=kf?e:e<=-kf?0.:(e+kf)*(e+kf)/(4.*kf));
}
float sgRockSand(vec2 p){
  float h=0.;
  for(int i=0;i<${SAND_ROCKS.length};i++){
    vec3 k=SG_ROCKS[i];vec2 d=p-k.xy;float r=k.z;
    if(abs(d.x)>r*7.||abs(d.y)>r*7.)continue;
    float a=dot(d,SG_WIND)/r,c=(-d.x*SG_WIND.y+d.y*SG_WIND.x)/r,d2=a*a+c*c;
    float rise=a>0.?1.-exp(-a*1.8):0.;
    h+=exp(-d2*.9)*.18*r+rise*rise*exp(-a/2.4)*exp(-c*c*1.3)*.3*r;
    if(a<0.){float m=sqrt(d2)-1.2;h-=exp(-m*m*6.)*sg01(-a*2.)*.08*r;}
  }
  return h;
}
// sandOpen: 0 on gameplay ground, 1 in the open.
float sandOpen(vec2 p){
  float r=sgRadius(p);
  float d=sgKeepCore(p);
  d=min(d,max(p.y+30.,(r-.86)*130.));
  float hx=abs(p.x+10.)-30.,hz=abs(p.y-125.)-35.;
  d=min(d,length(max(vec2(hx,hz),0.))+min(max(hx,hz),0.));
  return sg01(max(0.,d)/12.);
}
float sandMainland(vec2 p){
  vec2 e=vec2(p.x/SG_RX,(p.y-SG_CZ)/SG_RZ);float l=length(e);
  if(l<1e-6)return 0.;
  float wander=sgFbm(p/70.+vec2(9.1,-4.4),2)*.32;
  return sgStep(dot(e,vec2(-.8660254,-.5))/l+wander,.34,.72);
}
float sgSandGround(vec2 p){
  float r=sgRadius(p),m=sandMainland(p);
  float a=dot(p,SG_WIND),c=-p.x*SG_WIND.y+p.y*SG_WIND.x;
  float far=m*sgStep(r,.9,1.6);
  float h=sgOldInland(p)-13.*sgStep(-p.y,5.,55.)*far+sgFbm(vec2(a/90.+4.2,c/140.-1.3),2)*1.6+m*sgStep(r,.84,1.5)*7.;
  float sand=sgDune(a*.996+c*.087,c*.996-a*.087,SG_DUNE_DRIFT,SG_DUNE_DRIFT_SEED,sgStep(sgNoise(p/23.+vec2(7.7,-3.1)),-.3,.3),0.);
  sand=sgDune(a,c,SG_DUNE_FIELD,SG_DUNE_FIELD_SEED,.45+.55*sgStep(r,.3,.8),sand);
  float big=m*sgStep(r,.84,1.3);
  if(big>0.)sand=sgDune(a,c,SG_DUNE_SEA,SG_DUNE_SEA_SEED,big,sand);
  h+=sand;
  h+=sgRockSand(p);
  float s0=sgShoreStart(p),start=s0+(12.-s0)*m;
  return sgShore(p,h,r-start);
}
// dawnHeight(): the dawn coast on gameplay ground, the desert elsewhere, the arena at its height.
float sandGroundH(vec2 p){
  float open=sandOpen(p),h;
  if(open<=0.)h=sgCoastGround(p);
  else if(open>=1.)h=sgSandGround(p);
  else{float c=sgCoastGround(p);h=c+(sgSandGround(p)-c)*open;}
  float arena=1.-sgStep(length(vec2(p.x,p.y+72.)),21.,31.);
  return h+(SG_ARENA-h)*arena;
}
`;
