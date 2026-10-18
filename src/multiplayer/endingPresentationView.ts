import * as THREE from 'three';
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
 private rigs=new Map<number,CrabRig>();private loading=new Set<number>();
 readonly hud=document.createElement('section');
 private caption=document.createElement('h2');private status=document.createElement('p');private credits=document.createElement('div');private skip=document.createElement('button');private proceed=document.createElement('button');
 constructor(private readonly ports:Ports){
  this.hud.className='ending-presentation';this.hud.style.cssText='position:absolute;inset:0;pointer-events:none;color:#f7e6bc;text-align:center;font:18px Georgia;background:transparent';
  this.caption.style.cssText='position:absolute;bottom:18%;width:100%;text-shadow:0 2px 4px black';
  this.status.style.cssText='background:#13202bcc;padding:12px;margin:0';this.credits.style.cssText='display:none;position:absolute;inset:12% 18%;padding:24px;background:#101f29f0;overflow:auto;pointer-events:auto';
  const title=document.createElement('h1');title.textContent='Credits';this.credits.append(title);for(const row of parseNotice(notice)){const p=document.createElement('p');p.textContent=`${row.material} - ${row.license}`;this.credits.append(p);}
  this.skip.textContent='Skip celebration';this.proceed.textContent='Continue adventure';for(const button of [this.skip,this.proceed])button.style.cssText='pointer-events:auto;position:absolute;bottom:6%;left:40%;width:20%;padding:12px';
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
  const visible=new Set(state.cast.map(a=>a.ref.slot));for(const [slot,rig]of this.rigs)if(!visible.has(slot)){rig.root.removeFromParent();rig.dispose();this.rigs.delete(slot);}
  for(const actor of state.cast){if(this.rigs.has(actor.ref.slot)||this.loading.has(actor.ref.slot))continue;const generation=this.generation;this.loading.add(actor.ref.slot);
   void (this.ports.createRig??loadRig)(actor).then(rig=>{if(this.disposed||generation!==this.generation||!this.current?.cast.some(a=>a.ref.slot===actor.ref.slot)){rig.dispose();return;}this.loading.delete(actor.ref.slot);this.rigs.set(actor.ref.slot,rig);this.ports.root.add(rig.root);this.render();}).catch(error=>{if(generation===this.generation){this.ports.error?.(error instanceof Error?error.message:'Cast load failed');this.loading.delete(actor.ref.slot);this.status.textContent=t('축하 장면을 불러오지 못했습니다.','The celebration could not be loaded.');}});
  }
  // On reconnect the full baseline restores visuals, without playing old audio/FX again.
  for(const cue of state.cues){if(!first&&cue.ordinal>this.cueOrdinal)this.ports.cue?.(cue.value);this.cueOrdinal=Math.max(this.cueOrdinal,cue.ordinal);}
  this.hud.hidden=state.phase==='finished'||state.phase==='cancelled';this.status.textContent=state.phase==='blackout'?t('축하 장면을 준비하고 있어요.','Preparing the celebration.'):state.phase==='credits'?t('함께해 주셔서 고마워요.','Thank you for playing.'):['opening','routine','finale'].includes(state.phase)?t('영웅을 위한 축하','A celebration for the hero'):'';
  this.hud.style.background=state.phase==='blackout'?'#000':'transparent';this.credits.style.display=state.phase==='credits'?'block':'none';
  this.skip.hidden=!['opening','routine','finale'].includes(state.phase)||state.tick<state.skipAvailableTick;this.proceed.hidden=state.phase!=='credits';
  this.caption.textContent=state.phase==='routine'?(BREAK_ROUTINE.find(s=>s.id===state.move)?.label??''):state.phase==='finale'?'The village celebrates its hero':state.phase==='opening'?'The hero returns':'';
  this.render();return true;
 }
 render():void {
  const state=this.current;if(!state||this.disposed)return;
  for(const actor of state.cast){const rig=this.rigs.get(actor.ref.slot);if(rig)applyNumericPose(rig,{...actor.position,yaw:actor.yaw,pose:evaluateRenderPoseRecipe(actor.recipe)});}
  const hero=state.cast[0];if(!hero)return;const seconds=Math.max(0,(state.tick-state.celebrationStartedTick)/30),linear=Math.min(1,seconds/12),k=linear*linear*(3-2*linear),r=11-7*k,h=6.5-4*k,a=seconds*.16+state.orbitYaw;
  const focusY=Math.max(.9,(this.rigs.get(hero.ref.slot)?.body.position.y??0)*.75);
  this.ports.camera.position.set(hero.position.x+Math.sin(a)*r,hero.position.y+h+focusY-.9,hero.position.z+Math.cos(a)*r);this.ports.camera.lookAt(hero.position.x,hero.position.y+focusY+(1-k)*.6,hero.position.z);
 }
 get readyCount():number{return this.rigs.size;}
 private clear():void {this.generation++;for(const rig of this.rigs.values()){rig.root.removeFromParent();rig.dispose();}this.rigs.clear();this.loading.clear();this.current=null;this.tick=-1;this.sequence=-1;this.cueOrdinal=0;this.hud.hidden=true;}
 dispose():void {if(this.disposed)return;this.clear();this.disposed=true;this.hud.remove();}
}
