import * as THREE from 'three';
import {addPatch} from '../world/materials';
import {SNOW_SURFACE_GLSL} from './snowTerrain';
import {SNOW_SLOPE_LINE,shareSnowSurface} from './snowSurface';
import type {SnowGroundUniforms} from './snowRocks';
import {fieldStream,windAt} from './snowFieldsLayout';
import {type Cornice,type DriftTail,type SastrugiRidge,snowCornices,snowSastrugi,snowTails} from './snowDriftsLayout';

/*
 * The wind's own sculpture on Frostlight's fields (layout in snowDriftsLayout.ts): lee tails behind everything that
 * stands in the wind, sastrugi carved from the crust, and cornices curling over the lee of the crests. They are the
 * snowfield itself, shaded by the very same snow shader on the same uniforms (snowSurface.ts shareSnowSurface), so
 * only their form tells them apart: a crisp crest catching the low sun, a blue lee, the dark underside of a lip.
 * Their rims are tucked under the drift and lean back to the ground's own slope, so no seam shows where they
 * meet it.
 */

type Height=(x:number,z:number)=>number;

/** Builds a world-space surface: position, aRim (0 at the rim, where the normal hands back to the ground's). */
class Sheet {
 pos:number[]=[];rim:number[]=[];idx:number[]=[];
 vert(x:number,y:number,z:number,rim:number){this.pos.push(x,y,z);this.rim.push(rim);return this.pos.length/3-1;}
 /** A grid of rows (each a list of vertex ids, all the same length), joined quad by quad. */
 grid(rows:number[][]){for(let j=0;j+1<rows.length;j++)for(let i=0;i+1<rows[j].length;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i],d=rows[j+1][i+1];this.idx.push(a,b,c,b,d,c);}}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('aRim',new THREE.Float32BufferAttribute(this.rim,1));g.setIndex(this.idx);g.computeVertexNormals();return g;}
}
const sm=(a:number,b:number,v:number)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
/** Below the drift at the rim, so the ground's own fine relief covers the join. */
const TUCK=.035;

/**
 * A lee tail: a ridge highest at the obstacle, running out downwind to a point. Two halves, so the crest stays a
 * crisp line in the low sun; the crest wanders a little off the centre line.
 */
function tailGeometry(t:DriftTail,h:Height){
 const b=new Sheet(),R=fieldStream(t.seed*977+5),c=Math.cos(t.dir),s=Math.sin(t.dir);
 const u0=-t.w*.4,nu=Math.min(18,Math.max(6,Math.round(t.len*1.7))),nv=t.h<.15?3:4,skew=(R()-.5)*.5,bow=(R()-.5)*.35;
 for(const side of [-1,1]){
  const rows:number[][]=[];
  for(let i=0;i<=nu;i++){
   const k=i/nu,u=u0+(t.len-u0)*k;
   // Wide and full at the root, a long point downwind; a slight bend, as the wind veers.
   const width=t.w*(1.08-.18*k)*Math.pow(1-k,.6)+.04,crest=t.h*Math.pow(1-k,1.35)*sm(-.02,.2,k),off=width*skew*(1-k)*.4+bow*k*k*t.len*.12;
   const row:number[]=[];
   for(let j=0;j<=nv;j++){
    const q=j/nv,v=off+side*q*width;
    // Steeper on the side the crest leans to; the flank falls off with a soft foot.
    const fall=Math.pow(1-q,side*skew>0?1.15:1.45)*(1-.15*q*q),y=crest*fall;
    const x=t.x+c*u-s*v,z=t.z+s*u+c*v,rim=Math.min(sm(0,.25,1-q),sm(1,.86,k),sm(0,.1,k));
    row.push(b.vert(x,h(x,z)+y-TUCK*(1-rim)-.008,z,rim));
   }
   rows.push(side<0?row.reverse():row);
  }
  b.grid(rows);
 }
 return b.geometry();
}

/**
 * A sastrugi ridge: a steep prow upwind, a sharp crest with one flank cut steep and the other falling gently, a long
 * tail downwind; now and then a second, smaller tier on its back.
 */
