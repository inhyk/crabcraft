import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** A small armillary seal identifies island memories without adding scene lights. */
export class StarMemorySealKit {
  private geometry:THREE.BufferGeometry;
  private material=new THREE.MeshStandardMaterial({color:'#ceb880',metalness:.72,roughness:.36,emissive:'#392416',emissiveIntensity:.2});
  constructor(){
    const pieces:THREE.BufferGeometry[]=[
      new THREE.TorusGeometry(.91,.035,5,48),
      new THREE.TorusGeometry(.65,.025,5,40).rotateX(.65),
    ];
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      pieces.push(new THREE.ConeGeometry(.13,.3,4).rotateZ(-a).translate(Math.sin(a)*1.01,Math.cos(a)*1.01,0));
      pieces.push(new THREE.CylinderGeometry(.018,.018,.22,4).rotateZ(-a).translate(Math.sin(a)*.79,Math.cos(a)*.79,0));
    }
    const triangles=pieces.map(g=>g.index?g.toNonIndexed():g);
    this.geometry=mergeGeometries(triangles)!;this.geometry.name='star-memory-seal';
    for(const g of new Set([...pieces,...triangles]))g.dispose();
    this.geometry.computeBoundingSphere();
  }
  create(){
    const frame=new THREE.Mesh(this.geometry,this.material);frame.name='star-memory-seal-frame';
    return frame;
  }
}
