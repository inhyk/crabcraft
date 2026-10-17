import type {Game} from './game';
import {t} from '../i18n';
import {h} from '../ui/dom';
import './achievements.css';
export const ACHIEVEMENTS=[
 ['sail','첫 항해','First Voyage','배를 조종하거나 타고 10m 항해하기','Travel 10 m aboard the skiff'],
 ['crew','둘이서 바다로','Better Together','친구와 두 좌석을 함께 채우기','Sail with a friend in both seats'],
 ['landfall','발밑의 새 땅','Land Ahoy','배 앞의 안전한 해안에 내리기','Disembark onto a safe nearby shore'],
 ['island','산호바람의 발견자','Coralwind Explorer','배로 산호바람 섬에 도착하기','Reach Coralwind Isle by boat'],
 ['treasure','진주빛 보물','Pearl Treasure','섬의 보물상자 열기 · 75 코인','Open the island chest · 75 coins'],
 ['moon','달빛을 찾아서','Moonlight Seeker','달조각 섬의 해안에 내리기','Land on Moonshard Isle'],
 ['sunset','난파선 탐험가','Wreck Explorer','노을 난파선 섬의 해안에 내리기','Land on Amberwreck Isle'],
 ['moonTreasure','수정 속의 선물','Crystal Gift','달조각 보물 열기 · 100 코인','Open the moon chest · 100 coins'],
 ['sunsetTreasure','선장의 유산','Captain’s Legacy','난파선 보물 열기 · 125 코인','Open the wreck chest · 125 coins'],
 ['archipelago','세 섬의 항해사','Archipelago Voyager','바다의 세 섬 모두 발견하기','Discover all three offshore islands'],
 ['rust','녹슨 왕관','Rusty Crown','3레벨 보스 처치','Defeat the level 3 boss'],
 ['abyss','심해 정복자','Deep Conqueror','10레벨 보스 처치','Defeat the level 10 boss'],
 ['eclipse','일식을 넘어서','Beyond the Eclipse','20레벨 보스 처치','Defeat the level 20 boss'],
 ['dawn','친구와 맞는 새벽','Dawn with Friends','100레벨 보스 처치','Defeat the level 100 boss'],
 ['secret','등대의 작은 비밀','Keeper’s Secret','등대 아래 이스터에그 발견','Find the secret below the lighthouse'],
] as const;
export type AchievementId=typeof ACHIEVEMENTS[number][0];
export class Achievements{
 private earned=new Set<AchievementId>();distance=0;private last:{x:number;z:number}|null=null;
 constructor(private g:Game){}
 has(id:AchievementId){return this.earned.has(id);}
 unlock(id:AchievementId){if(this.earned.has(id))return false;this.earned.add(id);const a=ACHIEVEMENTS.find(a=>a[0]===id)!;this.g.hud.messages.info(t(`🏆 업적 달성: ${a[1]}`,`🏆 Achievement: ${a[2]}`));this.g.journey?.save();return true;}
 restore(value:unknown){if(!value||typeof value!=='object')return;const v=value as {earned?:unknown;distance?:unknown};if(Array.isArray(v.earned))this.earned=new Set(v.earned.filter((id):id is AchievementId=>ACHIEVEMENTS.some(a=>a[0]===id)));if(typeof v.distance==='number'&&Number.isFinite(v.distance))this.distance=Math.max(0,Math.min(1e7,v.distance));}
 snapshot(){return {earned:[...this.earned],distance:Math.round(this.distance*100)/100};}
 update(dt:number){const g=this.g,s=g.boats?.state;if(g.boats?.seated&&s&&g.world2.chapter===1){if(this.last&&dt>0){const d=Math.hypot(s.x-this.last.x,s.z-this.last.z);if(d<Math.max(2,dt*12))this.distance+=d;}this.last={x:s.x,z:s.z};if(this.distance>=10)this.unlock('sail');if(s.seats.filter(Boolean).length===2)this.unlock('crew');}else this.last=null;
 const site=g.voyageIsland?.currentIsland;if(site&&!g.boats?.seated&&g.player.unit.alive)this.unlock(site.id);
 if(['island','moon','sunset'].every(id=>this.has(id as AchievementId)))this.unlock('archipelago');
 for(const [id,yes] of [['rust',g.journey?.rustCleared],['abyss',g.journey?.abyssCleared],['eclipse',g.journey?.trueCleared],['dawn',g.journey?.finalCleared],['secret',g.lighthouseSecret?.found]] as const)if(yes)this.unlock(id);
 }
 panel(){const list=h('div',{class:'achievement-list'});for(const a of ACHIEVEMENTS){const done=this.has(a[0]);list.append(h('div',{class:'achievement-row'+(done?' earned':'')},h('strong',{},`${done?'🏆':'◇'} ${t(a[1],a[2])}`),h('span',{},t(a[3],a[4])),h('small',{},done?t('달성 완료','Unlocked'):a[0]==='sail'?`${Math.min(10,Math.floor(this.distance))}/10 m`:t('미달성','Locked'))));}return h('div',{class:'achievement-body'},h('p',{},t(`${this.earned.size} / ${ACHIEVEMENTS.length} 달성 · 캐릭터와 함께 저장됩니다`,`${this.earned.size} / ${ACHIEVEMENTS.length} unlocked · Saved with your character`)),list);}
}
