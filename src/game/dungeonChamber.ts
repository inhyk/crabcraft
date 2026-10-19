import * as THREE from 'three';
import {DUNGEON_CHAMBER,DUNGEON_CAPTAIN_SCALE,type DungeonConfig,type DungeonHazard} from '../sim/data/dungeons.ts';

/** The one expedition chamber, at the same place for the browser run and the server run Area. */
export const CHAMBER=Object.freeze({X:DUNGEON_CHAMBER.x,Z:DUNGEON_CHAMBER.z,Y:DUNGEON_CHAMBER.y,R:DUNGEON_CHAMBER.radius});
export const CAPTAIN_SCALE=DUNGEON_CAPTAIN_SCALE;
const {X,Z,Y,R}=CHAMBER;

export interface ChamberGround {
  heightAt(x:number,z:number):number;
  resolveCollision(x:number,z:number,r:number,out:THREE.Vector2):THREE.Vector2;
  raycastSolid(from:THREE.Vector3,to:THREE.Vector3):number|null;
}
/** The chamber floor and wall inside its R+8 footprint; the outside world keeps its own terrain, collision and rays. */
export function chamberGround(outside:ChamberGround):ChamberGround {
  return {
    heightAt:(x,z)=>Math.hypot(x-X,z-Z)<R+8?Y:outside.heightAt(x,z),
    resolveCollision:(x,z,r,out)=>{const dx=x-X,dz=z-Z,d=Math.hypot(dx,dz);if(d<R+8){const k=Math.min(1,(R-r-.25)/Math.max(.001,d));return out.set(X+dx*k,Z+dz*k);}return outside.resolveCollision(x,z,r,out);},
    raycastSolid:(a,b)=>a.y>Y-2&&Math.hypot(a.x-X,a.z-Z)<R+8?null:outside.raycastSolid(a,b),
  };
}

