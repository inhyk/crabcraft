import * as THREE from 'three';
import {EmberSky} from './emberSky';
import {EmberHeat} from './emberSkyHeat';
import {EmberPlume,volcanoMaterial} from './emberSkyPlume';
import {buildEmberShore} from './emberSkyShore';
import type {LavaZone} from './emberLava';

export interface EmberAirOptions {
 root:THREE.Object3D;
 height:(x:number,z:number)=>number;
 /** height(0, -72): the volcano sits at (0, ly + 9, -128). */
 ly:number;
 volcano:THREE.Mesh;
 zones:readonly LavaZone[];
 /** Subtrees the heat light leaves alone (the lava itself, portals shared with other worlds). */
 noHeat:readonly THREE.Object3D[];
}

function storedQuality():'high'|'low'{try{return localStorage.getItem('cc.quality')==='low'?'low':'high';}catch{return 'high';}}

/**
 * World V's air and light in one rig: the baked sky with its sun, violet fill and lava bounce, the per-view ash fog and
 * environment map (bound to the scene while World V is shown, the previous one handed back after), the lava's heat
 * light on every lit material, the volcano's plume and strata, drifting ash and embers, and the basalt coast.
 */
export class EmberAir {
 readonly sky=new EmberSky({azimuth:72,elevation:19});
 readonly sun=new THREE.DirectionalLight();
 readonly hemi:THREE.HemisphereLight;
 /** Cool rim on the player's crab, low behind it from the camera: it grazes the shell's back edges (red shell against orange lava) without lighting its top. */
 readonly rim=new THREE.PointLight('#9fc4ff',9,2.4,2);
 readonly heat:EmberHeat;
 readonly plume:EmberPlume;
 readonly shore:THREE.Group;
 readonly counts:{columns:number;spatter:number};
 private env:THREE.Texture|null=null;
 private prevEnv:THREE.Texture|null=null;
 private prevEnvIntensity=1;
 private patchedAt=-1e9;
 private idleScans=0;
 private readonly root:THREE.Object3D;
 private readonly noHeat:THREE.Object3D[];
 private readonly height:(x:number,z:number)=>number;
 constructor(o:EmberAirOptions){
  this.root=o.root;this.height=o.height;
  const quality=storedQuality();
  this.sky.attachSun(this.sun);
  this.hemi=new THREE.HemisphereLight(this.sky.hemiSky,this.sky.hemiGround,this.sky.hemiIntensity);
  this.heat=new EmberHeat(o.zones);
  o.volcano.material=volcanoMaterial(0,-128,o.ly-10,o.ly+28);
  const wind=new THREE.Vector2(-.42,-.91).normalize();
  this.plume=new EmberPlume({crater:new THREE.Vector3(0,o.ly+27,-128),sunDir:this.sky.sunDir,sunColor:this.sky.sunColor,wind,heat:this.heat.uniforms,quality});
  const shore=buildEmberShore({height:o.height,ly:o.ly,zones:o.zones,quality});
  this.shore=shore.root;this.counts={columns:shore.columns,spatter:shore.spatter};
  this.rim.name='ember-player-rim';
  o.root.add(this.sky.mesh,this.sun,this.sun.target,this.hemi,this.rim,this.plume.root,this.shore);
  this.noHeat=[...o.noHeat,this.sky.mesh,this.plume.root];
  this.root.userData.emberAir=this;
  this.heat.patchTree(this.root,this.noHeat);
 }
 update(time:number){
  this.sky.update(time);this.plume.update(time);this.heat.uniforms.uHeatTime.value=time%600;this.heat.uniforms.uHeatOn.value=1;
  // Lit materials added later (other builders, loaded kits) pick up the heat light too.
  // Scans every 2 s until ten in a row find nothing new.
  if(this.idleScans<10&&(time-this.patchedAt>2||time<this.patchedAt)){this.patchedAt=time;this.idleScans=this.heat.patchTree(this.root,this.noHeat)?0:this.idleScans+1;}
 }
 /** Per frame while World V is shown: fog toward the view, the dome's environment, the heat light, the ash box, the crab's rim. */
 apply(scene:THREE.Scene,camera:THREE.Camera,renderer:THREE.WebGLRenderer,player?:THREE.Vector3){
  const fog=scene.fog,e=camera.matrixWorld.elements;
  if(player){const dx=e[12]-player.x,dz=e[14]-player.z,l=Math.hypot(dx,dz)||1;this.rim.position.set(player.x-dx/l*1.4,player.y+1.15,player.z-dz/l*1.4);}
  if(fog instanceof THREE.FogExp2){this.sky.fogColor(-e[8],-e[10],fog.color);fog.density=this.sky.fogDensity(e[13],-e[9]);}
  const env=this.env??=this.sky.environment(renderer);
  if(scene.environment!==env){this.prevEnv=scene.environment;this.prevEnvIntensity=scene.environmentIntensity;scene.environment=env;}
  scene.environmentIntensity=this.sky.envIntensity;
  this.plume.view(camera,this.height(e[12],e[14]),renderer.domElement.height);
 }
 /** When World V is not shown: the heat light off, the scene's previous environment back. */
 release(scene:THREE.Scene){
  this.heat.uniforms.uHeatOn.value=0;
  if(!this.env||scene.environment!==this.env)return;
  scene.environment=this.prevEnv;scene.environmentIntensity=this.prevEnvIntensity;this.prevEnv=null;
 }
}
