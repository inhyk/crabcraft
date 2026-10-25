import * as THREE from 'three';
import {snowHeight} from '../sim/world/ground';
import {SNOW_WIND} from '../sim/world/snowGround';
import {layoutFrostlight,snowTrees,SNOW_FOUNTAIN} from './world4Colliders';
import type {Poi} from '../world/types';
import {FrostPortal} from './frostPortal';
import {frostRequestLook} from './frostRequests';
import type {IslandPath} from './islandPaths';
import {FROST_NORTH_ROAD,FROST_NPCS,FROST_PADS,FROST_POIS,FROST_TOWN_POINTS,FROST_WAYS} from '../sim/world/snowLayout';
import {frostPaving,type FrostPaving} from './frostPaving';
import {frostArena,type FrostArena} from './frostArena';
import {SnowDeform} from './snowDeform';
import {applySnowSurface,SnowFootfalls} from './snowSurface';
import {SnowTerrain} from './snowTerrain';
import {SnowRidges} from './snowRidges';
import {snowRocks} from './snowRocks';
import {SnowSpray} from './snowSpray';
import {crystalCluster,crystalGeometry,iceMaterial,type Crystal} from './iceCrystals';
import {frostThrone,type FrostThrone} from './frostThrone';
import {iceCliffs} from './frostCliffsLayout';
import {miraPrison,type MiraPrison} from './frostPrison';
import {frostCamps,type FrostCamps} from './frostCamps';
import {SnowSky} from './snowSky';
import {FROST_PALETTE} from './snowPalette';
import {SnowFarShadow,applyFarShadow} from './snowFarShadow';
import {SnowSpindrift} from './snowSpindrift';
import {snowPines} from './snowPines';
import {buildSnowVillage,type SnowVillage} from './snowVillage';
import {buildSnowFields,type SnowFields} from './snowFields';
import {snowGroves,snowSaplings} from './snowFieldsLayout';
import {frozenPond} from './snowVillageDressing';
import {snowFountainBasin} from './snowFountain';
import {snowSeaIce} from './snowSeaIce';
import type {Unit} from './unit';

/** Frostlight's points of interest, as the client places them (the server's are in src/sim/areas/world4.ts). */
export const SNOW_POI_POINTS=[['forge',...FROST_POIS.forge],['chapel',...FROST_POIS.chapel],['tavern',...FROST_POIS.tavern],['grove',-55,25],['shore',55,25],['wreck',48,-15],['lighthouse',0,-44],['beacon',0,-46],['bossArena',0,-78]] as const;

