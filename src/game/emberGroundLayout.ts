import type {Collision} from '../sim/world/collision';

/*
 * Emberreach's wilds, placed by hand (no three.js here: the collision bake and the server read it too). Each field
 * gets one focal group with open ground round it instead of an even sprinkle:
 * - east: a crystal grotto split out of a columnar basalt mound, fed by a glowing fissure from the shore;
 * - west: a drained lava-tube arch with ember crystals in its throat and a fissure leading the eye to it;
 * - north: basalt organ-pipes and spatter cones flanking the forge court, cracks running down from the lava toes;
 * - the town corners: an obsidian field and a column stack each, charred trees between.
 * Everything keeps 4 m from quest props, 6 m from enemy homes, off the roads, out of the town and the court, and far
 * from the lava zones (frontierIsland checks them again at runtime: the toe zones may grow).
 */
export type EmberKind='columns'|'cone'|'obsidian'|'arch'|'crystal'|'charred';
/** r: footprint radius (arch: half span), h: height, yaw: facing (arch: the span runs along yaw). */
export interface EmberFeature {kind:EmberKind;x:number;z:number;r:number;h:number;yaw:number;seed:number}

const f=(kind:EmberKind,x:number,z:number,r:number,h:number,yaw=0):EmberFeature=>({kind,x,z,r,h,yaw,seed:Math.abs(Math.round(x*7.3+z*13.1))+1});
export const EMBER_FEATURES:readonly EmberFeature[]=[
 // East: the crystal grotto.
 f('columns',93,-5,5.2,7.5,.3),f('crystal',85.5,-5.5,3,4.2,.2),f('crystal',80,-1,1.3,1.6,1.1),f('crystal',89.5,3,1.4,1.9,2.2),
 f('crystal',82.5,-13,1.1,1.4,.6),f('crystal',92,-13,1.2,1.7,2.9),f('columns',85,-26,3.8,5.5,1.2),
 f('obsidian',97,10,2.4,2.2,.8),f('charred',75,-17,1,6.5,.4),
 // West: the lava-tube arch, spanning north-south so it faces the field.
 f('arch',-87,-4,6.5,7,0),f('crystal',-88.5,-3.5,1.5,2,1.4),f('crystal',-84,-12.5,1,1.3,.3),f('columns',-82,-25,4.4,6.5,.7),
 f('columns',-95,11,3.4,5,2.2),f('obsidian',-77,9,2.2,2,1.9),f('cone',-73,-36,3,3.2),f('charred',-75,-15,1,6.2,2.6),
 // North flanks of the forge court.
 f('columns',35,-93,5,8.5,.9),f('columns',-37,-90,5,7.5,2.4),f('cone',40,-78,3.6,3.8),f('cone',-47,-66,3.1,3.3),
 f('obsidian',37,-110,2.4,2.3,.3),f('crystal',-31,-101,1.4,1.9,.8),f('crystal',56,-90,1.3,1.6,2.3),
 f('columns',38,-57,2.6,4.2,.4),f('charred',33,-51,1,5.5,.9),f('charred',-34,-47,1,6,1.7),f('charred',-56,-80,1,5,2.8),
 // Shoreline stacks where the east and west edges fall to the sea.
 f('columns',92,-41,4,5.5,1.6),f('columns',-92,-43,3.8,5,.2),f('columns',79,-71,4,6,2.5),f('columns',-78,-72,4.2,6.2,1.1),
 f('columns',95,31,3.4,4.6,.9),f('columns',-96,34,3.2,4.4,2.7),
 // Town corners.
 f('obsidian',71,60,3,2.6,1.4),f('columns',83,47,4,5,.5),f('crystal',75,72,1.2,1.5,.9),f('charred',60,79,1,6,0),f('charred',67,92,1,5,1.1),f('charred',57,47,1,5.4,2.3),
 f('columns',-75,62,4.4,6,2.1),f('cone',-64,82,3,3.1),f('crystal',-81,45,1.3,1.6,1.9),f('charred',-58,47,1,5.6,.6),f('charred',-55,93,1,5,1.8),
 // Mid fields: something to steer by, nothing in the enemies' way.
 f('obsidian',-30,-12,1.8,1.6,.7),f('charred',78,25,1,5.5,2.4),
];

