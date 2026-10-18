const races = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
const classes = ['warrior', 'mage', 'priest'];
// Clips a player plays. The breakdance's six moves (src/motion/breakdance.ts ROUTINE) are sent one by
// one as they start, so every copy keeps step with its owner; 'breakdance_stop' cuts one short.
export const actions = new Set(['jump', 'gesture_hello', 'gesture_bow', 'gesture_salute', 'gesture_paw', 'dance_crab', 'dance_brazilian', 'dance_dream_wings', 'dance_maze', 'attack_swipe', 'attack_slam', 'cast', 'hit_react', 'death', 'sit',
  'break_toprock', 'break_sixstep', 'break_spin', 'break_jumpspin', 'break_backflip', 'break_oneclaw', 'breakdance_stop']);
const finite = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
export const clean = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

export type Spec = { race: string; sex: string; classId: string; shell: number; crest: number; led: number; name: string };
export type State = { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean; level?: number; area?: number };


export function specOf(value: unknown): Spec | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Spec;
  if (!races.includes(s.race) || !classes.includes(s.classId) || !['male', 'female'].includes(s.sex)) return null;
  if (![s.shell, s.crest, s.led].every(n => Number.isInteger(n) && n >= 0 && n <= 3)) return null;
  return { race: s.race, sex: s.sex, classId: s.classId, shell: s.shell, crest: s.crest, led: s.led, name: clean(s.name, 24) || 'Crab' };
}
export function stateOf(s: State): State | null {
  if (!s || !finite(s.x, 2000) || !finite(s.z, 2000) || !finite(s.y, 200) || !finite(s.yaw, 10000) || !finite(s.hp, Number.MAX_SAFE_INTEGER) || !finite(s.maxHp, Number.MAX_SAFE_INTEGER) || s.maxHp <= 0 || typeof s.alive !== 'boolean') return null;
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: Math.max(0, Math.min(s.hp, s.maxHp)), maxHp: s.maxHp, alive: s.alive, ...(Number.isInteger(s.level) && s.level! >= 1 && s.level! <= Number.MAX_SAFE_INTEGER ? { level: s.level } : {}), ...([1, 2, 3, 4, 5, 6].includes(s.area!) ? { area: s.area } : {}) };
}

// The class abilities (src/sim/data/classes.ts) whose effects a player shares.
const abilities = new Set(['crown-burst', 'pincer-strike', 'shell-bash', 'sideways-charge', 'whirlpool', 'bubble-bolt', 'frost-spray', 'steam-blink', 'tidal-nova', 'smite', 'mend-shell', 'barnacle-ward', 'holy-tide']);
type Point = { x: number; y: number; z: number };
/**
 * A player's skill effects, which everyone else in the room (and the monitor) draws: an ability going off,
 * a projectile flying to a unit, a cast in progress (`seconds` 0 ends it), a barnacle ward. Units are named
 * by player id or combat key (server/combatProtocol.ts). Only looks; damage still goes through combat.
 */
export type Skill =
  | { fx: 'ability'; ability: string; stage: 'start' | 'hit'; at: Point; yaw: number; target?: string; from?: Point; range?: number; half?: number; stun?: number }
  | { fx: 'projectile'; stage: 'spawn'; id: number; target: string; from: Point; style: 'bubble' | 'spark' | 'holy' | 'rust'; speed: number }
  | { fx: 'projectile'; stage: 'hit'; id: number }
  | { fx: 'cast'; ability?: string; seconds: number }
  | { fx: 'ward'; stage: 'up' | 'hit' | 'down'; seconds?: number };
const point = (p: any): Point | null => p && typeof p === 'object' && finite(p.x, 2000) && finite(p.y, 200) && finite(p.z, 2000) ? { x: p.x, y: p.y, z: p.z } : null;
const unitKey = (k: unknown) => typeof k === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(k);
const optional = (s: any, key: string, max: number) => s[key] === undefined ? {} : finite(s[key], max) && s[key] >= 0 ? { [key]: s[key] } : null;
export function skillOf(value: unknown): Skill | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as any;
  if (s.fx === 'ability') {
    const at = point(s.at), from = s.from === undefined ? undefined : point(s.from), more = [optional(s, 'range', 50), optional(s, 'half', 4), optional(s, 'stun', 10)];
    if (!abilities.has(s.ability) || !['start', 'hit'].includes(s.stage) || !at || !finite(s.yaw, 10000) || from === null || more.includes(null) || (s.target !== undefined && !unitKey(s.target))) return null;
    return { fx: 'ability', ability: s.ability, stage: s.stage, at, yaw: s.yaw, ...(s.target === undefined ? {} : { target: s.target }), ...(from ? { from } : {}), ...Object.assign({}, ...more) };
  }
  if (s.fx === 'projectile') {
    if (!Number.isSafeInteger(s.id) || s.id < 0) return null;
    if (s.stage === 'hit') return { fx: 'projectile', stage: 'hit', id: s.id };
    const from = point(s.from);
    if (s.stage !== 'spawn' || !from || !unitKey(s.target) || !['bubble', 'spark', 'holy', 'rust'].includes(s.style) || !finite(s.speed, 100) || s.speed <= 0) return null;
    return { fx: 'projectile', stage: 'spawn', id: s.id, target: s.target, from, style: s.style, speed: s.speed };
  }
  if (s.fx === 'cast') {
    if (!finite(s.seconds, 10) || s.seconds < 0 || (s.seconds > 0 && !abilities.has(s.ability))) return null;
    return s.seconds > 0 ? { fx: 'cast', ability: s.ability, seconds: s.seconds } : { fx: 'cast', seconds: 0 };
  }
  if (s.fx === 'ward') {
    const seconds = optional(s, 'seconds', 60);
    if (!['up', 'hit', 'down'].includes(s.stage) || !seconds) return null;
    return { fx: 'ward', stage: s.stage, ...seconds };
  }
  return null;
}

