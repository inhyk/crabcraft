import {DUNGEONS,type DungeonConfig} from './dungeonData';
import {h} from '../ui/dom';
import {t} from '../i18n';
const worldName=(chapter:number)=>chapter===3?t('황혼의 성역','Twilight Reach'):chapter===4?t('얼어붙은 설원','Frostlight'):chapter===5?t('잿불 군도','Emberreach'):t('하늘숲','Skybloom');
/** Small, resolution-independent scene artwork; no downloads or per-frame work. */
function scene(d:DungeonConfig){
 const c=`#${d.color.toString(16).padStart(6,'0')}`,id=`dg-${d.level}`,fire=d.chapter===5,sky=d.chapter===6,ice=d.chapter===4;
 const art=h('div',{class:'dg-art','aria-hidden':'true'});
 const stars=Array.from({length:18},(_,i)=>`<circle cx="${(i*67+23)%300}" cy="${(i*31+8)%95}" r="${i%3===0?1.5:.6}" fill="${c}" opacity="${.2+i%4*.15}"/>`).join('');
 const pillars=[-1,1].map(side=>`<path d="M${150+side*64-12} 130V51l12-13 12 13v79z" fill="#1b2939" stroke="${c}" stroke-opacity=".35"/><path d="M${150+side*64-7} 59h14v37h-14z" fill="${c}" opacity=".22"/>`).join('');
 const terrain=fire?'<path d="M0 118l35-20 44 17 35-9 30 18 42-16 37 8 28-12 49 17v19H0z" fill="#dc5d28" opacity=".6"/><path d="M82 120l29 8-7 12M217 116l-20 12 20 12" stroke="#ffc473" stroke-width="3" fill="none"/>':sky?'<path d="M0 119q30-25 61-4t65-2 75 4 99-1v24H0" fill="#507f72"/><path d="M0 133q40-12 75 0t95 0 130-2" stroke="#a4e5cf" fill="none" opacity=".4"/>':`<path d="M0 127l25-46 39 27 23-53 39 54 22-32 46 44 32-64 38 57 36-27v53H0" fill="${ice?'#9ad5e8':'#58607f'}" opacity=".25"/>`;
 const sigil=d.level%3===0?'<path d="M150 48l15 24-15 24-15-24zM128 72h44"/>':d.level%2===0?'<path d="M150 48v48m-20-36 40 24m-40 0 40-24"/>':'<circle cx="150" cy="72" r="14"/><path d="m150 51 5 15 16 6-16 5-5 16-5-16-16-5 16-6z"/>';
 art.innerHTML=`<svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" focusable="false"><defs><radialGradient id="${id}"><stop stop-color="${c}" stop-opacity=".4"/><stop offset="1" stop-color="#111b2b" stop-opacity="0"/></radialGradient></defs><path fill="#101b2b" d="M0 0h300v140H0z"/><ellipse cx="150" cy="70" rx="130" ry="100" fill="url(#${id})"/>${stars}${terrain}<path d="M116 140V68a34 34 0 0 1 68 0v72" fill="#111a29" stroke="${c}" stroke-width="5" stroke-opacity=".5"/><path d="M125 140V69a25 25 0 0 1 50 0v71" fill="url(#${id})" stroke="${c}" stroke-opacity=".35"/>${pillars}<g fill="none" stroke="${c}" stroke-width="1.4">${sigil}</g><path d="M150 108l-43 32h86z" fill="${c}" opacity=".08"/><ellipse cx="150" cy="129" rx="76" ry="8" fill="none" stroke="${c}" stroke-opacity=".35"/></svg>`;
 return art;
}
/**
 * Server world: only the advertised tiers open, the party leader starts, and anyone in the party can join its running run.
 * Without it the menu is the browser expedition's, unchanged.
 */
