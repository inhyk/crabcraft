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
