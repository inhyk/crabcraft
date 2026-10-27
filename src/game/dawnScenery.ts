import * as THREE from 'three';
import type {Collision} from '../world/collision';

const LIGHT={x:67,z:72};

/** The lighthouse is solid (the citadel registers its own walls, dawnCitadelLayout.ts). */
export function registerDawnScenery(height:(x:number,z:number)=>number,collision:Collision){
  const ly=height(LIGHT.x,LIGHT.z);collision.addCircle(LIGHT.x,LIGHT.z,3.2,ly,ly+17);
}

/** Deterministic landmarks, pooled static props and a small animated skyline. */
export class DawnScenery {
 readonly root=new THREE.Group();private flags:THREE.Object3D[]=[];private birds:THREE.Group[]=[];
 private beacon=new THREE.Group();
 constructor(height:(x:number,z:number)=>number){
  this.root.name='dawnreach-landmarks';
  const mat=(color:string,glow=0)=>new THREE.MeshStandardMaterial({color,roughness:.83,emissive:color,emissiveIntensity:glow});
  const stone=mat('#666b76'),teal=mat('#397f82'),ivory=mat('#e7d6ae'),gold=mat('#f5c46c',.35);
  const box=new THREE.BoxGeometry(1,1,1),cyl=new THREE.CylinderGeometry(1,1,1,10),cone=new THREE.ConeGeometry(1,1,8);
  // Static dressing is instanced by material and geometry, including wall blocks and flower beds.
  const pools=new Map<string,{geo:THREE.BufferGeometry;mat:THREE.Material;transforms:THREE.Matrix4[]}>();
  const place=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number,ry=0)=>{const key=geo.uuid+m.uuid;let pool=pools.get(key);if(!pool){pool={geo,mat:m,transforms:[]};pools.set(key,pool);}const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),ry),new THREE.Vector3(sx,sy,sz));pool.transforms.push(matrix);};
  const ground=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,z:number,sx:number,sy:number,sz:number,dy=0,ry=0)=>place(geo,m,x,height(x,z)+sy/2+dy,z,sx,sy,sz,ry);
  // The harbour (deck, boats, barrels and banners) is dawnHarbour.ts.
  // A pearl-colored lighthouse and lookout garden on the eastern headland.
  const lx=LIGHT.x,lz=LIGHT.z,ly=height(lx,lz);
  place(cyl,stone,lx,ly+.3,lz,4,.6,4);place(cyl,ivory,lx,ly+6,lz,2.4,12,2.4);place(cyl,teal,lx,ly+7,lz,2.46,1,2.46);place(cyl,stone,lx,ly+12,lz,3,.4,3);place(cyl,gold,lx,ly+13.2,lz,1.3,2,1.3);place(cone,teal,lx,ly+15,lz,3.2,2,3.2);
  this.beacon.position.set(lx,ly+13.3,lz);const beamMat=new THREE.MeshBasicMaterial({color:'#ffdc96',transparent:true,opacity:.14,depthWrite:false,side:THREE.DoubleSide});const beam=new THREE.Mesh(new THREE.ConeGeometry(7,32,20,1,true),beamMat);beam.rotation.z=-Math.PI/2;beam.position.x=16;this.beacon.add(beam);this.root.add(this.beacon);
  for(let i=0;i<13;i++){const a=i/12*Math.PI*1.5;ground(box,ivory,lx+Math.cos(a)*6,lz+Math.sin(a)*6,.45,1.1,.45);}
  // The garden beds along the avenue and the lookout benches are dawnDressing.ts (sandstone beds, kit plants and benches).
  // Solarkan's citadel round the boss's arena is dawnCitadel.ts.
  // Gulls add motion without adding real-time lights or shadow maps; the sky, its clouds and the surf are dawnSky.ts and dawnSea.ts.
  for(let i=0;i<6;i++){const bird=new THREE.Group();for(const side of [-1,1]){const wing=new THREE.Mesh(new THREE.ConeGeometry(.32,2,3),ivory);wing.rotation.z=side*1.25;wing.position.x=side*.7;bird.add(wing);}bird.name='dawn-gull';this.root.add(bird);this.birds.push(bird);}
  for(const pool of pools.values()){const m=new THREE.InstancedMesh(pool.geo,pool.mat,pool.transforms.length);pool.transforms.forEach((matrix,i)=>m.setMatrixAt(i,matrix));m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();this.root.add(m);}
 }
 update(time:number){this.beacon.rotation.y=time*.18;this.flags.forEach((f,i)=>{f.rotation.y=Math.sin(time*1.4+i)*.18;f.rotation.z=Math.sin(time*1.8+i)*.035;});this.birds.forEach((b,i)=>{const a=time*.07+i*1.1;b.position.set(Math.cos(a)*(45+i*5),25+Math.sin(time*.8+i)*1.5,65+Math.sin(a)*35);b.rotation.y=-a;b.rotation.z=Math.sin(time*2+i)*.1;});}
}
