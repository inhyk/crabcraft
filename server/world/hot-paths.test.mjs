// The world host hot paths (decode each client frame once, hand the decoded intent to InputSession, prepared publication
// with visible-id baselines, indexed events and optional re-validation) must give the same results, errors and bytes
// as the code they replace. The references here are the unchanged FragmentAssembler, selectEvents and unprepared paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameplayProtocol, GameplayReceiver, FragmentAssembler, decodeClientFrame, encodeControl, validateControl, projectObservationExtras, prepareObservationSnapshot, releasePreparedObservation } from './gameplay/protocol.ts';
import { encodeInput, decodeInput, inputFromFrame, validateInput, InputSession } from './gameplay/intents.ts';
import { selectEvents, indexEvents, selectIndexedEvents } from './gameplay/events.ts';
import { worldArea, addActor, intent } from '../../tests/core/worldHarness.mjs';
import { catalog, appearance } from '../../tests/world-client-fixture.mjs';

const binding = { session: 'hot-path-session', area: 'hot-path-area', epoch: 3, catalog: catalog.version };
const outcome = run => { try { return { value: run() }; } catch (error) { return { error: error.message }; } };
// The decodeInput body before this change: a fresh assembler per call.
function referenceDecodeInput(bytes, expected) {
  if (expected.catalog !== catalog.version) throw new Error('gameplay-v3: catalog mismatch');
  const message = new FragmentAssembler(expected).accept(bytes, 0);
  if (!message || message.kind !== 16) throw new Error('gameplay-v3: input must be one complete frame');
  const h = message.header;
  if (h.tick !== 0 || h.acceptedInput !== 0 || h.consumedInput !== 0) throw new Error('gameplay-v3: forged input header');
  validateInput(message.payload, catalog, expected.area);
  if (h.sequence !== message.payload.seq) throw new Error('gameplay-v3: input sequence mismatch');
  return message.payload;
}
// The decodeClientMessage body before this change, for a fresh protocol: an assembler, then decodeInput on the same bytes.
function referenceDecodeClientMessage(bytes, expected) {
  const m = new FragmentAssembler(expected).accept(bytes, 0); if (!m) throw new Error('gameplay-v3: client message must fit one frame');
  if (m.kind === 16) return { kind: 'input', intent: referenceDecodeInput(bytes, expected) };
  if (m.kind !== 17 || m.header.tick || m.header.acceptedInput || m.header.consumedInput) throw new Error('gameplay-v3: forged client control');
  validateControl(m.payload); if (m.payload.type !== 'resync') throw new Error('gameplay-v3: client cannot publish server control');
  return { kind: 'resync', sequence: m.header.sequence, lastSequence: m.payload.lastSequence, reason: m.payload.reason };
}
function frames() {
  const inputs = [
    encodeInput({ binding, intent: intent(1) }, catalog),
    encodeInput({ binding, intent: intent(7, [{ kind: 'ability', slot: 2 }, { kind: 'target', target: { area: binding.area, id: 4, life: 1 } }], { forward: 1, strafe: -.5, sprint: true, steeringYaw: .25 }) }, catalog),
    encodeInput({ binding, intent: intent(9, [{ kind: 'chatSay', channel: 'area', text: '안녕 🦀' }]) }, catalog),
  ];
  const control = encodeControl({ ...binding, sequence: 2, tick: 0, acceptedInput: 0, consumedInput: 0 }, { type: 'resync', lastSequence: 0, reason: 'gap' })[0];
  const big = encodeControl({ ...binding, sequence: 3, tick: 0, acceptedInput: 0, consumedInput: 0 }, { type: 'chatLine', channel: 'area', line: { sender: { area: binding.area, id: 1, life: 1 }, name: 'x', text: 'y', at: 1 } })[0];
  const out = [...inputs, control, big, new Uint8Array(0), new Uint8Array(16385)];
  // Every prefix and a set of single-byte corruptions of each valid frame.
  for (const valid of [...inputs, control]) {
    for (let n = 0; n < valid.length; n++) out.push(valid.slice(0, n));
    for (let i = 0; i < valid.length; i++) for (const mask of [1, 0x80, 0xff]) { const bad = valid.slice(); bad[i] ^= mask; out.push(bad); }
    const trailing = new Uint8Array(valid.length + 1); trailing.set(valid); out.push(trailing);
  }
  return out;
}

test('client frames decode once with the same values and errors as a fresh FragmentAssembler', () => {
  const all = frames(); let inputs = 0, failures = 0;
  for (const bytes of all) {
    for (const expected of [binding, { ...binding, epoch: 4 }]) {
      const reference = outcome(() => new FragmentAssembler(expected).accept(bytes, 0)), single = outcome(() => decodeClientFrame(bytes, expected));
      assert.deepEqual(single, reference);
      const oldInput = outcome(() => referenceDecodeInput(bytes, expected));
      assert.deepEqual(outcome(() => decodeInput(bytes, expected, catalog)), oldInput);
      assert.deepEqual(outcome(() => inputFromFrame(decodeClientFrame(bytes, expected), expected, catalog)), oldInput);
      if (oldInput.value) inputs++; else failures++;
      assert.deepEqual(outcome(() => createGameplayProtocol(catalog).decodeClientMessage(bytes, expected)), outcome(() => referenceDecodeClientMessage(bytes, expected)));
    }
  }
  assert.ok(inputs >= 3 && failures > 1000, `${inputs} inputs, ${failures} rejected`);
});

