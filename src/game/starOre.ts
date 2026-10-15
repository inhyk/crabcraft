import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {facetedStarCrystal} from './starCrystal';

/** Four mineral nests reuse a faceted pickup cluster and a low, bronze-inlaid stone bed. */
export class StarOreKit {
  private readonly core:THREE.BufferGeometry;
  private readonly bed:THREE.BufferGeometry;
  private readonly inlay:THREE.BufferGeometry;
  private readonly stone=new THREE.MeshStandardMaterial({color:'#555769',roughness:.8,metalness:.12});
  private readonly bronze=new THREE.MeshStandardMaterial({color:'#ac9261',roughness:.45,metalness:.72});
  constructor(){
    const merge=(parts:THREE.BufferGeometry[])=>{
      const triangles=parts.map(g=>g.index?g.toNonIndexed():g),result=mergeGeometries(triangles)!;
      for(const g of new Set([...parts,...triangles]))g.dispose();
      result.computeBoundingBox();result.computeBoundingSphere();return result;
    };
    const crystal=facetedStarCrystal(),spires=[crystal.clone().scale(.45,.75,.45)];
    for(let i=0;i<3;i++){
      const a=i*Math.PI*2/3;
      spires.push(crystal.clone().scale(.22,.43,.22).rotateZ(-.28).rotateY(-a).translate(Math.cos(a)*.48,-.32,Math.sin(a)*.48));
    }
    this.core=merge(spires);this.core.name='star-quest-ore-cluster';crystal.dispose();
    const stones:THREE.BufferGeometry[]=[new THREE.CylinderGeometry(.88,.98,.12,9).translate(0,.06,0)];
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7;
      stones.push(new THREE.IcosahedronGeometry(.26).scale(1,.65,.85).rotateY(a).translate(Math.cos(a)*.77,.2,Math.sin(a)*.77));
    }
    this.bed=merge(stones);this.bed.name='star-ore-stone-bed';
    const lines:THREE.BufferGeometry[]=[new THREE.TorusGeometry(.62,.018,4,48).rotateX(-Math.PI/2).translate(0,.127,0)];
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      lines.push(new THREE.BoxGeometry(.055,.014,.16).rotateY(a).translate(Math.sin(a)*.45,.131,Math.cos(a)*.45));
    }
    this.inlay=merge(lines);this.inlay.name='star-ore-bronze-inlay';
  }
  create(position:THREE.Vector3,material:THREE.MeshStandardMaterial){
    const root=new THREE.Group();root.name='star-ore-bed';root.position.copy(position);
    const bed=new THREE.Mesh(this.bed,this.stone),inlay=new THREE.Mesh(this.inlay,this.bronze);
    bed.castShadow=bed.receiveShadow=true;root.add(bed,inlay);
    material.vertexColors=true;material.flatShading=true;
    material.color.set('#9ce9e4');material.emissive.set('#1d8479');material.emissiveIntensity=.75;
    const core=new THREE.Mesh(this.core,material);core.name='star-quest-ore';
    return {root,core};
  }
}
