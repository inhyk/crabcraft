export type VillageRound={id:string;mode:'hide'|'tag';phase:'ready'|'play'|'done';left:number;starter:string;seeker:string;members:string[];caught:string[];result:'seekers'|'runners'|'cancelled'|''};
export type BoatState={exits?:Record<string,{x:number;z:number;shore:boolean}>;x:number;z:number;yaw:number;speed:number;seats:[string|null,string|null]};
export type BoatCommand={action:'board'|'leave'|'drive'|'call';throttle:number;steer:number};
/** One elected browser simulates the world. The relay authenticates its authority. */
export type EntityState = {
  id: string; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number;
  level: number; alive: boolean; hidden: boolean; invulnerable: boolean; targetable: boolean;
  stun: number; slow: number; slowPct: number; rust: number; rustFor: number;
  seaCast?: { id:number; x:number; y:number; z:number; left:number };
  enemyState?: 'idle' | 'chase' | 'leash' | 'dead' | 'gone'; xp?: number;
};
export type BossState = {
  id: 'b3' | 'b10' | 'b20' | 'b30' | 'b300'; state: 'dormant' | 'waking' | 'idle' | 'fight' | 'dying' | 'dead'; phase: number; enraged: boolean;
  timeline?: { state: number; freed: number; freedYaw: number; released: boolean };
  mech: null | { id: number; kind: 'slam' | 'spray' | 'undertow' | 'nova' | 'eclipse' | 'cross' | 'barrage'; at: number[]; yaw: number; left: number };
};
import type {DungeonState} from '../src/game/dungeonData.ts';
export type WorldState = { dungeon?:DungeonState|null; village?:VillageRound|null; boat?:BoatState; weather: { mood: 0 | 1 | 2 | 3; beacon: boolean; clock: number }; entities: EntityState[]; bosses: BossState[]; rust: boolean; abyss: boolean; chapter: 1 | 2 | 3 | 4; frostCleared?: boolean; finalCleared?: boolean; firstEnding: boolean; trueCleared: boolean; social?:{mode:'coop'|'pvp';parties:Record<string,number>} };
export type CombatEvent = {
  village?:'hide'|'tag'|'stop';
  boat?:BoatCommand;
  run?:string;
  kind: 'dungeon-return' | 'village' | 'boat' | 'party' | 'duel' | 'chapter' | 'environment' | 'condition' | 'attack' | 'hit' | 'death' | 'animation' | 'challenge' | 'effect';
  target: string; chapter?:1|2|3|4; party?:number; serial?: number; source?: string; amount?: number; crit?: boolean; rage?: number; action?: string;
  environment?: { mood?: 0 | 1 | 2 | 3; beacon?: boolean };
  condition?: { stun: number; slow: number; slowPct: number; pushX: number; pushZ: number; pushTime: number };
  effect?: { stun: number; rust: number; rustFor: number; pushX: number; pushZ: number; pushTime: number };
};
const n = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const key = (v: unknown): v is string => typeof v === 'string' && /^([ent]\d{1,3}|b3|b10|b20|b30|b300|f3|f10|f20|f30|f300)$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function worldOf(v: unknown): WorldState | null {
  if (!record(v) || !Array.isArray(v.entities) || v.entities.length > 128 || !Array.isArray(v.bosses) || ![3,4,5].includes(v.bosses.length) || typeof v.rust !== 'boolean' || typeof v.abyss !== 'boolean' || ![1,2,3,4].includes(v.chapter) || (v.frostCleared!==undefined&&typeof v.frostCleared!=='boolean') || (v.finalCleared!==undefined&&typeof v.finalCleared!=='boolean') || typeof v.firstEnding !== 'boolean' || typeof v.trueCleared !== 'boolean') return null;
  if (!record(v.weather) || ![0,1,2,3].includes(v.weather.mood) || typeof v.weather.beacon !== 'boolean' || !n(v.weather.clock,0,10000000)) return null;
  if(v.dungeon!==undefined&&v.dungeon!==null){const d=v.dungeon;
    if(!record(d)||(d.level<100?v.chapter!==3:v.chapter!==4)||![35,50,75,150,200,250].includes(d.level)||typeof d.run!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(d.run)||!Number.isInteger(d.stage)||!n(d.stage,1,3)||!['wave','rest','clear','failed'].includes(d.phase)||!n(d.left,0,10)||!n(d.clock,0,10000000)||!Number.isSafeInteger(d.hazard)||!n(d.hazard,0,10000000)||!Array.isArray(d.members)||d.members.length>8||d.members.some((m:unknown)=>typeof m!=='string'||m.length>64)||new Set(d.members).size!==d.members.length)return null;
  }
  if(v.village!==undefined&&v.village!==null){
    const r=v.village,member=(id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id);
    if(!record(r)||!member(r.id)||!member(r.starter)||!member(r.seeker)||!['hide','tag'].includes(r.mode)||!['ready','play','done'].includes(r.phase)||!n(r.left,0,180)||!['','seekers','runners','cancelled'].includes(r.result)||!Array.isArray(r.members)||r.members.length<1||r.members.length>8||r.members.some((id:unknown)=>!member(id))||new Set(r.members).size!==r.members.length||!r.members.includes(r.starter)||(!r.members.includes(r.seeker)&&!/^npc[0-9]{1,3}$/.test(r.seeker))||!Array.isArray(r.caught)||new Set(r.caught).size!==r.caught.length||r.caught.some((id:unknown)=>!r.members.includes(id)||id===r.seeker))return null;
  }
  if(v.social!==undefined){
    if(!record(v.social)||!['coop','pvp'].includes(v.social.mode)||!record(v.social.parties))return null;
    const members=Object.entries(v.social.parties);if(members.length>8||members.some(([id,p])=>!/^[a-zA-Z0-9-]{1,64}$/.test(id)||!Number.isInteger(p)||!n(p,0,4)))return null;
  }
  if(v.boat!==undefined){const b=v.boat;if(!record(b)||!n(b.x,-2000,2000)||!n(b.z,-2000,2000)||!n(b.yaw,-10000,10000)||!n(b.speed,-10,10)||!Array.isArray(b.seats)||b.seats.length!==2||b.seats.some((id:unknown)=>id!==null&&(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(id)))||(b.seats[0]!==null&&b.seats[0]===b.seats[1]))return null;}
  if(v.boat?.exits!==undefined){const exits=v.boat.exits;if(!record(exits)||Object.keys(exits).length>8||Object.entries(exits).some(([id,e])=>!/^[a-zA-Z0-9-]{1,64}$/.test(id)||!record(e)||!n(e.x,-2000,2000)||!n(e.z,-2000,2000)||typeof e.shore!=='boolean'))return null;}
  const ids = new Set<string>();
  for (const e of v.entities) {
    if (!record(e) || !key(e.id) || ids.has(e.id)) return null;
    ids.add(e.id);
    if (!n(e.x,-2000,2000) || !n(e.z,-2000,2000) || !n(e.y,-200,200) || !n(e.yaw,-10000,10000) || !n(e.hp) || !n(e.maxHp,1) || e.hp > e.maxHp || !n(e.level,1,Number.MAX_SAFE_INTEGER)) return null;
    if (!['alive','hidden','invulnerable','targetable'].every(k => typeof e[k] === 'boolean') || !['stun','slow','rustFor'].every(k => n(e[k],0,60)) || !n(e.slowPct,0,1) || !n(e.rust,0,5)) return null;
    if (e.enemyState !== undefined && !['idle','chase','leash','dead','gone'].includes(e.enemyState)) return null;
    if (e.xp !== undefined && !n(e.xp,0,Number.MAX_SAFE_INTEGER)) return null;
  }
  const bossIds = new Set<string>();
  for (const b of v.bosses) {
    if (!record(b) || !['b3','b10','b20','b30','b300'].includes(b.id) || bossIds.has(b.id) || !['dormant','waking','idle','fight','dying','dead'].includes(b.state) || !n(b.phase,1,3) || typeof b.enraged !== 'boolean') return null;
    bossIds.add(b.id);
    const timeline=b.timeline;
    if(timeline!==undefined&&(!record(timeline)||!n(timeline.state,0,60)||!n(timeline.freed,-1,13)||!n(timeline.freedYaw,-10000,10000)||typeof timeline.released!=='boolean'))return null;
    const m = b.mech;
    if (m !== null && (!record(m) || !n(m.id) || !['slam','spray','undertow','nova','eclipse','cross','barrage'].includes(m.kind) || !Array.isArray(m.at) || m.at.length !== 3 || !m.at.every((x: unknown) => n(x,-2000,2000)) || !n(m.yaw,-10000,10000) || !n(m.left,0,10))) return null;
  }
  if(!['b3','b10','b20'].every(id=>bossIds.has(id))||(v.chapter>=3&&!bossIds.has('b30'))||(v.chapter===4&&!bossIds.has('b300'))||(v.frostCleared===true&&!bossIds.has('b300'))||(v.finalCleared===true&&!bossIds.has('b30')))return null;
  return v as WorldState;
}
export function eventOf(v: unknown, authority: boolean): CombatEvent | null {
  if (!record(v) || typeof v.target !== 'string' || v.target.length > 64) return null;
  if (!authority) {
    if(v.kind==='dungeon-return'&&v.target==='world'&&typeof v.run==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v.run))return {kind:'dungeon-return',target:'world',run:v.run};
    if(v.kind==='village'&&v.target==='world'&&['hide','tag','stop'].includes(v.village))return {kind:'village',target:'world',village:v.village};
    if(v.kind==='boat'&&v.target==='world'&&record(v.boat)&&['board','leave','drive','call'].includes(v.boat.action)&&Number.isInteger(v.boat.throttle)&&n(v.boat.throttle,-1,1)&&Number.isInteger(v.boat.steer)&&n(v.boat.steer,-1,1))return {kind:'boat',target:'world',boat:{action:v.boat.action,throttle:v.boat.throttle,steer:v.boat.steer}};
    if(v.kind==='party'&&Number.isInteger(v.party)&&n(v.party,0,4))return {kind:'party',target:'world',party:v.party};
    if(v.kind==='duel'&&/^[a-zA-Z0-9-]{1,64}$/.test(v.target)&&n(v.amount,1,Number.MAX_SAFE_INTEGER))return {kind:'duel',target:v.target,amount:v.amount,crit:v.crit===true};
    if (v.kind === 'chapter' && v.target === 'world' && [1,2,3,4].includes(v.chapter)) return {kind:'chapter',target:'world',chapter:v.chapter};
    if (v.kind === 'environment' && record(v.environment) && ([0,1,2,3].includes(v.environment.mood) || typeof v.environment.beacon === 'boolean')) return {kind:'environment',target:'world',environment:{...([0,1,2,3].includes(v.environment.mood)?{mood:v.environment.mood}:{}),...(typeof v.environment.beacon==='boolean'?{beacon:v.environment.beacon}:{})}};
    const f=v.condition;
    if (v.kind === 'condition' && key(v.target) && record(f) && n(f.stun,0,2) && n(f.slow,0,4) && n(f.slowPct,0,0.5) && n(f.pushX,-30,30) && n(f.pushZ,-30,30) && n(f.pushTime,0,0.5)) return { kind:'condition',target:v.target,condition:f as CombatEvent['condition'] };
    if (v.kind === 'challenge' && ['b3','b10','b20','b30','b300'].includes(v.target)) return { kind: 'challenge', target: v.target };
    if (v.kind === 'attack' && key(v.target) && n(v.amount,1,Number.MAX_SAFE_INTEGER)) return { kind: 'attack', target: v.target, amount: v.amount, crit: v.crit === true, rage: n(v.rage,0,100) ? v.rage : 0 };
    return null;
  }
  if (v.kind === 'hit' && n(v.amount,1,Number.MAX_SAFE_INTEGER)) return { kind: 'hit', target: v.target, source: key(v.source) ? v.source : undefined, amount: v.amount, crit: v.crit === true };
  if (v.kind === 'death' && key(v.target) && n(v.serial,1,1000000)) return { kind: 'death', target: v.target, serial: v.serial };
  if (v.kind === 'animation' && key(v.target) && typeof v.action === 'string' && /^[a-z_]{1,40}$/.test(v.action)) return { kind: 'animation', target: v.target, action: v.action };
  if (v.kind === 'effect' && record(v.effect) && n(v.effect.stun,0,10) && n(v.effect.rust,0,5) && n(v.effect.rustFor,0,20) && n(v.effect.pushX,-50,50) && n(v.effect.pushZ,-50,50) && n(v.effect.pushTime,0,3)) return { kind: 'effect', target: v.target, effect: v.effect as CombatEvent['effect'] };
  return null;
}
