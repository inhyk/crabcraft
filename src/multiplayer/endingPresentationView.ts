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

interface Ports {root:THREE.Group;camera:THREE.PerspectiveCamera;parent:HTMLElement;command(id:string,kind:'skip'|'continue'):void;cue?(value:string):void;error?(message:string):void;createRig?(actor:EndingCast):Promise<CrabRig>}
async function loadRig(actor:EndingCast):Promise<CrabRig>{const meta=rigCatalog(actor.archetype);if(meta.factory!=='createCrab')throw new Error('Ending cast requires a character rig');const {createCrab}=await import('../crab/provider');const rig=await createCrab({...actor.appearance??meta.spec},meta.extras?[...meta.extras]:[]);rig.root.scale.multiplyScalar(meta.rootMultiplier);return rig;}
/** No local phase clock: commit copies a server observation; render cannot progress the sequence. */
export class EndingPresentationView {
 private id:string|null=null;private tick=-1;private sequence=-1;private generation=0;private disposed=false;private current:EndingObservation|null=null;private cueOrdinal=0;
 private readonly contacts=new EndingContactShadows();
 private rigs=new Map<number,CrabRig>();private loading=new Set<number>();
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
  const hero=state.cast[0];if(!hero)return;const seconds=Math.max(0,(state.tick-state.celebrationStartedTick)/30),linear=Math.min(1,seconds/12),k=linear*linear*(3-2*linear),r=11-7*k,h=6.5-4*k,a=seconds*.16+state.orbitYaw;
  const focusY=Math.max(.9,(this.rigs.get(hero.ref.slot)?.body.position.y??0)*.75);
  const camera=this.ports.camera,target=new THREE.Vector3(hero.position.x,hero.position.y+focusY+(1-k)*.6,hero.position.z);
  const offset=new THREE.Vector3(Math.sin(a)*r,h-.9-(1-k)*.6,Math.cos(a)*r),direction=offset.clone().normalize();
  camera.position.copy(target).add(offset);camera.lookAt(target);camera.updateMatrixWorld();
  // Fit the observed cast without changing the server-tick orbit direction, target or progression.
  // Symmetric safe margins leave room for the letterbox, caption and ordered controls at both widths.
  const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
  const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*Math.max(.1,camera.aspect);
  let distance=offset.length();const box=new THREE.Box3(),point=new THREE.Vector3();
  for(const actor of state.cast){const rig=this.rigs.get(actor.ref.slot);if(rig){rig.root.updateMatrixWorld(true);box.setFromObject(rig.root);}else box.set(new THREE.Vector3(actor.position.x-2,actor.position.y-.5,actor.position.z-2),new THREE.Vector3(actor.position.x+2,actor.position.y+3.5,actor.position.z+2));
   if(rig){const body=rig.body.getWorldPosition(new THREE.Vector3()),height=Math.max(0,box.min.y-(actor.position.y-.08)),scale=rig.root.scale.x,size=(1.6+height*.5)*scale;this.contacts.set(actor.ref.slot,body.x,actor.position.y-.066,body.z,size*1.1,size*.85,.62/(1+height*1.5));}
   for(let i=0;i<8;i++){point.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).sub(target);distance=Math.max(distance,point.dot(direction)+Math.max(Math.abs(point.dot(right))/(tanX*.88),Math.abs(point.dot(up))/(tanY*.57)));}
  }
  camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);camera.updateMatrixWorld();
 }
 get readyCount():number{return this.rigs.size;}
 private clear():void {this.generation++;for(const rig of this.rigs.values()){rig.root.removeFromParent();rig.dispose();}this.rigs.clear();this.contacts.retain(new Set());this.loading.clear();this.current=null;this.tick=-1;this.sequence=-1;this.cueOrdinal=0;this.hud.hidden=true;}
 dispose():void {if(this.disposed)return;this.clear();this.disposed=true;this.contacts.dispose();this.contacts.root.removeFromParent();this.hud.remove();}
}
