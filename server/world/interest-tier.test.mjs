// Interest tiers ("가까운 40 m 안은 20번, 그 밖은 5번"): ObservationInput.heldIds keeps a visible actor at the value its
// recipient last received. These tests run the unchanged GameplayReceiver: a held actor is never removed, gets no update
// while held, catches up exactly when released, and a snapshot without held actors is byte-identical to before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameplayProtocol, GameplayReceiver, projectObservationExtras, prepareObservationSnapshot, releasePreparedObservation, projectActor } from './gameplay/protocol.ts';
import { worldArea, addActor, intent } from '../../tests/core/worldHarness.mjs';
import { catalog, appearance } from '../../tests/world-client-fixture.mjs';

const binding = { session: 'interest-session', area: 'interest-area', epoch: 1, catalog: catalog.version };
const FAR_PERIOD = 4;
const publicActor = (snapshot, id) => { const unit = snapshot.units.find(u => u.ref.id === id); return projectActor(unit, unit.kind === 'player' ? appearance : null); };
const fields = actor => { const { pose: _p, ...rest } = actor; return rest; };

function scene() {
  const area = worldArea(binding.area, 'w1');
  const viewer = addActor(area, 'viewer'), near = addActor(area, 'near', 'warrior'), far = addActor(area, 'far', 'warrior');
  Object.assign(near.u, { x: viewer.u.x + 20, z: viewer.u.z });
  Object.assign(far.u, { x: viewer.u.x + 60, z: viewer.u.z });
  const enemy = [...area.enemies.values()][0].unit;
  Object.assign(area.services.getUnit(enemy), { x: viewer.u.x, z: viewer.u.z + 55 });
  return { area, viewer, near, far, enemyId: enemy.id };
}
function observation(area, viewer, sequence, snapshot, events, watermark, extra) {
  const visibleIds = new Set(snapshot.units.map(u => u.ref.id));
  return { binding, sequence, tick: snapshot.tick, acceptedInput: 0, consumedInput: 0, selfRef: viewer.p.state.unit, snapshot, events, visibleIds,
    full: sequence === 1, eventWatermark: watermark, appearances: Object.fromEntries(snapshot.units.filter(u => u.kind === 'player').map(u => [`${u.ref.id}:${u.ref.life}`, appearance])),
    ...projectObservationExtras(snapshot, viewer.p.state.character, visibleIds), ...extra };
}

