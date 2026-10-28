import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {FRONTIER_TOWN,layoutFrontier,frontierTrees,type FrontierChapter} from './realmLayout';
import {StarPortal} from './portal';
import type {Poi} from '../world/types';
import {SkyGroundLane} from './skyGroundLane';
/** World VI Skybloom, split from the shared frontier so its design can grow apart from World V. */
export class SkybloomIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,6,84);
 readonly town=FRONTIER_TOWN;
 readonly arena:Poi;
 readonly collision;
 readonly back:StarPortal;
 readonly next:StarPortal|null;
 private animated:THREE.ShaderMaterial[]=[];
 private rotating:THREE.Object3D[]=[];
 /** Terrain, paving, meadow and forest (skyGroundLane.ts). */
 private ground!:SkyGroundLane;
 height(x:number,z:number){return realmHeight(this.chapter,x,z);}
 readonly chapter:FrontierChapter=6;
 constructor(){
  const fire=false as boolean,chapter=this.chapter;this.root.name=fire?'WORLD V · Emberreach':'WORLD VI · Skybloom';this.root.visible=false;
  this.collision=layoutFrontier(chapter);this.arena={id:'bossArena',position:new THREE.Vector3(0,this.height(0,-72),-72),radius:20,yaw:0};
  this.back=new StarPortal(this.spawn,fire?'잿불 항구 → 서리빛 설원':'하늘 항구 → 잿불 군도');
  this.next=fire?new StarPortal(new THREE.Vector3(26,this.height(26,-44),-44),'잿불 성역 → 하늘숲'):null;
  const stone=new THREE.MeshStandardMaterial({color:fire?'#393239':'#d3d6b5',roughness:.82,metalness:fire?.25:.08});
  const wood=new THREE.MeshStandardMaterial({color:fire?'#423037':'#655037',roughness:.9});
  const metal=new THREE.MeshStandardMaterial({color:fire?'#77656b':'#b7b38a',metalness:.55,roughness:.4});
  const glow=new THREE.MeshStandardMaterial({color:fire?'#ffd29b':'#b4ffdc',emissive:fire?'#ff5717':'#39d9a7',emissiveIntensity:1.7,roughness:.3});
  const roofMat=new THREE.MeshStandardMaterial({color:fire?'#773e37':'#398269',roughness:.85});
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;this.root.add(m);return m;};
  this.ground=new SkyGroundLane(this.root);
  // Open central square, six homes and workshop details outside every road.
  for(const side of [-1,1])for(let i=0;i<3;i++){
   const x=side*30,z=38+i*18,y=this.height(x,z);
   add(new THREE.BoxGeometry(10,5.5,11),fire?stone:wood,x,y+2.75,z);
   for(const dx of [-4.7,4.7])add(new THREE.BoxGeometry(.4,5.9,11.3),metal,x+dx,y+2.95,z);
   const roof=add(new THREE.ConeGeometry(8.2,fire?3:5,fire?4:6),roofMat,x,y+7.5,z);roof.rotation.y=Math.PI/4;
   add(new THREE.BoxGeometry(2,3,.25),wood,x,y+1.5,z+5.6);
   for(const dx of [-3,3]){add(new THREE.BoxGeometry(1.9,1.7,.35),metal,x+dx,y+3,z+5.6);add(new THREE.BoxGeometry(1.4,1.2,.4),glow,x+dx,y+3,z+5.62);}
   if(fire){add(new THREE.CylinderGeometry(.7,.9,5,8),stone,x+2,y+8,z);add(new THREE.TorusGeometry(.8,.13,6,12),metal,x+2,y+10.5,z).rotation.x=Math.PI/2;}
   else{const balcony=add(new THREE.CylinderGeometry(7,7,.35,8),wood,x,y+.4,z);balcony.scale.z=.95;for(const a of [-.7,0,.7])add(new THREE.CylinderGeometry(.12,.16,2,6),metal,x+Math.sin(a)*6,y+1.4,z+Math.cos(a)*6);}
  }
  // Timber frames, tiled eaves and gardens make each home a lived-in village.
  const foliage=new THREE.MeshStandardMaterial({color:fire?'#977046':'#56976c',roughness:1});
  for(const side of [-1,1])for(let i=0;i<3;i++){
   const x=side*30,z=38+i*18,y=this.height(x,z);
   for(const dx of [-5,0,5])add(new THREE.BoxGeometry(.24,5.6,.3),wood,x+dx,y+2.8,z+5.75);
   for(const h of [.35,4.8])add(new THREE.BoxGeometry(10.2,.22,.3),metal,x,y+h,z+5.75);
   for(const dx of [-3,3]){add(new THREE.BoxGeometry(2.3,.35,.9),wood,x+dx,y+1.8,z+6);for(let k=-1;k<=1;k++)add(new THREE.IcosahedronGeometry(.45,0),foliage,x+dx+k*.6,y+2.1,z+6);}
   const awning=add(new THREE.BoxGeometry(4,.16,2),roofMat,x,y+3.6,z+6.4);awning.rotation.x=.16;
   for(const dx of [-1.8,1.8])add(new THREE.CylinderGeometry(.08,.12,3.4,6),metal,x+dx,y+1.7,z+7.2);
   for(const dx of [-7,7]){const by=this.height(x+dx,z+3);add(new THREE.CylinderGeometry(.65,.7,1.2,10),wood,x+dx,by+.6,z+3);for(const h of [.2,1])add(new THREE.TorusGeometry(.69,.06,4,10),metal,x+dx,by+h,z+3).rotation.x=Math.PI/2;}
   for(let k=0;k<8;k++){const a=add(new THREE.BoxGeometry(.7,.08,4.8),metal,x-3.8+k*1.1,y+7.3,z+3);a.rotation.x=.45;}
  }
  const blocks:THREE.Matrix4[]=[],colorsBrick:THREE.Color[]=[];const brickDummy=new THREE.Object3D();
  for(const side of [-1,1])for(let i=0;i<3;i++){
   const x=side*30,z=38+i*18,y=this.height(x,z);
   for(let row=0;row<7;row++)for(let c=0;c<8;c++){
    const bx=x-4.45+c*1.27+(row%2)*.25;if(Math.abs(bx-x)<1.4&&row<4)continue;
    brickDummy.position.set(bx,y+.35+row*.7,z+5.54);brickDummy.scale.set(1.2,.62,.16);brickDummy.rotation.set(0,0,0);brickDummy.updateMatrix();blocks.push(brickDummy.matrix.clone());colorsBrick.push(new THREE.Color(fire?'#8b7770':'#92734f').multiplyScalar(.8+(row+c)%4*.09));
   }
   for(const dx of [-5.1,5.1]){const beam=add(new THREE.BoxGeometry(.24,5.5,.3),wood,x+dx,y+2.75,z+5.65);beam.rotation.z=dx>0?-.18:.18;}
   for(let k=0;k<12;k++){const tile=add(new THREE.BoxGeometry(.7,.15,1.1),roofMat,x-4.1+k*.75,y+7.4,z);tile.rotation.z=.06*Math.sin(k);}
   add(new THREE.BoxGeometry(10.6,.23,.5),wood,x,y+5.5,z+5.9);
  }
  const brickwork=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),stone,blocks.length);blocks.forEach((matrix,i)=>{brickwork.setMatrixAt(i,matrix);brickwork.setColorAt(i,colorsBrick[i]);});brickwork.castShadow=brickwork.receiveShadow=true;this.root.add(brickwork);
  for(let z=82;z>-62;z-=12)for(const side of [-1,1]){const x=side*6,y=this.height(x,z);add(new THREE.CylinderGeometry(.12,.21,2.8,6),metal,x,y+1.4,z);add(new THREE.OctahedronGeometry(.5),glow,x,y+3,z);const rim=add(new THREE.TorusGeometry(.65,.07,5,12),metal,x,y+3,z);rim.rotation.x=Math.PI/2;}
  this.root.userData.frontierTrees=frontierTrees(chapter).length;
  // Northern destination: a smoking volcanic caldera or a luminous world tree.
  const ly=this.height(0,-72);
  add(new THREE.CylinderGeometry(20,22,.4,64),stone,0,ly-.19,-72);
  for(const r of [8,19.5]){const ring=add(new THREE.TorusGeometry(r,.07,5,80),glow,0,ly+.04,-72);ring.rotation.x=-Math.PI/2;}
  if(fire){
   const volcano=add(new THREE.CylinderGeometry(8,28,38,18,4,true),stone,0,ly+9,-128);volcano.name='ember-volcano';
   const crater=add(new THREE.CylinderGeometry(8,5,2,32),glow,0,ly+27,-128);crater.name='lava-crater';
   for(const side of [-1,1]){const lava=add(new THREE.PlaneGeometry(8,160,1,32),this.flowMaterial(true),side*91,1,0);lava.rotation.x=-Math.PI/2;lava.castShadow=false;}
   add(new THREE.TorusGeometry(11,.5,6,40),stone,0,ly+27,-128).rotation.x=Math.PI/2;
  }else{
   add(new THREE.CylinderGeometry(3.5,6,36,10),wood,0,ly+18,-112).name='skybloom-world-tree';
   for(let i=0;i<7;i++){const a=i/7*Math.PI*2,x=Math.sin(a)*10,z=-112+Math.cos(a)*10;const b=add(new THREE.CylinderGeometry(.6,1.4,20,6),wood,x*.5,ly+26,z+(-112-z)*.5);b.rotation.z=-Math.sin(a)*.8;b.rotation.x=Math.cos(a)*.8;const canopy=add(new THREE.IcosahedronGeometry(12,1),new THREE.MeshStandardMaterial({color:i%2?'#67ac86':'#3b947d',roughness:.8}),x,ly+38+i%3*3,z);canopy.scale.y=.65;}
   for(let i=0;i<9;i++){const a=i*2.4,x=Math.sin(a)*145,z=Math.cos(a)*160;add(new THREE.ConeGeometry(8+i%3*3,22,6),stone,x,12+i%4*9,z).rotation.z=Math.PI;add(new THREE.CylinderGeometry(8+i%3*3,7,2,8),roofMat,x,24+i%4*9,z);}
  }
  for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=-72+Math.cos(a)*23;if(z>-56)continue;const y=this.height(x,z);add(new THREE.CylinderGeometry(.9,1.4,9,8),stone,x,y+4.5,z);const gem=add(new THREE.OctahedronGeometry(.8),glow,x,y+9.8,z);this.rotating.push(gem);}
  this.makeDetails(fire,stone,wood,metal,glow,foliage);
  // A low sea of lava / clouds and gradient sky distinguish the worlds at first glance.
  const sea=add(new THREE.PlaneGeometry(1800,1800),this.flowMaterial(fire),0,.15,0);sea.rotation.x=-Math.PI/2;sea.castShadow=false;sea.name=fire?'molten-sea':'sea-of-clouds';
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color(fire?'#271728':'#438ca7')},bottom:{value:new THREE.Color(fire?'#dd8b5f':'#d3efda')}},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;uniform vec3 top;uniform vec3 bottom;void main(){gl_FragColor=vec4(mix(bottom,top,smoothstep(0.,.65,normalize(v).y)),1.);}'});
  const sky=add(new THREE.SphereGeometry(850,32,20),skyMat,0,0,0);sky.renderOrder=-100;sky.castShadow=false;
  const particles=new THREE.BufferGeometry(),p=new Float32Array(360*3);for(let i=0;i<360;i++)p.set([Math.sin(i*127.1)*90,Math.sin(i*311.7)*14+20,Math.sin(i*74.7)*110],i*3);particles.setAttribute('position',new THREE.BufferAttribute(p,3));
  const sparks=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},tint:{value:new THREE.Color(fire?'#ffd292':'#a2ffe5')}},vertexShader:'uniform float time;void main(){vec3 p=position;p.y=mod(p.y+time*.8,40.)+4.;p.x+=sin(time*.4+p.z)*.5;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(100./max(1.,-mv.z),1.,5.);gl_Position=projectionMatrix*mv;}',fragmentShader:'uniform vec3 tint;void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(tint,a*.75);}'});this.animated.push(sparks);this.root.add(new THREE.Points(particles,sparks));
  const sun=new THREE.DirectionalLight(fire?'#ffd2a8':'#fff5cd',fire?2.5:2.6);sun.position.set(45,90,40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=sun.shadow.camera.bottom=-105;sun.shadow.camera.right=sun.shadow.camera.top=105;sun.shadow.camera.near=1;sun.shadow.camera.far=240;sun.shadow.bias=-.00015;sun.shadow.normalBias=.12;sun.shadow.camera.updateProjectionMatrix();this.root.add(sun,sun.target,new THREE.HemisphereLight(fire?'#dab0a6':'#c9f4ea',fire?'#44303e':'#344a3a',.75),this.back.root);if(this.next)this.root.add(this.next.root);
 }
 /** Small scenery shares geometry and material; roads and battle space stay unobstructed. */
 private makeDetails(fire:boolean,stone:THREE.Material,wood:THREE.Material,metal:THREE.Material,glow:THREE.Material,foliage:THREE.Material){
  const detail=new THREE.Group();detail.name=fire?'ember-forge-village-details':'skybloom-living-garden';this.root.add(detail);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;detail.add(m);return m;};
  const y=(x:number,z:number)=>this.height(x,z);
  // Banners and benches frame the road without covering the view of residents.
  const cloth=new THREE.MeshStandardMaterial({color:fire?'#a5482b':'#3a8d7b',side:THREE.DoubleSide,roughness:.85});
  const bannerGeo=new THREE.PlaneGeometry(1.7,2.9,4,8);
  for(const z of [76,40,10,-24])for(const side of [-1,1]){
   const x=side*10,by=y(x,z);add(new THREE.CylinderGeometry(.09,.16,5.5,6),metal,x,by+2.75,z);
   const flag=add(bannerGeo,cloth,x+side*.85,by+3.9,z);flag.rotation.y=side*.25;flag.userData.banner=true;this.rotating.push(flag);
   add(new THREE.OctahedronGeometry(.24),glow,x,by+5.7,z);
   if(z>20){add(new THREE.BoxGeometry(3,.25,.9),wood,x,by+.8,z+3);for(const dx of [-1,1])add(new THREE.BoxGeometry(.2,.8,.7),metal,x+dx,by+.4,z+3);}
  }
  // Two market stalls: layered awnings, crates and wares make the expedition feel inhabited.
  for(const side of [-1,1]){
   const x=side*20,z=22,by=y(x,z);
   add(new THREE.BoxGeometry(5,.25,2.2),wood,x,by+1.25,z);
   for(const dx of [-2.2,2.2])for(const dz of [-1,1])add(new THREE.CylinderGeometry(.09,.12,3.8,6),wood,x+dx,by+1.9,z+dz);
   for(let k=0;k<6;k++){const awning=add(new THREE.BoxGeometry(.9,.1,3),k%2?cloth:metal,x-2.25+k*.9,by+3.8,z);awning.rotation.x=.13;}
   for(let k=0;k<5;k++){const m=add(fire?new THREE.OctahedronGeometry(.28):new THREE.SphereGeometry(.27,7,5),fire?glow:foliage,x-1.5+k*.75,by+1.65,z);m.rotation.y=k;}
   for(let k=0;k<3;k++){const bx=x+side*(4+k%2),bz=z+k*1.3;add(new THREE.BoxGeometry(1,1,1),wood,bx,y(bx,bz)+.5,bz);add(new THREE.BoxGeometry(1.05,.12,1.05),metal,bx,y(bx,bz)+.8,bz);}
  }
  // Inlaid sanctuary paving is flat with the collision ground, never above attack warnings.
  const cells:[number,number][]=[];for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)if(Math.hypot(x*2.1,z*2.1)<18)cells.push([x,z]);
  const paving=new THREE.InstancedMesh(new THREE.BoxGeometry(2.02,.025,2.02),stone,cells.length),dummy=new THREE.Object3D();
  cells.forEach(([x,z],i)=>{dummy.position.set(x*2.1,y(0,-72)+.001,-72+z*2.1);dummy.updateMatrix();paving.setMatrixAt(i,dummy.matrix);paving.setColorAt(i,new THREE.Color(fire?'#77625d':'#9ab7a0').multiplyScalar(.85+(i%5)*.045));});paving.receiveShadow=true;detail.add(paving);
  for(let i=0;i<12;i++){const a=i*Math.PI/6,x=Math.sin(a)*18,z=-72+Math.cos(a)*18;const rune=add(new THREE.BoxGeometry(.16,.03,1.4),glow,x,y(0,-72)+.04,z);rune.rotation.y=a;}
  if(fire){
   // Layered basalt cliffs, glowing fissures and an outdoor furnace.
   for(const side of [-1,1])for(let i=0;i<12;i++){const x=side*(84+i%3*5),z=-95+i*15,by=y(x,z);const rock=add(new THREE.CylinderGeometry(1.8,2.3,5+i%4,6),stone,x,by+2,z);rock.rotation.y=i*.4;add(new THREE.BoxGeometry(.12,2+i%3,.15),glow,x-side*1.9,by+2,z);}
   const fx=-46,fz=55,fy=y(fx,fz);add(new THREE.BoxGeometry(5,2.8,4),stone,fx,fy+1.4,fz);add(new THREE.BoxGeometry(3.4,.8,2.6),glow,fx,fy+2.85,fz);add(new THREE.BoxGeometry(2.4,.5,1.2),metal,fx+7,fy+1.5,fz);add(new THREE.ConeGeometry(.9,1.3,4),metal,fx+7,fy+.7,fz);
   for(let k=0;k<8;k++){const a=k*.8,x=fx+Math.sin(a)*3,z=fz+Math.cos(a)*3;add(new THREE.OctahedronGeometry(.45),metal,x,y(x,z)+.35,z);}
  }else{
   // World-tree hanging lanterns.
   for(let i=0;i<10;i++){const a=i*Math.PI/5,x=Math.sin(a)*11,z=-112+Math.cos(a)*11;add(new THREE.CylinderGeometry(.035,.035,6+i%3,4),metal,x,y(0,-72)+26,z);add(new THREE.OctahedronGeometry(.5),glow,x,y(0,-72)+22-i%3*.5,z);}
   // Root arches sit beyond the north rim of the fight.
   for(const side of [-1,1]){const arch=add(new THREE.TorusGeometry(8,.65,6,24,Math.PI),wood,side*22,y(side*22,-108)+2,-108);arch.rotation.y=side*.5;}
  }
  this.root.userData.frontierDetailMeshes=detail.children.length;
 }
 private flowMaterial(fire:boolean){const m=new THREE.ShaderMaterial({uniforms:{time:{value:0},hot:{value:fire?1:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float time;uniform float hot;void main(){float w=.5+.5*sin(v.x*90.+sin(v.y*70.+time*.15)*2.);vec3 lava=mix(vec3(.27,.035,.025),vec3(1.,.36,.025),pow(w,4.));vec3 cloud=mix(vec3(.64,.8,.8),vec3(.93,.98,.93),w);gl_FragColor=vec4(mix(cloud,lava,hot),1.);}'});this.animated.push(m);return m;}
 update(time:number,quality:'high'|'low'='high',player:THREE.Vector3|null=null){this.ground.update(time,quality,player);this.back.update(time);this.next?.update(time);for(const m of this.animated)m.uniforms.time.value=time;for(const gem of this.rotating)if(gem.userData.banner)gem.rotation.y=Math.sin(time*1.7+gem.position.z)*.12;else gem.rotation.y=time*.5;}
}
