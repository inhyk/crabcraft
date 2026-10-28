import * as THREE from 'three';

/*
 * Swept geometry for World VI's world tree and sanctuary: rings along a path (trunk, limbs, roots, vines), billboard
 * leaf cards and the seed lanterns. Every bark piece carries position, normal, aBark and aAo so they merge into one
 * mesh; cards carry position (centre), normal, color, uv, aCorner, aSize; lanterns position, normal, color, aGlow.
 */

export interface Ring {c:THREE.Vector3;n:THREE.Vector3;b:THREE.Vector3;along:number;twist:number}

/** Seeded random in [0,1). */
export function skyRandom(seed:number){let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

/** Rings along a curve (parallel-transported frames; b = n x tangent so faces point out), `along` in metres. */
export function curveRings(curve:THREE.Curve<THREE.Vector3>,segs:number,twist=0):Ring[]{
 const f=curve.computeFrenetFrames(segs,false),len=curve.getLength(),rings:Ring[]=[];
 for(let j=0;j<=segs;j++){const u=j/segs;rings.push({c:curve.getPointAt(u),n:f.normals[j].clone(),b:f.binormals[j].clone().negate(),along:u*len,twist:u*twist});}
 return rings;
}

/**
 * A closed sweep: ring j, angle a (radians round n->b) at radius(j,a). aBark.x counts `furrows` round the ring (an
 * integer, so the pattern meets itself at the seam), plus the ring's twist; aAo = ao(j,a,point).
 */
export function sweep(rings:Ring[],radial:number,radius:(j:number,a:number)=>number,ao:(j:number,a:number,p:THREE.Vector3)=>[number,number],furrows:number):THREE.BufferGeometry{
 const n=rings.length,pos=new Float32Array(n*(radial+1)*3),bark=new Float32Array(n*(radial+1)*2),occ=new Float32Array(n*(radial+1)*2),idx:number[]=[];
 const p=new THREE.Vector3();let v=0;
 for(let j=0;j<n;j++){const R=rings[j];for(let k=0;k<=radial;k++){
  const a=k/radial*Math.PI*2,r=radius(j,a),c=Math.cos(a)*r,s=Math.sin(a)*r;
  p.set(R.c.x+R.n.x*c+R.b.x*s,R.c.y+R.n.y*c+R.b.y*s,R.c.z+R.n.z*c+R.b.z*s);
  pos.set([p.x,p.y,p.z],v*3);bark.set([k/radial*furrows+R.twist,R.along],v*2);occ.set(ao(j,a,p),v*2);v++;
 }}
 for(let j=0;j<n-1;j++)for(let k=0;k<radial;k++){const a=j*(radial+1)+k,b=a+radial+1;idx.push(a,b,a+1,a+1,b,b+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('aBark',new THREE.BufferAttribute(bark,2));g.setAttribute('aAo',new THREE.BufferAttribute(occ,2));g.setIndex(idx);
 g.computeVertexNormals();
 // The seam's two copies of each ring point share one normal, so no lighting crease runs down the wood.
 const nr=g.getAttribute('normal') as THREE.BufferAttribute,t=new THREE.Vector3(),u=new THREE.Vector3();
 for(let j=0;j<n;j++){const a=j*(radial+1),b=a+radial;t.fromBufferAttribute(nr,a).add(u.fromBufferAttribute(nr,b)).normalize();nr.setXYZ(a,t.x,t.y,t.z);nr.setXYZ(b,t.x,t.y,t.z);}
 return g;
}

/** Billboard cards gathered into one geometry. */
export class CardBatch{
 private pos:number[]=[];private nor:number[]=[];private col:number[]=[];private uv:number[]=[];private corner:number[]=[];private size:number[]=[];private idx:number[]=[];
 count=0;
 /** atlas 0: leaves, 1: blossoms. */
 add(p:THREE.Vector3,half:number,rot:number,color:THREE.Color,normal:THREE.Vector3,atlas:0|1){
  const c=Math.cos(rot),s=Math.sin(rot),base=this.count*4;
  for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
   this.pos.push(p.x,p.y,p.z);this.nor.push(normal.x,normal.y,normal.z);this.col.push(color.r,color.g,color.b);
   this.uv.push(atlas*.5+(x+1)*.25,(y+1)*.5);this.corner.push(x*c-y*s,x*s+y*c);this.size.push(half);
  }
  this.idx.push(base,base+1,base+2,base,base+2,base+3);this.count++;
 }
 build(maxHalf:number):THREE.BufferGeometry{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nor,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
  g.setAttribute('aCorner',new THREE.Float32BufferAttribute(this.corner,2));g.setAttribute('aSize',new THREE.Float32BufferAttribute(this.size,1));
  g.setIndex(this.idx);g.computeBoundingBox();g.boundingBox!.expandByScalar(maxHalf*1.5+1);g.computeBoundingSphere();g.boundingSphere!.radius+=maxHalf*1.5+1;
  return g;
 }
}

/**
 * A seed lantern hanging at `top`: a ribbed husk (eight ribs) lit between them, a honey wood cap and a small drip at
 * the bottom. aGlow = (glow, phase).
 */
export function seedLantern(top:THREE.Vector3,scale:number,phase:number):THREE.BufferGeometry{
 const radial=24,rows=14,H=1.55*scale,pos:number[]=[],col:number[]=[],glow:number[]=[],idx:number[]=[];
 const rib=new THREE.Color('#9a6a3c'),skin=new THREE.Color('#ffe2a8'),cap=new THREE.Color('#6d4a2c');
 const c=new THREE.Color();
 const profile:[number,number,number][]=[];// (radius, y down from top, kind 0 cap 1 husk 2 drip)
 profile.push([.001,0,0],[.16,-.02,0],[.2,-.1,0],[.13,-.16,0]);
 for(let i=0;i<=rows;i++){const t=i/rows,r=Math.pow(Math.sin(Math.PI*(.06+.9*t)),.85)*.5*(1-.18*t)+.06;profile.push([r,-.16-t*(H-.36),1]);}
 profile.push([.07,-H+.16,2],[.04,-H+.02,2],[.001,-H,2]);
 for(let j=0;j<profile.length;j++){const [r,y,kind]=profile[j];for(let k=0;k<=radial;k++){
  const a=k/radial*Math.PI*2,ribK=Math.pow(Math.abs(Math.cos(a*4)),10),rr=r*scale*(kind===1?1+.07*ribK:1);
  pos.push(top.x+Math.cos(a)*rr,top.y+y,top.z+Math.sin(a)*rr);
  if(kind===1){c.copy(skin).lerp(rib,ribK);glow.push((1-ribK*.85)*(.55+.45*Math.sin(Math.PI*(j-4)/rows)),phase);}else{c.copy(kind===0?cap:rib);glow.push(kind===2?.35:0,phase);}
  col.push(c.r,c.g,c.b);
 }}
 for(let j=0;j<profile.length-1;j++)for(let k=0;k<radial;k++){const a=j*(radial+1)+k,b=a+radial+1;idx.push(a,a+1,b,a+1,b+1,b);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('aGlow',new THREE.Float32BufferAttribute(glow,2));g.setIndex(idx);g.computeVertexNormals();
 return g;
}
