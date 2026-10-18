/** Numeric S1 enemy balance. No localization or renderer dependencies. */
export type EnemyKind = 'scrapling' | 'scavenger' | 'jellyfish';
export interface EnemyStats { level:number; hp:number; speed:number; aggro:number; dmg:[number,number]; swing:number; xp:number; leash:number; respawn:number }
export const ENEMY_STATS: Readonly<Record<EnemyKind, Readonly<EnemyStats>>> = Object.freeze({
  jellyfish: Object.freeze({level:2,hp:85,speed:2.6,aggro:9,dmg:[6,9] as [number,number],swing:3.8,xp:45,leash:20,respawn:40}),
  scrapling: Object.freeze({level:1,hp:42,speed:4,aggro:8.5,dmg:[4,6] as [number,number],swing:2,xp:20,leash:30,respawn:30}),
  scavenger: Object.freeze({level:2,hp:105,speed:4.3,aggro:11,dmg:[7,10] as [number,number],swing:2.2,xp:50,leash:32,respawn:45}),
});
export const RESPAWN_CLEAR = 22;
export function enemyStats(kind:EnemyKind, level:number, chapter:number, role:'ordinary'|'add'|'echo'):EnemyStats {
  const base=ENEMY_STATS[kind], scale=1+.12*(level-base.level), inWorld2=chapter>=2&&role!=='add';
  if(role==='echo')return {level,hp:Math.round(500*scale),xp:350+level*10,respawn:120,speed:2.8,aggro:10,leash:24,dmg:[14+level,18+level],swing:base.swing};
  return {...base,level,hp:Math.round(base.hp*scale),xp:base.xp+12*(level-base.level)+(inWorld2?90:0),respawn:inWorld2?12:base.respawn,dmg:[base.dmg[0]*scale,base.dmg[1]*scale]};
}
