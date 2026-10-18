import * as THREE from 'three';
import type {Game} from './game';
import {DAWN_POINTS} from './dawnQuests';
import {QUESTS,type ObjectiveDef,type ObjectiveKind} from './quests';

/** Personal quest props never consume another player's items or shared lighthouse state. */
export class DawnRequests {
 readonly root=new THREE.Group();
 readonly nodes:{kind:ObjectiveKind;objective:ObjectiveDef;position:THREE.Vector3;mesh:THREE.Mesh;lamp:boolean}[]=[];
 constructor(private g:Game,private island:{root:THREE.Group;collision:{resolve(x:number,z:number,r:number,out:THREE.Vector2):THREE.Vector2};height(x:number,z:number):number},private points:Partial<Record<ObjectiveKind,readonly[number,number]>>=DAWN_POINTS){this.root.name='Island village requests';island.root.add(this.root);}
 build(){
  const palette:Record<string,string>={crate:'#dca86c',herb:'#7de9a0',lamp:'#ffd77e',ore:'#ff935c',pearl:'#a6ecff',seal:'#d7bbff',visit:'#fff1bd'};
  const geometries:Record<string,THREE.BufferGeometry>={crate:new THREE.BoxGeometry(1.3,1.1,1.3),herb:new THREE.IcosahedronGeometry(.55,0),lamp:new THREE.OctahedronGeometry(.55),ore:new THREE.DodecahedronGeometry(.7,0),pearl:new THREE.SphereGeometry(.55,12,8),seal:new THREE.TorusGeometry(.6,.16,6,18),visit:new THREE.OctahedronGeometry(.55)};
  const support=new THREE.MeshStandardMaterial({color:'#4c514e',roughness:.85});
  for(const [key,point] of Object.entries(this.points)){
   const kind=key as ObjectiveKind,style=key.split('-')[1],objective=Object.values(QUESTS).flatMap(q=>q.objectives).find(o=>o.kind===kind)!;
   const resolved=this.island.collision.resolve(point[0],point[1],1,new THREE.Vector2());
   const position=new THREE.Vector3(resolved.x,this.island.height(resolved.x,resolved.y),resolved.y);
   const material=new THREE.MeshStandardMaterial({color:palette[style],emissive:palette[style],emissiveIntensity:.2,roughness:.45,metalness:.2});
   const mesh=new THREE.Mesh(geometries[style],material);mesh.position.copy(position).y+=style==='lamp'?2.2:1;mesh.castShadow=true;
   mesh.name=kind;this.root.add(mesh);
   const ring=new THREE.Mesh(new THREE.TorusGeometry(style==='visit'?2.3:.95,.045,4,32),new THREE.MeshBasicMaterial({color:palette[style],transparent:true,opacity:.5,depthWrite:false}));
   ring.rotation.x=-Math.PI/2;ring.position.copy(position).y+=.18;mesh.userData.ring=ring;this.root.add(ring);
   if(style==='lamp'){
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.12,.2,2.2,6),support);pole.position.copy(position).y+=1.1;this.root.add(pole);
   }else if(style==='herb'){
    for(let i=0;i<3;i++){const leaf=new THREE.Mesh(new THREE.ConeGeometry(.2,.8,5),material);leaf.position.set(Math.sin(i*2.1)*.4,-.55,Math.cos(i*2.1)*.4);leaf.rotation.z=.5;mesh.add(leaf);}
   }else if(style==='crate'){
    const band=new THREE.Mesh(new THREE.BoxGeometry(1.37,.16,1.37),support);mesh.add(band);
   }
   this.nodes.push({kind,objective,position,mesh,lamp:style==='lamp'});
  }
 }
 point(kind:ObjectiveKind){return this.nodes.find(n=>n.kind===kind)?.position??null;}
 private pending(n:typeof this.nodes[number]){
  return this.g.quests.active().some(id=>QUESTS[id].objectives.some(o=>o.kind===n.kind&&!this.g.quests.objectiveDone(o)));
 }
 interactable(){return this.nodes.find(n=>!n.kind.includes('-visit-')&&this.pending(n)&&this.g.player.unit.pos.distanceTo(n.position)<3.5)??null;}
 collect(kind:ObjectiveKind){
  const n=this.interactable();
  if(!n||n.kind!==kind)return false;
  this.g.quests.bump(kind);this.g.audio.sfx('sfx-quest-accept');this.g.vfx.mendGlow(this.g.player.unit);this.g.journey?.save();return true;
 }
 update(time:number,observed=false){
  for(const n of this.nodes){
   const active=this.pending(n),done=this.g.quests.objectiveDone(n.objective),ring=n.mesh.userData.ring as THREE.Mesh;
   if(!observed&&n.kind.includes('-visit-')&&active&&this.g.player.unit.pos.distanceTo(n.position)<4){this.g.quests.bump(n.kind);this.g.audio.sfx('sfx-quest-accept');this.g.journey?.save();}
   n.mesh.visible=n.lamp||active;ring.visible=active;
   const mat=n.mesh.material as THREE.MeshStandardMaterial;mat.emissiveIntensity=n.lamp&&done?1.5:active?.5+Math.sin(time*2)*.2:.05;
   if(!n.lamp){n.mesh.rotation.y=time*.4;n.mesh.position.y=n.position.y+1+Math.sin(time*2+n.position.x)*.12;}
  }
 }
}
