import './dungeons.css';
import * as THREE from 'three';
import type {Game} from './game';
import type {Unit} from './unit';
import {renderDungeonMenu,renderDungeonStatus} from './dungeonMenu';
import {DungeonChamberView,chamberGround,CHAMBER,CAPTAIN_SCALE,type ChamberGround} from './dungeonChamber';
import {dungeonFor,type DungeonTier} from '../sim/data/dungeons.ts';
import type {EntityRef} from '../sim/types.ts';
import type {DungeonRunView,GameplayState,WorldControl} from '../../server/world/gameplay/protocol.ts';
import type {GameplayCommand} from '../../server/world/gameplay/intents.ts';
import {t} from '../i18n';

type PartyState=Extract<WorldControl,{type:'party'}>['state'];
const same=(a:EntityRef|null|undefined,b:EntityRef|null|undefined)=>!!a&&!!b&&a.area===b.area&&a.id===b.id&&a.life===b.life;

/** Every denial the host sends for a dungeon command, said simply. */
const FAILURES:Readonly<Record<string,readonly [string,string]>>={
 'dungeon-unavailable':['지금은 원정을 시작할 수 없어요.','Expeditions are not open right now.'],
 'dungeon-party-required':['원정은 파티로 떠나요. 파티를 먼저 만들어 주세요.','Expeditions need a party. Make one first.'],
 'dungeon-leader-required':['파티장만 원정을 시작하거나 모두를 데려올 수 있어요.','Only the party leader can start or end the expedition.'],
 'party-encounter-active':['파티가 벌써 보스 전투나 다른 원정 중이에요.','Your party is already in a boss fight or expedition.'],
 'dungeon-capacity':['원정 방이 모두 찼어요. 조금 뒤에 다시 해 봐요.','All expedition rooms are full. Try again soon.'],
 'dungeon-run-unavailable':['참가할 수 있는 원정이 없어요.','There is no expedition to join.'],
 'dungeon-run-ended':['그 원정은 벌써 끝났어요.','That expedition has already ended.'],
 'dungeon-world':['이 원정은 다른 월드에서 시작해요.','This expedition starts from another world.'],
 'dungeon-party-not-ready':['파티원이 모두 이 월드에 접속해 있어야 해요.','Every party member must be online in this world.'],
 'dungeon-level':['파티원 모두 원정 레벨이 되어야 해요.','Every party member must reach the expedition level.'],
 'dungeon-party-busy':['전투나 다른 놀이를 마치고 5초 뒤에 들어갈 수 있어요.','Finish fighting or playing, then wait 5 seconds.'],
 'dungeon-return-unsafe':['여기서는 출발할 수 없어요. 조금 옮겨서 다시 해 봐요.','You cannot leave from this spot. Move a little and try again.'],
 'dungeon-full':['원정 인원이 가득 찼어요.','The expedition is full.'],
 'dungeon-return-unavailable':['지금은 돌아갈 수 없어요. 조금 뒤에 다시 해 봐요.','You cannot go back right now. Try again soon.'],
 'dungeon-busy':['앞의 요청을 처리하고 있어요.','Your last request is still being handled.'],
 'invalid-command':['요청을 보낼 수 없었어요.','That request could not be sent.'],
 'host-unavailable':['서버가 잠시 쉬고 있어요. 조금 뒤에 다시 해 봐요.','The server is resting for a moment. Try again soon.'],
};
export const DUNGEON_FAILURE_CODES:readonly string[]=Object.freeze(Object.keys(FAILURES));
export function dungeonFailureMessage(code:string):string|null {const m=FAILURES[code];return m?t(m[0],m[1]):null;}

export interface ServerDungeonPorts {
 game:Game;
 /** Tiers the server advertises in its catalog. */
 tiers:readonly number[];
 command(command:GameplayCommand):boolean;
 unit(ref:EntityRef|null|undefined):Unit|null;
}

/**
 * Server world expeditions, presentation only. The menu sends commands; the chamber, warnings, waves, result and rewards
 * are drawn from the latest committed observation and party control. Nothing here steps a run, keeps a clock or grants.
 */
