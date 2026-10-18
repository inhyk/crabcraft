import * as THREE from 'three';
import type {Game} from './game';
import {Unit} from './unit';
import {createMotionController} from '../motion/provider';
import {ServerSocial} from './serverSocial';
import {WorldClient} from '../multiplayer/worldClient.ts';
import {WorldPresentation} from '../multiplayer/worldPresentation.ts';
import {WorldView,worldActorKey} from '../multiplayer/worldView.ts';
import type {GameplayCatalog,GameplayState,PublicActor,WorldControl} from '../../server/world/gameplay/protocol.ts';
import type {GameplayCommand} from '../../server/world/gameplay/intents.ts';
import type {EntityRef,EquipmentResult,EquipmentSlot} from '../sim/types.ts';
import {CLASSES} from '../data/classes';
import {QUESTS,NPCS} from './quests';
import {t} from '../i18n';
import {LighthouseSecret} from './lighthouseSecret';
import {Achievements} from './achievements';
import {BOSS_PROFILES} from './progression';
import {ShoreBoat} from './shoreBoat';
import {ENEMY_STATS} from './enemies';
import type {ChannelKind} from '../sim/types.ts';

/** Authenticated observation/input integration. No Area, numeric controller or local save import. */
export class ServerGameBridge {
 readonly client:WorldClient;
 readonly social:ServerSocial;
 readonly view:WorldView;
 readonly presentation:WorldPresentation;
 private incomplete=new Set<string>();
 private readonly hostedGates:ReadonlySet<string>;
 private readonly hostedBosses:ReadonlySet<string>;
 private state:GameplayState|null=null;
 private units=new Map<string,Unit>();
 private self:Unit|null=null;
 private requestId=0;
 private requestedChannel:ChannelKind|null=null;
 private party:Extract<WorldControl,{type:'party'}>['state']=null;
 private partyPanel:HTMLDialogElement|null=null;
 private nextBoatDrive=0;
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
  this.hostedGates=new Set(catalog.gates);
  this.hostedBosses=new Set(catalog.archetypes.filter(id=>id.startsWith('boss-')).map(id=>id.slice(5)));
  this.status.className='world-connection-status';this.status.style.cssText='position:absolute;inset:42% 20% auto;padding:20px;background:#152331;color:white;text-align:center;z-index:100;pointer-events:auto';game.app.ui.append(this.status);
  for(const unit of game.units){unit.rig.root.visible=false;unit.rig.root.removeFromParent();unit.dispose();}game.units=[];
  game.boats=new ShoreBoat(game,true);game.lighthouseSecret=new LighthouseSecret(game,true);game.achievements=new Achievements(game,true);game.objective.group.visible=false;
  this.social=new ServerSocial({parent:game.app.ui,command:command=>this.command(command),resetInput:()=>game.input.reset(),line:control=>{game.hud.chat.say(control.channel==='party'?t(`[파티] ${control.line.name}`,`[Party] ${control.line.name}`):control.line.name,control.line.text);const unit=this.unit(control.line.sender);if(unit)game.hud.bubbles.say(game,unit,control.line.text);}});
  this.presentation=new WorldPresentation({unit:ref=>this.unit(ref),self:()=>this.self,vfx:game.vfx,hud:game.hud,audio:game.audio,follow:game.follow,time:()=>game.time,say:(u,text,yell)=>game.say(u,text,yell),onEquipment:e=>{if(e.request){this.transactions.get(e.request)?.resolve(e.result);this.transactions.delete(e.request);}},onQuest:()=>game.hud.tracker.update(game.quests),onExploration:state=>{game.lighthouseSecret?.observe(state.found,state.activeUntil);game.voyageIsland?.observe(state.earned,this.state?Number(this.state.world.slice(1)):1);},onIncomplete:feature=>this.incomplete.add(feature)});
  this.view=new WorldView({root:game.scene,onAdded:(actor,handle)=>{
   const npc=NPCS.find(n=>n.id===actor.npcId),name=actor.appearance?.name??npc?.name??actor.archetype;
   const unit=new Unit(name,actor.kind,actor.reaction,handle.rig,createMotionController(handle.rig));unit.npcId=actor.npcId??'';unit.bindWorldView(handle.readState);this.labelUnit(unit,actor);this.units.set(worldActorKey(actor.ref),unit);game.units.push(unit);
   if(this.state&&worldActorKey(this.state.selfRef)===worldActorKey(actor.ref))this.bindSelf(unit,actor);
  },onRemoved:ref=>{const key=worldActorKey(ref),u=this.units.get(key);if(u){game.units=game.units.filter(x=>x!==u);this.units.delete(key);if(this.self===u)this.self=null;}},onError:()=>this.notice('Cannot load server actor'),onEvents:records=>this.presentation.events(records)});
  this.client=new WorldClient({catalog,resetInput:()=>game.input.reset(),onState:(state)=>{this.status.hidden=state==='admitted'&&!!this.self;if(!this.status.hidden)this.status.textContent=state==='authRequired'?'Google login required':`Server: ${state}`;},onSnapshot:(state,events,results)=>{
   this.state=state;game.achievements?.observe(state.self.achievements);game.boats?.observe(state.features.boat,state.selfRef);game.time=state.time;game.beaconLit=state.features.environment.beacon;game.world.setBeaconLit(game.beaconLit);game.world2.observeChapter(Number(state.world.slice(1)) as 1|2|3|4|5|6);this.presentation.commit(state);this.view.commit(state,events,results);const unit=this.units.get(worldActorKey(state.selfRef));if(unit&&unit!==this.self)this.bindSelf(unit,state.actors.find(a=>worldActorKey(a.ref)===worldActorKey(state.selfRef))!);if(this.self){game.hud.targetFrame.setUnit(this.unit(state.self.player.target));game.hud.tracker.update(game.quests);game.hud.showDeath(!this.self.alive);}this.status.hidden=this.client.state==='admitted'&&!!this.self;
  },onEvents:(events,results)=>this.view.events(events,results),onReset:()=>{this.social.reset();this.party=null;this.requestedChannel=null;this.state=null;this.self=null;this.presentation.reset();this.view.reset();game.hud.targetFrame.setUnit(null);game.hud.dialogue.close();for(const p of this.transactions.values())p.reject(new Error('Connection changed before confirmation'));this.transactions.clear();},onControl:control=>{this.social.observe(control);if(control.type==='party'){this.party=control.state;if(this.partyPanel?.open)this.renderParty();}},onRejected:code=>game.hud.messages.error(code)});
  game.hud.dialogue.onClose=()=>this.command({kind:'talkEnd'});
  void this.client.connect(character).catch(error=>this.notice(error instanceof Error?error.message:'Connection failed'));
 }
 get ready():boolean{return !!this.self&&!!this.state;}
 get locked():boolean {const round=this.state?.features.village,ref=this.state?.selfRef,same=(r:EntityRef|null)=>!!r&&!!ref&&worldActorKey(r)===worldActorKey(ref);return !this.ready||this.client.state!=='admitted'||this.social.open||!!this.partyPanel?.open||!!this.state?.self.player.controlsLocked||this.seated||!!round&&round.phase!=='done'&&(round.caught.some(same)||round.phase==='ready'&&same(round.seeker));}
 get seated():boolean{return !!this.state?.features.boat?.seats.some(ref=>ref&&worldActorKey(ref)===worldActorKey(this.state!.selfRef));}
 get villagePlaying():boolean{return !!this.state?.features.village&&this.state.features.village.phase!=='done';}
 concealMap(unit:Unit):boolean{return this.villagePlaying&&this.state?.features.village?.mode==='hide'&&(unit.kind==='townsfolk'||unit.kind==='player'&&unit!==this.self);}
 mapParty(unit:Unit):{party:number;teammate:boolean}{return {party:1,teammate:!!unit.ref&&!!this.party?.members.some(m=>m.ref&&worldActorKey(m.ref)===worldActorKey(unit.ref!))};}
 attackable(unit:Unit):boolean{return unit.hostile||unit.kind==='player'&&unit!==this.self&&Reflect.get(this.state?.features.environment??{},'mode')==='party-encounter'&&Reflect.get(this.state?.features.environment??{},'pvp')==='party-only'&&this.mapParty(unit).teammate;}
 showFriends():void {if(!this.partyPanel){this.partyPanel=document.createElement('dialog');this.partyPanel.className='account-dialog';this.partyPanel.addEventListener('close',()=>this.game.input.reset());this.partyPanel.addEventListener('keydown',e=>e.stopPropagation());this.game.app.ui.append(this.partyPanel);}this.renderParty();if(!this.partyPanel.open)this.partyPanel.showModal();this.game.input.reset();}
 private renderParty():void {const panel=this.partyPanel;if(!panel)return;panel.replaceChildren();const heading=document.createElement('h2');heading.textContent=t('서버 파티','Server party');panel.append(heading);const button=(label:string,fn:()=>void,disabled=false)=>{const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.onclick=fn;panel.append(b);};
  if(!this.party){button(t('파티 만들기','Create party'),()=>this.command({kind:'partyCreate'}));const input=document.createElement('input');input.placeholder=t('6자리 파티 코드','6-character party code');input.maxLength=6;input.setAttribute('aria-label',input.placeholder);panel.append(input);button(t('참가','Join'),()=>this.command({kind:'partyJoin',code:input.value.trim().toUpperCase()}));}
  else{const info=document.createElement('p');info.textContent=`${this.party.code} (${this.party.members.length}/8)`;panel.append(info);for(const m of this.party.members){const row=document.createElement('p');row.textContent=`${m.id===this.party.leader?'★ ':''}${m.name} - ${m.world}${m.online?'':' (offline)'}`;panel.append(row);}const leader=this.party.members.find(m=>m.id===this.party!.leader),isLeader=!!leader?.ref&&!!this.self?.ref&&worldActorKey(leader.ref)===worldActorKey(this.self.ref);button(this.party.pvp?t('개인 파티 전투의 PvP 끄기','Disable private-party PvP'):t('개인 파티 전투의 PvP 켜기','Enable private-party PvP'),()=>this.command({kind:'partyPvp',enabled:!this.party!.pvp}),!isLeader);button(t('파티 나가기','Leave party'),()=>this.command({kind:'partyLeave'}));button(t('보스 전투에서 돌아가기','Return from encounter'),()=>this.command({kind:'encounterLeave'}));}
  if(this.state){const profiles=this.state.world==='w1'?['rust','abyss'] as const:this.state.world==='w2'?['eclipse'] as const:this.state.world==='w3'?['dawn'] as const:this.state.world==='w4'?['frost'] as const:this.state.world==='w5'?['ember'] as const:['sky'] as const;for(const profile of profiles){if((profile==='ember'||profile==='sky')&&!this.hostedBosses.has(profile))continue;const boss=BOSS_PROFILES[profile];button(`${boss.name} (${boss.level})`,()=>this.command({kind:'bossChallenge',profile}),!this.party);}if(this.state.self.player.flags.frostCleared)button(t('엔딩 다시 보기','Replay ending'),()=>this.command({kind:'endingReplay'}));}
  button(t('닫기','Close'),()=>panel.close());
 }
 private labelUnit(unit:Unit,actor:Readonly<PublicActor>):void {
  if(actor.appearance){unit.name=actor.appearance.name;return;}
  const chapter=this.state?Number(this.state.world.slice(1)):1,npc=NPCS.find(n=>n.id===actor.npcId);
  if(npc){unit.name=npc.name;unit.title=npc.title;if(chapter===3){const names=[['새벽 항구의 로안 선장','Captain Roan'],['새벽의 사제 셀레네','Selene of Dawn'],['의무관 산호','Medic Coral'],['성문 수비대장 바론','Gatewarden Baron'],['여관주인 메리','Innkeeper Merry'],['항해사 루멘','Navigator Lumen'],['대장장이 플린','Smith Flynn']];const name=names[NPCS.indexOf(npc)]!;unit.name=t(name[0]!,name[1]!);unit.title=t('새벽 항구의 주민','Dawnharbor Resident');}else if(chapter===4)unit.title=t('눈꽃 마을의 주민','Snowfall Village Resident');else if(chapter===5)unit.title=t('잿불 원정대 주민','Emberreach Expedition Resident');else if(chapter===6)unit.title=t('하늘숲 원정대 주민','Skybloom Expedition Resident');return;}
  const profile=actor.archetype.replace(/^boss-/,'');if(actor.kind==='boss'&&profile in BOSS_PROFILES){const boss=BOSS_PROFILES[profile as keyof typeof BOSS_PROFILES];unit.name=boss.name;unit.title=boss.title;return;}
  if(actor.archetype==='freed-ember'){unit.name=t('잿불의 수호자','Emberkeeper');return;}if(actor.archetype==='freed-sky'){unit.name=t('바람의 수호자','Windkeeper');return;}
  if(actor.archetype==='freed-frost'){unit.name=t('미라 · 사라진 친구','Mira · The Missing Friend');return;}if(actor.archetype==='freed-dawn'){unit.name=t('새벽 성채의 수호자','Dawnkeeper');return;}if(actor.archetype==='freed-eclipse'){unit.name='돌아온 별빛';return;}
  if(actor.kind==='scrapling'||actor.kind==='scavenger'||actor.kind==='jellyfish'){unit.name=ENEMY_STATS[actor.kind].name;if(chapter===2)unit.name=actor.kind==='scrapling'?t('수정 껍질 파수꾼','Crystal-shell Sentry'):t('별빛 유적 수호자','Star-ruin Guardian');else if(chapter===3)unit.name=actor.kind==='scrapling'?t('잿빛 해안 약탈자','Ash Coast Raider'):t('황혼 성채 파수병','Twilight Sentinel');else if(chapter===4)unit.name=actor.kind==='scrapling'?t('서리 껍질 약탈자','Frost-shell Raider'):t('빙하 성채 파수병','Glacial Sentinel');else if(chapter===5)unit.name=actor.kind==='scrapling'?t('잿불 껍질 약탈자','Ember-shell Raider'):t('흑요석 유적 파수병','Obsidian Sentinel');else if(chapter===6)unit.name=actor.kind==='scrapling'?t('가시덩굴 약탈자','Thornvine Raider'):t('하늘숲 유적 수호자','Skybloom Guardian');return;}
  unit.name=unit.rig.spec.name;
 }
 refreshLanguage():void {for(const unit of this.units.values()){const actor=unit.ref&&this.view.actor(unit.ref)?.readState();if(actor)this.labelUnit(unit,actor);}if(this.partyPanel?.open)this.renderParty();}
 private notice(text:string):void{this.status.hidden=false;this.status.textContent=text;}
 command(command:GameplayCommand):boolean{if(command.kind==='bossChallenge'&&(command.profile==='ember'||command.profile==='sky')&&!this.hostedBosses.has(command.profile))return false;return this.client.command(command);}
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
  p.tabTarget=()=>{const targets=g.units.filter(u=>this.attackable(u)&&u.alive&&!u.hidden&&u.targetable&&unit.distTo(u)<35).sort((a,b)=>unit.distTo(a)-unit.distTo(b));const index=targets.indexOf(p.target!);p.setTarget(targets[(index+1)%targets.length]??null);};
  const readonly=()=>{throw new Error('Server owns player mutations');};p.gainXp=readonly;p.restoreXp=readonly;p.gainRage=readonly;p.respawn=readonly;p.buyEquipment=readonly;p.upgradeEquipment=readonly;p.startChannel=readonly;
  const q=g.quests;for(const key of ['status','tracked','cogs','chapter'] as const)Object.defineProperty(q,key,{configurable:true,get:()=>this.state!.self.player.quests[key]});Object.defineProperty(q,'progress',{configurable:true,get:()=>new Map(Object.entries(this.state!.self.player.quests.progress))});q.accept=id=>{this.command({kind:'questAccept',questId:id,npcId:QUESTS[id].giver});};q.complete=id=>{this.command({kind:'questTurnIn',questId:id,npcId:QUESTS[id].turnIn??QUESTS[id].giver});};q.track=id=>this.command({kind:'questTrack',questId:id});q.bump=readonly;
  g.hud.actionBar.bindClass();g.hud.playerFrame.setUnit(unit,actor.appearance?`art/portraits/${actor.appearance.race}-${actor.appearance.sex}.webp`:null);g.follow.lookHeight=Math.max(.8,unit.height*.85+.25);g.follow.yaw=unit.yaw+Math.PI;g.follow.cut();this.status.hidden=this.client.state==='admitted';
 }
 frame(dt:number,elapsed:number):void {
  if(this.disposed)return;const g=this.game;this.client.pump(performance.now());if(!this.ready)return;
  const input=g.input;if(this.seated){if(input.wasPressed('KeyF'))this.command({kind:'boat',command:{action:'leave',throttle:0,steer:0}});if(performance.now()>=this.nextBoatDrive){this.nextBoatDrive=performance.now()+1000/30;const free=!g.hud.menu.open&&!g.app.account.open&&!this.partyPanel?.open;this.command({kind:'boat',command:{action:'drive',throttle:free?Number(input.isDown('KeyW'))-Number(input.isDown('KeyS')):0,steer:free?Number(input.isDown('KeyA'))-Number(input.isDown('KeyD')):0}});}}
  if(input.wasPressed('Escape')){if(g.hud.dialogue.isOpen)g.hud.dialogue.close();else if(g.hud.menu.open)g.hud.menu.close();else if(g.player.cast||g.player.channel)this.command({kind:'cancel'});else if(g.player.target)this.command({kind:'target',target:null});else g.toggleMenu();}
  if(!g.controlsLocked){if(input.wasPressed('Tab'))g.player.tabTarget();for(let slot=1;slot<=5;slot++)if(input.wasPressed(`Digit${slot}`)||input.wasPressed(`Numpad${slot}`))g.player.useAbility(slot);if(input.wasPressed('KeyT'))this.command({kind:'channelStart',channel:'recall'});if(input.wasPressed('KeyL'))g.hud.questLog.toggle();if(input.wasPressed('KeyF')){if(g.hud.dialogue.isOpen){if(g.hud.dialogue.typing)g.hud.dialogue.skipTyping();else g.hud.dialogue.choosePrimary();}else this.interact();}
   for(const button of [0,2] as const)if(input.wasClicked(button)){const u=g.player.pick(input.mouseX,input.mouseY);if(u)g.player.setTarget(u);}}
  if(!input.isDown('KeyF'))this.requestedChannel=null;this.client.capture(g,dt,this.state!.self.player.channel?.kind??this.requestedChannel);this.client.pump(performance.now());this.view.render(performance.now(),dt);this.presentation.render(dt);
  g.follow.update(dt,g.input,this.self!.pos);g.vfx.update(dt);g.world.update(dt,elapsed,g.camera);g.world2.update(dt,this.state!.time,{flags:this.state!.self.player.flags});g.hud.minimap.setZone(g.world2.chapter===1?'Clawhaven':g.world2.regionAt(this.self!.pos.x,this.self!.pos.z),false);g.boats?.renderObserved(this.state!.time,g.world2.chapter);g.lighthouseSecret?.update();g.voyageIsland?.observe(this.state!.self.achievements.earned,g.world2.chapter);this.prompt();g.hud.update(dt);
  for(const unit of g.units)unit.updateVisual(dt);
 }
 private prompt():void {const g=this.game,p=this.self;if(!p||g.hud.dialogue.isOpen||g.hud.menu.open||g.app.account.open){g.hud.prompt.hide();return;}if(g.boats?.nearby()){g.hud.prompt.show('F',g.boats.label());return;}if(g.controlsLocked){g.hud.prompt.hide();return;}if(g.lighthouseSecret?.nearby()){g.hud.prompt.show('F',t('길게 눌러 비밀 살펴보기','Hold to inspect the secret'));return;}if(g.voyageIsland?.interactionId){g.hud.prompt.show('F',g.voyageIsland.treasurePrompt);return;}const node=g.world2.interactable();if(node){g.hud.prompt.show('F',node.kind.includes('lamp')?t('길게 눌러 등불 켜기','Hold to light lantern'):t('퀘스트 물품 모으기','Gather quest item'));return;}if(g.world2.chapter===1&&p.pos.distanceTo(g.world.pois.beacon.position)<3.5){g.hud.prompt.show('F',t('길게 눌러 등대 조작','Hold to use lighthouse'));return;}if(this.portalGate()){g.hud.prompt.show('F',g.world2.portalLabel());return;}const near=g.units.filter(u=>(u.npcId||u.kind==='townsfolk')&&u.targetable&&u.alive&&!u.hidden&&p.distTo(u)<7).sort((a,b)=>p.distTo(a)-p.distTo(b))[0];if(near)g.hud.prompt.show('F',t(`${near.name}에게 말 걸기`,`Talk to ${near.name}`));else g.hud.prompt.hide();}
 private portalGate():string|null {
  const g=this.game,p=this.self,chapter=g.world2.chapter,portal=g.world2.portalPosition;
  if(!p||Math.hypot(p.pos.x-portal.x,p.pos.z-portal.z)>=3.5)return null;
  const destination=chapter===1?2:chapter===6?5:chapter===5?(portal===g.world2.fifth.spawn?4:6):chapter===4?(Math.hypot(portal.x-14,portal.z-84)<1?5:3):chapter===3?(Math.hypot(portal.x-14,portal.z-84)<1?4:2):Math.hypot(portal.x,portal.z+41)<1?3:1;
  const gate=`gate:w${destination}`;return this.hostedGates.has(gate)?gate:null;
 }
 private interact():void {const g=this.game,p=this.self!,chapter=g.world2.chapter;
  if(g.boats?.nearby()){g.boats.interact();return;}
  if(g.lighthouseSecret?.nearby()){this.requestedChannel='lighthouse-secret';this.command({kind:'interact',targetId:'lighthouse-secret'});return;}
  const treasure=g.voyageIsland?.interactionId;if(treasure){this.command({kind:'interact',targetId:treasure});return;}
  const node=g.world2.interactable();if(node){if(node.kind.startsWith('lamp')||node.kind.includes('-lamp-'))this.requestedChannel='waystone';this.command({kind:'interact',targetId:node.kind});return;}
  if(chapter===1&&p.pos.distanceTo(g.world.pois.beacon.position)<3.5){this.requestedChannel='beacon';this.command({kind:'interact',targetId:'beacon'});return;}
  const gateId=this.portalGate();if(gateId){this.command({kind:'travel',gateId});return;}
  const near=g.units.filter(u=>(u.npcId||u.kind==='townsfolk')&&u.targetable&&u.alive&&!u.hidden&&p.distTo(u)<7).sort((a,b)=>p.distTo(a)-p.distTo(b))[0];if(near)this.talk(near);
 }
 talk(unit:Unit):void {
  if(!unit.ref)return;this.command({kind:'talk',target:unit.ref});const id=unit.npcId;if(!id)return;const g=this.game;
  const npc=g.npcs.find(n=>n.def.id===id);if(npc)Object.defineProperty(npc,'unit',{configurable:true,value:unit});
  if(id==='pip'&&npc){g.hud.forge.show(npc,()=>this.dialogue(unit));return;}this.dialogue(unit);
 }
 private dialogue(unit:Unit):void {const g=this.game,id=unit.npcId!,q=g.quests,ready=q.readyAt(id as never),offer=q.offeredBy(id as never),quest=ready??offer;
  if(!quest){g.hud.dialogue.open({unit,portraitArt:`art/npc/${id}.webp`,paragraphs:[t('모험 중에는 조심하세요.','Take care on your journey.')],buttons:[{label:t('닫기','Close'),onClick:()=>g.hud.dialogue.close()}]});return;}
  const def=QUESTS[quest];g.hud.dialogue.open({unit,portraitArt:`art/npc/${id}.webp`,questId:quest,questTitle:def.title,paragraphs:ready?def.complete:def.offer,rewardXp:def.xp,buttons:[{label:ready?t('보상 받기','Complete Quest'):t('퀘스트 받기','Accept quest'),primary:true,onClick:()=>{this.command({kind:ready?'questTurnIn':'questAccept',questId:quest,npcId:id});g.hud.dialogue.close();}}]});
 }
 forge(slot:EquipmentSlot,operation:'buy'|'upgrade',npcId='pip'):Promise<EquipmentResult>{const request=++this.requestId;return new Promise((resolve,reject)=>{if(this.transactions.size>=32||!this.command({kind:operation==='buy'?'forgeBuy':'forgeUpgrade',npcId,slot,request})){reject(new Error('Server command unavailable'));return;}this.transactions.set(request,{resolve,reject});});}
 diagnostics(){return {state:this.client.state,header:this.state?.header,world:this.state?.world,self:this.state?.self,actorCount:this.units.size,incomplete:[...this.incomplete],input:this.client.inputWatermarks,position:this.self?.pos.toArray()};}
 dispose():void {if(this.disposed)return;this.disposed=true;this.client.dispose();this.presentation.dispose();this.view.dispose();this.status.remove();this.social.dispose();this.partyPanel?.remove();for(const p of this.transactions.values())p.reject(new Error('World view disposed'));this.transactions.clear();}
}
