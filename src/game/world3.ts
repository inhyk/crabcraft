import {islandPaths,type IslandPath} from './islandPaths';
import {Scatter} from '../world/kit';
import {StarWind} from './starWind';
import * as THREE from 'three';
import {StarSun} from './starSun';
import {DawnScenery} from './dawnScenery';
import {StarPortal} from './portal';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {TownBuilder} from '../world/buildings';
import type {Lot} from '../world/layout';
import {Collision} from '../world/collision';
import {dawnHeight} from '../sim/world/ground';
import type {Poi} from '../world/types';

const DAWN_PATHS:IslandPath[]=[
 {points:[[0,94],[0,26],[0,-49]],width:8.4,trim:true},
 {points:[[-26,53],[26,53]],width:6,trim:true},
 {points:[[-5,74],[-28,75],[-50,64],[-62,48]],width:2.6,trim:true},
 {points:[[4,75],[28,84],[48,84],[61,76]],width:2.6,trim:true},
 ...[26,45,64,83].flatMap(z=>[-1,1].map(side=>({points:[[side*4.2,z],[side*29,z]] as [number,number][],width:2.4,trim:false}))),
];
const roadClearance=(x:number,z:number)=>{let best=Infinity;for(const path of DAWN_PATHS)for(let i=1;i<path.points.length;i++){const [ax,az]=path.points[i-1],[bx,bz]=path.points[i],dx=bx-ax,dz=bz-az,t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t)-path.width/2);}return best;};

