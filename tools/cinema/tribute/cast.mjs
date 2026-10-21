// The tribute's cast: one look per character, shared by every scene so a crab is the same crab
// wherever it appears. Specs are CrabSpec (src/crab/types.ts); colours and crests index the race's
// lists in src/data/races.ts.
export const DWARF = { race: 'dwarf', sex: 'male', classId: 'warrior', shell: 0, crest: 3, led: 0, name: 'Ironbraid' }; // copper, braids
export const ELF = { race: 'nightelf', sex: 'female', classId: 'priest', shell: 0, crest: 1, led: 0, name: 'Moonwhisper' }; // midnight violet, long antennae
export const UNDEAD = { race: 'undead', sex: 'male', classId: 'mage', shell: 2, crest: 0, led: 0, name: 'Gravecall' }; // grave green, hood, sickly green eyes
export const TAUREN = { race: 'tauren', sex: 'male', classId: 'priest', shell: 0, crest: 2, led: 0, name: 'Earthhoof' }; // earth brown, totem headdress
export const ORC = { race: 'orc', sex: 'male', classId: 'warrior', shell: 0, crest: 2, led: 1, name: 'Ashmaw' }; // olive, bone mohawk, red eyes
export const MAGE = { race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 2, led: 0, name: 'Frostwick' }; // Jumper red, circlet
/** The dwarf's beast, his hunting companion: a Rustclaw Scavenger (enemy rig) at about twice his size. */
export const BEAST = { enemy: 'scavenger', scale: 2.1 };
/** The giant that falls from the sky and smashes the tower. */
export const GIANT = { enemy: 'corrodius', scale: 3.5 };

/**
 * The fur costumes (src/capture/cinema/fx/snow-fur.ts): the dwarf's mantle, beard and brows and the
 * beast's pelt, put on in every shot they appear in, blowing with that shot's snow. A shot's own fur cue
 * for an actor (say to dim the LEDs in a macro) keeps its fields and gets the rest from here. The key
 * lights the fur alone from high on the crab's right and behind (the groom casts the coat's shadow from
 * there); the rim comes from behind the camera's subject and makes the coat's edge glow.
 */
const FUR_KEY = { color: '#fff1e0', gain: 7 };
const FUR_RIM = { dir: [0.35, 0.45, -1], color: '#dfe9ff', gain: 6 };
const outfit = (a) => (a.spec?.name === DWARF.name ? 'dwarf' : a.enemy === BEAST.enemy && a.scale === BEAST.scale ? 'beast' : null);
export function dress(shot) {
  const fx = shot.fx ?? [];
  const wind = fx.filter((f) => f.kind === 'snow-streaks').pop()?.drift ?? [2, -1, 3];
  const base = (a) => ({ t: -3, kind: 'fur', actor: a.id, outfit: outfit(a), wind, key: FUR_KEY, rim: FUR_RIM });
  const dressed = shot.actors.filter((a) => outfit(a));
  if (!dressed.length) return shot;
  const own = (a) => fx.find((f) => f.kind === 'fur' && f.actor === a.id);
  return {
    ...shot,
    fx: [...fx.filter((f) => f.kind !== 'fur' || !dressed.some((a) => a.id === f.actor)), ...dressed.map((a) => ({ ...base(a), ...own(a) }))],
  };
}