function ridgeGeometry(r:SastrugiRidge,h:Height){
 const b=new Sheet(),c=Math.cos(r.dir),s=Math.sin(r.dir),nu=9,nv=3,R=fieldStream(r.seed*331+7),wob=(R()-.5)*.6,steep=R()<.5?-1:1;
 const tiers:[number,number,number,number][]=[[0,1,1,0]];
 if(R()<.35)tiers.push([.12+R()*.2,.55+R()*.15,.6,.45]);
 for(const [shift,scale,wide,lift] of tiers){
  const len=r.len*scale,u0=r.len*shift;
  for(const side of [-1,1]){
   const rows:number[][]=[];
   for(let i=0;i<=nu;i++){
    const k=i/nu,u=u0+k*len,crest=r.h*scale*sm(0,.22,k)*Math.pow(1-k,.85)*(1+.18*Math.sin(k*9+r.seed)),width=r.w*wide*(.6+.4*sm(0,.15,k))*Math.pow(1-k*.85,.5),off=wob*r.w*k*k;
    // Base of an upper tier: on its parent's back.
    const base=lift*r.h*sm(0,.22,(u/r.len))*Math.pow(1-Math.min(1,u/r.len),.85);
    const row:number[]=[];
    for(let j=0;j<=nv;j++){
     // The cut flank is steep but rounded over at the crest, never a blade.
     const q=j/nv,fall=side===steep?1-sm(.05,.95,q):Math.pow(1-q,1.6),v=off+side*q*width;
     const x=r.x+c*u-s*v,z=r.z+s*u+c*v,rim=lift?1:Math.min(sm(0,.3,1-q),sm(0,.15,k),sm(1,.85,k));
     row.push(b.vert(x,h(x,z)+base+crest*fall-(lift?.004:TUCK*(1-rim)+.006),z,rim));
    }
    rows.push(side<0?row.reverse():row);
   }
   b.grid(rows);
  }
 }
 return b.geometry();
}

/**
 * A cornice: swept along the crest, the windward slope builds smoothly up to the crest, runs out level past it
 * over the drop, rounds over at the nose and curls back under itself to meet the lee slope.
 */