/** Deterministic snow realm. Trees share instanced meshes; snowfall runs on the GPU. */
export class SnowIsland {
 readonly root=new THREE.Group();
 readonly prison=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,5,90);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,19,-78),yaw:0,radius:22};
 /** The residents where their trades live, the way each faces, and where the townsfolk mill about (snowLayout.ts). */
 readonly town:[number,number][]=FROST_NPCS.map(n=>[n.x,n.z]);
 readonly townYaw=FROST_NPCS.map(n=>n.yaw);
 readonly walks=FROST_TOWN_POINTS;
 /** Way points along the north road for the path hints: the gate, the eastern bend, the ring of stones. */
 readonly roadHints=[FROST_NORTH_ROAD.points[0],FROST_NORTH_ROAD.points[Math.floor(FROST_NORTH_ROAD.points.length/2)],FROST_NORTH_ROAD.points[FROST_NORTH_ROAD.points.length-1]];
 readonly collision=layoutFrostlight();
 readonly portal:FrostPortal;
 private sun=new THREE.DirectionalLight();
 /** SNOWFLOW's atmosphere: a low raking sun at polar twilight, so the aurora still reads. Sun, ambient, fog and ice all come from it, graded by Frostlight's palette (gold sun, blue-violet sky). */
 readonly sky=new SnowSky({azimuth:42,elevation:13,night:.55,exposure:.42,wind:[SNOW_WIND[0],SNOW_WIND[1]],palette:FROST_PALETTE});
 private snow:THREE.ShaderMaterial;
 private aurora:THREE.ShaderMaterial;
 /** Prints and berms the crabs leave in the snowfield (SNOWFLOW's deformation buffer). */
 readonly deform=new SnowDeform(40);
 private footfalls=new SnowFootfalls();
 /** The clipmap snowfield; its rings follow the player. */
 readonly terrain:SnowTerrain;
 /** The ranges across the frozen sea, baked on the GPU on the first Frostlight frame. */
 readonly ridges:SnowRidges;
 /** Powder the same footfalls kick up; the arena's ice floor is not snow. */
 readonly spray=new SnowSpray(this.root,{sun:this.sun,bare:(x,z)=>Math.hypot(x-this.arena.position.x,z-this.arena.position.z)<this.arena.radius+1});
 private refreshSnow:()=>void;
 private iceGlass:THREE.Material;
 private basin:THREE.Mesh;
 /** Kit houses, lamps and props; null until buildSettlement() has loaded the kits. */
 village:SnowVillage|null=null;
 /** Groves, boulders, dead trees, ponds, trails and sea ice of the open fields (snowFields.ts); null until buildSettlement(). */
 fields:SnowFields|null=null;
 private paving:FrostPaving;
 private arenaFloor:FrostArena;
 private refreshIce:(quality?:'high'|'low')=>void;
 /** The sun's shadow past the live shadow box, baked once the village and forest stand (snowFarShadow.ts). */
 readonly farShadow:SnowFarShadow;
 /** Streamers of snow the wind lifts off the crests (snowSpindrift.ts). */
 readonly spindrift:SnowSpindrift;
 /** Boreas's throne, the glacial citadel and the arena's crowned pillars (frostThrone.ts). */
 private throne:FrostThrone;
 private prisonFx:MiraPrison;
 /** The lean-to, the overlook, the ridge stones and the processional way (frostCamps.ts); null until the kits load. */
 private camps:FrostCamps|null=null;
 height(x:number,z:number){
  return snowHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD IV · Frostlight';this.root.visible=false;
  const dark=new THREE.MeshStandardMaterial({color:'#344959',roughness:.9});
  // Grown ice (SNOWFLOW's crystal shape and shading). The seed fixes the formations for every player.
  const {material:iceGlass,refresh:refreshIce}=iceMaterial({sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,snowBounce:this.sky.snowBounce});this.refreshIce=refreshIce;this.iceGlass=iceGlass;
  this.portal=this.gate(this.spawn,'서리빛 설원 → 새벽 항구');
  let seed=20261018;const rand=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const iceMesh=(list:Crystal[],name:string)=>{const m=new THREE.Mesh(crystalGeometry(list),iceGlass);m.name=name;m.castShadow=true;this.root.add(m);return m;};
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // The snowfield: a clipmap that follows the player, placed and carved on the GPU (snowTerrain.ts), shaded by snowSurface.ts.
  const groundMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.62,metalness:0});
  this.terrain=new SnowTerrain(groundMat,this.deform);this.farShadow=new SnowFarShadow(this.sky.sunDir);
  this.refreshSnow=applySnowSurface(groundMat,this.deform,{sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,far:this.farShadow});
  this.terrain.mesh.name='snowdrift-terrain';this.root.add(this.terrain.mesh);
  // The frozen sea's floes, leads and snow-bound shore over the clipmap's sea (snowSeaIce.ts).
  this.root.add(snowSeaIce(this.terrain.uniforms));
  // Crags breaking through the drifts, for scale and the horizon (snowRocks.ts).
  this.root.add(snowRocks((x,z)=>this.height(x,z),this.terrain.uniforms));
  // Snowed-in cobbled streets and squares (frostPaving.ts) on Frostlight's own plan (snowLayout.ts): the winding high
  // street, the lanes, the two squares, the road out of the gate and the processional way to the throne.
  const paths:IslandPath[]=FROST_WAYS.map(w=>({points:w.points,width:w.width,trim:true}));
  this.paving=frostPaving((x,z)=>this.height(x,z),paths,{skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,sunDir:this.sky.sunDir,deform:this.deform,pads:FROST_PADS});this.root.add(this.paving.root);
  // Frozen fountain: a turned stone basin (the kit's stone once buildSettlement() has it) round a pond of ice.
  const {x:fx,z:fz}=SNOW_FOUNTAIN,fy=this.height(fx,fz);
  this.basin=add(snowFountainBasin(),dark,fx,fy,fz);this.basin.name='snow-fountain-basin';
  const pond=add(new THREE.CircleGeometry(2.46,48).rotateX(-Math.PI/2),frozenPond(2.46),fx,fy+.44,fz);pond.name='snow-fountain-ice';pond.castShadow=false;
  iceMesh(crystalCluster(0,0,0,4.4,1.9,6,rand),'snow-fountain-sculpture').position.set(fx,fy+.62,fz);
  // Houses, lamp posts and the rest of the village are kit pieces, raised in buildSettlement() (snowVillage.ts).
  // Snow-laden kit pines (snowPines.ts) stand on these trunks once buildSettlement() has loaded the kit.
  this.root.userData.snowPines=snowTrees().length;
  // Boreas keeps the missing friend in a luminous ice prison beside the throne.
  this.prison.name='mira-ice-prison';this.prison.position.set(13,this.height(13,-62),-62);
  // Grown-ice bars on a carved ring, meeting overhead like claws (frostPrison.ts).
  this.prisonFx=miraPrison(this.prison,iceGlass);
  this.root.add(this.prison);
  // Ice cliffs frame the north without obstructing the arena's broad southern entrance.
  const cliffs:Crystal[]=[];
  for(const {i,x,z,h} of iceCliffs())crystalCluster(x,this.height(x,z),z,h*1.1,4+i%3,5+i%3,rand,cliffs);
  iceMesh(cliffs,'frostlight-ice-cliffs');
  // Carved ice floor with the three combat rings cut in as runes (frostArena.ts).
  this.arenaFloor=frostArena({center:this.arena.position,radius:this.arena.radius,rings:[6,13,21.5],skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,snowBounce:this.sky.snowBounce});this.root.add(this.arenaFloor.root);
  // The floors take the far sun shadow past the live box too, so they never stay lit beside shaded snow.
  for(const o of [this.paving.root.getObjectByName('frostlight-paving-surface'),this.arenaFloor.root.getObjectByName('frostlight-arena-ice')])if(o instanceof THREE.Mesh)applyFarShadow(o.material,this.farShadow);
  // The throne, the citadel behind it and the arena's crowned crystal pillars (frostThrone.ts).
  this.throne=frostThrone({height:(x,z)=>this.height(x,z),ice:iceGlass});this.root.add(this.throne.root);
  this.spindrift=new SnowSpindrift({sunDir:this.sky.sunDir,sunLight:this.sky.sunLight,sky:this.sky.hemiSky,bounce:this.sky.hemiGround,ground:this.terrain.uniforms,far:this.farShadow});this.root.add(this.spindrift.mesh);
  this.root.add(this.sky.mesh);
  // Ranges across the frozen sea, hazed toward the dome's own colour.
  this.ridges=new SnowRidges(this.sky);this.root.add(this.ridges.mesh);
  // The scattered sky behind the aurora is brighter than the old gradient was, so the curtain glows 1.7x to keep reading.
  // Its ends fade out, so the curtain never shows the edge of its plane.
  this.aurora=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.x*.025+time*.15)*20.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;uniform float time;void main(){float rays=.5+.5*sin(v.x*75.+sin(v.x*12.+time*.2)*3.);float a=sin(v.y*3.14159)*(.1+.22*rays)*smoothstep(0.,.2,v.x)*smoothstep(1.,.8,v.x);gl_FragColor=vec4(mix(vec3(.1,.95,.65),vec3(.35,.32,.9),v.y)*1.7,a);}'});
  add(new THREE.PlaneGeometry(650,90,64,1),this.aurora,0,135,-270).castShadow=false;
  // Flakes ride the wind and stay put in the world (wrapped round the player), so walking passes through them.
  const flakes=new THREE.BufferGeometry(),fp=new Float32Array(1800*3);for(let i=0;i<1800;i++)fp.set([Math.sin(i*127.1)*60,Math.sin(i*311.7)*30,Math.sin(i*74.7)*60],i*3);flakes.setAttribute('position',new THREE.BufferAttribute(fp,3));
  this.snow=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},origin:{value:new THREE.Vector3()},wind:{value:new THREE.Vector2(SNOW_WIND[0],SNOW_WIND[1])}},vertexShader:'uniform float time;uniform vec3 origin;uniform vec2 wind;void main(){vec3 p=position;p.y=mod(position.y-time*(1.3+.6*fract(position.x*.37))+60.,60.)-15.+origin.y;vec2 q=position.xz+wind*time*1.9+vec2(sin(time*.6+position.z),cos(time*.45+position.x))*.7;p.xz=origin.xz+mod(q-origin.xz+60.,120.)-60.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(65./max(1.,-mv.z),1.2,4.);gl_Position=projectionMatrix*mv;}',fragmentShader:'void main(){float a=1.-smoothstep(.2,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.9,.97,1.,a*.75);}'});
  const fall=new THREE.Points(flakes,this.snow);fall.frustumCulled=false;fall.name='gpu-snowfall';this.root.add(fall,this.portal.root,new THREE.HemisphereLight(this.sky.hemiSky,this.sky.hemiGround,1));
  this.sky.attachSun(this.sun);this.root.add(this.sun,this.sun.target);
 }
 /** Frostlight's carved gateway (frostPortal.ts), for the spawn portal and world2's onward gate. */
 gate(position:THREE.Vector3,label:string){return new FrostPortal(position,label,{ice:this.iceGlass,height:(x,z)=>this.height(x,z)});}
 /** Frostlight's own quest props for its DawnRequests (frostRequests.ts). */
 questProps(){return frostRequestLook({height:(x,z)=>this.height(x,z),ice:this.iceGlass,ground:this.terrain.uniforms});}
 /** The forest and the village need the kits, so they load after construction like DawnIsland's settlement. */
 async buildSettlement(){
  const height=(x:number,z:number)=>this.height(x,z);
  // The fields' groves stand in the same batch as the village forest: one draw for every pine.
  const [forest,village,,camps,fields]=await Promise.all([snowPines([...snowTrees(),...snowGroves(),...snowSaplings()],height),buildSnowVillage({height,ice:this.iceGlass}),this.throne.dress(),frostCamps({height,ice:this.iceGlass,ground:this.terrain.uniforms,sun:{dir:this.sky.sunDir,color:this.sky.sunLight}}),buildSnowFields({height,ground:this.terrain.uniforms,sunDir:this.sky.sunDir,sky:this.sky,snow:this.terrain.mesh.material as THREE.Material})]);
  this.root.add(forest,village.group,camps.group,fields.group);this.camps=camps;this.fields=fields;this.village=village;this.basin.material=village.stone;
 }
 /** Footprints for every crab near the player, then one deformation step. Runs only while Frostlight is shown. */
 updateSnow(dt:number,renderer:THREE.WebGLRenderer,units:readonly Unit[],x:number,z:number,quality:'high'|'low'='high'){this.terrain.setQuality(quality);this.terrain.prepare(renderer);
  if(this.village&&!this.farShadow.baked)this.farShadow.bake(renderer,this.root,{tex:this.terrain.uniforms.snowGroundTex.value!,rect:this.terrain.uniforms.snowGroundRect.value},[this.terrain.mesh,this.prison,this.portal.root],quality);this.ridges.prepare(renderer);this.footfalls.update(units,this.deform,(px,pz)=>this.height(px,pz),x,z,this.spray,dt);this.deform.step(renderer,dt,x,z,quality);this.paving.setQuality(quality);this.arenaFloor.update(this.snow.uniforms.time.value,quality);this.spray.update(dt,x,z,quality);this.spindrift.setQuality(quality);this.village?.setQuality(quality);this.fields?.setQuality(quality);this.refreshSnow();this.refreshIce(quality);}
 disposeSnow(){this.farShadow.dispose();this.deform.dispose();this.spray.dispose();this.terrain.dispose();}
 update(time:number,x:number,z:number,rescued=false){this.terrain.follow(x,z);this.prison.visible=!rescued;if(!rescued)this.prisonFx.update(time);this.portal.update(time);this.snow.uniforms.time.value=time;this.snow.uniforms.origin.value.set(x,this.height(x,z),z);this.aurora.uniforms.time.value=time;this.throne.update(time);this.camps?.update(time);this.village?.update(time,x,z);this.fields?.update(time,x,z);this.sky.update(time);this.spindrift.update(time,x,z);this.sky.followSun(x,this.height(x,z),z);}
}
