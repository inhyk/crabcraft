import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {snowFountainBasin} from '../src/game/snowFountain';
import {fountainJetPoints,fountainSpillPoints} from '../src/game/tidecrown/fountainGeometry';
import {polygonSolids,TC_LANDMARKS} from '../src/game/tidecrown/cityPlan';

test('frozen fountain has visible outer stone and a continuous upward-facing rim from every side',()=>{
 const geo=snowFountainBasin(),m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));m.updateMatrixWorld();
 for(let i=0;i<56;i++){
  const a=(i+.5)/56*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
  const wall=new THREE.Raycaster(new THREE.Vector3(c*5,.4,s*5),new THREE.Vector3(-c,0,-s));
  assert.ok(wall.intersectObject(m).length,`missing wall at ${i}`);
  const lip=new THREE.Raycaster(new THREE.Vector3(c*2.75,3,s*2.75),new THREE.Vector3(0,-1,0));
  assert.ok(lip.intersectObject(m).length,`missing rim at ${i}`);
 }
 geo.dispose();
});
test('all eight fountain jets and sixteen overflows land on the lower pool instead of hanging in midair',()=>{
 for(let i=0;i<8;i++){
  const a=(i+.5)/8*Math.PI*2,points=fountainJetPoints(Math.cos(a)*1.95,Math.sin(a)*1.95),last=points.at(-1)!;
  assert.equal(points[0].y,1.55);assert.ok(Math.abs(last.y-.85)<1e-8);assert.ok(Math.hypot(last.x,last.z)<6.3);
  const peak=points.findIndex(p=>p.y===Math.max(...points.map(p=>p.y)));assert.ok(peak>0&&peak<points.length-1);
  for(let j=peak+1;j<points.length;j++)assert.ok(points[j].y<points[j-1].y);
 }
 for(let i=0;i<16;i++){const p=fountainSpillPoints(i/16*Math.PI*2);assert.equal(p[0].y,2.66);assert.ok(Math.abs(p.at(-1)!.y-.85)<1e-8);}
});
test('overlapping footprint boxes match octagonal and round masonry without invisible square corners',()=>{
 for(const sides of [8,32]){
  const R=7.38,boxes=polygonSolids(R,sides,-1,3),apo=R*Math.cos(Math.PI/sides);
  for(let x=-8;x<=8;x+=.137)for(let z=-8;z<=8;z+=.151){
   const inside=Array.from({length:sides},(_,i)=>x*Math.cos(i*2*Math.PI/sides)+z*Math.sin(i*2*Math.PI/sides)<=apo+1e-8).every(Boolean);
   const solid=boxes.some(([,,hx,hz,,,a=0])=>Math.abs(x*Math.cos(a)-z*Math.sin(a))<=hx+1e-8&&Math.abs(x*Math.sin(a)+z*Math.cos(a))<=hz+1e-8);
   assert.equal(solid,inside,`${sides}-gon ${x},${z}`);
  }
 }
 assert.equal(TC_LANDMARKS.filter(l=>l.piece==='TC_Fountain').length,2);
 assert.equal(TC_LANDMARKS.filter(l=>l.piece==='TC_SeaglassTower').length,3);
});
