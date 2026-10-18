import test from 'node:test';
import assert from 'node:assert/strict';
import { WIRE_SCHEMA_REVISION } from './gameplay/protocol.ts';
import { readFile } from 'node:fs/promises';
import { loadWorldCatalog, createGameplayCatalog } from './catalog.ts';
import { createWorld4Definition } from '../../src/sim/areas/world4.ts';
import { createArea } from '../../src/sim/area.ts';
const directory = new URL('../../public/world/', import.meta.url);
const source = JSON.parse(await readFile(new URL('collision-w1.json', directory), 'utf8')).source;
const ids = ['w1', 'w2', 'w3', 'w4'];
// Deliberately small test populations; these are not production balance choices.
const policy = { enemyLevel: spawn => spawn.fixedLevel, enemyPopulation: () => ({ desired: 1, respawnSeconds: 30 }),
  damageAllowed: (_context, source, target) => !(source?.kind === 'player' && target.kind === 'player'), canInteract: () => true };
const options = () => ({ directory, expectedBakeSource: source, maxBakeBytes: 16 * 1024 * 1024, maxCells: 1000000,
  configs: Object.fromEntries(ids.map(id => [id, { fixedLevels: { scrapling: 1, scavenger: 1, jellyfish: 1, echo: 1 }, population: { scrapling: 1, scavenger: 0, jellyfish: 0 } }])),
  policies: Object.fromEntries(ids.map(id => [id, policy])), seeds: { w1: 1, w2: 2, w3: 3, w4: 4 },
  variants: (_world, definition) => ({ publicDefinition: { ...definition, bosses: [] }, encounterDefinitions: new Map(definition.bosses.map(boss => [boss.profile, { ...definition, bosses: [boss] }])) }) });

test('four real baked world queries and shipped action data produce public and encounter catalogs', async () => {
  const catalog = await loadWorldCatalog(options()); assert.deepEqual([...catalog.keys()], ids);
  for (const [id, loaded] of catalog) {
    assert.equal(loaded.world, id); assert.equal(loaded.publicDefinition.bosses.length, 0);
    assert.match(loaded.artifactHash, /^[a-f0-9]{64}$/); assert.equal(loaded.bakeSource, source);
    const spawn = loaded.publicDefinition.spawn.position;
    assert(Number.isFinite(loaded.query.heightAt(spawn.x, spawn.z)));
    assert.equal(loaded.actionData.archetype('human').radius > 0, true);
  }
});
test('catalog rejects changed bake versions and bounds before constructing the world', async () => {
  await assert.rejects(loadWorldCatalog({ ...options(), expectedBakeSource: '0'.repeat(64) }), /version mismatch/);
  await assert.rejects(loadWorldCatalog({ ...options(), maxBakeBytes: 1 }), /too large/);
  await assert.rejects(loadWorldCatalog({ ...options(), maxCells: 1 }), /cell bounds/);
});
test('four-world host excludes the canonical frontier gate before rules and advertised catalog construction',async()=>{
 const worlds=await loadWorldCatalog(options()),loaded=worlds.get('w4');
 const canonical=createWorld4Definition({...options().configs.w4,query:loaded.query}),frontier=canonical.interactions.find(i=>i.id==='gate:w5');
 assert(frontier,'canonical six-world core retains the legacy frontier gate');
 assert.equal(loaded.publicDefinition.interactions.some(i=>i.id==='gate:w5'),false);
 for(const definition of loaded.encounterDefinitions.values())assert.equal(definition.interactions.some(i=>i.id==='gate:w5'),false);
 const catalog=createGameplayCatalog(worlds);assert.equal(catalog.gates.includes('gate:w5'),false);assert.equal(catalog.interactions.includes('gate:w5'),false);
 const area=createArea({id:'hosted-four-gate',definition:loaded.publicDefinition,query:loaded.query,actionData:loaded.actionData,policy:loaded.policy,seed:1,context:{mode:'public',pvp:'disabled',members:[]},limits:{eventCount:4096,inputCommandsPerTick:32,timers:256,projectiles:256}});
 try{
  const ref=area.attachFresh('gate-fixture','mage','human','spawn'),player=area.services.player(ref),unit=area.services.getUnit(ref);player.state.flags.frostCleared=true;Object.assign(unit,frontier.position);area.drainEvents();
  const before=structuredClone({ref:unit.ref,x:unit.x,y:unit.y,z:unit.z,xp:player.state.xp,coins:player.state.coins});
  assert.equal(area.services.runCommand(ref,{kind:'travel',gateId:'gate:w5'}),false);
  assert.deepEqual({ref:unit.ref,x:unit.x,y:unit.y,z:unit.z,xp:player.state.xp,coins:player.state.coins},before);
  assert.equal(area.drainEvents().some(r=>r.event.type==='travelReady'),false);
 }finally{area.dispose();}
});
test('public catalog cannot accidentally host story bosses or substitute mismatched encounters', async () => {
  await assert.rejects(loadWorldCatalog({ ...options(), variants: (_world, definition) => ({ publicDefinition: definition, encounterDefinitions: new Map() }) }), /story bosses/);
  await assert.rejects(loadWorldCatalog({ ...options(), variants: (_world, definition) => ({ publicDefinition: { ...definition, bosses: [] }, encounterDefinitions: new Map([['frost', { ...definition, bosses: [] }]]) }) }), /encounter/);
});


test('public decoding catalog explicitly advertises the compiled binary schema without account or presentation state',async()=>{
 const worlds=await loadWorldCatalog(options()),catalog=createGameplayCatalog(worlds);assert.equal(catalog.wireSchemaRevision,WIRE_SCHEMA_REVISION);assert.equal(Object.isFrozen(catalog),true);assert.match(catalog.version,/^world-v3-[a-f0-9]{64}$/);for(const key of ['accountId','characterId','endingPresentation','schemaRevision'])assert.equal(key in catalog,false);
});
