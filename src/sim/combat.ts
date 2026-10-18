/** Numeric damage authority. Events are copied observations, never effect callbacks. */
import type { AreaServices, CombatRules, EntityRef, HitOptions, RandomSource } from './types.ts';
import { playAction } from './abilities.ts';
import { BOSS_PROFILES } from './data/bosses.ts';
export const CRIT_CHANCE = 0.12;
export const CRIT_MULT = 1.75;
export function rollCrit(random: RandomSource, chance = CRIT_CHANCE): boolean { return random.next() < chance; }

export class Combat implements CombatRules {
  readonly services: AreaServices;
  constructor(services: AreaServices) { this.services = services; }
  damage(source: EntityRef | null, target: EntityRef, amount: number, options: HitOptions = {}): number {
    const g = this.services, dst = g.getUnit(target), src = source ? g.getUnit(source) : null;
    if (!dst || (source && !src) || !Number.isFinite(amount) || !dst.alive || dst.hidden) return 0;
    if (!g.policy.damageAllowed(g.context, src, dst)) return 0;
    const targetProfile=g.controller(dst.ref)?.profile,sourceProfile=src?g.controller(src.ref)?.profile:undefined;
    const targetGate=targetProfile?BOSS_PROFILES[targetProfile].level:0,sourceGate=sourceProfile?BOSS_PROFILES[sourceProfile].level:0;
    if ((targetGate>=100&&src?.kind==='player'&&src.level<targetGate)||(sourceGate>=100&&dst.kind==='player'&&dst.level<sourceGate))return 0;
    const involved = g.context.members.filter(m => m.villagePlaying && (m.unit.id === dst.ref.id || m.unit.id === src?.ref.id));
    if (involved.length) return 0;
    if (src) src.lastCombat = g.time;
    dst.lastCombat = g.time;
    if (dst.invulnerable) { g.emit({ type:'blocked', unit:dst.ref, reason:'evade' }); return 0; }
    let damage = Math.max(1, Math.round(amount));
    const controller = g.controller(dst.ref);
    if (dst.absorb > 0 && g.time < dst.absorbUntil) {
      const soaked = Math.min(dst.absorb, damage); dst.absorb -= soaked; damage -= soaked;
      controller?.onWardHit?.(dst.absorb <= 0);
      if (damage <= 0) { g.emit({type:'blocked',unit:dst.ref,reason:'absorbed'}); return 0; }
    }
    dst.hp = Math.max(0, dst.hp - damage);
    g.emit({type:'damage',src:src?.ref ?? null,dst:dst.ref,amount:damage,crit:!!options.crit,school:options.school});
    if (src) g.recordContribution(dst.ref, src.ref, damage);
    if (dst.kind === 'player') controller?.onHurt?.(damage);
    if (src?.kind === 'player' && options.rage) g.controller(src.ref)?.gainRage?.(options.rage);
    if (dst.hp <= 0) { this.kill(dst.ref, src?.ref ?? null); return damage; }
    if (!options.noReact && dst.kind !== 'boss') {
      const action = [...dst.actions].reverse().find(a => a.targetWeight > 0 && (!a.ended || g.actionData.clip(a.id).hold));
      if (!action || action.id === 'hit_react' || action.id.startsWith('walk')) playAction(g,dst,'hit_react',{upper:dst.kind === 'player'});
    }
    controller?.onDamaged?.(src?.ref ?? null,damage);
    return damage;
  }
  heal(source: EntityRef | null, target: EntityRef, amount: number, crit = false): number {
    const g = this.services, dst = g.getUnit(target), src = source ? g.getUnit(source) : null;
    if (!dst?.alive || (source && !src) || !Number.isFinite(amount)) return 0;
    const before = dst.hp; dst.hp = Math.min(dst.maxHp, dst.hp + Math.round(amount));
    g.emit({type:'heal',src:src?.ref ?? null,dst:dst.ref,amount,crit});
    if (src) src.lastCombat = Math.max(src.lastCombat,g.time - 4);
    return dst.hp - before;
  }
  kill(target: EntityRef, source: EntityRef | null): void {
    const g=this.services, dst=g.getUnit(target);
    if (!dst?.alive) return;
    dst.alive=false; dst.hp=0; g.cancelPendingHit(dst.ref);
    playAction(g,dst,'death');
    g.emit({type:'death',unit:dst.ref,killer:source});
    g.controller(dst.ref)?.onDeath?.(source);
    g.onUnitDied(dst.ref,source);
  }
}
