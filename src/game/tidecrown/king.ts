// The King of Tidecrown, Marinus: a king crab before the ward gate at the head of the King's Stair, looking down it,
// in royal blue under a gold crown (built here, set on his head socket). He gives the kingdom requests
// (kingdomRequests.ts): talking to him shows the one in hand with its progress and reward, or offers the next.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../i18n';
import { TC_AXIS, TC_T, tcAxis } from '../../sim/world/tidecrownGround';
import type { DialogueButton } from '../../ui/hud/questui';
import type { Game } from '../game';
import type { Keeper, TidecrownKeepers } from './keepers';
import { type KingdomRequest, KingdomRequests } from './kingdomRequests';

/** On the stair head between the stair top and the ward gate, beside the gate's passage (|s| < 3) on its east pier,
 *  clear of the way up and through; facing down the stair, as TC_YAW does. */
const [KING_X, KING_Z] = tcAxis(TC_T.stairTop + 2.4, 4.6);
export const KING_POST = { x: KING_X, z: KING_Z, yaw: Math.atan2(-TC_AXIS.ux, -TC_AXIS.uz) } as const;

/** A gold crown with eight points, pearls, red gems and a velvet cap, in the head socket's frame (metres, +Y up). */
function crown(): { piece: THREE.Object3D; top: number } {
  const r = 0.031, band = 0.013, gold: THREE.BufferGeometry[] = [], gems: THREE.BufferGeometry[] = [];
  gold.push(new THREE.LatheGeometry([new THREE.Vector2(r * 0.96, 0), new THREE.Vector2(r * 1.06, 0), new THREE.Vector2(r * 1.06, band * 0.22), new THREE.Vector2(r * 1.02, band * 0.3), new THREE.Vector2(r * 1.03, band), new THREE.Vector2(r * 0.94, band)], 32));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const tall = i % 2 === 0, h = tall ? 0.017 : 0.011;
    gold.push(new THREE.ConeGeometry(0.0062, h, 4).rotateY(Math.PI / 4 - a).translate(s * r * 1.0, band + h / 2 - 0.001, c * r * 1.0));
    gold.push(new THREE.SphereGeometry(tall ? 0.0034 : 0.0027, 8, 6).translate(s * r * 1.0, band + h + 0.0016, c * r * 1.0));
    const g = (a + Math.PI / 8), gc = Math.cos(g), gs = Math.sin(g);
    gems.push(new THREE.OctahedronGeometry(0.0042, 0).scale(1, 1.25, 0.6).rotateY(g).translate(gs * r * 1.07, band * 0.55, gc * r * 1.07));
  }
  // The orb and cross on the cap.
  const capH = r * 0.62;
  gold.push(new THREE.SphereGeometry(0.0046, 10, 8).translate(0, band + capH + 0.003, 0));
  gold.push(new THREE.BoxGeometry(0.0018, 0.0085, 0.0018).translate(0, band + capH + 0.0105, 0));
  gold.push(new THREE.BoxGeometry(0.0062, 0.0018, 0.0018).translate(0, band + capH + 0.0115, 0));
  const piece = new THREE.Group();
  piece.name = 'king-crown';
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = false;
    piece.add(m);
  };
  // Every piece as one non-indexed list per material, so the crown is three draws.
  mesh(mergeGeometries(gold.map((g) => g.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: '#f3c24f', metalness: 1, roughness: 0.26, emissive: '#3b2600', emissiveIntensity: 0.35 }), 'king-crown-gold');
  mesh(mergeGeometries(gems.map((g) => g.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: '#e0203f', metalness: 0.3, roughness: 0.12, emissive: '#5c0414', emissiveIntensity: 0.7, flatShading: true }), 'king-crown-gems');
  mesh(new THREE.SphereGeometry(r * 0.97, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, capH / (r * 0.97), 1).translate(0, band * 0.35, 0), new THREE.MeshStandardMaterial({ color: '#7b1834', roughness: 0.72 }), 'king-crown-velvet');
  for (const g of [...gold, ...gems]) g.dispose();
  // Seated a little into the shell's dome, a size up so it reads from the foot of the stair.
  const scale = 1.3;
  piece.position.y = -0.003;
  piece.scale.setScalar(scale);
  return { piece, top: (band + capH + 0.016) * scale };
}

export class TidecrownKing {
  readonly requests: KingdomRequests;
  private readonly keeper: Keeper;