/** World V's roads (the shared islandPaths footprint): the avenue from the quay into the furnace yard and on to the court, two lanes out of the yard, the spawn and portal spurs. */
export const EMBER_PATHS:{points:[number,number][];width:number;trim:boolean}[]=[
 // The harbour avenue and the way north to the sanctuary end at the furnace yard's rim (emberTown.ts paves the yard,
 // FORGE_C r 27); a west and an east lane leave it between the houses for the herb and ore fields.
 {points:[[0,97],[0,86]],width:8,trim:true},{points:[[0,34],[0,-72]],width:8,trim:true},
 {points:[[-24.9,51.7],[-47,43]],width:4,trim:true},{points:[[26.6,54.6],[49,50.5]],width:4,trim:true},
 {points:[[-12,84],[-1,84]],width:4,trim:true},{points:[[0,-44],[26,-44]],width:4,trim:true},
];

/** Glowing fissures, few and with a reason: each feeds a crystal grotto, leaves a lava toe or splits from a cone. */
export const EMBER_FISSURES:readonly (readonly [number,number])[][]=[
 [[104,-2],[99,-3.5],[94,-2.5],[89.5,-5]],
 [[-63,-9],[-68,-6],[-73,-7.5],[-78,-4],[-83,-4.5]],
 [[-16,-96],[-19.5,-92],[-25,-89.5],[-30,-84]],
 [[16,-98],[21,-94.5],[27,-92.5]],
 [[-5,-97],[-6.5,-95]],
 [[40,-74.5],[37.5,-69],[40,-63.5]],
 [[43.5,-80],[48.5,-84],[54,-88.5]],
 [[-47,-63],[-51,-58],[-50,-52]],
 [[71,56.5],[66,52],[62.5,53.5]],
];

/** The crystal miners' camp in front of the east grotto (emberCamp.ts): kit pieces in camp-local metres (lx across, lz toward the grotto). */
export const EMBER_CAMP:{x:number;z:number;yaw:number;pieces:{piece:string;lx:number;lz:number;yaw:number;s:number;sink:number;pitch?:number;roll?:number;solid?:{r:number;h:number}}[]}={x:80.5,z:-10.5,yaw:1.35,pieces:[
 {piece:'Stall_Cart_Empty',lx:-3.2,lz:.4,yaw:.35,s:1,sink:.18,roll:.06,solid:{r:1.3,h:1.6}},
 {piece:'Crate_Metal',lx:1.6,lz:-.6,yaw:.4,s:1,sink:.05,solid:{r:.6,h:.9}},
 {piece:'Crate_Wooden',lx:2.5,lz:.5,yaw:-.3,s:.9,sink:.3,pitch:.5,solid:{r:.55,h:.7}},
 {piece:'Barrel',lx:.5,lz:-1.9,yaw:1.1,s:1,sink:.12,roll:Math.PI/2,solid:{r:.55,h:.7}},
 {piece:'Pickaxe_Bronze',lx:-.6,lz:1.6,yaw:.8,s:1,sink:.3,pitch:.35},
 {piece:'Chain_Coil',lx:1.2,lz:1.3,yaw:.7,s:1,sink:.02},
 {piece:'Bucket_Metal',lx:-1.5,lz:-1.3,yaw:.2,s:1,sink:.06,roll:1.3},
]};

/** Solid footprints (x, z, radius, height): the arch stands on its two legs and their column buttresses, a charred tree on its trunk. */
export function emberSolids(){
 const out:{x:number;z:number;r:number;h:number}[]=[];
 for(const e of EMBER_FEATURES){
  if(e.kind==='arch'){const s=Math.sin(e.yaw),c=Math.cos(e.yaw);for(const k of [-1,1]){const fx=e.x+s*e.r*k,fz=e.z+c*e.r*k;out.push({x:fx,z:fz,r:1.9,h:e.h},{x:fx+c*2.8*k,z:fz-s*2.8*k,r:2,h:e.h*.55});}}
  else if(e.kind==='charred')out.push({x:e.x,z:e.z,r:.45,h:e.h});
  else out.push({x:e.x,z:e.z,r:e.kind==='columns'?e.r*.85:e.kind==='cone'?e.r*.7:e.r*.8,h:e.h});
 }
 {const c=Math.cos(EMBER_CAMP.yaw),s=Math.sin(EMBER_CAMP.yaw);for(const p of EMBER_CAMP.pieces)if(p.solid)out.push({x:EMBER_CAMP.x+c*p.lx+s*p.lz,z:EMBER_CAMP.z-s*p.lx+c*p.lz,r:p.solid.r,h:p.solid.h});}
 return out;
}

/** World V only: the wilds' solids (layoutFrontier keeps World VI's trees). */
export function layoutEmberGround(col:Collision,heightAt:(x:number,z:number)=>number){
 for(const s of emberSolids()){const y=heightAt(s.x,s.z);col.addCircle(s.x,s.z,s.r,y-1,y+s.h);}
}
