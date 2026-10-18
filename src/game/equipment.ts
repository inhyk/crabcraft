/** Keep legacy weapon ranks, bound save data, and never turn armor into invulnerability. */
export const MAX_EQUIPMENT_RANK = 100;
export type EquipmentSlot = 'weapon' | 'armor';
export function equipmentRank(value: unknown): number {
 return typeof value==='number'&&Number.isSafeInteger(value)?Math.max(0,Math.min(MAX_EQUIPMENT_RANK,value)):0;
}
export function upgradeCost(rank:number):number { return 100*(equipmentRank(rank)+1); }
export function weaponMultiplier(rank:number):number { return 1+equipmentRank(rank)*.08; }
export function armorMultiplier(rank:number):number { return 1/(1+equipmentRank(rank)*.04); }
