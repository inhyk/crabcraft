import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Enemy,EnemyKind} from './enemies';
import {facetedStarCrystal} from './starCrystal';

type ArmourGroup={kind:EnemyKind;enemies:Enemy[];armour:THREE.InstancedMesh;core:THREE.InstancedMesh};
/** Island-only equipment follows each animated head socket in four shared draw calls. */
export class StarEnemyArmour {
  readonly root=new THREE.Group();
  readonly groups:ArmourGroup[]=[];
  private matrix=new THREE.Matrix4();
  private scale=new THREE.Vector3();
  constructor(enemies:readonly Enemy[]){
    this.root.name='star-enemy-armour';
    for(const kind of ['scrapling','scavenger'] as const){
      const members=enemies.filter(e=>e.kind===kind&&!e.isAdd);if(!members.length)continue;
      const small=kind==='scrapling';
      const plate=small?new THREE.IcosahedronGeometry(.44,0).scale(1,.27,.84):new THREE.CylinderGeometry(.43,.49,.12,10);
      const armourGeometry=this.merge([plate.translate(0,.035,0)],`star-${kind}-plate`);
      const shards:THREE.BufferGeometry[]=[];
      if(small){
        shards.push(facetedStarCrystal().scale(.105,.19,.105).translate(0,.23,-.06));
        for(const side of [-1,1])shards.push(facetedStarCrystal().scale(.075,.14,.075).rotateZ(-side*.3).translate(side*.21,.18,-.08));
      }else{
        shards.push(facetedStarCrystal().scale(.135,.16,.135).translate(0,.23,0));
        shards.push(new THREE.TorusGeometry(.29,.018,4,32).rotateX(Math.PI/2).translate(0,.17,0));
        for(let i=0;i<6;i++){const a=i*Math.PI/3;shards.push(new THREE.OctahedronGeometry(.045).translate(Math.sin(a)*.29,.17,Math.cos(a)*.29));}
      }
      const coreGeometry=this.merge(shards,`star-${kind}-crystals`);
      const armourMaterial=new THREE.MeshStandardMaterial({color:small?'#343858':'#9e8058',metalness:.65,roughness:.38,flatShading:true});
      const coreMaterial=new THREE.MeshStandardMaterial({color:small?'#8debdc':'#bca0ff',emissive:small?'#207d73':'#6741a6',emissiveIntensity:1.6,metalness:.35,roughness:.24,vertexColors:true});
      const armour=new THREE.InstancedMesh(armourGeometry,armourMaterial,members.length),core=new THREE.InstancedMesh(coreGeometry,coreMaterial,members.length);
      for(const mesh of [armour,core]){mesh.name=`star-${kind}-${mesh===armour?'armour':'cores'}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.receiveShadow=true;this.root.add(mesh);}
      this.groups.push({kind,enemies:members,armour,core});
    }
  }
  private merge(parts:THREE.BufferGeometry[],name:string){
    const triangles=parts.map(g=>{const result=g.index?g.toNonIndexed():g;result.deleteAttribute('uv');if(!result.hasAttribute('color'))result.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(result.attributes.position.count*3).fill(1),3));return result;});
    const result=mergeGeometries(triangles)!;result.name=name;result.computeBoundingSphere();
    for(const g of new Set([...parts,...triangles]))g.dispose();return result;
  }
  update(time:number){
    for(const group of this.groups){
      for(const [i,enemy] of group.enemies.entries()){
        const u=enemy.unit;
        if(u.hidden||u.culled)this.matrix.makeScale(0,0,0);
        else{const socket=u.rig.getSocket('head');socket.updateWorldMatrix(true,false);this.matrix.copy(socket.matrixWorld).scale(this.scale.setScalar(u.height/u.rig.metersToUnits));}
        group.armour.setMatrixAt(i,this.matrix);group.core.setMatrixAt(i,this.matrix);
      }
      group.armour.instanceMatrix.needsUpdate=group.core.instanceMatrix.needsUpdate=true;
      (group.core.material as THREE.MeshStandardMaterial).emissiveIntensity=1.6+Math.sin(time*1.3)*.12;
    }
  }
}
