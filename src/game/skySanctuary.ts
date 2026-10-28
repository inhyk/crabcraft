import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {curveRings,seedBloom,seedLantern,skyRandom,sweep,type Ring} from './skyTreeGeometry';
import {SKY_COURT,SKY_GATE} from './skyTreeLayout';
import {SKY_NOISE,SKY_TREE_DETAIL,SKY_TREE_TIME,skyBarkMaterial,skyFoliageMaterials,skyLanternMaterial,skyStoneMaterial} from './skyTreeMaterials';
import {buildSkyTree,skyParts,type SkyParts} from './skyWorldTree';

/*
 * World VI's sanctuary under the world tree: the garden court (the boss arena), carved in cream limestone as rings
 * of flags round a tree-ring medallion with an eight-petal bloom inlaid across them, a glazed turquoise band at the
 * fight's edge and a raised kerb the tree's roots grip; nine carved columns with petal capitals, a living root
 * climbing each and a seed bloom lit on top; and the root gate that frames the tree from the approach.
 * skySanctuaryScene builds the tree too and merges everything into one mesh per material.
 */

type Height=(x:number,z:number)=>number;
/** The court's stone stands this far above the arena ground (flat at the arena's exact height inside r 20). */
export const SKY_COURT_LIFT=.012;
/** The kerb ring round the court: inner and outer radius. */
const KERB=[20.05,21.8] as const;

