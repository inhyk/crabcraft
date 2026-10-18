import * as THREE from 'three';
import type {Game} from './game';
import {islandDistance,VOYAGE_ISLANDS} from '../world/voyage';
import type {AchievementId} from './achievements';
import {t} from '../i18n';
/** Dressing shares the real terrain heightfield: beach, water foam and collision agree. */
export class VoyageIsland {
 readonly root=new THREE.Group();readonly chest=new THREE.Vector3();private lid=new THREE.Group();
 private treasures:{id:AchievementId;position:THREE.Vector3;lid:THREE.Group;coins:number;ko:string;en:string}[]=[];
 private observed=false;
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
  this.treasures.push({id:'treasure',position:this.chest,lid:this.lid,coins:75,ko:'진주빛 보물',en:'Pearl treasure'});
  // Reuse a small geometry/material palette across both new islands.
  const violet=mat('#a88cf1',.35),ice=mat('#97e7ed',.45),amber=mat('#e6a05a'),dark=mat('#392e36');
  for(const site of VOYAGE_ISLANDS.slice(1)){
   const center=prop(site.x,site.z);
   if(site.id==='moon'){
    // Faceted crystal garden, fallen star and a ring of weathered moon stones.
    for(let i=0;i<9;i++){const a=i*2.399,r=4+i%3;const p=prop(site.x+Math.cos(a)*r,site.z+Math.sin(a)*r*.7);p.rotation.y=a;const crystal=mesh(cone,i%2?ice:violet,p,0,1+i%3*.4,0,.6,2+i%3*.8,.6);crystal.rotation.z=(i%3-1)*.18;mesh(sphere,stone,p,0,.15,0,.9,.3,.8);}
    const ringGeo=new THREE.TorusGeometry(2.1,.16,6,32);this.resources.push(ringGeo);mesh(ringGeo,violet,center,0,2.7,-1,1,1,1);
    for(let i=0;i<7;i++){const a=i*Math.PI*2/7;const p=prop(site.x+Math.cos(a)*3,site.z+Math.sin(a)*2.5);mesh(box,stone,p,0,.35,0,.5,.7,.6).rotation.y=a;}
    mesh(sphere,ice,center,0,.6,-1,.65,.65,.65);
   }else{
    // Broken ship ribs, tilted prow, torn sail, supply barrels and a camp.
    const wreck=prop(site.x+2,site.z-2);wreck.rotation.y=-.55;
    mesh(box,dark,wreck,0,.4,0,6,.5,3);
    for(const side of [-1,1])for(let i=0;i<6;i++){const rib=mesh(box,wood,wreck,-2.5+i,1.1,side*1.4,.2,1.8,.2);rib.rotation.x=side*.25;mesh(box,wood,wreck,0,.8,side*1.65,6.5,.3,.14);}
    mesh(cone,wood,wreck,3.4,.9,0,1.4,2,1.5).rotation.z=-Math.PI/2;
    const mast=mesh(cyl,wood,wreck,0,3.2,0,.13,6.4,.13);mast.rotation.z=-.2;
    const sailGeo=new THREE.BufferGeometry();sailGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.3,5.7,0,-.3,2.6,0,2.3,2.9,0,2.3,2.9,0,-.3,2.6,0,1,2.1,0],3));sailGeo.computeVertexNormals();this.resources.push(sailGeo);const sail=mat('#d7be8c');sail.side=THREE.DoubleSide;mesh(sailGeo,sail,wreck,0,0,0,1,1,1);
    for(let i=0;i<3;i++){const p=prop(site.x-5+i*.9,site.z-4);mesh(cyl,wood,p,0,.55,0,.45,1.1,.45);for(const y of [.25,.85])mesh(cyl,dark,p,0,y,0,.47,.08,.47);}
    const camp=prop(site.x-5,site.z+4);mesh(cone,amber,camp,0,.7,0,1.7,1.4,1.7);mesh(cone,dark,camp,0,.65,.7,.6,1.2,.6);
    for(let i=0;i<4;i++){const a=i*1.7,p=prop(site.x+Math.cos(a)*12,site.z+Math.sin(a)*9);mesh(sphere,amber,p,0,.3,0,1.2,.5,.8);}
   }
   const p=prop(site.x-2,site.z+2),lid=new THREE.Group();mesh(box,wood,p,0,.5,0,1.7,.8,1.1);for(const x of [-.6,.6])mesh(box,gold,p,x,.55,0,.13,.9,1.15);lid.position.set(0,.95,-.55);p.add(lid);mesh(box,site.id==='moon'?violet:wood,lid,0,.04,.55,1.8,.22,1.2);mesh(box,gold,p,0,.7,.59,.25,.28,.08);
   this.treasures.push({id:site.id==='moon'?'moonTreasure':'sunsetTreasure',position:p.position.clone(),lid,coins:site.id==='moon'?100:125,ko:site.id==='moon'?'달조각 보물':'선장의 보물',en:site.id==='moon'?'Moonshard treasure':'Captain’s treasure'});
  }
  g.world.root.add(this.root);
 }
 private get nearbyTreasure(){const g=this.g;if(g.world2.chapter!==1||g.boats?.seated)return undefined;return this.treasures.find(c=>g.player.unit.pos.distanceTo(c.position)<3);}
 nearby(){return !!this.nearbyTreasure;}
 get treasurePrompt(){const c=this.nearbyTreasure;if(!c)return '';return this.g.achievements?.has(c.id)?t('보물상자 살펴보기','Inspect treasure chest'):t(`${c.ko} 열기 · ${c.coins} 코인`,`Open ${c.en} · ${c.coins} coins`);}
 observe(earned:readonly string[],chapter:number):void {this.observed=true;this.root.visible=chapter===1;for(const c of this.treasures)c.lid.rotation.x=earned.includes(c.id)?-1.2:0;}
 get interactionId():string|null{return this.nearbyTreasure?.id??null;}
 interact(){if(this.observed)throw new Error('Server owns treasure interactions');const c=this.nearbyTreasure;if(!c||this.g.controlsLocked)return;const a=this.g.achievements;if(!a||a.has(c.id)){this.g.hud.messages.info(t('보물은 이미 챙겼어요. 섬의 추억은 남아 있어요!','You already found this treasure. The memory is yours!'));return;}a.unlock(c.id);this.g.player.coins=Math.min(Number.MAX_SAFE_INTEGER,this.g.player.coins+c.coins);this.g.journey?.save();this.g.audio.sfx('sfx-quest-complete');}
 update(){this.root.visible=this.g.world2.chapter===1;for(const c of this.treasures)c.lid.rotation.x=this.g.achievements?.has(c.id)?-1.2:0;}
 get currentIsland(){return this.g.world2.chapter===1?VOYAGE_ISLANDS.find(i=>islandDistance(this.g.player.unit.pos.x,this.g.player.unit.pos.z,i)>.25):undefined;}
 get onIsland(){return this.currentIsland?.id==='island';}
 dispose(){this.root.removeFromParent();for(const r of this.resources)r.dispose();}
}
