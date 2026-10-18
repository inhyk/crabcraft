import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
export type IslandPath={points:readonly (readonly [number,number])[];width:number;trim?:boolean};

/** Weathered bevelled flagstones drape onto the exact gameplay surface, including hills. */
export function islandPaths(height:(x:number,z:number)=>number,paths:IslandPath[],realm:2|3|4){
 const root=new THREE.Group();root.name=`world${realm}-flagstone-paths`;
 let seed=realm*1307;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;
 ctx.fillStyle='#b4b0a1';ctx.fillRect(0,0,256,256);
 for(let i=0;i<7000;i++){const shade=Math.floor(120+random()*100);ctx.fillStyle=`rgba(${shade},${shade},${shade-12},.25)`;ctx.fillRect(random()*256,random()*256,1+random()*4,1+random()*3);}
 // Shallow mineral veins and softened chipped edges are visible even close to the ground.
 for(let i=0;i<17;i++){ctx.strokeStyle=i%2?'#8e8b7b44':'#e1ddca55';ctx.lineWidth=.5+random()*1.5;ctx.beginPath();let x=random()*256,y=random()*256;ctx.moveTo(x,y);for(let j=0;j<5;j++){x+=(random()-.5)*35;y+=12+random()*13;ctx.lineTo(x,y);}ctx.stroke();}
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;texture.name='weathered-flagstone';texture.userData.islandPaving=true;
 const palette=realm===4?['#95aebe','#b5cddd','#c5dce7','#879eaf','#a9c5d8']:realm===2?['#acb8ba','#a4adae','#bcc4bd','#919fa5','#c3bfb3']:['#c7bea7','#b6ad98','#d7cbb0','#aaa58f','#c3b49c'];
 const materials=palette.map(color=>new THREE.MeshStandardMaterial({color,map:texture,bumpMap:texture,bumpScale:.055,roughness:.94}));
 const edgeMaterial=new THREE.MeshStandardMaterial({color:realm===2?'#9eafad':'#d7c39c',map:texture,bumpMap:texture,bumpScale:.035,roughness:.9});
 const pools:THREE.BufferGeometry[][]=materials.map(()=>[]),edges:THREE.BufferGeometry[]=[];
 const stone=(x:number,z:number,w:number,l:number,yaw:number,pool:THREE.BufferGeometry[])=>{
  const shape=new THREE.Shape(),b=.055;
  shape.moveTo(-w/2+b,-l/2);shape.lineTo(w/2-b,-l/2);shape.lineTo(w/2,-l/2+b);shape.lineTo(w/2,l/2-b);shape.lineTo(w/2-b,l/2);shape.lineTo(-w/2+b,l/2);shape.lineTo(-w/2,l/2-b);shape.lineTo(-w/2,-l/2+b);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:true,bevelThickness:.025,bevelSize:.025,bevelSegments:1,steps:1});g.rotateX(-Math.PI/2);g.rotateY(yaw);g.translate(x,0,z);
  const p=g.getAttribute('position'),uv=g.getAttribute('uv');for(let i=0;i<p.count;i++){const px=p.getX(i),pz=p.getZ(i);p.setY(i,p.getY(i)+height(px,pz)+.045);uv.setXY(i,(px-x)/w+.5,(pz-z)/l+.5);}g.computeVertexNormals();pool.push(g);
 };
 for(const path of paths){
  for(let k=1;k<path.points.length;k++){
   const [ax,az]=path.points[k-1],[bx,bz]=path.points[k],dx=bx-ax,dz=bz-az,d=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),nx=dz/d,nz=-dx/d;
   const rows=Math.ceil(d/1.35),step=d/rows,columns=Math.max(2,Math.round(path.width/1.25)),cw=path.width/columns;
   for(let j=0;j<rows;j++){
    const t=(j+.5)/rows,cx=ax+dx*t,cz=az+dz*t;
    for(let c=0;c<columns;c++){
     const across=(c+.5-columns/2)*cw,x=cx+nx*across,z=cz+nz*across;
     // Preserve fountain clearance in Starhaven and avoid repaving the existing boss floors.
     if(realm===2&&(Math.hypot(x,z-55)<3.8||Math.hypot(x,z+75)<19))continue;
     if(realm===3&&Math.hypot(x,z+72)<22)continue;
     stone(x,z,cw-.065-random()*.03,step-.065-random()*.03,yaw+(random()-.5)*.028,pools[Math.floor(random()*materials.length)]);
    }
    if(path.trim)for(const side of [-1,1]){const across=side*(path.width/2+.17);const x=cx+nx*across,z=cz+nz*across;if(realm===2&&Math.hypot(x,z-55)<4)continue;stone(x,z,.24,step-.04,yaw,edges);}
   }
  }
 }
 for(const [i,pool] of [...pools,edges].entries()){if(!pool.length)continue;const geo=mergeGeometries(pool,false)!;pool.forEach(g=>g.dispose());const mesh=new THREE.Mesh(geo,i===pools.length?edgeMaterial:materials[i]);mesh.name='weathered-bevelled-paving';mesh.receiveShadow=true;root.add(mesh);}
 root.userData.pavers=pools.reduce((n,p)=>n+p.length,0);return root;
}
