import type { AreaServices, CharacterId, EntityRef, HitOptions, SimUnit } from './types.ts';
import { immutable, sameRef } from './events.ts';

export interface LegacyConfig {
  room:string; epoch:number; host:string; self:string; localCharacter:CharacterId;
  role:'host'|'follower'; relayLife:boolean;
}
export interface LegacyCondition {stun:number;slow:number;slowPct:number;pushX:number;pushZ:number;pushTime:number}
export interface LegacyEffect {stun:number;rust:number;rustFor:number;pushX:number;pushZ:number;pushTime:number}
export interface LegacyUnitObservation {
  key:string;life?:number;x:number;y:number;z:number;yaw:number;hp:number;maxHp:number;level:number;
  alive:boolean;hidden:boolean;invulnerable:boolean;targetable:boolean;
  stun:number;slow:number;slowPct:number;rust:number;rustFor:number;
  enemyState?:'idle'|'chase'|'leash'|'dead'|'gone';xp?:number;seaCast?:{id:number;x:number;y:number;z:number;left:number};
}
export interface LegacyBossObservation {
  key:string;state:'dormant'|'waking'|'idle'|'fight'|'dying'|'dead';phase:number;enraged:boolean;
  timeline?:{state:number;freed:number;freedYaw:number;released:boolean};
  mech:null|{id:number;kind:'slam'|'spray'|'undertow'|'nova'|'eclipse'|'cross'|'barrage';at:readonly number[];yaw:number;left:number};
}
export type LegacyOperation =
  | {kind:'observe';units:readonly LegacyUnitObservation[];bosses?:readonly LegacyBossObservation[]}
  | {kind:'attack'|'hit'|'duel';target:string;source?:string;amount:number;crit?:boolean;rage?:number;sourceLife?:number;targetLife?:number}
  | {kind:'condition';target:string;condition:LegacyCondition;sourceLife?:number;targetLife?:number}
  | {kind:'effect';target:string;effect:LegacyEffect;sourceLife?:number;targetLife?:number}
  | {kind:'death';target:string;serial:number;life?:number}
  | {kind:'animation';target:string;action:string;targetLife?:number}
  | {kind:'beacon';lit:boolean}
  | {kind:'challenge';target:string};
