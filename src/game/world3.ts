import * as THREE from 'three';
import {StarPortal} from './portal';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {TownBuilder} from '../world/buildings';
import type {Lot} from '../world/layout';
import {Collision} from '../world/collision';
import type {Poi} from '../world/types';

/** The third island has its own warm coast, inhabited ring town and volcanic citadel. */
export class DawnIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,4,84);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,17,-72),yaw:0,radius:20};
 readonly collision=new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:(x,z)=>this.height(x,z)});
 readonly portal=new StarPortal(this.spawn,'새벽 항구 → 별빛 항구');
 readonly town:[number,number][]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]];
 private rotating:THREE.Object3D[]=[];
 private cage=new THREE.Group();
 height(x:number,z:number){
  const radial=Math.hypot(x/122,(z-3)/149);
  const shore=4-Math.max(0,radial-.83)*65;
  const upland=13*THREE.MathUtils.smoothstep(-z,5,55);
  const hills=(Math.sin(x*.045)*Math.sin(z*.04)*2)*(1-Math.exp(-x*x/400));
  return radial>.86?shore:4+upland+hills;
 }
 constructor(){
  this.root.name='WORLD III · Dawnreach';this.root.visible=false;
  const stone=new THREE.MeshStandardMaterial({color:'#393c4b',roughness:.9});
  const sand=new THREE.MeshStandardMaterial({color:'#cfad76',roughness:.95,vertexColors:true});
  const roof=new THREE.MeshStandardMaterial({color:'#267b82',roughness:.7});
  const gold=new THREE.MeshStandardMaterial({color:'#ffd67a',emissive:'#d57b23',emissiveIntensity:.65,metalness:.6,roughness:.35});
  const lava=new THREE.MeshStandardMaterial({color:'#ff763b',emissive:'#ff4612',emissiveIntensity:1.2});
  const land=new THREE.PlaneGeometry(300,350,120,140);land.rotateX(-Math.PI/2);const p=land.getAttribute('position'),col=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=this.height(x,z);p.setY(i,y);const c=new THREE.Color(y>12?'#625b65':y<3?'#a99777':Math.abs(x)>45?'#788a57':'#d4bb8e');col.push(c.r,c.g,c.b);}
  land.setAttribute('color',new THREE.Float32BufferAttribute(col,3));land.computeVertexNormals();const ground=new THREE.Mesh(land,sand);ground.receiveShadow=true;this.root.add(ground);
  const sky=new THREE.Mesh(new THREE.SphereGeometry(850,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;void main(){float h=clamp(normalize(v).y,0.,1.);gl_FragColor=vec4(mix(vec3(.96,.73,.48),vec3(.23,.48,.68),pow(h,.5)),1.);}'}));sky.renderOrder=-100;this.root.add(sky);
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:'#245e74',roughness:.3,metalness:.4,transparent:true,opacity:.94}));sea.rotation.x=-Math.PI/2;sea.position.y=.2;this.root.add(sea);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  // Ring town: a generous square, fountain, homes and people on both sides of the avenue.
  add(new THREE.CylinderGeometry(13,13,.15,48),stone,0,4.1,53);
  add(new THREE.CylinderGeometry(3.1,3.6,.8,32),stone,-11,4.6,53);
  add(new THREE.CylinderGeometry(2.9,2.9,.08,32),new THREE.MeshStandardMaterial({color:'#69cbd2',emissive:'#246771',emissiveIntensity:.4}),-11,5.05,53);
  add(new THREE.CylinderGeometry(.4,.7,3.2,12),gold,-11,6,53);add(new THREE.OctahedronGeometry(.9),gold,-11,8.2,53);
  this.collision.addCircle(-11,53,3.7,4,9);
  // A walkable, lit ascent to the fortress, built directly over the analytic surface.
  for(let i=0;i<72;i++){const z=83-i*2.12,y=this.height(0,z);const slab=add(new THREE.BoxGeometry(8,.18,2.2),stone,0,y+.02,z);slab.rotation.x=Math.atan2(this.height(0,z-1)-this.height(0,z+1),2);
   if(i%5===0)for(const side of [-1,1]){add(new THREE.CylinderGeometry(.14,.22,2.4,6),stone,side*5.1,y+1.2,z);add(new THREE.OctahedronGeometry(.42),gold,side*5.1,y+2.6,z);}
  }
  for(const side of [-1,1]){const tower=add(new THREE.CylinderGeometry(3.6,4.4,15,10),stone,side*27,this.height(side*27,-56)+7.5,-56);add(new THREE.ConeGeometry(4.6,6,10),roof,tower.position.x,tower.position.y+10.5,-56);this.collision.addCircle(side*27,-56,4.5,4,35);}
  add(new THREE.CylinderGeometry(21,22,.4,64),stone,0,16.85,-72);
  for(const r of [6,13,20]){const ring=add(new THREE.TorusGeometry(r,.07,5,96),gold,0,17.12,-72);ring.rotation.x=Math.PI/2;}
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,x=Math.sin(a)*67,z=-45+Math.cos(a)*50;if(Math.abs(x)<12)continue;const y=this.height(x,z),r=2+i%3;const rock=add(new THREE.DodecahedronGeometry(r,0),stone,x,y+r*.65,z);rock.scale.y=1.5;if(i%3===0){const core=add(new THREE.OctahedronGeometry(.8),lava,x,y+3,z);this.rotating.push(core);}this.collision.addCircle(x,z,r+1,y,y+7);}
  // Instanced coastal palms share geometry and materials.
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.4,6,6),stone,40),leaves=new THREE.InstancedMesh(new THREE.ConeGeometry(2.4,2,5),roof,40),matrix=new THREE.Matrix4();
  for(let i=0;i<40;i++){const a=i*2.39996,x=(Math.sin(a)<0?-1:1)*Math.max(16,Math.abs(Math.sin(a)*(55+i%5*5))),z=30+Math.cos(a)*55,y=this.height(x,z);matrix.makeTranslation(x,y+3,z);trunks.setMatrixAt(i,matrix);matrix.makeTranslation(x,y+6,z);leaves.setMatrixAt(i,matrix);}trunks.castShadow=leaves.castShadow=true;this.root.add(trunks,leaves);
  this.cage.position.set(13,this.height(13,-57),-57);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,bar=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,4.5,5),gold);bar.position.set(Math.sin(a)*2.1,2.25,Math.cos(a)*2.1);this.cage.add(bar);}for(const y of [.3,4.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.1,.12,6,32),gold);ring.rotation.x=Math.PI/2;ring.position.y=y;this.cage.add(ring);}this.root.add(this.cage);
  this.root.add(this.portal.root,new THREE.HemisphereLight('#ffe8be','#233a53',1.5));const sun=new THREE.DirectionalLight('#ffe6b3',2.8);sun.position.set(-60,90,30);this.root.add(sun,sun.target);
 }
 async buildSettlement(){
  const village=await loadKit('models/world/village.glb'),props=await loadKit('models/world/props.glb');
  const homes=new StaticBatch(village,'dawnharbor-homes'),builder=new TownBuilder(village,homes,this.collision,{});
  const lots:Lot[]=[];
  for(const side of [-1,1])for(let i=0;i<4;i++){const x=side*(i%2?38:35),z=26+i*19;lots.push({id:`dawn-${side}-${i}`,kind:i===2?(side===1?'forge':'tavern'):'house',x,z,yaw:side<0?Math.PI/2:-Math.PI/2,sx:i===2?4:3,sz:i===2?4:3,floors:i%2?2:1,style:(i+(side>0?2:0))%4,h:this.height(x,z)});}
  for(const lot of lots)builder.build(lot);this.root.add(homes.build());
  const market=new StaticBatch(props,'dawnharbor-market');
  const put=(name:string,x:number,z:number,yaw=0,scale=1,dy=0)=>{if(props.has(name))market.add(name,trs(x,this.height(x,z)+dy,z,yaw,scale));};
  for(const side of [-1,1])for(const z of [37,57,74]){const x=side*23;put('Stall_Empty',x,z,side<0?Math.PI/2:-Math.PI/2);put('Barrel_Apples',x+side*2,z+1);put('Crate_Wooden',x+side*2,z-2);put('FarmCrate_Apple',x,z,0,1,.82);}
  this.root.add(market.build());
 }
 update(time:number,rescued:boolean){this.portal.update(time);this.cage.visible=!rescued;for(const r of this.rotating){r.rotation.y=time*.45;r.rotation.z=Math.sin(time*.8+r.position.x)*.15;}}
}
