import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Three small trail lanterns share their carved stone/metal geometry, without extra lights. */
export class StarWaystoneKit {
  private stone:THREE.BufferGeometry;
  private frame:THREE.BufferGeometry;
  private core=new THREE.OctahedronGeometry(.56);
  private ring=new THREE.TorusGeometry(.92,.025,5,48).rotateX(-Math.PI/2);
  private stoneMat=new THREE.MeshStandardMaterial({color:'#4b4762',roughness:.78,metalness:.18});
  private frameMat=new THREE.MeshStandardMaterial({color:'#c3a168',roughness:.39,metalness:.74});
  constructor(){
    const merge=(parts:THREE.BufferGeometry[])=>{
      const triangles=parts.map(part=>part.index?part.toNonIndexed():part);
      const result=mergeGeometries(triangles)!;
      for(const geometry of new Set([...parts,...triangles]))geometry.dispose();
      return result;
    };
    this.stone=merge([
      new THREE.CylinderGeometry(.88,.99,.18,8).translate(0,.09,0),
      new THREE.CylinderGeometry(.64,.79,.28,8).translate(0,.32,0),
      new THREE.CylinderGeometry(.52,.6,.31,8).translate(0,.61,0),
    ]);
    const metal=[
      new THREE.CylinderGeometry(.7,.7,.1,8).translate(0,.8,0),
      new THREE.CylinderGeometry(.72,.72,.1,8).translate(0,2.12,0),
      new THREE.ConeGeometry(.85,.45,8).translate(0,2.39,0),
      new THREE.ConeGeometry(.37,.4,8).translate(0,2.7,0),
      new THREE.OctahedronGeometry(.13).translate(0,2.98,0),
    ];
    for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;metal.push(new THREE.CylinderGeometry(.045,.065,1.28,5).translate(Math.sin(a)*.6,1.46,Math.cos(a)*.6));}
    this.frame=merge(metal);
  }
  create(position:THREE.Vector3,material:THREE.MeshStandardMaterial){
    const root=new THREE.Group();root.name='star-quest-waystone';root.position.copy(position);
    const base=new THREE.Mesh(this.stone,this.stoneMat),frame=new THREE.Mesh(this.frame,this.frameMat);
    base.castShadow=frame.castShadow=true;base.receiveShadow=true;
    const core=new THREE.Mesh(this.core,material);core.position.y=1.46;core.scale.y=1.65;
    const haloMat=new THREE.MeshBasicMaterial({color:'#ffd991',transparent:true,opacity:.08,depthWrite:false,blending:THREE.AdditiveBlending});
    const halo=new THREE.Mesh(this.ring,haloMat);halo.position.y=.19;
    root.add(base,frame,core,halo);
    return {root,core,halo};
  }
}
