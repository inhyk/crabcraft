const races = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
const classes = ['warrior', 'mage', 'priest'];
// Clips a player plays. The breakdance's six moves (src/motion/breakdance.ts ROUTINE) are sent one by
// one as they start, so every copy keeps step with its owner; 'breakdance_stop' cuts one short.
export const actions = new Set(['jump', 'gesture_hello', 'gesture_bow', 'gesture_salute', 'gesture_paw', 'dance_crab', 'dance_brazilian', 'dance_dream_wings', 'dance_maze', 'attack_swipe', 'attack_slam', 'cast', 'hit_react', 'death', 'sit',
  'break_toprock', 'break_sixstep', 'break_spin', 'break_jumpspin', 'break_backflip', 'break_oneclaw', 'breakdance_stop']);
const finite = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
export const clean = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

export type Spec = { race: string; sex: string; classId: string; shell: number; crest: number; led: number; name: string };
export type State = { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean; level?: number; life?: number };


export function specOf(value: unknown): Spec | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Spec;
  if (!races.includes(s.race) || !classes.includes(s.classId) || !['male', 'female'].includes(s.sex)) return null;
  if (![s.shell, s.crest, s.led].every(n => Number.isInteger(n) && n >= 0 && n <= 3)) return null;
  return { race: s.race, sex: s.sex, classId: s.classId, shell: s.shell, crest: s.crest, led: s.led, name: clean(s.name, 24) || 'Crab' };
}
export function stateOf(s: State): State | null {
  if(s?.life!==undefined&&(!Number.isInteger(s.life)||s.life<1||s.life>0xffffffff))return null;
  if (!s || !finite(s.x, 2000) || !finite(s.z, 2000) || !finite(s.y, 200) || !finite(s.yaw, 10000) || !finite(s.hp, Number.MAX_SAFE_INTEGER) || !finite(s.maxHp, Number.MAX_SAFE_INTEGER) || s.maxHp <= 0 || typeof s.alive !== 'boolean') return null;
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: Math.max(0, Math.min(s.hp, s.maxHp)), maxHp: s.maxHp, alive: s.alive, ...(s.life===undefined?{}:{life:s.life}), ...(Number.isInteger(s.level) && s.level! >= 1 && s.level! <= Number.MAX_SAFE_INTEGER ? { level: s.level } : {}) };
}