const COURT_FRAG=/* glsl */`
vec2 cq=vSkW.xz-uCourt.xy;float cr=length(cq),ca=atan(cq.y,cq.x);
float cId=0.,cEdge=1.,cInlay=0.,cGlaze=0.,cGroove=0.,cKerb=0.,cPetal=0.;
float TAU=6.28318;
if(cr<3.4){
  // Medallion: one round stone carved with tree rings, eight small turquoise petals at its heart.
  cId=1.;cEdge=3.4-cr;
  float wob=skN(vec2(ca*2.,cr*.7))*.12;
  float ring=abs(fract((cr+wob)/.62)-.5)*.62;
  cGroove=max(cGroove,(1.-smoothstep(.015,.04,ring))*step(.45,cr)*step(cr,3.15));
  float pa=mod(ca+TAU/16.,TAU/8.)-TAU/16.,pv=pa*cr,pt=(cr-.35)/1.35;
  float ph=.42*pow(max(sin(3.14159*clamp(pt,0.,1.)),0.),.7);
  float inP=step(0.,pt)*step(pt,1.)*step(abs(pv),ph);
  cGlaze=max(cGlaze,inP);
  cInlay=max(cInlay,(1.-smoothstep(.02,.05,abs(cr-3.25))));
}else if(cr<KR0){
  // Rings of flags (tree rings), each ring cut into stones with jittered joints.
  float w=(18.45-3.4)/9.,k=floor((cr-3.4)/w),r0=3.4+k*w,r1=r0+w;
  if(cr>=18.45){k=9.;r0=18.45;r1=KR0;}
  float n=floor(TAU*(r0+w*.5)/(k>8.5?.62:2.35));
  float u=(ca/TAU+.5)*n+skH12(vec2(k,3.))*9.;
  float j=floor(u),bl=j+(skH12(vec2(j,k))-.5)*.4,br=j+1.+(skH12(vec2(j+1.,k))-.5)*.4;
  if(u<bl){br=bl;j-=1.;bl=j+(skH12(vec2(j,k))-.5)*.4;}else if(u>br){bl=br;j+=1.;br=j+1.+(skH12(vec2(j+1.,k))-.5)*.4;}
  float arc=TAU*cr/n;
  cEdge=min(min(cr-r0,r1-cr),min(u-bl,br-u)*arc);
  cId=skH12(vec2(j,k+11.))+k;
  if(k>8.5){
    // The fight's edge: a band of small glazed tiles between two gold lines.
    cGlaze=step(18.62,cr)*step(cr,19.82);
    cInlay=max(1.-smoothstep(.02,.05,abs(cr-18.55)),1.-smoothstep(.02,.05,abs(cr-19.9)));
    cEdge=min(cEdge,abs(cr-18.55)+.04);
  }
  // The bloom: eight petals laid across the rings, outlined in gold, their stone warmer; a midrib groove.
  float pa=mod(ca+TAU/16.,TAU/8.)-TAU/16.,pv=pa*cr,pt=(cr-3.6)/11.6;
  float ph=2.55*pow(max(sin(3.14159*clamp(pt,0.,1.)),0.),.72);
  float d=abs(abs(pv)-ph);
  if(pt>0.&&pt<1.){
    cInlay=max(cInlay,1.-smoothstep(.035,.07,d));
    float inside=step(abs(pv),ph);
    cPetal=inside;
    cGroove=max(cGroove,inside*(1.-smoothstep(.015,.035,abs(pv)))*smoothstep(.1,.3,pt)*smoothstep(.95,.7,pt));
  }
}else{
  // Kerb: big blocks round the court, a bevelled inner lip.
  cKerb=1.;float n=48.,u=(ca/TAU+.5)*n,j=floor(u);
  cEdge=min(min(cr-KR0,KR1-cr)*1.6,min(u-j,j+1.-u)*TAU*cr/n);
  cId=skH12(vec2(j,77.));
}
// Stone, worn: a lighter polish where crabs fight, a tone per stone, lichen and stains.
float sN=skN(vSkW.xz*.5),sF=mix(.5,skN(vSkW.xz*3.1),uSkDetail);
float tone=.86+.2*fract(cId*7.13);
float mott=mix(.5,skN(vSkW.xz*.9+cId),uSkDetail);
vec3 cStone=mix(vec3(.55,.51,.41),vec3(.72,.67,.54),sN)*tone*(.9+.12*sF+.1*mott);
cStone=mix(cStone,cStone*vec3(1.06,.93,.86),cPetal);
cStone*=1.+.08*(1.-smoothstep(4.,13.,cr));
cStone=mix(cStone,cStone*.82,cKerb*.35);
float stain=smoothstep(.62,.85,skN(vSkW.xz*.23+5.));
cStone*=1.-stain*.16;
// Joints: dark, mossy toward the rim and under the tree (north), a little grass at the kerb.
float jw=.05+.02*sF;
float joint=1.-smoothstep(jw*.4,jw,cEdge);
float mossy=clamp(smoothstep(8.,20.,cr)*.55+smoothstep(.0,-14.,cq.y)*.3+(skN(vSkW.xz*.4)-.5)*.9,0.,1.);
vec3 jointC=mix(vec3(.085,.075,.065),mix(vec3(.045,.085,.03),vec3(.1,.17,.05),sF),smoothstep(.25,.75,mossy));
// Moss creeps out of the joints over the stone edges near the rim.
float creep=(1.-smoothstep(jw,jw+.22*mossy,cEdge))*smoothstep(.45,.9,mossy)*smoothstep(.5,.8,skN(vSkW.xz*1.7));
vec3 cCol=mix(cStone,jointC,max(joint,creep*.8));
// Chipped corners and a hairline across a few stones.
float crack=0.;
if(uSkDetail>.5){vec2 cd=normalize(skH22(vec2(cId,5.))-.5);float cl=dot(vSkW.xz-uCourt.xy,vec2(-cd.y,cd.x))+(skN(vSkW.xz*2.7)-.5)*.25-fract(cId*13.1)*30.+15.;
  crack=(1.-smoothstep(.004,.016,abs(cl)))*step(.72,fract(cId*3.7))*(1.-joint)*smoothstep(.1,.3,cEdge);}
cCol*=1.-crack*.35;
// Gold inlay and turquoise glaze.
vec3 gold=vec3(.66,.42,.12)*(.85+.3*sF),glaze=mix(vec3(.04,.33,.32),vec3(.1,.5,.46),sF);
float glz=cGlaze*(1.-joint);
cCol=mix(cCol,gold,cInlay*(1.-joint*.5));
cCol=mix(cCol,glaze,glz*(1.-cInlay));
cCol*=1.-cGroove*.45;
diffuseColor.rgb=cCol;
float skHeight=smoothstep(0.,.1,cEdge)*.035-cGroove*.012-crack*.01+cKerb*smoothstep(0.,.25,cEdge)*.05;
float skGlz=glz*(1.-cInlay),skGold=cInlay;
`;

