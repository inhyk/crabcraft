import * as THREE from 'three';
import { trs, type Kit, type StaticBatch } from '../world/kit';
import type { GlowSpot } from '../world/dressing';
import { radialSprite } from '../screens/create/textures';

/**
 * The dance floor of the ending courtyard, in stage space (centre at the origin, court surface at y = -0.08).
 * Hero cuts look across it from 0.5 m and down on it from above the guest ring, so everything here reads both
 * ways: broad inlaid bands built of stone blocks (no long thin radial lines, which read as cracks from a low
 * camera), a compass star, confetti, streamers and small petals tilted so they catch light at a grazing view,
 * flowers thrown at the hero's feet, worn and sunlit patches in the cobble, and offerings of candles and flowers
 * just outside the guest ring. The hero's limbs sweep up to about 3.8 m from the centre during the routine, so
 * only flat pieces lie inside that; anything standing waits beyond the guests.
 */
export interface FestivalFloorPorts {
 readonly root:THREE.Group;
 readonly owned:Set<THREE.Material>;
 readonly textures:Set<THREE.Texture>;
 readonly props:Kit;
 readonly garden:StaticBatch;
 readonly dressing:StaticBatch;
 readonly glows:GlowSpot[];
 readonly low:boolean;
}
/** Court surface height in stage space; contact shadows sit at -0.066, so the inlays stay below them. */
const COURT=-.08;
/** Outer radius of the brass medallion inlay under the hero. */
export const ENDING_MEDALLION_RADIUS=3.07;
/** Garland band between the inner (4.2 m) and outer (6.4 m) guest rings. */
export const ENDING_GARLAND_BAND=[5.1,5.5] as const;
/** Deterministic hash in [0, 1): the floor is the same on every load, so the same observation gives the same frame. */
const hash=(i:number,salt:number)=>{const s=Math.sin(i*127.1+salt*311.7)*43758.5453;return s-Math.floor(s);};
const STONE={brass:'#c99446',brassLight:'#e2b96c',brassDark:'#8f6230',sand:'#c6a77b',field:'#cfb389',terracotta:'#a64b30',teal:'#2f6f68',tealDark:'#245650'} as const;

