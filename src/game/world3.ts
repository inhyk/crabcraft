import {dawnTown,type DawnTown} from './dawnTown';
import {DAWN_GOODS,dawnGoods} from './dawnGoods';
import {dawnHouses,type DawnQuarter} from './dawnHouses';
import {dawnDressing,type DawnDressing} from './dawnDressing';
import {dawnRequestLook} from './dawnRequestProps';
import {dawnPalms,type DawnPalms,type PalmSpot} from './dawnPalms';
import {Scatter} from '../world/kit';
import {rng} from '../world/noise';
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
import {DawnPortal} from './dawnPortal';
import {dawnCitadel,type DawnCitadel} from './dawnCitadel';
import {loadKit,trs} from '../world/kit';
import {dawnHeight,DAWN_ARENA_HEIGHT} from '../sim/world/ground';
import type {Poi} from '../world/types';
import {dawnForest,dawnGrove,layoutDawnreach,roadClearance} from './world3Colliders';
import {quarterPalms} from './dawnHousePlan';
import {dawnContact,contactPatch,type DawnContact} from './dawnContact';
import {dawnDuneClusters} from './dawnDuneClusters';
import {DAWN_SAND} from './dawnPaving';

/** The third island has its own warm coast, inhabited ring town and volcanic citadel. */
export class DawnIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,4,84);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,DAWN_ARENA_HEIGHT,-72),yaw:0,radius:20};
 /** Every World III collider, without meshes: the same registration the server bakes. */
 readonly collision=layoutDawnreach();
 readonly portal=new DawnPortal(new THREE.Vector3(-12,dawnHeight(-12,84),84),'골드샌드 항구 → 별빛 항구');
 readonly town:[number,number][]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]];
 private wind:StarWind|null=null;private scenery:DawnScenery;private sun=new THREE.DirectionalLight();
 /** The stolen dawn (dawnSky.ts): the sun low over the eastern sea; sun, hemisphere, fog and sea all read it. */
 readonly sky=new DawnSky({azimuth:112,elevation:13});private sea:DawnSea;
 /** Goldsand's desert: a clipmap round the player (sandTerrain.ts), prints that the wind fills in, sand kicked up by runners. */
 readonly terrain:SandTerrain;readonly deform=sandDeform(40);readonly spray:SandSpray;readonly drift:SandDrift;private footfalls:SandFootfalls;private refreshSand:()=>void;
 /** Dawnharbor's own streets, lamps, rocks, harbour and gate (dawnTown.ts). */
 readonly townLook:DawnTown;
 private dressing:DawnDressing|null=null;
 private citadel:DawnCitadel;
 private palms:DawnPalms|null=null;
 /** Goldsand Harbor's desert quarter: houses, shrine, forge, tavern, windcatchers, palms (dawnHouses.ts). */
 quarter:DawnQuarter|null=null;
 /** Contact shade where things meet the ground and in the sand's hollows (dawnContact.ts), baked once the quarter stands. */
 readonly contact:DawnContact;private kitMaterials=new Set<THREE.Material>();
 /** dawnHeight bound once, so the per-frame sand step allocates nothing. */
 private readonly heightAt=(x:number,z:number)=>dawnHeight(x,z);
 height(x:number,z:number){
  return dawnHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD III · Dawnreach';this.root.visible=false;
  // The desert: dawnHeight()'s GLSL twin baked on the GPU, placed by a clipmap, shaded as sand (sandTerrain.ts, sandSurface.ts).
  const sandMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.93,metalness:0});
  this.terrain=new SandTerrain(sandMat,this.deform);this.refreshSand=applySandSurface(sandMat,this.deform,{sky:this.sky.uniforms,sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,skyFill:this.sky.sandSkyFill});
  this.contact=dawnContact(this.terrain.uniforms.sandGroundTex);contactPatch(sandMat,this.contact.uniforms,'sCav');
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
  // Solarkan's citadel (dawnCitadel.ts); the boss platform keeps its name and size, its top the carved sun-dial.
  this.citadel=dawnCitadel((x,z)=>this.height(x,z));this.root.add(this.citadel.root);
  const floor=add(new THREE.CylinderGeometry(21,22,1.3,160),this.citadel.floor,0,DAWN_ARENA_HEIGHT-.6,-72);floor.name='dawn-boss-platform';floor.castShadow=false;
  this.townLook=dawnTown((x,z)=>this.height(x,z));this.root.add(this.townLook.root);
  this.scenery=new DawnScenery((x,z)=>this.height(x,z));this.root.add(this.scenery.root);
  this.root.add(this.portal.root,new THREE.HemisphereLight(this.sky.hemiSky,this.sky.hemiGround,1));const sun=this.sun;sun.name='dawnreach-sun';this.sky.attachSun(sun);this.root.add(sun,sun.target);
 }
 async buildSettlement(){
  await this.citadel.dress();
  const props=await loadKit('models/world/props.glb');for(const m of props.materials.values())this.kitMaterials.add(m);
  // Use the same textured foliage kit as World I: real branching trunks and leaf clusters.
  const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,'goldsand-scrub');for(const m of nature.materials.values())this.kitMaterials.add(m);
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
  const dry=['Grass_Wispy_Short'].filter(n=>nature.has(n)),oasis=['Fern_1','Grass_Common_Tall','Flower_3_Group','Flower_4_Group','Bush_Common_Flowers'].filter(n=>nature.has(n));
  let meadow=0;
  // Scrub grows in clumps where the sand holds water, in the hollows (lower than the ground five metres round), not
  // in rows: cluster centres, Poisson-spaced plants inside each; the first four clumps are the oasis.
  const R=rng(4207),cand:[number,number][]=[];
  for(let c=0;c<80;c++){
   const oasisC=c<4,cx=oasisC?-65+(R()-.5)*16:(R()*2-1)*85,cz=oasisC?45+(R()-.5)*16:-18+R()*122;
   let ring=0;for(let k=0;k<6;k++){const a=k/6*Math.PI*2;ring+=this.height(cx+Math.cos(a)*5,cz+Math.sin(a)*5);}
   if(!oasisC&&ring/6-this.height(cx,cz)<.05&&R()>.2)continue;
   const n=oasisC?16:3+Math.floor(R()*7),rad=oasisC?5:1.6+R()*2.4,pts:[number,number][]=[];
   for(let t=0;t<n*8&&pts.length<n;t++){const a=R()*Math.PI*2,r=Math.sqrt(R())*rad,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;if(pts.every(([px,pz])=>Math.hypot(px-x,pz-z)>.8))pts.push([x,z]);}
   cand.push(...pts);
  }
  for(const [i,[x,z]] of cand.entries()){
   if(this.height(x,z)<3||roadClearance(x,z)<.5||Math.hypot(x+11,z-53)<5||Math.hypot(x-67,z-72)<9||Math.abs(x)>27&&Math.abs(x)<48&&z>16&&z<98)continue;
   const atOasis=Math.hypot(x+65,z-45)<15;
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
  // Grouped scenes of goods on the bare ground: a caravan's rest, merchants' stacks, potters' yards (dawnGoods.ts).
  this.root.add(dawnGoods(DAWN_GOODS,(x,z)=>this.height(x,z)));
  // The open desert's stories: ruins, a fallen obelisk, lost cargo, bones, a wind fence, caravan tracks (dawnDuneClusters.ts).
  const duneScrub=new Scatter(nature,'goldsand-dune-scrub');
  this.root.add(dawnDuneClusters((x,z)=>this.height(x,z),DAWN_SAND.clone(),{add:(n,m)=>duneScrub.add(n,m),has:n=>nature.has(n)}).group,duneScrub.build({boundsPadding:.3}));
  for(const piece of nature.pieces.values())for(const part of piece.parts)part.geometry.dispose();
 }
 /** Dawnharbor's request props (dawnRequestProps.ts) in place of the shared placeholders. */
 questProps(){return dawnRequestLook();}
 private sunDir=new THREE.Vector3();
 /** The fog for a camera: the dawn's horizon in the direction it looks, thinner seen from high above. */
 fog(camera:THREE.Camera,fog:THREE.FogExp2){const e=camera.matrixWorld.elements;this.sky.fogColor(-e[8],-e[10],fog.color);fog.density=this.sky.fogDensity(e[13],-e[9]);}
 private envSaved:{env:THREE.Texture|null;k:number}|null=null;
 /** While Goldsand is shown the scene reflects its own dawn (DawnSky.environment), not World I's noon; restored when it hides. */
 useEnvironment(scene:THREE.Scene,renderer:THREE.WebGLRenderer,shown:boolean){
  if(shown){const env=this.sky.environment(renderer);if(scene.environment!==env){this.envSaved={env:scene.environment,k:scene.environmentIntensity};scene.environment=env;}scene.environmentIntensity=this.sky.envIntensity;}
  else if(this.envSaved){if(scene.environment===this.sky.environment(renderer))scene.environment=this.envSaved.env;scene.environmentIntensity=this.envSaved.k;this.envSaved=null;}
 }
 /** Low quality: a coarser clipmap and bake, no finest ripples, the sea's fine ripples, a cloud octave and half the shadow map. */
 setQuality(q:'high'|'low'){this.terrain.setQuality(q);this.drift.setQuality(q);this.sea.setQuality(q);this.sky.setQuality(q);}
 /** Prints for every crab near the player, one step of the sand field, the kicked sand. Runs only while Goldsand is shown. */
 updateSand(dt:number,renderer:THREE.WebGLRenderer,units:readonly Unit[],x:number,z:number,quality:'high'|'low'){this.terrain.prepare(renderer);if(this.quarter&&!this.contact.baked)this.contact.bake(renderer,this.root,new Set<THREE.Object3D>([this.terrain.mesh,this.sky.mesh,this.sea.mesh,this.drift.mesh,this.spray.mesh]),this.kitMaterials);this.footfalls.update(units,this.deform,this.heightAt,x,z,this.spray,dt);this.deform.step(renderer,dt,x,z,quality);this.spray.update(dt,x,z,quality);this.refreshSand();}
 disposeSand(){this.contact.dispose();this.deform.dispose();this.spray.dispose();this.terrain.dispose();}
 update(time:number,_rescued:boolean,x:number,z:number,quality:'high'|'low'='high'){this.terrain.follow(x,z);this.drift.update(time,x,z);this.townLook.update(time,quality,this.sunDir.subVectors(this.sun.position,this.sun.target.position));this.wind?.update(time);this.citadel.update(time,quality);this.palms?.update(time);this.dressing?.update(time);this.quarter?.update(time);this.sky.followSun(x,this.height(x,z),z);this.sky.update(time);this.sea.update(time);this.scenery.update(time);this.portal.update(time);}
}
