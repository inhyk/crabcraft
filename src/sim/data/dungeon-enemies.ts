import {ENEMY_STATS,type EnemyStats} from './enemies.ts';
import {dungeonFor,type DungeonTier} from './dungeons.ts';
/** The one dungeon enemy balance formula; the browser Enemy (src/game/enemies.ts) reads it too. */
export function dungeonEnemyStatsAtLevel(level:number,captain:boolean):EnemyStats {
 return {level,hp:Math.round((180+level*8)*(captain?4:1)),xp:0,speed:captain?3.4:4.1,aggro:40,leash:45,swing:captain?2.8:2.4,dmg:[(8+level*.18)*1.25,(12+level*.23)*(captain?1.5:1)*1.25],respawn:ENEMY_STATS.scavenger.respawn};
}
/** Dedicated expedition stats. Captain mesh scale does not change cached gameplay colliders. */
export function dungeonEnemyStats(tier:DungeonTier,captain:boolean):EnemyStats {
 if(!dungeonFor(tier))throw new Error('Unknown dungeon tier');
 return dungeonEnemyStatsAtLevel(tier,captain);
}
