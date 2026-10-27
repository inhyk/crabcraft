import {dawnTown,type DawnTown} from './dawnTown';
import {dawnHouseMaterials} from './dawnHouses';
import {Scatter} from '../world/kit';
import {StarWind} from './starWind';
import * as THREE from 'three';
import {StarSun} from './starSun';
import {DawnScenery} from './dawnScenery';
import {DawnPortal} from './dawnPortal';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {TownBuilder} from '../world/buildings';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../sim/world/ground';
import type {Poi} from '../world/types';
import {dawnForest,dawnGrove,dawnLots,layoutDawnreach,roadClearance} from './world3Colliders';

/** The third island has its own warm coast, inhabited ring town and volcanic citadel. */
export class DawnIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,4,84);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,DAWN_ARENA_HEIGHT,-72),yaw:0,radius:20};
 /** Every World III collider, without meshes: the same registration the server bakes. */
 readonly collision=layoutDawnreach();
 readonly portal=new DawnPortal(new THREE.Vector3(-12,dawnHeight(-12,84),84),'새벽 항구 → 별빛 항구');
 readonly town:[number,number][]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]];
 private wind:StarWind|null=null;private scenery:DawnScenery;private sun=new StarSun();
 /** Dawnharbor's own streets, lamps, rocks, harbour and gate (dawnTown.ts). */
 readonly townLook:DawnTown;
 height(x:number,z:number){
  return dawnHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD III · Dawnreach';this.root.visible=false;
  const stone=new THREE.MeshStandardMaterial({color:'#393c4b',roughness:.9});
  const sand=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.95,vertexColors:true});
  const roof=new THREE.MeshStandardMaterial({color:'#267b82',roughness:.7});
  const gold=new THREE.MeshStandardMaterial({color:'#ffd67a',emissive:'#d57b23',emissiveIntensity:.65,metalness:.6,roughness:.35});
  const land=new THREE.PlaneGeometry(300,350,120,140);land.rotateX(-Math.PI/2);const p=land.getAttribute('position'),col=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=this.height(x,z);p.setY(i,y);const c=new THREE.Color(y>12?'#747478':y<3?'#d2bd90':Math.abs(x)>24?'#84976a':'#cbbb95');col.push(c.r,c.g,c.b);}
  land.setAttribute('color',new THREE.Float32BufferAttribute(col,3));land.computeVertexNormals();const ground=new THREE.Mesh(land,sand);ground.receiveShadow=true;this.root.add(ground);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(850,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;void main(){float h=clamp(normalize(v).y,0.,1.);vec3 c=mix(vec3(.93,.59,.32),vec3(.12,.32,.62),smoothstep(0.,.12,h));c=mix(c,vec3(.035,.12,.36),smoothstep(.12,.8,h));gl_FragColor=vec4(c,1.);}'}));sky.renderOrder=-100;this.root.add(sky);
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:'#245e74',roughness:.3,metalness:.4,transparent:true,opacity:.94}));sea.rotation.x=-Math.PI/2;sea.position.y=.2;this.root.add(sea);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // The town square uses the terrain and paving; a flat raised disc cut through its sloping roads.
  for(const side of [-1,1]){const tower=add(new THREE.CylinderGeometry(3.6,4.4,15,10),stone,side*27,this.height(side*27,-56)+7.5,-56);add(new THREE.ConeGeometry(4.6,6,10),roof,tower.position.x,tower.position.y+10.5,-56);}
  const floor=add(new THREE.CylinderGeometry(21,22,1.3,64),stone,0,DAWN_ARENA_HEIGHT-.6,-72);floor.name='dawn-boss-platform';
  for(const r of [6,13,20]){const ring=add(new THREE.TorusGeometry(r,.07,5,96),gold,0,DAWN_ARENA_HEIGHT+.12,-72);ring.rotation.x=Math.PI/2;}
  this.townLook=dawnTown((x,z)=>this.height(x,z));this.root.add(this.townLook.root);
  this.scenery=new DawnScenery((x,z)=>this.height(x,z));this.root.add(this.scenery.root);
  this.root.add(this.portal.root,new THREE.HemisphereLight('#ffe8be','#233a53',.9));const sun=this.sun.light;sun.name='dawnreach-sun';sun.color.set('#ffe6b3');sun.intensity=2.8;this.root.add(sun,sun.target);
 }
 async buildSettlement(){
  const village=await loadKit('models/world/village.glb'),props=await loadKit('models/world/props.glb');
  const homes=new StaticBatch(village,'dawnharbor-homes'),builder=new TownBuilder(village,homes,null,dawnHouseMaterials(village));
  for(const lot of dawnLots())builder.build(lot);this.root.add(homes.build());
  // Use the same textured foliage kit as World I: real branching trunks and leaf clusters.
  const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,'dawnreach-leafy-trees');
  const copies=new Map<THREE.Material,THREE.Material>();
  for(const [name,m] of nature.materials){const c=m.clone();if(c instanceof THREE.MeshStandardMaterial&&name.startsWith('Leaves')){c.color.set('#e4efc9');c.side=THREE.DoubleSide;c.roughness=.9;}copies.set(m,c);nature.materials.set(name,c);}
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;
  const trees=['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5'].filter(n=>nature.has(n));
  let count=0;
  for(const {i,x,z,a,scale} of dawnForest()){forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,scale));count++;}
  for(const {i,x,z,a} of dawnGrove()){forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,.67));count++;}
  const grasses=['Grass_Common_Short','Grass_Wispy_Short','Fern_1'].filter(n=>nature.has(n)),flowers=['Flower_3_Group','Flower_4_Group','Bush_Common_Flowers'].filter(n=>nature.has(n));
  let meadow=0;
  for(let i=0;i<1100;i++){
   const x=Math.sin(i*127.1+9)*85,z=-18+(Math.sin(i*311.7+21)*.5+.5)*122;
   if(this.height(x,z)<3||roadClearance(x,z)<.5||Math.hypot(x+11,z-53)<5||Math.hypot(x-67,z-72)<9||Math.abs(x)>27&&Math.abs(x)<48&&z>16&&z<98)continue;
   const list=i%7?grasses:flowers;if(!list.length)continue;
   const scale=(i%7?.5:.55)+(i%5)*.08,name=list[i%list.length],bounds=nature.get(name).box,reach=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)))*scale;
   if(roadClearance(x,z)<reach+.25||Math.hypot(x,z-53)<14)continue;
   forest.add(name,trs(x,this.height(x,z),z,i*2.39,scale));meadow++;
  }
  this.root.userData.meadowPlants=meadow;
  const woods=forest.build({boundsPadding:.3});this.root.add(woods);this.root.userData.leafyTrees=count;this.wind=new StarWind(woods);
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.geometry.dispose();
  const market=new StaticBatch(props,'dawnharbor-market');
  const put=(name:string,x:number,z:number,yaw=0,scale=1,dy=0)=>{if(props.has(name))market.add(name,trs(x,this.height(x,z)+dy,z,yaw,scale));};
  for(const side of [-1,1])for(const z of [37,57,74]){const x=side*23;put('Stall_Empty',x,z,side<0?Math.PI/2:-Math.PI/2);put('Barrel_Apples',x+side*2,z+1);put('Crate_Wooden',x+side*2,z-2);put('FarmCrate_Apple',x,z,0,1,.82);}
  this.root.add(market.build());
 }
 private sunDir=new THREE.Vector3();
 update(time:number,_rescued:boolean,x:number,z:number,quality:'high'|'low'='high'){this.townLook.update(time,quality,this.sunDir.subVectors(this.sun.light.position,this.sun.light.target.position));this.wind?.update(time);this.sun.update(x,z);this.scenery.update(time);this.portal.update(time);}
}
