import {islandPaths} from './islandPaths';
import {Scatter} from '../world/kit';
import {StarWind} from './starWind';
import * as THREE from 'three';
import {DawnSky} from './dawnSky';
import {dawnSea,type DawnSea} from './dawnSea';
import {SandTerrain,sandDeform,SAND_GROUND_READ} from './sandTerrain';
import {applySandSurface,SandFootfalls} from './sandSurface';
import {SandSpray} from './sandSpray';
import {SandDrift} from './sandDrift';
import type {Unit} from './unit';
import {DawnScenery} from './dawnScenery';
import {StarPortal} from './portal';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {TownBuilder} from '../world/buildings';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../sim/world/ground';
import type {Poi} from '../world/types';
import {DAWN_PATHS,dawnForest,dawnGrove,dawnLots,dawnRocks,layoutDawnreach,roadClearance} from './world3Colliders';

/** The third island has its own warm coast, inhabited ring town and volcanic citadel. */
export class DawnIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,4,84);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,DAWN_ARENA_HEIGHT,-72),yaw:0,radius:20};
 /** Every World III collider, without meshes: the same registration the server bakes. */
 readonly collision=layoutDawnreach();
 readonly portal=new StarPortal(this.spawn,'새벽 항구 → 별빛 항구');
 readonly town:[number,number][]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]];
 private wind:StarWind|null=null;private scenery:DawnScenery;private sun=new THREE.DirectionalLight();
 /** The stolen dawn (dawnSky.ts): the sun low over the eastern sea; sun, hemisphere, fog and sea all read it. */
 readonly sky=new DawnSky({azimuth:112,elevation:11});private sea:DawnSea;
 /** Goldsand's desert: a clipmap round the player (sandTerrain.ts), prints that the wind fills in, sand kicked up by runners. */
 readonly terrain:SandTerrain;readonly deform=sandDeform(40);readonly spray:SandSpray;readonly drift:SandDrift;private footfalls:SandFootfalls;private refreshSand:()=>void;
 /** dawnHeight bound once, so the per-frame sand step allocates nothing. */
 private readonly heightAt=(x:number,z:number)=>dawnHeight(x,z);
 private rotating:THREE.Object3D[]=[];
 height(x:number,z:number){
  return dawnHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD III · Dawnreach';this.root.visible=false;
  const stone=new THREE.MeshStandardMaterial({color:'#393c4b',roughness:.9});
  const roof=new THREE.MeshStandardMaterial({color:'#267b82',roughness:.7});
  const gold=new THREE.MeshStandardMaterial({color:'#ffd67a',emissive:'#d57b23',emissiveIntensity:.65,metalness:.6,roughness:.35});
  const lava=new THREE.MeshStandardMaterial({color:'#ff763b',emissive:'#ff4612',emissiveIntensity:1.2});
  // The desert: dawnHeight()'s GLSL twin baked on the GPU, placed by a clipmap, shaded as sand (sandTerrain.ts, sandSurface.ts).
  const sandMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.93,metalness:0});
  this.terrain=new SandTerrain(sandMat,this.deform);this.refreshSand=applySandSurface(sandMat,this.deform,{sky:this.sky.uniforms,sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,skyFill:this.sky.sandSkyFill});
  // Paving and the arena floor take no prints and throw no sand.
  const bare=(x:number,z:number)=>roadClearance(x,z)<.15||Math.hypot(x,z+72)<22.5;
  this.footfalls=new SandFootfalls(bare);this.spray=new SandSpray(this.root,{sun:this.sun,bare});
  // Sand blowing off the crests (sandDrift.ts).
  this.drift=new SandDrift({sunDir:this.sky.sunDir,sunLight:this.sky.sunColor.clone().multiplyScalar(this.sky.sunIntensity),sky:this.sky.hemiSky,bounce:this.sky.hemiGround,ground:this.terrain.uniforms});
  this.root.add(this.terrain.mesh,this.drift.mesh,this.sky.mesh);
  // The sea reads its depth from the same bake.
  this.sea=dawnSea(this.sky,{uniforms:this.terrain.uniforms,read:SAND_GROUND_READ});this.root.add(this.sea.mesh);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // The town square uses the terrain and paving; a flat raised disc cut through its sloping roads.
  // A walkable, lit ascent to the fortress, built directly over the analytic surface.
  for(let i=0;i<72;i++){const z=83-i*2.12,y=this.height(0,z);
   if(i%5===0)for(const side of [-1,1]){add(new THREE.CylinderGeometry(.14,.22,2.4,6),stone,side*5.1,y+1.2,z);add(new THREE.OctahedronGeometry(.42),gold,side*5.1,y+2.6,z);}
  }
  for(const side of [-1,1]){const tower=add(new THREE.CylinderGeometry(3.6,4.4,15,10),stone,side*27,this.height(side*27,-56)+7.5,-56);add(new THREE.ConeGeometry(4.6,6,10),roof,tower.position.x,tower.position.y+10.5,-56);}
  const floor=add(new THREE.CylinderGeometry(21,22,1.3,64),stone,0,DAWN_ARENA_HEIGHT-.6,-72);floor.name='dawn-boss-platform';
  for(const r of [6,13,20]){const ring=add(new THREE.TorusGeometry(r,.07,5,96),gold,0,DAWN_ARENA_HEIGHT+.12,-72);ring.rotation.x=Math.PI/2;}
  for(const {i,x,z,r} of dawnRocks()){const y=this.height(x,z);const rock=add(new THREE.DodecahedronGeometry(r,0),stone,x,y+r*.65,z);rock.scale.y=1.5;if(i%3===0){const core=add(new THREE.OctahedronGeometry(.8),lava,x,y+3,z);this.rotating.push(core);}}
  this.root.add(islandPaths((x,z)=>this.height(x,z),DAWN_PATHS,3));
  this.scenery=new DawnScenery((x,z)=>this.height(x,z));this.root.add(this.scenery.root);
  this.root.add(this.portal.root,new THREE.HemisphereLight(this.sky.hemiSky,this.sky.hemiGround,1));const sun=this.sun;sun.name='dawnreach-sun';this.sky.attachSun(sun);this.root.add(sun,sun.target);
 }
 async buildSettlement(){
  const village=await loadKit('models/world/village.glb'),props=await loadKit('models/world/props.glb');
  const homes=new StaticBatch(village,'dawnharbor-homes'),builder=new TownBuilder(village,homes,null,{});
  for(const lot of dawnLots())builder.build(lot);this.root.add(homes.build());
  // Use the same textured foliage kit as World I: real branching trunks and leaf clusters.
  const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,'dawnreach-leafy-trees');
  const copies=new Map<THREE.Material,THREE.Material>();
  for(const [name,m] of nature.materials){const c=m.clone();if(c instanceof THREE.MeshStandardMaterial&&name.startsWith('Leaves')){c.color.set('#e4efc9');c.side=THREE.DoubleSide;c.roughness=.9;}
   // Desert grass: sun-bleached straw, not a lawn.
   if(c instanceof THREE.MeshStandardMaterial&&name==='Grass'){c.color.set('#e8c995');c.roughness=.95;}copies.set(m,c);nature.materials.set(name,c);}
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;
  const trees=['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5'].filter(n=>nature.has(n));
  let count=0;
  for(const {i,x,z,a,scale} of dawnForest()){forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,scale));count++;}
  for(const {i,x,z,a} of dawnGrove()){forest.add(trees[i%trees.length],trs(x,this.height(x,z),z,a,.67));count++;}
  // Sparse dry tussocks on the sand; no ferns or flower beds in a desert.
  const grasses=['Grass_Wispy_Short','Grass_Common_Short','Grass_Wispy_Tall'].filter(n=>nature.has(n)),flowers:string[]=[];
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
 /** The fog for a camera: the dawn's horizon in the direction it looks, thinner seen from high above. */
 fog(camera:THREE.Camera,fog:THREE.FogExp2){const e=camera.matrixWorld.elements;this.sky.fogColor(-e[8],-e[10],fog.color);fog.density=this.sky.fogDensity(e[13],-e[9]);}
 /** Low quality: a coarser clipmap and bake, no finest ripples, the sea's fine ripples, a cloud octave and half the shadow map. */
 setQuality(q:'high'|'low'){this.terrain.setQuality(q);this.drift.setQuality(q);this.sea.setQuality(q);this.sky.setQuality(q);}
 /** Prints for every crab near the player, one step of the sand field, the kicked sand. Runs only while Goldsand is shown. */
 updateSand(dt:number,renderer:THREE.WebGLRenderer,units:readonly Unit[],x:number,z:number,quality:'high'|'low'){this.terrain.prepare(renderer);this.footfalls.update(units,this.deform,this.heightAt,x,z,this.spray,dt);this.deform.step(renderer,dt,x,z,quality);this.spray.update(dt,x,z,quality);this.refreshSand();}
 disposeSand(){this.deform.dispose();this.spray.dispose();this.terrain.dispose();}
 update(time:number,_rescued:boolean,x:number,z:number){this.terrain.follow(x,z);this.drift.update(time,x,z);this.wind?.update(time);this.sky.followSun(x,this.height(x,z),z);this.sky.update(time);this.sea.update(time);this.scenery.update(time);this.portal.update(time);for(const r of this.rotating){r.rotation.y=time*.45;r.rotation.z=Math.sin(time*.8+r.position.x)*.15;}}
}
