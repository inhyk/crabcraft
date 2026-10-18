import * as THREE from 'three';
import { loadKit, StaticBatch, trs, type Kit } from '../world/kit';
import { TownBuilder } from '../world/buildings';
import { lathe } from '../world/geom';
import { buildFountain } from '../world/fountain';
import { buildFx, type FxUniforms } from '../world/fx';
import type { GlowSpot } from '../world/dressing';
import { createSky, createSkyUniforms } from '../world/sky';
import { createTerrainMaterial, noiseTexture, Terrain } from '../world/terrain';
import { radialSprite } from '../screens/create/textures';

export interface EndingStage {
 root:THREE.Group;
 /** Display-only clock from the accepted server tick; it never advances the ending. */
 update(seconds:number,festive:number):void;
 dispose():void;
}
/** Festival at Clawhaven dusk: the W1 golden-hour palette, warm lanterns and a lit centre for the hero. */
export const ENDING_DUSK={zenith:'#24488f',mid:'#d98e86',horizon:'#ffb768',ground:'#d79a6c',sun:'#fff0c0',glow:'#ff9c45',cloudLit:'#ffc68e',cloudShade:'#8a5f7f',fog:'#d99b74',key:'#ffb36b',hemiSky:'#93a8e6',hemiGround:'#5e3e24',lantern:'#ffb45e'} as const;
/** Low western sun shared by the sky and the key light, so shadows and the horizon glow agree. */
export const ENDING_SUN=new THREE.Vector3(-.74,.44,-.52).normalize();
/** Private scenery. Source GLTF textures remain cached; all geometry/material copies belong here. */
export async function createEndingStage():Promise<EndingStage> {
 const root=new THREE.Group();root.name='ending-clawhaven-courtyard';
 const loaded=await Promise.allSettled(['village','nature','props'].map(name=>loadKit(`models/world/${name}.glb`)));
 const kits=loaded.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
 if(kits.length!==3){for(const kit of kits)for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();throw Error('Ending village assets could not be loaded');}
 const [village,nature,props]=kits;
 let low=false;try{low=localStorage.getItem('cc.quality')==='low';}catch{}
 const height=(x:number,z:number)=>{const u=THREE.MathUtils.smoothstep(Math.hypot(x,z),13,25);return u*(.48+.28*Math.sin(x*.12)*Math.cos(z*.11)+.2*Math.sin((x+z)*.065));};
 const owned=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 for(const kit of kits){const copies=new Map<THREE.Material,THREE.Material>();for(const [name,material]of kit.materials){const copy=material.clone();copies.set(material,copy);owned.add(copy);kit.materials.set(name,copy);if(copy instanceof THREE.MeshStandardMaterial){copy.roughness=Math.max(.65,copy.roughness);if(!/Metal/.test(name)){copy.metalness=0;copy.metalnessMap=null;}if(name==='MI_WindowGlass'){copy.color.set('#80582e');copy.emissive.set('#ffc06a');copy.emissiveIntensity=1.6;}if(name.startsWith('Leaves'))copy.side=THREE.DoubleSide;}}for(const piece of kit.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;}
 const dispose=()=>{const geometries=new Set<THREE.BufferGeometry>();root.traverse(object=>{const drawn=object as THREE.Object3D&{geometry?:THREE.BufferGeometry;material?:THREE.Material|THREE.Material[]};if(drawn.geometry)geometries.add(drawn.geometry);if(drawn.material)for(const material of Array.isArray(drawn.material)?drawn.material:[drawn.material])owned.add(material);});for(const geo of geometries)geo.dispose();for(const material of owned)material.dispose();for(const texture of textures)texture.dispose();root.clear();};
 try {
  // Exact W1 splat/cobble/rock material, with private texture copies and a flat display court.
  const cobble=village.material('MI_UnevenBrick')!.map!.clone(),rock=nature.material('Rocks')!.map!.clone();
  const terrain=new Terrain(),ground=createTerrainMaterial(terrain,{cobble,cobbleNormal:null,rock},{uTime:{value:0}});owned.add(ground);
  ground.addEventListener('dispose',()=>{cobble.dispose();rock.dispose();});
  const land=new THREE.PlaneGeometry(2,2,low?96:160,low?96:160);land.rotateX(-Math.PI/2);const positions=land.attributes.position;const spread=(t:number)=>12*t+988*t*t*t;for(let i=0;i<positions.count;i++){const x=spread(positions.getX(i)),z=spread(positions.getZ(i));positions.setXYZ(i,x,3+height(x,z),z);}land.computeVertexNormals();
  // W1 shader uses source coordinates including height. Translate the mesh, not its shader inputs.
  const lawn=new THREE.Mesh(land,ground);lawn.position.y=-3.08;lawn.receiveShadow=true;root.add(lawn);
  // Court inlays: slate bands frame the dancers, a brass medallion marks the hero's floor.
  const inlay=village.material('MI_Brick')!.clone();inlay.color.set('#4d5f5c');owned.add(inlay);
  const brass=village.material('MI_Brick')!.clone();brass.color.set('#d6ac62');owned.add(brass);
  const band=(inner:number,outer:number,material:THREE.Material,y:number)=>{const ring=new THREE.RingGeometry(inner,outer,96);ring.rotateX(-Math.PI/2);const uv=ring.attributes.uv,pos=ring.attributes.position;for(let i=0;i<uv.count;i++)uv.setXY(i,pos.getX(i)*.22,pos.getZ(i)*.22);const mesh=new THREE.Mesh(ring,material);mesh.position.y=y;mesh.receiveShadow=true;root.add(mesh);};
  band(8.8,9.15,inlay,-.045);band(12,12.2,inlay,-.045);band(2.25,2.5,brass,-.044);band(2.95,3.05,brass,-.044);
  // Warm light pool on the hero, soft enough to keep the cobble texture readable.
  const pool=radialSprite(128,0,[[0,1],[.45,.55],[1,0]]);textures.add(pool);
  const poolMaterial=new THREE.MeshBasicMaterial({color:'#ffcf86',alphaMap:pool,transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending});owned.add(poolMaterial);
  const poolMesh=new THREE.Mesh(new THREE.PlaneGeometry(7.5,7.5).rotateX(-Math.PI/2),poolMaterial);poolMesh.position.y=-.035;poolMesh.renderOrder=1;root.add(poolMesh);
  const spot=new THREE.SpotLight('#ffd9a0',low?70:90,32,THREE.MathUtils.degToRad(17),.65,1.6);spot.position.set(0,15,1.5);spot.target.position.set(0,0,0);root.add(spot,spot.target);
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
  const top=(name:string,scale=1)=>props.get(name).box.max.y*scale;
  const glows:GlowSpot[]=[],warm=new THREE.Color(ENDING_DUSK.lantern);
  const iron=new THREE.MeshStandardMaterial({color:'#2b2622',roughness:.5,metalness:.75});owned.add(iron);
  const postTop=3.3,posts:THREE.Vector3[]=[];
  for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=Math.sin(angle)*16,z=Math.cos(angle)*16;put(props,dressing,'Bench',x,z,angle+Math.PI,.85);put(props,dressing,i%2?'Banner_2':'Banner_1',x*1.08,z*1.08,angle,.95);const px=x*1.1,pz=z*1.1,py=-.08+height(px,pz);const pole=new THREE.Mesh(lathe([[.32,0],[.32,.25],[.16,.4],[.1,.5],[.09,3.3],[.14,3.4],[0,3.55]],8),iron);pole.position.set(px,py,pz);pole.castShadow=true;root.add(pole);posts.push(new THREE.Vector3(px,py+postTop,pz));put(props,dressing,'Lantern_Wall',px,pz,angle,.9,2.17);glows.push({pos:new THREE.Vector3(px*.985,py+2.45,pz*.985),color:warm,size:1.3,kind:'lamp'});const light=new THREE.PointLight(ENDING_DUSK.lantern,low?9:11,11,2);light.position.set(x,3,z);root.add(light);}
  // Festoon lights strung post to post around the court: thin dark cord, warm bulbs, a few rose and teal.
  const cord=new THREE.LineBasicMaterial({color:'#2a211c'});owned.add(cord);
  const bulbPalette=['#ffd690','#ffb45e','#ffd690','#ff9a7c','#ffd690','#9fe6d6'].map(c=>new THREE.Color(c));
  const bulbs:{pos:THREE.Vector3;color:THREE.Color}[]=[];
  for(let i=0;i<posts.length;i++){const a=posts[i],b=posts[(i+1)%posts.length],points:THREE.Vector3[]=[];for(let s=0;s<=24;s++){const t=s/24,p=a.clone().lerp(b,t);p.y-=Math.sin(Math.PI*t)*.75;points.push(p);if(s>0&&s<24&&s%2===0)bulbs.push({pos:p.clone().add(new THREE.Vector3(0,-.12,0)),color:bulbPalette[(i*11+s)%bulbPalette.length]});}root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),cord));}
  const bulbMaterial=new THREE.MeshBasicMaterial({toneMapped:false});owned.add(bulbMaterial);
  const bulbMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.075,8,6),bulbMaterial,bulbs.length);
  bulbs.forEach((bulb,i)=>{bulbMesh.setMatrixAt(i,trs(bulb.pos.x,bulb.pos.y,bulb.pos.z));bulbMesh.setColorAt(i,bulb.color.clone().multiplyScalar(2.2));glows.push({pos:bulb.pos,color:bulb.color,size:.55,kind:'lamp'});});
  root.add(bulbMesh);
  // A ring of floor candelabra between the slate bands: warm light on the near court at every angle.
  for(let i=0;i<12;i++){const angle=(i+.5)*Math.PI/6,x=Math.sin(angle)*10.6,z=Math.cos(angle)*10.6;put(props,dressing,'CandleStick_Stand',x,z,angle,1,-.06);glows.push({pos:new THREE.Vector3(x,top('CandleStick_Stand')-.02,z),color:new THREE.Color('#ffc477'),size:.7,kind:'candle'});}
  // Market stalls become a feast for the hero: laden tables, mugs, candles and apples.
  for(const side of [-1,1]){
   put(props,dressing,'Stall_Empty',side*19,-7,side*Math.PI/2);put(props,dressing,'Barrel_Apples',side*18,-4,.3);put(props,dressing,'FarmCrate_Apple',side*19,-7,0,1,.75);put(props,dressing,'Crate_Wooden',side*20,-5,.2);
   const tx=side*19.6,tz=2.2,yaw=side*Math.PI/2,table=top('Table_Large');put(props,dressing,'Table_Large',tx,tz,yaw);
   for(const [dx,dz,item] of [[0,-1.1,'Mug'],[.25,-.45,'Mug'],[-.2,.35,'CandleStick_Triple'],[.15,1.05,'Mug'],[-.15,1.5,'Pot_1']] as const){put(props,dressing,item,tx+dx,tz+dz,dz*2,1,-.08+table);if(item==='CandleStick_Triple')glows.push({pos:new THREE.Vector3(tx+dx,table+top(item)-.02,tz+dz),color:new THREE.Color('#ffc477'),size:.55,kind:'candle'});}
   put(props,dressing,'Stool',tx-side*1.05,tz-.8,.4);put(props,dressing,'Stool',tx-side*1.05,tz+.9,-.3);put(props,dressing,'Barrel',tx+side*.4,tz+2.6,.6);
  }
  // Torches light the path from the court to the chapel; the hero's gear rests by the tavern.
  for(const [x,z] of [[-3.3,-15.5],[3.3,-15.5],[-3.3,-22],[3.3,-22]] as const){const y=height(x,z)-.08,stand=new THREE.Mesh(lathe([[.22,0],[.22,.18],[.11,.3],[.07,.38],[.06,1.5],[.12,1.58],[.12,1.64]],8),iron);stand.position.set(x,y,z);stand.castShadow=true;root.add(stand);put(props,dressing,'Torch_Metal',x,z,0,1,1.64+.3);glows.push({pos:new THREE.Vector3(x,y+1.64+.3+top('Torch_Metal')+.12,z),color:new THREE.Color('#ff9a3c'),size:1.5,kind:'fire'});}
  put(props,dressing,'WeaponStand',-18.5,-13.5,.9);put(props,dressing,'Shield_Wooden',-17.6,-12.4,.6);put(props,dressing,'Chest_Wood',-16.4,-14.6,.4);put(props,dressing,'Coin_Pile',-15.6,-13.6,0);put(props,dressing,'Bag',-16.9,-15.6,1.2);
  for(let i=0;i<42;i++){const a=i*2.399963,r=23+(i%4)*5;put(nature,garden,`CommonTree_${i%5+1}`,Math.sin(a)*r,Math.cos(a)*r,a,.7+(i%3)*.12);}
  for(let i=0;i<820;i++){const a=i*2.399963,r=13.2+(i%37)*.34,x=Math.sin(a)*r,z=Math.cos(a)*r;if(Math.abs(x)<4&&z<0)continue;put(nature,garden,i%7===0?'Bush_Common_Flowers':i%5===0?'Flower_4_Group':i%3===0?'Clover_1':'Grass_Common_Short',x,z,a,.24+(i%4)*.06);}
  for(let i=0;i<18;i++){const a=i*2.399963,r=14.5+i%3*3;put(nature,garden,`Rock_Medium_${i%3+1}`,Math.sin(a)*r,Math.cos(a)*r,a,.5+i%3*.2);}
  // Petals thrown by the crowd: dense near the dancers, thinning towards the benches.
  for(let i=0,count=low?220:360;i<count;i++){const a=i*2.399963+Math.sin(i*12.9898)*.4,r=2.7+Math.pow(((i*.618034)%1),.8)*12.2,x=Math.sin(a)*r,z=Math.cos(a)*r;put(nature,garden,`Petal_${i%5+1}`,x,z,a*3.1,.42+(i%4)*.07,-.03);}
  root.add(dressing.build(),garden.build());
  const stone=village.material('MI_UnevenBrick')!.clone();owned.add(stone);stone.color.set('#c2b69a');
  const skyTime={value:0};
  const sky=createSkyUniforms(skyTime,noiseTexture());sky.uZenith.value.set(ENDING_DUSK.zenith);sky.uHorizon.value.set(ENDING_DUSK.horizon);sky.uMid.value.set(ENDING_DUSK.mid);sky.uGround.value.set(ENDING_DUSK.ground);sky.uSunColor.value.set(ENDING_DUSK.sun);sky.uCloudLit.value.set(ENDING_DUSK.cloudLit);sky.uCloudShade.value.set(ENDING_DUSK.cloudShade);
  sky.uGlow.value.set(ENDING_DUSK.glow);sky.uSunVis.value=1;sky.uCloudCover.value=.5;sky.uSunDir.value.copy(ENDING_SUN);root.add(createSky(sky));
  const fountain=buildFountain(18,-.1+height(18,-18),-18,stone,sky);fountain.group.scale.setScalar(.6);fountain.group.rotation.y=-Math.PI/2;root.add(fountain.group);
  fountain.group.updateMatrixWorld(true);const spouts=fountain.spouts.map(p=>p.clone().sub(fountain.group.position).applyMatrix4(fountain.group.matrixWorld));
  // Existing W1 particles: lamp halos, fountain jets, fireflies, dust in the low sun and fireworks.
  const fxTime={value:0};
  const fx=buildFx({glows,forgeSparks:new THREE.Vector3(0,-400,0),chimneys:[],fountainSpouts:spouts,fountainWaterY:fountain.group.position.y+.62*.6,fountainCentre:fountain.group.position.clone(),spray:[],embers:[],
   fireflyZones:[{centre:new THREE.Vector3(0,1.2,0),extent:new THREE.Vector3(22,3,22),count:low?40:70,color:new THREE.Color('#ffe08a')}],dustCentre:new THREE.Vector3(0,3,0),fireworksCentre:new THREE.Vector3(0,30,-46)},low?'low':'high',fxTime);
  const fxUniforms:FxUniforms=fx.uniforms;fxUniforms.uLamps.value=1;fxUniforms.uNight.value=.35;fxUniforms.uFireflies.value=.8;fxUniforms.uDust.value=.7;
  for(const points of fx.group.children)points.onBeforeRender=(renderer,_scene,camera)=>{fxUniforms.uPixel.value=renderer.domElement.height/(2*Math.tan(THREE.MathUtils.degToRad(((camera as THREE.PerspectiveCamera).fov??50)/2)));};
  root.add(fx.group);
  root.userData.assets=['village.glb','nature.glb','props.glb'];
  return {root,dispose,update(seconds:number,festive:number){if(!Number.isFinite(seconds))return;fxTime.value=seconds;skyTime.value=seconds;fxUniforms.uFireworks.value=THREE.MathUtils.clamp(festive,0,1);}};
 }catch(error){dispose();throw error;}finally{for(const kit of kits)for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();}
}
