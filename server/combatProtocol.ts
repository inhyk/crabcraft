/** One elected browser simulates the world. The relay authenticates its authority. */
export type EntityState = {
  id: string; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number;
  level: number; alive: boolean; hidden: boolean; invulnerable: boolean; targetable: boolean;
  stun: number; slow: number; slowPct: number; rust: number; rustFor: number;
  enemyState?: 'idle' | 'chase' | 'leash' | 'dead' | 'gone'; xp?: number;
};
export type BossState = {
  id: 'b3' | 'b10' | 'b20' | 'b30'; state: 'dormant' | 'waking' | 'idle' | 'fight' | 'dying' | 'dead'; phase: number; enraged: boolean;
  timeline?: { state: number; freed: number; freedYaw: number; released: boolean };
  mech: null | { id: number; kind: 'slam' | 'spray' | 'undertow' | 'nova' | 'eclipse' | 'cross' | 'barrage'; at: number[]; yaw: number; left: number };
};
export type WorldState = { weather: { mood: 0 | 1 | 2 | 3; beacon: boolean; clock: number }; entities: EntityState[]; bosses: BossState[]; rust: boolean; abyss: boolean; chapter: 1 | 2 | 3; finalCleared?: boolean; firstEnding: boolean; trueCleared: boolean; social?:{mode:'coop'|'pvp';parties:Record<string,number>} };
export type CombatEvent = {
  kind: 'party' | 'duel' | 'chapter' | 'environment' | 'condition' | 'attack' | 'hit' | 'death' | 'animation' | 'challenge' | 'effect';
  target: string; chapter?:1|2|3; party?:number; serial?: number; source?: string; amount?: number; crit?: boolean; rage?: number; action?: string;
  environment?: { mood?: 0 | 1 | 2 | 3; beacon?: boolean };
  condition?: { stun: number; slow: number; slowPct: number; pushX: number; pushZ: number; pushTime: number };
  effect?: { stun: number; rust: number; rustFor: number; pushX: number; pushZ: number; pushTime: number };
};
const n = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const key = (v: unknown): v is string => typeof v === 'string' && /^([ent]\d{1,3}|b3|b10|b20|b30|f3|f10|f20|f30)$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function worldOf(v: unknown): WorldState | null {
  if (!record(v) || !Array.isArray(v.entities) || v.entities.length > 128 || !Array.isArray(v.bosses) || ![3,4].includes(v.bosses.length) || typeof v.rust !== 'boolean' || typeof v.abyss !== 'boolean' || ![1,2,3].includes(v.chapter) || (v.finalCleared!==undefined&&typeof v.finalCleared!=='boolean') || typeof v.firstEnding !== 'boolean' || typeof v.trueCleared !== 'boolean') return null;
  if (!record(v.weather) || ![0,1,2,3].includes(v.weather.mood) || typeof v.weather.beacon !== 'boolean' || !n(v.weather.clock,0,10000000)) return null;
  if(v.social!==undefined){
    if(!record(v.social)||!['coop','pvp'].includes(v.social.mode)||!record(v.social.parties))return null;
    const members=Object.entries(v.social.parties);if(members.length>8||members.some(([id,p])=>!/^[a-zA-Z0-9-]{1,64}$/.test(id)||!Number.isInteger(p)||!n(p,0,4)))return null;
  }
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
    if (!record(b) || !['b3','b10','b20','b30'].includes(b.id) || bossIds.has(b.id) || !['dormant','waking','idle','fight','dying','dead'].includes(b.state) || !n(b.phase,1,3) || typeof b.enraged !== 'boolean') return null;
    bossIds.add(b.id);
    const timeline=b.timeline;
    if(timeline!==undefined&&(!record(timeline)||!n(timeline.state,0,60)||!n(timeline.freed,-1,13)||!n(timeline.freedYaw,-10000,10000)||typeof timeline.released!=='boolean'))return null;
    const m = b.mech;
    if (m !== null && (!record(m) || !n(m.id) || !['slam','spray','undertow','nova','eclipse','cross','barrage'].includes(m.kind) || !Array.isArray(m.at) || m.at.length !== 3 || !m.at.every((x: unknown) => n(x,-2000,2000)) || !n(m.yaw,-10000,10000) || !n(m.left,0,10))) return null;
  }
  if(!['b3','b10','b20'].every(id=>bossIds.has(id))||(v.chapter===3&&!bossIds.has('b30'))||(v.finalCleared===true&&!bossIds.has('b30')))return null;
  return v as WorldState;
}
export function eventOf(v: unknown, authority: boolean): CombatEvent | null {
  if (!record(v) || typeof v.target !== 'string' || v.target.length > 64) return null;
  if (!authority) {
    if(v.kind==='party'&&Number.isInteger(v.party)&&n(v.party,0,4))return {kind:'party',target:'world',party:v.party};
    if(v.kind==='duel'&&/^[a-zA-Z0-9-]{1,64}$/.test(v.target)&&n(v.amount,1,Number.MAX_SAFE_INTEGER))return {kind:'duel',target:v.target,amount:v.amount,crit:v.crit===true};
    if (v.kind === 'chapter' && v.target === 'world' && [1,2,3].includes(v.chapter)) return {kind:'chapter',target:'world',chapter:v.chapter};
    if (v.kind === 'environment' && record(v.environment) && ([0,1,2,3].includes(v.environment.mood) || typeof v.environment.beacon === 'boolean')) return {kind:'environment',target:'world',environment:{...([0,1,2,3].includes(v.environment.mood)?{mood:v.environment.mood}:{}),...(typeof v.environment.beacon==='boolean'?{beacon:v.environment.beacon}:{})}};
    const f=v.condition;
    if (v.kind === 'condition' && key(v.target) && record(f) && n(f.stun,0,2) && n(f.slow,0,4) && n(f.slowPct,0,0.5) && n(f.pushX,-30,30) && n(f.pushZ,-30,30) && n(f.pushTime,0,0.5)) return { kind:'condition',target:v.target,condition:f as CombatEvent['condition'] };
    if (v.kind === 'challenge' && ['b3','b10','b20','b30'].includes(v.target)) return { kind: 'challenge', target: v.target };
    if (v.kind === 'attack' && key(v.target) && n(v.amount,1,Number.MAX_SAFE_INTEGER)) return { kind: 'attack', target: v.target, amount: v.amount, crit: v.crit === true, rage: n(v.rage,0,100) ? v.rage : 0 };
    return null;
  }
  if (v.kind === 'hit' && n(v.amount,1,Number.MAX_SAFE_INTEGER)) return { kind: 'hit', target: v.target, source: key(v.source) ? v.source : undefined, amount: v.amount, crit: v.crit === true };
  if (v.kind === 'death' && key(v.target) && n(v.serial,1,1000000)) return { kind: 'death', target: v.target, serial: v.serial };
  if (v.kind === 'animation' && key(v.target) && typeof v.action === 'string' && /^[a-z_]{1,40}$/.test(v.action)) return { kind: 'animation', target: v.target, action: v.action };
  if (v.kind === 'effect' && record(v.effect) && n(v.effect.stun,0,10) && n(v.effect.rust,0,5) && n(v.effect.rustFor,0,20) && n(v.effect.pushX,-50,50) && n(v.effect.pushZ,-50,50) && n(v.effect.pushTime,0,3)) return { kind: 'effect', target: v.target, effect: v.effect as CombatEvent['effect'] };
  return null;
}
