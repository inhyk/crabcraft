import * as THREE from 'three';
import type {CrabRig,CrabSpec,SocketName} from './types';

/** A lightweight procedural sea drone: pulsing bell, luminous core and instanced tentacles. */
export function createJellyfishRig():CrabRig {
 const root=new THREE.Group(),body=new THREE.Group(),visual=new THREE.Group();root.add(body);body.add(visual);
 const shell=new THREE.MeshStandardMaterial({color:'#58a9dd',emissive:'#267d9e',emissiveIntensity:.6,metalness:.55,roughness:.24,transparent:true,opacity:.78});
 const glow=new THREE.MeshStandardMaterial({color:'#9dfff0',emissive:'#58eadc',emissiveIntensity:1.8,roughness:.3});
 const metal=new THREE.MeshStandardMaterial({color:'#353354',metalness:.7,roughness:.35});
 const bellGeo=new THREE.SphereGeometry(.85,20,12,0,Math.PI*2,0,Math.PI*.6),tubeGeo=new THREE.CylinderGeometry(.04,.025,.45,5),rimGeo=new THREE.TorusGeometry(.79,.075,6,32),coreGeo=new THREE.SphereGeometry(.28,10,8);
 const bell=new THREE.Mesh(bellGeo,shell);bell.position.y=1.3;visual.add(bell);
 const rim=new THREE.Mesh(rimGeo,metal);rim.rotation.x=Math.PI/2;rim.position.y=1.12;visual.add(rim);
 const core=new THREE.Mesh(coreGeo,glow);core.position.y=1.4;visual.add(core);
 const tentacles=new THREE.InstancedMesh(tubeGeo,glow,24);visual.add(tentacles);
 const sockets={} as Record<SocketName,THREE.Object3D>;
 for(const name of ['head','face','back','clawL','clawR','nameplate','chest'] as SocketName[]){const s=new THREE.Object3D();s.position.set(name==='clawL'?-.6:name==='clawR'?.6:0,name==='head'||name==='nameplate'?2:1.35,name==='face'?.65:0);root.add(s);sockets[name]=s;}
 const spec:CrabSpec={race:'undead',sex:'female',classId:'mage',shell:0,crest:0,led:0,name:'Tide Jelly Drone'};
 let time=0,dead=false;const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1);
 return {root,body,spec,metersToUnits:1,face:{setExpression(e){dead=e==='dead';},setTint(c){glow.emissive.set(c??'#58eadc');}},setJoint(){},setPose(){},getSocket:n=>sockets[n],async applySpec(){},update(dt){time+=dt;body.position.set(0,dead?-.25:Math.sin(time*2)*.1,0);body.rotation.set(0,0,dead?Math.PI/2:Math.sin(time*1.3)*.05);bell.scale.set(1+Math.sin(time*3)*.045,1-Math.sin(time*3)*.05,1+Math.sin(time*3)*.045);for(let i=0;i<24;i++){const a=Math.floor(i/3)*Math.PI/4,k=i%3;pos.set(Math.cos(a)*(.5+Math.sin(time*2+k)*.12),.92-k*.3,Math.sin(a)*(.5+Math.sin(time*2+k)*.12));q.setFromEuler(new THREE.Euler(Math.sin(time*2+a+k)*.35,0,Math.cos(time*2+a+k)*.35));matrix.compose(pos,q,scale);tentacles.setMatrixAt(i,matrix);}tentacles.instanceMatrix.needsUpdate=true;},dispose(){tentacles.dispose();root.removeFromParent();for(const geo of [bellGeo,tubeGeo,rimGeo,coreGeo])geo.dispose();for(const mat of [shell,glow,metal])mat.dispose();}};
}
