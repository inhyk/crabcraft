// Race data. Prose and tables mirror docs/design.md; keep them in sync.
import type { RaceId } from '../crab/types';

export interface RaceDef {
  id: RaceId;
  name: string;
  tagline: string;
  lore: string;
  /** Shell paint options, first is default. Hex sRGB. */
  shellColors: { name: string; hex: string }[];
  /** Head piece variants (character creation "Crest Style"). Ids are used by the gear builder. */
  crestStyles: { id: string; name: string }[];
  /** LED eye colours, first is default. */
  ledColors: { name: string; hex: string }[];
  /** Body scale and posture hints for the rig and motion layer. */
  posture: { scale: number; bodyHeight: number; stanceWidth: number; hunch: number };
}

export const RACES: Record<RaceId, RaceDef> = {
  human: {
    id: 'human',
    name: 'Human',
    tagline: 'Polished, hopeful and a little too proud of their tabards.',
    lore:
      "Human crabs built Clawhaven's sea wall and repaint it every spring. They believe any problem can be solved by marching at it sideways in good formation, and so far the sea has not proven them wrong.",
    shellColors: [
      { name: 'Jumper Red', hex: '#d2202f' },
      { name: 'Royal Blue', hex: '#2747a8' },
      { name: 'Ivory', hex: '#e9e2cf' },
      { name: 'Bronze', hex: '#a8692e' },
    ],
    crestStyles: [
      { id: 'knight-helm', name: 'Plumed Helm' },
      { id: 'cape', name: 'Cape' },
      { id: 'circlet', name: 'Circlet' },
      { id: 'leather-cap', name: 'Leather Cap' },
    ],
    ledColors: [
      { name: 'Cyan', hex: '#53f2e4' },
      { name: 'Gold', hex: '#ffcf4a' },
      { name: 'White', hex: '#f4f8ff' },
    ],
    posture: { scale: 1, bodyHeight: 1, stanceWidth: 1, hunch: 0 },
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    tagline: 'Loud, loyal, and very hard to dent.',
    lore:
      'Orc crabs came over the dunes in rusted war-shells and stayed for the fishing. They settle arguments with a friendly claw-wrestle and keep score on the tavern wall, which is now mostly scratches.',
    shellColors: [
      { name: 'Olive', hex: '#5f7a2e' },
      { name: 'Moss', hex: '#3f5f2a' },
      { name: 'Rust Brown', hex: '#7a3f22' },
      { name: 'Ash Grey', hex: '#5a5a55' },
    ],
    crestStyles: [
      { id: 'topknot', name: 'Topknot Spike' },
      { id: 'skull-cap', name: 'Horned Skull Cap' },
      { id: 'bone-mohawk', name: 'Bone Mohawk' },
      { id: 'iron-band', name: 'Iron Band' },
    ],
    ledColors: [
      { name: 'Amber', hex: '#ffa62b' },
      { name: 'Red', hex: '#ff3b2f' },
      { name: 'Yellow', hex: '#ffe14d' },
    ],
    posture: { scale: 1.05, bodyHeight: 0.92, stanceWidth: 1.12, hunch: 0.1 },
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    tagline: 'Short legs, long memories, longer beards.',
    lore:
      'Dwarf crabs dig, smelt and solder. Their braided cable beards carry a little current, which they insist is for warmth and which is really for showing off.',
    shellColors: [
      { name: 'Copper', hex: '#b5652b' },
      { name: 'Slate', hex: '#4b5563' },
      { name: 'Deep Red', hex: '#8e1b1b' },
      { name: 'Steel', hex: '#8a949e' },
    ],
    crestStyles: [
      { id: 'horned-helm', name: 'Horned Helm' },
      { id: 'winged-helm', name: 'Winged Helm' },
      { id: 'miner-lamp', name: 'Miner Lamp' },
      { id: 'braids', name: 'Braids' },
    ],
    ledColors: [
      { name: 'Warm White', hex: '#fff1d6' },
      { name: 'Amber', hex: '#ffb347' },
      { name: 'Cyan', hex: '#53f2e4' },
    ],
    posture: { scale: 0.92, bodyHeight: 0.8, stanceWidth: 1.2, hunch: 0 },
  },
  undead: {
    id: 'undead',
    name: 'Undead',
    tagline: 'Rebooted against all advice.',
    lore:
      'These crabs were scrapped once and did not accept it. Their shells crack, their servos whine, and their LEDs flicker green, but they pay their tavern tab on time, which is more than can be said for some.',
    shellColors: [
      { name: 'Bone Grey', hex: '#a9a597' },
      { name: 'Faded Red', hex: '#8a4a4a' },
      { name: 'Grave Green', hex: '#55684f' },
      { name: 'Bruise Purple', hex: '#5b4a6b' },
    ],
    crestStyles: [
      { id: 'hood', name: 'Tattered Hood' },
      { id: 'cracked-helm', name: 'Cracked Helm' },
      { id: 'skull-plate', name: 'Skull Plate' },
      { id: 'lantern', name: 'Grave Lantern' },
    ],
    ledColors: [
      { name: 'Sickly Green', hex: '#8dff6a' },
      { name: 'Violet', hex: '#b779ff' },
      { name: 'Pale Blue', hex: '#9fd8ff' },
    ],
    posture: { scale: 0.98, bodyHeight: 0.9, stanceWidth: 0.95, hunch: 0.25 },
  },
  nightelf: {
    id: 'nightelf',
    name: 'Night Elf',
    tagline: 'Patient watchers of the moonlit pools.',
    lore:
      'Night Elf crabs walk on tall straight legs and speak softly to the tide. Their long antennae hear the moon, or so they say.',
    shellColors: [
      { name: 'Midnight Violet', hex: '#3b2a6b' },
      { name: 'Teal', hex: '#1f6f74' },
      { name: 'Silver', hex: '#b9c0cc' },
      { name: 'Moonlit Blue', hex: '#2e4f8f' },
    ],
    crestStyles: [
      { id: 'leaf-circlet', name: 'Leaf Circlet' },
      { id: 'long-antennae', name: 'Long Antennae' },
      { id: 'moon-diadem', name: 'Moon Diadem' },
      { id: 'elf-hood', name: 'Hood' },
    ],
    ledColors: [
      { name: 'Silver White', hex: '#eef4ff' },
      { name: 'Moon Blue', hex: '#7fb6ff' },
      { name: 'Magenta', hex: '#ff5ad1' },
    ],
    posture: { scale: 1.05, bodyHeight: 1.15, stanceWidth: 0.92, hunch: 0 },
  },
  tauren: {
    id: 'tauren',
    name: 'Tauren',
    tagline: 'Big shells, bigger hearts.',
    lore:
      'Tauren crabs carry totems from the high grass plains and the best stew recipes on the coast. They are slow to anger and very quick to second helpings.',
    shellColors: [
      { name: 'Earth Brown', hex: '#6b4a2f' },
      { name: 'Cream', hex: '#e6d3b0' },
      { name: 'Rust', hex: '#9a4a24' },
      { name: 'Charcoal', hex: '#3a3633' },
    ],
    crestStyles: [
      { id: 'great-horns', name: 'Great Horns' },
      { id: 'horns-feathers', name: 'Horns and Feathers' },
      { id: 'totem-headdress', name: 'Totem Headdress' },
      { id: 'mane', name: 'Braided Mane' },
    ],
    ledColors: [
      { name: 'Green', hex: '#7dff8a' },
      { name: 'Amber', hex: '#ffb347' },
      { name: 'Cyan', hex: '#53f2e4' },
    ],
    posture: { scale: 1.15, bodyHeight: 1.05, stanceWidth: 1.1, hunch: 0.05 },
  },
};

export const RACE_ORDER: RaceId[] = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
