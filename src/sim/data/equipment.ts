/** Canonical PR47 equipment math and transactions; no UI, I/O or borrowed player state. */
export const MAX_EQUIPMENT_RANK=100;
export const EQUIPMENT_PRICE=100;
export type EquipmentSlot='weapon'|'armor';
export type EquipmentOperation='buy'|'upgrade';
export type EquipmentResult='bought'|'owned'|'busy'|'coins'|'upgraded'|'unowned'|'max';
export interface EquipmentState {attackRank:number;armorRank:number;weaponOwned:boolean;armorOwned:boolean;coins:number}
export function equipmentRank(value:unknown):number {return typeof value==='number'&&Number.isSafeInteger(value)?Math.max(0,Math.min(MAX_EQUIPMENT_RANK,value)):0;}
export function upgradeCost(rank:number):number {return 100*(equipmentRank(rank)+1);}
export function weaponMultiplier(rank:number):number {return 1+equipmentRank(rank)*.08;}
export function armorMultiplier(rank:number):number {return 1/(1+equipmentRank(rank)*.04);}
export function ownsEquipment(state:Pick<EquipmentState,'attackRank'|'armorRank'|'weaponOwned'|'armorOwned'>,slot:EquipmentSlot):boolean {return slot==='weapon'?state.weaponOwned||state.attackRank>0:state.armorOwned||state.armorRank>0;}
/** Own load/transfer boundary accepts optional pre-equipment v1 fields and strict boolean flags. */
export function restoreEquipment(value:{attackRank?:unknown;armorRank?:unknown;weaponOwned?:unknown;armorOwned?:unknown}):Omit<EquipmentState,'coins'> {const attackRank=equipmentRank(value.attackRank),armorRank=equipmentRank(value.armorRank);return {attackRank,armorRank,weaponOwned:value.weaponOwned===true||attackRank>0,armorOwned:value.armorOwned===true||armorRank>0};}
/** Busy eligibility is supplied by authoritative rules before any inventory or coin check. */
export function transactEquipment(state:EquipmentState,slot:EquipmentSlot,operation:EquipmentOperation,busy=false):EquipmentResult {
 if(busy||!['weapon','armor'].includes(slot)||!['buy','upgrade'].includes(operation))return 'busy';
 if(operation==='buy'){
  if(ownsEquipment(state,slot))return 'owned';
  if(!Number.isSafeInteger(state.coins)||state.coins<EQUIPMENT_PRICE)return 'coins';
  state.coins-=EQUIPMENT_PRICE;if(slot==='weapon'){state.weaponOwned=true;state.attackRank=1;}else{state.armorOwned=true;state.armorRank=1;}return 'bought';
 }
 if(!ownsEquipment(state,slot))return 'unowned';
 const rank=equipmentRank(slot==='weapon'?state.attackRank:state.armorRank);if(rank>=MAX_EQUIPMENT_RANK)return 'max';const cost=upgradeCost(rank);if(!Number.isSafeInteger(state.coins)||state.coins<cost)return 'coins';state.coins-=cost;if(slot==='weapon')state.attackRank=rank+1;else state.armorRank=rank+1;return 'upgraded';
}
