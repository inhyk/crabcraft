import { readFileSync } from 'node:fs';
import { worldArea, addActor } from './core/worldHarness.mjs';
import { createGameplayProtocol, GameplayReceiver } from '../server/world/gameplay/protocol.ts';
import { QUESTS } from '../src/sim/data/quests.ts';
import { CLASSES } from '../src/sim/data/classes.ts';
import { RACES } from '../src/data/races.ts';
const motion = JSON.parse(readFileSync(new URL('../src/sim/data/pose-data.json', import.meta.url), 'utf8'));
export const catalog = {
  version: motion.version, poseProviderVersion: motion.version, archetypes: [...Object.keys(motion.archetypes), 'boss-rust', 'boss-abyss', 'boss-eclipse', 'boss-dawn', 'boss-frost'],
  actions: Object.keys(motion.clips), abilities: [...new Set(Object.values(CLASSES).flatMap(c => c.abilities.map(a => a.id)))],
  quests: Object.keys(QUESTS), npcs: ['brinebeard', 'silvermoon', 'coralline', 'grukk', 'hoofclaw', 'rattlebolt', 'pip'],
  interactions: ['npc:brinebeard', 'beacon'], gates: ['gate:w2'], objectives: Object.values(QUESTS).flatMap(q => q.objectives.map(o => o.id)),
  flags: ['beaconLit', 'rustCleared', 'abyssCleared', 'trueCleared', 'finalCleared', 'frostCleared'], jointCount: 22,
  appearanceLimits: Object.fromEntries(Object.entries(RACES).map(([id, race]) => [id, { shell: race.shellColors.length, crest: race.crestStyles.length, led: race.ledColors.length }])),
};
export const appearance = { race: 'human', sex: 'female', classId: 'mage', shell: 2, crest: 3, led: 2, name: '별빛' };
export function actualWorld(count = 1, areaId = 'client-test-world') {
  const area = worldArea(areaId), actors = Array.from({ length: count }, (_, i) => addActor(area, `owned-${i}`));
  const binding = { session: 'transport-incarnation', area: areaId, epoch: 1, catalog: catalog.version };
  const codec = createGameplayProtocol(catalog);
  const observation = (sequence = 1, options = {}) => {
    const snapshot = area.snapshot();
    return {
      binding, sequence, tick: snapshot.tick, acceptedInput: 0, consumedInput: 0, selfRef: actors[0].p.state.unit,
      snapshot, events: [], visibleIds: new Set(actors.map(a => a.u.ref.id)), full: false, eventWatermark: -1,
      features: { environment: { beacon: false, clock: snapshot.time, mode: snapshot.features.mode, pvp: snapshot.features.pvp }, boat: null, village: null },
      recovery: { telegraphs: [], endings: [] }, achievements: { distance: 0, earned: [] },
      appearances: Object.fromEntries(actors.map(a => [`${a.u.ref.id}:${a.u.ref.life}`, appearance])), ...options,
    };
  };
  return {
    area, actors, binding, codec, observation,
    packets(sequence = 1, options = {}) { return codec.encodeObservation(observation(sequence, options)); },
    state() { const receiver = new GameplayReceiver(binding, catalog); let result; for (const packet of codec.encodeObservation(observation(1, { full: true }))) result = receiver.accept(packet, 0); return result.state; },
  };
}
export class TestSocket extends EventTarget {
  readyState = 0; bufferedAmount = 0; binaryType = 'blob'; sent = []; closed = false;
  send(value) { this.sent.push(typeof value === 'string' ? value : new Uint8Array(value).slice()); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : new Uint8Array(value).buffer })); }
  close() { this.closed = true; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
export const tickAsync = () => new Promise(resolve => setImmediate(resolve));
export const deliver = (socket, packets) => packets.forEach(packet => socket.receive(packet));