/** The third island has its own warm coast, inhabited ring town and volcanic citadel. */
export class DawnIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,4,84);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,17,-72),yaw:0,radius:20};
 readonly collision=new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:(x,z)=>this.height(x,z)});
 readonly portal=new StarPortal(this.spawn,'새벽 항구 → 별빛 항구');
 readonly town:[number,number][]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]];
 private wind:StarWind|null=null;private scenery:DawnScenery;private sun=new StarSun();
 private rotating:THREE.Object3D[]=[];
 private cage=new THREE.Group();
 height(x:number,z:number){
  return dawnHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD III · Dawnreach';this.root.visible=false;
  const stone=new THREE.MeshStandardMaterial({color:'#393c4b',roughness:.9});
  const sand=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.95,vertexColors:true});
  const roof=new THREE.MeshStandardMaterial({color:'#267b82',roughness:.7});
  const gold=new THREE.MeshStandardMaterial({color:'#ffd67a',emissive:'#d57b23',emissiveIntensity:.65,metalness:.6,roughness:.35});
  const lava=new THREE.MeshStandardMaterial({color:'#ff763b',emissive:'#ff4612',emissiveIntensity:1.2});
  const land=new THREE.PlaneGeometry(300,350,120,140);land.rotateX(-Math.PI/2);const p=land.getAttribute('position'),col=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=this.height(x,z);p.setY(i,y);const c=new THREE.Color(y>12?'#747478':y<3?'#d2bd90':Math.abs(x)>24?'#84976a':'#cbbb95');col.push(c.r,c.g,c.b);}
  land.setAttribute('color',new THREE.Float32BufferAttribute(col,3));land.computeVertexNormals();const ground=new THREE.Mesh(land,sand);ground.receiveShadow=true;this.root.add(ground);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(850,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;void main(){float h=clamp(normalize(v).y,0.,1.);vec3 c=mix(vec3(.93,.59,.32),vec3(.12,.32,.62),smoothstep(0.,.12,h));c=mix(c,vec3(.035,.12,.36),smoothstep(.12,.8,h));gl_FragColor=vec4(c,1.);}'}));sky.renderOrder=-100;this.root.add(sky);
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:'#245e74',roughness:.3,metalness:.4,transparent:true,opacity:.94}));sea.rotation.x=-Math.PI/2;sea.position.y=.2;this.root.add(sea);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // Ring town: a generous square, fountain, homes and people on both sides of the avenue.
  add(new THREE.CylinderGeometry(13,13,.07,64),new THREE.MeshStandardMaterial({color:'#a99f87',roughness:.94}),0,3.98,53);
  add(new THREE.CylinderGeometry(3.1,3.6,.8,32),stone,-11,4.6,53);
  add(new THREE.CylinderGeometry(2.9,2.9,.08,32),new THREE.MeshStandardMaterial({color:'#69cbd2',emissive:'#246771',emissiveIntensity:.4}),-11,5.05,53);
  add(new THREE.CylinderGeometry(.4,.7,3.2,12),gold,-11,6,53);add(new THREE.OctahedronGeometry(.9),gold,-11,8.2,53);
  this.collision.addCircle(-11,53,3.7,4,9);
  // A walkable, lit ascent to the fortress, built directly over the analytic surface.
  for(let i=0;i<72;i++){const z=83-i*2.12,y=this.height(0,z);
   if(i%5===0)for(const side of [-1,1]){add(new THREE.CylinderGeometry(.14,.22,2.4,6),stone,side*5.1,y+1.2,z);add(new THREE.OctahedronGeometry(.42),gold,side*5.1,y+2.6,z);}
  }
  for(const side of [-1,1]){const tower=add(new THREE.CylinderGeometry(3.6,4.4,15,10),stone,side*27,this.height(side*27,-56)+7.5,-56);add(new THREE.ConeGeometry(4.6,6,10),roof,tower.position.x,tower.position.y+10.5,-56);this.collision.addCircle(side*27,-56,4.5,4,35);}
  add(new THREE.CylinderGeometry(21,22,.4,64),stone,0,16.85,-72);
  for(const r of [6,13,20]){const ring=add(new THREE.TorusGeometry(r,.07,5,96),gold,0,17.12,-72);ring.rotation.x=Math.PI/2;}
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,x=Math.sin(a)*67,z=-45+Math.cos(a)*50;if(Math.abs(x)<12)continue;const y=this.height(x,z),r=2+i%3;const rock=add(new THREE.DodecahedronGeometry(r,0),stone,x,y+r*.65,z);rock.scale.y=1.5;if(i%3===0){const core=add(new THREE.OctahedronGeometry(.8),lava,x,y+3,z);this.rotating.push(core);}this.collision.addCircle(x,z,r+1,y,y+7);}
  this.root.add(islandPaths((x,z)=>this.height(x,z),DAWN_PATHS,3));
  this.cage.position.set(13,this.height(13,-57),-57);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,bar=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,4.5,5),gold);bar.position.set(Math.sin(a)*2.1,2.25,Math.cos(a)*2.1);this.cage.add(bar);}for(const y of [.3,4.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.1,.12,6,32),gold);ring.rotation.x=Math.PI/2;ring.position.y=y;this.cage.add(ring);}this.root.add(this.cage);
  this.scenery=new DawnScenery((x,z)=>this.height(x,z),this.collision);this.root.add(this.scenery.root);
  this.root.add(this.portal.root,new THREE.HemisphereLight('#ffe8be','#233a53',.9));const sun=this.sun.light;sun.name='dawnreach-sun';sun.color.set('#ffe6b3');sun.intensity=2.8;this.root.add(sun,sun.target);
 }
 async buildSettlement(){
  const village=await loadKit('models/world/village.glb'),props=await loadKit('models/world/props.glb');
  const homes=new StaticBatch(village,'dawnharbor-homes'),builder=new TownBuilder(village,homes,this.collision,{});
  const lots:Lot[]=[];
  for(const side of [-1,1])for(let i=0;i<4;i++){const x=side*(i%2?38:35),z=26+i*19;lots.push({id:`dawn-${side}-${i}`,kind:i===2?(side===1?'forge':'tavern'):'house',x,z,yaw:side<0?Math.PI/2:-Math.PI/2,sx:i===2?4:3,sz:i===2?4:3,floors:i%2?2:1,style:(i+(side>0?2:0))%4,h:this.height(x,z)});}
  for(const lot of lots)builder.build(lot);this.root.add(homes.build());
  // Use the same textured foliage kit as World I: real branching trunks and leaf clusters.
  const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,'dawnreach-leafy-trees');
  const copies=new Map<THREE.Material,THREE.Material>();
  for(const [name,m] of nature.materials){const c=m.clone();if(c instanceof THREE.MeshStandardMaterial&&name.startsWith('Leaves')){c.color.set('#e4efc9');c.side=THREE.DoubleSide;c.roughness=.9;}copies.set(m,c);nature.materials.set(name,c);}
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;
  const trees=['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5'].filter(n=>nature.has(n));
  let count=0;
  for(let i=0;i<75;i++){
   const a=i*2.39996,x=Math.sin(a)*(56+i%5*5),z=30+Math.cos(a)*66;
   if(roadClearance(x,z)<4||Math.abs(x)<14||Math.hypot(x-67,z-72)<12||Math.hypot(x,z+72)<32||Math.abs(x)>28&&Math.abs(x)<48&&z>17&&z<96)continue;
   if(Math.abs(z-(75+(x+5)*.15))<4&&x<0&&x>-53||Math.abs(z-84)<5&&x>14&&x<61)continue;
   const scale=.75+(i%4)*.12;forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,scale));this.collision.addCircle(x,z,.5*scale,this.height(x,z),this.height(x,z)+10);count++;
  }
  for(let i=0;i<12;i++){const a=i*2.39996,x=-65+Math.cos(a)*(7+i%3*2),z=45+Math.sin(a)*(8+i%4*2);if(Math.hypot(x+62,z-48)<4||roadClearance(x,z)<3)continue;forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,.67));this.collision.addCircle(x,z,.4,this.height(x,z),this.height(x,z)+8);count++;}
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
 update(time:number,rescued:boolean,x:number,z:number){this.wind?.update(time);this.sun.update(x,z);this.scenery.update(time);this.portal.update(time);this.cage.visible=!rescued;for(const r of this.rotating){r.rotation.y=time*.45;r.rotation.z=Math.sin(time*.8+r.position.x)*.15;}}
}
