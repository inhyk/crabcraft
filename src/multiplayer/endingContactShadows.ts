import * as THREE from 'three';
import { radialSprite } from '../screens/create/textures';

/** Same soft contact treatment as CreateStage, owned entirely by this private display. */
export class EndingContactShadows {
 readonly root=new THREE.Group();
 private readonly texture=radialSprite(128,0,[[0,1],[.35,.7],[.7,.2],[1,0]]);
 private readonly geometry=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
 private readonly meshes=new Map<number,THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>>();
 constructor(){this.root.name='ending-contact-shadows';}
 set(slot:number,x:number,y:number,z:number,width:number,depth:number,opacity:number):void {
  let mesh=this.meshes.get(slot);
  if(!mesh){const material=new THREE.MeshBasicMaterial({color:0x000000,alphaMap:this.texture,transparent:true,opacity,depthWrite:false});mesh=new THREE.Mesh(this.geometry,material);mesh.renderOrder=1;this.meshes.set(slot,mesh);this.root.add(mesh);}
  mesh.position.set(x,y,z);mesh.scale.set(width,1,depth);mesh.material.opacity=opacity;
 }
 retain(slots:ReadonlySet<number>):void {for(const [slot,mesh]of this.meshes)if(!slots.has(slot)){mesh.removeFromParent();mesh.material.dispose();this.meshes.delete(slot);}}
 dispose():void {this.retain(new Set());this.geometry.dispose();this.texture.dispose();this.root.clear();}
}