export interface LegacyEnvelope {room:string;epoch:number;sender:string;sequence:number;operation:LegacyOperation}
export interface LegacyRequest {id:number;room:string;epoch:number;tick:number;operation:Exclude<LegacyOperation,{kind:'observe'}>}
interface Binding {key:string;unit:EntityRef;owner:string;wireLife:number|null;alive:boolean}
export interface LegacyPorts {
  advanceLife(ref:EntityRef):EntityRef;
  grantDeath(victim:EntityRef,killer:EntityRef|null):void;
  observeBoss(ref:EntityRef,state:LegacyBossObservation):void;
  observeEnemy(ref:EntityRef,state:LegacyUnitObservation):void;
  setBeacon(lit:boolean):void;
  challenge(ref:EntityRef):void;
  animate(ref:EntityRef,action:string):void;
}
const uint=(n:unknown):n is number=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=0xffffffff;
const bounded=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;
/** Legacy room ownership only. No transport, view callback or remote private player state. */
export class LegacyAuthority {
  private services:AreaServices;
  private ports:LegacyPorts;
  private config:LegacyConfig|null=null;
  private bindings=new Map<string,Binding>();
  private inputs:LegacyEnvelope[]=[];
  private output:LegacyRequest[]=[];
  private sequences=new Map<string,number>();
  private receipts=new Set<string>();
  private nextRequest=1;
  private nextDeath=1;
  private applying=false;
  private receiptInProgress:string|null=null;
  private limit:number;
  constructor(services:AreaServices,ports:LegacyPorts,limit:number){this.services=services;this.ports=ports;this.limit=limit;}
  get mode():'authoritative'|'legacy-host'|'legacy-follower'{return !this.config?'authoritative':this.config.role==='host'?'legacy-host':'legacy-follower';}
  get active():boolean{return this.config!==null;}
  configure(config:LegacyConfig|null):void {
    if(config&&(!config.room||!config.host||!config.self||!config.localCharacter||!Number.isSafeInteger(config.epoch)||config.epoch<0||(config.role==='host')!==(config.host===config.self)))throw new TypeError('Invalid legacy ownership');
    this.config=config?immutable(config):null;this.inputs=[];this.output=[];this.sequences.clear();
    // Receipts intentionally survive role/epoch changes and reconnects, scoped by room below.
  }
  bind(key:string,unit:EntityRef,owner='world'):void {const u=this.services.getUnit(unit);if(!key||!u)throw new Error('Invalid legacy binding');const old=this.bindings.get(key);if(old&&!sameRef(old.unit,unit))throw new Error('Legacy key already bound');this.bindings.set(key,{key,unit:immutable(unit),owner,wireLife:owner===this.config?.self||owner==='world'&&this.config?.role==='host'?unit.life:old?.wireLife??null,alive:u.alive});}
  unbind(key:string):void {this.bindings.delete(key);}
  key(ref:EntityRef):string|null {return [...this.bindings.values()].find(b=>sameRef(b.unit,ref))?.key??null;}
  life(key:string):number|undefined {return this.bindings.get(key)?.wireLife??undefined;}
  remap(old:EntityRef,next:EntityRef):void {for(const b of this.bindings.values())if(sameRef(b.unit,old)){b.unit=immutable(next);if(b.owner===this.config?.self||b.owner==='world'&&this.config?.role==='host')b.wireLife=(b.wireLife??old.life)+1;}}
  private local(){return this.config?this.services.playerByCharacter(this.config.localCharacter):null;}
  private actor(key:string|undefined):SimUnit|null {const b=key?this.bindings.get(key):null;return b?this.services.getUnit(b.unit):null;}
  private binding(ref:EntityRef|null):Binding|undefined{return ref?[...this.bindings.values()].find(b=>sameRef(b.unit,ref)):undefined;}
  private lifetime(b:Binding|undefined,reported:number|undefined):boolean {return !this.config?.relayLife||reported===undefined||!!b&&b.wireLife!==null&&b.wireLife===reported;}
  private request(operation:LegacyRequest['operation']):void {if(!this.config)return;if(this.output.length>=this.limit)throw new RangeError('Legacy request capacity exceeded');if(!uint(this.nextRequest))throw new RangeError('Legacy request IDs exhausted');this.output.push(immutable({id:this.nextRequest++,room:this.config.room,epoch:this.config.epoch,tick:this.services.tick,operation}));}
  drain():readonly LegacyRequest[]{const result=Object.freeze(this.output);this.output=[];return result;}
  enqueue(packet:LegacyEnvelope):boolean {
    const c=this.config;if(!c||packet.room!==c.room||packet.epoch!==c.epoch||!Number.isSafeInteger(packet.sequence)||packet.sequence<0||packet.sequence<=(this.sequences.get(packet.sender)??-1))return false;
    if(packet.sender!==c.host&&![...this.bindings.values()].some(b=>b.owner===packet.sender))return false;
    if(this.inputs.length>=this.limit)throw new RangeError('Legacy input capacity exceeded');const owned=immutable(packet);this.sequences.set(packet.sender,packet.sequence);this.inputs.push(owned);return true;
  }
  flush():void {const inputs=this.inputs;this.inputs=[];for(const input of inputs)this.apply(input);}
  routeDamage(source:EntityRef|null,target:EntityRef,amount:number,options:HitOptions):number|null {
    const c=this.config;if(!c||this.applying)return null;
    const s=this.services,src=source?s.getUnit(source):null,dst=s.getUnit(target),local=this.local();if(!dst)return 0;
    const from=this.binding(source),to=this.binding(target),damage=Math.max(1,Math.round(amount));
    if(src&&local&&sameRef(src.ref,local.state.unit)&&to&&to.owner!=='world'&&to.owner!==c.self&&dst.kind==='player'){
      if(s.context.pvp==='disabled')return 0;this.request({kind:'duel',target:to.key,amount:damage,crit:options.crit,sourceLife:from?.wireLife??undefined,targetLife:to.wireLife??undefined});if(options.rage)local.gainRage?.(options.rage);src.lastCombat=s.time;return damage;
    }
    if(c.role==='follower'&&dst.reaction==='hostile'){
      if(!src||!local||!sameRef(src.ref,local.state.unit)||!to||!dst.alive||dst.hidden||dst.invulnerable)return 0;
      this.request({kind:'attack',target:to.key,amount:damage,crit:options.crit,rage:options.rage,sourceLife:from?.wireLife??undefined,targetLife:to.wireLife??undefined});src.lastCombat=dst.lastCombat=s.time;if(options.rage)local.gainRage?.(options.rage);return damage;
    }
    if(to&&to.owner!=='world'&&to.owner!==c.self&&dst.kind==='player'){
      if(c.role!=='host'||!src||src.reaction!=='hostile'||!dst.alive)return 0;
      this.request({kind:'hit',target:to.key,source:from?.key,amount:damage,crit:options.crit,sourceLife:from?.wireLife??undefined,targetLife:to.wireLife??undefined});dst.hp=Math.max(0,dst.hp-damage);dst.lastCombat=s.time;return damage;
    }
    return null;
  }
  reportDamage(source:EntityRef|null,target:EntityRef,amount:number,options:HitOptions):void {if(this.config?.role!=='host'||this.applying)return;const to=this.binding(target),from=this.binding(source);if(to?.owner==='world')this.request({kind:'hit',target:to.key,source:from?.key,amount,crit:options.crit,sourceLife:from?.wireLife??undefined,targetLife:to.wireLife??undefined});}
  onDeath(victim:EntityRef,killer:EntityRef|null):boolean {
    if(!this.config)return false;const binding=this.binding(victim),unit=this.services.getUnit(victim);if(!binding||binding.owner!=='world'||!unit||unit.reaction!=='hostile')return true;
    if(this.config.role==='host'&&!this.applying){if(this.nextDeath>1000000)throw new RangeError('Legacy death serial exhausted');const serial=this.nextDeath++;this.request({kind:'death',target:binding.key,serial,life:binding.wireLife??undefined});this.grant(binding,serial,killer);}
    else if(this.receiptInProgress)this.grant(binding,0,killer,this.receiptInProgress);
    return true;
  }
  private receipt(binding:Binding,serial:number,reported?:number):string {const c=this.config!;return c.relayLife&&reported!==undefined?JSON.stringify([c.room,binding.key,reported]):JSON.stringify([c.room,c.host,c.epoch,serial]);}
  private grant(binding:Binding,serial:number,killer:EntityRef|null,receipt=this.receipt(binding,serial,binding.wireLife??undefined)):void {if(this.receipts.has(receipt))return;this.ports.grantDeath(binding.unit,killer);this.receipts.add(receipt);}
  requestBeacon(lit:boolean):boolean {if(this.config?.role!=='follower')return false;this.request({kind:'beacon',lit});return true;}
  requestChallenge(ref:EntityRef):boolean {if(this.config?.role!=='follower')return false;const key=this.key(ref);if(key)this.request({kind:'challenge',target:key});return true;}
  private observe(value:LegacyUnitObservation):void {
    const b=this.bindings.get(value.key),u=b?this.services.getUnit(b.unit):null;if(!b||!u)return;
    if(![value.x,value.y,value.z,value.yaw,value.hp,value.maxHp,value.level,value.stun,value.slow,value.slowPct,value.rust,value.rustFor].every(Number.isFinite)||value.maxHp<=0||value.hp<0||value.hp>value.maxHp||value.level<1||value.life!==undefined&&!uint(value.life))return;
    const reported=this.config?.relayLife?value.life:undefined;
    if(reported!==undefined&&b.wireLife!==null&&reported<b.wireLife)return;
    if(reported!==undefined&&b.wireLife!==null&&reported>b.wireLife||reported===undefined&&!b.alive&&value.alive)b.unit=this.ports.advanceLife(b.unit);
    if(reported!==undefined)b.wireLife=reported;const died=b.alive&&!value.alive;b.alive=value.alive;
    Object.assign(u,{x:value.x,y:value.y,z:value.z,yaw:value.yaw,hp:value.hp,maxHp:value.maxHp,level:value.level,alive:value.alive,hidden:value.hidden,invulnerable:value.invulnerable,targetable:value.targetable,stunUntil:this.services.time+value.stun,slowUntil:this.services.time+value.slow,slowPct:value.slowPct,rust:value.rust,rustUntil:this.services.time+value.rustFor});
    this.ports.observeEnemy(b.unit,value);if(died)this.ports.animate(b.unit,'death');
  }
  private apply(packet:LegacyEnvelope):void {
    const c=this.config;if(!c||packet.room!==c.room||packet.epoch!==c.epoch)return;
    const op=packet.operation,host=packet.sender===c.host,s=this.services;
    if(op.kind==='observe'){if(!host&&op.units.some(v=>this.bindings.get(v.key)?.owner!==packet.sender))return;for(const unit of op.units)this.observe(unit);if(host)for(const boss of op.bosses??[]){const ref=this.bindings.get(boss.key)?.unit;if(ref)this.ports.observeBoss(ref,boss);}return;}
    const target='target'in op?this.actor(op.target):null,to='target'in op?this.bindings.get(op.target):undefined;
    if('targetLife'in op&&!this.lifetime(to,op.targetLife))return;
    if(op.kind==='death'){
      if(!host||!target||!to||!bounded(op.serial,1,1000000)||op.life!==undefined&&!uint(op.life))return;
      if(c.relayLife&&op.life!==undefined){if(to.wireLife!==null&&op.life<to.wireLife)return;if(to.wireLife!==null&&op.life>to.wireLife)to.unit=this.ports.advanceLife(to.unit);to.wireLife=op.life;}
      const receipt=this.receipt(to,op.serial,c.relayLife?op.life:undefined);if(this.receipts.has(receipt))return;
      this.applying=true;this.receiptInProgress=receipt;try{if(target.alive)s.combat.kill(to.unit,this.local()?.state.unit??null);else this.grant(to,op.serial,this.local()?.state.unit??null,receipt);}finally{this.applying=false;this.receiptInProgress=null;}to.alive=false;return;
    }
    if(op.kind==='attack'||op.kind==='condition'||op.kind==='duel'){
      if(c.role!=='host'||host)return;const from=[...this.bindings.values()].find(b=>b.owner===packet.sender),source=from?s.getUnit(from.unit):null;
      if(!source?.alive||!target?.alive||target.hidden||target.invulnerable||Math.hypot(source.x-target.x,source.z-target.z)>=38||!this.lifetime(from,op.sourceLife))return;
      if(op.kind==='attack'){if(target.reaction==='hostile'&&bounded(op.amount,1,Number.MAX_SAFE_INTEGER))s.combat.damage(source.ref,target.ref,op.amount,{crit:op.crit});}
      else if(op.kind==='duel'){if(s.context.pvp!=='disabled'&&bounded(op.amount,1,Number.MAX_SAFE_INTEGER)){if(to?.owner===c.self)s.combat.damage(source.ref,target.ref,op.amount,{crit:op.crit});else this.request({kind:'hit',target:to!.key,amount:Math.max(1,Math.round(op.amount)),crit:op.crit,targetLife:to?.wireLife??undefined});}}
      else if(op.kind==='condition'){const f=op.condition;if(![f.stun,f.slow,f.slowPct,f.pushX,f.pushZ,f.pushTime].every(Number.isFinite)||target.reaction!=='hostile')return;target.stunUntil=Math.max(target.stunUntil,s.time+Math.max(0,Math.min(2,f.stun)));if(f.stun>0)s.cancelPendingHit(target.ref);if(f.slow>0){target.slowUntil=Math.max(target.slowUntil,s.time+Math.min(4,f.slow));target.slowPct=Math.max(0,Math.min(.5,f.slowPct));}if(f.pushTime>0&&target.kind!=='boss'){target.pushX=f.pushX;target.pushZ=f.pushZ;target.pushTime=Math.min(.5,f.pushTime);}}return;
    }
    if(op.kind==='hit'){if(!host||!target||!bounded(op.amount,1,Number.MAX_SAFE_INTEGER))return;const from=op.source?this.bindings.get(op.source):undefined;if(!this.lifetime(from,op.sourceLife))return;if(to?.owner===c.self){this.applying=true;try{s.combat.damage(from?.unit??null,target.ref,op.amount,{crit:op.crit});}finally{this.applying=false;}}else s.emit({type:'damage',src:from?.unit??null,dst:target.ref,amount:op.amount,crit:!!op.crit});return;}
    if(op.kind==='effect'){if(!host||!target||to?.owner!==c.self)return;const f=op.effect;if(!Object.values(f).every(Number.isFinite))return;target.stunUntil=Math.max(target.stunUntil,s.time+f.stun);if(f.rustFor>0){target.rust=f.rust;target.rustUntil=s.time+f.rustFor;}if(f.pushTime>0){const left=Math.max(0,target.pushTime),seconds=left+f.pushTime;target.pushX=(target.pushX*left+f.pushX*f.pushTime)/seconds;target.pushZ=(target.pushZ*left+f.pushZ*f.pushTime)/seconds;target.pushTime=seconds;}return;}
    if(op.kind==='animation'){if(host&&target)this.ports.animate(target.ref,op.action);return;}
    if(op.kind==='beacon'){if(c.role==='host'&&!host)this.ports.setBeacon(op.lit);return;}
    if(op.kind==='challenge'&&c.role==='host'&&!host&&target){const source=[...this.bindings.values()].find(b=>b.owner===packet.sender),unit=source?s.getUnit(source.unit):null;if(unit?.alive&&unit.level>=target.level)this.ports.challenge(target.ref);}
  }
  debugState(){return immutable({config:this.config,bindings:[...this.bindings.values()],inputs:this.inputs,requests:this.output,sequences:[...this.sequences],receipts:[...this.receipts],nextRequest:this.nextRequest,nextDeath:this.nextDeath});}
}
