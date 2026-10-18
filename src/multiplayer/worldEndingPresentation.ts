import * as THREE from 'three';
import type { EntityRef } from '../sim/types.ts';
import type { GameplayState } from '../../server/world/gameplay/protocol.ts';
import type { GameplayCommand } from '../../server/world/gameplay/intents.ts';
import type { EndingObservation } from '../sim/features/endingPresentation.ts';
import { EndingPresentationView } from './endingPresentationView.ts';

/** These are accepted observation-header fields, never a second network envelope. */
export type EndingPresentationFrame=Readonly<Pick<GameplayState,'selfRef'>&Pick<GameplayState['header'],'session'|'area'|'epoch'|'catalog'|'sequence'>>;
export type EndingControlCommand=Extract<GameplayCommand,{kind:'endingControl'}>;
interface Ports {
 readonly parent:HTMLElement;
 activate(scene:THREE.Scene,camera:THREE.PerspectiveCamera):void;
 restore():void;
 cinematic(on:boolean):void;
 command(command:EndingControlCommand):boolean;
 alive():boolean;
 cue?(value:string):void;
 error?(message:string):void;
}
const same=(a:EntityRef,b:EntityRef)=>a.area===b.area&&a.id===b.id&&a.life===b.life;
/** Owns only a private display scene. It has no gameplay Unit, controller, clock or reward port. */
export class WorldEndingPresentation {
 readonly scene=new THREE.Scene();
 readonly camera=new THREE.PerspectiveCamera(50,1,.1,100);
 private readonly root=new THREE.Group();
 private readonly floor=new THREE.Mesh(new THREE.CircleGeometry(13,80),new THREE.MeshStandardMaterial({color:0x846947,roughness:.9}));
 private view:EndingPresentationView|null=null;
 private stream='';private frameSequence=-1;private generation=0;private disposed=false;
 private observed:{id:string;sequence:number;tick:number;terminal:boolean}|null=null;
 private current:EndingObservation|null=null;private pendingControl='';private ownsCamera=false;
 constructor(private readonly ports:Ports){
  this.scene.background=new THREE.Color('#1b3042');this.scene.add(this.root);
  this.scene.add(new THREE.HemisphereLight(0xd9f2ff,0x4b3d20,2.8));
  const light=new THREE.DirectionalLight(0xffd8a0,3);light.position.set(5,12,5);this.scene.add(light);
  this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-.015;this.scene.add(this.floor);
  this.camera.position.set(0,6,12);this.camera.lookAt(0,1,0);
 }
 get active():boolean{return this.ownsCamera;}
 get readyCount():number{return this.view?.readyCount??0;}
 /** Called only after WorldClient accepts a complete, bound gameplay observation. */
 commit(observation:EndingObservation|null,frame:EndingPresentationFrame|null):boolean {
  if(this.disposed)return false;
  if(!frame){this.reset();return true;}
  const stream=JSON.stringify([frame.session,frame.area,frame.epoch,frame.catalog,frame.selfRef.area,frame.selfRef.id,frame.selfRef.life]);
  if(stream!==this.stream){this.clearView();this.stream=stream;this.frameSequence=-1;this.observed=null;}
  if(frame.sequence<=this.frameSequence)return false;
  this.frameSequence=frame.sequence;
  if(!observation){this.clearView();return true;}
  if(!same(observation.owner,frame.selfRef)){this.clearView();this.ports.error?.('Ending owner does not match this character');return false;}
  const previous=this.observed;
  if(previous?.id===observation.id&&(observation.sequence<=previous.sequence||observation.tick<previous.tick||previous.terminal))return false;
  if(previous?.id!==observation.id)this.clearView();
  const terminal=observation.phase==='finished'||observation.phase==='cancelled';
  if(terminal){this.observed={id:observation.id,sequence:observation.sequence,tick:observation.tick,terminal:true};this.clearView();return true;}
  if(!this.view){
   const generation=++this.generation;
   this.view=new EndingPresentationView({root:this.root,camera:this.camera,parent:this.ports.parent,command:(id,action)=>this.control(id,action,generation),cue:value=>this.ports.cue?.(value),error:message=>this.ports.error?.(message)});
   this.view.bind(observation.id);
  }
  try{
   if(!this.view.commit(observation))return false;
   this.observed={id:observation.id,sequence:observation.sequence,tick:observation.tick,terminal:false};
   this.current=structuredClone(observation);this.pendingControl='';
   const hero=observation.cast[0];if(hero)this.floor.position.set(hero.position.x,hero.position.y-.015,hero.position.z);
   if(!this.ownsCamera){this.ports.activate(this.scene,this.camera);this.ports.cinematic(true);this.ownsCamera=true;}
   return true;
  }catch(error){this.clearView();this.ports.error?.(error instanceof Error?error.message:'Ending display failed');return false;}
 }
 private control(id:string,action:'skip'|'continue',generation:number):void {
  const state=this.current;if(this.disposed||generation!==this.generation||!this.ports.alive()||!state||state.id!==id)return;
  if(action==='continue'?state.phase!=='credits':!['opening','routine','finale'].includes(state.phase)||state.tick<state.skipAvailableTick)return;
  const pending=JSON.stringify([id,state.sequence,action]);if(this.pendingControl===pending)return;
  if(this.ports.command({kind:'endingControl',id,action}))this.pendingControl=pending;
  else this.ports.error?.('Ending command could not be queued');
 }
 /** Rendering applies the last server recipes; dt and wall time cannot advance the ending. */
 render():void {if(!this.disposed&&this.ownsCamera)this.view?.render();}
 reset():void {this.clearView();this.stream='';this.frameSequence=-1;this.observed=null;}
 private clearView():void {
  this.generation++;this.view?.dispose();this.view=null;this.current=null;this.pendingControl='';
  if(this.ownsCamera){this.ownsCamera=false;this.ports.cinematic(false);if(this.ports.alive())this.ports.restore();}
 }
 dispose():void {if(this.disposed)return;this.clearView();this.disposed=true;this.scene.visible=false;this.floor.geometry.dispose();this.floor.material.dispose();this.scene.clear();}
}