/** The court floor and its kerb: one disc flat at the arena height, one ring on the ground round it. */
function courtMesh(height:Height,high:boolean):THREE.Mesh{
 const {x:cx,z:cz}=SKY_COURT,y=height(cx,cz);
 const disc=new THREE.CircleGeometry(KERB[0],high?160:96);disc.rotateX(-Math.PI/2);disc.translate(cx,y+SKY_COURT_LIFT,cz);disc.deleteAttribute('uv');
 // Kerb: top face from the inner lip to the outer edge, an inner riser down to the court and an outer skirt into the ground.
 const seg=high?192:120,pos:number[]=[],idx:number[]=[];
 const prof:[number,number][]=[[KERB[0],-1],[KERB[0]+.02,.12],[KERB[0]+.12,.15],[KERB[1]-.1,.13],[KERB[1],.06],[KERB[1]+.05,-.25]];
 for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,c=Math.cos(a),s=Math.sin(a);for(const [r,h] of prof){const x=cx+c*r,z=cz+s*r,g=height(x,z);
  pos.push(x,h===-1?y+SKY_COURT_LIFT-.01:h<0?g+h:Math.max(g,y+SKY_COURT_LIFT)+h,z);}}
 const P=prof.length;for(let i=0;i<seg;i++)for(let k=0;k<P-1;k++){const a=i*P+k,b=a+P;idx.push(a,a+1,b,a+1,b+1,b);}
 const kerb=new THREE.BufferGeometry();kerb.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));kerb.setIndex(idx);kerb.computeVertexNormals();
 const geo=mergeGeometries([disc,kerb],false)!;
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.84,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});m.name='sky-sanctuary-court';
 m.onBeforeCompile=s=>{
  s.uniforms.uCourt={value:new THREE.Vector3(cx,cz,SKY_COURT.radius)};s.uniforms.uSkDetail=SKY_TREE_DETAIL;s.uniforms.uSkTime=SKY_TREE_TIME;
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSkW;').replace('#include <fog_vertex>','#include <fog_vertex>\nvSkW=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>\nuniform vec3 uCourt;uniform float uSkDetail;uniform float uSkTime;varying vec3 vSkW;\n#define KR0 ${KERB[0].toFixed(2)}\n#define KR1 ${KERB[1].toFixed(2)}\n${SKY_NOISE}`)
   .replace('#include <color_fragment>',COURT_FRAG)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.3,skGlz);roughnessFactor=mix(roughnessFactor,.42,skGold);')
   .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,.65,skGold);')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=skPerturb(normal,-vViewPosition,skHeight,uSkDetail*(1.-smoothstep(30.,90.,length(vViewPosition))));')
   // The fight's edge breathes a faint teal: the boss ring, never brighter than the glaze it lives in.
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.05,.42,.38)*skGlz*step(18.5,cr)*(.18+.1*sin(uSkTime*1.4-ca*2.));');
 };
 const mesh=new THREE.Mesh(geo,m);mesh.name='sky-sanctuary-court';mesh.receiveShadow=true;
 return mesh;
}

/** A turned stone piece on a vertical axis: radius(h, a) from h0 to h1. aAo darkens the foot, aAo.y is moss. */
function turned(x:number,z:number,y:number,hs:number[],radius:(h:number,a:number)=>number,radial:number,ground:number):THREE.BufferGeometry{
 const rings:Ring[]=hs.map(h=>({c:new THREE.Vector3(x,y+h,z),n:new THREE.Vector3(1,0,0),b:new THREE.Vector3(0,0,1),along:h,twist:0}));
 const g=sweep(rings,radial,(j,a)=>radius(hs[j],a),(j)=>{const above=y+hs[j]-ground;return [.68+.32*THREE.MathUtils.smoothstep(above,0,1.6),THREE.MathUtils.clamp(1-above/.9,0,1)];},1);
 g.deleteAttribute('aBark');return g;
}

/** Column: moulded plinth, fluted shaft with entasis, eight-petal capital and abacus, a bowl on top. */
function column(x:number,z:number,y:number,high:boolean):THREE.BufferGeometry{
 const hs:number[]=[];
 const add=(a:number,b:number,n:number)=>{for(let i=0;i<n;i++)hs.push(a+(b-a)*i/n);};
 add(-.4,.42,2);add(.42,.5,1);add(.5,.78,4);add(.78,1.12,4);add(1.12,7.6,high?14:8);add(7.6,7.86,3);add(7.86,8.95,high?9:6);add(8.95,9.3,3);hs.push(9.3,9.34,9.38,9.56,9.62);
 const fl=(a:number)=>Math.pow(.5+.5*Math.cos(a*16),2);
 return turned(x,z,y,hs,(h,a)=>{
  const oct=1+.035*Math.pow(Math.abs(Math.cos(a*4)),8);
  if(h<.42)return 1.78*oct;
  if(h<.5)return 1.78-(h-.42)/.08*.12;
  if(h<.78)return 1.5+.14*Math.sin(Math.PI*(h-.5)/.28);
  if(h<1.12){const t=(h-.78)/.34;return 1.42-.16*Math.sin(Math.PI*t)+.0*t;}
  if(h<7.6){const t=(h-1.12)/6.48;return (1.22-.1*t+.04*Math.sin(Math.PI*t))*(1-.045*fl(a)*THREE.MathUtils.smoothstep(t,0,.04)*THREE.MathUtils.smoothstep(t,1,.96));}
  if(h<7.86)return 1.18+.1*Math.sin(Math.PI*(h-7.6)/.26);
  if(h<8.95){const t=(h-7.86)/1.09,petal=Math.pow(Math.abs(Math.cos(a*4)),3);return (1.12+.62*t*t)*(1+.14*petal*t);}
  if(h<9.3)return 1.86*oct;
  if(h<9.34)return 1.86-.3;
  if(h<9.38)return .95;
  if(h<9.56)return 1.05;
  return .8;
 },high?48:32,y);
}

