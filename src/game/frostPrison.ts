import * as THREE from 'three';
import {crystalCluster,crystalGeometry,type Crystal} from './iceCrystals';
import {frostFire,type FireSet} from './frostFire';
import {Masonry,masonryMaterial,ringWarp} from './frostMasonry';

/*
 * Mira's prison: a cage Boreas grew out of the arena ice. Bars of crystal rise from a carved granite ring, lean in
 * and meet overhead like claws, under a small crown; rime grows round the foot, a rune ring glows in the stone and
 * the cold light inside keeps the friend in view. Built into the island's `mira-ice-prison` group (local space,
 * the group sits on the arena floor), so hiding the group after the rescue hides all of it.
 */

export interface MiraPrison {
 update(time:number):void;
}

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

export function miraPrison(group:THREE.Group,ice:THREE.Material):MiraPrison {
 const rand=stream(6262),M=new Masonry(rand),bars:Crystal[]=[];
 // The stone shader reads world heights: the frost line sits at the group's floor.
 M.ground=group.position.y;M.snow=.25;
 // The plinth: two courses of curved blocks, a darker sill on top, and the floor inside.
 const R=2.75;
 M.face(ringWarp(0,0,R,0),0,2*Math.PI*R,-.12,.42,{len:1.5,course:.27,depth:.55,curve:.45});
 M.face(ringWarp(0,0,R-.25,.3),0,2*Math.PI*(R-.25),.42,.58,{len:1.2,course:.16,depth:.5,curve:.45,core:0});
 M.disc(0,.5,0,R-.6,28,M.tint(.75));
 // Bars: each a column of ice from the ring and a claw that leans in to meet the others overhead.
 const n=10,top=new THREE.Vector3(0,4.75,0);
 for(let i=0;i<n;i++){
  const a=(i+.5)/n*Math.PI*2+(rand()-.5)*.08,r=2.05,x=Math.sin(a)*r,z=Math.cos(a)*r;
  const h1=2.5+rand()*.35;
  bars.push({x,y:.45,z,axis:[-Math.sin(a)*.06,1,-Math.cos(a)*.06],height:h1+.5,radius:.19+rand()*.03,seed:rand()*97});
  const sx=x*.94,sy=.45+h1,sz=z*.94,dx=top.x-sx,dy=top.y-sy,dz=top.z-sz,l=Math.hypot(dx,dy,dz);
  bars.push({x:sx,y:sy,z:sz,axis:[dx/l,dy/l,dz/l],height:l*(.92+rand()*.1),radius:.15+rand()*.03,seed:rand()*97});
  // Rime at the foot, outside the bar.
  crystalCluster(Math.sin(a)*2.55,.35,Math.cos(a)*2.55,.55+rand()*.5,.4,3,rand,bars);
 }
 crystalCluster(0,4.45,0,1.7,.95,6,rand,bars);
 for(let i=0;i<6;i++){const a=i/6*Math.PI*2+.4,d=3.05+rand()*.4;crystalCluster(Math.sin(a)*d,-.05,Math.cos(a)*d,.6+rand()*.9,.7,4,rand,bars);}
 // The rune ring in the sill and the snowflake in the floor, lit from within.
 const pos:number[]=[],col:number[]=[],teal=[.3,1.5,1.35];
 const seg=(x0:number,z0:number,x1:number,z1:number,w:number,y:number,k=1)=>{const dx=x1-x0,dz=z1-z0,l=Math.hypot(dx,dz),nx=-dz/l*w/2,nz=dx/l*w/2;
  for(const [x,z] of [[x0+nx,z0+nz],[x1+nx,z1+nz],[x1-nx,z1-nz],[x0+nx,z0+nz],[x1-nx,z1-nz],[x0-nx,z0-nz]]){pos.push(x,y,z);col.push(teal[0]*k,teal[1]*k,teal[2]*k);}};
 for(let k=0;k<48;k++){const a0=k/48*Math.PI*2,a1=(k+1)/48*Math.PI*2,r=R-.38;seg(Math.sin(a0)*r,Math.cos(a0)*r,Math.sin(a1)*r,Math.cos(a1)*r,.05,.595);}
 for(let k=0;k<6;k++){const a=k*Math.PI/3,c=Math.cos(a),s=Math.sin(a);seg(c*.2,s*.2,c*1.5,s*1.5,.06,.51,.8);
  for(const f of [.55,.85]){const bx=c*1.5*f,bz=s*1.5*f;for(const sg of [-1,1]){const b=a+sg*.8;seg(bx,bz,bx+Math.cos(b)*.32,bz+Math.sin(b)*.32,.05,.51,.8);}}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
 const runes=new THREE.Mesh(g,new THREE.MeshBasicMaterial({name:'mira-prison-runes',vertexColors:true,side:THREE.DoubleSide,fog:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));runes.name='mira-prison-runes';
 const stone=new THREE.Mesh(M.geometry(),masonryMaterial('mira-prison-stone'));stone.name='mira-prison-stone';stone.castShadow=stone.receiveShadow=true;
 const cage=new THREE.Mesh(crystalGeometry(bars),ice);cage.name='mira-prison-bars';cage.castShadow=true;
 // Cold light held inside the cage.
 const fire:FireSet=frostFire('mira-prison-light',[],[{x:0,y:1.6,z:0,size:5.5,color:'#4fe6cc',power:.28},{x:0,y:4.5,z:0,size:2.6,color:'#9ad8ff',power:.5}],77);
 group.add(stone,cage,runes,fire.group);
 group.userData.prison={bars:n,crystals:bars.length,blocks:M.blocks};
 return {update(time){fire.update(time);}};
}
