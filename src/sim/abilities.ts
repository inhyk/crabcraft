import {LANTERN_HEALS,type LanternHeal} from './data/healing.ts';
import { weaponMultiplier } from './data/equipment.ts';
/** Already-paid releases and per-attack impact rules, extracted from S1 28816e2. */
import type { AbilityDef } from './data/classes.ts';
import type { ActionId, ActionRequest, AreaServices, HitPlan, PlayerSim, School, SimUnit } from './types.ts';
import { CRIT_MULT, rollCrit } from './combat.ts';
import { angleDiff, yawTo } from './math.ts';
import { distTo, gapTo, lineOfSight, teleport } from './unit.ts';
import type { PlayerController } from './player.ts';
import { actionRequest, actionHitDelay } from './data/actions.ts';

const TARGETED = new Set(['pincer-strike','shell-bash','sideways-charge','bubble-bolt','smite']);
export const abilityNeedsTarget = (a: AbilityDef): boolean => TARGETED.has(a.id);
export const isMeleeAbility = (a: AbilityDef): boolean => a.id === 'pincer-strike' || a.id === 'shell-bash';

/** Timing comes from the shipped numerical catalog, including skill windows. */
export function playAction(g: AreaServices,u:SimUnit,id:ActionId,o:Partial<ActionRequest> = {},hit?:HitPlan):void {
  const request=actionRequest(g.actionData,id,o);
  const delay=o.from===undefined?actionHitDelay(g.actionData,request):null;
  g.startAction(u.ref,request,hit?{left:delay??.3,plan:hit}:undefined);
}
export function enemiesNear(g:AreaServices,x:number,z:number,radius:number):readonly SimUnit[] { return g.hostilesNear(x,z,radius).filter(t=>t.reaction==='hostile' && t.alive && !t.hidden && Math.hypot(t.x-x,t.z-z)-t.radius<=radius); }
export function damageMultiplier(p:PlayerSim,u:SimUnit):number { return (1+.12*(u.level-1))*weaponMultiplier(p.state.attackRank); }
function hit(g:AreaServices,p:PlayerSim,u:SimUnit,t:SimUnit,min:number,max:number,school:School,bonus=0):number {
  const crit=rollCrit(g.random,.12+bonus);
  return g.combat.damage(u.ref,t.ref,(min+g.random.next()*(max-min))*damageMultiplier(p,u)*(crit?CRIT_MULT:1),{crit,school});
}
function knockback(t:SimUnit,u:SimUnit,distance:number,seconds=.35):void {
  if(t.kind==='boss')return;
  const dx=t.x-u.x,dz=t.z-u.z,len=Math.hypot(dx,dz)||1;
  t.pushX=dx/len*distance/seconds;t.pushZ=dz/len*distance/seconds;t.pushTime=seconds;
}
export function launchAt(g:AreaServices,u:SimUnit,t:SimUnit,style:'bubble'|'spark'|'holy',speed:number,plan:HitPlan):void {
  const from=g.actionData.launchAnchor(u,u.pose);
  g.launch({x:from.x,y:from.y,z:from.z,source:u.ref,target:t.ref,style,speed,hit:plan,anchorVersion:g.actionData.version});
}
/** Same-area living allies only. PvP opponents and village-game participants cannot receive support. */
function healAllies(g:AreaServices,u:SimUnit,ability:LanternHeal):void {
  const rule=LANTERN_HEALS[ability],source=g.context.members.find(m=>m.unit.id===u.ref.id);
  if(source?.villagePlaying)return;
  for(const dst of g.players()){
    if(dst.ref.id===u.ref.id||!dst.alive||dst.hidden||Math.hypot(dst.x-u.x,dst.z-u.z)>rule.range||!lineOfSight(g.query,u,dst))continue;
    const member=g.context.members.find(m=>m.unit.id===dst.ref.id);
    if(member?.villagePlaying||g.context.pvp!=='disabled'&&(!source?.party||source.party!==member?.party))continue;
    g.combat.heal(u.ref,dst.ref,dst.maxHp*rule.fraction);
  }
}
export function executeAbility(g:AreaServices,p:PlayerController,ab:AbilityDef,target:SimUnit|null):void {
  const u=p.unit,now=g.time;
  const fx=(stage:'start'|'hit',more:Partial<{target:SimUnit['ref']|null;from:{x:number;y:number;z:number};amount:number;stun:number;half:number}>={})=>g.emit({type:'ability',caster:u.ref,ability:ab.id,stage,range:ab.range,...more});
  switch(ab.id) {
    case 'crown-burst':playAction(g,u,'attack_slam',{upper:true});fx('start');for(const t of enemiesNear(g,u.x,u.z,ab.range))if(lineOfSight(g.query,u,t))hit(g,p,u,t,95,115,'water');break;
    case 'pincer-strike':if(target)playAction(g,u,'attack_swipe',{upper:true,speed:1.3},{attack:ab.id,source:u.ref,target:target.ref});break;
    case 'shell-bash':if(target)playAction(g,u,'attack_slam',{upper:true},{attack:ab.id,source:u.ref,target:target.ref});break;
    case 'sideways-charge':if(target){p.startDash(target);fx('start',{target:target.ref});}break;
    case 'whirlpool':p.state.spinT=.6;playAction(g,u,'attack_swipe',{upper:true,speed:1.4});fx('start');for(const t of enemiesNear(g,u.x,u.z,ab.range)){hit(g,p,u,t,15,20,'water');knockback(t,u,1.6);}break;
    case 'bubble-bolt':if(target){const from=g.actionData.launchAnchor(u,u.pose);playAction(g,u,'attack_swipe',{upper:true,speed:1.5});g.launch({x:from.x,y:from.y,z:from.z,source:u.ref,target:target.ref,style:'bubble',speed:17,hit:{attack:'bubble-bolt',source:u.ref,target:target.ref},anchorVersion:g.actionData.version});}break;
    case 'frost-spray': {const half=.55;playAction(g,u,'attack_swipe',{upper:true,speed:1.3});fx('start',{half});for(const t of enemiesNear(g,u.x,u.z,ab.range)){if(Math.abs(angleDiff(yawTo(u.x,u.z,t.x,t.z),u.yaw))>half+Math.atan2(t.radius,Math.max(.5,distTo(u,t))))continue;hit(g,p,u,t,15,19,'frost');t.slowUntil=now+4;t.slowPct=.5;}break;}
    case 'steam-blink': {const from={x:u.x,y:u.y,z:u.z};let x=u.x,z=u.z;const out={x:0,y:0,set(a:number,b:number){this.x=a;this.y=b;return this;}};for(let d=.5;d<=ab.range+1e-6;d+=.5){const tx=from.x+Math.sin(u.yaw)*d,tz=from.z+Math.cos(u.yaw)*d,r=g.query.resolveCollision(tx,tz,u.radius,out);if(Math.hypot(r.x-tx,r.y-tz)>.25||Math.abs(g.query.heightAt(tx,tz)-g.query.heightAt(x,z))>2.5)break;x=r.x;z=r.y;}teleport(u,g.query,x,z);g.combat.heal(u.ref,u.ref,10);fx('start',{from});break;}
    case 'tidal-nova':playAction(g,u,'attack_slam',{upper:true});fx('start');for(const t of enemiesNear(g,u.x,u.z,ab.range)){hit(g,p,u,t,20,26,'water');knockback(t,u,5);t.stunUntil=Math.max(t.stunUntil,now+.6);}break;
    case 'smite':if(target){fx('start',{target:target.ref});const amount=hit(g,p,u,target,27,33,'holy');fx('hit',{target:target.ref,amount});}break;
    case 'mend-shell':{const crit=rollCrit(g.random);g.combat.heal(u.ref,u.ref,u.maxHp*.35*(crit?1.5:1),crit);healAllies(g,u,'mend-shell');fx('start');break;}
    case 'barnacle-ward':u.absorbMax=u.absorb=Math.round(u.maxHp*.3);u.absorbUntil=now+10;p.state.warded=true;g.emit({type:'ward',unit:u.ref,stage:'up',seconds:10});fx('start');break;
    case 'holy-tide':playAction(g,u,'cast',{upper:true,part:'release',speed:1.5},{attack:'holy-tide',source:u.ref});break;
  }
}
/** true means this plan belongs to the player resolver, including stale/rejected impacts. */
export function resolvePlayerHit(g:AreaServices,plan:HitPlan):boolean {
  if(!['warrior-auto','ranged-auto','pincer-strike','shell-bash','bubble-bolt','holy-tide'].includes(plan.attack))return false;
  const u=g.getUnit(plan.source),p=g.player(plan.source);
  if(!u||!p)return true;
  if(plan.attack==='holy-tide') {if(!u.alive)return true;g.emit({type:'ability',caster:u.ref,ability:plan.attack,stage:'hit',range:6});for(const t of enemiesNear(g,u.x,u.z,6))hit(g,p,u,t,15,19,'holy');g.combat.heal(u.ref,u.ref,u.maxHp*.15);healAllies(g,u,'holy-tide');return true;}
  if(!('target'in plan))return true;
  const t=g.getUnit(plan.target);if(!t?.alive)return true;
  switch(plan.attack){
    case 'warrior-auto':{if(gapTo(u,t)>2.3)return true;const crit=rollCrit(g.random);g.combat.damage(u.ref,t.ref,(8+g.random.next()*3)*damageMultiplier(p,u)*(crit?CRIT_MULT:1),{crit,rage:crit?15:9});g.emit({type:'attack',src:u.ref,attack:plan.attack,stage:'hit',target:t.ref});break;}
    case 'ranged-auto':{const crit=rollCrit(g.random);g.combat.damage(u.ref,t.ref,(5+g.random.next()*2)*damageMultiplier(p,u)*(crit?CRIT_MULT:1),{crit,school:plan.school,noReact:true});break;}
    case 'bubble-bolt':hit(g,p,u,t,33,39,'water');break;
    case 'pincer-strike':hit(g,p,u,t,16,21,'physical',.05);g.emit({type:'ability',caster:u.ref,ability:plan.attack,stage:'hit',target:t.ref,range:2.2});break;
    case 'shell-bash':{hit(g,p,u,t,10,13,'physical');const stun=t.kind==='boss'?1:2;t.stunUntil=Math.max(t.stunUntil,g.time+stun);g.cancelPendingHit(t.ref);g.emit({type:'ability',caster:u.ref,ability:plan.attack,stage:'hit',target:t.ref,stun,range:2.2});break;}
  }
  return true;
}
