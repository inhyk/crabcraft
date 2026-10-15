import * as THREE from 'three';
import type { Collision } from '../world/collision';

/** Small animated details give the settlement a shared rhythm without simulating extra actors. */
export class StarVillageLife {
  readonly root=new THREE.Group();
  private water:THREE.Mesh;
  private star:THREE.Mesh;
  private flags:THREE.ShaderMaterial;
  private motes:THREE.Points;
  private waves:THREE.Mesh[]=[];
  constructor(height:(x:number,z:number)=>number,collision:Collision){
    this.root.name='starhaven-life';
    const stone=new THREE.MeshStandardMaterial({color:'#b4ad9f',roughness:.8});
    const gold=new THREE.MeshStandardMaterial({color:'#d9ba77',metalness:.65,roughness:.35});
    const glow=new THREE.MeshStandardMaterial({color:'#e9d3ff',emissive:'#a777d2',emissiveIntensity:1.7,roughness:.25,metalness:.4});
    const basin=new THREE.Mesh(new THREE.CylinderGeometry(3.4,3.7,.5,48),stone);basin.position.set(0,3.25,55);basin.receiveShadow=true;basin.castShadow=true;this.root.add(basin);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(3.25,.2,8,64),gold);rim.rotation.x=Math.PI/2;rim.position.set(0,3.62,55);this.root.add(rim);
    this.water=new THREE.Mesh(new THREE.CircleGeometry(3.08,48),new THREE.MeshPhysicalMaterial({color:'#358da5',emissive:'#1e546b',emissiveIntensity:.3,metalness:.3,roughness:.12,transparent:true,opacity:.85}));this.water.rotation.x=-Math.PI/2;this.water.position.set(0,3.56,55);this.root.add(this.water);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(.5,.9,1.8,8),stone);plinth.position.set(0,4.4,55);plinth.castShadow=true;this.root.add(plinth);
    this.star=new THREE.Mesh(new THREE.OctahedronGeometry(.7),glow);this.star.position.set(0,6,55);this.root.add(this.star);
    collision.addCircle(0,55,3.6,2.5,5.5);
    for(let i=0;i<3;i++){const wave=new THREE.Mesh(new THREE.TorusGeometry(1,.014,4,48),new THREE.MeshBasicMaterial({color:'#a8f5ee',transparent:true,opacity:.35,depthWrite:false}));wave.rotation.x=Math.PI/2;wave.position.set(0,3.59,55);this.waves.push(wave);this.root.add(wave);}
    this.flags=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.y*2.+time*1.8+modelMatrix[3].x)*.16*(1.-uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;void main(){float trim=step(v.x,.08)+step(.92,v.x)+step(v.y,.06);float star=step(abs(v.x-.5)+abs(v.y-.54)*.75,.16);gl_FragColor=vec4(mix(vec3(.19,.1,.31),vec3(.8,.63,.31),clamp(trim+star,0.,1.)),1.);}' });
    const cloth=new THREE.PlaneGeometry(1.3,2.6,5,10);
    for(const [x,z] of [[-9,23],[9,23],[-9,77],[9,77]]){const y=height(x,z);const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.07,4.8,6),gold);pole.position.set(x,y+2.4,z);this.root.add(pole);const flag=new THREE.Mesh(cloth,this.flags);flag.position.set(x+.7,y+3.2,z);this.root.add(flag);}
    // Glowing pollen, not a weather filter: stays close to gardens and leaves combat circles clear.
    const positions=new Float32Array(140*3);for(let i=0;i<140;i++){const a=i*2.39996,r=8+(i*17%35);positions.set([Math.cos(a)*r,3+(i*13%40)/10,55+Math.sin(a)*r],i*3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.motes=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#d5efb8',size:.065,transparent:true,opacity:.65,depthWrite:false}));this.root.add(this.motes);
    const ruinstone=new THREE.MeshStandardMaterial({color:'#7c7c8e',roughness:.87,metalness:.12});
    const pillars=new THREE.InstancedMesh(new THREE.CylinderGeometry(.7,.9,5,7),ruinstone,10);
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2,x=80+Math.cos(a)*9,z=-40+Math.sin(a)*9;const y=height(x,z);pillars.setMatrixAt(i,new THREE.Matrix4().makeTranslation(x,y+2.5,z));collision.addCircle(x,z,.9,y,y+5);}
    pillars.castShadow=true;this.root.add(pillars);
    const rubble=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.7,0),ruinstone,64),m=new THREE.Matrix4(),q=new THREE.Quaternion();
    for(let i=0;i<64;i++){const a=i*2.39996,r=10+(i*11%80)/10,x=80+Math.cos(a)*r,z=-40+Math.sin(a)*r;q.setFromEuler(new THREE.Euler(i*.3,i,.4));m.compose(new THREE.Vector3(x,height(x,z)+.3,z),q,new THREE.Vector3(.5+i%3*.2,.4+i%2*.2,.7));rubble.setMatrixAt(i,m);}rubble.castShadow=true;this.root.add(rubble);
    const well=new THREE.Mesh(new THREE.TorusGeometry(3,.35,6,48),ruinstone);well.rotation.x=Math.PI/2;well.position.set(80,height(80,-40)+.2,-40);this.root.add(well);
    const pool=new THREE.Mesh(new THREE.CircleGeometry(2.75,48),new THREE.MeshStandardMaterial({color:'#544f9d',emissive:'#51499a',emissiveIntensity:.7,roughness:.25,metalness:.5}));pool.rotation.x=-Math.PI/2;pool.position.set(80,height(80,-40)+.1,-40);this.root.add(pool);
  }
  update(time:number){
    this.flags.uniforms.time.value=time;this.star.rotation.y=time*.35;this.star.position.y=6+Math.sin(time*1.4)*.12;
    this.water.rotation.z=Math.sin(time*.1)*.03;this.motes.position.y=Math.sin(time*.35)*.3;
    this.waves.forEach((wave,i)=>{const p=(time*.25+i/3)%1;wave.scale.setScalar(.5+p*2.4);(wave.material as THREE.MeshBasicMaterial).opacity=(1-p)*.35;});
  }
}
