import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldView, worldActorKey, createWorldActorRig } from '../src/multiplayer/worldView.ts';
import { actualWorld, appearance, tickAsync } from './world-client-fixture.mjs';

// Transform-only rig for async lifecycle tests. Actual production factories are checked in Chrome.
function transformRig() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); root.scale.set(2, 3, 4);
  return { root, body, metersToUnits: 8, spec: appearance, updates: [], disposals: 0, joints: [], setPose(q) { this.joints = Array.from(q); }, update(dt) { this.updates.push(dt); }, dispose() { this.disposals++; } };
}
function fixture(options = {}) {
  const root = new THREE.Group(), rigs = [], added = [], removed = [], errors = [];
  const view = new WorldView({ root, createRig: async () => { const rig = transformRig(); rigs.push(rig); return rig; }, onAdded: (state, handle) => added.push({ state, handle }), onRemoved: ref => removed.push(ref), onError: (ref, code) => errors.push({ ref, code }), ...options });
  return { root, view, rigs, added, removed, errors };
}

test('raw complete server pose writes actual transform units once and exposes only frozen live observations', async () => {
  const state = actualWorld().state(), f = fixture(), source = structuredClone(state);
  try {
    f.view.commit(state); await tickAsync();
    const rig = f.rigs[0], actor = state.actors[0], handle = f.view.actor(actor.ref);
    assert.equal(f.view.readyCount, 1); assert.equal(f.root.children[0], rig.root);
    assert.deepEqual(handle.readState().appearance, appearance); assert.deepEqual(handle.readState().pose, actor.pose);
    f.view.render(0, .016);
    assert.deepEqual(rig.root.position.toArray(), [actor.x, actor.y, actor.z]);
    assert.deepEqual(rig.body.position.toArray(), actor.pose.appliedPosition.map(n => n * 8));
    assert.deepEqual(rig.body.quaternion.toArray(), actor.pose.appliedRotation);
    assert.deepEqual(rig.joints, actor.pose.appliedQ); assert.deepEqual(rig.root.scale.toArray(), [2, 3, 4]);
    assert.deepEqual(rig.updates, [.016]); assert.deepEqual(state, source);
    assert.throws(() => { handle.readState().hp = 999; }, TypeError);
    assert.throws(() => { handle.readState().pose.appliedQ[0] = 999; }, TypeError);
    const next = structuredClone(state); next.header.sequence = 2; next.sequence = 2; next.actors[0].x += 4; next.actors[0].hp = 7;
    f.view.commit(next); f.view.render(20, .02);
    assert.equal(handle.readState().hp, 7); assert.equal(rig.root.position.x, actor.x + 4); assert.deepEqual(rig.updates, [.016, .02]);
    assert.throws(() => f.view.commit(state), /Stale/);
  } finally { f.view.dispose(); }
});

test('area/life replacement disposes only the old full key and invalidates outstanding asset tasks', async () => {
  const loading = [], f = fixture({ createRig: () => new Promise(resolve => loading.push(resolve)) });
  const state = actualWorld().state();
  try {
    f.view.commit(state); assert.equal(loading.length, 1);
    const next = structuredClone(state); next.header.epoch++; next.header.sequence = 1; next.actors[0].ref.life++; next.selfRef.life++; next.self.player.unit.life++;
    f.view.commit(next); assert.equal(loading.length, 2);
    const old = transformRig(), current = transformRig(); loading[0](old); await tickAsync();
    assert.equal(old.disposals, 1); assert.equal(f.view.readyCount, 0); assert.equal(f.root.children.length, 0);
    loading[1](current); await tickAsync();
    assert.equal(f.view.readyCount, 1); assert.equal(f.view.actor(state.selfRef), null); assert.equal(f.view.actor(next.selfRef).rig, current);
    assert.notEqual(worldActorKey(next.selfRef), worldActorKey(state.selfRef));
  } finally { f.view.dispose(); }
});

test('reset/disposal and AOI removal release rigs and cannot resurrect after an async load completes', async () => {
  const state = actualWorld().state(), f = fixture();
  f.view.commit(state); await tickAsync(); const rig = f.rigs[0];
  const empty = structuredClone(state); empty.header.sequence++; empty.sequence++; empty.actors = [];
  f.view.commit(empty); assert.equal(rig.disposals, 1); assert.equal(rig.root.parent, null); assert.equal(f.removed.length, 1);
  f.view.dispose(); assert.equal(rig.disposals, 1);
  let finish; const late = fixture({ createRig: () => new Promise(resolve => { finish = resolve; }) });
  late.view.commit(state); late.view.dispose(); const result = transformRig(); finish(result); await tickAsync();
  assert.equal(result.disposals, 1); assert.equal(late.root.children.length, 0);
});

test('appearance changes recreate the rig rather than retaining a prior class/sex/color identity', async () => {
  const f = fixture(), state = actualWorld().state();
  try {
    f.view.commit(state); await tickAsync();
    const next = structuredClone(state); next.header.sequence++; next.sequence++; next.actors[0].appearance.sex = 'male'; next.actors[0].appearance.crest = 1;
    f.view.commit(next); await tickAsync();
    assert.equal(f.rigs[0].disposals, 1); assert.equal(f.rigs.length, 2); assert.deepEqual(f.added[1].handle.readState().appearance, next.actors[0].appearance);
  } finally { f.view.dispose(); }
});

test('missing player appearance and unknown catalog actors fail explicitly without a generic crab fallback', async () => {
  const actor = actualWorld().state().actors[0];
  await assert.rejects(createWorldActorRig({ ...actor, appearance: null }), /appearance/);
  await assert.rejects(createWorldActorRig({ ...actor, kind: 'npc', appearance: null, archetype: 'unshipped' }), /Unknown shipped rig/);
});
