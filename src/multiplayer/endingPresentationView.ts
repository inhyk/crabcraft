import * as THREE from 'three';
import './endingPresentation.css';
import { EndingContactShadows } from './endingContactShadows';
import { t } from '../i18n';
import type { CrabRig } from '../crab/types';
import { rigCatalog } from '../sim/data/rig-catalog.ts';
import { evaluateRenderPoseRecipe, isRenderPoseRecipe, renderPoseProviderVersion } from '../sim/renderPose.ts';
import { applyNumericPose } from '../game/simUnitView.ts';
import type { EndingCast, EndingObservation } from '../sim/features/endingPresentation.ts';
import { BREAK_ROUTINE } from '../sim/data/actions.ts';
import notice from '../../NOTICE.md?raw';
import { parseNotice } from '../game/creditsRoll';
import { ENDING_BELL_TOWER } from './endingLayout';

interface Ports {root:THREE.Group;camera:THREE.PerspectiveCamera;parent:HTMLElement;command(id:string,kind:'skip'|'continue'):void;cue?(value:string):void;error?(message:string):void;createRig?(actor:EndingCast):Promise<CrabRig>}
async function loadRig(actor:EndingCast):Promise<CrabRig>{const meta=rigCatalog(actor.archetype);if(meta.factory!=='createCrab')throw new Error('Ending cast requires a character rig');const {createCrab}=await import('../crab/provider');const rig=await createCrab({...actor.appearance??meta.spec},meta.extras?[...meta.extras]:[]);rig.root.scale.multiplyScalar(meta.rootMultiplier);return rig;}
/** Horizontal camera radius around the hero: outside the lamp ring (17.6 m), short of the trees (23 m) and houses (31 m). */
export const ENDING_REACH=20;
/** Safe window in NDC: clear of the letterbox and status above, the caption and controls below. */
export const ENDING_FRAME={x:.88,top:.56,bottom:-.4,pitch:.12} as const;
type Frame={readonly x:number;readonly top:number;readonly bottom:number;readonly pitch:number};
const MIN_FOV=24,MAX_FOV=90;
/**
 * Cuts of the celebration. Each is chosen from the accepted observation alone (phase, move, ticks):
 * - crane: opening and toprock, the high establishing view settling into the festival orbit;
 * - close: six-step and one-claw freeze, a chest-high hero close-up from inside the dancer ring;
 * - low: spin, 720 and back flip, a ground-level view up at the hero against the dusk sky;
 * - landmark: the first part of the finale, the crowd in front of the chapel bell tower;
 * - farewell: the rest of the finale, the landmark camera craning up until the path to the chapel shows.
 * Wide cuts (crane, landmark, farewell) keep every cast member in frame; close and low cuts keep the hero in frame.
 */
export type EndingShot='crane'|'close'|'low'|'landmark'|'farewell';
export const ENDING_WIDE_SHOTS:readonly EndingShot[]=['crane','landmark','farewell'];
/** Finale ticks that hold the chapel landmark before the farewell rise (the finale lasts 375 ticks). */
export const ENDING_LANDMARK_TICKS=210;
export function endingShot(state:Pick<EndingObservation,'phase'|'move'|'tick'|'phaseStartedTick'>):EndingShot|null {
 if(state.phase==='opening')return 'crane';
 if(state.phase==='finale')return state.tick-state.phaseStartedTick<ENDING_LANDMARK_TICKS?'landmark':'farewell';
 if(state.phase!=='routine')return null;
 if(state.move==='break_sixstep'||state.move==='break_oneclaw')return 'close';
 if(state.move==='break_spin'||state.move==='break_jumpspin'||state.move==='break_backflip')return 'low';
 return 'crane';
}
/**
 * Stage frame from the observed cast: the server rings the guests evenly around the stage centre and
 * puts slot 1 straight ahead of the hero, so their mean is the centre and slot 1 gives the facing.
 * The guests never move during the ending, so this frame is the same for every observation.
 */
