import {h,art} from '../dom';
import {t,language} from '../../i18n';
import type {Game} from '../../game/game';
import type {Npc} from '../../game/npcs';
import {EQUIPMENT_PRICE,MAX_EQUIPMENT_RANK,upgradeCost,weaponMultiplier,armorMultiplier,type EquipmentSlot} from '../../game/equipment';
import './forge.css';

/** A focused workshop: previews and purchases read the same combat stats. */
export class ForgePanel {
 readonly el=h('dialog',{class:'forge-panel hud-i','aria-labelledby':'forge-title'});
 private content=h('div',{class:'forge-content'});
 private notice=h('p',{class:'forge-notice',role:'status','aria-live':'polite'});
 private npc:Npc|null=null;
 private request:(()=>void)|null=null;
 private last='';
 get open(){return this.el.open;}
 constructor(private g:Game){
  this.el.append(this.content,this.notice);
  this.el.addEventListener('keydown',e=>e.stopPropagation());
  this.el.addEventListener('cancel',e=>{e.preventDefault();this.close();});
 }
 show(npc:Npc,request:()=>void){
  this.npc=npc;this.request=request;this.last='';this.notice.textContent='';this.el.classList.remove('forged');
  this.render();if(!this.open)this.el.showModal();
 }
 close(){if(this.open)this.el.close();this.npc=null;this.request=null;}
 update(){
  if(!this.open)return;
  if(!this.g.player.unit.alive||this.g.cinematic||this.g.ending.active||!this.npc||this.g.player.unit.distTo(this.npc.unit)>8){this.close();return;}
  const p=this.g.player,key=`${language()}|${p.coins}|${p.attackRank}|${p.armorRank}|${p.weaponOwned}|${p.armorOwned}|${p.inCombat}`;
  if(key!==this.last){this.last=key;this.render();}
 }
 private async buy(slot:EquipmentSlot){
  const buying=!this.g.player.ownsEquipment(slot);
  let result;try{result=this.g.server?await this.g.server.forge(slot,buying?'buy':'upgrade',this.npc?.def.id??'pip'):buying?this.g.player.buyEquipment(slot):this.g.player.upgradeEquipment(slot);}catch{if(this.open)this.notice.textContent=t('서버 확인을 기다릴 수 없습니다. 다시 연결해 주세요.','Confirmation unavailable. Reconnect to the server.');return;}
  if(!this.open)return;
  if(result!=='upgraded'&&result!=='bought'){
   this.notice.textContent=result==='busy'?t('전투가 끝나면 강화할 수 있어요.','Wait until combat ends to upgrade.'):result==='max'?t('최고 강화 단계예요!','Maximum upgrade rank reached!'):t('코인이 부족해요. 적과 보스를 잡아 모아 주세요.','Not enough coins. Earn more by defeating enemies and bosses.');return;
  }
  const p=this.g.player,rank=slot==='weapon'?p.attackRank:p.armorRank;
  this.notice.textContent=buying?t(`${slot==='weapon'?'무기':'방어구'} 구매 완료! +1 장비를 장착했어요. 이제 강화할 수 있어요.`,`${slot==='weapon'?'Weapon':'Armor'} purchased and equipped at +1! You can now upgrade it.`):t(`${slot==='weapon'?'무기':'방어구'} +${rank} 강화 성공! 자동 저장했어요.`,`${slot==='weapon'?'Weapon':'Armor'} +${rank} upgraded! Automatically saved.`);
  this.el.classList.remove('forged');void this.el.offsetWidth;this.el.classList.add('forged');
  this.g.audio.sfx('sfx-levelup');this.g.vfx.levelUp(p.unit);this.render(slot);
 }
 private card(slot:EquipmentSlot){
  const p=this.g.player,weapon=slot==='weapon',rank=weapon?p.attackRank:p.armorRank,max=rank>=MAX_EQUIPMENT_RANK;
  const owned=p.ownsEquipment(slot),next=owned?Math.min(MAX_EQUIPMENT_RANK,rank+1):1,cost=owned?upgradeCost(rank):EQUIPMENT_PRICE,enough=p.coins>=cost;
  const label=weapon?t('무기','Weapon'):t('방어구','Armor');
  const stat=(r:number)=>weapon?`+${Math.round((weaponMultiplier(r)-1)*100)}%`:`${((1-armorMultiplier(r))*100).toFixed(1)}%`;
  const button=h('button',{class:'forge-upgrade',type:'button','data-slot':slot,disabled:max||!enough||p.inCombat,onclick:()=>this.buy(slot)},max?t('최고 단계 달성','Fully upgraded'):!owned?t(`${label} 구매 · ${cost.toLocaleString()} 코인`,`Buy ${label.toLowerCase()} · ${cost.toLocaleString()} coins`):t(`${label} 강화 · ${cost.toLocaleString()} 코인`,`Upgrade ${label.toLowerCase()} · ${cost.toLocaleString()} coins`));
  return h('article',{class:`forge-card ${slot}`},
   h('div',{class:'forge-card-top'},h('img',{src:art(`art/icons/ability-${weapon?'warrior-1':'priest-3'}.webp`),alt:'',class:'forge-art'}),h('div',null,h('span',{class:'forge-eyebrow'},weapon?'WEAPON':'ARMOR'),h('h2',null,label),h('strong',{class:'forge-rank'},owned?`+${rank}`:t('미보유','Not owned')))),
   h('p',{class:'forge-description'},weapon?t('기본 공격과 공격 기술이 더 강해져요.','Strengthens basic attacks and offensive skills.'):t('적과 보스, 다른 플레이어의 공격을 견뎌요.','Withstand enemy, boss and player attacks.')),
   h('div',{class:'forge-stat'},h('span',null,weapon?t('추가 공격력','Bonus damage'):t('받는 피해 감소','Damage reduction')),h('div',null,h('b',null,stat(rank)),h('span',{'aria-hidden':'true'},' → '),h('strong',null,stat(next)))),
   h('div',{class:'forge-meter',role:'progressbar','aria-label':label,'aria-valuenow':rank,'aria-valuemin':0,'aria-valuemax':MAX_EQUIPMENT_RANK},h('i',{style:`width:${rank}%`})),
   h('p',{class:'forge-next'},max?t('최고 단계 · +100','Maximum rank · +100'):!owned?t('구매하면 +1 장비를 바로 장착해요.','Purchase equips +1 gear immediately.'):t(`다음 단계 +${next} · 성공 확률 100%`,`Next rank +${next} · Guaranteed success`)),
   button,h('small',{class:'forge-requirement'},max?t('모든 강화를 마쳤어요.','Every upgrade is complete.'):p.inCombat?t('전투가 끝난 뒤 강화하세요.','Available after combat ends.'):!enough?t(`${(cost-p.coins).toLocaleString()} 코인이 더 필요해요.`,`Need ${(cost-p.coins).toLocaleString()} more coins.`):t('실패 없이 강화하고 바로 저장해요.','Upgrades safely and saves immediately.')));
 }
 private render(focus?:EquipmentSlot){
  const p=this.g.player;this.last=`${language()}|${p.coins}|${p.attackRank}|${p.armorRank}|${p.weaponOwned}|${p.armorOwned}|${p.inCombat}`;
  this.content.replaceChildren(
   h('header',{class:'forge-header'},h('div',null,h('span',{class:'forge-eyebrow'},'CRABCRAFT · FORGE'),h('h1',{id:'forge-title'},t('장비 구매 · 강화','Equipment Shop & Forge')),h('p',null,this.npc?.unit.name??'')),h('button',{class:'forge-close',type:'button','aria-label':t('대장간 닫기','Close forge'),onclick:()=>this.close()},'×')),
   h('div',{class:'forge-wallet'},h('span',null,t('보유 코인','Your coins')),h('strong',null,`🪙 ${this.g.player.coins.toLocaleString()}`)),
   h('div',{class:'forge-cards'},this.card('weapon'),this.card('armor')),
   h('footer',null,h('span',null,t('장비를 먼저 구매한 뒤 강화하세요. 구매와 강화는 자동 저장돼요.','Buy equipment first, then upgrade it. Purchases and upgrades save automatically.')),h('button',{class:'forge-request',type:'button',onclick:()=>{const request=this.request;this.close();request?.();}},t('주민의 부탁 듣기','Hear villager requests'))));
  if(focus)((this.el.querySelector(`[data-slot="${focus}"]:not(:disabled)`)??this.el.querySelector('.forge-close'))as HTMLButtonElement|null)?.focus();
 }
}
