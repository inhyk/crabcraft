import * as THREE from 'three';
import type { Collision } from '../world/collision';
import {facetedStarCrystal,starCrystalRadius} from './starCrystal';
import {starCrystalCluster,starCrystalMaterial} from './starCrystals';

/** Moonshade's six crystal leaves around the glade. */
export function moonshadeLeaves(){
  return Array.from({length:6},(_,i)=>{
    const a=i/6*Math.PI*2,x=-75+Math.cos(a)*7.7,z=-35+Math.sin(a)*7.7,h=3.5+(i%3)*1.1;
    return {x,z,h,rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a)*.12,a,Math.cos(a)*.12)),scale:new THREE.Vector3(1.1,h,.85)};
  });
}
const SANCTUARY_PILLARS=[[0,-4.8,-55],[1,4.8,-55],[2,-8,-47],[3,8,-47]] as const;

/** Crystal leaves and sanctuary pillars block movement; the glade and the arch stay open. */
export function registerStarLandmarks(height:(x:number,z:number)=>number,collision:Collision){
  const geometry=facetedStarCrystal();
  for(const {x,z,h,rotation,scale} of moonshadeLeaves())collision.addCircle(x,z,Math.max(1.2,starCrystalRadius(geometry,scale,rotation)),height(x,z),height(x,z)+h*1.7);
  geometry.dispose();
  for(const [,x,z] of SANCTUARY_PILLARS){const y=height(x,z);collision.addCircle(x,z,1,y,y+6.4);}
}

/** Distinct silhouettes at the three memories; the middle stays open for players and quest markers. */
export class StarLandmarks {
  readonly root=new THREE.Group();
  private astrolabe:THREE.Group;
  private mist:THREE.Points;

  constructor(height:(x:number,z:number)=>number){
    this.root.name='star-island-landmarks';
    const stone=new THREE.MeshStandardMaterial({color:'#686c83',roughness:.85,metalness:.15});
    const gold=new THREE.MeshStandardMaterial({color:'#d5b574',roughness:.4,metalness:.7});
    const cyan=new THREE.MeshStandardMaterial({color:'#92e3e2',emissive:'#238c9a',emissiveIntensity:1.3,metalness:.4,roughness:.3});
    const violet=new THREE.MeshStandardMaterial({color:'#b29bea',emissive:'#6644a6',emissiveIntensity:1.5,metalness:.5,roughness:.3});
    const matrix=new THREE.Matrix4();
    const place=(mesh:THREE.Mesh,x:number,y:number,z:number)=>{mesh.position.set(x,y,z);this.root.add(mesh);return mesh;};
    // A low medallion at each landmark anchors its floating memory above the ground.
    for(const [x,z] of [[-75,-35],[80,-40],[0,-48]]){
      const y=height(x,z);
      const floor=place(new THREE.Mesh(new THREE.CylinderGeometry(5.2,5.4,.18,48),stone),x,y-.06,z);floor.receiveShadow=true;
      const border=place(new THREE.Mesh(new THREE.TorusGeometry(5,.05,5,64),gold),x,y+.055,z);border.rotation.x=-Math.PI/2;
    }
    // Moonshade: six enormous blue crystal leaves frame a quiet, walkable glade.
    const crystals=new THREE.InstancedMesh(starCrystalCluster(),starCrystalMaterial('moonshade',{ground:-.55}),6);crystals.name='moonshade-crystal-leaves';
    moonshadeLeaves().forEach(({x,z,h,rotation,scale},i)=>{
      matrix.compose(new THREE.Vector3(x,height(x,z)+h*.55,z),rotation,scale);crystals.setMatrixAt(i,matrix);
    });
    crystals.castShadow=true;this.root.add(crystals);
    // Memory Sanctuary: its piers and carved arch are the sanctum's pilgrims' gate (starSanctum.ts).
    // Fallen Star Observatory: an antique celestial instrument above the ruined reflecting pool.
    this.astrolabe=new THREE.Group();this.astrolabe.position.set(80,height(80,-40)+6.5,-40);this.root.add(this.astrolabe);
    for(const [i,r] of [4.2,3.5,2.6].entries()){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.075,6,72),i===1?cyan:gold);ring.rotation.set(i*.7,.4+i*.9,i*.55);this.astrolabe.add(ring);
    }
    const globe=new THREE.Mesh(new THREE.IcosahedronGeometry(.85,1),violet);this.astrolabe.add(globe);
    const stars=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.14),violet,12);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;stars.setMatrixAt(i,new THREE.Matrix4().makeTranslation(Math.cos(a)*4.2,Math.sin(a)*4.2,0));}this.astrolabe.add(stars);
    // Sparse luminous spores give the western clearing motion without hiding the ground.
    const points=new Float32Array(72*3);
    for(let i=0;i<72;i++){const a=i*2.39996,r=2+(i*17%60)/10,x=-75+Math.cos(a)*r,z=-35+Math.sin(a)*r;points.set([x,height(x,z)+.6+(i*13%40)/10,z],i*3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(points,3));
    this.mist=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#a6ffea',size:.07,transparent:true,opacity:.65,depthWrite:false}));this.root.add(this.mist);
  }

  update(time:number){
    this.astrolabe.rotation.y=time*.045;this.astrolabe.rotation.z=Math.sin(time*.15)*.08;
    this.mist.position.y=Math.sin(time*.4)*.18;
  }
}
