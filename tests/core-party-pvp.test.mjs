import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea,addActor,tick} from './core/worldHarness.mjs';
function setup(mode='party-encounter',pvp='party-only'){const base=worldArea('pvp-base'),a=worldArea('pvp','w1',{definition:{...base.services.definition,enemies:[],bosses:[]},context:{mode,pvp,members:[]}}),one=addActor(a,'one','warrior'),two=addActor(a,'two','warrior'),other=addActor(a,'other','warrior');Object.assign(one.u,{x:0,z:0});Object.assign(two.u,{x:2,z:0});Object.assign(other.u,{x:-2,z:0});one.p.state.resource=100;one.p.state.nextSwing=1e9;a.applyContext({...a.services.context,members:a.services.context.members.map(m=>({...m,party:m.character==='other'?'other':'party'}))});return {a,one,two,other};}

test('private same-party PvP executes paid targeted ability and auto attacks while other parties and NPCs stay protected',()=>{
 const {a,one,two,other}=setup();one.p.setTarget(two.u);const hp=two.u.hp;one.p.useAbility(1);assert.ok(one.u.pendingHit);tick(a,18);assert.ok(two.u.hp<hp);assert.equal(a.services.combat.damage(one.u.ref,other.u.ref,30),0);
 const npc=[...a.units.values()].find(u=>u.kind==='npc');one.p.state.gcdEnd=0;one.p.setTarget(npc);one.p.useAbility(2);assert.equal(one.p.state.cooldowns['shell-bash'],undefined);
 one.p.setTarget(two.u);one.p.state.nextSwing=0;const next=two.u.hp;tick(a,40);assert.ok(two.u.hp<next);
});

test('AoE PvP affects eligible party opponents only and never self or another party',()=>{
 const {a,one,two,other}=setup();const own=one.u.hp,otherHp=other.u.hp,hp=two.u.hp;one.p.useAbility(5);assert.ok(two.u.hp<hp);assert.equal(one.u.hp,own);assert.equal(other.u.hp,otherHp);assert.ok(one.p.state.cooldowns['crown-burst']);
});

test('public/cooperative modes and a toggle before impact reject player damage and pending control effects',()=>{
 for(const [mode,pvp]of [['public','party-only'],['party-encounter','disabled']]){const {a,one,two}=setup(mode,pvp);one.p.setTarget(two.u);one.p.useAbility(1);assert.equal(one.p.state.cooldowns['pincer-strike'],undefined);assert.equal(a.services.combat.damage(one.u.ref,two.u.ref,30),0);}
 const {a,one,two}=setup();one.p.setTarget(two.u);one.p.useAbility(2);const hp=two.u.hp;a.applyContext({...a.services.context,pvp:'disabled'});tick(a,20);assert.equal(two.u.hp,hp);assert.equal(two.u.stunUntil,0);
});
