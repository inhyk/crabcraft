import {SimulationArea} from '../../src/sim/area.ts';
import {realActionData} from '../../src/sim/data/actions.ts';
import {createWorld1Definition} from '../../src/sim/areas/world1.ts';
import {createWorld2Definition} from '../../src/sim/areas/world2.ts';
import {createWorld4Definition} from '../../src/sim/areas/world4.ts';
import {createWorld3Definition} from '../../src/sim/areas/world3.ts';
export const flatWorld={heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
export function worldArea(id,world='w1',overrides={}){const config={query:flatWorld,personalProps:flatWorld,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0}};return new SimulationArea({id,definition:({w1:createWorld1Definition,w2:createWorld2Definition,w3:createWorld3Definition,w4:createWorld4Definition}[world])(config),query:flatWorld,seed:15,policy:{enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:()=>true,canInteract:()=>true},actionData:realActionData,context:{mode:'public',members:[],pvp:'disabled'},limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000},...overrides});}
export function addActor(area,character='hero',classId='mage'){const ref=area.attachFresh(character,classId,'human','spawn');return {ref,p:area.services.player(ref),u:area.services.getUnit(ref)};}
export function atGate(area,actor,id='gate:w2'){Object.assign(actor.u,area.services.definition.interactions.find(i=>i.id===id).position);actor.u.lastCombat=area.services.time-10;actor.p.state.flags.abyssCleared=true;actor.p.state.flags.trueCleared=true;}
export function intent(seq,commands=[],extra={}){return {seq,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands,...extra};}
export function tick(area,n=1){for(let i=0;i<n;i++)area.step(new Map());}
