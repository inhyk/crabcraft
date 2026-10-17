import * as THREE from 'three';
import type {Game} from './game';
import type {Unit} from './unit';
import type {VillageRound} from '../../server/combatProtocol';
import {NavHints} from './nav';
import {t} from '../i18n';
import './villageGames.css';

/** One room authority owns the clock, NPC navigation and contact checks. */
export class VillageGames {
 state:VillageRound|null=null;
 private banner=document.createElement('section');private blind=document.createElement('div');
 private title=document.createElement('strong');private note=document.createElement('span');
 private nav:NavHints|null=null;private lastRound='';private npcHome:THREE.Vector3|null=null;
 private from=new THREE.Vector3();private to=new THREE.Vector3();private uiAt=0;
 constructor(private g:Game){
  this.banner.className='village-round hidden';this.banner.setAttribute('aria-live','polite');
  const stop=document.createElement('button');stop.textContent='×';stop.title=t('놀이 끝내기','End game');stop.onclick=()=>this.command('stop');
  this.banner.append(this.title,this.note,stop);this.blind.className='village-blind hidden';g.hud.root.append(this.banner,this.blind);
 }
 get playing(){return !!this.state&&this.state.phase!=='done';}
 get ownId(){return this.g.multiplayer?.battle.active?this.g.multiplayer.battle.ownId:'solo';}
 private unit(id:string){return id.startsWith('npc')?this.g.townsfolk[Number(id.slice(3))]?.unit:id===this.ownId?this.g.player.unit:this.g.multiplayer?.battle.boatUnit(id);}
 get locked(){const r=this.state;return !!r&&r.phase!=='done'&&r.members.includes(this.ownId)&&(r.caught.includes(this.ownId)||r.phase==='ready'&&r.seeker===this.ownId);}
 concealMap(u:Unit){const r=this.state;return !!r&&r.phase!=='done'&&r.mode==='hide'&&(u.kind==='remote'||u.kind==='townsfolk');}
 ownsNpc(unit:Unit){return this.playing&&this.unit(this.state!.seeker)===unit&&this.state!.seeker.startsWith('npc');}
 command(mode:'hide'|'tag'|'stop'){const b=this.g.multiplayer?.battle;if(b)b.village(mode);else this.request('solo',mode);}
 request(id:string,mode:'hide'|'tag'|'stop'){
  const g=this.g,b=g.multiplayer?.battle;
  if(b?.authority===false)return;
  if(mode==='stop'){if(this.state&&(id===this.state.starter||id===(b?.active?b.ownId:'solo')))this.finish('cancelled');return;}
  if(this.playing||g.world2.chapter!==1||g.encounter.engaged||g.ending.active||g.boats?.networkState().seats.some(Boolean)){if(id===this.ownId)g.hud.messages.info(t('진행 중인 놀이·보스전·항해를 마친 뒤 월드 1에서 시작해 주세요.','Finish the current game, boss battle or boat ride, then start in World I.'));return;}
  const members=b?.villageMembers()??['solo'];if(!members.includes(id))return;
  // No human partner: recruit an actual resident. Every human in a shared round is included.
  const npc=g.townsfolk.findIndex(v=>v.unit.alive&&!v.unit.hidden);
  if(members.length===1&&npc<0)return;
  const seeker=members.length>1?id:`npc${npc}`;
  this.reset();
  if(seeker.startsWith('npc')){const u=this.unit(seeker)!;this.npcHome=u.pos.clone();u.teleport(g.world,-.5,12.5);this.nav=new NavHints(g.world,{radius:u.radius+.15,step:.6});}
  this.apply({id:crypto.randomUUID(),mode,phase:'ready',left:mode==='hide'?15:5,starter:id,seeker,members,caught:[],result:''});
 }
 apply(state:VillageRound|null){
  this.state=state;
  if(state&&state.id!==this.lastRound){
   this.lastRound=state.id;
   if(state.members.includes(this.ownId)){
    const i=state.members.indexOf(this.ownId),a=i*2.39996;
    this.g.player.setTarget(null);this.g.player.interruptCast('');this.g.player.cancelChannel();this.g.player.unit.pushTime=0;this.g.player.unit.cancelPendingHit();
    this.g.player.unit.teleport(this.g.world,-.5+Math.cos(a)*5,12.5+Math.sin(a)*5,Math.PI);
    this.g.follow.cut();this.g.hud.dialogue.close();this.g.hud.menu.close();this.g.hud.minimap.expanded=false;
   }
  }
  this.render();
 }
 private finish(result:VillageRound['result']){if(!this.state)return;this.state.phase='done';this.state.result=result;this.state.left=8;this.restoreNpc();this.render();}
 private restoreNpc(){const r=this.state;if(r?.seeker.startsWith('npc')){const u=this.unit(r.seeker);if(u&&this.npcHome&&this.g.world2.chapter===1)u.teleport(this.g.world,this.npcHome.x,this.npcHome.z);this.npcHome=null;}this.nav=null;}
 reset(){this.restoreNpc();this.state=null;this.lastRound='';this.render();}
 update(dt:number){
  const r=this.state;if(!r)return;
  if(this.g.multiplayer?.battle.authority!==false){
   if(r.phase==='done'){r.left=Math.max(0,r.left-dt);if(!r.left){this.reset();return;}}
   else if(this.g.world2.chapter!==1||!this.unit(r.starter)||!this.unit(r.seeker)||!this.unit(r.seeker)?.alive)this.finish('cancelled');
   else{
    const present=r.members.filter(id=>this.unit(id)?.alive&&!this.unit(id)?.hidden);
    const runners=present.filter(id=>id!==r.seeker&&!r.caught.includes(id));
    r.left=Math.max(0,r.left-dt);
    if(r.phase==='ready'&&!r.left){r.phase='play';r.left=r.mode==='hide'?120:90;}
    if(r.phase==='play'){
     const seeker=this.unit(r.seeker)!;
     if(r.seeker.startsWith('npc')&&runners.length){
      let target=this.unit(runners[0])!;for(const id of runners){const u=this.unit(id)!;if(seeker.distTo(u)<seeker.distTo(target))target=u;}
      // Hide-and-seek residents patrol until a runner is in sight; tag is a continuous pursuit.
      const seen=this.visible(seeker,target)&&seeker.distTo(target)<(r.mode==='hide'?20:100);
      const patrol=[[-7,7],[8,-6],[26,2],[0,-24],[-22,-3],[-1,20]][Math.floor(this.g.time/7)%6];
      this.to.set(seen?target.pos.x:patrol[0],0,seen?target.pos.z:patrol[1]);
      const next=this.nav?.waypoint(seeker.pos,this.to,this.g.time)??this.to,dx=next.x-seeker.pos.x,dz=next.z-seeker.pos.z,d=Math.hypot(dx,dz);
      if(d>.2){const speed=r.mode==='tag'?4.9:3.7;seeker.setYaw(Math.atan2(dx,dz));seeker.moveTo(this.g.world,seeker.pos.x+dx/d*speed*dt,seeker.pos.z+dz/d*speed*dt,dt);}
      seeker.feedLocomotion(dt);
     }
     for(const id of runners){const u=this.unit(id)!,outside=Math.hypot(u.pos.x+.5,u.pos.z-12.5)>60;
      if(outside||(seeker.distTo(u)<seeker.radius+u.radius+.75&&this.visible(seeker,u))){r.caught.push(id);u.cancelPendingHit();u.express('surprised',1);}}
     if(!present.some(id=>id!==r.seeker&&!r.caught.includes(id)))this.finish('seekers');
     else if(!r.left)this.finish('runners');
    }
   }
  }
  if((this.uiAt+=dt)>.15){this.uiAt=0;this.render();}
 }
 private visible(a:Unit,b:Unit){this.from.copy(a.pos).y+=a.height*.7;b.centre(this.to);const hit=this.g.world.raycastSolid(this.from,this.to);return hit===null||hit>=this.from.distanceTo(this.to)-b.radius-.2;}
 private render(){
  const r=this.state;this.banner.classList.toggle('hidden',!r);const blind=!!r&&r.phase==='ready'&&r.mode==='hide'&&r.seeker===this.ownId;this.blind.classList.toggle('hidden',!blind);
  if(!r)return;
  const mode=r.mode==='hide'?t('숨바꼭질','Hide & Seek'):t('술래잡기','Tag'),name=this.unit(r.seeker)?.name??t('술래','Seeker'),me=r.members.includes(this.ownId),caught=r.caught.includes(this.ownId);
  this.title.textContent=`${r.mode==='hide'?'🙈':'🏃'} ${mode} · ${Math.ceil(r.left)}s`;
  this.note.textContent=r.phase==='done'?(r.result==='cancelled'?t('놀이가 끝났어요.','Round cancelled.'):r.result==='seekers'?t('술래 승리! 모두 찾았어요!','Seeker wins! Everyone caught!'):t('도망친 친구들 승리!','Runners win!')):r.phase==='ready'?t(`술래: ${name} · ${r.mode==='hide'?'숨어 주세요!':'준비하세요!'} 광장 반경 60m 안에서 놀아요.`,`Seeker: ${name} · ${r.mode==='hide'?'Go hide!':'Get ready!'} Stay within 60m of the square.`):!me?t('관전 중 · 다음 판에 함께해요!','Spectating · Join the next round!'):caught?t('잡혔어요! 끝날 때까지 기다려 주세요.','Caught! Watch until the round ends.'):r.seeker===this.ownId?t('친구 가까이 다가가면 잡을 수 있어요!','Get close to catch your friends!'):t(`술래: ${name} · 잡히지 마세요! 광장에서 60m를 벗어나면 탈락해요.`,`Seeker: ${name} · Keep away! Leaving the 60m town area counts as caught.`);
  this.blind.textContent=t(`🙈 ${Math.ceil(r.left)}초 세는 중… 친구들이 숨고 있어요!`,`🙈 Counting… ${Math.ceil(r.left)}s. Your friends are hiding!`);
  const stop=this.banner.querySelector('button')!;stop.hidden=r.starter!==this.ownId&&this.g.multiplayer?.battle.authority===false;
 }
 dispose(){this.reset();this.banner.remove();this.blind.remove();}
}