/** Colour and bump maps of the medallion: concentric bands of cut stone round a compass star. */
function medallionMaps(size:number):{map:THREE.CanvasTexture;bump:THREE.CanvasTexture} {
 const canvas=document.createElement('canvas'),relief=document.createElement('canvas');canvas.width=canvas.height=relief.width=relief.height=size;
 const ctx=canvas.getContext('2d')!,bump=relief.getContext('2d')!,R=ENDING_MEDALLION_RADIUS,px=size/2/R,c=size/2;
 bump.fillStyle='#fff';bump.fillRect(0,0,size,size);
 const at=(r:number,a:number):[number,number]=>[c+Math.sin(a)*r*px,c-Math.cos(a)*r*px];
 const disc=(r:number,color:string)=>{ctx.beginPath();ctx.arc(c,c,r*px,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();};
 const polygon=(points:readonly [number,number][],color:string)=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=color;ctx.fill();};
 // Grout is drawn on both maps: dark in colour, recessed in relief, so joints catch the low sun.
 const joint=(draw:(g:CanvasRenderingContext2D)=>void,width:number,alpha=1)=>{for(const [g,color] of [[ctx,`rgba(74,54,38,${alpha})`],[bump,'#000']] as const){g.beginPath();draw(g);g.lineWidth=width*px;g.strokeStyle=color;g.stroke();}};
 const ring=(r:number,width=.018,alpha=1)=>joint(g=>g.arc(c,c,r*px,0,Math.PI*2),width,alpha);
 const spoke=(a:number,r0:number,r1:number,width=.016,alpha=.8)=>joint(g=>{g.moveTo(...at(r0,a));g.lineTo(...at(r1,a));},width,alpha);
 // Bands from the rim inwards: brass rim, sandstone blocks with a bead row, brass, terracotta with bunting, brass, field.
 disc(R,STONE.brassDark);disc(R-.03,STONE.brass);disc(2.95,STONE.sand);disc(2.5,STONE.brass);disc(2.25,STONE.terracotta);disc(1.86,STONE.brass);disc(1.78,STONE.field);
 // The field is paved in diagonal slabs under the star.
 ctx.save();ctx.beginPath();ctx.arc(c,c,1.78*px,0,Math.PI*2);ctx.clip();bump.save();bump.beginPath();bump.arc(c,c,1.78*px,0,Math.PI*2);bump.clip();
 for(let k=-6;k<=6;k++)for(const turn of [Math.PI/4,-Math.PI/4]){const ox=Math.cos(turn)*k*.42,oy=Math.sin(turn)*k*.42,dx=-Math.sin(turn)*2,dy=Math.cos(turn)*2;joint(g=>{g.moveTo(c+(ox-dx)*px,c+(oy-dy)*px);g.lineTo(c+(ox+dx)*px,c+(oy+dy)*px);},.014,.45);}
 ctx.restore();bump.restore();
 for(let i=0;i<32;i++){const a=(i+.5)/32*Math.PI*2,[x,y]=at(2.725,a);ctx.beginPath();ctx.arc(x,y,(i%2?.075:.1)*px,0,Math.PI*2);ctx.fillStyle=i%2?STONE.terracotta:STONE.brassLight;ctx.fill();spoke(i/32*Math.PI*2,2.52,2.93);}
 // Bunting teeth along the inner edge of the terracotta band: festival pennants pointing at the centre.
 for(let i=0;i<36;i++){const a=i/36*Math.PI*2,w=Math.PI/36;polygon([at(2.25,a-w*.82),at(2.25,a+w*.82),at(1.98,a)],i%3===1?STONE.teal:STONE.field);spoke(a+w,1.88,2.23,.012,.5);}
 // Compass star: four long brass points split light and dark like a bevel, four short teal points between.
 for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4,w=.36;polygon([at(0,0),at(.62,a-w),at(1.15,a)],STONE.teal);polygon([at(0,0),at(1.15,a),at(.62,a+w)],STONE.tealDark);}
 for(let i=0;i<4;i++){const a=i*Math.PI/2,w=.3;polygon([at(0,0),at(.72,a-w),at(1.68,a)],STONE.brassLight);polygon([at(0,0),at(1.68,a),at(.72,a+w)],STONE.brassDark);}
 disc(.5,STONE.brass);disc(.43,STONE.terracotta);disc(.17,STONE.brassLight);
 for(const r of [R-.012,R-.03,2.95,2.5,2.25,1.86,1.78,.5,.43,.17])ring(r);
 // Stone grain: soft lighter and darker blotches, so the inlay reads as stone rather than paint.
 for(let i=0;i<(size>1024?900:500);i++){const a=hash(i,1)*Math.PI*2,r=Math.sqrt(hash(i,2))*R*.99,[x,y]=at(r,a),s=(.04+hash(i,3)*.14)*px,v=hash(i,4);const g=ctx.createRadialGradient(x,y,0,x,y,s);const tint=v<.55?`58,38,20`:`255,244,222`,alpha=v<.55?.11:.09;g.addColorStop(0,`rgba(${tint},${alpha})`);g.addColorStop(1,`rgba(${tint},0)`);ctx.fillStyle=g;ctx.fillRect(x-s,y-s,s*2,s*2);}
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
 const bumpMap=new THREE.CanvasTexture(relief);bumpMap.colorSpace=THREE.NoColorSpace;bumpMap.anisotropy=8;
 return {map,bump:bumpMap};
}

/** One block of the garland band, repeated round the ring: a terracotta lozenge between teal roundels on sandstone. */
function garlandMaps(width:number):{map:THREE.CanvasTexture;bump:THREE.CanvasTexture} {
 const height=Math.round(width*.4),canvas=document.createElement('canvas'),relief=document.createElement('canvas');canvas.width=relief.width=width;canvas.height=relief.height=height;
 const ctx=canvas.getContext('2d')!,bump=relief.getContext('2d')!;bump.fillStyle='#fff';bump.fillRect(0,0,width,height);
 ctx.fillStyle=STONE.sand;ctx.fillRect(0,0,width,height);
 const edge=height*.14;ctx.fillStyle=STONE.brass;ctx.fillRect(0,0,width,edge);ctx.fillRect(0,height-edge,width,edge);
 ctx.fillStyle=STONE.terracotta;ctx.beginPath();ctx.moveTo(width*.18,height/2);ctx.lineTo(width/2,edge*1.5);ctx.lineTo(width*.82,height/2);ctx.lineTo(width/2,height-edge*1.5);ctx.closePath();ctx.fill();
 ctx.fillStyle=STONE.brassLight;ctx.beginPath();ctx.arc(width/2,height/2,height*.1,0,Math.PI*2);ctx.fill();
 for(const x of [0,width]){ctx.fillStyle=STONE.teal;ctx.beginPath();ctx.arc(x,height/2,height*.2,0,Math.PI*2);ctx.fill();}
 for(const g of [ctx,bump]){g.strokeStyle=g===ctx?'rgba(74,54,38,.9)':'#000';g.lineWidth=Math.max(2,width/128);g.beginPath();g.moveTo(0,edge);g.lineTo(width,edge);g.moveTo(0,height-edge);g.lineTo(width,height-edge);g.moveTo(1,edge);g.lineTo(1,height-edge);g.stroke();}
 const map=new THREE.CanvasTexture(canvas),bumpMap=new THREE.CanvasTexture(relief);
 for(const t of [map,bumpMap]){t.wrapS=THREE.RepeatWrapping;t.anisotropy=8;}map.colorSpace=THREE.SRGBColorSpace;bumpMap.colorSpace=THREE.NoColorSpace;
 return {map,bump:bumpMap};
}

