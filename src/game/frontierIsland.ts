import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {FRONTIER_TOWN,layoutFrontier,frontierTrees,type FrontierChapter} from './realmLayout';
import {StarPortal} from './portal';
import {islandPaths} from './islandPaths';
/** Two new frontiers: distinct silhouettes, instanced nature and GPU-only ambient particles. */
export class FrontierIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,6,84);
 readonly town=FRONTIER_TOWN;
 readonly collision;
 readonly back:StarPortal;
 readonly next:StarPortal|null;
 private animated:THREE.ShaderMaterial[]=[];
 private rotating:THREE.Object3D[]=[];
 height(x:number,z:number){return realmHeight(this.chapter,x,z);}
 constructor(readonly chapter:FrontierChapter){
  const fire=chapter===5;this.root.name=fire?'WORLD V · Emberreach':'WORLD VI · Skybloom';this.root.visible=false;
  this.collision=layoutFrontier(chapter);
  this.back=new StarPortal(this.spawn,fire?'잿불 항구 → 서리빛 설원':'하늘 항구 → 잿불 군도');
  this.next=fire?new StarPortal(new THREE.Vector3(0,this.height(0,-72),-72),'잿불 성역 → 하늘숲'):null;
  const stone=new THREE.MeshStandardMaterial({color:fire?'#393239':'#d3d6b5',roughness:.82,metalness:fire?.25:.08});
  const wood=new THREE.MeshStandardMaterial({color:fire?'#423037':'#655037',roughness:.9});
  const metal=new THREE.MeshStandardMaterial({color:fire?'#77656b':'#b7b38a',metalness:.55,roughness:.4});
  const glow=new THREE.MeshStandardMaterial({color:fire?'#ffd29b':'#b4ffdc',emissive:fire?'#ff5717':'#39d9a7',emissiveIntensity:1.7,roughness:.3});
  const roofMat=new THREE.MeshStandardMaterial({color:fire?'#773e37':'#398269',roughness:.85});
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;this.root.add(m);return m;};
  const surface=document.createElement('canvas');surface.width=surface.height=256;const paint=surface.getContext('2d')!;
  paint.fillStyle='#d3d1c8';paint.fillRect(0,0,256,256);
  for(let i=0;i<1200;i++){const x=(i*73.37)%256,z=(i*137.91)%256;paint.fillStyle=i%3?'rgba(60,55,40,.09)':'rgba(255,255,235,.18)';paint.fillRect(x,z,1+i%3,1+i%2);}
  for(let i=0;i<38;i++){const x=(i*49.7)%256,z=(i*81.3)%256;paint.strokeStyle=fire?'rgba(70,36,28,.16)':'rgba(68,88,45,.15)';paint.lineWidth=1;paint.beginPath();paint.moveTo(x,z);paint.lineTo(x+3,z-4);paint.lineTo(x+8,z-5);paint.stroke();}
  const groundMap=new THREE.CanvasTexture(surface);groundMap.wrapS=groundMap.wrapT=THREE.RepeatWrapping;groundMap.repeat.set(42,49);groundMap.colorSpace=THREE.SRGBColorSpace;groundMap.anisotropy=4;
  const terrain=new THREE.PlaneGeometry(300,350,150,175);terrain.rotateX(-Math.PI/2);
  const pos=terrain.getAttribute('position'),colors:number[]=[];
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=this.height(x,z);pos.setY(i,y);const edge=Math.hypot(x/128,(z-2)/155),c=new THREE.Color(fire?(edge>.8?'#68433c':z<-30?'#65515b':'#7d675b'):(edge>.8?'#7cbda6':Math.abs(x)>42?'#477659':'#9bac72'));c.multiplyScalar(.93+.07*Math.sin(x*.61+z*.47));colors.push(c.r,c.g,c.b);}
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();add(terrain,new THREE.MeshStandardMaterial({vertexColors:true,map:groundMap,roughness:.96}),0,0,0).name='frontier-terrain';
  this.root.add(islandPaths((x,z)=>this.height(x,z),[{points:[[0,94],[0,28],[0,-72]],width:8,trim:true},...[38,56,74].map(z=>({points:[[-23,z],[23,z]] as [number,number][],width:4,trim:true})),{points:[[-12,84],[0,84]],width:4,trim:true}],chapter));
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
  // Low decorative plants stay clear of roads and personal quest props.
  const garden=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.65,0),foliage,160),gardenDummy=new THREE.Object3D();
  for(let i=0;i<160;i++){const a=i*2.39996,r=35+i%8*8,x=Math.sin(a)*r,z=Math.cos(a)*110;gardenDummy.position.set(x,this.height(x,z)+.2,z);gardenDummy.scale.set(1.1,.35+i%4*.15,.8);if(Math.abs(x)<24||Math.hypot(x/128,(z-2)/155)>.77)gardenDummy.scale.setScalar(0);gardenDummy.rotation.y=a;gardenDummy.updateMatrix();garden.setMatrixAt(i,gardenDummy.matrix);}garden.castShadow=true;garden.computeBoundingSphere();this.root.add(garden);
  for(let z=82;z>-62;z-=12)for(const side of [-1,1]){const x=side*6,y=this.height(x,z);add(new THREE.CylinderGeometry(.12,.21,2.8,6),metal,x,y+1.4,z);add(new THREE.OctahedronGeometry(.5),glow,x,y+3,z);const rim=add(new THREE.TorusGeometry(.65,.07,5,12),metal,x,y+3,z);rim.rotation.x=Math.PI/2;}
  // One instanced forest: complete broad leaves in Skybloom, obsidian spires in Emberreach.
  const trees=frontierTrees(chapter),dummy=new THREE.Object3D();
  const trunks=new THREE.InstancedMesh(fire?new THREE.ConeGeometry(2.3,10,5):new THREE.CylinderGeometry(.45,.85,12,7),fire?stone:wood,trees.length);
  const leaves=new THREE.InstancedMesh(fire?new THREE.OctahedronGeometry(1.5):new THREE.IcosahedronGeometry(3.8,1),fire?glow:new THREE.MeshStandardMaterial({color:'#398963',roughness:.87}),trees.length*3);
  trees.forEach(({x,z,s},i)=>{const y=this.height(x,z);dummy.position.set(x,y+(fire?5:6)*s,z);dummy.scale.setScalar(s);dummy.rotation.set(0,i*.7,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
   for(let j=0;j<3;j++){dummy.position.set(x+Math.sin(j*2.1)*s*1.7,y+(fire?6+j:9+j)*s,z+Math.cos(j*2.1)*s*1.7);dummy.scale.set(s*(fire?.55:1),s*(fire?1.6:.7),s*(fire?.55:1));dummy.updateMatrix();leaves.setMatrixAt(i*3+j,dummy.matrix);leaves.setColorAt(i*3+j,new THREE.Color(fire?'#ff7f38':j===0?'#57a873':j===1?'#3a896a':'#75b779'));}
  });for(const m of [trunks,leaves]){m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();this.root.add(m);}this.root.userData.frontierTrees=trees.length;
  const grassGeometry=new THREE.BufferGeometry();grassGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.3,0,0,0,1,0,.3,0,0,0,0,-.3,0,1,0,0,0,.3],3));grassGeometry.computeVertexNormals();
  const grass=new THREE.InstancedMesh(grassGeometry,new THREE.MeshStandardMaterial({color:fire?'#9f7946':'#68a36b',side:THREE.DoubleSide,roughness:1}),2200);
  for(let i=0;i<2200;i++){const x=Math.sin(i*127.13)*89,z=Math.sin(i*311.71)*115;gardenDummy.position.set(x,this.height(x,z)+.03,z);gardenDummy.rotation.set(0,i*.7,0);gardenDummy.scale.setScalar(.45+i%6*.13);if(Math.abs(x)<10||Math.hypot(x/128,(z-2)/155)>.76||Math.abs(x)<42&&z>26&&z<94||Math.hypot(x,z+72)<24)gardenDummy.scale.setScalar(0);gardenDummy.updateMatrix();grass.setMatrixAt(i,gardenDummy.matrix);}grass.computeBoundingSphere();this.root.add(grass);
  // Northern destination: a smoking volcanic caldera or a luminous world tree.
  const ly=this.height(0,-72);
  add(new THREE.CylinderGeometry(20,22,.4,64),stone,0,ly+.15,-72);
  for(const r of [8,19.5]){const ring=add(new THREE.TorusGeometry(r,.07,5,80),glow,0,ly+.4,-72);ring.rotation.x=-Math.PI/2;}
  if(fire){
   const volcano=add(new THREE.ConeGeometry(28,38,14,1,true),stone,0,ly+9,-128);volcano.name='ember-volcano';
   const crater=add(new THREE.CylinderGeometry(8,5,2,32),glow,0,ly+27,-128);crater.name='lava-crater';
   for(const side of [-1,1]){const lava=add(new THREE.PlaneGeometry(8,160,1,32),this.flowMaterial(true),side*91,1,0);lava.rotation.x=-Math.PI/2;lava.castShadow=false;}
   add(new THREE.TorusGeometry(11,.5,6,40),stone,0,ly+27,-128).rotation.x=Math.PI/2;
  }else{
   add(new THREE.CylinderGeometry(3.5,6,36,10),wood,0,ly+18,-112).name='skybloom-world-tree';
   for(let i=0;i<7;i++){const a=i/7*Math.PI*2,x=Math.sin(a)*10,z=-112+Math.cos(a)*10;const b=add(new THREE.CylinderGeometry(.6,1.4,20,6),wood,x*.5,ly+26,z+(-112-z)*.5);b.rotation.z=-Math.sin(a)*.8;b.rotation.x=Math.cos(a)*.8;const canopy=add(new THREE.IcosahedronGeometry(12,1),new THREE.MeshStandardMaterial({color:i%2?'#67ac86':'#3b947d',roughness:.8}),x,ly+38+i%3*3,z);canopy.scale.y=.65;}
   for(let i=0;i<9;i++){const a=i*2.4,x=Math.sin(a)*145,z=Math.cos(a)*160;add(new THREE.ConeGeometry(8+i%3*3,22,6),stone,x,12+i%4*9,z).rotation.z=Math.PI;add(new THREE.CylinderGeometry(8+i%3*3,7,2,8),roofMat,x,24+i%4*9,z);}
  }
  for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=-72+Math.cos(a)*23;if(z>-56)continue;const y=this.height(x,z);add(new THREE.CylinderGeometry(.9,1.4,9,8),stone,x,y+4.5,z);const gem=add(new THREE.OctahedronGeometry(.8),glow,x,y+9.8,z);this.rotating.push(gem);}
  // A low sea of lava / clouds and gradient sky distinguish the worlds at first glance.
  const sea=add(new THREE.PlaneGeometry(1800,1800),this.flowMaterial(fire),0,.15,0);sea.rotation.x=-Math.PI/2;sea.castShadow=false;sea.name=fire?'molten-sea':'sea-of-clouds';
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color(fire?'#271728':'#438ca7')},bottom:{value:new THREE.Color(fire?'#dd8b5f':'#d3efda')}},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;uniform vec3 top;uniform vec3 bottom;void main(){gl_FragColor=vec4(mix(bottom,top,smoothstep(0.,.65,normalize(v).y)),1.);}'});
  const sky=add(new THREE.SphereGeometry(850,32,20),skyMat,0,0,0);sky.renderOrder=-100;sky.castShadow=false;
  const particles=new THREE.BufferGeometry(),p=new Float32Array(360*3);for(let i=0;i<360;i++)p.set([Math.sin(i*127.1)*90,Math.sin(i*311.7)*14+20,Math.sin(i*74.7)*110],i*3);particles.setAttribute('position',new THREE.BufferAttribute(p,3));
  const sparks=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},tint:{value:new THREE.Color(fire?'#ffd292':'#a2ffe5')}},vertexShader:'uniform float time;void main(){vec3 p=position;p.y=mod(p.y+time*.8,40.)+4.;p.x+=sin(time*.4+p.z)*.5;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(100./max(1.,-mv.z),1.,5.);gl_Position=projectionMatrix*mv;}',fragmentShader:'uniform vec3 tint;void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(tint,a*.75);}'});this.animated.push(sparks);this.root.add(new THREE.Points(particles,sparks));
  const sun=new THREE.DirectionalLight(fire?'#ffd2a8':'#e5ffe9',fire?2:2.3);sun.position.set(45,90,40);this.root.add(sun,sun.target,new THREE.HemisphereLight(fire?'#dab0a6':'#c9f4ea',fire?'#44303e':'#57725a',1.5),this.back.root);if(this.next)this.root.add(this.next.root);
 }
 private flowMaterial(fire:boolean){const m=new THREE.ShaderMaterial({uniforms:{time:{value:0},hot:{value:fire?1:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float time;uniform float hot;void main(){float w=.5+.5*sin(v.x*90.+sin(v.y*70.+time*.15)*2.);vec3 lava=mix(vec3(.27,.035,.025),vec3(1.,.36,.025),pow(w,4.));vec3 cloud=mix(vec3(.64,.8,.8),vec3(.93,.98,.93),w);gl_FragColor=vec4(mix(cloud,lava,hot),1.);}'});this.animated.push(m);return m;}
 update(time:number){this.back.update(time);this.next?.update(time);for(const m of this.animated)m.uniforms.time.value=time;for(const gem of this.rotating)gem.rotation.y=time*.5;}
}
