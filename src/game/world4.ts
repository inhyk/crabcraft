import * as THREE from 'three';
import {snowHeight} from '../sim/world/ground';
import {layoutFrostlight,snowTrees,SNOW_FOUNTAIN} from './world4Colliders';
import type {Poi} from '../world/types';
import {StarPortal} from './portal';
import {islandPaths} from './islandPaths';
import {SnowDeform} from './snowDeform';
import {applySnowSurface,SnowFootfalls} from './snowSurface';
import {SnowSpray} from './snowSpray';
import {crystalCluster,crystalGeometry,iceMaterial,type Crystal} from './iceCrystals';
import type {Unit} from './unit';

/** Deterministic snow realm. Trees share instanced meshes; snowfall runs on the GPU. */
export class SnowIsland {
 readonly root=new THREE.Group();
 readonly prison=new THREE.Group();
 readonly spawn=new THREE.Vector3(-12,5,90);
 readonly arena:Poi={id:'bossArena',position:new THREE.Vector3(0,19,-78),yaw:0,radius:22};
 readonly town:[number,number][]=[[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68]];
 readonly collision=layoutFrostlight();
 readonly portal=new StarPortal(this.spawn,'서리빛 설원 → 새벽 항구');
 private sun=new THREE.DirectionalLight('#bedcff',2.1);
 private snow:THREE.ShaderMaterial;
 private aurora:THREE.ShaderMaterial;
 /** Prints and berms the crabs leave in the snowfield (SNOWFLOW's deformation buffer). */
 readonly deform=new SnowDeform(40);
 private footfalls=new SnowFootfalls();
 /** Powder the same footfalls kick up; the arena's ice floor is not snow. */
 readonly spray=new SnowSpray(this.root,{sun:this.sun,bare:(x,z)=>Math.hypot(x-this.arena.position.x,z-this.arena.position.z)<this.arena.radius+1});
 private refreshSnow:()=>void;
 private refreshIce:()=>void;
 height(x:number,z:number){
  return snowHeight(x,z);
 }
 constructor(){
  this.root.name='WORLD IV · Frostlight';this.root.visible=false;
  const snow=new THREE.MeshStandardMaterial({color:'#effaff',roughness:.86});
  const ice=new THREE.MeshStandardMaterial({color:'#72bedb',metalness:.32,roughness:.22});
  const dark=new THREE.MeshStandardMaterial({color:'#344959',roughness:.9});
  const wood=new THREE.MeshStandardMaterial({color:'#5e3d30',roughness:.92});
  const amber=new THREE.MeshStandardMaterial({color:'#ffdb8d',emissive:'#ff9b36',emissiveIntensity:1.8});
  const glow=new THREE.MeshStandardMaterial({color:'#c4ffff',emissive:'#52d8ff',emissiveIntensity:1.4,roughness:.25});
  // Grown ice (SNOWFLOW's crystal shape and shading). The seed fixes the formations for every player.
  const {material:iceGlass,refresh:refreshIce}=iceMaterial({sun:this.sun});this.refreshIce=refreshIce;
  let seed=20261018;const rand=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const iceMesh=(list:Crystal[],name:string)=>{const m=new THREE.Mesh(crystalGeometry(list),iceGlass);m.name=name;m.castShadow=true;this.root.add(m);return m;};
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
  const terrain=new THREE.PlaneGeometry(300,350,120,140);terrain.rotateX(-Math.PI/2);
  const pos=terrain.getAttribute('position'),colors:number[]=[];
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=this.height(x,z);pos.setY(i,y);const c=new THREE.Color(y<3?'#8aaeca':Math.abs(x)>58?'#b4d0e6':'#edf7ff');c.multiplyScalar(.96+.04*Math.sin(x*.8+z*.6));colors.push(c.r,c.g,c.b);}
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();
  const groundMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93});this.refreshSnow=applySnowSurface(groundMat,this.deform,{sun:this.sun});
  const ground=add(terrain,groundMat,0,0,0);ground.name='snowdrift-terrain';
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

  }
  // Frozen fountain and warm lanterns make the settlement easy to read at a distance.
  const {x:fx,z:fz}=SNOW_FOUNTAIN,fy=this.height(fx,fz);
  const basin=add(new THREE.CylinderGeometry(2.6,3,.65,32),dark,fx,fy+.32,fz);basin.name='snow-fountain-basin';
  iceMesh(crystalCluster(0,0,0,4.4,1.9,6,rand),'snow-fountain-sculpture').position.set(fx,fy+.62,fz);

  for(let z=82;z>-50;z-=12)for(const side of [-1,1]){const x=side*6,y=this.height(x,z);add(new THREE.CylinderGeometry(.13,.23,2.9,6),dark,x,y+1.45,z);add(new THREE.BoxGeometry(.65,.9,.65),amber,x,y+3,z);add(new THREE.ConeGeometry(.62,.5,4),snow,x,y+3.7,z);}
  // Layered evergreen boughs with thick snow caps, in four draw calls for the entire forest.
  const trees=snowTrees();
  const green=new THREE.MeshStandardMaterial({color:'#235558',roughness:.95});
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.55,8,6),wood,trees.length);
  const bough=new THREE.InstancedMesh(new THREE.ConeGeometry(3.5,5.5,9),green,trees.length*3);
  const caps=new THREE.InstancedMesh(new THREE.ConeGeometry(3.45,4.5,9),snow,trees.length*3);const dummy=new THREE.Object3D();
  const put=(mesh:THREE.InstancedMesh,i:number,x:number,y:number,z:number,s:number)=>{dummy.position.set(x,y,z);dummy.scale.setScalar(s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);};
  trees.forEach(({x,z,s},i)=>{const y=this.height(x,z);put(trunk,i,x,y+4*s,z,s);for(let j=0;j<3;j++){const scale=s*(1-j*.23);put(bough,i*3+j,x,y+(3.4+j*2.1)*s,z,scale);put(caps,i*3+j,x,y+(4+j*2.1)*s,z,scale);}});
  for(const mesh of [trunk,bough,caps]){mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);}this.root.userData.snowPines=trees.length;
  // Boreas keeps the missing friend in a luminous ice prison beside the throne.
  this.prison.name='mira-ice-prison';this.prison.position.set(13,this.height(13,-62),-62);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,bar=new THREE.Mesh(new THREE.CylinderGeometry(.11,.16,4.5,6),ice);bar.position.set(Math.sin(a)*2.3,2.25,Math.cos(a)*2.3);this.prison.add(bar);}
  for(const y of [.2,4.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.3,.14,6,40),glow);ring.rotation.x=Math.PI/2;ring.position.y=y;this.prison.add(ring);}
  this.root.add(this.prison);
  // Ice cliffs frame the north without obstructing the arena's broad southern entrance.
  const cliffs:Crystal[]=[];
  for(let i=0;i<42;i++){const a=i/42*Math.PI*2,x=Math.sin(a)*78,z=-42+Math.cos(a)*70;if(Math.abs(x)<16&&z>-70)continue;const y=this.height(x,z),h=6+i%5*3;crystalCluster(x,y,z,h*1.1,4+i%3,5+i%3,rand,cliffs);}
  iceMesh(cliffs,'frostlight-ice-cliffs');
  add(new THREE.CylinderGeometry(22,23,.35,96),ice,0,18.92,-78);
  for(const r of [6,13,21.5]){const ring=add(new THREE.TorusGeometry(r,.065,5,96),glow,0,19.13,-78);ring.rotation.x=-Math.PI/2;}
  const pillars:Crystal[]=[];
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;if(Math.cos(a)>.7)continue;const x=Math.sin(a)*25,z=-78+Math.cos(a)*25,y=this.height(x,z);crystalCluster(x,y,z,8.6,2.6,3,rand,pillars);add(new THREE.OctahedronGeometry(.8),glow,x,y+8.5,z);}
  iceMesh(pillars,'frostlight-arena-crystals');
  const sky=add(new THREE.SphereGeometry(850,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;void main(){float h=max(0.,normalize(v).y);gl_FragColor=vec4(mix(vec3(.32,.49,.65),vec3(.015,.045,.13),smoothstep(0.,.6,h)),1.);}'}),0,0,0);sky.renderOrder=-100;sky.castShadow=false;
  this.aurora=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;uniform float time;void main(){v=uv;vec3 p=position;p.z+=sin(p.x*.025+time*.15)*20.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 v;uniform float time;void main(){float rays=.5+.5*sin(v.x*75.+sin(v.x*12.+time*.2)*3.);float a=sin(v.y*3.14159)*(.1+.22*rays);gl_FragColor=vec4(mix(vec3(.1,.95,.65),vec3(.35,.32,.9),v.y),a);}'});
  add(new THREE.PlaneGeometry(650,90,64,1),this.aurora,0,135,-270).castShadow=false;
  const flakes=new THREE.BufferGeometry(),fp=new Float32Array(1800*3);for(let i=0;i<1800;i++)fp.set([Math.sin(i*127.1)*60,Math.sin(i*311.7)*30,Math.sin(i*74.7)*60],i*3);flakes.setAttribute('position',new THREE.BufferAttribute(fp,3));
  this.snow=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},origin:{value:new THREE.Vector3()}},vertexShader:'uniform float time;uniform vec3 origin;void main(){vec3 p=position;p.x+=sin(time*.2+position.z)*1.6;p.y=mod(position.y-time*1.6+60.,60.)-15.;p+=origin;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(65./max(1.,-mv.z),1.2,4.);gl_Position=projectionMatrix*mv;}',fragmentShader:'void main(){float a=1.-smoothstep(.2,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.9,.97,1.,a*.75);}'});
  const fall=new THREE.Points(flakes,this.snow);fall.frustumCulled=false;fall.name='gpu-snowfall';this.root.add(fall,this.portal.root,new THREE.HemisphereLight('#d2eaff','#35506d',1.4));
  this.sun.position.set(40,85,45);this.root.add(this.sun,this.sun.target);
 }
 /** Footprints for every crab near the player, then one deformation step. Runs only while Frostlight is shown. */
 updateSnow(dt:number,renderer:THREE.WebGLRenderer,units:readonly Unit[],x:number,z:number,quality:'high'|'low'='high'){this.footfalls.update(units,this.deform,(px,pz)=>this.height(px,pz),x,z,this.spray,dt);this.deform.step(renderer,dt,x,z,quality);this.spray.update(dt,x,z,quality);this.refreshSnow();this.refreshIce();}
 disposeSnow(){this.deform.dispose();this.spray.dispose();}
 update(time:number,x:number,z:number,rescued=false){this.prison.visible=!rescued;this.portal.update(time);this.snow.uniforms.time.value=time;this.snow.uniforms.origin.value.set(x,this.height(x,z),z);this.aurora.uniforms.time.value=time;}
}