/** A curled paper streamer lying on the floor: a ribbon coiled around a horizontal axis. */
function streamerGeometry():THREE.BufferGeometry {
 const segments=40,turns=2.4,length=.3,radius=.028,width=.02,positions:number[]=[],index:number[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments,theta=t*turns*Math.PI*2,x=t*length-length/2,r=radius*(.75+.25*Math.sin(t*Math.PI)),y=r*(1-Math.cos(theta)),z=r*Math.sin(theta);positions.push(x-width/2,y,z,x+width/2,y,z);if(i)index.push(i*2-2,i*2-1,i*2,i*2-1,i*2+1,i*2);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(index);geometry.computeVertexNormals();return geometry;
}

export function dressFestivalFloor(p:FestivalFloorPorts):void {
 const {root,owned,textures,props,garden,dressing,glows,low}=p;
 const stone=(maps:{map:THREE.Texture;bump:THREE.Texture})=>{textures.add(maps.map);textures.add(maps.bump);const material=new THREE.MeshStandardMaterial({map:maps.map,bumpMap:maps.bump,bumpScale:1.4,roughness:.8,metalness:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});owned.add(material);return material;};
 // Inlaid medallion under the hero: drawn once, below the contact shadows and the light pool.
 const medallion=new THREE.Mesh(new THREE.CircleGeometry(ENDING_MEDALLION_RADIUS,128).rotateX(-Math.PI/2),stone(medallionMaps(low?1024:2048)));
 medallion.position.y=COURT+.008;medallion.receiveShadow=true;medallion.name='ending-medallion';root.add(medallion);
 // Garland band between the guest rings: the same stone language, so the floor holds together from above.
 const [inner,outer]=ENDING_GARLAND_BAND,blocks=36,segments=blocks*6,band=new THREE.RingGeometry(inner,outer,segments,1);
 const uv=band.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,(i%(segments+1))/segments*blocks,Math.floor(i/(segments+1)));
 const garland=new THREE.Mesh(band.rotateX(-Math.PI/2),stone(garlandMaps(low?256:512)));garland.position.y=COURT+.007;garland.receiveShadow=true;garland.name='ending-garland-band';root.add(garland);
 // Worn and sun-warmed patches break up the cobble between the inlays and the candelabra.
 const patch=radialSprite(64,0,[[0,1],[.5,.55],[1,0]]);textures.add(patch);
 const patchMaterial=new THREE.MeshBasicMaterial({alphaMap:patch,transparent:true,opacity:.16,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});owned.add(patchMaterial);
 const patchCount=low?54:80,patches=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),patchMaterial,patchCount),dark=new THREE.Color('#3b281a'),light=new THREE.Color('#b8743e');
 for(let i=0;i<patchCount;i++){const a=i*2.399963+hash(i,41),r=3.4+Math.pow(hash(i,42),.8)*9,s=1.1+hash(i,43)*2.2;patches.setMatrixAt(i,trs(Math.sin(a)*r,COURT+.004,Math.cos(a)*r,hash(i,44)*6.3,new THREE.Vector3(s,1,s*(.55+hash(i,45)*.45))));patches.setColorAt(i,i%3===0?light:dark);}
 patches.name='ending-floor-patches';root.add(patches);
 // Confetti: small paper pieces, densest on the dance floor round the hero, thinning out through the guest rings.
 const palette=['#ffd36e','#ff7d7d','#fff0cf','#ff9e5e','#5fd0bd','#ffb3cb','#ffd36e','#bf9bff'].map(c=>new THREE.Color(c));
 const paper=new THREE.MeshStandardMaterial({roughness:.6,metalness:0,side:THREE.DoubleSide});owned.add(paper);
 const count=low?640:900,confetti=new THREE.InstancedMesh(new THREE.PlaneGeometry(.07,.04).rotateX(-Math.PI/2),paper,count);
 for(let i=0;i<count;i++){
  const band=i%20,u=hash(i,1),a=i*2.399963+hash(i,2)*.6,r=band<10?.7+Math.pow(u,.85)*2.7:band<17?3.4+u*4.2:7.6+u*2.6;
  const pitch=(hash(i,3)-.5)*1.3,roll=(hash(i,4)-.5)*1.3,lift=.04*.5*Math.max(Math.abs(Math.sin(pitch)),Math.abs(Math.sin(roll)));
  confetti.setMatrixAt(i,trs(Math.sin(a)*r,COURT+.012+lift+hash(i,5)*.006,Math.cos(a)*r,hash(i,6)*Math.PI*2,.85+hash(i,7)*.5,pitch,roll));
  confetti.setColorAt(i,palette[i%palette.length]);
 }
 confetti.name='ending-confetti';confetti.receiveShadow=true;root.add(confetti);
 const streamers=low?48:72,coil=new THREE.InstancedMesh(streamerGeometry(),paper,streamers);
 for(let i=0;i<streamers;i++){const u=hash(i,11),a=i*2.399963+1.9,r=i%3?.9+u*2.5:3.4+u*4.4;coil.setMatrixAt(i,trs(Math.sin(a)*r,COURT+.01,Math.cos(a)*r,hash(i,12)*Math.PI*2,.85+hash(i,13)*.6));coil.setColorAt(i,palette[(i*3+1)%palette.length]);}
 coil.name='ending-streamers';coil.receiveShadow=true;root.add(coil);
 // Petals tossed onto the dance floor and among the guests land every which way; tilted, they catch light from a low camera.
 for(let i=0,n=low?150:230;i<n;i++){const a=i*2.399963+.4,inside=i%3!==2,r=inside?.8+Math.pow(hash(i,21),.8)*2.6:3.4+hash(i,21)*4.2;garden.add(`Petal_${i%5+1}`,trs(Math.sin(a)*r,COURT+.02,Math.cos(a)*r,hash(i,22)*6.3,(inside?.14:.18)+hash(i,23)*.1,(hash(i,24)-.5)*.9,(hash(i,25)-.5)*.9));}
 // Single flowers thrown at the hero's feet, lying on their side.
 for(let i=0;i<14;i++){const a=i*2.399963+.9,r=1.3+hash(i,31)*2.1;garden.add(i%2?'Flower_3_Single':'Flower_4_Single',trs(Math.sin(a)*r,COURT+.04,Math.cos(a)*r,hash(i,32)*6.3,.16+hash(i,33)*.04,Math.PI/2-.12,(hash(i,34)-.5)*.5));}
 // Offerings just outside the guest rings: floor candles, and buckets and vases of flowers, between the candelabra.
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6,r=7.75,x=Math.sin(angle)*r,z=Math.cos(angle)*r,yaw=angle+Math.PI;
  if(i%2===0){
   for(const [dx,dz,name,s] of [[0,0,'Candle_2',1.1],[.16,.1,'Candle_1',1.2],[-.12,.15,'Candle_1',1],[.05,-.17,'Candle_2',.85]] as const){
    const cx=x+dx*Math.cos(angle)+dz*Math.sin(angle),cz=z-dx*Math.sin(angle)+dz*Math.cos(angle);dressing.add(name,trs(cx,COURT,cz,yaw+dx*4,s));
    glows.push({pos:new THREE.Vector3(cx,COURT+props.get(name).box.max.y*s+.03,cz),color:new THREE.Color('#ffc477'),size:.32,kind:'candle'});
   }
  }else if(i%4===1){dressing.add('Bucket_Wooden_1',trs(x,COURT,z,yaw,1.15));garden.add('Flower_4_Group',trs(x,COURT+props.get('Bucket_Wooden_1').box.max.y*1.15-.12,z,yaw,.32));garden.add('Flower_3_Single',trs(x+.35,COURT+.04,z-.2,yaw+1,.18,Math.PI/2-.12,0));}
  else{dressing.add('Vase_4',trs(x,COURT,z,yaw,1.1));garden.add('Flower_3_Group',trs(x,COURT+props.get('Vase_4').box.max.y*1.1-.1,z,yaw,.26));}
 }
}