test('InputSession.acceptDecoded queues what accept(bytes) queues and refuses intents it did not decode', () => {
  const protocol = createGameplayProtocol(catalog), viaBytes = new InputSession(binding, catalog), viaDecoded = new InputSession(binding, catalog);
  const packets = [intent(1, [], { forward: 1 }), intent(2, [{ kind: 'ability', slot: 1 }], { strafe: .5 }), intent(3, [{ kind: 'jump' }, { kind: 'dance' }], { turn: -1 })].map(i => encodeInput({ binding, intent: i }, catalog));
  packets.forEach((bytes, i) => {
    const returned = viaBytes.accept(bytes, i * .01);
    const decoded = protocol.decodeClientMessage(bytes, binding); assert.equal(decoded.kind, 'input');
    assert.equal(viaDecoded.acceptDecoded(decoded.intent, i * .01), undefined); assert.deepEqual(decoded.intent, returned);
    assert.throws(() => viaDecoded.acceptDecoded(decoded.intent, i * .01), /not decoded for this session/);
  });
  assert.equal(viaDecoded.acceptedInput, viaBytes.acceptedInput); assert.equal(viaDecoded.pendingCount, viaBytes.pendingCount);
  const a = viaBytes.prepareTick(.05, 2), b = viaDecoded.prepareTick(.05, 2); assert.deepEqual(b, a);
  // The caller's copy is detached from the retained preparation, as before.
  b.intent.commands.push({ kind: 'jump' }); b.intent.forward = 0; b.sequences.push(99); assert.deepEqual(viaDecoded.prepareTick(.05, 2), a);
  viaBytes.commitConsumed(a.token); viaDecoded.commitConsumed(a.token); assert.deepEqual(viaDecoded.prepareTick(.06, 32), viaBytes.prepareTick(.06, 32));
  const fresh = encodeInput({ binding, intent: intent(4) }, catalog);
  assert.throws(() => viaDecoded.acceptDecoded({ ...intent(4) }, .07), /not decoded for this session/);
  const other = { ...binding, epoch: 9 }, foreign = createGameplayProtocol(catalog).decodeClientMessage(encodeInput({ binding: other, intent: intent(4) }, catalog), other);
  assert.throws(() => viaDecoded.acceptDecoded(foreign.intent, .07), /not decoded for this session/);
  const otherCatalog = { ...catalog, npcs: [...catalog.npcs, 'extra-npc'] }, mismatched = decodeInput(fresh, binding, otherCatalog);
  assert.throws(() => viaDecoded.acceptDecoded(mismatched, .07), /not decoded for this session/);
  viaDecoded.revoke(); assert.throws(() => viaDecoded.acceptDecoded(protocol.decodeClientMessage(fresh, binding).intent, .07), /revoked/);
});

test('indexed event selection equals selectEvents for every recipient and visible set', () => {
  const area = worldArea('hot-path-events', 'w1'), actors = Array.from({ length: 6 }, (_, i) => addActor(area, `event-${i}`, i % 2 ? 'warrior' : 'mage'));
  try {
    for (let i = 0; i < 3; i++) area.step(new Map(actors.map(a => [a.ref.id, intent(i + 1, [], { forward: 1, steeringYaw: i * .3 })])));
    for (const enemy of area.snapshot().units.filter(u => u.kind === 'scrapling')) area.services.combat.damage(actors[1].ref, enemy.ref, 1e6);
    area.step(new Map(actors.map(a => [a.ref.id, intent(4, [{ kind: 'ability', slot: 1 }])])));
    const events = area.drainEvents(), snapshot = area.snapshot(), index = indexEvents(events), ids = snapshot.units.map(u => u.ref.id);
    assert.ok(['damage', 'death', 'xp', 'reward'].every(type => events.some(r => r.event.type === type)), JSON.stringify([...new Set(events.map(r => r.event.type))]));
    for (const actor of actors) for (const visible of [new Set(ids), new Set([actor.ref.id]), new Set(ids.filter((_, i) => i % 3 === 0)), new Set()]) {
      for (const self of [actor.ref, { ...actor.ref, life: actor.ref.life + 1 }, { ...actor.ref, area: 'elsewhere' }]) {
        assert.deepEqual(selectIndexedEvents(index, self, actor.p.state.character, visible), selectEvents(events, self, actor.p.state.character, visible));
      }
    }
  } finally { for (const p of area.pendingGrants()) area.acknowledgeGrant(p.grant.id); area.dispose(); }
});

