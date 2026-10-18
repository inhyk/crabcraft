import * as THREE from 'three';
import { loadKit, StaticBatch, trs, type Kit } from '../world/kit';
import { TownBuilder } from '../world/buildings';
import { lathe } from '../world/geom';
import { buildFountain } from '../world/fountain';
import { createSky, createSkyUniforms } from '../world/sky';
import { createTerrainMaterial, noiseTexture, Terrain } from '../world/terrain';

export interface EndingStage {root:THREE.Group;dispose():void}
/** Private scenery. Source GLTF textures remain cached; all geometry/material copies belong here. */
export async function createEndingStage():Promise<EndingStage> {
 const root=new THREE.Group();root.name='ending-clawhaven-courtyard';
 const loaded=await Promise.allSettled(['village','nature','props'].map(name=>loadKit(`models/world/${name}.glb`)));
 const kits=loaded.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
 if(kits.length!==3){for(const kit of kits)for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();throw Error('Ending village assets could not be loaded');}
 const [village,nature,props]=kits;
 let low=false;try{low=localStorage.getItem('cc.quality')==='low';}catch{}
 const height=(x:number,z:number)=>{const u=THREE.MathUtils.smoothstep(Math.hypot(x,z),13,25);return u*(.48+.28*Math.sin(x*.12)*Math.cos(z*.11)+.2*Math.sin((x+z)*.065));};
 const owned=new Set<THREE.Material>();
 for(const kit of kits){const copies=new Map<THREE.Material,THREE.Material>();for(const [name,material]of kit.materials){const copy=material.clone();copies.set(material,copy);owned.add(copy);kit.materials.set(name,copy);if(copy instanceof THREE.MeshStandardMaterial){copy.roughness=Math.max(.65,copy.roughness);if(!/Metal/.test(name)){copy.metalness=0;copy.metalnessMap=null;}if(name==='MI_WindowGlass'){copy.color.set('#80582e');copy.emissive.set('#ffc979');copy.emissiveIntensity=1.2;}if(name.startsWith('Leaves'))copy.side=THREE.DoubleSide;}}for(const piece of kit.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;}
 const dispose=()=>{const geometries=new Set<THREE.BufferGeometry>();root.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])owned.add(material);}});for(const geo of geometries)geo.dispose();for(const material of owned)material.dispose();root.clear();};
 try {
  // Exact W1 splat/cobble/rock material, with private texture copies and a flat display court.
  const cobble=village.material('MI_UnevenBrick')!.map!.clone(),rock=nature.material('Rocks')!.map!.clone();
  const terrain=new Terrain(),ground=createTerrainMaterial(terrain,{cobble,cobbleNormal:null,rock},{uTime:{value:0}});owned.add(ground);
  ground.addEventListener('dispose',()=>{cobble.dispose();rock.dispose();});
  const land=new THREE.PlaneGeometry(2,2,low?96:160,low?96:160);land.rotateX(-Math.PI/2);const positions=land.attributes.position;const spread=(t:number)=>12*t+988*t*t*t;for(let i=0;i<positions.count;i++){const x=spread(positions.getX(i)),z=spread(positions.getZ(i));positions.setXYZ(i,x,3+height(x,z),z);}land.computeVertexNormals();
  // W1 shader uses source coordinates including height. Translate the mesh, not its shader inputs.
  const lawn=new THREE.Mesh(land,ground);lawn.position.y=-3.08;lawn.receiveShadow=true;root.add(lawn);
  const inlay=village.material('MI_Brick')!.clone();inlay.color.set('#5b776d');owned.add(inlay);
  for(const [inner,outer]of [[8.8,9.15],[12.0,12.2]]){const band=new THREE.RingGeometry(inner,outer,96);band.rotateX(-Math.PI/2);const uv=band.attributes.uv,pos=band.attributes.position;for(let i=0;i<uv.count;i++)uv.setXY(i,pos.getX(i)*.22,pos.getZ(i)*.22);const mesh=new THREE.Mesh(band,inlay);mesh.position.y=-.045;mesh.receiveShadow=true;root.add(mesh);}
  const homes=new StaticBatch(village,'ending-village'),builder=new TownBuilder(village,homes,null,{});
  for(const lot of [
   {id:'ending-chapel',kind:'chapel' as const,x:0,z:-31,yaw:0,sx:4,sz:5,floors:2,style:0,h:-.1},
   {id:'ending-tavern',kind:'tavern' as const,x:-26,z:-17,yaw:.65,sx:4,sz:4,floors:2,style:0,h:-.1},
   {id:'ending-home-a',kind:'house' as const,x:25,z:-20,yaw:-.65,sx:3,sz:4,floors:2,style:1,h:-.1},
   {id:'ending-home-b',kind:'house' as const,x:-29,z:15,yaw:2,sx:3,sz:3,floors:2,style:2,h:-.1},
   {id:'ending-home-c',kind:'house' as const,x:28,z:17,yaw:-2,sx:3,sz:4,floors:2,style:0,h:-.1},
   {id:'ending-home-d',kind:'house' as const,x:0,z:35,yaw:Math.PI,sx:4,sz:3,floors:2,style:1,h:-.1},
  ])builder.build({...lot,h:lot.h+height(lot.x,lot.z)});
  root.add(homes.build());
  const dressing=new StaticBatch(props,'ending-festival'),garden=new StaticBatch(nature,'ending-gardens');
  const put=(kit:Kit,batch:StaticBatch,name:string,x:number,z:number,yaw=0,scale=1,y=-.08)=>{if(!kit.has(name))throw Error(`Ending scenery missing ${name}`);batch.add(name,trs(x,y+height(x,z),z,yaw,scale));};
  const iron=new THREE.MeshStandardMaterial({color:'#2b2622',roughness:.5,metalness:.75});owned.add(iron);
  for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=Math.sin(angle)*16,z=Math.cos(angle)*16;put(props,dressing,'Bench',x,z,angle+Math.PI,.85);put(props,dressing,'Banner_1',x*1.08,z*1.08,angle,.95);const pole=new THREE.Mesh(lathe([[.32,0],[.32,.25],[.16,.4],[.1,.5],[.09,3.3],[.14,3.4],[0,3.55]],8),iron);pole.position.set(x*1.1,-.08+height(x*1.1,z*1.1),z*1.1);pole.castShadow=true;root.add(pole);put(props,dressing,'Lantern_Wall',x*1.1,z*1.1,angle,.9,2.17);const light=new THREE.PointLight('#67ddd3',11,10,2);light.position.set(x,3,z);root.add(light);}
  for(const side of [-1,1]){put(props,dressing,'Stall_Empty',side*19,-7,side*Math.PI/2);put(props,dressing,'Barrel_Apples',side*18,-4,.3);put(props,dressing,'FarmCrate_Apple',side*19,-7,0,1,.75);put(props,dressing,'Crate_Wooden',side*20,-5,.2);}
  for(let i=0;i<42;i++){const a=i*2.399963,r=23+(i%4)*5;put(nature,garden,`CommonTree_${i%5+1}`,Math.sin(a)*r,Math.cos(a)*r,a,.7+(i%3)*.12);}
  for(let i=0;i<820;i++){const a=i*2.399963,r=13.2+(i%37)*.34,x=Math.sin(a)*r,z=Math.cos(a)*r;if(Math.abs(x)<4&&z<0)continue;put(nature,garden,i%7===0?'Bush_Common_Flowers':i%5===0?'Flower_4_Group':'Grass_Common_Short',x,z,a,.24+(i%4)*.06);}
  for(let i=0;i<18;i++){const a=i*2.399963,r=14.5+i%3*3;put(nature,garden,`Rock_Medium_${i%3+1}`,Math.sin(a)*r,Math.cos(a)*r,a,.5+i%3*.2);}
  root.add(dressing.build(),garden.build());
  const stone=village.material('MI_UnevenBrick')!.clone();owned.add(stone);stone.color.set('#c2b69a');
  const sky=createSkyUniforms({value:0},noiseTexture());sky.uZenith.value.set('#2c606b');sky.uHorizon.value.set('#ffd49a');sky.uMid.value.set('#aabbb1');sky.uGround.value.set('#c4c1ac');sky.uSunColor.value.set('#ffdf9a');sky.uCloudLit.value.set('#f3d6af');sky.uCloudShade.value.set('#668a92');
  sky.uGlow.value.set('#e0a974');sky.uSunVis.value=1;sky.uCloudCover.value=.42;sky.uSunDir.value.set(-.4,.35,-.8).normalize();root.add(createSky(sky));
  const fountain=buildFountain(18,-.1+height(18,-18),-18,stone,sky);fountain.group.scale.setScalar(.6);fountain.group.rotation.y=-Math.PI/2;root.add(fountain.group);
  root.userData.assets=['village.glb','nature.glb','props.glb'];
  return {root,dispose};
 }catch(error){dispose();throw error;}finally{for(const kit of kits)for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();}
}
