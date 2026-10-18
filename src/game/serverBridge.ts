import * as THREE from 'three';
import type {Game} from './game';
import {Unit} from './unit';
import {createMotionController} from '../motion/provider';
import {WorldClient} from '../multiplayer/worldClient.ts';
import {WorldPresentation} from '../multiplayer/worldPresentation.ts';
import {WorldView,worldActorKey} from '../multiplayer/worldView.ts';
import type {GameplayCatalog,GameplayState,PublicActor} from '../../server/world/gameplay/protocol.ts';
import type {GameplayCommand} from '../../server/world/gameplay/intents.ts';
import type {EntityRef,EquipmentResult,EquipmentSlot} from '../sim/types.ts';
import {CLASSES} from '../data/classes';
import {QUESTS,NPCS} from './quests';
import {t} from '../i18n';

/** Authenticated observation/input integration. No Area, numeric controller or local save import. */
export class ServerGameBridge {
 readonly client:WorldClient;
 readonly view:WorldView;
 readonly presentation:WorldPresentation;
 private incomplete=new Set<string>();
 private state:GameplayState|null=null;
 private units=new Map<string,Unit>();
 private self:Unit|null=null;
 private requestId=0;
 private transactions=new Map<number,{resolve:(r:EquipmentResult)=>void;reject:(e:Error)=>void}>();
 private status=document.createElement('div');
 private disposed=false;
 static async create(game:Game,character:string):Promise<ServerGameBridge>{
  const response=await fetch('/api/account/world-catalog',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('World catalog unavailable');
  const catalog=await response.json() as GameplayCatalog;if(!character)character=await this.selectCharacter(game);if(!game.alive)throw new Error('Game closed');return new ServerGameBridge(game,character,catalog);
 }
 private static selectCharacter(game:Game):Promise<string>{
  return new Promise((resolve,reject)=>{
   const panel=document.createElement('section'),title=document.createElement('h2'),list=document.createElement('div'),message=document.createElement('p'),create=document.createElement('button'),refresh=document.createElement('button'),login=document.createElement('button');
   panel.className='world-character-select';panel.style.cssText='position:absolute;inset:18% 20% auto;padding:24px;background:#152331;color:white;z-index:110;max-height:65vh;overflow:auto';title.textContent=t('서버 캐릭터 선택','Choose server character');create.textContent=t('현재 외형으로 새 캐릭터 만들기','Create a new character with this appearance');refresh.textContent=t('목록 새로고침','Refresh list');login.textContent=t('Google 계정','Google account');panel.append(title,list,message,create,refresh,login);game.app.ui.append(panel);
   const abort=new AbortController();let busy=false;
   const cleanup=()=>{clearInterval(watch);abort.abort();panel.remove();};
   const choose=(id:string)=>{cleanup();const url=new URL(location.href);url.searchParams.set('character',id);history.replaceState(null,'',url);resolve(id);};
   const failure=(status:number)=>{message.textContent=status===401?t('Google 로그인이 필요합니다.','Google login is required.'):status===409?t('계정의 캐릭터 생성 한도에 도달했습니다.','The character limit for this account has been reached.'):status===503?t('서버 캐릭터 생성이 아직 활성화되지 않았습니다.','Server character creation is not enabled.'):t('요청을 처리하지 못했습니다. 다시 시도해 주세요.','The request failed. Try again.');};
   const load=async()=>{if(busy)return;busy=true;try{const response=await fetch('/api/account/world-characters?limit=100',{headers:{'X-Crabcraft-Account':'1'},credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!response.ok){failure(response.status);return;}const data=await response.json();if(!Array.isArray(data.characters))throw new Error('Invalid character list');list.replaceChildren();for(const record of data.characters){if(typeof record.characterId!=='string'||!record.identity?.appearance)throw new Error('Invalid character entry');const button=document.createElement('button');button.textContent=`${record.identity.appearance.name} (${record.identity.appearance.classId})`;button.onclick=()=>choose(record.characterId);list.append(button);}message.textContent=data.characters.length?'':t('서버 캐릭터가 없습니다. 새 캐릭터를 만들어 주세요.','No server character yet. Create a new character.');}catch(error){if(!abort.signal.aborted)failure(500);}finally{busy=false;}};
   create.onclick=async()=>{if(busy)return;busy=true;create.disabled=true;try{const s=game.app.spec??game.player.unit.rig.spec,appearance={race:s.race,sex:s.sex,classId:s.classId,shell:s.shell,crest:s.crest,led:s.led,name:s.name};const response=await fetch('/api/account/world-characters',{method:'POST',headers:{'Content-Type':'application/json','X-Crabcraft-Account':'1'},credentials:'same-origin',cache:'no-store',signal:abort.signal,body:JSON.stringify({appearance})});if(!response.ok){failure(response.status);return;}const data=await response.json();if(typeof data.character?.characterId!=='string')throw new Error('Invalid created character');choose(data.character.characterId);}catch{if(!abort.signal.aborted)message.textContent=t('응답을 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.','The response was not confirmed. Refresh the list before trying again.');}finally{busy=false;create.disabled=false;}};
   refresh.onclick=()=>void load();login.onclick=()=>game.app.account.show();const watch=setInterval(()=>{if(!game.alive){cleanup();reject(new Error('Game closed during character selection'));}},100);void load();
  });
 }
 private constructor(private game:Game,character:string,catalog:GameplayCatalog){
  this.status.className='world-connection-status';this.status.style.cssText='position:absolute;inset:42% 20% auto;padding:20px;background:#152331;color:white;text-align:center;z-index:100;pointer-events:auto';game.app.ui.append(this.status);
  for(const unit of game.units){unit.rig.root.visible=false;unit.rig.root.removeFromParent();unit.dispose();}game.units=[];
  game.voyageIsland?.dispose();game.voyageIsland=null;game.objective.group.visible=false;
  this.presentation=new WorldPresentation({unit:ref=>this.unit(ref),self:()=>this.self,vfx:game.vfx,hud:game.hud,audio:game.audio,follow:game.follow,time:()=>game.time,say:(u,text,yell)=>game.say(u,text,yell),onEquipment:e=>{if(e.request){this.transactions.get(e.request)?.resolve(e.result);this.transactions.delete(e.request);}},onQuest:()=>game.hud.tracker.update(game.quests),onIncomplete:feature=>this.incomplete.add(feature)});
  this.view=new WorldView({root:game.scene,onAdded:(actor,handle)=>{
   const npc=NPCS.find(n=>n.id===actor.npcId),name=actor.appearance?.name??npc?.name??actor.archetype;
   const unit=new Unit(name,actor.kind,actor.reaction,handle.rig,createMotionController(handle.rig));unit.npcId=actor.npcId??'';unit.bindWorldView(handle.readState);this.units.set(worldActorKey(actor.ref),unit);game.units.push(unit);
   if(this.state&&worldActorKey(this.state.selfRef)===worldActorKey(actor.ref))this.bindSelf(unit,actor);
  },onRemoved:ref=>{const key=worldActorKey(ref),u=this.units.get(key);if(u){game.units=game.units.filter(x=>x!==u);this.units.delete(key);if(this.self===u)this.self=null;}},onError:()=>this.notice('Cannot load server actor'),onEvents:records=>this.presentation.events(records)});
  this.client=new WorldClient({catalog,resetInput:()=>game.input.reset(),onState:(state)=>{this.status.hidden=state==='admitted'&&!!this.self;if(!this.status.hidden)this.status.textContent=state==='authRequired'?'Google login required':`Server: ${state}`;},onSnapshot:(state,events,results)=>{
   this.state=state;game.time=state.time;game.beaconLit=state.features.environment.beacon;game.world.setBeaconLit(game.beaconLit);game.world2.observeChapter(Number(state.world.slice(1)) as 1|2|3|4);this.presentation.commit(state);this.view.commit(state,events,results);const unit=this.units.get(worldActorKey(state.selfRef));if(unit&&unit!==this.self)this.bindSelf(unit,state.actors.find(a=>worldActorKey(a.ref)===worldActorKey(state.selfRef))!);if(this.self){game.hud.targetFrame.setUnit(this.unit(state.self.player.target));game.hud.tracker.update(game.quests);game.hud.showDeath(!this.self.alive);}this.status.hidden=this.client.state==='admitted'&&!!this.self;
  },onEvents:(events,results)=>this.view.events(events,results),onReset:()=>{this.state=null;this.self=null;this.presentation.reset();this.view.reset();game.hud.targetFrame.setUnit(null);game.hud.dialogue.close();for(const p of this.transactions.values())p.reject(new Error('Connection changed before confirmation'));this.transactions.clear();},onRejected:code=>this.notice(code)});
  game.hud.dialogue.onClose=()=>this.command({kind:'talkEnd'});
  void this.client.connect(character).catch(error=>this.notice(error instanceof Error?error.message:'Connection failed'));
 }
 get ready():boolean{return !!this.self&&!!this.state;}
 get locked():boolean {return !this.ready||this.client.state!=='admitted'||!!this.state?.self.player.controlsLocked;}
 private notice(text:string):void{this.status.hidden=false;this.status.textContent=text;}
 command(command:GameplayCommand):boolean{return this.client.command(command);}
 private unit(ref:EntityRef|null|undefined):Unit|null{return ref?this.units.get(worldActorKey(ref))??null:null;}
 private bindSelf(unit:Unit,actor:Readonly<PublicActor>):void {
  const g=this.game,p=g.player;this.self=unit;unit.ctrl=p;
  Object.defineProperty(p,'unit',{configurable:true,get:()=>this.self??unit});Object.defineProperty(p,'cls',{configurable:true,get:()=>CLASSES[this.state!.self.player.classId]});
  for(const key of ['resource','maxResource','xp','coins','attackRank','armorRank','weaponOwned','armorOwned','baseMaxHp','gcdStart','gcdEnd','nextSwing','lastAttack','velX','velZ','jumpT','spinT','lastSpend','targetDeadAt'] as const)Object.defineProperty(p,key,{configurable:true,get:()=>this.state!.self.player[key],set:()=>{throw new Error('Server progression is readonly');}});
  Object.defineProperty(p,'inCombat',{configurable:true,get:()=>{const value=Reflect.get(this.state!.self,'inCombat');if(typeof value!=='boolean')throw new Error('Missing authoritative combat view');return value;}});
  Object.defineProperty(p,'cooldowns',{configurable:true,get:()=>new Map(Object.entries(this.state!.self.player.cooldowns))});
  Object.defineProperty(p,'target',{configurable:true,get:()=>this.unit(this.state?.self.player.target),set:(u:Unit|null)=>this.command({kind:'target',target:u?.ref??null})});
  Object.defineProperty(p,'cast',{configurable:true,get:()=>{const c=this.state?.self.player.cast;return c?{...c,ability:p.cls.abilities.find(a=>a.id===c.ability)!,target:this.unit(c.target)}:null;}});
  Object.defineProperty(p,'channel',{configurable:true,get:()=>{const c=this.state?.self.player.channel;return c?{...c,label:c.kind,key:c.kind==='recall'?'KeyT':'KeyF',to:new THREE.Vector3(c.to.x,c.to.y,c.to.z),onDone:()=>{throw new Error('Server owns channel completion');}}:null;}});
  p.setTarget=u=>{this.command({kind:'target',target:u?.ref??null});};p.useAbility=slot=>{this.command({kind:'ability',slot:slot as 1|2|3|4|5});};p.toggleBreakdance=()=>{this.command({kind:'dance'});};p.returnToSquare=()=>{this.command({kind:'channelStart',channel:'recall'});};
  p.interruptCast=()=>{this.command({kind:'cancel'});};p.cancelChannel=()=>{this.command({kind:'cancel'});};
  p.tabTarget=()=>{const targets=g.units.filter(u=>u.hostile&&u.alive&&!u.hidden&&u.targetable&&unit.distTo(u)<35).sort((a,b)=>unit.distTo(a)-unit.distTo(b));const index=targets.indexOf(p.target!);p.setTarget(targets[(index+1)%targets.length]??null);};
  const readonly=()=>{throw new Error('Server owns player mutations');};p.gainXp=readonly;p.restoreXp=readonly;p.gainRage=readonly;p.respawn=readonly;p.buyEquipment=readonly;p.upgradeEquipment=readonly;p.startChannel=readonly;
  const q=g.quests;for(const key of ['status','tracked','cogs','chapter'] as const)Object.defineProperty(q,key,{configurable:true,get:()=>this.state!.self.player.quests[key]});Object.defineProperty(q,'progress',{configurable:true,get:()=>new Map(Object.entries(this.state!.self.player.quests.progress))});q.accept=id=>{this.command({kind:'questAccept',questId:id,npcId:QUESTS[id].giver});};q.complete=id=>{this.command({kind:'questTurnIn',questId:id,npcId:QUESTS[id].turnIn??QUESTS[id].giver});};q.track=id=>this.command({kind:'questTrack',questId:id});q.bump=readonly;
  g.hud.actionBar.bindClass();g.hud.playerFrame.setUnit(unit,actor.appearance?`art/portraits/${actor.appearance.race}-${actor.appearance.sex}.webp`:null);g.follow.lookHeight=Math.max(.8,unit.height*.85+.25);g.follow.yaw=unit.yaw+Math.PI;g.follow.cut();this.status.hidden=this.client.state==='admitted';
 }
 frame(dt:number,elapsed:number):void {
  if(this.disposed)return;const g=this.game;this.client.pump(performance.now());if(!this.ready)return;
  const input=g.input;
  if(input.wasPressed('Escape')){if(g.hud.dialogue.isOpen)g.hud.dialogue.close();else if(g.hud.menu.open)g.hud.menu.close();else if(g.player.cast||g.player.channel)this.command({kind:'cancel'});else if(g.player.target)this.command({kind:'target',target:null});else g.toggleMenu();}
  if(!g.controlsLocked){if(input.wasPressed('Tab'))g.player.tabTarget();for(let slot=1;slot<=5;slot++)if(input.wasPressed(`Digit${slot}`)||input.wasPressed(`Numpad${slot}`))g.player.useAbility(slot);if(input.wasPressed('KeyT'))this.command({kind:'channelStart',channel:'recall'});if(input.wasPressed('KeyL'))g.hud.questLog.toggle();if(input.wasPressed('KeyF')){if(g.hud.dialogue.isOpen){if(g.hud.dialogue.typing)g.hud.dialogue.skipTyping();else g.hud.dialogue.choosePrimary();}else{const near=g.units.filter(u=>u.npcId&&u.alive&&!u.hidden&&this.self!.distTo(u)<7).sort((a,b)=>this.self!.distTo(a)-this.self!.distTo(b))[0];if(near)this.talk(near);}}
   for(const button of [0,2] as const)if(input.wasClicked(button)){const u=g.player.pick(input.mouseX,input.mouseY);if(u)g.player.setTarget(u);}}
  this.client.capture(g,dt,this.state!.self.player.channel?.kind??null);this.client.pump(performance.now());this.view.render(performance.now(),dt);this.presentation.render(dt);
  g.follow.update(dt,g.input,this.self!.pos);g.vfx.update(dt);g.world.update(dt,elapsed,g.camera);g.world2.update(dt,this.state!.time,{flags:this.state!.self.player.flags});g.hud.minimap.setZone(g.world2.chapter===1?'Clawhaven':g.world2.regionAt(this.self!.pos.x,this.self!.pos.z),false);g.hud.update(dt);
  for(const unit of g.units)unit.updateVisual(dt);
 }
 talk(unit:Unit):void {
  const id=unit.npcId;if(!id)return;const g=this.game;this.command({kind:'interact',targetId:`npc:${id}`});
  const npc=g.npcs.find(n=>n.def.id===id);if(npc)Object.defineProperty(npc,'unit',{configurable:true,value:unit});
  if(id==='pip'&&npc){g.hud.forge.show(npc,()=>this.dialogue(unit));return;}this.dialogue(unit);
 }
 private dialogue(unit:Unit):void {const g=this.game,id=unit.npcId!,q=g.quests,ready=q.readyAt(id as never),offer=q.offeredBy(id as never),quest=ready??offer;
  if(!quest){g.hud.dialogue.open({unit,portraitArt:`art/npc/${id}.webp`,paragraphs:[t('모험 중에는 조심하세요.','Take care on your journey.')],buttons:[{label:t('닫기','Close'),onClick:()=>g.hud.dialogue.close()}]});return;}
  const def=QUESTS[quest];g.hud.dialogue.open({unit,portraitArt:`art/npc/${id}.webp`,questId:quest,questTitle:def.title,paragraphs:ready?def.complete:def.offer,rewardXp:def.xp,buttons:[{label:ready?t('보상 받기','Complete Quest'):t('퀘스트 받기','Accept quest'),primary:true,onClick:()=>{this.command({kind:ready?'questTurnIn':'questAccept',questId:quest,npcId:id});g.hud.dialogue.close();}}]});
 }
 forge(slot:EquipmentSlot,operation:'buy'|'upgrade',npcId='pip'):Promise<EquipmentResult>{const request=++this.requestId;return new Promise((resolve,reject)=>{if(this.transactions.size>=32||!this.command({kind:operation==='buy'?'forgeBuy':'forgeUpgrade',npcId,slot,request})){reject(new Error('Server command unavailable'));return;}this.transactions.set(request,{resolve,reject});});}
 diagnostics(){return {state:this.client.state,header:this.state?.header,world:this.state?.world,self:this.state?.self,actorCount:this.units.size,incomplete:[...this.incomplete],input:this.client.inputWatermarks,position:this.self?.pos.toArray()};}
 dispose():void {if(this.disposed)return;this.disposed=true;this.client.dispose();this.presentation.dispose();this.view.dispose();this.status.remove();for(const p of this.transactions.values())p.reject(new Error('World view disposed'));this.transactions.clear();}
}
