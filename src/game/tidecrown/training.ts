// Class training in Tidecrown. Every class has its five skills from level 1 and the class is fixed at creation, so
// training is understanding and practice: a trainer for each class in its district explains the class's skills (the
// warrior's on the green beside the Barnacle Works' forge, the priest's on the Cathedral's parvis, the mage's on the
// lawn west of the great Seaglass tower), and beside each stand training dummies in the district's style (straw on wood,
// stone and brass, sea-glass and brass) that any skill can hit.
//
// A dummy is a Unit kept out of g.units, as the keepers are, so the residents' count, the shared sims and a relay room
// never see it: skills, clicks and Tab reach it through combatUnits() (abilities.ts), and its controller takes every
// hit itself (CombatController.practice, combat.ts), so nothing is routed to a room or shared and no enemy state is
// touched; skill effects aimed at it are not shared either (client.ts). It never dies (its health wraps back to full
// and refills after a pause), so it gives no XP or coins and never counts as a kill; it never moves or fights back.
// A hit puts the player in combat as any target does: travel waits until 5 s after the last hit (Player.inCombat).
// The practice panel counts this player's hits on the dummies: the total since its reset, the damage per second over
// the last 5 s and the biggest hit. Nothing is saved. On a server world nothing is built (TidecrownHub returns first).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ClassId, CrabRig, CrabSpec, SocketName } from '../../crab/types';
import { CLASSES } from '../../data/classes';
import { language, t } from '../../i18n';
import type { MotionController } from '../../motion/types';
import { h } from '../../ui/dom';
import { abilityFacts } from '../../ui/hud/actionbar';
import { iconEl } from '../../ui/hud/icons';
import { abilityDescription, abilityName } from '../abilityLocale';
import type { CombatController, HitOptions } from '../combat';
import type { Game } from '../game';
import { Unit } from '../unit';
import { yawTo } from '../util';
import type { TidecrownIsland } from './island';
import type { Keeper, Text, TidecrownKeepers } from './keepers';
import './training.css';

type Style = 'straw' | 'stone' | 'glass';

export interface TrainingYard {
  readonly cls: ClassId;
  readonly style: Style;
  /** The trainer's post (a keeper) and the way he faces: toward the way in. */
  readonly trainer: { readonly id: string; readonly x: number; readonly z: number; readonly yaw: number; readonly spec: CrabSpec; readonly name: Text; readonly title: Text; readonly marker: Text };
  /** Where this yard is, for the other trainers' pointers. */
  readonly place: Text;
  readonly dummies: readonly (readonly [x: number, z: number])[];
  /** Props beside the trainer (a weapon rack, a lectern, crystals): where, and the way they face. */
  readonly props: readonly (readonly [x: number, z: number, yaw: number])[];
  readonly greeting: Text;
  /** To a player of this class: the dummies and what they count. */
  readonly practise: Text;
  /** To a player of another class. */
  readonly other: (cls: Text, trainer: Text, place: Text) => Text;
  /** A tip per skill, for a player of this class. */
  readonly tips: Readonly<Record<string, Text>>;
}