test('a held far actor stays on the client with its last sent value and catches up every 4th snapshot; prepared and reference bytes agree', () => {
  const { area, viewer, near, far, enemyId } = scene();
  const reference = createGameplayProtocol(catalog), checked = createGameplayProtocol(catalog), production = createGameplayProtocol(catalog, { verify: false });
  const receiver = new GameplayReceiver(binding, catalog);
  const farIds = [far.ref.id, enemyId];
  let watermark = -1, last = new Map(), refreshed = 0, held = 0, enemyDied = false, respawned = false;
  try {
    for (let sequence = 1; sequence <= 40; sequence++) {
      // Everyone turns every tick, so every actor's yaw (and pose) changes in every snapshot.
      area.step(new Map([viewer, near, far].map(a => [a.p.state.unit.id, intent(sequence, [], { turn: 1, forward: sequence % 2 })])));
      if (sequence === 9) { area.services.combat.damage(viewer.p.state.unit, [...area.enemies.values()][0].unit, 1e6); enemyDied = true; }
      const events = area.drainEvents(), snapshot = area.snapshot(); if (events.length) watermark = events.at(-1).order;
      const beat = sequence, heldIds = new Set(farIds.filter(id => (beat + id) % FAR_PERIOD));
      const input = observation(area, viewer, sequence, snapshot, events, watermark, { heldIds });
      const expected = reference.encodeObservation(input);
      const tokens = [prepareObservationSnapshot(snapshot, input.appearances, catalog), prepareObservationSnapshot(snapshot, input.appearances, catalog, { verify: false })];
      try {
        assert.deepEqual(checked.encodeObservation({ ...input, prepared: tokens[0] }), expected, `checked ${sequence}`);
        assert.deepEqual(production.encodeObservation({ ...input, prepared: tokens[1] }), expected, `production ${sequence}`);
      } finally { tokens.forEach(releasePreparedObservation); }
      let result; for (const packet of expected) result = receiver.accept(packet, 0);
      assert.equal(result.kind, 'snapshot');
      const state = new Map(result.state.actors.map(a => [a.ref.id, a]));
      for (const id of snapshot.units.map(u => u.ref.id)) assert.ok(state.has(id), `actor ${id} present in snapshot ${sequence}`);
      for (const unit of snapshot.units) {
        const actual = publicActor(snapshot, unit.ref.id), shown = state.get(unit.ref.id);
        const isHeld = sequence > 1 && heldIds.has(unit.ref.id) && last.get(unit.ref.id)?.ref.life === unit.ref.life;
        if (isHeld) { assert.deepEqual(shown, last.get(unit.ref.id), `held ${unit.ref.id} keeps its last value at ${sequence}`); held++; }
        else {
          assert.deepEqual(fields(shown), fields(actual), `actor ${unit.ref.id} current at ${sequence}`);
          if (farIds.includes(unit.ref.id) && sequence > 1) refreshed++;
        }
        if (unit.ref.id === enemyId && last.get(enemyId) && last.get(enemyId).ref.life !== unit.ref.life) {
          // A new life is sent at once, even on a held beat.
          assert.equal(shown.ref.life, unit.ref.life); respawned = true;
        }
      }
      for (const id of [viewer.ref.id, near.ref.id]) assert.notDeepEqual(state.get(id).yaw, last.get(id)?.yaw, `near ${id} updated at ${sequence}`);
      last = state;
      // Respawn the dead far enemy just before a beat that holds it.
      if (enemyDied && !respawned && sequence >= 20 && (sequence + 1 + enemyId) % FAR_PERIOD) {
        const life = state.get(enemyId).ref.life;
        for (let i = 0; i < 2000 && [...area.enemies.values()][0].unit.life === life; i++) area.step(new Map());
        assert.notEqual([...area.enemies.values()][0].unit.life, life, 'enemy respawned');
      }
    }
  } finally { for (const g of area.pendingGrants()) area.acknowledgeGrant(g.grant.id); area.dispose(); }
  assert.ok(held >= 40, `held ${held}`); assert.ok(refreshed >= 15, `refreshed ${refreshed}`); assert.equal(respawned, true);
});

test('no held actor, an empty held set or a full snapshot encode exactly the bytes of the untiered path', () => {
  const { area, viewer, near, far } = scene();
  const pairs = [[createGameplayProtocol(catalog), createGameplayProtocol(catalog)], [createGameplayProtocol(catalog, { verify: false }), createGameplayProtocol(catalog, { verify: false })]];
  let watermark = -1;
  try {
    for (let sequence = 1; sequence <= 8; sequence++) {
      area.step(new Map([viewer, near, far].map(a => [a.p.state.unit.id, intent(sequence, [], { turn: 1 })])));
      const events = area.drainEvents(), snapshot = area.snapshot(); if (events.length) watermark = events.at(-1).order;
      const input = observation(area, viewer, sequence, snapshot, events, watermark, {});
      // heldIds names the far actor on the full first snapshot only; later it is empty.
      const tiered = { ...input, heldIds: sequence === 1 ? new Set([far.ref.id]) : new Set() };
      for (const [index, [plain, other]] of pairs.entries()) {
        const token = index ? prepareObservationSnapshot(snapshot, input.appearances, catalog, { verify: false }) : undefined;
        try { assert.deepEqual(other.encodeObservation({ ...tiered, ...(token ? { prepared: token } : {}) }), plain.encodeObservation({ ...input, ...(token ? { prepared: token } : {}) }), `${index} ${sequence}`); }
        finally { if (token) releasePreparedObservation(token); }
      }
    }
  } finally { area.dispose(); }
});
