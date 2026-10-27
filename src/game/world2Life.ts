import * as THREE from 'three';
import {StarFountain} from './starFountain';
import {registerStarLandmarks,StarLandmarks} from './starLandmarks';
import {registerStarObservatory,StarObservatory} from './starObservatory';
import {StarMoths} from './starMoths';
import {registerStarSigns,StarVillageSigns} from './starVillageSigns';
import type { Collision } from '../world/collision';

/** Signs, landmarks, the star fountain's basin and the observatory, in the order they were built. */
export function registerStarVillageLife(height:(x:number,z:number)=>number,collision:Collision){
  registerStarSigns(height,collision);
  registerStarLandmarks(height,collision);
  collision.addCircle(0,55,3.6,2.5,5.5);
  registerStarObservatory(height,collision);
}

/** Small animated details give the settlement a shared rhythm without simulating extra actors. */
export class StarVillageLife {
  readonly root=new THREE.Group();
  private flags:THREE.ShaderMaterial;
  private motes:THREE.Points;
  private landmarks:StarLandmarks;
  private observatory:StarObservatory;
  private waves:THREE.Mesh[]=[];
  private moths:StarMoths;
  private signs:StarVillageSigns;
  constructor(height:(x:number,z:number)=>number){
    this.root.name='starhaven-life';
    this.signs=new StarVillageSigns(height);this.root.add(this.signs.root);
    this.moths=new StarMoths(height);this.root.add(this.moths.root);
    this.landmarks=new StarLandmarks(height);this.root.add(this.landmarks.root);
    // The square's fountain in moonstone with its crystal held in a silver cradle (starFountain.ts).
    const fountain=new StarFountain(0,55,height(0,55));this.root.add(fountain.root);
    const iron=new THREE.MeshStandardMaterial({color:'#2a2c38',metalness:.85,roughness:.38});
    for(let i=0;i<3;i++){const wave=new THREE.Mesh(new THREE.TorusGeometry(1,.014,4,48),new THREE.MeshBasicMaterial({color:'#a8f5ee',transparent:true,opacity:.35,depthWrite:false}));wave.rotation.x=Math.PI/2;wave.position.set(0,height(0,55)+.52,55);this.waves.push(wave);this.root.add(wave);}
    this.flags=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.y*2.+time*1.8+modelMatrix[3].x)*.16*(1.-uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;void main(){float trim=step(v.x,.08)+step(.92,v.x)+step(v.y,.06);float star=step(abs(v.x-.5)+abs(v.y-.54)*.75,.16);gl_FragColor=vec4(mix(vec3(.19,.1,.31),vec3(.66,.7,.82),clamp(trim+star,0.,1.)),1.);}' });
    const cloth=new THREE.PlaneGeometry(1.3,2.6,5,10);
    for(const [x,z] of [[-9,23],[9,23],[-9,77],[9,77]]){const y=height(x,z);const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.07,4.8,8),iron);pole.position.set(x,y+2.4,z);this.root.add(pole);const flag=new THREE.Mesh(cloth,this.flags);flag.position.set(x+.7,y+3.2,z);this.root.add(flag);}
    // Glowing pollen, not a weather filter: stays close to gardens and leaves combat circles clear.
    const positions=new Float32Array(140*3);for(let i=0;i<140;i++){const a=i*2.39996,r=8+(i*17%35);positions.set([Math.cos(a)*r,3+(i*13%40)/10,55+Math.sin(a)*r],i*3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.motes=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#d5efb8',size:.065,transparent:true,opacity:.65,depthWrite:false}));this.root.add(this.motes);
    this.observatory=new StarObservatory(height);this.root.add(this.observatory.root);
  }
  update(time:number){
    this.landmarks.update(time);this.observatory.update(time);this.moths.update(time);this.signs.update(time);
    this.flags.uniforms.time.value=time;
    this.motes.position.y=Math.sin(time*.35)*.3;
    this.waves.forEach((wave,i)=>{const p=(time*.25+i/3)%1;wave.scale.setScalar(.5+p*2.4);(wave.material as THREE.MeshBasicMaterial).opacity=(1-p)*.35;});
  }
}
