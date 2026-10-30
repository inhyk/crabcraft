import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {FRONTIER_TOWN,layoutFrontier,type FrontierChapter} from './realmLayout';
import {StarPortal} from './portal';
import type {Poi} from '../world/types';
import {EmberWilds} from './emberWilds';
import {EmberLava} from './emberLava';
import type {LavaWader} from './emberLavaPrints';
import {EmberAir} from './emberSkyAir';
import {EmberHaze} from './emberHaze';
import {registerHeatHaze} from '../core/heatHaze';
import {EmberTown} from './emberTown';
/** Two new frontiers: distinct silhouettes, instanced nature and GPU-only ambient particles. */
export class FrontierIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,6,84);
 readonly town=FRONTIER_TOWN;
 readonly arena:Poi;
 readonly collision;
 readonly back:StarPortal;
 readonly next:StarPortal|null;
 /** World V's lava: molten sea, crater lake and the tongues down the volcano (emberLava.ts). */
 readonly lava:EmberLava|null=null;
 /** World V's sky, light, fog, heat, plume, ash and coast (emberSky*.ts). */
 readonly air:EmberAir|null=null;
 /** World V's ground lane: terrain, roads, rocks, crystals, plants and the forge court (emberWilds.ts). */
 readonly wilds:EmberWilds|null=null;
 /** World V's forge town, street and arrival quay (emberTown.ts). */
 readonly forge:EmberTown|null=null;
 private animated:THREE.ShaderMaterial[]=[];
 private rotating:THREE.Object3D[]=[];
 height(x:number,z:number){return realmHeight(this.chapter,x,z);}
 constructor(readonly chapter:FrontierChapter){
  const fire=chapter===5;this.root.name=fire?'WORLD V · Emberreach':'WORLD VI · Skybloom';this.root.visible=false;
  this.collision=layoutFrontier(chapter);this.arena={id:'bossArena',position:new THREE.Vector3(0,this.height(0,-72),-72),radius:20,yaw:0};
  this.back=new StarPortal(this.spawn,fire?'잿불 항구 → 서리빛 설원':'하늘 항구 → 잿불 군도');
  this.next=fire?new StarPortal(new THREE.Vector3(26,this.height(26,-44),-44),'잿불 성역 → 하늘숲'):null;
  const stone=new THREE.MeshStandardMaterial({color:fire?'#393239':'#d3d6b5',roughness:.82,metalness:fire?.25:.08});
  const wood=new THREE.MeshStandardMaterial({color:fire?'#423037':'#655037',roughness:.9});
  const metal=new THREE.MeshStandardMaterial({color:fire?'#77656b':'#b7b38a',metalness:.55,roughness:.4});
  const glow=new THREE.MeshStandardMaterial({color:fire?'#ffd29b':'#b4ffdc',emissive:fire?'#ff5717':'#39d9a7',emissiveIntensity:1.7,roughness:.3});
  const roofMat=new THREE.MeshStandardMaterial({color:fire?'#773e37':'#398269',roughness:.85});
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;this.root.add(m);return m;};
  // Houses: World V's forge town is drawn by emberTown.ts (hook below).
  const foliage=new THREE.MeshStandardMaterial({color:fire?'#977046':'#56976c',roughness:1});
  // Northern destination: a smoking volcanic caldera or a luminous world tree.
  const ly=this.height(0,-72);
  let volcano:THREE.Mesh|null=null;
  if(fire){
   volcano=add(new THREE.CylinderGeometry(8,28,38,18,4,true),stone,0,ly+9,-128);volcano.name='ember-volcano';
   this.lava=new EmberLava({height:(x,z)=>this.height(x,z),ly});this.root.add(this.lava.root);
   this.wilds=new EmberWilds({height:(x,z)=>this.height(x,z),ly,zones:this.lava.zones});this.root.add(this.wilds.root);
  }else{
   add(new THREE.CylinderGeometry(3.5,6,36,10),wood,0,ly+18,-112).name='skybloom-world-tree';
   for(let i=0;i<7;i++){const a=i/7*Math.PI*2,x=Math.sin(a)*10,z=-112+Math.cos(a)*10;const b=add(new THREE.CylinderGeometry(.6,1.4,20,6),wood,x*.5,ly+26,z+(-112-z)*.5);b.rotation.z=-Math.sin(a)*.8;b.rotation.x=Math.cos(a)*.8;const canopy=add(new THREE.IcosahedronGeometry(12,1),new THREE.MeshStandardMaterial({color:i%2?'#67ac86':'#3b947d',roughness:.8}),x,ly+38+i%3*3,z);canopy.scale.y=.65;}
   for(let i=0;i<9;i++){const a=i*2.4,x=Math.sin(a)*145,z=Math.cos(a)*160;add(new THREE.ConeGeometry(8+i%3*3,22,6),stone,x,12+i%4*9,z).rotation.z=Math.PI;add(new THREE.CylinderGeometry(8+i%3*3,7,2,8),roofMat,x,24+i%4*9,z);}
  }
  this.makeDetails(fire,stone,wood,metal,glow,foliage);
  if(this.lava){this.forge=new EmberTown({height:(x,z)=>this.height(x,z),zones:this.lava.zones});this.root.add(this.forge.root);}
  // A low sea of lava / clouds and gradient sky distinguish the worlds at first glance.
  if(!fire){const sea=add(new THREE.PlaneGeometry(1800,1800),this.flowMaterial(false),0,.15,0);sea.rotation.x=-Math.PI/2;sea.castShadow=false;sea.name='sea-of-clouds';}
  if(fire&&volcano&&this.lava){const haze=new EmberHaze(this.root,this.lava);registerHeatHaze(haze);this.air=new EmberAir({root:this.root,height:(x,z)=>this.height(x,z),ly,volcano,zones:this.lava.zones,noHeat:[this.lava.root,this.back.root,...(this.next?[this.next.root]:[])],haze});}
  this.root.add(this.back.root);if(this.next)this.root.add(this.next.root);
 }
 /** Small scenery shares geometry and material; roads and battle space stay unobstructed. */
 private makeDetails(fire:boolean,stone:THREE.Material,wood:THREE.Material,metal:THREE.Material,glow:THREE.Material,foliage:THREE.Material){
  const detail=new THREE.Group();detail.name=fire?'ember-forge-village-details':'skybloom-living-garden';this.root.add(detail);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;detail.add(m);return m;};
  const y=(x:number,z:number)=>this.height(x,z);
  const dummy=new THREE.Object3D();
  if(!fire){
   // Tiered planter gardens, flowers and world-tree hanging lanterns.
   const petal=new THREE.MeshStandardMaterial({color:'#f4cfb4',emissive:'#9d5d81',emissiveIntensity:.12,roughness:.8});
   const flowers=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.25,0),petal,180);
   for(let i=0;i<180;i++){const side=i%2?1:-1,x=side*(41+(i%9)*1.2),z=28+(i%23)*2.8;dummy.position.set(x,y(x,z)+.3,z);dummy.rotation.y=i;dummy.scale.setScalar(.75+i%3*.3);dummy.updateMatrix();flowers.setMatrixAt(i,dummy.matrix);flowers.setColorAt(i,new THREE.Color(i%3?'#f7d6c0':'#b9b5ff'));}detail.add(flowers);
   for(const side of [-1,1])for(const z of [38,65]){const x=side*47,by=y(x,z);add(new THREE.CylinderGeometry(4,4.3,.5,16),stone,x,by+.2,z);const crown=add(new THREE.IcosahedronGeometry(3,1),foliage,x,by+1,z);crown.scale.y=.3;}
   for(let i=0;i<10;i++){const a=i*Math.PI/5,x=Math.sin(a)*11,z=-112+Math.cos(a)*11;add(new THREE.CylinderGeometry(.035,.035,6+i%3,4),metal,x,y(0,-72)+26,z);add(new THREE.OctahedronGeometry(.5),glow,x,y(0,-72)+22-i%3*.5,z);}
   // Root arches sit beyond the north rim of the fight.
   for(const side of [-1,1]){const arch=add(new THREE.TorusGeometry(8,.65,6,24,Math.PI),wood,side*22,y(side*22,-108)+2,-108);arch.rotation.y=side*.5;}
  }
  this.root.userData.frontierDetailMeshes=detail.children.length;
 }
 private flowMaterial(fire:boolean){const m=new THREE.ShaderMaterial({uniforms:{time:{value:0},hot:{value:fire?1:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float time;uniform float hot;void main(){float w=.5+.5*sin(v.x*90.+sin(v.y*70.+time*.15)*2.);vec3 lava=mix(vec3(.27,.035,.025),vec3(1.,.36,.025),pow(w,4.));vec3 cloud=mix(vec3(.64,.8,.8),vec3(.93,.98,.93),w);gl_FragColor=vec4(mix(cloud,lava,hot),1.);}'});this.animated.push(m);return m;}
 update(time:number,waders?:readonly LavaWader[],focus?:LavaWader){this.lava?.update(time,waders,focus);this.air?.update(time);this.wilds?.update(time);this.forge?.update(time);this.back.update(time);this.next?.update(time);for(const m of this.animated)m.uniforms.time.value=time;for(const gem of this.rotating)if(gem.userData.banner)gem.rotation.y=Math.sin(time*1.7+gem.position.z)*.12;else gem.rotation.y=time*.5;}
}
