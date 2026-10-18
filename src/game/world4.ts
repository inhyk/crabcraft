import * as THREE from 'three';
import {Collision} from '../world/collision';
import type {Poi} from '../world/types';
import {StarPortal} from './portal';
import {islandPaths} from './islandPaths';

/** Deterministic snow realm. Trees share instanced meshes; snowfall runs on the GPU. */
export class SnowIsland {
 readonly root=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,5,90);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,19,-78),yaw:0,radius:22};
 readonly town:[number,number][]=[[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68]];
 readonly collision=new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:(x,z)=>this.height(x,z)});
 readonly portal=new StarPortal(this.spawn,'서리빛 설원 → 새벽 항구');
 private sun=new THREE.DirectionalLight('#bedcff',2.1);
 private snow:THREE.ShaderMaterial;
 private aurora:THREE.ShaderMaterial;
 height(x:number,z:number){
  const edge=Math.hypot(x/128,(z-2)/155);
  const plateau=5+14*THREE.MathUtils.smoothstep(-z,5,55);
  const hills=Math.sin(x*.052)*Math.sin(z*.037)*2.5*(1-Math.exp(-x*x/600));
  return edge>.83?5-(edge-.83)*70:THREE.MathUtils.lerp(19,plateau+hills,THREE.MathUtils.smoothstep(Math.hypot(x,z+78),22,32));
 }
 constructor(){
  this.root.name='WORLD IV · Frostlight';this.root.visible=false;
  const snow=new THREE.MeshStandardMaterial({color:'#effaff',roughness:.86});
  const ice=new THREE.MeshStandardMaterial({color:'#72bedb',metalness:.32,roughness:.22});
  const dark=new THREE.MeshStandardMaterial({color:'#344959',roughness:.9});
  const wood=new THREE.MeshStandardMaterial({color:'#5e3d30',roughness:.92});
  const amber=new THREE.MeshStandardMaterial({color:'#ffdb8d',emissive:'#ff9b36',emissiveIntensity:1.8});
  const glow=new THREE.MeshStandardMaterial({color:'#c4ffff',emissive:'#52d8ff',emissiveIntensity:1.4,roughness:.25});
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  const terrain=new THREE.PlaneGeometry(300,350,120,140);terrain.rotateX(-Math.PI/2);
  const pos=terrain.getAttribute('position'),colors:number[]=[];
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=this.height(x,z);pos.setY(i,y);const c=new THREE.Color(y<3?'#8aaeca':Math.abs(x)>58?'#b4d0e6':'#edf7ff');c.multiplyScalar(.96+.04*Math.sin(x*.8+z*.6));colors.push(c.r,c.g,c.b);}
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();
  const ground=add(terrain,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93}),0,0,0);ground.name='snowdrift-terrain';
  const sea=add(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:'#244c6a',roughness:.28,metalness:.45}),0,.2,0);sea.rotation.x=-Math.PI/2;
  // Paved, gently rising trails remain clear of every building and tree trunk.
  this.root.add(islandPaths((x,z)=>this.height(x,z),[{points:[[0,94],[0,28],[0,-53]],width:8,trim:true},... [38,56,74].map(z=>({points:[[-22,z],[22,z]] as [number,number][],width:4,trim:true}))],4));
  for(const side of [-1,1])for(let i=0;i<3;i++){
   const x=side*29,z=38+i*18,y=this.height(x,z);
   add(new THREE.BoxGeometry(10,6,11),wood,x,y+3,z);
   for(const dy of [.4,1.8,3.2,4.6,5.8])add(new THREE.BoxGeometry(10.3,.2,11.3),dark,x,y+dy,z);
   const roof=add(new THREE.ConeGeometry(8.3,5,4),dark,x,y+8,z);roof.rotation.y=Math.PI/4;
   const cap=add(new THREE.ConeGeometry(8.4,4.8,4),snow,x,y+8.4,z);cap.rotation.y=Math.PI/4;
   const front=x-side*5.08;
   for(const dz of [-3,3]){const frame=add(new THREE.BoxGeometry(.25,2.3,2.2),dark,front,y+3,z+dz);frame.name='timber-window-frame';add(new THREE.BoxGeometry(.28,1.7,1.6),amber,front-side*.04,y+3,z+dz);add(new THREE.BoxGeometry(.32,1.8,.11),wood,front-side*.06,y+3,z+dz);}
   add(new THREE.BoxGeometry(.3,3.3,1.9),dark,front,y+1.65,z);
   add(new THREE.BoxGeometry(1.4,3.3,1.4),dark,x+2,y+9,z+2);add(new THREE.BoxGeometry(1.7,.25,1.7),snow,x+2,y+10.75,z+2);
   this.collision.addBox(x,z,5.3,5.8,0,y,y+11);
  }
  // Frozen fountain and warm lanterns make the settlement easy to read at a distance.
  const fy=this.height(-10,56);add(new THREE.CylinderGeometry(2.6,3,.65,32),dark,-10,fy+.32,56);add(new THREE.ConeGeometry(1.9,4,8),ice,-10,fy+2.5,56);
  this.collision.addCircle(-10,56,3.1,fy,fy+5);
  for(let z=82;z>-50;z-=12)for(const side of [-1,1]){const x=side*6,y=this.height(x,z);add(new THREE.CylinderGeometry(.13,.23,2.9,6),dark,x,y+1.45,z);add(new THREE.BoxGeometry(.65,.9,.65),amber,x,y+3,z);add(new THREE.ConeGeometry(.62,.5,4),snow,x,y+3.7,z);}
  // Layered evergreen boughs with thick snow caps, in four draw calls for the entire forest.
  const trees:{x:number;z:number;s:number}[]=[];
  for(let i=0;i<280;i++){const a=i*2.399963,r=55+i%7*6,x=Math.sin(a)*r,z=10+Math.cos(a)*108;if(Math.hypot(x/128,(z-2)/155)>.78||Math.abs(x)<19||Math.abs(x)<42&&z>23&&z<91||Math.hypot(x,z+78)<30)continue;trees.push({x,z,s:.8+i%5*.13});}
  const green=new THREE.MeshStandardMaterial({color:'#235558',roughness:.95});
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.55,8,6),wood,trees.length);
  const bough=new THREE.InstancedMesh(new THREE.ConeGeometry(3.5,5.5,9),green,trees.length*3);
  const caps=new THREE.InstancedMesh(new THREE.ConeGeometry(3.45,4.5,9),snow,trees.length*3);const dummy=new THREE.Object3D();
  const put=(mesh:THREE.InstancedMesh,i:number,x:number,y:number,z:number,s:number)=>{dummy.position.set(x,y,z);dummy.scale.setScalar(s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);};
  trees.forEach(({x,z,s},i)=>{const y=this.height(x,z);put(trunk,i,x,y+4*s,z,s);for(let j=0;j<3;j++){const scale=s*(1-j*.23);put(bough,i*3+j,x,y+(3.4+j*2.1)*s,z,scale);put(caps,i*3+j,x,y+(4+j*2.1)*s,z,scale);}this.collision.addCircle(x,z,.6*s,y,y+10*s);});
  for(const mesh of [trunk,bough,caps]){mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);}this.root.userData.snowPines=trees.length;
  // Ice cliffs frame the north without obstructing the arena's broad southern entrance.
  for(let i=0;i<42;i++){const a=i/42*Math.PI*2,x=Math.sin(a)*78,z=-42+Math.cos(a)*70;if(Math.abs(x)<16&&z>-70)continue;const y=this.height(x,z),h=6+i%5*3;const peak=add(new THREE.ConeGeometry(4+i%3,h,5),ice,x,y+h/2,z);peak.rotation.y=a;this.collision.addCircle(x,z,3.5,y,y+h);}
  add(new THREE.CylinderGeometry(22,23,.35,96),ice,0,18.92,-78);
  for(const r of [6,13,21.5]){const ring=add(new THREE.TorusGeometry(r,.065,5,96),glow,0,19.13,-78);ring.rotation.x=-Math.PI/2;}
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;if(Math.cos(a)>.7)continue;const x=Math.sin(a)*25,z=-78+Math.cos(a)*25,y=this.height(x,z);add(new THREE.CylinderGeometry(1,1.4,8,6),ice,x,y+4,z);add(new THREE.OctahedronGeometry(.8),glow,x,y+8.5,z);this.collision.addCircle(x,z,1.5,y,y+10);}
  const sky=add(new THREE.SphereGeometry(850,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;void main(){float h=max(0.,normalize(v).y);gl_FragColor=vec4(mix(vec3(.32,.49,.65),vec3(.015,.045,.13),smoothstep(0.,.6,h)),1.);}'}),0,0,0);sky.renderOrder=-100;sky.castShadow=false;
  this.aurora=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.x*.025+time*.15)*20.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;uniform float time;void main(){float rays=.5+.5*sin(v.x*75.+sin(v.x*12.+time*.2)*3.);float a=sin(v.y*3.14159)*(.1+.22*rays);gl_FragColor=vec4(mix(vec3(.1,.95,.65),vec3(.35,.32,.9),v.y),a);}'});
  add(new THREE.PlaneGeometry(650,90,64,1),this.aurora,0,135,-270).castShadow=false;
  const flakes=new THREE.BufferGeometry(),fp=new Float32Array(1800*3);for(let i=0;i<1800;i++)fp.set([Math.sin(i*127.1)*60,Math.sin(i*311.7)*30,Math.sin(i*74.7)*60],i*3);flakes.setAttribute('position',new THREE.BufferAttribute(fp,3));
  this.snow=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},origin:{value:new THREE.Vector3()}},vertexShader:'uniform float time;uniform vec3 origin;void main(){vec3 p=position;p.x+=sin(time*.2+position.z)*1.6;p.y=mod(position.y-time*1.6+60.,60.)-15.;p+=origin;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(65./max(1.,-mv.z),1.2,4.);gl_Position=projectionMatrix*mv;}',fragmentShader:'void main(){float a=1.-smoothstep(.2,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.9,.97,1.,a*.75);}'});
  const fall=new THREE.Points(flakes,this.snow);fall.frustumCulled=false;fall.name='gpu-snowfall';this.root.add(fall,this.portal.root,new THREE.HemisphereLight('#d2eaff','#35506d',1.4));
  this.sun.position.set(40,85,45);this.root.add(this.sun,this.sun.target);
 }
 update(time:number,x:number,z:number){this.portal.update(time);this.snow.uniforms.time.value=time;this.snow.uniforms.origin.value.set(x,this.height(x,z),z);this.aurora.uniforms.time.value=time;}
}
