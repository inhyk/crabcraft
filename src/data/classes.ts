// Class and ability data. Mirrors docs/design.md "Classes".
import type { ClassId } from '../crab/types';

export type Resource = 'rage' | 'mana';

export interface AbilityDef {
  id: string;
  slot: 1 | 2 | 3 | 4 | 5;
  name: string;
  description: string;
  /** Seconds. 0 = instant. */
  castTime: number;
  /** Recovery after a successful release; cast time is additional. All skills have a personal cooldown. */
  cooldown: number;
  cost: number;
  /** Rage generated (warrior) on use, if any. */
  generates?: number;
  range: number;
  icon: string; // public/art/icons/ability-<class>-<slot>.webp
}

export interface ClassDef {
  id: ClassId;
  name: string;
  lore: string;
  resource: Resource;
  weapon: string;
  baseHp: number;
  abilities: AbilityDef[];
}

const icon = (c: ClassId, s: number) => `art/icons/ability-${c}-${s}.webp`;

export const ULTIMATE: AbilityDef = { id: 'crown-burst', slot: 5, name: 'Crown Burst', description: 'Ultimate: unleash a powerful blast against visible enemies within 10 m. Recovers in 60 seconds.', castTime: 0, cooldown: 60, cost: 0, range: 10, icon: 'art/icons/ability-ultimate-burst.webp' };

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    lore:
      'Warriors fight claw to claw with sword and shield, building Rage from every blow given or taken and spending it on bashes, charges and a spinning Whirlpool that scatters a crowd.',
    resource: 'rage',
    weapon: 'Sword and round shield',
    baseHp: 140,
    abilities: [
      { id: 'pincer-strike', slot: 1, name: 'Pincer Strike', description: 'A heavy pincer blow.', castTime: 0, cooldown: 3, cost: 10, range: 2.2, icon: icon('warrior', 1) },
      { id: 'shell-bash', slot: 2, name: 'Shell Bash', description: 'Stuns the target for 2 sec.', castTime: 0, cooldown: 8, cost: 15, range: 2.2, icon: icon('warrior', 2) },
      { id: 'sideways-charge', slot: 3, name: 'Sideways Charge', description: 'Dash to the target. Generates 15 Rage.', castTime: 0, cooldown: 12, cost: 0, generates: 15, range: 14, icon: icon('warrior', 3) },
      { id: 'whirlpool', slot: 4, name: 'Whirlpool', description: 'Spin, hitting every enemy around you.', castTime: 0, cooldown: 10, cost: 30, range: 3.2, icon: icon('warrior', 4) },
      { ...ULTIMATE },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    lore:
      'Mages bend water, steam and frost through a sea-glass staff. Fragile up close, they blink away in a puff of steam and drown their foes in a Tidal Nova.',
    resource: 'mana',
    weapon: 'Sea-glass staff',
    baseHp: 100,
    abilities: [
      { id: 'bubble-bolt', slot: 1, name: 'Bubble Bolt', description: 'Hurls a scalding bubble.', castTime: 1.5, cooldown: 3, cost: 8, range: 24, icon: icon('mage', 1) },
      { id: 'frost-spray', slot: 2, name: 'Frost Spray', description: 'Cone of frost. Slows by 50% for 4 sec.', castTime: 0, cooldown: 8, cost: 14, range: 8, icon: icon('mage', 2) },
      { id: 'steam-blink', slot: 3, name: 'Steam Blink', description: 'Restore 10 HP and teleport up to 8 m forward.', castTime: 0, cooldown: 15, cost: 10, range: 8, icon: icon('mage', 3) },
      { id: 'tidal-nova', slot: 4, name: 'Tidal Nova', description: 'Burst of water around you. Knocks enemies back.', castTime: 0, cooldown: 20, cost: 22, range: 6, icon: icon('mage', 4) },
      { ...ULTIMATE },
    ],
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    lore:
      'Priests carry a lantern of the Tide and a book of very old hymns. They smite the wicked, mend cracked shells and ward allies with a barnacle shield.',
    resource: 'mana',
    weapon: 'Holy lantern and hymnal',
    baseHp: 110,
    abilities: [
      { id: 'smite', slot: 1, name: 'Smite', description: 'Strike with holy light.', castTime: 1.5, cooldown: 3, cost: 8, range: 24, icon: icon('priest', 1) },
      { id: 'mend-shell', slot: 2, name: 'Mend Shell', description: 'Heal 35% of your health.', castTime: 2, cooldown: 10, cost: 18, range: 0, icon: icon('priest', 2) },
      { id: 'barnacle-ward', slot: 3, name: 'Barnacle Ward', description: 'Absorbs damage for 10 sec.', castTime: 0, cooldown: 20, cost: 16, range: 0, icon: icon('priest', 3) },
      { id: 'holy-tide', slot: 4, name: 'Holy Tide', description: 'Damage nearby enemies and heal yourself.', castTime: 0, cooldown: 15, cost: 20, range: 6, icon: icon('priest', 4) },
      { ...ULTIMATE },
    ],
  },
};

export const CLASS_ORDER: ClassId[] = ['warrior', 'mage', 'priest'];
