import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { actualWorld } from './world-client-fixture.mjs';
mkdirSync('tmp/test-modules', { recursive: true });
buildSync({ stdin: { contents: "export * from './src/multiplayer/worldPresentation.ts';export {setLanguage} from './src/i18n.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: 'tmp/test-modules/world-presentation.mjs', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': "'/'" }, logLevel: 'silent' });
const { WorldPresentation, channelLabel, worldSayText, setLanguage } = await import('../tmp/test-modules/world-presentation.mjs');
const id = ref => JSON.stringify([ref.area, ref.id, ref.life]);
function fixture() {
  const state = actualWorld(2).state(), calls = [], units = new Map();
  for (const actor of state.actors) {
    const forbidden = () => assert.fail('Presentation called a gameplay authority method');
    const unit = {
      ref: actor.ref, name: actor.appearance.name, kind: actor.kind, level: actor.level, maxHp: actor.maxHp, yaw: actor.yaw, height: actor.height, radius: actor.radius,
      pos: new THREE.Vector3(actor.x, actor.y, actor.z), rig: { face: { setTint: (...args) => calls.push(['tint', ...args]) } },
      centre(out) { return out.copy(this.pos).add(new THREE.Vector3(0, this.height / 2, 0)); }, socketPos(_name, out) { return this.centre(out); },
      flash: (...args) => calls.push(['flash', ...args]), express: (...args) => calls.push(['express', ...args]),
      act: forbidden, die: forbidden, moveTo: forbidden, teleport: forbidden, gainXp: forbidden, respawn: forbidden, motion: { update: forbidden, play: forbidden, stop: forbidden },
    };
    units.set(id(actor.ref), unit);
  }
  const effect = label => ({ alive: true, dispose() { this.alive = false; calls.push([`${label}.dispose`]); }, setPosition(at) { calls.push([`${label}.position`, at.toArray()]); }, finish(at) { calls.push([`${label}.finish`, at?.toArray() ?? null]); }, hit() { calls.push([`${label}.hit`]); }, pop() { this.alive = false; calls.push([`${label}.pop`]); } });
  const vfx = new Proxy({ fx: { release(item) { item.alive = false; calls.push(['fx.release']); } } }, { get(target, name) { if (name in target) return target[name]; return (...args) => { calls.push([String(name), ...args]); if (name === 'observedProjectile') return effect('projectile'); if (name === 'ward') return effect('ward'); if (name === 'undertow') return effect('undertow'); if (String(name).startsWith('telegraph')) return effect('telegraph'); }; } });
  const hud = {
    floats: { spawn: (...args) => calls.push(['float', ...args]) }, damageFlash: value => calls.push(['damageFlash', value]),
    messages: { info: text => calls.push(['info', text]), error: text => calls.push(['error', text]), banner: (...args) => calls.push(['banner', ...args]), warn: text => { const notice = { text }; calls.push(['warn', notice]); return notice; }, clearWarning: notice => calls.push(['clearWarning', notice]) },
    chat: { system: text => calls.push(['system', text]), loot: text => calls.push(['loot', text]) },
    castBar: { observe: (...args) => calls.push(['cast.observe', ...args]), fail: value => calls.push(['cast.fail', value]), finish: () => calls.push(['cast.finish']) },
    targetFrame: { setUnit: (...args) => calls.push(['target', ...args]) }, bossFrame: { show: unit => calls.push(['boss.show', unit]), hide: () => calls.push(['boss.hide']) }, actionBar: { press: slot => calls.push(['press', slot]) },
  };
  const presenter = new WorldPresentation({ unit: ref => units.get(id(ref)) ?? null, self: () => units.get(id(state.selfRef)) ?? null, vfx, hud, audio: { sfx: (...args) => calls.push(['sfx', ...args]) }, follow: { yaw: 0, shake: (...args) => calls.push(['shake', ...args]), cut: () => calls.push(['cut']) }, time: () => state.time, say: (_unit, text) => calls.push(['say', text]), onEquipment: event => calls.push(['equipment', event]), onQuest: event => calls.push(['quest', event]), onEnding: event => calls.push(['ending', event]), onIncomplete: feature => calls.push(['incomplete', feature]), onExploration: view => calls.push(['exploration', view]) });
  return { state, calls, units, presenter };
}
const emit = (f, events) => f.presenter.events(events.map((event, index) => ({ tick: f.state.header.tick, order: index + 1, event })));

test('full baseline restores projectiles, all telegraph shapes, ward and original cast progress without transient events', () => {
  const f = fixture(), self = f.state.selfRef, target = f.state.actors[1].ref;
  f.state.time = 1; f.state.header.tick = 30;
  f.state.projectiles = [{ id: 7, source: self, target, style: 'bubble', x: 2, y: 3, z: 4, speed: 17, elapsed: 3, bornStep: 0 }];
  f.state.actors[0].absorb = 20; f.state.actors[0].absorbUntil = 8;
  f.state.self.player.channel = { kind: 'lighthouse-secret', start: 0, end: 4, targetId: 'lighthouse-secret', to: { x: 1, y: 2, z: 3 } };
  f.state.recovery.telegraphs = [{ tick: 0, order: 0, event: { type: 'telegraph', src: target, mech: 'slam', level: 300, seconds: 5, shapes: [
    { shape: 'circle', at: { x: 0, y: 0, z: 0 }, ground: { x: 0, y: 0, z: 0 }, radius: 3 },
    { shape: 'cone', at: { x: 0, y: 0, z: 0 }, ground: { x: 0, y: 0, z: 0 }, yaw: .2, range: 5, half: .5 },
    { shape: 'lane', at: { x: 0, y: 0, z: 0 }, yaw: .2, halfLength: 5, halfWidth: 1, color: '#ff0000' },
    { shape: 'undertow', at: { x: 0, y: 0, z: 0 }, radius: 5 },
  ] } }];
  try {
    const original = structuredClone(f.state); f.presenter.commit(f.state);
    assert.deepEqual(f.calls.find(call => call[0] === 'projectile.position')[1], [2, 3, 4]);
    assert.equal(f.calls.filter(call => call[0] === 'observedProjectile').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'warn').length, 1);
    assert.equal(f.calls.find(call => call[0] === 'telegraphCircle')[3], 4);
    const cast = f.calls.find(call => call[0] === 'cast.observe'); assert.equal(cast[1](), '바위 속 비밀을 깨우는 중'); assert.deepEqual(cast.slice(2), [0, 4, true]);
    f.presenter.commit(f.state); assert.equal(f.calls.filter(call => call[0] === 'observedProjectile').length, 1); assert.equal(f.calls.filter(call => call[0] === 'warn').length, 1);
    f.presenter.render(.1); assert.ok(f.calls.some(call => call[0] === 'beaconStream'));
    f.presenter.render(4.1); assert.ok(f.calls.some(call => call[0] === 'projectile.dispose')); assert.ok(f.calls.some(call => call[0] === 'clearWarning')); assert.ok(f.calls.some(call => call[0] === 'undertow.dispose'));
    assert.ok(f.calls.some(call => call[0] === 'cast.observe' && call[1] === null)); assert.deepEqual(f.state, original);
  } finally { f.presenter.dispose(); }
});

test('real effect/UI event families never call unit action, death, movement or player reward methods', () => {
  const f = fixture(), self = f.state.selfRef, target = f.state.actors[1].ref;
  f.presenter.commit(f.state); const original = structuredClone(f.state);
  try {
    emit(f, [
      { type: 'damage', src: null, dst: self, amount: 12, crit: true }, { type: 'heal', src: null, dst: self, amount: 5.1, crit: false },
      { type: 'blocked', unit: self, reason: 'absorbed' }, { type: 'death', unit: target, killer: self }, { type: 'jump', unit: self },
      { type: 'ability', caster: self, target, ability: 'shell-bash', stage: 'hit', stun: 2 }, { type: 'attack', src: target, target: self, attack: 'enemy-claw', stage: 'hit' },
      { type: 'xp', unit: self, amount: 20 }, { type: 'levelUp', unit: self, level: 2, oldMaxHp: 100, maxHp: 110, jump: false },
      { type: 'quest', unit: self, quest: 'q1', stage: 'completed' }, { type: 'equipment', unit: self, slot: 'weapon', operation: 'buy', result: 'bought', request: 8 },
      { type: 'achievement', unit: self, achievement: 'treasure' }, { type: 'discovery', unit: self, discovery: 'lighthouse-secret', id: 'lighthouse-secret', first: true, coins: 50, activeUntil: 12 },
      { type: 'feature', event: { type: 'npcGreeting', unit: target, player: self, expression: 'happy', seconds: 1.5 } },
      { type: 'feature', event: { type: 'npcBark', unit: target, player: self, bank: 'shore', index: 0 } },
      { type: 'endingReady', unit: self, chapter: 4, replay: false }, { type: 'rootRebase', unit: self, generation: 1, root: { x: 1, z: 1, yaw: 1 }, position: { x: 10, y: 2, z: 10 }, yaw: 2 },
    ]);
    assert.ok(f.calls.some(call => call[0] === 'deathPoof')); assert.ok(f.calls.some(call => call[0] === 'stunStars')); assert.ok(f.calls.some(call => call[0] === 'equipment')); assert.ok(f.calls.some(call => call[0] === 'quest'));
    assert.ok(f.calls.some(call => call[0] === 'incomplete' && call[1] === 'ending-choreography')); assert.deepEqual(f.state, original);
    assert.equal(f.state.self.player.coins, 0); assert.equal(f.state.self.player.xp, 0);
  } finally { f.presenter.dispose(); }
});

test('authoritative removal cancels projectiles without a splash; an actual hit still splashes after baseline removal', () => {
  const f = fixture(), self = f.state.selfRef, target = f.state.actors[1].ref;
  f.state.projectiles = [{ id: 2, source: self, target, style: 'bubble', x: 1, y: 2, z: 3, speed: 17, elapsed: .5, bornStep: 0 }];
  try {
    f.presenter.commit(f.state); f.state.projectiles = []; f.presenter.commit(f.state);
    assert.ok(f.calls.some(call => call[0] === 'projectile.dispose')); assert.equal(f.calls.filter(call => call[0] === 'bubbleSplash').length, 0);
    emit(f, [{ type: 'projectile', stage: 'hit', id: 2, src: self, target, style: 'bubble', landed: true }]);
    assert.equal(f.calls.filter(call => call[0] === 'bubbleSplash').length, 1);
    f.presenter.events([{ tick: 0, order: 1, event: { type: 'projectile', stage: 'hit', id: 2, src: self, target, style: 'bubble', landed: true } }]);
    assert.equal(f.calls.filter(call => call[0] === 'bubbleSplash').length, 1);
  } finally { f.presenter.dispose(); }
});

test('known loading actors defer effects once; epoch reset drops old pending effects and cleans handles', () => {
  const f = fixture(), ref = f.state.actors[1].ref, unit = f.units.get(id(ref)); f.units.delete(id(ref));
  try {
    f.presenter.commit(f.state); emit(f, [{ type: 'damage', src: null, dst: ref, amount: 3, crit: false }]); assert.equal(f.calls.filter(call => call[0] === 'float').length, 0);
    f.units.set(id(ref), unit); f.presenter.render(.1); assert.equal(f.calls.filter(call => call[0] === 'float').length, 1); f.presenter.render(.1); assert.equal(f.calls.filter(call => call[0] === 'float').length, 1);
    f.units.delete(id(ref)); f.presenter.events([{ tick: 0, order: 2, event: { type: 'damage', src: null, dst: ref, amount: 99, crit: false } }]);
    const next = structuredClone(f.state); next.header.epoch++; f.presenter.commit(next); f.units.set(id(ref), unit); f.presenter.render(.1);
    assert.equal(f.calls.filter(call => call[0] === 'float').length, 1);
  } finally { f.presenter.dispose(); }
});

test('boss and channel text use existing locale functions and never require unit.ctrl', () => {
  setLanguage('en');
  try { assert.equal(channelLabel('lighthouse-secret'), 'Waking the secret in the stone'); assert.equal(worldSayText('boss.frost.awake'), 'Boreas awakens upon the Frozen Throne.'); assert.equal(worldSayText('boss.freed.thanks'), 'Thank you. It was very dark in there.'); assert.equal(worldSayText('untranslated-internal-key'), null); }
  finally { setLanguage('ko'); }
});

test('ending recovery and its same-tick event notify once while explicit later replay remains observable', () => {
  const f = fixture(), ending = { unit: f.state.selfRef, chapter: 4, replay: true };
  try {
    f.state.recovery.endings = [ending]; f.presenter.commit(f.state);
    emit(f, [{ type: 'endingReady', ...ending }]); assert.equal(f.calls.filter(call => call[0] === 'ending').length, 1);
    f.presenter.events([{ tick: f.state.header.tick + 1, order: 2, event: { type: 'endingReady', ...ending } }]);
    assert.equal(f.calls.filter(call => call[0] === 'ending').length, 2);
  } finally { f.presenter.dispose(); }
});