/** The sanctuary's stone, roots and lights, poured into the shared parts. */
function buildSanctuary(height:Height,high:boolean,parts:SkyParts){
 const rand=skyRandom(4243),{x:cx,z:cz}=SKY_COURT,cy=height(cx,cz);
 let columns=0;
 for(let i=0;i<10;i++){
  const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=cz+Math.cos(a)*23;if(z>-56)continue;
  const g=height(x,z),y=Math.min(g,cy+.02);parts.stone.push(column(x,z,y,high));columns++;
  // A living root climbs the column from the ground to the capital, a few leaves where it rests.
  const ph=rand()*Math.PI*2,turns=1.15+rand()*.3,pts:THREE.Vector3[]=[];
  for(let k=0;k<=24;k++){const t=k/24,an=ph+t*turns*Math.PI*2,rr=(t<.06?1.9-t*8:1.34)+(t>.9?(t-.9)*3.5:0);pts.push(new THREE.Vector3(x+Math.cos(an)*rr,y-.25+t*8.2,z+Math.sin(an)*rr));}
  const c=new THREE.CatmullRomCurve3(pts),segs=high?60:34;
  parts.bark.push(sweep(curveRings(c,segs),high?8:6,j=>.26-.13*j/segs,(j)=>[.85,THREE.MathUtils.clamp(1-j/segs*6,0,1)],3));
  const col=new THREE.Color(),n=new THREE.Vector3();
  for(let k=0;k<14;k++){const t=.55+rand()*.45,q=c.getPointAt(t);n.set(q.x-x,.4,q.z-z).normalize();q.addScaledVector(n,.25);col.set(rand()<.2?'#f2b8c6':'#3f8f80').multiplyScalar(.8+rand()*.3);parts.cards.add(q,.38+rand()*.18,rand()*6.3,col,n,col.r>.5?1:0);}
  parts.lanterns.push(seedBloom(new THREE.Vector3(x,y+9.42,z),.95,rand()));parts.lanternCount++;
 }
 // The root gate: a moulded plinth each side, three roots braided up from it, leaning in to meet over the road,
 // blossom at the knot and a seed lantern hanging in the opening.
 const gy=(x:number)=>height(x,SKY_GATE.z),S=SKY_GATE.halfSpan,H=SKY_GATE.height,top=Math.max(gy(-S),gy(S),gy(0));
 for(const side of [-1,1]){
  const x=side*S,g=gy(x);
  parts.stone.push(turned(x,SKY_GATE.z,g,[-.4,.2,.9,1.0,1.08,1.25,1.4,1.45],(h,a)=>{const oct=1+.04*Math.pow(Math.abs(Math.cos(a*4)),8);return h<.9?1.45*oct:h<1.08?1.52*oct:h<1.25?1.38:h<1.4?1.3:.9;},high?40:28,g));
  const spine=new THREE.CatmullRomCurve3([new THREE.Vector3(x,g+1.2,SKY_GATE.z),new THREE.Vector3(x*.98,g+4.5,SKY_GATE.z),new THREE.Vector3(x*.9,top+7.6,SKY_GATE.z),new THREE.Vector3(x*.55,top+10.4,SKY_GATE.z),new THREE.Vector3(x*.12,top+H-.4,SKY_GATE.z),new THREE.Vector3(-x*.08,top+H-.9,SKY_GATE.z)],false,'centripetal');
  const f=spine.computeFrenetFrames(90,false);
  for(let s=0;s<3;s++){
   const pts:THREE.Vector3[]=[];
   for(let k=0;k<=90;k++){const t=k/90,an=s/3*Math.PI*2+t*Math.PI*2*2.4*side,rr=.42*(1-.35*t),p=spine.getPointAt(t);pts.push(p.addScaledVector(f.normals[k],Math.cos(an)*rr).addScaledVector(f.binormals[k],Math.sin(an)*rr));}
   const c=new THREE.CatmullRomCurve3(pts),segs=high?110:60;
   parts.bark.push(sweep(curveRings(c,segs),high?10:7,(j,a)=>(.36-.17*j/segs)*(1+.06*Math.sin(a*3+j*.3)),(j)=>[.82+.18*j/segs,THREE.MathUtils.clamp(1-j/segs*5,0,1)],4));
  }
  // Leaves along the upper half.
  const col=new THREE.Color(),n=new THREE.Vector3();
  for(let k=0;k<26;k++){const t=.4+rand()*.6,q=spine.getPointAt(t);n.set(rand()-.5,rand()*.6,rand()-.5).normalize();q.addScaledVector(n,.55);col.set(rand()<.25?'#f2b8c6':rand()<.5?'#5fae95':'#3f8f80').multiplyScalar(.85+rand()*.25);parts.cards.add(q,.5+rand()*.25,rand()*6.3,col,n,col.r>.5?1:0);}
 }
 // Blossom over the knot.
 const knot=new THREE.Vector3(0,top+H-.5,SKY_GATE.z),col=new THREE.Color(),n=new THREE.Vector3();
 for(let k=0;k<70;k++){n.set(rand()*2-1,rand()*1.4-.4,rand()*2-1).normalize();const q=knot.clone().add(new THREE.Vector3(n.x*2.4,n.y*1.3+.4,n.z*1.6));const bloom=rand()<.55;col.set(bloom?(rand()<.5?'#f2b8c6':'#f7f0ea'):(rand()<.5?'#5fae95':'#3f8f80')).multiplyScalar(.9+rand()*.15);parts.cards.add(q,bloom?.62:.7,rand()*6.3,col,n.clone().add(new THREE.Vector3(0,.4,0)).normalize(),bloom?1:0);}
 parts.lanterns.push(seedLantern(new THREE.Vector3(0,top+H-1.2,SKY_GATE.z),1.15,.3));parts.lanternCount++;
 return {columns};
}

