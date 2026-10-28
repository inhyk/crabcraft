import * as THREE from 'three';

/** Keep the existing 2048px moonlight shadow around the traveler, snapped in light space. */
export class StarSun {
  readonly light=new THREE.DirectionalLight('#d6b9ff',1.8);
  private readonly offset:THREE.Vector3;
  private readonly right:THREE.Vector3;
  private readonly up:THREE.Vector3;
  private readonly texel=150/2048;
  private readonly determinant:number;
  /** `offset`: from the followed point toward the light; World III keeps the original. */
  constructor(offset=new THREE.Vector3(-40,90,20)){
    this.offset=offset.clone();
    this.right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),this.offset).normalize();
    this.up=new THREE.Vector3().crossVectors(this.offset,this.right).normalize();
    this.determinant=this.right.x*this.up.z-this.right.z*this.up.x;
    const key=this.light;key.name='star-island-sun';key.position.copy(this.offset);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);
    Object.assign(key.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:180});
    key.shadow.camera.updateProjectionMatrix();key.shadow.normalBias=.04;
  }
  update(x:number,z:number){
    // Snap both projected coordinates, rather than world X/Z, to avoid sliding shadow texels.
    const r=Math.round((this.right.x*x+this.right.z*z)/this.texel)*this.texel;
    const u=Math.round((this.up.x*x+this.up.z*z)/this.texel)*this.texel;
    const sx=(r*this.up.z-this.right.z*u)/this.determinant;
    const sz=(this.right.x*u-r*this.up.x)/this.determinant;
    this.light.target.position.set(sx,0,sz);
    this.light.position.set(sx+this.offset.x,this.offset.y,sz+this.offset.z);
  }
}
