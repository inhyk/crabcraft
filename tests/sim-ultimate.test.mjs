// PR28's real fifth-slot ultimate through the S1 headless simulation and event boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../tmp/test-modules/sim-harness.js';
const of = (events, type) => events.filter(e => e.type === type);
function setup(classId, world = H.flatWorld()) {
  const { game, events } = H.recordingGame(world); const c = game.addPlayer(classId, 1);
  H.place(c.unit, world, 0, 0); c.player.nextSwing = Infinity; c.player.resource = 0;
  const enemy = (x, z) => { const e = game.addEnemy('scrapling', x, z); e.unit.hp = e.unit.maxHp = 100000; return e.unit; };
  return { game, events, c, enemy, ultimate: H.CLASSES[classId].abilities[4] };
}
for (const classId of ['warrior', 'mage', 'priest']) {
  test(`${classId}: slot5 emits the ultimate event, applies95..115 water damage at10m visible edges, and touches no browser services`, () => {
    const world = H.flatWorld(); world.raycastSolid = (_from, to) => to.x < 0 ? 0 : null;
    const { game, events, c, enemy, ultimate } = setup(classId, world);
    const near = enemy(0, 3); const boundary = enemy(0, 10.55); const outside = enemy(0, 10.551);
    const hidden = enemy(0, 2); hidden.hidden = true; const blocked = enemy(-3, 0); const dead = enemy(1, 1); dead.alive = false;
    assert.equal(ultimate.slot, 5); assert.equal(ultimate.cooldown, 60); assert.equal(ultimate.range, 10); assert.equal(ultimate.cost, 0);
    assert.equal(H.CLASSES[classId].abilities.length, 5);
    c.player.useAbility(5);
    assert.deepEqual(of(events, 'ability').map(e => [e.caster, e.ability, e.stage, e.range]), [[c.unit, 'crown-burst', 'start', 10]]);
    const damage = of(events, 'damage'); assert.deepEqual(damage.map(e => e.dst), [near, boundary]);
    for (const hit of damage) {
      assert.equal(hit.src, c.unit); assert.equal(hit.school, 'water');
      const min = Math.round(95 * (hit.crit ? 1.75 : 1)); const max = Math.round(115 * (hit.crit ? 1.75 : 1));
      assert(hit.amount >= min && hit.amount <= max, `damage${hit.amount} in${min}..${max}`);
      assert.equal(hit.dst.hp, 100000 - hit.amount);
    }
    for (const unit of [outside, hidden, blocked, dead]) assert.equal(unit.hp, 100000);
    assert.deepEqual(game.touched, []);
  });
  test(`${classId}: ultimate rejection and60s game-clock recovery preserve events and personal cooldown`, () => {
    const { game, events, c, enemy, ultimate } = setup(classId); enemy(0, 3);
    const view = c.player.game;
    view.controlsLocked = true; c.player.useAbility(5); view.controlsLocked = false;
    view.villageGames = { playing: true }; c.player.useAbility(5); view.villageGames = null;
    c.unit.alive = false; c.player.useAbility(5); c.unit.alive = true;
    c.unit.stunUntil = 2; c.player.useAbility(5); c.unit.stunUntil = 0;
    c.player.startChannel('fixture', 2, 'KeyF', c.unit.pos.clone(), () => {}); c.player.useAbility(5); c.player.cancelChannel();
    assert.equal(of(events, 'damage').length, 0); assert.equal(of(events, 'ability').length, 0); assert.equal(c.player.cooldownLeft(ultimate), 0);
    c.player.useAbility(5); const cd = { ...c.player.cooldowns.get(ultimate.id) };
    assert.deepEqual(cd, { start: 0, end: 60 }); assert.equal(of(events, 'damage').length, 1);
    game.time = 30; c.player.useAbility(5); assert.equal(of(events, 'damage').length, 1); assert.equal(of(events, 'ability').length, 1);
    assert.equal(of(events, 'error').at(-1).reason, 'Ability is not ready yet.');
    game.time = 59.99; c.player.useAbility(5); assert.equal(of(events, 'damage').length, 1);
    game.time = 60; c.player.useAbility(5); assert.equal(of(events, 'damage').length, 2); assert.equal(of(events, 'ability').length, 2);
    assert.deepEqual(c.player.cooldowns.get(ultimate.id), { start: 60, end: 120 }); assert.deepEqual(game.touched, []);
  });
}