function corniceGeometry(cn:Cornice,h:Height){
 const b=new Sheet(),R=fieldStream(cn.seed*733+3),pts=cn.points,n=pts.length,ph=R()*6.283;
 // Along the crest: metres from its start, for the taper at both ends.
 const along=[0];for(let i=1;i<n;i++)along.push(along[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
 const total=along[n-1],rows:number[][]=[];
 for(let i=0;i<n;i++){
  const [px,pz]=pts[i],dir=windAt(px,pz),c=Math.cos(dir),s=Math.sin(dir),g0=h(px,pz),a=along[i];
  // Scalloped along its length, here and there fallen away to nothing.
  const end=sm(0,2.6,a)*sm(total,total-2.6,a)*(1-sm(.82,.97,Math.sin(a*.21+ph*3)*.5+.5)),wave=.72+.22*Math.sin(a*.55+ph)+.12*Math.sin(a*1.7+ph*2)+.08*Math.sin(a*3.9+ph);
  const H=cn.h*end*wave,L=(.75+.55*wave)*end+.05;
  const at=(d:number)=>h(px+c*d,pz+s*d);
  // (distance downwind of the crest, height, rim): windward build-up, the top, the nose, the curl underneath.
  const sec:[number,number,number][]=[
   [-3.6,at(-3.6)-TUCK,0],[-2.5,at(-2.5)+H*.1,.6],[-1.5,at(-1.5)+H*.34,1],[-.7,at(-.7)+H*.7,1],[0,g0+H,1],
   [L*.45,g0+H*1.03,1],[L*.82,g0+H*.97,1],[L*.98,g0+H*.86,1],[L,g0+H*.7,1],[L*.9,g0+H*.5,1],[L*.68,g0+H*.36,1],
   [L*.46,Math.min(g0+H*.24,at(L*.46)+H*.3),1],[L*.28,at(L*.28)-.05,0],
  ];
  rows.push(sec.map(([d,y,rim])=>b.vert(px+c*d,y,pz+s*d,rim*end)));
 }
 // Rows run across the crest; join them along it.
 for(let i=0;i+1<n;i++)for(let k=0;k+1<rows[i].length;k++){const a0=rows[i][k],b0=rows[i][k+1],c0=rows[i+1][k],d0=rows[i+1][k+1];b.idx.push(a0,c0,b0,b0,c0,d0);}
 return b.geometry();
}

/** The snowfield's own material on a drift mesh: the clipmap's varyings from the mesh, its slope from its normal. */
function driftMaterial(snow:THREE.Material,ground:SnowGroundUniforms){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-drift',color:'#ffffff',roughness:.62,metalness:0});
 addPatch(m,'frostlight-drift-vertex',shader=>{
  Object.assign(shader.uniforms,{snowGroundTex:ground.snowGroundTex,snowGroundRect:ground.snowGroundRect});
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>',`#include <common>\n${SNOW_SURFACE_GLSL}\nattribute float aRim;\nvarying vec3 vSnowWorld;\nvarying vec4 vSnowInfo;\nvarying vec4 vSnowWind;\nvarying vec3 vDriftN;\nvarying float vDriftRim;`)
   .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
    {
     vec4 dw=modelMatrix*vec4(transformed,1.);vec2 xz=dw.xz;vec4 g=snowGroundAt(xz);
     vDriftN=normalize(mat3(modelMatrix)*objectNormal);vDriftRim=aRim;
     // Fine sastrugi and ripples only where the face is flat enough to carry them.
     vSnowWorld=dw.xyz;vSnowInfo=vec4(.08,snowKeep(xz),snowFineKeep(xz)*(1.-g.w)*smoothstep(.55,.85,vDriftN.y),g.w);vSnowWind=snowWindField(xz);
    }`);
 });
 shareSnowSurface(m,snow);
 addPatch(m,'frostlight-drift-slope',shader=>{
  if(!shader.fragmentShader.includes(SNOW_SLOPE_LINE))console.warn('frostlight-drift: snow slope line not found');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying vec3 vDriftN;\nvarying float vDriftRim;')
   // The drift's own slope, handing back to the ground's at the rim.
   .replace(SNOW_SLOPE_LINE,`${SNOW_SLOPE_LINE}\n  {vec3 dn=normalize(vDriftN);sGrad=mix(sGrad,-dn.xz/max(dn.y,.15),smoothstep(0.,1.,vDriftRim));}`)
   // Faces past the vertical (a cornice's nose and its underside) keep their true normal.
   .replace('normal=normalize((viewMatrix*vec4(sN,0.)).xyz);',`{vec3 dn=normalize(vDriftN);sN=normalize(mix(sN,dn,smoothstep(.45,.1,dn.y)));}\n  normal=normalize((viewMatrix*vec4(sN,0.)).xyz);`);
 });
 return m;
}

export interface SnowDrifts {
 group:THREE.Group;
 setQuality(q:'high'|'low'):void;
 /** Shows the small pieces only near the player, so neither pass draws what would be under a pixel or two. */
 update(x:number,z:number):void;
 stats:{tails:number;ridges:number;cornices:number};
}

/**
 * Every drift in one BatchedMesh, each piece culled on its own: one draw and one shadow draw. Low quality hides the
 * sastrugi and the small tails.
 */
export function snowDrifts(opts:{height:Height;snow:THREE.Material;ground:SnowGroundUniforms}):SnowDrifts{
 const h=opts.height,group=new THREE.Group();group.name='frostlight-drifts';
 const items:{geo:THREE.BufferGeometry;fine:boolean;x:number;z:number;reach:number}[]=[];
 const tails=snowTails(),ridges=snowSastrugi(),cornices=snowCornices(h);
 // How far off each piece still shows: by its size, tufts' tails close in, a boulder's across the field.
 for(const t of tails)items.push({geo:tailGeometry(t,h),fine:!!t.fine,x:t.x,z:t.z,reach:Math.min(140,30+t.h*160+t.len*6)});
 for(const r of ridges)items.push({geo:ridgeGeometry(r,h),fine:true,x:r.x,z:r.z,reach:Math.min(110,40+r.h*250+r.len*10)});
 for(const c of cornices)items.push({geo:corniceGeometry(c,h),fine:false,x:c.points[0][0],z:c.points[0][1],reach:1e4});
 let verts=0,index=0;for(const it of items){verts+=it.geo.getAttribute('position').count;index+=it.geo.index!.count;}
 const bm=new THREE.BatchedMesh(items.length,verts,index,driftMaterial(opts.snow,opts.ground));
 bm.name='frostlight-drifts';bm.sortObjects=false;bm.perObjectFrustumCulled=true;bm.castShadow=bm.receiveShadow=true;
 const ids:number[]=[];
 for(const it of items){ids.push(bm.addInstance(bm.addGeometry(it.geo)));it.geo.dispose();}
 bm.computeBoundingBox();bm.computeBoundingSphere();group.add(bm);
 let quality:'high'|'low'='high',lx=1e9,lz=1e9;
 const refresh=()=>{items.forEach((it,i)=>{const show=(quality==='high'||!it.fine)&&Math.hypot(it.x-lx,it.z-lz)<it.reach;if(bm.getVisibleAt(ids[i])!==show)bm.setVisibleAt(ids[i],show);});};
 return {group,stats:{tails:tails.length,ridges:ridges.length,cornices:cornices.length},
  setQuality(q){if(q===quality)return;quality=q;refresh();},
  update(x,z){if(Math.hypot(x-lx,z-lz)<4)return;lx=x;lz=z;refresh();}};
}
