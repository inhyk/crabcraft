import * as THREE from 'three';

const COUNT=24;
const Y_AXIS=new THREE.Vector3(0,1,0),Z_AXIS=new THREE.Vector3(0,0,1);

/** Small crystal moths stay inside two clear landmark rings, away from roads and combat. */
export class StarMoths {
  readonly root=new THREE.Group();
  readonly wings:readonly [THREE.InstancedMesh,THREE.InstancedMesh];
  readonly bodies:THREE.InstancedMesh;
  private readonly matrix=new THREE.Matrix4();
  private readonly position=new THREE.Vector3();
  private readonly scale=new THREE.Vector3();
  private readonly yaw=new THREE.Quaternion();
  private readonly flap=new THREE.Quaternion();
  private readonly rotation=new THREE.Quaternion();

  constructor(private readonly height:(x:number,z:number)=>number){
    this.root.name='star-island-moths';
    const shape=new THREE.Shape();
    shape.moveTo(0,-.09);shape.lineTo(.3,-.24);shape.lineTo(.5,-.16);shape.lineTo(.55,.02);
    shape.lineTo(.29,.12);shape.lineTo(.4,.28);shape.lineTo(.24,.34);shape.lineTo(.06,.17);shape.lineTo(0,.12);shape.closePath();
    const left=new THREE.ShapeGeometry(shape);left.rotateX(Math.PI/2);
    const colors=new Float32Array(left.attributes.position.count*3),color=new THREE.Color();
    for(let i=0;i<left.attributes.position.count;i++){
      const x=left.attributes.position.getX(i),z=left.attributes.position.getZ(i);
      color.set(x<.1?'#334b68':z<.05?'#b7e8ff':'#8f9aca');color.toArray(colors,i*3);
    }
    left.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const right=left.clone();right.scale(-1,1,1);
    const wingMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,side:THREE.DoubleSide,roughness:.6,metalness:.15,emissive:'#547eaa',emissiveIntensity:.22});
    const bodyMaterial=new THREE.MeshStandardMaterial({color:'#fff0c1',emissive:'#c19c53',emissiveIntensity:.3,roughness:.7});
    this.wings=[new THREE.InstancedMesh(left,wingMaterial,COUNT),new THREE.InstancedMesh(right,wingMaterial,COUNT)];
    const body=new THREE.CylinderGeometry(.035,.025,.24,5);body.rotateX(Math.PI/2);
    this.bodies=new THREE.InstancedMesh(body,bodyMaterial,COUNT);
    const palette=['#8cf0df','#bca9ff','#b7eaff','#ffd69a','#f5b7bf','#e9d59f'];
    for(let i=0;i<COUNT;i++)for(const wing of this.wings)wing.setColorAt(i,new THREE.Color(palette[(i<12?0:3)+i%3]));
    for(const [i,mesh] of [...this.wings,this.bodies].entries()){
      mesh.name=['star-moth-left-wings','star-moth-right-wings','star-moth-bodies'][i];
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.root.add(mesh);
    }
    // Motion spans two small patches. Set conservative bounds once, not from just the first pose.
    const bounds=new THREE.Box3();
    for(const [cx,cz,r] of [[-75,-35,5.5],[80,-40,7.2]])for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++)for(let z=Math.floor(cz-r);z<=Math.ceil(cz+r);z++){
      const y=height(x,z);bounds.expandByPoint(new THREE.Vector3(x,y-.5,z));bounds.expandByPoint(new THREE.Vector3(x,y+3.4,z));
    }
    for(const mesh of [...this.wings,this.bodies]){mesh.boundingBox=bounds.clone();mesh.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());}
    this.update(0);
  }

  update(time:number):void {
    for(let i=0;i<COUNT;i++){
      const west=i<12,k=i%12,phase=i*2.399963,r=(west?3:4.8)+(k%5)*.34;
      const speed=.13+(k%4)*.025,a=phase+time*speed;
      const x=(west?-75:80)+Math.cos(a)*r,z=(west?-35:-40)+Math.sin(a)*r;
      const lift=(west?1.5:1)+Math.sin(time*.8+phase)*.22+(k%3)*.2;
      this.position.set(x,this.height(x,z)+lift,z);
      this.yaw.setFromAxisAngle(Y_AXIS,-a);
      const size=.48+(k%4)*.05;this.scale.setScalar(size);
      this.matrix.compose(this.position,this.yaw,this.scale);this.bodies.setMatrixAt(i,this.matrix);
      const angle=.16+Math.sin(time*(7.5+k%3)+phase)*.7;
      for(let side=0;side<2;side++){
        this.flap.setFromAxisAngle(Z_AXIS,side?-angle:angle);this.rotation.copy(this.yaw).multiply(this.flap);
        this.matrix.compose(this.position,this.rotation,this.scale);this.wings[side].setMatrixAt(i,this.matrix);
      }
    }
    this.wings[0].instanceMatrix.needsUpdate=true;
    this.wings[1].instanceMatrix.needsUpdate=true;
    this.bodies.instanceMatrix.needsUpdate=true;
  }
}
