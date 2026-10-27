import {dawnTown,type DawnTown} from './dawnTown';
import {dawnHouses,type DawnQuarter} from './dawnHouses';
import {dawnDressing,type DawnDressing} from './dawnDressing';
import {dawnRequestLook} from './dawnRequestProps';
import {dawnPalms,type DawnPalms,type PalmSpot} from './dawnPalms';
import {Scatter} from '../world/kit';
import {StarWind} from './starWind';
import * as THREE from 'three';
import {StarSun} from './starSun';
import {DawnScenery} from './dawnScenery';
import {DawnPortal} from './dawnPortal';
import {loadKit,trs} from '../world/kit';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../sim/world/ground';
import type {Poi} from '../world/types';
import {dawnForest,dawnGrove,layoutDawnreach,roadClearance} from './world3Colliders';
import {quarterPalms} from './dawnHousePlan';

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
 private dressing:DawnDressing|null=null;
 /** Goldsand Harbor's desert quarter: houses, shrine, forge, tavern, windcatchers, palms (dawnHouses.ts). */
 quarter:DawnQuarter|null=null;
 private palms:DawnPalms|null=null;
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
  const props=await loadKit('models/world/props.glb');
  // Use the same textured foliage kit as World I: real branching trunks and leaf clusters.
  const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,'goldsand-scrub');
  // Desert scrub: the kit's grass dried to straw, its twisted-tree bush to dusty olive; green stays at the oasis.
  const copies=new Map<THREE.Material,THREE.Material>();
  const TINT:Record<string,string>={Grass:'#d9b77a',Leaves_TwistedTree:'#a39361',Leaves:'#c9d6a0',Leaves_NormalTree:'#d7e4b6'};
  for(const [name,m] of nature.materials){const c=m.clone();if(c instanceof THREE.MeshStandardMaterial&&TINT[name]){c.color.set(TINT[name]);c.side=THREE.DoubleSide;c.roughness=.9;}copies.set(m,c);nature.materials.set(name,c);}
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;
  // Date palms stand where the town's trees stood (their colliders are dawnForest()/dawnGrove()); the grove is an oasis.
  const spots:PalmSpot[]=[...dawnForest().map(({i,x,z,a,scale})=>({x,z,h:5.6+scale*3.2,lean:.06+(i%5)*.03,dir:a,seed:i})),...dawnGrove().map(({i,x,z,a})=>({x,z,h:4.6+(i%4)*.9,lean:.1+(i%3)*.05,dir:a,seed:100+i})),
   // The desert quarter's palms (dawnHousePlan.ts): door pairs, yards, forecourts and back gardens over the roofs.
   ...quarterPalms().map(([x,z,h,lean],i)=>({x,z,h,lean,dir:i*2.39+.7,seed:200+i}))];
  this.palms=dawnPalms(spots,(x,z)=>this.height(x,z));this.root.add(this.palms.group);
  const count=spots.length;
  const dry=['Grass_Wispy_Short','Grass_Common_Short','Bush_Common'].filter(n=>nature.has(n)),oasis=['Fern_1','Grass_Common_Tall','Flower_3_Group','Flower_4_Group','Bush_Common_Flowers'].filter(n=>nature.has(n));
  let meadow=0;
  for(let i=0;i<1100;i++){
   const x=Math.sin(i*127.1+9)*85,z=-18+(Math.sin(i*311.7+21)*.5+.5)*122;
   if(this.height(x,z)<3||roadClearance(x,z)<.5||Math.hypot(x+11,z-53)<5||Math.hypot(x-67,z-72)<9||Math.abs(x)>27&&Math.abs(x)<48&&z>16&&z<98)continue;
   const atOasis=Math.hypot(x+65,z-45)<15;
   // Sparse tufts on the sand; the oasis is lush.
   if(!atOasis&&i%3)continue;
   const list=atOasis?oasis:dry;if(!list.length)continue;
   const name=list[i%list.length],scale=name==='Bush_Common'?.38+(i%4)*.06:.45+(i%5)*.07,bounds=nature.get(name).box,reach=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)))*scale;
   // The avenue runs on to the harbour promenade (dawnHarbour.ts) past the end of DAWN_PATHS.
   if(roadClearance(x,z)<reach+.25||Math.hypot(x,z-53)<14||Math.abs(x)<3.6+reach&&z>90)continue;
   forest.add(name,trs(x,this.height(x,z),z,i*2.39,scale));meadow++;
  }
  this.root.userData.meadowPlants=meadow;
  const woods=forest.build({boundsPadding:.3});this.root.add(woods);this.root.userData.leafyTrees=count;this.root.userData.palms=count;this.wind=new StarWind(woods);
  // Market, fish market, benches, door pots and lanterns, laundry (dawnDressing.ts).
  this.quarter=dawnHouses((x,z)=>this.height(x,z),{props,nature});this.root.add(this.quarter.group);
  this.dressing=dawnDressing((x,z)=>this.height(x,z),{props,nature},this.quarter.doors,this.town,{yardLaundry:false});this.root.add(this.dressing.group);
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.geometry.dispose();
 }
 /** Dawnharbor's request props (dawnRequestProps.ts) in place of the shared placeholders. */
 questProps(){return dawnRequestLook();}
 private sunDir=new THREE.Vector3();
 update(time:number,_rescued:boolean,x:number,z:number,quality:'high'|'low'='high'){this.townLook.update(time,quality,this.sunDir.subVectors(this.sun.light.position,this.sun.light.target.position));this.wind?.update(time);this.dressing?.update(time);this.quarter?.update(time);this.palms?.update(time);this.sun.update(x,z);this.scenery.update(time);this.portal.update(time);}
}
