import type { ActionData, ActionRequest, CoreEvent, HitPlan, SimUnit, WorldQuery } from '../../src/sim/types.ts';
import { createUnit } from '../../src/sim/unit.ts';
import { Actions } from '../../src/sim/actions.ts';
import { Events } from '../../src/sim/events.ts';
/** Analytic fixture for primitive algorithms only, never a production motion/parity provider. */
export const analyticData: ActionData = {
  version:'analytic-test-v1',sourceHashes:{fixture:'analytic'},
  clip(id){return {id,length:2,hold:id==='death',holdAt:id==='death'?1:null,events:{}};},
  root(_curve,t){return {x:t,z:t*2,yaw:t*.25};},
  archetype(){return {radius:.5,height:1,metersToUnits:2};},
  launchAnchor(unit){return {x:unit.x,y:unit.y+.5,z:unit.z};}
};
export const flat:WorldQuery={heightAt(){return 0;},resolveCollision(x,z,_radius,out){return out.set(x,z);},raycastSolid(){return null;}};
export function unit(id=1):SimUnit{return createUnit({area:'test',id,life:1},'analytic','player','player',analyticData);}
export function request(overrides:Partial<ActionRequest>={}):ActionRequest{return {id:'attack_swipe',part:'move',upper:false,from:0,to:null,loopFrom:null,loop:false,speed:1,fade:.1,carryRoot:false,...overrides};}
export function harness(){const events=new Events(10000),hits:HitPlan[]=[];const emit=(e:CoreEvent)=>events.emit(0,e);return {events,hits,emit,actions:new Actions(analyticData,emit,p=>hits.push(p))};}
