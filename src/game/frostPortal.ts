import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {trs} from '../world/kit';
import {driftBank,driftMaterial,frostStone,noise3,runeMaterial,runeQuad,shade,stream} from './frostCraft';
import {FROST_PIER_X} from './frostPropsLayout';
import {type Crystal,crystalCluster,crystalGeometry} from './iceCrystals';

/*
 * Frostlight's gateways: a carved granite arch of eleven voussoirs on two piers over a low round dais, its faces cut
 * with aurora runes and the keystone with the same seal as the aurora stones (frostRequests.ts). Snow pillows along
 * the extrados and drifts round the dais, icicles hang from the intrados, ice grows at the piers' feet, and the
 * opening holds a curtain of aurora that flows like the sky's. Same footprint and travel point as StarPortal.
 */

export interface FrostPortalOptions {
 /** The island's grown ice (iceCrystals.ts). */
 ice:THREE.Material;
 /** World ground height, for the drift round the dais. */
 height:(x:number,z:number)=>number;
}

/** Arch frame: springing line, centre-line radii, ring thickness, depth. */
const SPRING=2.3,RX=FROST_PIER_X,RY=2.95,RING=.9,DEPTH=1.0,DAIS=.3;
const BEVEL={bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:1};

const MIST_VERT=/* glsl */`
varying vec2 vP;
#include <fog_pars_vertex>
void main(){vP=position.xy;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const MIST_FRAG=/* glsl */`
uniform float uTime;
uniform vec4 uOpening; // half width, springing, rise of the arch, sill
varying vec2 vP;
#include <fog_pars_fragment>
float mh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float mn(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(mh(i),mh(i+vec2(1,0)),u.x),mix(mh(i+vec2(0,1)),mh(i+vec2(1,1)),u.x),u.y);}
void main(){
 // Distance inside the opening, 0 at the stone: the pier faces below the springing, the intrados above.
 float hw=uOpening.x,x=vP.x,y=vP.y-uOpening.w;
 float e=y<uOpening.y-uOpening.w?hw-abs(x):(1.-length(vec2(x/hw,(vP.y-uOpening.y)/uOpening.z)))*hw;
 e=min(e,y);
 float t=uTime;
 // Curtains: folded rays that drift sideways and ripple, brightest at their lower hem, as in the sky.
 float fold=x*1.1+sin(y*.6+t*.25)*.9+mn(vec2(x*.7,t*.1))*1.6;
 float rays=pow(.5+.5*sin(fold*5.5+t*.6),3.)*.7+mn(vec2(fold*3.,y*.4-t*.5))*.5;
 float hem=smoothstep(.0,.9,y)*exp(-max(y-1.2,0.)*.32);
 vec3 c=mix(vec3(.12,1.,.6),vec3(.2,.75,1.),smoothstep(.8,3.2,y+sin(x+t*.3)*.4));
 c=mix(c,vec3(.55,.35,1.),smoothstep(3.,4.6,y));
 float a=(rays*.55+.18)*hem*smoothstep(0.,.55,e);
 // A bright seam where the aurora meets the stone, so the opening reads as held by the arch.
 a+=exp(-e*7.)*smoothstep(0.,.08,e)*.55;
 gl_FragColor=vec4(c*a*1.6,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #endif
 #endif
}`;
const MOTE_VERT=/* glsl */`
attribute vec3 aMote; // x angle, y speed, z seed
uniform float uTime;
uniform float uPx;
uniform vec4 uOpening;
varying float vA;
#include <fog_pars_vertex>
void main(){
 // Motes drawn into the opening along a slow spiral, born at the rim, gone at the heart.
 float life=fract(uTime*aMote.y+aMote.z),a=aMote.x+life*2.4,r=1.-life;
 vec3 p=vec3(cos(a)*r*uOpening.x*.92,uOpening.y+sin(a)*r*(uOpening.y-uOpening.w)*.95,sin(aMote.z*40.)*.35*r);
 p.y=max(p.y,uOpening.w+.1);
 vec4 mvPosition=modelViewMatrix*vec4(p,1.);
 vA=smoothstep(0.,.2,life)*(1.-smoothstep(.75,1.,life));
 gl_PointSize=clamp(.07*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,24.);
 gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const MOTE_FRAG=/* glsl */`
varying float vA;
#include <fog_pars_fragment>
void main(){float r=length(gl_PointCoord-.5)*2.,a=exp(-r*r*5.)*vA;if(a<.01)discard;gl_FragColor=vec4(vec3(.7,1.,.95)*a*1.8,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #endif
 #endif
}`;

/** Point on the arch's ellipse at angle `a` (0 right springing, pi left), `k` from -1 (intrados) to 1 (extrados). */
function archPoint(a:number,k:number){const rx=RX+k*RING/2,ry=RY+k*RING/2;return new THREE.Vector2(Math.cos(a)*rx,SPRING+Math.sin(a)*ry);}

/** A dressed block: the polygon extruded through the arch's depth, edges bevelled. */
function block(points:THREE.Vector2[],depth:number){
 const g=new THREE.ExtrudeGeometry(new THREE.Shape(points),{depth:depth-.07,...BEVEL,curveSegments:1});
 g.translate(0,0,-(depth-.07)/2);g.deleteAttribute('uv');
 return g;
}
const rect=(x0:number,y0:number,x1:number,y1:number)=>[new THREE.Vector2(x0,y0),new THREE.Vector2(x1,y0),new THREE.Vector2(x1,y1),new THREE.Vector2(x0,y1)];

export class FrostPortal {
 readonly root=new THREE.Group();
 private mist:THREE.ShaderMaterial;
 private motes:THREE.ShaderMaterial;
 private runes:THREE.ShaderMaterial;
 constructor(position:THREE.Vector3,label:string,opts:FrostPortalOptions){
  this.root.position.copy(position);this.root.name=label;
  const R=stream(Math.round(position.x*131+position.z*17)),stone=frostStone({cover:.8,dark:'#3c4450',light:'#6e7783'});
  const blocks:THREE.BufferGeometry[]=[];
  // Dais: two low rings, the upper rim chamfered so it reads cut, not turned (profile from the foot up, so the faces
  // turn outward). Its floor is paved in rings and swept nearly clear, so the carved ring shows through the snow.
  const dais=new THREE.Mesh(shade(lathe([[4.02,-.35],[4.0,.1],[3.92,.15],[3.52,.17],[3.5,DAIS-.05],[3.42,DAIS],[0,DAIS]],72,.5)),frostStone({cover:.1,dark:'#2b323c',light:'#525b67',rings:.72}));
  dais.geometry.deleteAttribute('uv');dais.name='frostlight-portal-dais';dais.receiveShadow=true;this.root.add(dais);
  // Piers: plinth, two shaft courses and an impost that steps out under the springing.
  for(const s of [-1,1]){
   const cx=s*RX,b=(x0:number,y0:number,x1:number,y1:number,d:number)=>{const g=block(rect(cx+x0,y0,cx+x1,y1),d);blocks.push(g);};
   b(-.66,DAIS-.05,.66,DAIS+.42,1.32);
   b(-.5,DAIS+.43,.5,DAIS+1.08,1.06);b(-.5,DAIS+1.09,.5,SPRING-.34,1.06);
   b(-.64,SPRING-.33,.64,SPRING-.01,1.24);
  }
  // Voussoirs: eleven wedges with open joints; the keystone stands proud on both faces and above the ring.
  const N=11,joint=.012,runeGeos:THREE.BufferGeometry[]=[],ice:Crystal[]=[];
  for(let i=0;i<N;i++){
   const a0=i/N*Math.PI+joint,a1=(i+1)/N*Math.PI-joint,key=i===(N-1)/2,lift=key?.16:0;
   const pts:THREE.Vector2[]=[];
   for(let k=0;k<=3;k++)pts.push(archPoint(a0+(a1-a0)*k/3,-1-(key?.06:0)));
   for(let k=3;k>=0;k--){const p=archPoint(a0+(a1-a0)*k/3,1);pts.push(p.add(new THREE.Vector2(Math.cos(a0+(a1-a0)*k/3),Math.sin(a0+(a1-a0)*k/3)).multiplyScalar(lift)));}
   blocks.push(block(pts,DEPTH+(key?.16:0)));
   // A rune on each face, upright along the radius; the keystone carries the aurora seal.
   const am=(a0+a1)/2,c=archPoint(am,0),face=(DEPTH+(key?.16:0))/2+.002;
   for(const s of [1,-1]){
    const m=trs(c.x,c.y+(key?.06:0),s*face,s>0?0:Math.PI,1,0,0).multiply(new THREE.Matrix4().makeRotationZ((s>0?1:-1)*(am-Math.PI/2)));
    runeGeos.push(key?runeQuad(m,.7,.7,0,R()*9):runeQuad(m,.34,.54,1+(i+(s>0?0:3))%6,R()*9));
   }
   // Icicles under the intrados of the upper courses.
   if(am>.45&&am<Math.PI-.45)for(let k=0;k<5;k++){
    const t=a0+(a1-a0)*(k+.5)/5,p=archPoint(t,-1),z=(R()-.5)*DEPTH*.9,r=R();
    ice.push({x:p.x,y:p.y-.02,z,axis:[(R()-.5)*.08,-1,(R()-.5)*.08],height:.12+r*r*.55,radius:.025+R()*.03,seed:R()*97});
   }
  }
  // Ice grown at the piers' feet and leaning off the dais rim.
  for(const s of [-1,1])for(const f of [-1,1]){crystalCluster(s*(RX+.55),DAIS-.1,f*.75,.9+R()*.7,.45,3,R,ice);}
  for(let k=0;k<3;k++){const a=Math.PI*(.25+k*.75)+R()*.3,r=3.9;crystalCluster(Math.cos(a)*r,0,Math.sin(a)*r,.35+R()*.35,.3,2,R,ice);}
  const stoneGeo=mergeGeometries(blocks.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');return shade(n);}),false)!;
  const arch=new THREE.Mesh(stoneGeo,stone);arch.name='frostlight-portal-stone';arch.castShadow=arch.receiveShadow=true;this.root.add(arch);
  // Snow pillowed along the extrados, thinning to nothing toward the springing.
  const ridge:number[]=[],ridgeCol:number[]=[],idx:number[]=[],nA=48,nZ=8;
  for(let i=0;i<=nA;i++){
   const a=.28+(Math.PI-.56)*i/nA,p=archPoint(a,1),n=new THREE.Vector2(Math.cos(a)*(RY+RING/2),Math.sin(a)*(RX+RING/2)).normalize();
   const taper=Math.sin(Math.min(1,Math.sin(a)*1.25)*Math.PI/2),keyLift=Math.exp(-(((a-Math.PI/2)/.13)**2))*.16;
   for(let j=0;j<=nZ;j++){
    const z=(j/nZ*2-1)*(DEPTH/2+.06),u=z/(DEPTH/2+.06),th=(.07+.13*noise3(a*6,z*3,0,7))*taper*Math.pow(Math.max(0,1-u*u),.55);
    const q=p.clone().addScaledVector(n,keyLift+th-.02);
    ridge.push(q.x,q.y,z);const o=.85+.15*Math.pow(1-u*u,.5);ridgeCol.push(o,o,o);
   }
  }
  for(let i=0;i<nA;i++)for(let j=0;j<nZ;j++){const a=i*(nZ+1)+j,b=a+1,c=a+nZ+1,d=c+1;idx.push(a,c,b,b,c,d);}
  const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(ridge,3));rg.setAttribute('color',new THREE.Float32BufferAttribute(ridgeCol,3));rg.setIndex(idx);rg.computeVertexNormals();
  // The drift round the dais, in world space under the root.
  const o=position,dg=driftBank([{x:o.x,z:o.z,r:3.62}],opts.height,{reach:1.3,height:.2,seed:Math.round(o.x)}).geometry.translate(-o.x,-o.y,-o.z);
  const snow=new THREE.Mesh(mergeGeometries([rg,dg],false)!,driftMaterial());snow.name='frostlight-portal-snow';snow.castShadow=snow.receiveShadow=true;this.root.add(snow);
  const icicles=new THREE.Mesh(crystalGeometry(ice),opts.ice);icicles.name='frostlight-portal-ice';icicles.castShadow=true;this.root.add(icicles);
  // The floor ring carved round the travel point.
  runeGeos.push(runeQuad(new THREE.Matrix4().makeRotationX(-Math.PI/2).setPosition(0,DAIS+.004,0),6.5,6.5,7,R()*9));
  this.runes=runeMaterial();this.runes.uniforms.uGlow.value[0]=1;
  const rm=new THREE.Mesh(mergeGeometries(runeGeos,false)!,this.runes);rm.name='frostlight-portal-runes';rm.renderOrder=1;this.root.add(rm);
  // The aurora held in the opening.
  const hw=RX-.5,opening=new THREE.Vector4(hw,SPRING,RY-RING/2,DAIS);
  const shape=new THREE.Shape();shape.moveTo(-hw,DAIS);shape.lineTo(hw,DAIS);shape.lineTo(hw,SPRING);
  for(let k=1;k<=32;k++){const a=k/32*Math.PI;shape.lineTo(Math.cos(a)*hw,SPRING+Math.sin(a)*(RY-RING/2));}
  shape.lineTo(-hw,DAIS);
  this.mist=new THREE.ShaderMaterial({name:'frostlight-portal-aurora',vertexShader:MIST_VERT,fragmentShader:MIST_FRAG,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uOpening:{value:opening}}])});
  const mist=new THREE.Mesh(new THREE.ShapeGeometry(shape,1),this.mist);mist.name='frostlight-portal-aurora';mist.renderOrder=2;this.root.add(mist);
  const mg=new THREE.BufferGeometry(),mp=new Float32Array(60*3),ma=new Float32Array(60*3);
  for(let i=0;i<60;i++)ma.set([R()*Math.PI*2,.06+R()*.08,R()],i*3);
  mg.setAttribute('position',new THREE.BufferAttribute(mp,3));mg.setAttribute('aMote',new THREE.BufferAttribute(ma,3));
  this.motes=new THREE.ShaderMaterial({name:'frostlight-portal-motes',vertexShader:MOTE_VERT,fragmentShader:MOTE_FRAG,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uPx:{value:450},uOpening:{value:opening}}])});
  const motes=new THREE.Points(mg,this.motes);motes.name='frostlight-portal-motes';motes.frustumCulled=false;motes.renderOrder=3;this.root.add(motes);
  const buffer=new THREE.Vector2();motes.onBeforeRender=r=>{r.getDrawingBufferSize(buffer);this.motes.uniforms.uPx.value=buffer.y/2;};
  // One light, as StarPortal has, in the aurora's colour.
  const light=new THREE.PointLight('#9cf0e2',7,14,1.4);light.position.set(0,2.6,1.2);this.root.add(light);
  this.root.userData.frostPortal={voussoirs:N,runes:runeGeos.length,ice:ice.length};
 }
 update(time:number){this.mist.uniforms.uTime.value=time;this.motes.uniforms.uTime.value=time;this.runes.uniforms.uTime.value=time;}
}
