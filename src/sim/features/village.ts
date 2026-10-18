/** Authority rules from game/villageGames.ts, with numeric navigation and value observations. */
import type { EntityRef, SimUnit, Vec3 } from '../types.ts';
import { copyValue } from '../events.ts';
import { centre, distTo, feedLocomotion, moveTo, teleport } from '../unit.ts';
import { FeatureNavigation } from './nav.ts';
import { actorForRef, sameRef, validBindings, validDt, validStamp } from './types.ts';
import type { FeatureContext, FeatureObservation, VillageMode, VillageResult, VillageRound } from './types.ts';

export class NumericVillageGames {
  private context: FeatureContext;
  private boatOccupied: () => boolean;
  private state: VillageRound | null = null;
  private npcHome: {ref:EntityRef;position:Vec3} | null = null;
  private nav: FeatureNavigation | null = null;
  private bindings = new Map<string, EntityRef>();
  private started = new Set<string>();
  private finished = new Set<string>();
  private serial = 0;
  private sequence = -1;
  private epoch: number;
  constructor(context:FeatureContext, options:{boatOccupied:()=>boolean}) {
    this.context=context;this.boatOccupied=options.boatOccupied;this.epoch=context.authorityEpoch;
  }
  get playing():boolean {return this.state!==null&&this.state.phase!=='done';}
  snapshot():VillageRound|null {return copyValue(this.state);}
  debug() {return copyValue({state:this.state,npcHome:this.npcHome,bindings:[...this.bindings],serial:this.serial,sequence:this.sequence,epoch:this.epoch,started:[...this.started],finished:[...this.finished],nav:this.nav?.debug()??null});}
  private unit(id:string):SimUnit|null {
    const u=this.context.resolve(id),ref=this.bindings.get(id);
    return u&&ref&&sameRef(u.ref,ref)?u:null;
  }
  locked(ref:EntityRef):boolean {
    const a=actorForRef(this.context,ref),r=this.state;
    return !!a&&!!r&&this.playing&&r.members.includes(a.id)&&this.unit(a.id)===a.unit
      &&(r.caught.includes(a.id)||r.phase==='ready'&&r.seeker===a.id);
  }
  ownsNpc(ref:EntityRef):boolean {const r=this.state;return this.playing&&!!r&&!!this.npcHome&&sameRef(this.npcHome.ref,ref)&&this.unit(r.seeker)!==null;}
  /** Legacy suppression includes spectators and both incoming and outgoing player damage. */
  blocksDamage(source:Readonly<SimUnit>|null,target:Readonly<SimUnit>):boolean {
    return this.playing&&(source?.kind==='player'||target.kind==='player');
  }
  concealMap(unit:Readonly<SimUnit>,viewer:EntityRef):boolean {
    return this.playing&&this.state?.mode==='hide'&&(unit.kind==='townsfolk'||unit.kind==='player'&&!sameRef(unit.ref,viewer));
  }
  request(ref:EntityRef,mode:VillageMode|'stop'):boolean {
    this.checkEpoch();const g=this.context,a=actorForRef(g,ref);if(!g.authority||!a||!['hide','tag','stop'].includes(mode))return false;
    if(mode==='stop'){
      if(!this.state||a.id!==this.state.starter&&a.id!==g.authorityId)return false;
      this.finish('cancelled');return true;
    }
    if(this.playing||g.chapter!==1||g.encounterEngaged||g.endingActive||this.boatOccupied())return false;
    // The legacy host is always present; remote membership requires an alive, visible actor.
    const members=g.actors().filter(({id,unit})=>id===g.authorityId||unit.alive&&!unit.hidden).map(a=>a.id);
    if(!members.includes(a.id)||!members.length)return false;
    const npc=g.townsfolk().find(({unit})=>unit.alive&&!unit.hidden);
    if(members.length===1&&!npc)return false;
    this.reset();
    const seeker=members.length>1?a.id:npc!.id;
    for(const id of [...members,seeker]){const u=g.resolve(id);if(u)this.bindings.set(id,{...u.ref});}
    if(members.length===1){
      const u=npc!.unit;this.npcHome={ref:{...u.ref},position:{x:u.x,y:u.y,z:u.z}};
      teleport(u,g.query,-.5,12.5);this.nav=new FeatureNavigation(g.query,{points:g.navPoints,radius:u.radius+.15,step:.6});
    }
    const id=`${g.areaId}:village:${g.authorityEpoch}:${++this.serial}:${Math.floor(g.rng.next()*0x100000000).toString(16)}`;
    this.state={id,mode,phase:'ready',left:mode==='hide'?15:5,starter:a.id,seeker,members,caught:[],result:''};
    this.startMembers();return true;
  }
  private startMembers():void {
    const r=this.state,g=this.context;if(!r||this.started.has(r.id))return;
    this.started.add(r.id);
    for(let i=0;i<r.members.length;i++){
      const u=this.unit(r.members[i]);if(!u)continue;const a=i*2.39996;
      g.clearControls(u);teleport(u,g.query,-.5+Math.cos(a)*5,12.5+Math.sin(a)*5,Math.PI);
    }
    g.emit({type:'villageStarted',round:r.id,mode:r.mode,members:[...r.members],seeker:r.seeker});
  }
  private finish(result:VillageResult):void {
    const r=this.state;if(!r||r.phase==='done')return;
    r.phase='done';r.result=result;r.left=8;this.restoreNpc();this.finishedObservation();
  }
  private finishedObservation():void {
    const r=this.state;if(!r||r.phase!=='done'||!r.result||this.finished.has(r.id))return;
    this.finished.add(r.id);this.context.emit({type:'villageFinished',round:r.id,result:r.result,key:`${r.id}:finish`});
  }
  private restoreNpc():void {
    const saved=this.npcHome,r=this.state;
    if(saved&&r&&this.context.chapter===1){const u=this.context.resolve(r.seeker);if(u&&sameRef(u.ref,saved.ref))teleport(u,this.context.query,saved.position.x,saved.position.z);}
    this.npcHome=null;this.nav=null;
  }
  reset():void {this.restoreNpc();this.state=null;this.bindings.clear();}
  /** Accepted trusted observations only. Snapshots never tick clocks, catch actors, or grant rewards. */
  applyObservation(observation:FeatureObservation<VillageRound|null>):boolean {
    this.checkEpoch();if(!validStamp(this.context,observation,this.sequence)||!validRound(observation.state)
      ||observation.state&&!validBindings(this.context,[...observation.state.members,observation.state.seeker],observation.bindings))return false;
    const r=copyValue(observation.state);
    if(this.state?.id!==r?.id){this.restoreNpc();this.bindings.clear();}
    if(r){
      for(const id of [...r.members,r.seeker])this.bindings.set(id,{...observation.bindings[id]});
      const npc=this.context.townsfolk().find(a=>a.id===r.seeker);
      if(npc&&!this.npcHome&&r.phase!=='done'){
        this.npcHome={ref:{...npc.unit.ref},position:{x:npc.unit.x,y:npc.unit.y,z:npc.unit.z}};
        this.nav=new FeatureNavigation(this.context.query,{points:this.context.navPoints,radius:npc.unit.radius+.15,step:.6});
      }
    }
    this.state=r;this.sequence=observation.sequence;
    if(r?.phase==='done'){this.restoreNpc();this.finishedObservation();}
    else this.startMembers();
    return true;
  }
  private checkEpoch():void {if(this.epoch!==this.context.authorityEpoch){this.epoch=this.context.authorityEpoch;this.sequence=-1;}}
  step(dt:number):void {
    validDt(dt);this.checkEpoch();const r=this.state,g=this.context;
    if(!r||!g.authority)return;
    if(r.phase==='done'){r.left=Math.max(0,r.left-dt);if(!r.left)this.reset();return;}
    if(g.chapter!==1||!this.unit(r.starter)||!this.unit(r.seeker)?.alive){this.finish('cancelled');return;}
    const present=r.members.filter(id=>{const u=this.unit(id);return u?.alive&&!u.hidden;});
    const runners=present.filter(id=>id!==r.seeker&&!r.caught.includes(id));
    r.left=Math.max(0,r.left-dt);
    if(r.phase==='ready'&&!r.left){r.phase='play';r.left=r.mode==='hide'?120:90;}
    if(r.phase!=='play')return;
    const seeker=this.unit(r.seeker)!;
    if(this.npcHome&&runners.length){
      let target=this.unit(runners[0])!;for(const id of runners){const u=this.unit(id)!;if(distTo(seeker,u)<distTo(seeker,target))target=u;}
      const seen=this.visible(seeker,target)&&distTo(seeker,target)<(r.mode==='hide'?20:100);
      const patrol=[[-7,7],[8,-6],[26,2],[0,-24],[-22,-3],[-1,20]][Math.floor(g.time/7)%6];
      const to={x:seen?target.x:patrol[0],y:0,z:seen?target.z:patrol[1]},next=this.nav?.waypoint(seeker,to,g.time)??to;
      const dx=next.x-seeker.x,dz=next.z-seeker.z,d=Math.hypot(dx,dz);
      if(d>.2){const speed=r.mode==='tag'?4.9:3.7;seeker.yaw=Math.atan2(dx,dz);moveTo(seeker,g.query,seeker.x+dx/d*speed*dt,seeker.z+dz/d*speed*dt,dt);}
      feedLocomotion(seeker,dt);
    }
    for(const id of runners){
      const u=this.unit(id)!,outside=Math.hypot(u.x+.5,u.z-12.5)>60;
      if(outside||distTo(seeker,u)<seeker.radius+u.radius+.75&&this.visible(seeker,u)){
        r.caught.push(id);u.pendingHit=null;
        g.emit({type:'villageCaught',round:r.id,actor:{...u.ref},id,outside});
      }
    }
    if(!present.some(id=>id!==r.seeker&&!r.caught.includes(id)))this.finish('seekers');
    else if(!r.left)this.finish('runners');
  }
  private visible(a:SimUnit,b:SimUnit):boolean {
    const from={x:a.x,y:a.y+a.height*.7,z:a.z},to=centre(b),hit=this.context.query.raycastSolid(from,to);
    return hit===null||hit>=Math.hypot(from.x-to.x,from.y-to.y,from.z-to.z)-b.radius-.2;
  }
}
function validRound(r:VillageRound|null):boolean {
  if(r===null)return true;
  return !!r&&typeof r.id==='string'&&r.id.length>0&&['hide','tag'].includes(r.mode)&&['ready','play','done'].includes(r.phase)
    &&Number.isFinite(r.left)&&r.left>=0&&typeof r.starter==='string'&&typeof r.seeker==='string'
    &&Array.isArray(r.members)&&r.members.every(id=>typeof id==='string'&&id.length>0)&&new Set(r.members).size===r.members.length
    &&Array.isArray(r.caught)&&r.caught.every(id=>r.members.includes(id))&&new Set(r.caught).size===r.caught.length
    &&['','seekers','runners','cancelled'].includes(r.result);
}