export function endingStageFrame(cast:readonly Pick<EndingCast,'position'>[]):{centre:THREE.Vector3;yaw:number} {
 const hero=cast[0]?.position??{x:0,y:0,z:0};if(cast.length<3)return {centre:new THREE.Vector3(hero.x,hero.y,hero.z),yaw:0};
 const centre=new THREE.Vector3();for(const actor of cast.slice(1))centre.add(new THREE.Vector3(actor.position.x,actor.position.y,actor.position.z));centre.divideScalar(cast.length-1);
 return {centre,yaw:Math.atan2(cast[1].position.x-centre.x,cast[1].position.z-centre.z)};
}
/** Positions the camera on the orbit ray and pitches it so the target sits at NDC height `pitch`. */
export function placeEndingCamera(camera:THREE.PerspectiveCamera,target:THREE.Vector3,direction:THREE.Vector3,distance:number,fov:number,pitch:number=ENDING_FRAME.pitch):void {
 camera.fov=fov;camera.updateProjectionMatrix();camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);
 camera.rotateX(-Math.atan(pitch*Math.tan(THREE.MathUtils.degToRad(fov/2))));camera.updateMatrixWorld();
}
/** Window for the gear a hero holds: it may leave the hero's frame window but stays clear of the letterboxes (11% top and bottom). */
export const ENDING_GEAR_FRAME={x:.95,top:.72,bottom:-.72} as const;
type Window={readonly x:number;readonly top:number;readonly bottom:number};
/**
 * Narrowest lens at the given distance that keeps every corner inside the frame window (and every `loose` corner
 * inside its own window); backs out only if no lens fits.
 */
export function fitEndingCamera(camera:THREE.PerspectiveCamera,target:THREE.Vector3,direction:THREE.Vector3,corners:readonly THREE.Vector3[],distance:number,frame:Frame=ENDING_FRAME,lens:readonly [number,number]=[MIN_FOV,MAX_FOV],backOut=true,loose:{corners:readonly THREE.Vector3[];frame:Window}={corners:[],frame:ENDING_GEAR_FRAME}):{distance:number;fov:number;fits:boolean} {
 const point=new THREE.Vector3();
 const within=(list:readonly THREE.Vector3[],window:Window)=>{for(const corner of list){point.copy(corner).applyMatrix4(camera.matrixWorldInverse);if(point.z>-.5)return false;point.applyMatrix4(camera.projectionMatrix);if(Math.abs(point.x)>window.x||point.y>window.top||point.y<window.bottom)return false;}return true;};
 const fits=(distance:number,fov:number)=>{placeEndingCamera(camera,target,direction,distance,fov,frame.pitch);return within(corners,frame)&&within(loose.corners,loose.frame);};
 for(let i=0;backOut&&i<12&&!fits(distance,lens[1]);i++)distance*=1.15;
 let narrow=lens[0],wide=lens[1];if(fits(distance,narrow))return {distance,fov:narrow,fits:true};
 if(!fits(distance,wide))return {distance,fov:wide,fits:false};
 for(let i=0;i<12;i++){const mid=(narrow+wide)/2;if(fits(distance,mid))wide=mid;else narrow=mid;}
 return {distance,fov:wide,fits:true};
}
/**
 * Camera stations for the hero cuts: midway between neighbouring guests of the inner dancer ring and
 * just outside it, from the observed (fixed) guest positions. A station never stands inside a guest.
 */
export function endingRingStations(cast:readonly Pick<EndingCast,'position'>[],centre:THREE.Vector3):{angle:number;radius:number}[] {
 const guests=cast.slice(1).map(g=>({angle:Math.atan2(g.position.x-centre.x,g.position.z-centre.z),radius:Math.hypot(g.position.x-centre.x,g.position.z-centre.z)}));
 if(guests.length<3)return [];
 const near=Math.min(...guests.map(g=>g.radius)),far=Math.max(...guests.map(g=>g.radius)),inner=guests.filter(g=>g.radius<=(near+far)/2+1e-6).sort((a,b)=>a.angle-b.angle);
 return inner.map((g,i)=>{const next=inner[(i+1)%inner.length],span=i+1<inner.length?next.angle-g.angle:next.angle+Math.PI*2-g.angle;return {angle:g.angle+span/2,radius:near+.35};});
}
/** Hero cuts: guests standing within this multiple of the camera's distance from the stage centre are on the camera's side of the ring. */
export const ENDING_NEAR_GUESTS=1.3;
/**
 * Guests who step out of a hero cut: those on the camera's side of the ring, whose claws, swords and shields
 * would otherwise poke up through the bottom of the frame. It depends only on the camera station (fixed through
 * a move) and the fixed guest ring, never on the pose, so no guest pops in or out during a move.
 */
