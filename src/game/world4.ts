import * as THREE from 'three';
import {snowHeight} from '../sim/world/ground';
import {SNOW_WIND} from '../sim/world/snowGround';
import {layoutFrostlight,snowTrees,SNOW_FOUNTAIN} from './world4Colliders';
import type {Poi} from '../world/types';
import {StarPortal} from './portal';
import type {IslandPath} from './islandPaths';
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
import {citadelClears} from './frostThroneLayout';
import {SnowSky} from './snowSky';
import {snowPines} from './snowPines';
import {buildSnowVillage,type SnowVillage} from './snowVillage';
import {frozenPond} from './snowVillageDressing';
import {lathe} from '../world/geom';
import type {Unit} from './unit';

/** Deterministic snow realm. Trees share instanced meshes; snowfall runs on the GPU. */
export class SnowIsland {
 readonly root=new THREE.Group();
 readonly prison=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,5,90);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,19,-78),yaw:0,radius:22};
 readonly town:[number,number][]=[[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68]];
 readonly collision=layoutFrostlight();
 readonly portal=new StarPortal(this.spawn,'서리빛 설원 → 새벽 항구');
 private sun=new THREE.DirectionalLight();
 /** SNOWFLOW's atmosphere: a low raking sun at polar twilight, so the aurora still reads. Sun, ambient, fog and ice all come from it. */
 readonly sky=new SnowSky({azimuth:42,elevation:13,night:.55,exposure:.42,wind:[SNOW_WIND[0],SNOW_WIND[1]]});
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
 private paving:FrostPaving;
 private arenaFloor:FrostArena;
 private refreshIce:()=>void;
 /** Boreas's throne, the glacial citadel and the arena's crowned pillars (frostThrone.ts). */
 private throne:FrostThrone;
 height(x:number,z:number){
  return snowHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD IV · Frostlight';this.root.visible=false;
  const ice=new THREE.MeshStandardMaterial({color:'#72bedb',metalness:.32,roughness:.22});
  const dark=new THREE.MeshStandardMaterial({color:'#344959',roughness:.9});
  const glow=new THREE.MeshStandardMaterial({color:'#c4ffff',emissive:'#52d8ff',emissiveIntensity:1.4,roughness:.25});
  // Grown ice (SNOWFLOW's crystal shape and shading). The seed fixes the formations for every player.
  const {material:iceGlass,refresh:refreshIce}=iceMaterial({sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,snowBounce:this.sky.snowBounce});this.refreshIce=refreshIce;this.iceGlass=iceGlass;
  let seed=20261018;const rand=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const iceMesh=(list:Crystal[],name:string)=>{const m=new THREE.Mesh(crystalGeometry(list),iceGlass);m.name=name;m.castShadow=true;this.root.add(m);return m;};
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // The snowfield: a clipmap that follows the player, placed and carved on the GPU (snowTerrain.ts), shaded by snowSurface.ts.
  const groundMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.62,metalness:0});
  this.terrain=new SnowTerrain(groundMat,this.deform);
  this.refreshSnow=applySnowSurface(groundMat,this.deform,{sun:this.sun,skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith});
  this.terrain.mesh.name='snowdrift-terrain';this.root.add(this.terrain.mesh);
  // Crags breaking through the drifts, for scale and the horizon (snowRocks.ts).
  this.root.add(snowRocks((x,z)=>this.height(x,z),this.terrain.uniforms));
  // Snowed-in cobbled streets (frostPaving.ts) on the same layout as before, so walking and covers() are unchanged.
  const paths:IslandPath[]=[{points:[[0,94],[0,28],[0,-53]],width:8,trim:true},...[38,56,74].map(z=>({points:[[-22,z],[22,z]] as [number,number][],width:4,trim:true}))];
  this.paving=frostPaving((x,z)=>this.height(x,z),paths,{skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,sunDir:this.sky.sunDir,deform:this.deform});this.root.add(this.paving.root);
  // Frozen fountain: a turned stone basin (the kit's stone once buildSettlement() has it) round a pond of ice.
  const {x:fx,z:fz}=SNOW_FOUNTAIN,fy=this.height(fx,fz);
  this.basin=add(lathe([[2.42,.36],[2.46,.62],[2.6,.75],[2.92,.75],[3.06,.6],[3.06,.12],[3.14,0],[3.14,-.6]],56,.5),dark,fx,fy,fz);this.basin.name='snow-fountain-basin';
  const pond=add(new THREE.CircleGeometry(2.46,48).rotateX(-Math.PI/2),frozenPond(2.46),fx,fy+.44,fz);pond.name='snow-fountain-ice';pond.castShadow=false;
  iceMesh(crystalCluster(0,0,0,4.4,1.9,6,rand),'snow-fountain-sculpture').position.set(fx,fy+.62,fz);
  // Houses, lamp posts and the rest of the village are kit pieces, raised in buildSettlement() (snowVillage.ts).
  // Snow-laden kit pines (snowPines.ts) stand on these trunks once buildSettlement() has loaded the kit.
  this.root.userData.snowPines=snowTrees().length;
  // Boreas keeps the missing friend in a luminous ice prison beside the throne.
  this.prison.name='mira-ice-prison';this.prison.position.set(13,this.height(13,-62),-62);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,bar=new THREE.Mesh(new THREE.CylinderGeometry(.11,.16,4.5,6),ice);bar.position.set(Math.sin(a)*2.3,2.25,Math.cos(a)*2.3);this.prison.add(bar);}
  for(const y of [.2,4.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.3,.14,6,40),glow);ring.rotation.x=Math.PI/2;ring.position.y=y;this.prison.add(ring);}
  this.root.add(this.prison);
  // Ice cliffs frame the north without obstructing the arena's broad southern entrance.
  const cliffs:Crystal[]=[];
  for(let i=0;i<42;i++){const a=i/42*Math.PI*2,x=Math.sin(a)*78,z=-42+Math.cos(a)*70;if(Math.abs(x)<16&&z>-70||citadelClears(x,z))continue;const y=this.height(x,z),h=6+i%5*3;crystalCluster(x,y,z,h*1.1,4+i%3,5+i%3,rand,cliffs);}
  iceMesh(cliffs,'frostlight-ice-cliffs');
  // Carved ice floor with the three combat rings cut in as runes (frostArena.ts).
  this.arenaFloor=frostArena({center:this.arena.position,radius:this.arena.radius,rings:[6,13,21.5],skyHorizon:this.sky.skyHorizon,skyZenith:this.sky.skyZenith,snowBounce:this.sky.snowBounce});this.root.add(this.arenaFloor.root);
  // The throne, the citadel behind it and the arena's crowned crystal pillars (frostThrone.ts).
  this.throne=frostThrone({height:(x,z)=>this.height(x,z),ice:iceGlass});this.root.add(this.throne.root);
  this.root.add(this.sky.mesh);
  // Ranges across the frozen sea, hazed toward the dome's own colour.
  this.ridges=new SnowRidges(this.sky);this.root.add(this.ridges.mesh);
  // The scattered sky behind the aurora is brighter than the old gradient was, so the curtain glows 1.7x to keep reading.
  // Its ends fade out, so the curtain never shows the edge of its plane.
  this.aurora=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.x*.025+time*.15)*20.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;uniform float time;void main(){float rays=.5+.5*sin(v.x*75.+sin(v.x*12.+time*.2)*3.);float a=sin(v.y*3.14159)*(.1+.22*rays)*smoothstep(0.,.2,v.x)*smoothstep(1.,.8,v.x);gl_FragColor=vec4(mix(vec3(.1,.95,.65),vec3(.35,.32,.9),v.y)*1.7,a);}'});
  add(new THREE.PlaneGeometry(650,90,64,1),this.aurora,0,135,-270).castShadow=false;
  const flakes=new THREE.BufferGeometry(),fp=new Float32Array(1800*3);for(let i=0;i<1800;i++)fp.set([Math.sin(i*127.1)*60,Math.sin(i*311.7)*30,Math.sin(i*74.7)*60],i*3);flakes.setAttribute('position',new THREE.BufferAttribute(fp,3));
  this.snow=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},origin:{value:new THREE.Vector3()}},vertexShader:'uniform float time;uniform vec3 origin;void main(){vec3 p=position;p.x+=sin(time*.2+position.z)*1.6;p.y=mod(position.y-time*1.6+60.,60.)-15.;p+=origin;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(65./max(1.,-mv.z),1.2,4.);gl_Position=projectionMatrix*mv;}',fragmentShader:'void main(){float a=1.-smoothstep(.2,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.9,.97,1.,a*.75);}'});
  const fall=new THREE.Points(flakes,this.snow);fall.frustumCulled=false;fall.name='gpu-snowfall';this.root.add(fall,this.portal.root,new THREE.HemisphereLight(this.sky.hemiSky,this.sky.hemiGround,1));
  this.sky.attachSun(this.sun);this.root.add(this.sun,this.sun.target);
 }
 /** The forest and the village need the kits, so they load after construction like DawnIsland's settlement. */
 async buildSettlement(){
  const height=(x:number,z:number)=>this.height(x,z);
  const [forest,village]=await Promise.all([snowPines(snowTrees(),height),buildSnowVillage({height,ice:this.iceGlass})]);
  this.root.add(forest,village.group);this.village=village;this.basin.material=village.stone;
 }
 /** Footprints for every crab near the player, then one deformation step. Runs only while Frostlight is shown. */
 updateSnow(dt:number,renderer:THREE.WebGLRenderer,units:readonly Unit[],x:number,z:number,quality:'high'|'low'='high'){this.terrain.setQuality(quality);this.terrain.prepare(renderer);this.ridges.prepare(renderer);this.footfalls.update(units,this.deform,(px,pz)=>this.height(px,pz),x,z,this.spray,dt);this.deform.step(renderer,dt,x,z,quality);this.paving.setQuality(quality);this.arenaFloor.update(this.snow.uniforms.time.value,quality);this.spray.update(dt,x,z,quality);this.village?.setQuality(quality);this.refreshSnow();this.refreshIce();}
 disposeSnow(){this.deform.dispose();this.spray.dispose();this.terrain.dispose();}
 update(time:number,x:number,z:number,rescued=false){this.terrain.follow(x,z);this.prison.visible=!rescued;this.portal.update(time);this.snow.uniforms.time.value=time;this.snow.uniforms.origin.value.set(x,this.height(x,z),z);this.aurora.uniforms.time.value=time;this.throne.update(time);this.village?.update(time,x,z);this.sky.update(time);this.sky.followSun(x,this.height(x,z),z);}
}