test('prepared publication with visible-id baselines, indexed events and verify off is byte-identical to the unprepared path', () => {
  const area = worldArea(binding.area, 'w1'), actors = Array.from({ length: 8 }, (_, i) => addActor(area, `viewer-${i}`, i % 2 ? 'warrior' : 'mage'));
  const reference = actors.map(() => createGameplayProtocol(catalog)), checked = actors.map(() => createGameplayProtocol(catalog)), production = actors.map(() => createGameplayProtocol(catalog, { verify: false }));
  const receivers = actors.map(() => new GameplayReceiver(binding, catalog));
  const appearances = Object.fromEntries(actors.map(a => [`${a.u.ref.id}:${a.u.ref.life}`, appearance]));
  let compared = 0, withEvents = 0, watermark = -1;
  try {
    for (let publish = 1; publish <= 8; publish++) {
      area.step(new Map(actors.map((a, i) => [a.ref.id, intent(publish, publish === 3 && i === 2 ? [{ kind: 'ability', slot: 1 }] : [], { forward: (i % 3) - 1, strafe: i % 2 ? .5 : -.5, steeringYaw: (i + publish) * .2 - 1 })])));
      if (publish === 4) for (const enemy of area.snapshot().units.filter(u => u.kind === 'scrapling')) area.services.combat.damage(actors[3].ref, enemy.ref, 1e6);
      const events = area.drainEvents(), snapshot = area.snapshot(), units = snapshot.units.map(u => u.ref.id); if (events.length) watermark = events.at(-1).order;
      const tokens = [prepareObservationSnapshot(snapshot, appearances, catalog), prepareObservationSnapshot(snapshot, appearances, catalog, { verify: false })];
      try {
        actors.forEach((actor, i) => {
          // Visible sets in the host's insertion order, some without self, some shared between viewers, some out of id order.
          const shared = new Set(units.filter((_, k) => k % 2 === publish % 2)), own = new Set([...units].reverse().filter((_, k) => (k + i) % 3 !== 0));
          const visibleIds = i < 3 ? shared : i === 7 ? new Set([actor.ref.id]) : own;
          const input = { binding, sequence: publish, tick: snapshot.tick, acceptedInput: 0, consumedInput: 0, selfRef: actor.ref, snapshot, events, visibleIds, full: publish === 1 || publish === 6 && i === 4,
            eventWatermark: watermark, appearances, ...projectObservationExtras(snapshot, actor.p.state.character, visibleIds) };
          const expected = reference[i].encodeObservation(input);
          assert.deepEqual(checked[i].encodeObservation({ ...input, prepared: tokens[0] }), expected, `checked viewer ${i} publish ${publish}`);
          const bytes = production[i].encodeObservation({ ...input, prepared: tokens[1] });
          assert.deepEqual(bytes, expected, `production viewer ${i} publish ${publish}`);
          let result; for (const packet of bytes) result = receivers[i].accept(packet, 0);
          assert.equal(result.kind, 'snapshot'); if (result.events.length) withEvents++; compared++;
        });
      } finally { tokens.forEach(releasePreparedObservation); }
    }
  } finally { for (const p of area.pendingGrants()) area.acknowledgeGrant(p.grant.id); area.dispose(); }
  assert.equal(compared, 64); assert.ok(withEvents > 0);
});

test('verify off skips only re-validation: forged prepared tokens, list bounds and the baseline rule still fail', () => {
  const area = worldArea(binding.area, 'w1'), actor = addActor(area, 'bounds');
  try {
    const snapshot = area.snapshot(), appearances = { [`${actor.u.ref.id}:${actor.u.ref.life}`]: appearance }, visibleIds = new Set([actor.ref.id]);
    const input = { binding, sequence: 1, tick: snapshot.tick, acceptedInput: 0, consumedInput: 0, selfRef: actor.ref, snapshot, events: [], visibleIds, full: true, eventWatermark: -1, appearances, ...projectObservationExtras(snapshot, actor.p.state.character, visibleIds) };
    const token = prepareObservationSnapshot(snapshot, appearances, catalog, { verify: false });
    assert.throws(() => createGameplayProtocol(catalog, { verify: false }).encodeObservation({ ...input, prepared: { ...token } }), /prepared/);
    assert.throws(() => createGameplayProtocol(catalog, { verify: false }).encodeObservation({ ...input, prepared: token, results: Array.from({ length: 257 }, (_, i) => ({ inputSequence: 0, commandIndex: i, status: 'failed', code: 'x' })) }), /invalid list/);
    const telegraphs = Array.from({ length: 65 }, () => ({ tick: 0, order: 0, event: { type: 'telegraph' } }));
    assert.throws(() => createGameplayProtocol(catalog, { verify: false }).encodeObservation({ ...input, prepared: token, recovery: { ...input.recovery, telegraphs } }), /invalid list/);
    // The default stays strict for tests and development.
    assert.throws(() => prepareObservationSnapshot(Object.freeze(structuredClone(snapshot)), appearances, catalog), /deeply frozen/);
    assert.doesNotThrow(() => releasePreparedObservation(prepareObservationSnapshot(Object.freeze(structuredClone(snapshot)), appearances, catalog, { verify: false })));
    releasePreparedObservation(token);
  } finally { area.dispose(); }
});
