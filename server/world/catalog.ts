import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WIRE_SCHEMA_REVISION } from './gameplay/protocol.ts';
import { createHash } from 'node:crypto';
import { loadBakedWorld, type BakedCollision, type BakedWorld } from '../../src/sim/world/baked.ts';
import { realActionData } from '../../src/sim/data/actions.ts';
import { createWorld1Definition, type WorldDefinitionConfig } from '../../src/sim/areas/world1.ts';
import { createWorld2Definition } from '../../src/sim/areas/world2.ts';
import { createWorld3Definition } from '../../src/sim/areas/world3.ts';
import { createWorld4Definition } from '../../src/sim/areas/world4.ts';
import type { ActionData, AreaDefinition, AreaPolicy, BossProfileId, WorldId } from '../../src/sim/types.ts';
import { CLASSES } from '../../src/sim/data/classes.ts';
import { QUESTS } from '../../src/sim/data/quests.ts';
import { motionData } from '../../src/sim/data/pose.ts';
import { PERSONAL_FLAG_IDS } from '../../src/sim/persistence.ts';
import { RACES } from '../../src/data/races.ts';
import type { GameplayCatalog } from './gameplay/protocol.ts';

export const PUBLIC_WORLDS: readonly WorldId[] = Object.freeze(['w1', 'w2', 'w3', 'w4']);
export interface WorldVariants {
  readonly publicDefinition: AreaDefinition;
  readonly encounterDefinitions: ReadonlyMap<BossProfileId, AreaDefinition>;
}
export interface LoadedWorldDefinition extends WorldVariants {
  readonly world: WorldId;
  readonly query: BakedWorld;
  readonly actionData: ActionData;
  readonly policy: AreaPolicy;
  readonly seed: number;
  readonly bakeSource: string;
  readonly artifactHash: string;
}
export interface WorldCatalogOptions {
  directory: URL | string;
  expectedBakeSource: string;
  maxBakeBytes: number;
  maxCells: number;
  configs: Readonly<Record<WorldId, Pick<WorldDefinitionConfig, 'fixedLevels' | 'population'>>>;
  policies: Readonly<Record<WorldId, AreaPolicy>>;
  seeds: Readonly<Record<WorldId, number>>;
  /** Pure world/rules owner supplies public presentation and private encounter variants. */
  variants(world: WorldId, definition: AreaDefinition): WorldVariants;
}

/** Reads packaged, version-bound real collision artifacts. No balancing values are supplied here. */
export async function loadWorldCatalog(options: WorldCatalogOptions): Promise<ReadonlyMap<WorldId, LoadedWorldDefinition>> {
  if (!/^[a-f0-9]{64}$/.test(options.expectedBakeSource) || !Number.isSafeInteger(options.maxBakeBytes) || options.maxBakeBytes < 1 ||
    !Number.isSafeInteger(options.maxCells) || options.maxCells < 1) throw new Error('invalid world catalog bounds');
  const directory = options.directory instanceof URL ? options.directory : pathToFileURL(resolve(options.directory) + '/');
  const constructors = { w1: createWorld1Definition, w2: createWorld2Definition, w3: createWorld3Definition, w4: createWorld4Definition };
  const worlds = new Map<WorldId, LoadedWorldDefinition>();
  for (const world of PUBLIC_WORLDS) {
    const file = new URL(`collision-${world}.json`, directory);
    if ((await stat(file)).size > options.maxBakeBytes) throw new Error(`collision artifact too large: ${world}`);
    const bytes = await readFile(file);
    if (bytes.byteLength > options.maxBakeBytes) throw new Error(`collision artifact too large: ${world}`);
    const data = JSON.parse(bytes.toString('utf8')) as BakedCollision;
    if (data.format !== 'crabcraft-collision' || data.version !== 1 || data.world !== world || data.source !== options.expectedBakeSource) throw new Error(`collision artifact version mismatch: ${world}`);
    const c = data.cells;
    if (!c || !Number.isSafeInteger(c.nx) || !Number.isSafeInteger(c.nz) || c.nx < 2 || c.nz < 2 || c.nx * c.nz > options.maxCells) throw new Error(`collision artifact cell bounds: ${world}`);
    const seed = options.seeds[world];
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !options.policies[world]) throw new Error(`missing world configuration: ${world}`);
    const query = loadBakedWorld(data);
    const config: WorldDefinitionConfig = { ...options.configs[world], query,
      personalProps: { heightAt: query.heightAt, resolveCollision: (x, z, r, out) => query.collision.resolve(x, z, r, out) } };
    const definition = constructors[world](config);
    const variants = options.variants(world, definition);
    if (variants.publicDefinition.world !== world || variants.publicDefinition.bosses.length) throw new Error(`public world contains story bosses: ${world}`);
    for (const [profile, encounter] of variants.encounterDefinitions) {
      if (encounter.world !== world || encounter.bosses.length !== 1 || encounter.bosses[0].profile !== profile) throw new Error(`invalid encounter definition: ${world}`);
    }
    worlds.set(world, Object.freeze({ ...variants, world, query, actionData: realActionData,
      policy: options.policies[world], seed, bakeSource: data.source, artifactHash: createHash('sha256').update(bytes).digest('hex') }));
  }
  return worlds;
}

/** Public, non-secret decoding catalog; no action samples or character/account data. */
export function createGameplayCatalog(worlds: ReadonlyMap<WorldId, LoadedWorldDefinition>): GameplayCatalog {
  const definitions = [...worlds.values()].flatMap(w => [w.publicDefinition, ...w.encounterDefinitions.values()]);
  const unique = (values: readonly string[]) => Object.freeze([...new Set(values)].sort());
  const appearanceLimits = Object.fromEntries(Object.entries(RACES).map(([race, spec]) => [race, Object.freeze({ shell: spec.shellColors.length, crest: spec.crestStyles.length, led: spec.ledColors.length })]));
  const fields = {
    wireSchemaRevision: WIRE_SCHEMA_REVISION,
    poseProviderVersion: realActionData.version,
    archetypes: unique([...Object.keys(motionData.archetypes), 'boss-rust', 'boss-abyss', 'boss-eclipse', 'boss-dawn', 'boss-frost']),
    actions: unique(Object.keys(motionData.clips)), abilities: unique(Object.values(CLASSES).flatMap(c => c.abilities.map(a => a.id))),
    quests: unique(Object.keys(QUESTS)), npcs: unique(definitions.flatMap(d => d.npcs.map(n => n.id))),
    interactions: unique(definitions.flatMap(d => [...d.interactions.map(i => i.id), ...d.npcs.map(n => `npc:${n.id}`)])),
    gates: unique(definitions.flatMap(d => d.interactions.filter(i => i.kind === 'gate').map(i => i.id))),
    objectives: unique([...Object.values(QUESTS).flatMap(q => q.objectives.map(o => o.id)), 'patrol-kills']),
    flags: unique(PERSONAL_FLAG_IDS), jointCount: motionData.joints.length, appearanceLimits,
  };
  const content = { fields, actionVersion: realActionData.version, worlds: [...worlds.values()].map(w => [w.world, w.artifactHash]) };
  const version = `world-v3-${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
  return Object.freeze({ version, ...fields });
}
