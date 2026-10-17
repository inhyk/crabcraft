import * as THREE from 'three';
import type {Game} from './game';
import {islandDistance} from '../world/voyage';
import {t} from '../i18n';
/** Dressing shares the real terrain heightfield: beach, water foam and collision agree. */
export class VoyageIsland {
 readonly root=new THREE.Group();readonly chest=new THREE.Vector3();private lid=new THREE.Group();
 private resources:(THREE.BufferGeometry|THREE.Material)[]=[];
 constructor(private g:Game){
  this.root.name='Coralwind Isle';
  const mat=(color:string,glow=0)=>{const m=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:glow,roughness:.8});this.resources.push(m);return m;};
  const sand=mat('#c3ad84'),stone=mat('#718f91'),wood=mat('#805238'),leaf=mat('#367f65'),gold=mat('#e9bd69'),teal=mat('#6ff9db',.9),cloth=mat('#278e9c');
  const box=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,10,7),cone=new THREE.ConeGeometry(1,1,7),cyl=new THREE.CylinderGeometry(1,1,1,10);this.resources.push(box,sphere,cone,cyl);
  const mesh=(geo:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=o.receiveShadow=true;parent.add(o);return o;};
  const prop=(x:number,z:number)=>{const p=new THREE.Group();p.position.set(x,g.world.heightAt(x,z),z);this.root.add(p);return p;};
  for(const [dx,dz,rot] of [[-6,-9,.3],[9,-7,-.2],[11,5,.5],[-7,8,-.4],[2,11,.1]] as number[][]){const p=prop(230+dx,-22+dz);p.rotation.y=rot;const trunk=mesh(cyl,wood,p,0,2.6,0,.24,5.2,.24);trunk.rotation.z=.12;for(let i=0;i<7;i++){const frond=mesh(sphere,leaf,p,Math.cos(i*.9)*1.35,5.1,Math.sin(i*.9)*1.35,2.2,.16,.48);frond.rotation.y=-i*.9;frond.rotation.z=.22;}for(let i=0;i<3;i++)mesh(sphere,wood,p,i*.25-.25,4.9,.2,.22,.3,.22);}
  // A weathered shrine and glowing pearl stand above the landing beach.
  const shrine=prop(234,-24);for(const side of [-1,1]){mesh(box,stone,shrine,side*2,1.5,0,.8,3,.8);mesh(box,sand,shrine,side*2,.2,0,1.2,.4,1.2);}mesh(box,stone,shrine,0,3.2,0,5,.65,1);mesh(sphere,teal,shrine,0,1.6,0,.6,.6,.6);
  for(let i=0;i<10;i++){const a=i*2.399,x=230+Math.cos(a)*(12+i%3),z=-22+Math.sin(a)*(9+i%3);const p=prop(x,z);const r=mesh(sphere,i%2?stone:sand,p,0,.35,0,.6+i%3*.3,.45,.7);r.rotation.y=a;}
  const camp=prop(227,-17);mesh(box,wood,camp,0,.3,0,2.6,.3,.7);for(const x of [-1,1])mesh(box,wood,camp,x,.1,0,.25,.5,.5);
  const flag=prop(240,-20);mesh(cyl,wood,flag,0,2.8,0,.1,5.6,.1);mesh(box,cloth,flag,.9,4.7,0,1.8,1.1,.06);mesh(sphere,gold,flag,0,5.7,0,.18,.18,.18);
  const treasure=prop(229,-24);this.chest.copy(treasure.position);mesh(box,wood,treasure,0,.5,0,1.7,.8,1.1);for(const x of [-.6,.6])mesh(box,gold,treasure,x,.55,0,.13,.9,1.15);this.lid.position.set(0,.95,-.55);treasure.add(this.lid);mesh(box,wood,this.lid,0,.04,.55,1.8,.22,1.2);mesh(box,gold,treasure,0,.7,.59,.25,.28,.08);
  for(let i=0;i<12;i++){const x=216+i*.8,z=-22+Math.sin(i*.5)*.6,y=g.world.heightAt(x,z);if(y>.3)mesh(sphere,sand,this.root,x,y+.025,z,.12,.03,.17);}
  g.world.root.add(this.root);
 }
 nearby(){const g=this.g;return g.world2.chapter===1&&!g.boats?.seated&&g.player.unit.pos.distanceTo(this.chest)<3;}
 interact(){if(!this.nearby()||this.g.controlsLocked)return;const a=this.g.achievements;if(!a||a.has('treasure')){this.g.hud.messages.info(t('보물은 이미 챙겼어요. 섬의 추억은 남아 있어요!','You already found this treasure. The memory is yours!'));return;}a.unlock('treasure');this.g.player.coins=Math.min(Number.MAX_SAFE_INTEGER,this.g.player.coins+75);this.g.journey?.save();this.g.audio.sfx('sfx-quest-complete');}
 update(){this.root.visible=this.g.world2.chapter===1;this.lid.rotation.x=this.g.achievements?.has('treasure')?-1.2:0;}
 get onIsland(){return this.g.world2.chapter===1&&islandDistance(this.g.player.unit.pos.x,this.g.player.unit.pos.z)>.25;}
 dispose(){this.root.removeFromParent();for(const r of this.resources)r.dispose();}
}