export interface ServerDungeonMenu {
 available:readonly number[];
 /** No party yet (solo play creates one on start) or this player leads it. */
 canStart:boolean;
 /** The party's running run, joinable from outside; null when there is none. */
 running:{tier:number}|null;
 join:()=>void;
 /** Short line under the facts, such as who starts the expedition. */
 notice?:string;
}
export function renderDungeonMenu(panel:HTMLElement,o:{chapter:number;level:number;cleared:readonly number[];start:(level:number)=>void;close:()=>void;server?:ServerDungeonMenu}){
 const completed=DUNGEONS.filter(d=>o.cleared.includes(d.level)).length;
 const close=h('button',{type:'button',class:'dg-dismiss','aria-label':t('던전 창 닫기','Close dungeons'),onclick:o.close},'×');
 const header=h('header',{class:'dg-header'},h('div',{class:'dg-emblem','aria-hidden':'true'},'✧'),h('div',null,h('span',{class:'dg-eyebrow'},t('모험가 길드 · 원정 안내','ADVENTURERS GUILD · EXPEDITIONS')),h('h2',{id:'dungeon-dialog-title'},t('심연으로 떠나는 원정','Into the Depths')),h('p',null,t('함께 돌파하고, 새로운 기록을 남기세요.','Brave the depths. Write your next chapter.'))),close);
 const progress=h('div',{class:'dg-progress'},h('span',null,t('완료한 원정','Expeditions conquered')),h('strong',null,`${completed} / ${DUNGEONS.length}`));
 const meter=h('div',{class:'dg-meter','aria-hidden':'true'},h('i',{style:`width:${completed/DUNGEONS.length*100}%`}));progress.append(meter);
 const facts=h('div',{class:'dg-facts'},h('span',null,'⚔ ',t('3번의 전투','3 combat waves')),h('span',null,'♧ ',o.server?t('혼자 또는 파티와 함께','Solo or with your party'):t('혼자 또는 비공개 방의 친구와','Solo or with friends in a private room')),h('span',null,'↻ ',t('반복 도전 가능','Repeatable rewards')),progress);
 const tabs=h('nav',{class:'dg-tabs','aria-label':t('월드별 던전','Dungeon worlds')});
 const cards=h('div',{class:'dungeon-cards'});let filter=0;
 for(const chapter of [0,3,4,5,6]){const tab=h('button',{type:'button','aria-pressed':chapter===0?'true':'false',onclick:()=>{filter=chapter;cards.classList.toggle('is-filtered',chapter!==0);for(const c of cards.children)(c as HTMLElement).hidden=filter!==0&&Number((c as HTMLElement).dataset.chapter)!==filter;for(const b of tabs.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===tab));}},chapter===0?t('모든 원정','All expeditions'):worldName(chapter));tabs.append(tab);}
 const server=o.server;
 for(const d of DUNGEONS){
  const cleared=o.cleared.includes(d.level),locked=o.level<d.level,elsewhere=o.chapter!==d.chapter;
  if(server){cards.append(serverCard(d,cleared,locked,elsewhere,server,o.start));continue;}
  const card=h('article',{class:`dg-card${locked?' is-locked':''}${cleared?' is-cleared':''}`,style:`--dungeon-color:#${d.color.toString(16).padStart(6,'0')}`,'data-level':d.level,'data-chapter':d.chapter});
  const art=scene(d);art.append(h('span',{class:'dg-tier'},`LV ${d.level}`),h('span',{class:`dg-state ${cleared?'done':locked?'locked':elsewhere?'travel':'ready'}`},cleared?t('✓ 정복 완료','✓ Conquered'):locked?t('잠김','Locked'):elsewhere?t('다른 월드','Another world'):t('입장 가능','Ready')));
  const content=h('div',{class:'dg-content'},h('span',{class:'dg-world'},worldName(d.chapter)),h('h3',null,t(d.name[0],d.name[1])),h('p',null,t(d.subtitle[0],d.subtitle[1])));
  const reward=h('div',{class:'dg-rewards'},h('div',null,h('span',{class:'dg-coin'},'◈'),h('strong',null,d.coins.toLocaleString()),h('small',null,t('코인','COINS'))),h('div',null,h('span',{class:'dg-xp'},'✦'),h('strong',null,d.xp.toLocaleString()),h('small',null,'XP')));
  const enter=h('button',{type:'button',class:'dg-enter',disabled:locked||elsewhere,onclick:()=>o.start(d.level)},locked?t(`${d.level}레벨에 열려요`,`Unlocks at level ${d.level}`):elsewhere?t('해당 월드에서 입장','Enter from this world'):cleared?t('다시 도전하기 →','Challenge again →'):t('원정 시작하기 →','Begin expedition →'));
  content.append(reward,enter);card.append(art,content);cards.append(card);
 }
 const footer=h('footer',{class:'dg-footer'},h('span',null,t(`나의 레벨 ${o.level} · ${o.chapter>=3?worldName(o.chapter):'현재 월드에는 던전이 없어요'}`,`Level ${o.level} · ${o.chapter>=3?worldName(o.chapter):'Travel to World III or beyond'}`)),h('button',{type:'button',class:'dungeon-close',onclick:o.close},t('모험으로 돌아가기','Return to adventure')));
 const notice=server?.notice?h('p',{class:'dg-notice',role:'status'},server.notice):null;
 panel.replaceChildren(...[header,facts,notice,tabs,cards,footer].filter((x):x is HTMLElement=>!!x));panel.setAttribute('aria-labelledby','dungeon-dialog-title');close.focus({preventScroll:true});
}
function serverCard(d:DungeonConfig,cleared:boolean,locked:boolean,elsewhere:boolean,server:ServerDungeonMenu,start:(level:number)=>void):HTMLElement {
 const offered=server.available.includes(d.level),running=server.running?.tier===d.level,busy=!!server.running&&!running;
 const card=h('article',{class:`dg-card${locked||!offered?' is-locked':''}${cleared?' is-cleared':''}${running?' is-running':''}`,style:`--dungeon-color:#${d.color.toString(16).padStart(6,'0')}`,'data-level':d.level,'data-chapter':d.chapter});
 const state=running?['running',t('⚔ 파티 원정 중','⚔ Party inside')]:cleared?['done',t('✓ 정복 완료','✓ Conquered')]:!offered||locked?['locked',t('잠김','Locked')]:elsewhere?['travel',t('다른 월드','Another world')]:['ready',t('입장 가능','Ready')];
 const art=scene(d);art.append(h('span',{class:'dg-tier'},`LV ${d.level}`),h('span',{class:`dg-state ${state[0]}`},state[1]));
 const content=h('div',{class:'dg-content'},h('span',{class:'dg-world'},worldName(d.chapter)),h('h3',null,t(d.name[0],d.name[1])),h('p',null,t(d.subtitle[0],d.subtitle[1])));
 const reward=h('div',{class:'dg-rewards'},h('div',null,h('span',{class:'dg-coin'},'◈'),h('strong',null,d.coins.toLocaleString()),h('small',null,t('코인','COINS'))),h('div',null,h('span',{class:'dg-xp'},'✦'),h('strong',null,d.xp.toLocaleString()),h('small',null,'XP')));
 // One rule per card, in the order the server checks: the run that is going on first, then this server, level, world and leader.
 const [label,action]:[string,(()=>void)|null]=running?[t('파티 원정에 참가하기 →','Join your party →'),server.join]
  :!offered?[t('이 서버에서는 아직 닫혀 있어요','Not open on this server yet'),null]
  :locked?[t(`${d.level}레벨에 열려요`,`Unlocks at level ${d.level}`),null]
  :elsewhere?[t('해당 월드에서 입장','Enter from this world'),null]
  :busy?[t('파티가 다른 원정 중이에요','Your party is on another expedition'),null]
  :!server.canStart?[t('파티장이 시작할 수 있어요','The party leader starts it'),null]
  :[cleared?t('다시 도전하기 →','Challenge again →'):t('원정 시작하기 →','Begin expedition →'),()=>start(d.level)];
 const enter=h('button',{type:'button',class:`dg-enter${running?' is-join':''}`,disabled:!action,onclick:()=>action?.()},label);
 content.append(reward,enter);card.append(art,content);return card;
}

