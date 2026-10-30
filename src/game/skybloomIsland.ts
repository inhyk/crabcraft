import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {FRONTIER_TOWN,layoutFrontier,type FrontierChapter} from './realmLayout';
import {StarPortal} from './portal';
import {DawnPortal} from './dawnPortal';
import type {Poi} from '../world/types';
import {SkybloomAir} from './skybloomAir';
import {SkyGroundLane} from './skyGroundLane';
import {skyTreeQuality} from './skyWorldTree';
import {skySanctuaryScene} from './skySanctuary';
import {SKY_TREE_TIME} from './skyTreeMaterials';
import {skyTown,type SkyTown} from './skyTown';
import {SKY_GATE} from './skyGroundLayout';

const lowQuality=()=>{try{return localStorage.getItem('cc.quality')==='low';}catch{return false;}};
/** World VI Skybloom, split from the shared frontier so its design can grow apart from World V. */
export class SkybloomIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,6,84);
 readonly town=FRONTIER_TOWN;
 readonly arena:Poi;
 readonly collision;
 readonly back:StarPortal|DawnPortal;
 readonly next:StarPortal|null;
 private animated:THREE.ShaderMaterial[]=[];
 /** Sky, sun, fog, environment, cloud sea, cliff skirt, floating isles, falls and drifting petals (skybloomAir.ts). */
 readonly air=new SkybloomAir();
 private rotating:THREE.Object3D[]=[];
 /** Terrain, paving, meadow and forest (skyGroundLane.ts). */
 private ground!:SkyGroundLane;
 private town6:SkyTown|null=null;
 height(x:number,z:number){return realmHeight(this.chapter,x,z);}
 readonly chapter:FrontierChapter=6;
 constructor(){
  const fire=false as boolean,chapter=this.chapter;this.root.name=fire?'WORLD V · Emberreach':'WORLD VI · Skybloom';this.root.visible=false;
  this.collision=layoutFrontier(chapter);this.arena={id:'bossArena',position:new THREE.Vector3(0,this.height(0,-72),-72),radius:20,yaw:0};
  // The way back to Emberreach: a finished cream-and-gilt gate (dawnPortal.ts 'sky'), not the old dark primitive ring that
  // clipped the village view's corner as a black blob (r4). It stands 2.7 m north-west of the spawn, which stays the
  // travel point (the sim's gate:w5 at -12, 84, range 3.5): a crab in the arch still travels, and the dais no longer
  // pokes into the village view's lower-left corner (r4 finish).
  const [gx,gz]=SKY_GATE;
  this.back=new DawnPortal(new THREE.Vector3(gx,this.height(gx,gz),gz),'하늘 항구 → 잿불 군도','sky');
  this.next=fire?new StarPortal(new THREE.Vector3(26,this.height(26,-44),-44),'잿불 성역 → 하늘숲'):null;
  const stone=new THREE.MeshStandardMaterial({color:fire?'#393239':'#d3d6b5',roughness:.82,metalness:fire?.25:.08});
  const metal=new THREE.MeshStandardMaterial({color:fire?'#77656b':'#b7b38a',metalness:.55,roughness:.4});
  const glow=new THREE.MeshStandardMaterial({color:fire?'#ffd29b':'#b4ffdc',emissive:fire?'#ff5717':'#39d9a7',emissiveIntensity:1.7,roughness:.3});
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;this.root.add(m);return m;};
  this.ground=new SkyGroundLane(this.root);
  // Six garden-harbour houses, the market, lanterns, banners and the sky harbour: skyTown.ts (one mesh per material).
  const town=skyTown((x,z)=>this.height(x,z),lowQuality());this.root.add(town.group);this.town6=town;
  // Northern destination: a smoking volcanic caldera or a luminous world tree.
  const ly=this.height(0,-72);
  if(fire){
   const volcano=add(new THREE.CylinderGeometry(8,28,38,18,4,true),stone,0,ly+9,-128);volcano.name='ember-volcano';
   const crater=add(new THREE.CylinderGeometry(8,5,2,32),glow,0,ly+27,-128);crater.name='lava-crater';
   for(const side of [-1,1]){const lava=add(new THREE.PlaneGeometry(8,160,1,32),this.flowMaterial(true),side*91,1,0);lava.rotation.x=-Math.PI/2;lava.castShadow=false;}
   add(new THREE.TorusGeometry(11,.5,6,40),stone,0,ly+27,-128).rotation.x=Math.PI/2;
  }
  this.makeDetails(fire,stone,metal,glow);
  // World tree and its sanctuary: court, columns, root gate, vines and seed lanterns (skySanctuary.ts).
  this.root.add(skySanctuaryScene((x,z)=>this.height(x,z),skyTreeQuality()).root);
  this.animated.push(...this.air.mount(this.root,this.ground.ground.mesh));this.air.whenBuilt(Promise.all([town.ready,this.ground.forest]));this.root.add(this.back.root);if(this.next)this.root.add(this.next.root);
 }
 /** Small scenery shares geometry and material; roads and battle space stay unobstructed. */
 private makeDetails(fire:boolean,stone:THREE.Material,metal:THREE.Material,glow:THREE.Material){
  const detail=new THREE.Group();detail.name=fire?'ember-forge-village-details':'skybloom-living-garden';this.root.add(detail);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;detail.add(m);return m;};
  const y=(x:number,z:number)=>this.height(x,z);
  if(fire){
   // Layered basalt cliffs, glowing fissures and an outdoor furnace.
   for(const side of [-1,1])for(let i=0;i<12;i++){const x=side*(84+i%3*5),z=-95+i*15,by=y(x,z);const rock=add(new THREE.CylinderGeometry(1.8,2.3,5+i%4,6),stone,x,by+2,z);rock.rotation.y=i*.4;add(new THREE.BoxGeometry(.12,2+i%3,.15),glow,x-side*1.9,by+2,z);}
   const fx=-46,fz=55,fy=y(fx,fz);add(new THREE.BoxGeometry(5,2.8,4),stone,fx,fy+1.4,fz);add(new THREE.BoxGeometry(3.4,.8,2.6),glow,fx,fy+2.85,fz);add(new THREE.BoxGeometry(2.4,.5,1.2),metal,fx+7,fy+1.5,fz);add(new THREE.ConeGeometry(.9,1.3,4),metal,fx+7,fy+.7,fz);
   for(let k=0;k<8;k++){const a=k*.8,x=fx+Math.sin(a)*3,z=fz+Math.cos(a)*3;add(new THREE.OctahedronGeometry(.45),metal,x,y(x,z)+.35,z);}
  }
  this.root.userData.frontierDetailMeshes=detail.children.length;
 }
 private flowMaterial(fire:boolean){const m=new THREE.ShaderMaterial({uniforms:{time:{value:0},hot:{value:fire?1:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float time;uniform float hot;void main(){float w=.5+.5*sin(v.x*90.+sin(v.y*70.+time*.15)*2.);vec3 lava=mix(vec3(.27,.035,.025),vec3(1.,.36,.025),pow(w,4.));vec3 cloud=mix(vec3(.64,.8,.8),vec3(.93,.98,.93),w);gl_FragColor=vec4(mix(cloud,lava,hot),1.);}'});this.animated.push(m);return m;}
 update(time:number,quality:'high'|'low'='high',player:THREE.Vector3|null=null){SKY_TREE_TIME.value=time;this.town6?.update(time);this.ground.update(time,quality,player);this.back.update(time);this.next?.update(time);for(const m of this.animated)m.uniforms.time.value=time;for(const gem of this.rotating)if(gem.userData.banner)gem.rotation.y=Math.sin(time*1.7+gem.position.z)*.12;else gem.rotation.y=time*.5;}
}