export class ServerDungeon {
 panelOpen=false;
 private readonly g:Game;
 private readonly ui=document.createElement('div');
 private readonly panel=document.createElement('div');
 private readonly status=document.createElement('div');
 private readonly backdrop=document.createElement('div');
 private readonly menu=document.createElement('button');
 private readonly chamber:DungeonChamberView;
 private state:GameplayState|null=null;
 private party:PartyState=null;
 private pendingStart:number|null=null;
 private built='';
 private outside:ChamberGround|null=null;
 private ground:ChamberGround|null=null;
 private uiKey='';
 private menuKey='';
 private captain:{unit:Unit;scale:THREE.Vector3}|null=null;
 private lastWarning:{run:string;serial:number}|null=null;
 /** Self coins and XP when this session first saw the run, then what the paid clear brought; all from observed state. */
 private entry:{run:string;coins:number;xp:number}|null=null;
 private cleared:{run:string;tier:number}|null=null;
 private paid:{run:string;coins:number;xp:number}|null=null;
 private previous:{coins:number;xp:number}|null=null;
 /** A clear paid while still inside is celebrated with the banner once the party is home. */
 private homeBanner:{coins:number;xp:number}|null=null;
 constructor(private readonly ports:ServerDungeonPorts){
  this.g=ports.game;this.chamber=new DungeonChamberView(this.g.scene);
  this.ui.className='dungeon-ui is-server';this.panel.className='dungeon-panel';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.hidden=true;
  this.status.className='dungeon-status';this.status.hidden=true;this.status.setAttribute('aria-live','polite');
  this.menu.type='button';this.menu.className='dungeon-menu';this.menu.textContent=t('⚔ 던전','⚔ Dungeons');this.menu.hidden=true;this.menu.onclick=()=>this.open();
  this.backdrop.className='dg-backdrop';this.backdrop.hidden=true;this.backdrop.onclick=()=>this.close();
  this.panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();this.close();}if(e.key==='Tab'){const buttons=[...this.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(b=>b.getClientRects().length>0),first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
  this.ui.append(this.menu,this.status,this.backdrop,this.panel);this.g.app.ui.append(this.ui);
 }
 private get run():DungeonRunView|null{return this.state?.features.dungeon??null;}
 /** In a run's chamber (the minimap hides itself then, as for the browser expedition). */
 get active():boolean{return !!this.run;}
 private get isLeader():boolean{const p=this.party,leader=p?.members.find(m=>m.id===p.leader);return !!leader&&same(leader.ref,this.state?.selfRef);}
 private info(text:string){this.g.hud.messages.info(text);}

 /** One committed observation. Same observation, same frame. */
 observe(state:GameplayState):void {
  this.state=state;const run=this.run,self=state.self.player;
  if(run)this.inside(run);else this.outsideChamber();
  this.accountRewards(run,self);
  this.menu.hidden=!!run;if(run&&this.panelOpen)this.close();
  if(this.panelOpen)this.render();
  this.renderStatus();
 }
 observeParty(state:PartyState):void {
  this.party=state;
  if(state&&this.pendingStart!==null&&this.isLeader){const tier=this.pendingStart;this.pendingStart=null;this.ports.command({kind:'dungeonStart',tier:tier as DungeonTier});}
  if(this.panelOpen)this.render();
  this.uiKey='';this.renderStatus();
 }
 /** A host denial; true when it was a dungeon one (or the party this menu was creating). */
 error(code:string):boolean {
  if(this.pendingStart!==null&&code.startsWith('party-')){this.pendingStart=null;this.g.hud.messages.error(t('파티를 만들 수 없어서 원정을 시작하지 못했어요.','The party could not be made, so the expedition did not start.'));return true;}
  const message=dungeonFailureMessage(code);if(!message)return false;
  this.g.hud.messages.error(message);return true;
 }
 /** A new stream binding: the next observation decides inside or outside. Rewards in flight are kept. */
 reset():void {this.state=null;this.party=null;this.pendingStart=null;this.lastWarning=null;this.restoreCaptain();}
 refreshLanguage():void {this.menu.textContent=t('⚔ 던전','⚔ Dungeons');this.menuKey='';if(this.panelOpen)this.render();this.uiKey='';this.renderStatus();}

 open():void {if(this.run||!this.state)return;this.panelOpen=true;this.panel.hidden=false;this.backdrop.hidden=false;this.g.input.reset();this.menuKey='';this.render();this.panel.scrollTop=0;}
 close():void {if(!this.panelOpen)return;this.panelOpen=false;this.panel.hidden=true;this.backdrop.hidden=true;this.g.input.reset();this.menu.focus({preventScroll:true});}
 private render():void {
  const state=this.state;if(!state)return;const self=state.actors.find(a=>same(a.ref,state.selfRef)),flags=state.self.player.flags,party=this.party,running=party?.dungeon??null;
  // Rebuilt only when what it shows changes, so focus and scroll stay put between observations.
  const key=JSON.stringify([state.world,self?.level,this.ports.tiers.map(tier=>!!flags[`dungeonCleared${tier}`]),!!party,party?.members.length,this.isLeader,running,t('ko','en')]);if(key===this.menuKey)return;this.menuKey=key;
  const notice=!party?t('혼자서도 떠날 수 있어요. 시작하면 나만의 파티가 만들어져요.','You can go alone. Starting makes a party just for you.')
   :running?t('파티가 원정 중이에요. 같은 원정에 참가할 수 있어요.','Your party is on an expedition. You can join it.')
   :this.isLeader?t(`파티원 ${party.members.length}명이 모두 함께 들어가요.`,`All ${party.members.length} party members go in together.`)
   :t('파티장이 원정을 시작하면 모두 함께 들어가요.','When the party leader starts, everyone goes in together.');
  renderDungeonMenu(this.panel,{chapter:Number(state.world.slice(1)),level:self?.level??1,cleared:this.ports.tiers.filter(tier=>flags[`dungeonCleared${tier}`]),start:level=>this.start(level),close:()=>this.close(),
   server:{available:this.ports.tiers,canStart:!party||this.isLeader,running:running?{tier:running.tier}:null,join:()=>this.join(),notice}});
 }
 private start(level:number):void {
  this.close();
  if(!this.party){if(this.ports.command({kind:'partyCreate'})){this.pendingStart=level;this.info(t('파티를 만들고 원정을 준비해요.','Making your party and getting ready.'));}return;}
  if(!this.isLeader){this.g.hud.messages.error(dungeonFailureMessage('dungeon-leader-required')!);return;}
  if(this.ports.command({kind:'dungeonStart',tier:level as DungeonTier}))this.info(t('원정 문을 여는 중이에요.','Opening the expedition gate.'));
 }
 private join():void {const run=this.party?.dungeon;this.close();if(run&&this.ports.command({kind:'dungeonJoin',run:run.runId}))this.info(t('파티 원정에 들어가는 중이에요.','Joining your party.'));}

 private inside(run:DungeonRunView):void {
  const g=this.g,d=dungeonFor(run.tier)!,key=run.run.runId;
  if(!this.outside){
   const w=g.world;this.outside={heightAt:w.heightAt,resolveCollision:w.resolveCollision,raycastSolid:w.raycastSolid};
   // Camera rays and any ground query use the chamber floor and wall, as the run Area's own query does.
   const ground=this.ground=chamberGround(this.outside);w.heightAt=ground.heightAt;w.resolveCollision=ground.resolveCollision;w.raycastSolid=ground.raycastSolid;
   g.hud.dialogue.close();
  }
  if(this.built!==key){this.built=key;this.chamber.build(d);this.chamber.resetWarning();this.info(t(`${d.name[0]} · 세 번의 전투를 이겨 내세요!`,`${d.name[1]} · Survive three waves!`));}
  this.chamber.visible=true;
  // The hazard fires when its warning ends inside the same wave and serial; the ring is the observed strike.
  const warned=this.lastWarning;
  if(warned&&warned.run===key&&warned.serial===run.hazardSerial&&run.phase==='wave'&&!run.warning.length)g.vfx.ring(new THREE.Vector3(CHAMBER.X,CHAMBER.Y+.18,CHAMBER.Z),new THREE.Color(0xffb978),1,17,.5,.8,0);
  this.lastWarning=run.phase==='wave'&&run.warning.length?{run:key,serial:run.hazardSerial}:null;
  this.chamber.showWarning(run.phase==='wave'&&run.warning.length>0,`${key}:${run.hazardSerial}`,()=>run.warning,run.clock);
  for(const ref of run.activeEnemies){const u=this.ports.unit(ref);if(u)u.name=same(ref,run.captain)?t('심연의 수문장','Depth Warden'):t('원정 파수병','Expedition Sentinel');}
  const captain=this.ports.unit(run.captain);
  if(captain!==this.captain?.unit){this.restoreCaptain();if(captain){this.captain={unit:captain,scale:captain.rig.root.scale.clone()};captain.rig.root.scale.multiplyScalar(CAPTAIN_SCALE);}}
 }
 private outsideChamber():void {
  this.chamber.visible=false;this.restoreCaptain();this.lastWarning=null;
  if(this.outside){
   // Put back what was there unless a chapter change already replaced the chamber ground.
   const w=this.g.world;if(w.heightAt===this.ground?.heightAt){w.heightAt=this.outside.heightAt;w.resolveCollision=this.outside.resolveCollision;w.raycastSolid=this.outside.raycastSolid;}this.outside=this.ground=null;
   const paid=this.homeBanner;this.homeBanner=null;if(paid)this.banner(paid);}
 }
 private banner(paid:{coins:number;xp:number}):void {
  this.g.hud.messages.banner(()=>t('원정 성공!','Expedition complete!'),()=>t(`+${paid.coins.toLocaleString()} 코인 · +${paid.xp.toLocaleString()} XP`,`+${paid.coins.toLocaleString()} coins · +${paid.xp.toLocaleString()} XP`),'zone');
 }
 private restoreCaptain():void {const c=this.captain;this.captain=null;if(c)c.unit.rig.root.scale.copy(c.scale);}
 /**
  * Rewards are what the server state shows: self coins and XP from the first observation of a run to the first observation
  * after its clear in which coins went up with the tier's cleared mark set, which is where the certified award (with the last
  * wave's kill rewards) lands.
  */
 private accountRewards(run:DungeonRunView|null,self:GameplayState['self']['player']):void {
  const previous=this.previous,now={coins:self.coins,xp:self.xp};this.previous=now;
  if(run&&this.entry?.run!==run.run.runId)this.entry={run:run.run.runId,coins:now.coins,xp:now.xp};
  if(run?.phase==='clear'&&this.paid?.run!==run.run.runId)this.cleared={run:run.run.runId,tier:run.tier};
  const cleared=this.cleared;
  if(!cleared||!previous||now.coins<=previous.coins||!self.flags[`dungeonCleared${cleared.tier}`]||this.entry?.run!==cleared.run)return;
  const entry=this.entry,coins=now.coins-entry.coins,xp=now.xp-entry.xp;this.paid={run:cleared.run,coins,xp};this.cleared=null;
  // Inside, the run banner already shows the result: mark it with sound and light, and keep the big banner for home.
  if(run){this.homeBanner={coins,xp};this.g.audio.sfx('sfx-quest-complete');const self=this.state&&this.ports.unit(this.state.selfRef);if(self)this.g.vfx.levelUp(self);}
  else this.banner({coins,xp});
  this.g.hud.chat.system(t(`원정 보상으로 코인 ${coins.toLocaleString()}개와 경험치 ${xp.toLocaleString()}을 받았어요.`,`The expedition paid ${coins.toLocaleString()} coins and ${xp.toLocaleString()} XP.`));
  this.uiKey='';
 }
 private renderStatus():void {
  const run=this.run;
  if(!run){this.status.hidden=true;this.uiKey='';return;}
  const d=dungeonFor(run.tier)!,leader=this.isLeader,ended=run.phase==='clear'||run.phase==='failed',paid=this.paid?.run===run.run.runId?this.paid:null;
  const key=JSON.stringify([run.run.runId,run.stage,run.phase,Math.ceil(run.restRemaining),run.activeEnemies.length,leader,paid,t('ko','en')]);if(key===this.uiKey)return;this.uiKey=key;
  const text=run.phase==='clear'?paid?t(`원정 성공! +${paid.coins.toLocaleString()} 코인 · +${paid.xp.toLocaleString()} XP`,`Expedition complete! +${paid.coins.toLocaleString()} coins · +${paid.xp.toLocaleString()} XP`):t('원정 성공! 보상을 받는 중이에요','Expedition complete! Rewards are on the way'):undefined;
  const runId=run.run.runId,actions:{label:string;action:()=>void;secondary?:boolean}[]=[];
  if(leader||ended)actions.push({label:t('돌아가기','Return home'),action:()=>{this.ports.command({kind:'dungeonReturn',run:runId});}});
  // A member can step out alone while the run goes on and come back through the menu; the party is kept.
  else actions.push({label:t('혼자 나가기','Leave alone'),secondary:true,action:()=>{this.ports.command({kind:'encounterLeave'});}});
  renderDungeonStatus(this.status,{title:`Lv.${run.tier} ${t(d.name[0],d.name[1])}`,stage:run.stage,phase:run.phase,left:run.restRemaining,alive:run.activeEnemies.length,text,actions});
 }
 dispose():void {this.close();this.outsideChamber();this.chamber.dispose();this.ui.remove();}
}