export interface DungeonStatusView {
 title:string;stage:number;phase:'rest'|'wave'|'clear'|'failed';left:number;alive:number;
 /** Replaces the phase line, such as the rewards a server run actually paid. */
 text?:string;
 actions:readonly {label:string;action:()=>void;secondary?:boolean}[];
}
/** The in-chamber banner: three wave steps, the expedition name, what happens now and the ways out. */
export function renderDungeonStatus(status:HTMLElement,v:DungeonStatusView){
 status.hidden=false;const title=document.createElement('strong');title.textContent=v.title;
 const text=document.createElement('span');text.textContent=v.text??(v.phase==='clear'?t('원정 성공 · 보상 획득','Expedition complete · Rewards earned'):v.phase==='failed'?t('원정 실패 · 다시 도전해 보세요','Expedition failed · Try again'):v.phase==='rest'?t(`${v.stage}/3 전투 · ${Math.ceil(v.left)}초 뒤 시작`,`Wave ${v.stage}/3 · Starts in ${Math.ceil(v.left)}s`):t(`${v.stage}/3 전투 · 적 ${v.alive}마리 · 붉은 바닥을 피하세요`, `Wave ${v.stage}/3 · ${v.alive} enemies · Avoid the red floor`));
 const buttons=v.actions.map(a=>{const b=document.createElement('button');b.type='button';b.textContent=a.label;b.onclick=a.action;if(a.secondary)b.className='dg-secondary';return b;});
 const stages=document.createElement('div');stages.className='dg-stages';stages.setAttribute('aria-label',t(`${v.stage}/3 전투 진행`,`Wave ${v.stage} of 3`));for(let i=1;i<=3;i++){const step=document.createElement('i');step.className=v.phase==='clear'||i<v.stage?'done':i===v.stage?'current':'';step.textContent=v.phase==='clear'||i<v.stage?'✓':String(i);stages.append(step);}
 status.dataset.phase=v.phase;
 if(buttons.length>1){const row=document.createElement('div');row.className='dg-status-actions';row.append(...buttons);status.replaceChildren(stages,title,text,row);}else status.replaceChildren(stages,title,text,...buttons);
}