function disposeTree(group:THREE.Group){group.traverse(o=>{if(o instanceof THREE.Mesh){if(o instanceof THREE.InstancedMesh)o.dispose();o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});group.clear();}

/**
 * Pure presentation of the chamber: its architecture for one tier and the red hazard warning. It reads only what it is
 * given (a tier, a hazard list with its key, a clock for the pulse) and never moves, damages or rewards anyone.
 */
export class DungeonChamberView {
  readonly root=new THREE.Group();
  readonly warning=new THREE.Group();
  private warningKey='';
  constructor(private readonly scene:THREE.Object3D){this.root.name='dungeon-chamber';this.root.visible=false;scene.add(this.root);this.root.add(this.warning);}
  set visible(value:boolean){this.root.visible=value;}
  get visible():boolean{return this.root.visible;}
  /** Forget the drawn warning so the next showWarning() rebuilds it. */
  resetWarning(){this.warningKey='';}
  build(d:DungeonConfig){
    this.root.remove(this.warning);disposeTree(this.root);this.root.add(this.warning);
    const stone=new THREE.MeshStandardMaterial({color:d.chapter===6?0x234b42:d.chapter===5?0x49312c:d.chapter===4?0x253f56:0x343044,roughness:.82,metalness:.25});
    const trim=new THREE.MeshStandardMaterial({color:d.color,emissive:d.color,emissiveIntensity:.5,metalness:.65,roughness:.3});
    const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat.clone());m.position.set(X+x,Y+y,Z+z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
    const shellMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(d.color).multiplyScalar(.075),side:THREE.BackSide});
    const shell=add(new THREE.SphereGeometry(55,32,16),shellMaterial,0,4,0);shellMaterial.dispose();shell.castShadow=false;shell.receiveShadow=false;
    const floor=add(new THREE.CylinderGeometry(R+1,R+1,1,64),stone,0,-.52,0);floor.name='dungeon-floor';
    for(let i=0;i<4;i++){const r=4+i*4;const m=add(new THREE.TorusGeometry(r,.035,4,80),trim,0,.06,0);m.rotation.x=Math.PI/2;}
    const cells:[number,number][]=[];
    for(let x=-7;x<=7;x++)for(let z=-7;z<=7;z++)if(Math.hypot(x*2.35,z*2.35)<R-1.7)cells.push([x,z]);
    const paving=new THREE.InstancedMesh(new THREE.BoxGeometry(2.28,.05,2.28),stone.clone(),cells.length),matrix=new THREE.Matrix4();
    for(const [i,[x,z]]of cells.entries()){matrix.makeTranslation(X+x*2.35,Y,Z+z*2.35);paving.setMatrixAt(i,matrix);paving.setColorAt(i,new THREE.Color().setHSL(d.chapter===6?.42:d.chapter===5?.06:d.chapter===4?.57:.7,.12,.65+((x*17+z*13+1234)%7)*.025));}
    paving.receiveShadow=true;this.root.add(paving);
    // Luminous radial inlays stay above the paving, with intentional grout between slabs.
    for(let i=0;i<12;i++){const a=i*Math.PI/6;const m=add(new THREE.BoxGeometry(.08,.035,R-1),trim,Math.sin(a)*(R-1)/2,.04,Math.cos(a)*(R-1)/2);m.rotation.y=a;}
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,x=Math.sin(a)*(R+1),z=Math.cos(a)*(R+1);
      add(new THREE.CylinderGeometry(.65,.9,.7,6),stone,x,.35,z);
      add(new THREE.CylinderGeometry(.38,.5,5.5,6),stone,x,3.3,z);
      const crystal=add(new THREE.OctahedronGeometry(.65),trim,x,6.5,z);crystal.rotation.y=a;
      const wall=add(new THREE.BoxGeometry(9.6,2.5,.6),stone,Math.sin(a+Math.PI/12)*(R+.7),1.25,Math.cos(a+Math.PI/12)*(R+.7));wall.rotation.y=a+Math.PI/12;
      const rail=add(new THREE.BoxGeometry(9.6,.1,.7),trim,wall.position.x-X,2.55,wall.position.z-Z);rail.rotation.y=wall.rotation.y;
    }
    for(const x of [-10,10]){const light=new THREE.PointLight(d.color,50,30,2);light.position.set(X+x,Y+6,Z);this.root.add(light);}
    const center=add(new THREE.TorusGeometry(2.3,.12,5,32),trim,0,.08,0);center.rotation.x=Math.PI/2;
    stone.dispose();trim.dispose();
  }
  /** One hazard set per key (run and hazard serial); the pulse follows the given clock. */
  showWarning(visible:boolean,key:string,hazards:()=>readonly DungeonHazard[],clock:number){
    this.warning.visible=visible;if(!visible)return;
    if(key!==this.warningKey){
      this.warningKey=key;disposeTree(this.warning);
      const material=new THREE.MeshBasicMaterial({color:0xff4d59,transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide});
      const add=(geo:THREE.BufferGeometry,x=0,z=0,yaw=0)=>{const m=new THREE.Mesh(geo,material.clone());m.rotation.set(-Math.PI/2,0,-yaw);m.position.set(X+x,Y+.16,Z+z);m.renderOrder=8;this.warning.add(m);};
      for(const h of hazards())add(h.shape==='rect'?new THREE.PlaneGeometry(h.width,h.depth):h.shape==='ring'?new THREE.RingGeometry(h.inner??0,h.radius,80):new THREE.CircleGeometry(h.radius,64),h.x,h.z,h.shape==='rect'?h.yaw:0);
      material.dispose();
    }
    for(const o of this.warning.children)if(o instanceof THREE.Mesh)(o.material as THREE.MeshBasicMaterial).opacity=.32+.16*Math.sin(clock*9)**2;
  }
  dispose(){disposeTree(this.warning);disposeTree(this.root);this.scene.remove(this.root);}
}
