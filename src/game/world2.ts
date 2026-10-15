import * as THREE from 'three';
import type { Game } from './game';
import type { Poi } from '../world/types';
import { snapshotMap } from './snapshots';

/** A separate, deterministic realm; all clients build the same island and collision surface. */
export class HiddenWorld {
  readonly root = new THREE.Group();
  chapter: 1 | 2 = 1;
  readonly spawn = new THREE.Vector3(0, 3, 43);
  readonly arena: Poi = { id:'bossArena',position:new THREE.Vector3(0,3,-35),yaw:0,radius:17 };
  private baseRoot: THREE.Group;
  private originalHeight: Game['world']['heightAt'];
  private originalCollision: Game['world']['resolveCollision'];
  private originalRay: Game['world']['raycastSolid'];
  private baseSpawn: Poi;
  private rotations: THREE.Object3D[] = [];
  private glow: THREE.ShaderMaterial;
  private obstacles: { x:number; z:number; r:number }[] = [];
  private portal: THREE.Group;
  private rendered = false;
  private baseHomes: THREE.Vector3[] = [];

  constructor(private game: Game) {
    const w=game.world;
    this.baseRoot=w.root;
    this.originalHeight=w.heightAt.bind(w);this.originalCollision=w.resolveCollision.bind(w);this.originalRay=w.raycastSolid.bind(w);
    this.baseSpawn={...w.pois.spawn,position:w.pois.spawn.position.clone()};
    this.root.visible=false;game.scene.add(this.root);
    this.glow=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{time:{value:0}},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;uniform float time;void main(){vec3 d=normalize(v);float a=sin(d.x*11.+time*.07+d.z*5.)*.5+.5;float curtain=pow(max(0.,sin(d.y*9.+d.x*12.+time*.1)),6.)*smoothstep(-.1,.5,d.y);vec3 c=mix(vec3(.018,.012,.06),vec3(.16,.06,.28),pow(1.-max(0.,d.y),3.));c+=curtain*mix(vec3(.04,.24,.3),vec3(.3,.05,.36),a)*.45;gl_FragColor=vec4(c,1.);}' });
    this.root.add(new THREE.Mesh(new THREE.SphereGeometry(800,48,24),this.glow));
    const land=new THREE.PlaneGeometry(140,140,70,70);land.rotateX(-Math.PI/2);
    const pos=land.attributes.position,colors=[];
    const low=new THREE.Color('#171c36'),high=new THREE.Color('#51415b');
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=this.height(x,z);pos.setY(i,y);const c=low.clone().lerp(high,Math.max(0,Math.min(1,(y+1)/10)));colors.push(c.r,c.g,c.b);}
    land.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));land.computeVertexNormals();
    const pixels=new Uint8Array(128*128*4);
    for(let z=0;z<128;z++)for(let x=0;x<128;x++){
      const hash=Math.sin(x*127.1+z*311.7)*43758.5453,grain=(hash-Math.floor(hash))*.18;
      const vein=Math.pow(Math.abs(Math.sin(x*.12+Math.sin(z*.09)*2)),20)*.12;
      const shade=Math.round((.68+grain-vein)*255),i=(z*128+x)*4;
      pixels.set([shade,shade,shade,255],i);
    }
    const texture=new THREE.DataTexture(pixels,128,128);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(18,18);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
    const ground=new THREE.Mesh(land,new THREE.MeshStandardMaterial({map:texture,vertexColors:true,roughness:.94,metalness:.13}));ground.receiveShadow=true;this.root.add(ground);
    const sea=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),new THREE.MeshStandardMaterial({color:'#080d24',metalness:.82,roughness:.18,emissive:'#080829',emissiveIntensity:.3}));sea.rotation.x=-Math.PI/2;sea.position.y=-3;this.root.add(sea);
    const stone=new THREE.MeshStandardMaterial({color:'#3c3b57',roughness:.78,metalness:.3});
    const crystal=new THREE.MeshStandardMaterial({color:'#a57bff',emissive:'#6524c9',emissiveIntensity:1.5,metalness:.5,roughness:.2});
    const teal=new THREE.MeshStandardMaterial({color:'#b0fff1',emissive:'#26afba',emissiveIntensity:1.3,metalness:.6,roughness:.25});
    const rand=(i:number)=>{const x=Math.sin(i*127.1+41.7)*43758.5453;return x-Math.floor(x);};
    // Jagged crystal gardens frame the open combat paths. One geometry/material per family.
    const crystals=new THREE.InstancedMesh(new THREE.OctahedronGeometry(1,0),crystal,90);const matrix=new THREE.Matrix4();const q=new THREE.Quaternion();
    for(let i=0;i<90;i++){const a=rand(i+1)*Math.PI*2,r=31+rand(i+120)*30,x=Math.sin(a)*r,z=Math.cos(a)*r,h=1.5+rand(i+250)*6;q.setFromEuler(new THREE.Euler(rand(i)*.25,a,.15));matrix.compose(new THREE.Vector3(x,this.height(x,z)+h*.5,z),q,new THREE.Vector3(.7+rand(i+300),h,1));crystals.setMatrixAt(i,matrix);}
    crystals.castShadow=true;this.root.add(crystals);
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2,x=Math.sin(a)*21,z=-35+Math.cos(a)*21,h=5+(i%3)*2;
      const column=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.7,h,8),stone);column.position.set(x,this.height(x,z)+h/2,z);column.castShadow=true;this.root.add(column);this.obstacles.push({x,z,r:1.7});
      const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.85),i%2?teal:crystal);gem.position.set(x,this.height(x,z)+h+1,z);this.root.add(gem);this.rotations.push(gem);
    }
    const disk=new THREE.Mesh(new THREE.CylinderGeometry(17,18,.3,64),stone);disk.position.copy(this.arena.position);disk.position.y=2.93;disk.receiveShadow=true;this.root.add(disk);
    for(const r of [3,9,16]){const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.045,5,96),teal);ring.rotation.x=Math.PI/2;ring.position.set(0,3.12,-35);this.root.add(ring);}
    // Stepping-stone road, luminous wayfinders, ruined arches.
    const road=new THREE.InstancedMesh(new THREE.BoxGeometry(3.8,.15,2.6),stone,24);
    for(let i=0;i<24;i++){const z=40-i*3.1,x=Math.sin(i*.5)*1.5;matrix.makeTranslation(x,this.height(x,z)+.08,z);road.setMatrixAt(i,matrix);}road.receiveShadow=true;this.root.add(road);
    for(let i=0;i<14;i++){const z=35-i*5,x=(i%2?1:-1)*6.5;const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.4),teal);gem.position.set(x,this.height(x,z)+1,z);this.root.add(gem);this.rotations.push(gem);}
    this.portal=new THREE.Group();this.portal.position.copy(this.spawn);this.portal.position.y+=3.2;
    for(let i=0;i<2;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(2.8+i*.3,.12,8,64),i?crystal:teal);ring.rotation.y=i*.3;this.portal.add(ring);}this.root.add(this.portal);
    const stars=new Float32Array(420*3);for(let i=0;i<420;i++){const a=rand(i+900)*Math.PI*2,y=80+rand(i+1400)*350,r=250+rand(i+1900)*300;stars.set([Math.sin(a)*r,y,Math.cos(a)*r],i*3);}
    const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(stars,3));this.root.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:'#b8adff',size:1.2,transparent:true,opacity:.8,depthWrite:false})));
    const moon=new THREE.Mesh(new THREE.SphereGeometry(18,24,16),new THREE.MeshBasicMaterial({color:'#bca5ed'}));moon.position.set(-100,160,-260);this.root.add(moon);
    const key=new THREE.DirectionalLight('#d6b9ff',1.8);key.position.set(-40,90,20);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:180});key.shadow.normalBias=.04;
    this.root.add(key,new THREE.HemisphereLight('#869cff','#1a1028',1.0));
    for(const p of [new THREE.Vector3(0,8,43),new THREE.Vector3(0,10,-35)]){const light=new THREE.PointLight('#8e5dff',28,35,1.5);light.position.copy(p);this.root.add(light);}
  }
  height(x:number,z:number) {
    if (Math.hypot(x,z+35)<19 || (Math.abs(x)<7 && z>-38 && z<50)) return 3;
    const r=Math.hypot(x,z);return 3+Math.sin(x*.12)*Math.cos(z*.09)*1.4+Math.max(0,r-45)*.28;
  }
  enter(authority=true) {
    if(this.chapter===2)return;
    const g=this.game,w=g.world;
    if(!this.baseHomes.length)this.baseHomes=g.enemies.map(e=>e.home.clone());
    this.chapter=2;this.rendered=true;
    g.cinematic=false;g.journey?.closeChapterEnding();
    this.baseRoot.visible=false;this.root.visible=true;
    w.heightAt=(x,z)=>this.height(x,z);
    w.resolveCollision=(x,z,r,out)=>{
      const d=Math.hypot(x,z);if(d>62-r){x*= (62-r)/d;z*= (62-r)/d;}
      for(const o of this.obstacles){const dx=x-o.x,dz=z-o.z,dist=Math.hypot(dx,dz),min=r+o.r;if(dist<min){x=o.x+(dx/(dist||1))*min;z=o.z+(dz/(dist||1))*min;}}
      return out.set(x,z);
    };
    w.raycastSolid=()=>null;
    w.pois.spawn.position.copy(this.spawn);w.pois.spawn.yaw=Math.PI;
    for(const u of [...g.npcs.map(n=>n.unit),...g.townsfolk.map(t=>t.unit)])u.hidden=true;
    {
      const mobs=g.enemies.filter(e=>!e.isAdd);
      mobs.forEach((e,i)=>{const row=Math.floor(i/8),side=i%2?1:-1;const x=side*(17+(i%4)*6),z=25-row*13-(i%3)*3;e.home.set(x,this.height(x,z),z);if(authority)e.respawnAt(x,z);e.unit.name=e.kind==='scrapling'?'수정 껍질 파수꾼':'별빛 유적 수호자';e.unit.setBaseTint('#b08cff');});
      for(const e of g.enemies.filter(e=>e.isAdd))e.despawn();
    }
    g.player.respawn();g.player.unit.teleport(w,this.spawn.x,this.spawn.z,Math.PI);g.follow.cut();g.follow.yaw=0;
    g.player.setTarget(null);g.world.setMood(1);g.zone='';g.hud.messages.banner('WORLD II · 잊힌 별의 섬','11–20레벨 · 일식의 왕관을 찾아서','zone');
    try{g.hud.minimap.setSnapshot(snapshotMap(g.engine.renderer,g.scene,{minX:-75,maxX:75,minZ:-75,maxZ:75,topY:90},[g.vfx.group,g.objective.group,...g.units.map(u=>u.rig.root)]));}catch{ /* The island still plays if map capture is unavailable. */ }
    g.journey?.save();
  }
  returnToShore() {
    if(this.chapter===1)return;
    this.showEpilogue();this.chapter=1;
    const g=this.game;
    g.enemies.forEach((e,i)=>{if(this.baseHomes[i])e.home.copy(this.baseHomes[i]);});
    for(const u of [...g.npcs.map(n=>n.unit),...g.townsfolk.map(t=>t.unit)])u.hidden=false;
    g.player.respawn();g.player.unit.teleport(g.world,this.baseSpawn.position.x,this.baseSpawn.position.z,this.baseSpawn.yaw);g.follow.cut();
    g.takeMapSnapshot();
  }
  showEpilogue() {
    if(!this.rendered)return;this.rendered=false;this.root.visible=false;this.baseRoot.visible=true;
    const w=this.game.world;w.heightAt=this.originalHeight;w.resolveCollision=this.originalCollision;w.raycastSolid=this.originalRay;
    w.pois.spawn.position.copy(this.baseSpawn.position);w.pois.spawn.yaw=this.baseSpawn.yaw;
  }
  update(dt:number,time:number) {
    if(!this.rendered)return;
    const fog=this.game.scene.fog;if(fog instanceof THREE.FogExp2){fog.color.set('#17152e');fog.density=.007;}
    this.glow.uniforms.time.value=time;
    for(const o of this.rotations){o.rotation.y+=dt*.6;o.rotation.z=Math.sin(time*.7+o.position.x)*.12;}
    this.portal.rotation.z=Math.sin(time*.2)*.08;
  }
  dispose(){this.showEpilogue();this.game.scene.remove(this.root);const mats=new Set<THREE.Material>(),geos=new Set<THREE.BufferGeometry>();this.root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}});for(const g of geos)g.dispose();for(const m of mats){if(m instanceof THREE.MeshStandardMaterial)m.map?.dispose();m.dispose();}}
}