const CLASS_NAME: Record<ClassId, Text> = { warrior: ['전사', 'warrior'], mage: ['마법사', 'mage'], priest: ['사제', 'priest'] };
const CLASS_TITLE: Record<ClassId, Text> = { warrior: ['전사', 'Warrior'], mage: ['마법사', 'Mage'], priest: ['사제', 'Priest'] };
/** A Korean word ending in a final consonant takes 이에요 / 이다 / 이군요; one ending in a vowel 예요 / 다 / 군요. */
const final = (word: string) => { const c = word.charCodeAt(word.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; };
const yeyo = (w: string) => `${w}${final(w) ? '이에요' : '예요'}`, ida = (w: string) => `${w}${final(w) ? '이다' : '다'}`;
const gunyo = (w: string) => `${w}${final(w) ? '이군요' : '군요'}`, roguna = (w: string) => `${w}${final(w) ? '이로구나' : '로구나'}`;
const CLASS_MARK: Record<ClassId, string> = { warrior: '⚔', mage: '✦', priest: '✚' };
const ULTIMATE_TIP: Text = ['적이 많을 때나 보스를 만났을 때 아껴 두세요. 10m 안에 보이는 적 모두에게 큰 피해를 주고, 1분에 한 번 쓸 수 있어요.', 'Save it for a crowd or a boss: it blasts every enemy you can see within 10 m, once a minute.'];
const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/**
 * The three yards. Each stands clear of its district's main walk, the residents' posts (8 m and more), the King, the
 * captain, the Seaglass portal and its keeper Opal (over 10 m), and the district cameras of qa-tidecrown-districts.
 */
export const TRAINING_YARDS: readonly TrainingYard[] = [
  {
    cls: 'warrior', style: 'straw',
    // The green between the forge and the terrace wall, entered from Tide Street past the forge's east corner.
    trainer: { id: 'tc-trainer-warrior', x: -65.2, z: 24.6, yaw: face(-65.2, 24.6, -67, 33), spec: { race: 'dwarf', sex: 'male', classId: 'warrior', shell: 3, crest: 0, led: 1, name: 'Gron' }, name: ['교관 그론', 'Gron'], title: ['⚔ 전사 교관', '⚔ Warrior Trainer'], marker: ['전사 훈련', 'Warrior training'] },
    place: ['따개비 공방, 대장간 옆 풀밭', 'the green beside the forge in the Barnacle Works'],
    dummies: [[-62.4, 18], [-59.4, 15], [-60.2, 21.6]],
    props: [[-69.6, 18.4, Math.PI / 2], [-64.2, 11.6, 0.4]],
    greeting: ['어서 와! 나는 따개비 공방의 전사 교관 그론이다. 전사는 칼과 방패로 바짝 붙어 싸우고, 때리고 맞을 때마다 분노를 모아 기술에 쓰지.', 'Welcome! I am Gron, warrior trainer of the Barnacle Works. Warriors fight up close with sword and shield, building Rage from every blow given or taken and spending it on skills.'],
    practise: ['옆의 짚 허수아비는 절대 부서지지 않는다. 분노는 처음엔 비어 있으니, 칼로 몇 번 쳐서 모은 다음 기술을 써 봐. 피해 숫자가 튀어 오르고 연습 기록 창이 초당 피해와 가장 큰 한 방을 세어 준다. 경험치와 코인은 없다!', 'The straw dummies beside me never break. Rage starts empty, so land a few sword blows to build it, then use your skills. The numbers fly up and the practice panel counts your damage per second and your biggest hit. No XP or coins here!'],
    other: (cls, name, place) => [`너는 ${roguna(cls[0])}. 이건 네 기술이 아니지만, 함께 싸우는 전사가 무엇을 하는지 알아 두면 좋지. 네 교관은 ${place[0]}에 있는 ${ida(name[0])}.`, `You are a ${cls[1]}, so these are not your skills, but it pays to know what a warrior beside you can do. Your own trainer is ${name[1]}, at ${place[1]}.`],
    tips: {
      'pincer-strike': ['가장 자주 쓰는 기술이다. 준비될 때마다 눌러 분노를 쓰자. 바짝 붙어야 맞는다.', 'Your everyday blow: use it whenever it is ready to spend Rage. Stand close, it is melee.'],
      'shell-bash': ['위험한 적이 휘두르기 전에 2초 동안 기절시켜라. 보스는 1초만 기절한다.', 'Stun a dangerous foe for 2 s before it swings. A boss is stunned for only 1 s.'],
      'sideways-charge': ['2m보다 멀고 14m 안에 있는 적에게 돌진해 싸움을 시작하고 분노 15를 얻는다.', 'Open a fight on a foe 2 to 14 m away: you dash in and gain 15 Rage.'],
      whirlpool: ['적 여럿 사이에서 돌면 3.2m 안의 모두가 맞고 밀려난다. 허수아비 두 개 사이에서 해 봐.', 'Spin among several foes: everyone within 3.2 m is hit and pushed back. Try it between two dummies.'],
      'crown-burst': ULTIMATE_TIP,
    },
  },
  {
    cls: 'priest', style: 'stone',
    // The parvis's west half, clear of the way from the great stair to the door and of the cross street at its head.
    trainer: { id: 'tc-trainer-priest', x: -40.4, z: -4.8, yaw: face(-40.4, -4.8, -31, 3.5), spec: { race: 'human', sex: 'female', classId: 'priest', shell: 2, crest: 2, led: 1, name: 'Serena' }, name: ['교관 세레나', 'Serena'], title: ['✚ 사제 교관', '✚ Priest Trainer'], marker: ['사제 훈련', 'Priest training'] },
    place: ['조수 대성당 앞 광장', 'the square before the Cathedral of the Tide'],
    dummies: [[-46.2, -9], [-48, -4.4], [-44.8, -1]],
    props: [[-38.4, -8.2, face(-38.4, -8.2, -31, 3.5)], [-50.2, -11.6, 0.3]],
    greeting: ['조수 대성당에 온 걸 환영해요. 나는 사제 교관 세레나예요. 사제는 거룩한 빛으로 적을 치고, 금 간 껍질을 고치고, 따개비 보호막으로 버텨요.', 'Welcome to the Cathedral of the Tide. I am Serena, the priests’ trainer. Priests smite with holy light, mend cracked shells and hold on behind a barnacle ward.'],
    practise: ['옆의 돌 허수아비는 부서지지 않아요. 어떤 기술로든 쳐 보세요. 피해 숫자가 떠오르고, 연습 기록 창이 초당 피해와 가장 큰 한 방을 세어 줘요. 경험치와 코인은 주지 않아요.', 'The stone dummies beside me never break. Strike them with any skill: the numbers rise and the practice panel counts your damage per second and your biggest hit. They give no XP or coins.'],
    other: (cls, name, place) => [`당신은 ${gunyo(cls[0])}. 사제 기술은 당신 것이 아니지만, 곁에서 싸우는 사제가 무엇을 하는지 알면 큰 도움이 돼요. 당신의 교관은 ${place[0]}에 있는 ${yeyo(name[0])}.`, `You are a ${cls[1]}, so these are not your skills, but knowing what a priest beside you can do helps a great deal. Your own trainer is ${name[1]}, at ${place[1]}.`],
    tips: {
      smite: ['주 공격이에요. 1.5초 동안 시전하고 24m까지 닿아요. 움직이면 시전이 끊기니 멈춰 서세요.', 'Your main attack: a 1.5 s cast that reaches 24 m. Moving breaks the cast, so stand still.'],
      'mend-shell': ['최대 체력의 35%를 회복하고 12m 안의 친구도 함께 고쳐요. 체력이 바닥나기 전에 미리 쓰세요.', 'Heals 35% of your health, and friends within 12 m too. Cast it before your health runs low.'],
      'barnacle-ward': ['10초 동안 피해를 막아 주는 보호막이에요. 큰 공격이 오기 직전에 세우세요.', 'A shield that soaks damage for 10 s. Raise it just before a big hit lands.'],
      'holy-tide': ['6m 안의 적을 치고 나를 회복해요. 적이 가까이 붙었을 때 쓰세요.', 'Hits foes within 6 m and heals you: use it when they close in.'],
      'crown-burst': ULTIMATE_TIP,
    },
  },
  {
    cls: 'mage', style: 'glass',
    // The lawn between the great tower and the city wall, north of Glass Street; far from the portal and Opal.
    trainer: { id: 'tc-trainer-mage', x: -78.5, z: -116.5, yaw: face(-78.5, -116.5, -72, -109), spec: { race: 'nightelf', sex: 'male', classId: 'mage', shell: 0, crest: 1, led: 0, name: 'Azur' }, name: ['교관 아주르', 'Azur'], title: ['✦ 마법사 교관', '✦ Mage Trainer'], marker: ['마법사 훈련', 'Mage training'] },
    place: ['바다유리 구역, 큰 탑 서쪽 잔디밭', 'the lawn west of the great tower in the Seaglass Quarter'],
    dummies: [[-83.5, -121.5], [-87.5, -118.6], [-86.8, -125.6]],
    props: [[-90.6, -128.4, 0.2], [-80.6, -125.2, 1.1]],
    greeting: ['바다유리 구역에 잘 왔어요. 나는 마법사 교관 아주르예요. 마법사는 바다유리 지팡이로 물과 증기, 서리를 다뤄요. 가까이 붙으면 약하니 거리를 지키는 게 중요하죠.', 'Welcome to the Seaglass Quarter. I am Azur, the mages’ trainer. Mages bend water, steam and frost through a sea-glass staff. You are fragile up close, so keep your distance.'],
    practise: ['옆의 바다유리 허수아비는 깨지지 않아요. 어떤 주문이든 걸어 보세요. 피해 숫자가 떠오르고, 연습 기록 창이 초당 피해와 가장 큰 한 방을 세어 줘요. 경험치와 코인은 주지 않아요.', 'The sea-glass dummies beside me never shatter. Cast any spell at them: the numbers rise and the practice panel counts your damage per second and your biggest hit. They give no XP or coins.'],
    other: (cls, name, place) => [`당신은 ${gunyo(cls[0])}. 마법사 주문은 당신 것이 아니지만, 함께 싸우는 마법사가 무엇을 하는지 알아 두면 좋아요. 당신의 교관은 ${place[0]}에 있는 ${yeyo(name[0])}.`, `You are a ${cls[1]}, so these are not your spells, but it is good to know what a mage beside you can do. Your own trainer is ${name[1]}, at ${place[1]}.`],
    tips: {
      'bubble-bolt': ['가장 센 한 방이에요. 1.5초 시전하고 24m까지 닿아요. 시전하는 동안 움직이지 마세요.', 'Your strongest single hit: a 1.5 s cast from up to 24 m. Do not move while casting.'],
      'frost-spray': ['앞쪽 8m 부채꼴에 서리를 뿜어요. 적을 바라보고 쓰면 4초 동안 느려져요.', 'A cone of frost 8 m ahead: face your foe, and it is slowed for 4 s.'],
      'steam-blink': ['앞으로 8m 순간이동하고 HP 10을 회복해요. 적이 붙으면 빠져나올 때 쓰세요.', 'Teleports you 8 m forward and heals 10 HP: your way out when foes close in.'],
      'tidal-nova': ['6m 안의 적을 치고 밀어내며 잠깐 멈추게 해요. 그다음 점멸로 거리를 벌리세요.', 'Hits foes within 6 m, knocks them back and stops them briefly: then blink away.'],
      'crown-burst': ULTIMATE_TIP,
    },
  },
];

/** Window of the damage per second, and the pause after which a dummy refills. */
const DPS_WINDOW = 5;
const REFILL_AFTER = 4;
/** Within this of a yard's middle its practice panel stays up. */
const PANEL_RANGE = 28;
const DUMMY_RADIUS = 0.5;
const DUMMY_HEIGHT = 1.62;

// ------------------------------------------------------------------------------------------------ the dummies' models

type Mat = 'matte' | 'metal' | 'glow';
interface Place { p?: readonly [number, number, number]; r?: readonly [number, number, number]; s?: readonly [number, number, number] }
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3();
/** A stable 0..1 for a face, so a colour's grain is the same on every build. */
const grain = (n: number) => { const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };

/** Pieces gathered per material, each with its colour (per face, `jitter` of brightness), merged into one mesh each. */
class Parts {
  private readonly lists = new Map<Mat, THREE.BufferGeometry[]>();
  private faces = 0;
  add(mat: Mat, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, at: Place = {}, jitter = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m4.compose(p4.set(...(at.p ?? [0, 0, 0])), q4.setFromEuler(e4.set(...(at.r ?? [0, 0, 0]))), s4.set(...(at.s ?? [1, 1, 1]))));
    const n = g.attributes.position.count, c = new THREE.Color(color), out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = jitter ? 1 + (grain(this.faces + Math.floor(i / 3)) - 0.5) * jitter : 1;
      out[i * 3] = c.r * k; out[i * 3 + 1] = c.g * k; out[i * 3 + 2] = c.b * k;
    }
    this.faces += n / 3;
    g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    const list = this.lists.get(mat) ?? [];
    list.push(g);
    this.lists.set(mat, list);
    return this;
  }
  /** Hands this one's `mat` pieces to `out`, placed by `at`. */
  moveTo(mat: Mat, out: Parts, at: THREE.Matrix4): void {
    const list = this.lists.get(mat);
    if (!list) return;
    for (const g of list) g.applyMatrix4(at);
    out.lists.set(mat, [...(out.lists.get(mat) ?? []), ...list]);
    this.lists.delete(mat);
  }
  meshes(mats: Record<Mat, THREE.Material>, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.lists) {
      const mesh = new THREE.Mesh(mergeGeometries(list)!, mats[mat]);
      for (const g of list) g.dispose();
      mesh.name = `${name}-${mat}`;
      mesh.castShadow = mesh.receiveShadow = true;
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

const PALETTE: Record<Style, { base: string; post: string; shell: string; band: string; claw: string; trim: string; mark: [string, string] }> = {
  straw: { base: '#6e4a2a', post: '#8a5d34', shell: '#d8b257', band: '#a87e4c', claw: '#b88c4e', trim: '#4a4d52', mark: ['#b3261e', '#efe1c0'] },
  stone: { base: '#d6ccb6', post: '#c9973c', shell: '#d9d1bf', band: '#d4a446', claw: '#cdc4af', trim: '#c9973c', mark: ['#f4e3a6', '#d4a446'] },
  glass: { base: '#46525e', post: '#c9973c', shell: '#5fd4c6', band: '#d4a446', claw: '#8ef0e2', trim: '#c9973c', mark: ['#c8fff6', '#d4a446'] },
};

function styleMaterials(style: Style): Record<Mat, THREE.MeshStandardMaterial> {
  return {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: style === 'stone' ? 0.72 : 0.86, metalness: 0, flatShading: style === 'straw' }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: style === 'straw' ? 0.5 : 0.3, metalness: style === 'straw' ? 0.75 : 0.95 }),
    glow: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.14, metalness: 0.12, flatShading: true,
      emissive: style === 'stone' ? '#fff2d8' : '#1fb8aa', emissiveIntensity: style === 'stone' ? 0.45 : 0.5,
    }),
  };
}