  constructor(private readonly g: Game, keepers: TidecrownKeepers) {
    this.requests = new KingdomRequests(g);
    this.keeper = keepers.add({
      id: 'tc-king', ...KING_POST,
      spec: { race: 'human', sex: 'male', classId: 'mage', shell: 1, crest: 1, led: 1, name: 'Marinus' },
      name: ['마리너스 왕', 'King Marinus'], title: ['👑 타이드크라운의 왕', '👑 King of Tidecrown'], scale: 1.3, head: crown,
      prompt: () => (this.requests.ready ? t('마리너스 왕에게 말 걸기 · 왕국 의뢰 보고', 'Talk to King Marinus · Report your kingdom request') : t('마리너스 왕에게 말 걸기 · 왕국 의뢰', 'Talk to King Marinus · Kingdom requests')),
      marker: ['왕', 'King'],
      talk: () => this.talk(),
    });
  }

  get unit() { return this.keeper.unit; }

  talk(): void {
    if (!this.keeper.unit) return;
    this.keeper.greet();
    this.page(t('어서 오너라, 용감한 여행자여! 나는 타이드크라운의 왕 마리너스란다.', 'Welcome, brave traveller! I am Marinus, King of Tidecrown.'));
  }

  /** The king's page for where the log stands, after `opening` (his greeting, or his thanks). */
  private page(opening: string): void {
    const u = this.keeper.unit, q = this.requests, d = this.g.hud.dialogue;
    if (!u) return;
    const close = (label: string): DialogueButton => ({ label, primary: true, onClick: () => d.close() });
    const open = (r: KingdomRequest | null, lines: string[], buttons: DialogueButton[]) => d.open({
      unit: u, portraitArt: this.keeper.portrait,
      questTitle: r ? t(`👑 왕국 의뢰 · ${r.title[0]}`, `👑 Kingdom request · ${r.title[1]}`) : t('👑 왕국 의뢰', '👑 Kingdom requests'),
      paragraphs: [opening, ...lines],
      objectives: r ? q.lines(r).map((l) => (l.done ? `✓ ${l.text}` : l.text)) : undefined,
      rewardCoins: r?.coins, rewardXp: r?.xp,
      buttons,
    });
    const current = q.current, offer = q.offer;
    if (current && q.ready) {
      open(current, [t('해냈구나! 약속한 상을 받거라.', 'You have done it! Take the reward I promised.')], [
        { label: t('보상 받기', 'Claim reward'), primary: true, onClick: () => this.turnIn() },
        { label: t('나중에 받을게요', 'Later'), onClick: () => d.close() },
      ]);
    } else if (current) {
      open(current, [t(...current.offer), t('아직 끝나지 않았구나. 힘내거라, 기다리고 있으마!', 'It is not finished yet. Take heart; I shall be waiting!')], [close(t('다녀올게요', 'I am on my way'))]);
    } else if (offer) {
      open(offer, [t(...offer.offer)], [
        { label: t('의뢰 받기', 'Accept'), primary: true, onClick: () => { if (q.accept(offer.id)) this.page(t('고맙구나! 왕국이 너를 믿고 있단다.', 'Thank you! The kingdom is counting on you.')); } },
        { label: t('다음에 할게요', 'Not now'), onClick: () => d.close() },
      ]);
    } else if (q.allDone) {
      open(null, [t('너는 왕국의 부탁을 모두 들어주었구나. 타이드크라운의 영웅이여, 정말 고맙다!', 'You have done every task my kingdom asked of you. Thank you, hero of Tidecrown!')], [close(t('천만에요', 'It was an honour'))]);
    } else {
      const next = q.waiting;
      open(null, [t('지금은 부탁할 일이 없구나.', 'I have no task for you just now.'), next ? q.lockReason(next) : ''].filter(Boolean), [close(t('알겠어요', 'Farewell'))]);
    }
  }

  private turnIn(): void {
    const paid = this.requests.turnIn();
    if (!paid) return;
    this.keeper.unit?.act('gesture_hello');
    this.page(t(`고맙구나! 약속대로 🪙 ${paid.coins.toLocaleString()} 코인과 ${paid.xp.toLocaleString()} XP를 주마.`, `Thank you! As promised: 🪙 ${paid.coins.toLocaleString()} coins and ${paid.xp.toLocaleString()} XP.`));
  }

  update(): void { this.requests.update(); }

  dispose(): void { this.requests.dispose(); }
}
