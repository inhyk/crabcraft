import * as THREE from 'three';
import {WORLD_UNIFORMS} from '../world/materials';
import {SKY_PATHS} from './skyGroundLayout';
import {SKY_DETAIL,skyGround} from './skyGround';
import {skyMeadow} from './skyMeadow';
import {skyPaving} from './skyPaving';
import {skyForest} from './skyForest';

const FAR=new THREE.Vector3(1e4,0,1e4);
/** Skybloom's ground and forest: terrain, paving, meadow (grass and wildflowers), trees and undergrowth. */
export class SkyGroundLane{
 readonly ground=skyGround();
 readonly paving=skyPaving(SKY_PATHS);
 readonly meadow=skyMeadow(this.ground.soil,this.ground.aux);
 /** Resolves once the kit forest is in the scene. */
 readonly forest:Promise<THREE.Group|null>;
 constructor(root:THREE.Object3D){
  this.ground.noise.anisotropy=8;
  root.add(this.ground.mesh,this.paving,this.meadow.root);
  root.userData.skyPaving=this.paving.userData.stats;
  this.forest=skyForest().then(g=>{root.add(g);root.userData.skyForest=g.userData.stats;return g;}).catch(e=>{console.warn('skybloom forest failed to load',e);return null;});
 }
 update(time:number,quality:'high'|'low',player:THREE.Vector3|null){
  SKY_DETAIL.value=quality==='low'?0:1;WORLD_UNIFORMS.uTime.value=time;
  this.meadow.setQuality(quality);this.meadow.update(time,player??FAR);
 }
}