/** The static foot of a dummy (it stays put while the rest sways), in the dummy's own frame. */
function dummyBase(style: Style, out: Parts, at: THREE.Matrix4): void {
  const c = PALETTE[style], local = new Parts();
  if (style === 'straw') {
    // A log stump bound with iron, straw scattered round it.
    local.add('matte', new THREE.CylinderGeometry(0.27, 0.32, 0.3, 11), c.base, { p: [0, 0.15, 0] }, 0.25);
    local.add('matte', new THREE.CylinderGeometry(0.255, 0.255, 0.012, 11), '#b98d5a', { p: [0, 0.305, 0] }, 0.15);
    for (const y of [0.07, 0.23]) local.add('metal', new THREE.TorusGeometry(0.29 - y * 0.12, 0.018, 5, 18), c.trim, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = 0.4 + grain(i) * 0.3;
      local.add('matte', new THREE.BoxGeometry(0.02, 0.012, 0.22), '#e2c171', { p: [Math.cos(a) * r, 0.01, Math.sin(a) * r], r: [0, a * 1.7, 0] }, 0.3);
    }
  } else if (style === 'stone') {
    // An octagonal plinth with a brass ring and a step.
    local.add('matte', new THREE.CylinderGeometry(0.42, 0.46, 0.08, 8), c.base, { p: [0, 0.04, 0] }, 0.1);
    local.add('matte', new THREE.CylinderGeometry(0.3, 0.36, 0.24, 8), c.base, { p: [0, 0.2, 0] }, 0.1);
    local.add('metal', new THREE.TorusGeometry(0.315, 0.02, 6, 24), c.trim, { p: [0, 0.27, 0], r: [Math.PI / 2, 0, 0] });
  } else {
    // A slate plinth set in a brass rune ring with glowing studs.
    local.add('matte', new THREE.CylinderGeometry(0.28, 0.34, 0.24, 12), c.base, { p: [0, 0.12, 0] }, 0.18);
    local.add('metal', new THREE.TorusGeometry(0.62, 0.025, 5, 40), c.trim, { p: [0, 0.015, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.4] });
    local.add('metal', new THREE.TorusGeometry(0.29, 0.018, 5, 24), c.trim, { p: [0, 0.24, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      local.add('glow', new THREE.OctahedronGeometry(0.05, 0), '#7ff5e6', { p: [Math.cos(a) * 0.62, 0.03, Math.sin(a) * 0.62], s: [1, 0.6, 1] });
    }
  }
  for (const mat of ['matte', 'metal', 'glow'] as const) local.moveTo(mat, out, at);
}

/** Where the body's sockets sit above the pivot: the top of the body, and the mark's height. */
const TOP: Record<Style, number> = { straw: 1.44, stone: 1.3, glass: 1.3 };

/**
 * The swaying part, from the pivot up: post, body, claws on a crossbar, eyes and the mark. The Works' dummy is an
 * upright burlap sack stuffed with straw and tied at the neck; the Cathedral's and the Seaglass dummies wear a crab
 * shell of carved stone or faceted sea-glass, belted in brass.
 */
function dummyBody(style: Style): Parts {
  const c = PALETTE[style], parts = new Parts(), shellMat: Mat = style === 'glass' ? 'glow' : 'matte', postMat: Mat = style === 'straw' ? 'matte' : 'metal';
  const Y = 0.98;
  parts.add(postMat, new THREE.CylinderGeometry(0.05, 0.062, 1.32, 8), c.post, { p: [0, 0.66, 0] }, 0.2);
  if (style === 'straw') {
    const sack = [[0, 0.5], [0.2, 0.52], [0.31, 0.6], [0.35, 0.76], [0.34, 0.96], [0.29, 1.12], [0.19, 1.24], [0.12, 1.29], [0.14, 1.33], [0.09, 1.39], [0, 1.41]];
    parts.add('matte', new THREE.LatheGeometry(sack.map(([r, y]) => new THREE.Vector2(r, y)), 13), c.shell, {}, 0.36);
    // Rope at the neck and round the belly, straw sprouting from the top and poking out below.
    parts.add('metal', new THREE.TorusGeometry(0.135, 0.028, 5, 14), c.band, { p: [0, 1.29, 0], r: [Math.PI / 2, 0, 0] });
    parts.add('metal', new THREE.TorusGeometry(0.345, 0.024, 5, 22), c.band, { p: [0, 0.72, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + grain(i) * 0.4, lean = 0.35 + grain(i + 3) * 0.5;
      parts.add('matte', new THREE.ConeGeometry(0.024, 0.2 + grain(i + 7) * 0.12, 4), '#ecd082', { p: [Math.cos(a) * 0.05, 1.47, Math.sin(a) * 0.05], r: [Math.sin(a) * lean, 0, -Math.cos(a) * lean] }, 0.3);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      parts.add('matte', new THREE.ConeGeometry(0.02, 0.14, 4), '#ecd082', { p: [Math.cos(a) * 0.22, 0.47, Math.sin(a) * 0.22], r: [Math.PI + Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] }, 0.3);
    }
    // Two stitched button eyes.
    for (const side of [-1, 1]) parts.add('metal', new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), '#2a2420', { p: [side * 0.1, 1.13, 0.27], r: [Math.PI / 2 - 0.5, 0, 0] });
  } else {
    // The shell: a wide low dome, faceted glass on the Seaglass dummies.
    const shell = style === 'glass' ? new THREE.IcosahedronGeometry(1, 1) : new THREE.SphereGeometry(1, 16, 11);
    parts.add(shellMat, shell, c.shell, { p: [0, Y, 0], s: [0.46, 0.3, 0.38] }, style === 'stone' ? 0.1 : 0.22);
    parts.add('metal', new THREE.TorusGeometry(1, 0.075, 6, 28), c.band, { p: [0, Y - 0.03, 0], r: [Math.PI / 2, 0, 0], s: [0.455, 0.375, 0.5] });
  }
  if (style === 'stone') {
    // Carved scallop ribs and a brass halo over the shell.
    for (let i = -2; i <= 2; i++) parts.add('matte', new THREE.SphereGeometry(1, 8, 6), '#c7bea9', { p: [i * 0.13, Y + 0.17, -0.02], r: [0, 0, i * -0.32], s: [0.05, 0.13, 0.3] }, 0.08);
    parts.add('metal', new THREE.TorusGeometry(0.24, 0.018, 6, 30), c.trim, { p: [0, Y + 0.48, 0], r: [Math.PI / 2 - 0.25, 0, 0] });
    parts.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), c.trim, { p: [0, Y + 0.37, -0.03] });
  } else if (style === 'glass') {
    // A brass meridian band, and a sea-glass shard above on a brass prong.
    parts.add('metal', new THREE.TorusGeometry(1, 0.06, 6, 24), c.band, { p: [0, Y, 0], r: [0, Math.PI / 2, 0], s: [0.31, 0.31, 0.5] });
    parts.add('metal', new THREE.CylinderGeometry(0.012, 0.018, 0.22, 5), c.trim, { p: [0, Y + 0.38, 0] });
    parts.add('glow', new THREE.OctahedronGeometry(0.09, 0), '#b8fff4', { p: [0, Y + 0.56, 0], s: [0.8, 1.5, 0.8] });
  }
  // The crossbar and its two claws.
  parts.add(postMat, new THREE.CylinderGeometry(0.032, 0.032, 1.36, 6), c.post, { p: [0, Y - 0.04, 0.02], r: [0, 0, Math.PI / 2] }, 0.2);
  parts.add('metal', new THREE.BoxGeometry(0.13, 0.13, 0.13), c.trim, { p: [0, Y - 0.04, 0.02] });
  for (const side of [-1, 1]) {
    const x = side * 0.7, clawMat: Mat = style === 'glass' ? 'glow' : 'matte';
    if (style === 'glass') {
      parts.add(clawMat, new THREE.OctahedronGeometry(0.13, 0), c.claw, { p: [x, Y, 0.06], s: [0.9, 0.7, 1.3] });
      parts.add(clawMat, new THREE.OctahedronGeometry(0.08, 0), c.claw, { p: [x + side * 0.03, Y + 0.08, 0.24], r: [-0.4, 0, 0], s: [0.7, 0.6, 1.8] });
    } else {
      parts.add(clawMat, new THREE.SphereGeometry(0.13, 9, 7), c.claw, { p: [x, Y - 0.02, 0.06], s: [0.95, 0.8, 1.25] }, style === 'straw' ? 0.35 : 0.08);
      parts.add(clawMat, new THREE.ConeGeometry(0.07, 0.3, 7), c.claw, { p: [x, Y + 0.06, 0.26], r: [Math.PI / 2 - 0.3, 0, 0] }, style === 'straw' ? 0.35 : 0.08);
      parts.add(clawMat, new THREE.ConeGeometry(0.052, 0.2, 7), c.claw, { p: [x, Y - 0.08, 0.22], r: [Math.PI / 2 + 0.35, 0, 0] }, style === 'straw' ? 0.35 : 0.08);
    }
    parts.add('metal', new THREE.TorusGeometry(0.06, 0.016, 5, 12), c.trim, { p: [x - side * 0.1, Y - 0.04, 0.02], r: [0, Math.PI / 2, 0] });
    if (style === 'straw') continue;
    // The eyes on short stalks.
    parts.add(postMat, new THREE.CylinderGeometry(0.018, 0.022, 0.12, 5), c.post, { p: [side * 0.1, Y + 0.3, 0.16] });
    parts.add('metal', new THREE.SphereGeometry(0.045, 8, 6), c.trim, { p: [side * 0.1, Y + 0.37, 0.16] });
  }
  // The mark on the front: painted rings on the sack, a brass sun, or a glowing rune in a brass ring.
  const fz = 0.36;
  if (style === 'straw') {
    [0.2, 0.15, 0.1, 0.05].forEach((r, i) => parts.add('matte', new THREE.CircleGeometry(r, 22), c.mark[i % 2 ? 1 : 0], { p: [0, 0.86, 0.349 + i * 0.003], r: [-0.04, 0, 0] }));
  } else if (style === 'stone') {
    parts.add('metal', new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), c.mark[1], { p: [0, Y - 0.02, fz], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 8; i++) parts.add('metal', new THREE.BoxGeometry(0.03, 0.09, 0.015), c.mark[1], { p: [Math.sin((i / 8) * Math.PI * 2) * 0.2, Y - 0.02 + Math.cos((i / 8) * Math.PI * 2) * 0.2, fz - 0.005], r: [0, 0, -(i / 8) * Math.PI * 2] });
    parts.add('glow', new THREE.CircleGeometry(0.075, 18), c.mark[0], { p: [0, Y - 0.02, fz + 0.017] });
  } else {
    parts.add('metal', new THREE.TorusGeometry(0.15, 0.022, 6, 24), c.mark[1], { p: [0, Y - 0.02, fz + 0.02] });
    parts.add('glow', new THREE.CircleGeometry(0.12, 6), c.mark[0], { p: [0, Y - 0.02, fz + 0.015] });
  }
  return parts;
}

// The pieces of a prop beside a trainer, in its own frame.
function prop(style: Style, which: number, out: Parts, at: THREE.Matrix4): void {
  const local = new Parts();
  if (style === 'straw' && which === 0) {
    // A weapon rack: practice swords and a round shield.
    for (const x of [-0.75, 0.75]) local.add('matte', new THREE.BoxGeometry(0.09, 1.15, 0.09), '#7a5230', { p: [x, 0.575, 0] }, 0.2);
    local.add('matte', new THREE.BoxGeometry(1.7, 0.08, 0.1), '#7a5230', { p: [0, 1.0, 0] }, 0.2).add('matte', new THREE.BoxGeometry(1.7, 0.06, 0.08), '#7a5230', { p: [0, 0.32, 0] }, 0.2);
    for (let i = 0; i < 3; i++) {
      const x = -0.42 + i * 0.36;
      local.add('matte', new THREE.BoxGeometry(0.06, 0.95, 0.025), '#b48a58', { p: [x, 0.62, 0.08], r: [0.18, 0, 0] }, 0.15);
      local.add('metal', new THREE.BoxGeometry(0.2, 0.035, 0.05), '#4a4d52', { p: [x, 0.92, 0.12], r: [0.18, 0, 0] });
    }
    local.add('matte', new THREE.CylinderGeometry(0.3, 0.3, 0.05, 18), '#8e2a22', { p: [0.52, 0.62, 0.12], r: [Math.PI / 2 - 0.2, 0, 0] }, 0.1);
    local.add('metal', new THREE.TorusGeometry(0.3, 0.025, 5, 20), '#4a4d52', { p: [0.52, 0.62, 0.14], r: [-0.2, 0, 0] });
    local.add('metal', new THREE.SphereGeometry(0.07, 8, 6), '#c9973c', { p: [0.52, 0.62, 0.17] });
  } else if (style === 'straw') {
    // Two straw bales, bound with rope.
    for (const [x, y, r] of [[0, 0.26, 0], [0.18, 0.78, 0.5]] as const) {
      local.add('matte', new THREE.BoxGeometry(1.0, 0.5, 0.6), '#d4ae55', { p: [x, y, 0], r: [0, r, 0] }, 0.45);
      for (const dx of [-0.25, 0.25]) local.add('matte', new THREE.BoxGeometry(0.05, 0.52, 0.62), '#9c7444', { p: [x + Math.cos(r) * dx, y, -Math.sin(r) * dx], r: [0, r, 0] });
    }
  } else if (style === 'stone' && which === 0) {
    // A lectern with the priests' hymnal open on it.
    local.add('matte', new THREE.CylinderGeometry(0.2, 0.28, 0.12, 8), '#d6ccb6', { p: [0, 0.06, 0] }, 0.1);
    local.add('matte', new THREE.CylinderGeometry(0.09, 0.13, 0.9, 8), '#d6ccb6', { p: [0, 0.57, 0] }, 0.1);
    local.add('metal', new THREE.BoxGeometry(0.62, 0.04, 0.44), '#c9973c', { p: [0, 1.06, 0], r: [0.35, 0, 0] });
    for (const s of [-1, 1]) local.add('matte', new THREE.BoxGeometry(0.27, 0.04, 0.36), '#f1e6c8', { p: [s * 0.14, 1.1, 0.01], r: [0.35, 0, s * -0.08] }, 0.05);
    local.add('matte', new THREE.BoxGeometry(0.02, 0.012, 0.34), '#8e2a22', { p: [0, 1.11, 0.02], r: [0.35, 0, 0] });
  } else if (style === 'stone') {
    // A font of tide water: a stone bowl on a column, brass-rimmed.
    local.add('matte', new THREE.CylinderGeometry(0.3, 0.34, 0.1, 8), '#d6ccb6', { p: [0, 0.05, 0] }, 0.1);
    local.add('matte', new THREE.CylinderGeometry(0.1, 0.14, 0.62, 8), '#d6ccb6', { p: [0, 0.4, 0] }, 0.1);
    const bowl = [[0.06, 0.66], [0.2, 0.7], [0.36, 0.8], [0.44, 0.94], [0.42, 0.96], [0.34, 0.86], [0, 0.84]];
    local.add('matte', new THREE.LatheGeometry(bowl.map(([r, y]) => new THREE.Vector2(r, y)), 16), '#d9d1bf', {}, 0.08);
    local.add('metal', new THREE.TorusGeometry(0.43, 0.02, 5, 28), '#c9973c', { p: [0, 0.955, 0], r: [Math.PI / 2, 0, 0] });
    local.add('glow', new THREE.CircleGeometry(0.37, 24), '#4f9fbf', { p: [0, 0.9, 0], r: [-Math.PI / 2, 0, 0] });
  } else {
    // A cluster of sea-glass shards on a slate rock.
    local.add('matte', new THREE.DodecahedronGeometry(0.42, 0), '#4a5560', { p: [0, 0.12, 0], s: [1.3, 0.55, 1] }, 0.25);
    const shards: [number, number, number, number, number][] = [[0, 0.62, 0, 0, 1.1], [0.24, 0.48, 0.08, 0.35, 0.8], [-0.22, 0.46, -0.06, -0.4, 0.75], [0.06, 0.4, -0.24, 0.2, 0.6], [-0.1, 0.38, 0.22, -0.25, 0.55]];
    for (const [x, y, z, tilt, s] of shards) local.add('glow', new THREE.OctahedronGeometry(0.16, 0), which ? '#9ff7ea' : '#6fe0d4', { p: [x, y, z], r: [tilt * 0.5, tilt, tilt], s: [0.55 * s, 2.2 * s, 0.55 * s] });
  }
  for (const mat of ['matte', 'metal', 'glow'] as const) local.moveTo(mat, out, at);
}

/** A small painted portrait for the target frame. */
function portrait(style: Style): string {
  const c = PALETTE[style];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><radialGradient id="b" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="${style === 'glass' ? '#24474d' : style === 'stone' ? '#4d4535' : '#4a3a22'}"/><stop offset="1" stop-color="#11100d"/></radialGradient></defs><rect width="96" height="96" fill="url(#b)"/><rect x="45" y="50" width="6" height="46" fill="${c.post}"/><rect x="14" y="52" width="68" height="5" rx="2" fill="${c.post}"/><ellipse cx="17" cy="52" rx="9" ry="8" fill="${c.claw}"/><ellipse cx="79" cy="52" rx="9" ry="8" fill="${c.claw}"/><circle cx="40" cy="28" r="4" fill="${style === 'straw' ? '#2a2420' : c.trim}"/><circle cx="56" cy="28" r="4" fill="${style === 'straw' ? '#2a2420' : c.trim}"/><ellipse cx="48" cy="52" rx="27" ry="19" fill="${c.shell}"/><ellipse cx="48" cy="54" rx="27" ry="4" fill="${c.band}"/><circle cx="48" cy="52" r="10" fill="${c.mark[1]}"/><circle cx="48" cy="52" r="6.5" fill="${c.mark[0]}"/><circle cx="48" cy="52" r="3" fill="${c.mark[1]}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ------------------------------------------------------------------------------------------------ a dummy

const idleMotion = (): MotionController => ({ setLocomotion() {}, play() {}, stop() {}, action: null, update() {}, dispose() {} });

/** A dummy's rig: the crab contract over a swaying body, sockets on it, and a white flash for the game's hit tint. */
function dummyRig(style: Style, mats: Record<Mat, THREE.MeshStandardMaterial>): CrabRig & { pivot: THREE.Group } {
  const root = new THREE.Group(), pivot = new THREE.Group(), glows = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  root.name = `training-dummy-${style}`;
  pivot.position.y = style === 'straw' ? 0.3 : style === 'stone' ? 0.3 : 0.24;
  root.add(pivot);
  // The body's own materials (a flash lights them and no other dummy).
  const own = { matte: mats.matte.clone(), metal: mats.metal.clone(), glow: mats.glow.clone() };
  for (const m of Object.values(own)) glows.set(m, m.emissive.clone());
  for (const mesh of dummyBody(style).meshes(own, root.name)) pivot.add(mesh);
  const sockets = {} as Record<SocketName, THREE.Object3D>;
  const top = TOP[style], mid = style === 'straw' ? 0.86 : 0.96;
  const at: Record<SocketName, [number, number, number]> = { head: [0, top, 0], face: [0, mid, 0.4], back: [0, mid, -0.38], clawL: [0.7, 0.96, 0.25], clawR: [-0.7, 0.96, 0.25], nameplate: [0, top + 0.34, 0], chest: [0, mid, 0.38] };
  for (const name of Object.keys(at) as SocketName[]) {
    const s = new THREE.Object3D();
    s.position.set(...at[name]);
    pivot.add(s);
    sockets[name] = s;
  }
  const spec: CrabSpec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Training Dummy' };
  return {
    root, body: pivot, pivot, spec, metersToUnits: 1,
    face: {
      setExpression() {},
      setTint(color) {
        for (const [m, base] of glows) {
          if (color === null) m.emissive.copy(base);
          else m.emissive.set(color).multiplyScalar(0.35).add(base);
        }
      },
    },
    setJoint() {}, setPose() {}, getSocket: (n) => sockets[n], async applySpec() {}, update() {},
    dispose() {
      root.removeFromParent();
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      for (const m of Object.values(own)) m.dispose();
    },
  };
}

class Dummy implements CombatController {
  readonly unit: Unit;
  readonly rig: ReturnType<typeof dummyRig>;
  /** Lean (radians) about the dummy's own x and z, and how fast it swings. */
  private readonly lean = new THREE.Vector2();
  private readonly swing = new THREE.Vector2();

  constructor(private readonly training: TidecrownTraining, readonly yard: number, readonly style: Style, mats: Record<Mat, THREE.MeshStandardMaterial>) {
    this.rig = dummyRig(style, mats);
    const u = new Unit(DUMMY_NAME[style][0], 'scrapling', 'hostile', this.rig, idleMotion());
    u.ctrl = this;
    u.npcId = `tc-dummy-${style}`;
    u.height = DUMMY_HEIGHT;
    u.radius = DUMMY_RADIUS;
    u.portrait = portrait(style);
    u.hidden = true;
    this.unit = u;
  }

  /** Health sized to the player's damage (about two minutes of a level's skills to empty), and full. */
  refill(): void {
    const u = this.unit;
    u.maxHp = u.hp = Math.max(1000, Math.round((1500 * this.training.g.player.dmgMul) / 100) * 100);
  }

  /** Every hit lands here, never in the shared combat: the dummy wraps round instead of dying. */
  practice(src: Unit | null, amount: number, o: HitOptions): number {
    const u = this.unit, g = this.training.g;
    if (!u.alive || u.hidden || !Number.isFinite(amount)) return 0;
    const now = g.time, dmg = Math.max(1, Math.round(Math.min(amount, Number.MAX_SAFE_INTEGER)));
    if (src) src.lastCombat = now;
    u.lastCombat = now;
    u.hp = u.hp - dmg > 0 ? u.hp - dmg : u.maxHp;
    g.events.emit({ type: 'damage', src, dst: u, amount: dmg, crit: !!o.crit, school: o.school });
    if (src?.kind === 'player' && o.rage) (src.ctrl as CombatController | null)?.gainRage?.(o.rage);
    this.knock(src, Math.min(1, 0.45 + dmg / Math.max(1, u.maxHp) * 8) * (o.crit ? 1.5 : 1));
    if (src === g.player.unit) this.training.counted(this, dmg, !!o.crit);
    return dmg;
  }

  /** A swing away from the hitter. */
  private knock(src: Unit | null, strength: number): void {
    const u = this.unit;
    let dx = u.pos.x - (src?.pos.x ?? u.pos.x - Math.sin(u.yaw)), dz = u.pos.z - (src?.pos.z ?? u.pos.z - Math.cos(u.yaw));
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Into the dummy's frame: rotating about x moves the top along +z, about z along -x.
    const c = Math.cos(u.yaw), s = Math.sin(u.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c;
    this.swing.x += lz * 2.6 * strength;
    this.swing.y -= lx * 2.6 * strength;
  }

  update(dt: number, now: number): void {
    const u = this.unit, g = this.training.g;
    // A damped spring back to upright.
    const k = 70, damping = 4.2, step = Math.min(dt, 0.05);
    this.swing.x += (-k * this.lean.x - damping * this.swing.x) * step;
    this.swing.y += (-k * this.lean.y - damping * this.swing.y) * step;
    this.lean.x = THREE.MathUtils.clamp(this.lean.x + this.swing.x * step, -0.42, 0.42);
    this.lean.y = THREE.MathUtils.clamp(this.lean.y + this.swing.y * step, -0.42, 0.42);
    this.rig.pivot.rotation.set(this.lean.x, 0, this.lean.y);
    // Pushes and pulls do not move a dummy; a pause refills it, sized to the player.
    u.pushTime = 0;
    u.level = g.player.level;
    if (now - u.lastCombat > REFILL_AFTER && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.6 * dt);
      if (u.hp >= u.maxHp) this.refill();
    }
    if (now < u.slowUntil && !u.culled) g.vfx.chill(u);
    u.name = t(...DUMMY_NAME[this.style]);
    u.updateVisual(dt);
  }
}

const DUMMY_NAME: Record<Style, Text> = {
  straw: ['훈련용 짚 허수아비', 'Straw Training Dummy'],
  stone: ['훈련용 돌 허수아비', 'Stone Training Dummy'],
  glass: ['훈련용 유리 허수아비', 'Glass Training Dummy'],
};

// ------------------------------------------------------------------------------------------------ the practice count

/** This player's hits on the dummies since the last reset. */
export class PracticeMeter {
  total = 0;
  hits = 0;
  biggest = 0;
  biggestCrit = false;
  /** The first hit since the reset, the start of the current run of hits (a pause longer than the window starts a new
   *  one), and the last hit. */
  private first = -1;
  private from = -1;
  private last = -1;
  private readonly recent: { at: number; amount: number }[] = [];

  add(now: number, amount: number, crit: boolean): void {
    if (this.first < 0) this.first = now;
    if (this.last < 0 || now - this.last > DPS_WINDOW) this.from = now;
    this.last = now;
    this.total += amount;
    this.hits++;
    if (amount > this.biggest) { this.biggest = amount; this.biggestCrit = crit; }
    this.recent.push({ at: now, amount });
  }

  /** Damage per second over the last DPS_WINDOW seconds (over the run so far while it is shorter, at least a second). */
  dps(now: number): number {
    while (this.recent.length && now - this.recent[0].at > DPS_WINDOW) this.recent.shift();
    if (!this.recent.length) return 0;
    const sum = this.recent.reduce((n, r) => n + r.amount, 0);
    return sum / THREE.MathUtils.clamp(now - this.from, 1, DPS_WINDOW);
  }

  /** Seconds from the first hit since the reset to the last. */
  get span(): number { return this.hits ? this.last - this.first : 0; }

  reset(): void {
    this.total = this.hits = this.biggest = 0;
    this.biggestCrit = false;
    this.first = this.from = this.last = -1;
    this.recent.length = 0;
  }
}

class PracticePanel {
  readonly el: HTMLElement;
  private readonly title = h('span', { class: 'practice-title' });
  private readonly reset: HTMLButtonElement;
  private readonly dps = h('b');
  private readonly dpsLabel = h('span');
  private readonly rows = h('div', { class: 'practice-rows' });
  private key = '';

  constructor(onReset: () => void) {
    this.reset = h('button', { class: 'practice-reset', type: 'button', onclick: () => onReset() });
    this.el = h('div', { class: 'practice hud-plate hud-i hidden', role: 'status', 'aria-live': 'off' },
      h('div', { class: 'practice-head' }, this.title, this.reset),
      h('div', { class: 'practice-dps' }, this.dps, this.dpsLabel),
      this.rows);
  }

  show(on: boolean): void { this.el.classList.toggle('hidden', !on); }

  render(m: PracticeMeter, now: number): void {
    const n = (v: number) => Math.round(v).toLocaleString(), dps = m.dps(now), span = Math.round(m.span);
    const key = `${language()}|${m.total}|${m.hits}|${m.biggest}|${m.biggestCrit}|${dps.toFixed(1)}|${span}`;
    if (key === this.key) return;
    this.key = key;
    this.title.textContent = t('🎯 연습 기록', '🎯 Practice');
    this.reset.textContent = t('초기화', 'Reset');
    this.dps.textContent = dps.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    this.dpsLabel.textContent = t(`초당 피해 · 최근 ${DPS_WINDOW}초`, `damage per second · last ${DPS_WINDOW} s`);
    const row = (label: string, value: string, cls = '') => [h('span', null, label), h('b', { class: cls }, value)];
    this.rows.replaceChildren(
      ...row(t('총 피해', 'Total damage'), n(m.total), 'practice-total'),
      ...row(t('가장 큰 한 방', 'Biggest hit'), m.hits ? `${n(m.biggest)}${m.biggestCrit ? t(' 치명타', ' crit') : ''}` : '-', 'practice-biggest'),
      ...row(t('타격 · 시간', 'Hits · time'), `${m.hits.toLocaleString()} · ${Math.floor(span / 60)}:${String(span % 60).padStart(2, '0')}`, 'practice-hits'),
    );
  }
}

// ------------------------------------------------------------------------------------------------ the yards

interface BuiltYard { readonly def: TrainingYard; readonly group: THREE.Group; readonly centre: THREE.Vector3; readonly mats: Record<Mat, THREE.MeshStandardMaterial> }

export class TidecrownTraining {
  private readonly trainers: Keeper[] = [];
  private readonly yards: BuiltYard[] = [];
  private readonly dummies: Dummy[] = [];
  /** The dummies' units while shown (the same array throughout; empty while away). */
  private readonly live: Unit[] = [];
  private shown = false;
  readonly meter = new PracticeMeter();
  private panel: PracticePanel | null = null;
  /** The yard the practice panel belongs to, or -1 while it is down. */
  private practising = -1;
  private readonly cam = new THREE.Vector3();

  constructor(readonly g: Game, keepers: TidecrownKeepers) {
    TRAINING_YARDS.forEach((y, i) => {
      const k = y.trainer;
      this.trainers.push(keepers.add({
        id: k.id, x: k.x, z: k.z, yaw: k.yaw, spec: k.spec, name: k.name, title: k.title, marker: k.marker, scale: 1.12,
        prompt: () => t(`${k.name[0]}에게 말 걸기 · ${CLASS_TITLE[y.cls][0]} 기술 배우기`, `Talk to ${k.name[1]} · ${CLASS_TITLE[y.cls][1]} skills`),
        talk: () => this.talk(i),
      }));
    });
  }

  /** The dummies a skill, a click or Tab can reach: all of them while the capital is shown, else none. */
  get units(): readonly Unit[] { return this.shown ? this.live : []; }
  /** Every dummy built (for the shader warm-up behind the loading screen). */
  get built(): Unit[] { return this.dummies.map((d) => d.unit); }

  /** Builds the yards once, behind the capital's loading screen: the dummies on the ground and the props beside them. */
  load(island: TidecrownIsland): void {
    if (this.g.serverMode || this.yards.length) return;
    TRAINING_YARDS.forEach((def, i) => {
      const group = new THREE.Group(), mats = styleMaterials(def.style), statics = new Parts(), centre = new THREE.Vector3();
      group.name = `training-yard-${def.cls}`;
      group.visible = false;
      const tx = def.trainer.x, tz = def.trainer.z;
      for (const [x, z] of def.dummies) {
        const d = new Dummy(this, i, def.style, mats), y = island.height(x, z), yaw = yawTo(x, z, tx, tz);
        d.rig.root.position.set(x, y, z);
        d.unit.setYaw(yaw);
        dummyBase(def.style, statics, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, 1)));
        group.add(d.rig.root);
        this.dummies.push(d);
        this.live.push(d.unit);
        centre.x += x / def.dummies.length;
        centre.z += z / def.dummies.length;
      }
      def.props.forEach(([x, z, yaw], k) => prop(def.style, k, statics, new THREE.Matrix4().compose(new THREE.Vector3(x, island.height(x, z), z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, 1))));
      for (const mesh of statics.meshes(mats, group.name)) group.add(mesh);
      centre.y = island.height(centre.x, centre.z);
      island.root.add(group);
      this.yards.push({ def, group, centre, mats });
    });
  }

  show(): void {
    if (this.shown || this.g.serverMode) return;
    this.shown = true;
    for (const y of this.yards) y.group.visible = true;
    for (const d of this.dummies) {
      const u = d.unit;
      u.hidden = false;
      u.alive = true;
      d.refill();
      u.rig.root.visible = true;
      this.g.hud.plates.also.add(u);
    }
  }

  hide(): void {
    this.shown = false;
    for (const y of this.yards) y.group.visible = false;
    for (const d of this.dummies) {
      const u = d.unit;
      if (this.g.player.target === u) this.g.player.setTarget(null);
      u.hidden = true;
      u.rig.root.visible = false;
      u.stunUntil = u.slowUntil = 0;
      this.g.hud.plates.also.delete(u);
    }
    this.openPanel(-1);
  }

  /** A hit of this player's on dummy `d`: counted, and the panel comes up for its yard. */
  counted(d: Dummy, amount: number, crit: boolean): void {
    this.meter.add(this.g.time, amount, crit);
    this.openPanel(d.yard);
  }

  private openPanel(yard: number): void {
    this.practising = yard;
    if (yard >= 0 && !this.panel) {
      this.panel = new PracticePanel(() => { this.meter.reset(); this.g.audio.sfx('sfx-click', { volume: 0.5 }); });
      this.g.hud.root.append(this.panel.el);
    }
    this.panel?.show(yard >= 0);
  }

  /** The trainer's page: the class's skills, with tips and the dummies for its own class, or a friendly pointer. */
  private talk(i: number): void {
    const y = TRAINING_YARDS[i], k = this.trainers[i], u = k.unit, g = this.g, d = g.hud.dialogue;
    if (!u || !this.shown) return;
    k.greet();
    const mine = g.player.cls.id, own = mine === y.cls, cls = CLASS_NAME[y.cls];
    const home = TRAINING_YARDS.find((o) => o.cls === mine);
    const paragraphs = [t(...y.greeting), own ? t(...y.practise) : home ? t(...y.other(CLASS_NAME[mine], home.trainer.name, home.place)) : ''].filter(Boolean);
    d.open({
      unit: u, portraitArt: k.portrait,
      questTitle: `${CLASS_MARK[y.cls]} ${t(`${cls[0]} 기술 다섯 가지`, `The five ${cls[1]} skills`)}`,
      paragraphs,
      extra: this.skillList(y, own),
      buttons: own
        ? [
          { label: t('🎯 허수아비로 연습하기', '🎯 Practise on the dummies'), primary: true, onClick: () => this.practise(i) },
          { label: t('다음에 할게요', 'Later'), onClick: () => d.close() },
        ]
        : [{ label: t('알려 줘서 고마워요', 'Thank you'), primary: true, onClick: () => d.close() }],
    });
  }

  private skillList(y: TrainingYard, own: boolean): HTMLElement {
    const cls = CLASSES[y.cls];
    return h('div', { class: `train-skills${own ? ' own' : ''}` }, ...cls.abilities.map((ab) => {
      const { meta, reach } = abilityFacts(ab, cls.resource), tip = y.tips[ab.id];
      return h('div', { class: 'train-skill', 'data-ability': ab.id },
        h('div', { class: 'train-icon' }, iconEl(ab.id, ab.icon)),
        h('div', { class: 'train-text' },
          h('div', { class: 'train-name' }, h('span', { class: 'train-key' }, String(ab.slot)), abilityName(ab)),
          h('div', { class: 'train-line' }, abilityDescription(ab)),
          h('div', { class: 'train-meta' }, [...meta, reach].join(' · ')),
          own && tip ? h('div', { class: 'train-tip' }, t(...tip)) : null));
    }));
  }

  /** From the trainer's page: the nearest of the yard's dummies becomes the target and the panel comes up. */
  practise(i: number): void {
    const g = this.g, p = g.player.unit;
    g.hud.dialogue.close();
    const near = this.dummies.filter((d) => d.yard === i).sort((a, b) => p.distTo(a.unit) - p.distTo(b.unit))[0];
    if (near) g.player.setTarget(near.unit);
    this.openPanel(i);
  }

  update(dt: number): void {
    if (!this.shown) return;
    const g = this.g, p = g.player.unit, camera = g.camera.position;
    for (const y of this.yards) y.group.visible = this.cam.copy(camera).distanceTo(y.centre) < 120;
    for (const d of this.dummies) {
      const u = d.unit;
      u.culled = !this.yards[d.yard].group.visible || camera.distanceTo(u.pos) > 90;
      d.update(dt, g.time);
      // The player cannot walk through a dummy (they stay out of the game's own separation, as the keepers do).
      const dx = p.pos.x - u.pos.x, dz = p.pos.z - u.pos.z, dd = Math.hypot(dx, dz), min = p.radius + u.radius * 0.9;
      if (dd < min && dd > 1e-4) { p.pos.x = u.pos.x + (dx / dd) * min; p.pos.z = u.pos.z + (dz / dd) * min; }
    }
    // The panel stays up near the yard it counts, and goes when the player walks away.
    if (this.practising >= 0) {
      const c = this.yards[this.practising]?.centre;
      if (!c || Math.hypot(p.pos.x - c.x, p.pos.z - c.z) > PANEL_RANGE) this.openPanel(-1);
      else this.panel?.render(this.meter, g.time);
    }
  }

  dispose(): void {
    this.hide();
    for (const d of this.dummies) d.unit.dispose();
    for (const y of this.yards) {
      y.group.removeFromParent();
      y.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      for (const m of Object.values(y.mats)) m.dispose();
    }
    this.dummies.length = this.live.length = this.yards.length = 0;
    this.panel?.el.remove();
    this.panel = null;
  }
}
