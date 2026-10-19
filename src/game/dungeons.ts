import './dungeons.css';
import {renderDungeonMenu,renderDungeonStatus} from './dungeonMenu';
import {DungeonChamberView,chamberGround,CHAMBER,CAPTAIN_SCALE} from './dungeonChamber';
import * as THREE from 'three';
import type {Game} from './game';
import type {Enemy} from './enemies';
import type {Unit} from './unit';
import {DUNGEONS,dungeonFor,dungeonDanger,dungeonHazards,type DungeonState,type DungeonConfig} from './dungeonData';
import {t} from '../i18n';
import {localStorageGet,localStorageSet} from '../app';

const {X,Z,Y,R}=CHAMBER;
const label=(d:DungeonConfig)=>t(d.name[0],d.name[1]);
const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;};

/** A bounded private expedition, with one authoritative wave and hazard clock. */
export class DungeonExpeditions {
  state:DungeonState|null=null;
  panelOpen=false;
  private pending:number|null=null;
  private offlineHeld=false;
  private readonly chamber:DungeonChamberView;
  private readonly ui=document.createElement('div');
  private readonly panel=document.createElement('div');
  private readonly status=document.createElement('div');
  private readonly backdrop=document.createElement('div');
  private readonly menu:HTMLButtonElement;
  private readonly pool:Enemy[];
  private saved:{height:Game['world']['heightAt'];collision:Game['world']['resolveCollision'];ray:Game['world']['raycastSolid'];spawn:THREE.Vector3;back:THREE.Vector3;yaw:number}|null=null;
  private hit=-1;
  private uiKey='';
  private eligible=false;
  private runs:string[]=[];
  private cleared:number[]=[];
  private readonly key:string;
  private readonly scales:THREE.Vector3[];
  constructor(private readonly g:Game){
    this.pool=g.enemies.filter(e=>e.isDungeonOnly);this.scales=this.pool.map(e=>e.unit.rig.root.scale.clone());
    const s=g.player.unit.rig.spec;this.key=`cc.dungeons.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`;
    try{const saved=JSON.parse(localStorageGet(this.key)??'{}');this.runs=Array.isArray(saved.runs)?saved.runs.filter((r:unknown)=>typeof r==='string').slice(-64):[];this.cleared=Array.isArray(saved.cleared)?saved.cleared.filter((l:number)=>!!dungeonFor(l)):[];}catch{/* An invalid optional ledger starts empty. */}
    this.chamber=new DungeonChamberView(g.scene);
    this.ui.className='dungeon-ui';this.panel.className='dungeon-panel';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.hidden=true;
    this.status.className='dungeon-status';this.status.hidden=true;
    this.menu=button(t('⚔ 던전','⚔ Dungeons'),()=>this.open());this.menu.className='dungeon-menu';
    this.backdrop.className='dg-backdrop';this.backdrop.hidden=true;this.backdrop.onclick=()=>this.close();
    this.panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();this.close();}if(e.key==='Tab'){const buttons=[...this.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(b=>b.getClientRects().length>0),first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
    this.ui.append(this.menu,this.status,this.backdrop,this.panel);g.app.ui.append(this.ui);
  }
  get active(){return this.state!==null;}
  /** The drawn hazard warning, kept on this object for tools that inspect it. */
  get warning(){return this.chamber.warning;}
  contains(u:Unit){return !this.state||(u.level>=this.state.level&&Math.abs(u.pos.y-Y)<4&&Math.hypot(u.pos.x-X,u.pos.z-Z)<R+6);}
  networkState():DungeonState|null{return this.state?{...this.state,members:[...this.state.members]}:null;}
  private info(ko:string,en:string){this.g.hud.messages.info(t(ko,en));}
  open(){
    if(this.active)return;
    this.panelOpen=true;this.panel.hidden=false;this.panel.replaceChildren();
    this.backdrop.hidden=false;
    renderDungeonMenu(this.panel,{chapter:this.g.world2.chapter,level:this.g.player.level,cleared:this.cleared,start:level=>this.start(level),close:()=>this.close()});
  }
  close(){this.panelOpen=false;this.panel.hidden=true;this.backdrop.hidden=true;this.menu.focus({preventScroll:true});}
  start(level:number){
    const g=this.g,d=dungeonFor(level),b=g.multiplayer?.battle;
    if(!d||this.active)return false;
    if(g.player.level<level){this.info(`${level}레벨부터 들어갈 수 있어요.`,`Reach level ${level} to enter.`);return false;}
    if(g.world2.chapter!==d.chapter){this.info(`${d.chapter===3?'3월드':d.chapter===4?'눈 월드':d.chapter===5?'잿불 군도':'하늘숲'}에서 던전 메뉴를 열어 주세요.`,`Open the dungeon menu in ${d.chapter===3?'World III':d.chapter===4?'Frostlight':d.chapter===5?'Emberreach':'Skybloom'}.`);return false;}
    if(g.player.inCombat||g.encounter.engaged||g.ending.active||g.boats?.seated||g.villageGames?.playing){this.info('전투와 다른 활동을 마친 뒤 입장해 주세요.','Finish combat and other activities before entering.');return false;}
    if(b?.active&&!b.sharedArea&&!b.authority){this.info('방장이 던전을 골라요.','The host chooses the dungeon.');return false;}
    if(!b?.sharedArea&&g.combatPlayers().some(p=>p.level<level)){this.info(`친구들도 ${level}레벨 이상이어야 해요.`,`All friends must be level ${level} or higher.`);return false;}
    this.close();
    if(b?.active&&b.sharedArea){this.pending=level;g.multiplayer!.createDungeonRoom();this.info('던전 전용 방을 만드는 중이에요. 방 코드로 친구를 초대할 수 있어요.','Creating a private expedition room. Invite friends with its room code.');return true;}
    if(b?.active)b.setMode('coop');
    else if(g.multiplayer){this.offlineHeld=true;g.multiplayer.pauseDungeonConnection();}
    const state:DungeonState={level,run:crypto.randomUUID(),stage:1,phase:'rest',left:2,clock:0,hazard:0,members:g.combatPlayers().map(p=>p.name)};
    this.enter(state);return true;
  }
  private enter(state:DungeonState){
    const g=this.g,w=g.world;
    this.state=structuredClone(state);this.eligible=state.members.includes(g.player.unit.name)&&g.player.level>=state.level;
    this.saved={height:w.heightAt,collision:w.resolveCollision,ray:w.raycastSolid,spawn:w.pois.spawn.position.clone(),back:g.player.unit.pos.clone(),yaw:g.player.unit.yaw};
    const saved=this.saved;
    // Restrict overrides to the chamber footprint; the outside world keeps its own terrain.
    const ground=chamberGround({heightAt:saved.height,resolveCollision:saved.collision,raycastSolid:saved.ray});
    w.heightAt=ground.heightAt;w.resolveCollision=ground.resolveCollision;w.raycastSolid=ground.raycastSolid;
    w.pois.spawn.position.set(X,Y,Z+11);this.hit=-1;this.chamber.resetWarning();this.chamber.build(dungeonFor(state.level)!);
    for(const u of g.units)u.cancelPendingHit();
    g.hud.dialogue.close();g.hud.minimap.toggle(false);
    g.player.setTarget(null);g.player.unit.teleport(w,X,Z+11,Math.PI);g.follow.cut();
    this.chamber.visible=true;this.configure();this.renderStatus();
    this.info(`${label(dungeonFor(state.level)!)} · 세 번의 전투를 이겨 내세요!`,`${label(dungeonFor(state.level)!)} · Survive three waves!`);
  }
  private configure(){
    const d=dungeonFor(this.state!.level)!;
    this.pool.forEach((e,i)=>{e.dungeonLevel=d.level;e.dungeonCaptain=this.state!.stage===3&&i===0;e.home.set(X,Y,Z);e.unit.rig.root.scale.copy(this.scales[i]).multiplyScalar(e.dungeonCaptain?CAPTAIN_SCALE:1);e.resumeAuthority();e.unit.name=e.dungeonCaptain?t('심연의 수문장','Depth Warden'):t('원정 파수병','Expedition Sentinel');});
  }
  apply(state:DungeonState|null){
    if(!state){if(this.active)this.leave(false);return;}
    const d=dungeonFor(state.level);if(!d||d.chapter!==this.g.world2.chapter)return;
    if(!this.g.spectator&&this.g.player.level<state.level){this.info(`${state.level}레벨 던전이 진행 중이에요. 레벨을 올린 뒤 다시 참가해 주세요.`,`A level ${state.level} expedition is running. Level up before rejoining.`);queueMicrotask(()=>this.g.multiplayer?.leaveDungeonRoom());return;}
    if(!this.state||this.state.run!==state.run){if(this.active)this.leave(false);this.enter(state);}
    const stage=this.state!.stage;this.state=structuredClone(state);
    if(stage!==state.stage)this.configure();
    if(state.phase==='clear')this.reward();
  }
  private wave(){
    const s=this.state!;s.phase='wave';s.clock=0;s.hazard=0;this.hit=-1;this.configure();
    const count=s.stage===1?3:s.stage===2?5:3;
    for(const e of this.pool)e.despawn();
    this.pool.forEach((e,i)=>{if(i>=count)return;const a=(i/count)*Math.PI*2;e.respawnAt(X+Math.cos(a)*11,Z+Math.sin(a)*11);e.pack=this.pool.slice(0,count);e.aggro(false);});
    this.g.hud.messages.info(t(`${s.stage}/3 전투 시작!`, `Wave ${s.stage}/3 begins!`));
  }
  update(dt:number){
    const g=this.g,b=g.multiplayer?.battle;
    if(this.pending!==null&&b?.active&&!b.sharedArea&&b.authority){const level=this.pending;this.pending=null;this.start(level);}
    const title=t('⚔ 던전','⚔ Dungeons');if(this.menu.textContent!==title)this.menu.textContent=title;
    const s=this.state;this.menu.hidden=!!s;if(!s)return;
    if(s.phase==='wave'&&g.player.level>=s.level)this.eligible=true;
    if(b?.authority!==false&&dt>0){
      for(const p of g.combatPlayers())if(p.level>=s.level&&Math.abs(p.pos.y-Y)<3&&!s.members.includes(p.name)&&s.members.length<8)s.members.push(p.name);
      if(s.phase==='rest'){s.left=Math.max(0,s.left-dt);if(s.left===0)this.wave();}
      else if(s.phase==='wave'){
        const before=s.clock;s.clock=Math.min(9999999,s.clock+dt);s.hazard=Math.floor(s.clock/7);
        if(Math.floor(before/7)===s.hazard&&before%7<2.5&&s.clock%7>=2.5&&this.hit!==s.hazard){this.hit=s.hazard;this.strike();}
        if(this.pool.every(e=>!e.unit.alive)){if(s.stage===3){s.phase='clear';this.reward();}else{s.stage++;s.phase='rest';s.left=3;}}
        else if(!g.combatPlayers().some(p=>p.alive)){s.phase='failed';for(const e of this.pool)e.despawn();}
      }
    }
    this.drawWarning();this.renderStatus();
  }
  private strike(){
    const s=this.state!,index=DUNGEONS.findIndex(d=>d.level===s.level),src=this.pool.find(e=>e.unit.alive)?.unit;
    if(!src)return;
    for(const p of this.g.combatPlayers())if(p.alive&&dungeonDanger(index,s.hazard,p.pos.x-X,p.pos.z-Z))this.g.combat.damage(src,p,Math.round((18+s.level*.42)*1.25));
    this.g.vfx.ring(new THREE.Vector3(X,Y+.18,Z),new THREE.Color(0xffb978),1,17,.5,.8,0);
  }
  private reward(){
    const s=this.state!,d=dungeonFor(s.level)!;if(!this.eligible||this.runs.includes(s.run))return;
    // Persist the receipt before granting; snapshots and reconnects cannot repeat this reward.
    this.runs.push(s.run);this.runs=this.runs.slice(-64);if(!this.cleared.includes(d.level))this.cleared.push(d.level);
    localStorageSet(this.key,JSON.stringify({runs:this.runs,cleared:this.cleared}));
    this.g.player.coins=Math.min(Number.MAX_SAFE_INTEGER,this.g.player.coins+d.coins);this.g.player.gainXp(d.xp);this.g.journey?.save();
    this.info(`원정 성공! +${d.coins.toLocaleString()} 코인 · +${d.xp.toLocaleString()} XP`,`Expedition complete! +${d.coins.toLocaleString()} coins · +${d.xp.toLocaleString()} XP`);
  }
  leave(disconnect=true){
    // Returning from an expedition keeps the private room and its party intact.
    if(disconnect&&this.state&&this.g.multiplayer?.battle.requestDungeonReturn())return;
    this.close();this.pending=null;if(!this.state)return;
    const held=this.offlineHeld;this.offlineHeld=false;
    const g=this.g,saved=this.saved;this.state=null;this.saved=null;this.eligible=false;this.chamber.visible=false;this.menu.hidden=false;this.status.hidden=true;this.uiKey='';this.chamber.resetWarning();
    for(const e of this.pool)e.despawn();
    if(saved){g.world.heightAt=saved.height;g.world.resolveCollision=saved.collision;g.world.raycastSolid=saved.ray;g.world.pois.spawn.position.copy(saved.spawn);g.player.setTarget(null);g.player.unit.teleport(g.world,saved.back.x,saved.back.z,saved.yaw);g.follow?.cut();}
    if(disconnect&&held)g.multiplayer?.leaveDungeonRoom();
  }
  private renderStatus(){
    const s=this.state!,d=dungeonFor(s.level)!,alive=this.pool.filter(e=>e.unit.alive).length;
    const key=JSON.stringify([s.level,s.stage,s.phase,Math.ceil(s.left),alive,t('ko','en')]);if(key===this.uiKey)return;this.uiKey=key;
    renderDungeonStatus(this.status,{title:`Lv.${s.level} ${label(d)}`,stage:s.stage,phase:s.phase,left:s.left,alive,actions:[{label:t('밖으로 나가기','Leave'),action:()=>this.leave()}]});
  }
  private drawWarning(){
    const s=this.state!,index=DUNGEONS.findIndex(d=>d.level===s.level);
    this.chamber.showWarning(s.phase==='wave'&&s.clock%7<2.5,`${s.run}:${s.hazard}`,()=>dungeonHazards(index,s.hazard),s.clock);
  }
  dispose(){this.leave(false);this.chamber.dispose();this.ui.remove();}
}
