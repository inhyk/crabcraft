// Conservative animated geometry bounds, built from rigid one-bone skinning and gear meshes.
// Each bone's (or rigid mesh's) local vertices are split into a 4x4x4 grid of boxes, transformed
// every frame; together they enclose every vertex without the empty corners a single box of a
// long claw or a wide shell sweeps once it turns.
import * as THREE from 'three';

function gridBoxes(points) {
  const bb = new THREE.Box3().setFromPoints(points), size = new THREE.Vector3().subVectors(bb.max, bb.min), cells = new Map();
  const cell = (x, lo, s) => Math.min(3, Math.floor(4 * (x - lo) / Math.max(s, 1e-9)));
  for (const p of points) {
    const key = cell(p.x, bb.min.x, size.x) * 16 + cell(p.y, bb.min.y, size.y) * 4 + cell(p.z, bb.min.z, size.z);
    if (!cells.has(key)) cells.set(key, new THREE.Box3());
    cells.get(key).expandByPoint(p);
  }
  return [...cells.values()];
}

export function installAudit(api) {
  const v = new THREE.Vector3();
  const models = api.crowd.crabs.map(c => {
    const clouds = new Map();
    const add = (node, p) => { if (!clouds.has(node)) clouds.set(node, []); clouds.get(node).push(p); };
    c.rig.root.updateMatrixWorld(true);
    c.rig.root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || /-lod|shadow/.test(mesh.name)) return;
      const pos = mesh.geometry.attributes.position;
      if (mesh.isSkinnedMesh) {
        const skin = mesh.geometry.attributes.skinIndex;
        for (let i=0; i<pos.count; i++) {
          const bi = skin.getX(i);
          add(mesh.skeleton.bones[bi], new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[bi]));
        }
      } else {
        for (let i=0; i<pos.count; i++) add(mesh, new THREE.Vector3().fromBufferAttribute(pos,i));
      }
    });
    const parts = [];
    for (const [node, points] of clouds) for (const box of gridBoxes(points)) parts.push([node, box]);
    return {c,parts,previous:null};
  });
  const corners = box => {
    const a=[];
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) a.push(new THREE.Vector3(x,y,z));
    return a;
  };
  for(const m of models) m.parts=m.parts.map(([node,box])=>({node,points:corners(box)}));
  api.auditFrame=()=>{
    const camera=api.camera;
    camera.updateMatrixWorld();
    const bodies=[];
    let maxBodyStep=0,maxBodyStepNormalized=0,maxTurn=0,frameMargin=Infinity;
    for(const m of models){
      const {c}=m;c.rig.root.updateMatrixWorld(true);
      const box=new THREE.Box3(),parts=[];
      for(const {node,points} of m.parts){
        const part=new THREE.Box3();
        for(const p of points) part.expandByPoint(v.copy(p).applyMatrix4(node.matrixWorld));
        part.node=node;parts.push(part);box.union(part);
      }
      const pos=c.rig.body.getWorldPosition(new THREE.Vector3());
      const rot=c.rig.body.getWorldQuaternion(new THREE.Quaternion());
      if(m.previous){const step=pos.distanceTo(m.previous.pos);maxBodyStep=Math.max(maxBodyStep,step);maxBodyStepNormalized=Math.max(maxBodyStepNormalized,step/(c.rig.look?.posture.scale??1));maxTurn=Math.max(maxTurn,rot.angleTo(m.previous.rot)*180/Math.PI)}
      m.previous={pos,rot};
      const screen={min:[Infinity,Infinity],max:[-Infinity,-Infinity]};
      for(const p of corners(box)){
        p.project(camera);const x=(p.x+1)*540,y=(1-p.y)*960;
        screen.min[0]=Math.min(screen.min[0],x);screen.min[1]=Math.min(screen.min[1],y);
        screen.max[0]=Math.max(screen.max[0],x);screen.max[1]=Math.max(screen.max[1],y);
      }
      bodies.push({box,parts,screen,pos:pos.toArray()});
      frameMargin=Math.min(frameMargin,screen.min[0],screen.min[1],1080-screen.max[0],1920-screen.max[1]);
    }
    // Contact is measured between the crabs' part boxes (one box per bone or gear mesh); the
    // whole-crab boxes overlap whenever two neighbours' legs or claws share an axis range.
    const boxGap=(a,b)=>Math.hypot(Math.max(0,a.min.x-b.max.x,b.min.x-a.max.x),Math.max(0,a.min.y-b.max.y,b.min.y-a.max.y),Math.max(0,a.min.z-b.max.z,b.min.z-a.max.z));
    let minWorldGap=Infinity,minHullGap=Infinity,maxScreenOverlap=0,minScreenGap=Infinity;
    const pairs=[];
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
      const a=bodies[i],b=bodies[j];
      const dx=Math.max(0,a.box.min.x-b.box.max.x,b.box.min.x-a.box.max.x);
      const dy=Math.max(0,a.box.min.y-b.box.max.y,b.box.min.y-a.box.max.y);
      const dz=Math.max(0,a.box.min.z-b.box.max.z,b.box.min.z-a.box.max.z);
      const hull=Math.hypot(dx,dy,dz);minHullGap=Math.min(minHullGap,hull);
      let gap=hull;
      let touch=null;
      if(hull===0){gap=Infinity;for(const p of a.parts)if(boxGap(p,b.box)<gap)for(const q of b.parts){const g=boxGap(p,q);if(g<gap){gap=g;touch=[p.node.name,q.node.name]}}}
      minWorldGap=Math.min(minWorldGap,gap);
      const sx=Math.min(a.screen.max[0],b.screen.max[0])-Math.max(a.screen.min[0],b.screen.min[0]);
      const sy=Math.min(a.screen.max[1],b.screen.max[1])-Math.max(a.screen.min[1],b.screen.min[1]);
      const area=s=>Math.max(1,(s.max[0]-s.min[0])*(s.max[1]-s.min[1]));
      const overlap=Math.max(0,sx)*Math.max(0,sy)/Math.min(area(a.screen),area(b.screen));
      maxScreenOverlap=Math.max(maxScreenOverlap,overlap);
      minScreenGap=Math.min(minScreenGap,Math.hypot(Math.max(0,-sx),Math.max(0,-sy)));
      if(gap<0.01)pairs.push([i,j,+gap.toFixed(3),+overlap.toFixed(3),touch]);
    }
    return {t:api.time,maxBodyStep,maxBodyStepNormalized,maxTurn,frameMargin,minWorldGap:Number.isFinite(minWorldGap)?minWorldGap:null,
      minHullGap:Number.isFinite(minHullGap)?minHullGap:null,
      maxScreenOverlap,minScreenGap:Number.isFinite(minScreenGap)?minScreenGap:null,pairs,
      bodies:bodies.map(b=>({pos:b.pos,screen:b.screen})),terrain:api.crowd.terrainAudit};
  };
  return {actors:models.length,parts:models.map(m=>m.parts.length)};
}