export interface SkySanctuaryScene {root:THREE.Group;stats:Record<string,number>}

/** The world tree and its sanctuary, one mesh per material: wood, stone, leaves, lanterns, court. */
export function skySanctuaryScene(height:Height,quality:'high'|'low'):SkySanctuaryScene{
 const root=new THREE.Group();root.name='skybloom-sanctuary';const high=quality==='high';
 SKY_TREE_DETAIL.value=high?1:0;
 const parts=skyParts(),tree=buildSkyTree(height,quality,parts),sanctuary=buildSanctuary(height,high,parts);
 const merge=(list:THREE.BufferGeometry[])=>{const g=mergeGeometries(list,false)!;list.forEach(b=>b.dispose());return g;};
 const wood=new THREE.Mesh(merge(parts.bark),skyBarkMaterial());wood.name='sky-world-tree-wood';wood.castShadow=wood.receiveShadow=true;
 const stone=new THREE.Mesh(merge(parts.stone),skyStoneMaterial());stone.name='sky-sanctuary-stone';stone.castShadow=stone.receiveShadow=true;
 const fol=skyFoliageMaterials();fol.leaves.shadowSide=THREE.DoubleSide;
 const leaves=new THREE.Mesh(parts.cards.build(tree.cardHalf*1.3),fol.leaves);leaves.name='sky-world-tree-crown';leaves.customDepthMaterial=fol.depth;leaves.castShadow=leaves.receiveShadow=true;
 const lanterns=new THREE.Mesh(merge(parts.lanterns),skyLanternMaterial());lanterns.name='sky-seed-lanterns';
 const court=courtMesh(height,high);
 root.add(wood,stone,leaves,lanterns,court);
 const tris=(m:THREE.Mesh)=>(m.geometry.index?m.geometry.index.count:m.geometry.getAttribute('position').count)/3;
 const stats={...tree.stats,lanterns:parts.lanternCount,columns:sanctuary.columns,woodTriangles:tris(wood),stoneTriangles:tris(stone),courtTriangles:tris(court),meshes:root.children.length};
 root.userData.skySanctuary=stats;
 return {root,stats};
}