export function endingHiddenGuests(cast:readonly Pick<EndingCast,'position'|'ref'>[],centre:THREE.Vector3,station:THREE.Vector3):Set<number> {
 const reach=Math.hypot(station.x-centre.x,station.z-centre.z)*ENDING_NEAR_GUESTS;
 return new Set(cast.slice(1).filter(g=>Math.hypot(g.position.x-station.x,g.position.z-station.z)<reach).map(g=>g.ref.slot));
}
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
type BonePiece={mesh:THREE.SkinnedMesh;bone:THREE.Bone;box:THREE.Box3};
const bonePieces=new WeakMap<CrabRig,BonePiece[]>();
/** Bind-space box of the vertices each bone mostly carries, computed once per rig. */
function piecesOf(rig:CrabRig):BonePiece[] {
 const known=bonePieces.get(rig);if(known)return known;
 const pieces=new Map<string,BonePiece>(),v=new THREE.Vector3();
 rig.root.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh)return;const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.attributes.skinIndex,weight=geometry.attributes.skinWeight;if(!position||!index||!weight)return;
  for(let i=0;i<position.count;i++){let lead=0;for(let k=1;k<4;k++)if(weight.getComponent(i,k)>weight.getComponent(i,lead))lead=k;const b=index.getComponent(i,lead),bone=mesh.skeleton.bones[b];if(!bone)continue;
   const key=mesh.uuid+':'+b;let piece=pieces.get(key);if(!piece){piece={mesh,bone,box:new THREE.Box3()};pieces.set(key,piece);}
   piece.box.expandByPoint(v.fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[b]));}
 });
 const list=[...pieces.values()];bonePieces.set(rig,list);return list;
}
/** Corners of the posed rig's per-bone boxes: a tight hull of the silhouette the shader skins this tick. */
function posedCorners(rig:CrabRig):THREE.Vector3[] {
 const out:THREE.Vector3[]=[],matrix=new THREE.Matrix4();
 for(const {mesh,bone,box}of piecesOf(rig)){matrix.multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse).multiply(bone.matrixWorld);for(let i=0;i<8;i++)out.push(new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(matrix));}
 return out;
}
/** Corners of the rigid gear the rig carries (staff, shield, lantern): parented meshes the skinning hull does not cover. */
function gearCorners(rig:CrabRig):THREE.Vector3[] {
 const out:THREE.Vector3[]=[];
 // Each piece's own bounding box, turned with it: a staff held at a slant stays a thin box, not a wide cube.
 rig.root.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh||(mesh as THREE.SkinnedMesh).isSkinnedMesh||!mesh.visible)return;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;if(box.isEmpty())return;for(let i=0;i<8;i++)out.push(new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(mesh.matrixWorld));});
 return out;
}
/** No local phase clock: commit copies a server observation; render cannot progress the sequence. */
export class EndingPresentationView {
 private id:string|null=null;private tick=-1;private sequence=-1;private generation=0;private disposed=false;private current:EndingObservation|null=null;private cueOrdinal=0;
 private readonly contacts=new EndingContactShadows();
 private rigs=new Map<number,CrabRig>();private loading=new Set<number>();private fit:{shot:EndingShot;distance:number;fov:number;tick:number}|null=null;private cut:EndingShot|null=null;private fits=true;private placed:{key:string;target:THREE.Vector3;direction:THREE.Vector3;distance:number;fov:number;pitch:number}|null=null;
 readonly hud=document.createElement('section');
 private caption=document.createElement('h2');private status=document.createElement('p');private credits=document.createElement('div');private skip=document.createElement('button');private proceed=document.createElement('button');
 constructor(private readonly ports:Ports){
  ports.root.add(this.contacts.root);
  this.hud.className='ending-presentation';
  this.caption.className='ending-caption';this.status.className='ending-status';this.status.setAttribute('role','status');
  this.credits.className='ending-credits';this.credits.tabIndex=0;this.credits.setAttribute('aria-label',t('크레딧','Credits'));
  const brand=document.createElement('p');brand.className='ending-brand';brand.textContent='WORLD OF CRABCRAFT';
  const title=document.createElement('h1');title.textContent=t('크레딧','Credits');
  const intro=document.createElement('p');intro.className='ending-credits-intro';intro.textContent=t('함께해 주셔서 고마워요. 게들의 모험은 계속됩니다.','Thank you for playing. The adventure continues.');
  this.credits.append(brand,title,intro);
  for(const row of parseNotice(notice)){const section=document.createElement('section');section.className='ending-credits-row';const name=document.createElement('h2');name.textContent=row.material;const license=document.createElement('p');license.textContent=row.license;section.append(name,license);this.credits.append(section);}
  this.skip.textContent=t('축하 장면 건너뛰기','Skip celebration');this.proceed.textContent=t('계속 모험하기','Continue adventure');
  for(const button of [this.skip,this.proceed]){button.className='ending-control';button.type='button';button.setAttribute('aria-label',button.textContent??'');}
  this.skip.onclick=()=>{if(this.current)this.ports.command(this.current.id,'skip');};this.proceed.onclick=()=>{if(this.current)this.ports.command(this.current.id,'continue');};
  this.hud.append(this.status,this.caption,this.credits,this.skip,this.proceed);ports.parent.append(this.hud);this.hud.hidden=true;
 }
 /** Host/client binding authorizes a new incarnation explicitly; old observations cannot replace it. */
 bind(id:string):void {if(this.disposed)throw new Error('Disposed ending view');this.clear();this.id=id;}
 commit(observation:EndingObservation):boolean {
  if(this.disposed||observation.id!==this.id||observation.sequence<=this.sequence||observation.tick<this.tick)return false;
  if(!Number.isSafeInteger(observation.tick)||observation.tick<0||!Number.isSafeInteger(observation.sequence)||observation.sequence<0)throw new Error('Invalid ending observation clock');
  if(this.current&&(observation.owner.area!==this.current.owner.area||observation.owner.id!==this.current.owner.id||observation.owner.life!==this.current.owner.life))throw new Error('Ending owner lifetime changed');
  if(observation.provider!==renderPoseProviderVersion)throw new Error('Ending pose provider mismatch');
  if(new Set(observation.cast.map(a=>a.ref.slot)).size!==observation.cast.length||observation.cast.some(a=>a.ref.endingId!==observation.id||!isRenderPoseRecipe(a.recipe)))throw new Error('Invalid ending cast');
  const first=this.tick<0;this.sequence=observation.sequence;this.tick=observation.tick;this.current=structuredClone(observation);const state=this.current;
  for(const actor of state.cast)if(actor.ref.endingId!==state.id)throw new Error('Cast incarnation mismatch');
  const visible=new Set(state.cast.map(a=>a.ref.slot));this.contacts.retain(visible);for(const [slot,rig]of this.rigs)if(!visible.has(slot)){rig.root.removeFromParent();rig.dispose();this.rigs.delete(slot);}
  for(const actor of state.cast){if(this.rigs.has(actor.ref.slot)||this.loading.has(actor.ref.slot))continue;const generation=this.generation;this.loading.add(actor.ref.slot);
   void (this.ports.createRig??loadRig)(actor).then(rig=>{if(this.disposed||generation!==this.generation||!this.current?.cast.some(a=>a.ref.slot===actor.ref.slot)){rig.dispose();return;}this.loading.delete(actor.ref.slot);this.rigs.set(actor.ref.slot,rig);this.ports.root.add(rig.root);this.render();}).catch(error=>{if(generation===this.generation){this.ports.error?.(error instanceof Error?error.message:'Cast load failed');this.loading.delete(actor.ref.slot);this.status.textContent=t('축하 장면을 불러오지 못했습니다.','The celebration could not be loaded.');}});
  }
  // On reconnect the full baseline restores visuals, without playing old audio/FX again.
  for(const cue of state.cues){if(!first&&cue.ordinal>this.cueOrdinal)this.ports.cue?.(cue.value);this.cueOrdinal=Math.max(this.cueOrdinal,cue.ordinal);}
  this.hud.hidden=state.phase==='finished'||state.phase==='cancelled';this.status.textContent=state.phase==='blackout'?t('축하 장면을 준비하고 있어요.','Preparing the celebration.'):state.phase==='credits'?t('함께해 주셔서 고마워요.','Thank you for playing.'):['opening','routine','finale'].includes(state.phase)?t('영웅을 위한 축하','A celebration for the hero'):'';
  this.hud.style.background=state.phase==='blackout'?'#000':'transparent';this.credits.style.display=state.phase==='credits'?'block':'none';
  this.skip.hidden=!['opening','routine','finale'].includes(state.phase)||state.tick<state.skipAvailableTick;this.proceed.hidden=state.phase!=='credits';
  this.caption.textContent=state.phase==='routine'?(BREAK_ROUTINE.find(s=>s.id===state.move)?.label??''):state.phase==='finale'?t('마을이 영웅을 축하합니다','The village celebrates its hero'):state.phase==='opening'?t('돌아온 영웅을 환영합니다','Welcome home, hero'):'';
  this.render();return true;
 }
 render():void {
  const state=this.current;if(!state||this.disposed)return;
  for(const actor of state.cast){const rig=this.rigs.get(actor.ref.slot);if(rig)applyNumericPose(rig,{...actor.position,yaw:actor.yaw,pose:evaluateRenderPoseRecipe(actor.recipe)});}
  const hero=state.cast[0],shot=hero?endingShot(state):null;this.cut=shot;if(!hero||!shot)return;
  // The framing is a function of the accepted observation, the loaded rigs and the screen shape; frames
  // between two observations reuse it.
  const camera=this.ports.camera,key=`${state.sequence}|${this.rigs.size}|${camera.aspect}`;
  if(this.placed?.key===key){placeEndingCamera(camera,this.placed.target,this.placed.direction,this.placed.distance,this.placed.fov,this.placed.pitch);return;}
  const corners:THREE.Vector3[]=[],box=new THREE.Box3();let heroCorners:THREE.Vector3[]=[],heroGear:THREE.Vector3[]=[];
  for(const actor of state.cast){const rig=this.rigs.get(actor.ref.slot),p=actor.position;
   // Stable envelope around each server position, unioned with the live rig, keeps the fit calm.
   box.set(new THREE.Vector3(p.x-1.25,p.y-.1,p.z-1.25),new THREE.Vector3(p.x+1.25,p.y+1.8,p.z+1.25));
   if(rig){rig.root.updateMatrixWorld(true);const live=new THREE.Box3().setFromObject(rig.root);box.union(live);const body=rig.body.getWorldPosition(new THREE.Vector3()),height=Math.max(0,live.min.y-(p.y-.08)),scale=rig.root.scale.x,size=(1.6+height*.5)*scale;this.contacts.set(actor.ref.slot,body.x,p.y-.066,body.z,size*1.1,size*.85,.62/(1+height*1.5));}
   else box.expandByVector(new THREE.Vector3(.6,1.6,.6));
   const own=Array.from({length:8},(_,i)=>new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z));corners.push(...own);
   // Hero cuts fit the posed rig itself (the calm envelope is wider than a close lens can hold), and keep the gear
   // it holds clear of the letterboxes.
   if(actor===hero){heroCorners=rig?posedCorners(rig):own;heroGear=rig?gearCorners(rig):[];}
  }
  // Every cut is a function of the accepted observation: phase, move, server ticks and the observed cast.
  const {centre,yaw}=endingStageFrame(state.cast);
  const seconds=Math.max(0,(state.tick-state.celebrationStartedTick)/30),a=seconds*.16+state.orbitYaw;
  const portrait=1-THREE.MathUtils.smoothstep(camera.aspect,.6,1.3),late=THREE.MathUtils.lerp(18,36,portrait);
  const focusY=Math.max(.8,(this.rigs.get(hero.ref.slot)?.body.position.y??0)*.75),heroAt=new THREE.Vector3(hero.position.x,hero.position.y,hero.position.z);
  const orbit=(elevationDeg:number,reach:number)=>{const elevation=THREE.MathUtils.degToRad(elevationDeg);return {target:heroAt.clone().setY(heroAt.y+focusY),direction:new THREE.Vector3(Math.sin(a)*Math.cos(elevation),Math.sin(elevation),Math.cos(a)*Math.cos(elevation)),distance:reach/Math.cos(elevation)};};
  // Hero cuts stand at a gap of the inner dancer ring, the one nearest a stage bearing (0 = in front of
  // the hero) that keeps a sensible distance to the hero, wherever the routine has carried him.
  // Camera stations for the hero cuts stand at a gap of the inner dancer ring (`inset` metres in from just
  // outside it), the gap nearest a stage bearing (0 = in front of the hero) at a sensible distance from him.
  // The station depends only on the screen shape and the fixed guest ring, so it holds still through a move;
  // the aim (the middle of the posed hero) and the lens follow the pose.
  const station=(bearing:number,height:number,inset:number)=>{
   const target=new THREE.Box3().setFromPoints(heroCorners).getCenter(new THREE.Vector3()),want=yaw+bearing;
   const stations=endingRingStations(state.cast,centre).map(s=>({angle:s.angle,radius:s.radius-inset}));
   const reach=(s:{angle:number;radius:number})=>Math.hypot(centre.x+Math.sin(s.angle)*s.radius-heroAt.x,centre.z+Math.cos(s.angle)*s.radius-heroAt.z);
   const pick=stations.filter(s=>reach(s)>=2.2&&reach(s)<=7.5).sort((p,q)=>Math.abs(wrap(p.angle-want))-Math.abs(wrap(q.angle-want)))[0]??{angle:want,radius:4.5};
   const offset=new THREE.Vector3(centre.x+Math.sin(pick.angle)*pick.radius,centre.y+height,centre.z+Math.cos(pick.angle)*pick.radius).sub(target);
   return {target,direction:offset.clone().normalize(),distance:offset.length()};
  };
  let view!:{target:THREE.Vector3;direction:THREE.Vector3;distance:number};let frame:Frame=ENDING_FRAME,lens:[number,number]=[MIN_FOV,MAX_FOV],fitCorners=corners;
  if(shot==='crane'){
   // Cranes down from a high establishing view, staying inside the courtyard ring so no roof or tree
   // crosses the lens. Wide screens settle into a low festival view; portrait screens stay above the
   // roofs and trees (about 16 m) so the whole ring fits a moderate lens.
   const linear=Math.min(1,seconds/12),k=linear*linear*(3-2*linear);
   view=orbit(THREE.MathUtils.lerp(late+16,late,k),THREE.MathUtils.lerp(ENDING_REACH,22,portrait));
  }else if(shot==='landmark'||shot==='farewell'){
   // In front of the hero, looking back over the crowd to the chapel bell tower at the end of the torch path.
   // The camera stands between the candelabra (10.6 m) and the lamp posts (17.6 m), so no lamp halo or festoon
   // sits against the lens. It rises slowly through the landmark; the farewell keeps rising from there, over the
   // crowd, until the Frost shard, the path and the chapel line up below it.
   const local=(state.tick-state.phaseStartedTick)/30,landmarkEnd=ENDING_LANDMARK_TICKS/30,start=THREE.MathUtils.lerp(5,20,portrait)+Math.min(local,landmarkEnd)*.35;
   const linear=THREE.MathUtils.clamp((local-landmarkEnd)/4,0,1),k=linear*linear*(3-2*linear);
   const heading=yaw+.16,elevation=THREE.MathUtils.degToRad(THREE.MathUtils.lerp(start,THREE.MathUtils.lerp(30,40,portrait),k));
   const tower=new THREE.Vector3(ENDING_BELL_TOWER.x,ENDING_BELL_TOWER.y,ENDING_BELL_TOWER.z).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(centre);
   view={target:centre.clone().setY(centre.y+1),direction:new THREE.Vector3(Math.sin(heading)*Math.cos(elevation),Math.sin(elevation),Math.cos(heading)*Math.cos(elevation)),distance:THREE.MathUtils.lerp(15.5,21.5,portrait)/Math.cos(elevation)};
   // Landmark: tilt and lens together, the narrowest lens over a few tilts that holds the crowd and the bell
   // tower; a tall narrow screen that cannot also hold the tower frames the crowd low instead. Farewell: the
   // crowd stays in the lower part at a fixed tilt, so the path and the chapel fill the top as it rises.
   let best:{pitch:number;fov:number}|null=null;
   if(shot==='farewell')frame=ENDING_FRAME;
   else for(const subject of [[...corners,tower],corners]){
    for(let pitch=-.6;pitch<=.31;pitch+=.15){const fit=fitEndingCamera(camera,view.target,view.direction,subject,view.distance,{...frame,pitch},lens,false);if(fit.fits&&(!best||fit.fov<best.fov-1e-6))best={pitch,fov:fit.fov};}
    if(best){fitCorners=subject;break;}
   }
   frame={...frame,pitch:best?.pitch??frame.pitch};
  }
  if(shot==='close'){
   // Six-step footwork is filmed from above the circle of guests, as a cypher is. The one-claw freeze
   // holds still, so the camera steps inside the ring to chest height with the neighbouring guests behind
   // it; a tall screen is too narrow for that and looks on from above the ring gap instead.
   const tall=camera.aspect<.95;
   view=state.move==='break_oneclaw'?(tall?station(-1.05,3.2,-.35):station(-1.05,1.7,1.4)):station(-1.75,THREE.MathUtils.lerp(5.4,5.8,portrait),THREE.MathUtils.lerp(-.35,-.9,portrait));
   // The cypher keeps a lens wide enough for the circle of guests; the freeze may close in on the hero.
   fitCorners=heroCorners;frame={x:.78,top:.5,bottom:-.34,pitch:.08};lens=[state.move==='break_oneclaw'?18:50,76];
  }else if(shot==='low'){
   // Ground level inside the ring, looking up: the hero against the dusk sky with the bell tower beside him.
   // A tall screen is too narrow for the spin from in there; it stands behind the ring gap at eye height,
   // where the narrow width keeps the neighbouring guests out of frame.
   const tall=camera.aspect<.95;view=station(.35,tall?2.7:.5,tall?-1:1.6);
   // On wide screens the hero sits a little low so the sky takes the top of the frame.
   fitCorners=heroCorners;frame={x:.8,top:.48,bottom:-.34,pitch:tall?.07:-.04};lens=[30,90];
  }
  // Hero cuts never back out of the dancer ring: if the pose outgrows the lens, the lens stays at its widest.
  const heroCut=shot==='close'||shot==='low',{distance,fov,fits}=fitEndingCamera(camera,view.target,view.direction,fitCorners,view.distance,frame,lens,!heroCut,{corners:heroCut?heroGear:[],frame:ENDING_GEAR_FRAME});this.fits=fits;
  // A new cut snaps; within a cut the lens widens at once when needed and narrows back gently, per
  // accepted tick, so dance steps do not pump it and rendering alone never moves the camera.
  const ticks=this.fit?Math.max(0,state.tick-this.fit.tick):0;
  this.fit=this.fit&&this.fit.shot===shot&&this.fit.distance===distance&&this.fit.fov>=fov?{shot,distance,fov:Math.max(fov,this.fit.fov-.12*Math.min(ticks,30)),tick:state.tick}:{shot,distance,fov,tick:state.tick};
  placeEndingCamera(camera,view.target,view.direction,this.fit.distance,this.fit.fov,frame.pitch);
  // Hero cuts stand at a fixed station, so the camera position is that station; wide cuts show everyone.
  const hidden=shot==='close'||shot==='low'?endingHiddenGuests(state.cast,centre,camera.position):new Set<number>();
  for(const [slot,rig]of this.rigs){rig.root.visible=!hidden.has(slot);this.contacts.show(slot,!hidden.has(slot));}
  this.placed={key,target:view.target,direction:view.direction,distance:this.fit.distance,fov:this.fit.fov,pitch:frame.pitch};
 }
 /** Current cut, for QA and the HUD; null outside the cast phases. */
 get shot():EndingShot|null{return this.cut;}
 /** Whether the current cut's subject fitted its frame window at the chosen lens (QA diagnostics). */
 get framed():boolean{return this.fits;}
 get readyCount():number{return this.rigs.size;}
 private clear():void {this.generation++;for(const rig of this.rigs.values()){rig.root.removeFromParent();rig.dispose();}this.rigs.clear();this.contacts.retain(new Set());this.loading.clear();this.fit=null;this.cut=null;this.placed=null;this.current=null;this.tick=-1;this.sequence=-1;this.cueOrdinal=0;this.hud.hidden=true;}
 dispose():void {if(this.disposed)return;this.clear();this.disposed=true;this.contacts.dispose();this.contacts.root.removeFromParent();this.hud.remove();}
}
