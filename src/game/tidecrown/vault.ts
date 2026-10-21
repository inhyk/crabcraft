// The Royal Vault of Tidecrown (왕실 금고): coins kept for every character of the account, so coins one character earned
// can be taken out by another. Bell keeps it from the gate end of the Moult Market's hall, beside a strongbox and a
// heap of coins. The vault is one account key, `cc.vault.v1` = {"coins": n} (accountStorage.ts: per account when signed
// in, per device for a guest); it rides in the account bundle with the selected character's journey, so the two halves
// of a move always reach the cloud, and come back from it, together.
//
// A move writes the vault and the journey at once, in one synchronous step, and puts both back if either write is
// refused (or the journey's save throws), so after a reload the coins are on exactly one side. It is refused in a
// fight, in a dungeon, while dead, to a spectator, while another window plays the same character or this window no
// longer holds it (../saveHold.ts: such a window's saves would put back the coins moved), and while the account's saves
// are stopped (a conflict with another window, an expired login), as the next load of the account would undo the move.
// Nothing is sent to a relay room: coins are the local player's. On a server world nothing here is built.
import * as THREE from 'three';
import { localStorageGet, localStorageSet } from '../../app';
import { saveProfile, VAULT_KEY } from '../../accountStorage';
import { language, t } from '../../i18n';
import { TC_AXIS, TC_P, TC_T, tcAxis } from '../../sim/world/tidecrownGround';
import { h } from '../../ui/dom';
import type { Game } from '../game';
import type { TidecrownIsland } from './island';
import type { Keeper, TidecrownKeepers } from './keepers';
import { VAULT_AMOUNTS, type VaultAmount, type VaultMove, vaultAfter, vaultAmount, vaultCoins, vaultValue } from './vaultLedger';
import './vault.css';

/** The market hall (cityPlan.ts's TC_MarketArcade): its centre, and the hall's frame (x along the King's Way toward
 *  the keep, z across it away from the square's centre). */
const [HALL_X, HALL_Z] = tcAxis(TC_T.market, 18.5);
const inHall = (x: number, z: number): [number, number] => [HALL_X + TC_AXIS.ux * x + TC_P.x * z, HALL_Z + TC_AXIS.uz * x + TC_P.z * z];
/** In the hall's gate-end bay, past the last tables and in line with the back row (the aisle stays open), looking out
 *  of the hall toward the gate court the city's visitors come up from. */
const OUT = Math.atan2(-TC_AXIS.ux, -TC_AXIS.uz);
const [BELL_X, BELL_Z] = inHall(-8.9, 1.75);
export const VAULT_POST = { x: BELL_X, z: BELL_Z, yaw: OUT } as const;
/** Her strongbox at her side, facing out with her, coins heaped on its lid and spilt beside it, in the hall's frame. */
const CHEST = { at: inHall(-9.1, 3.4), scale: 0.62 } as const;
const HEAPS = [{ at: inHall(-9.1, 3.3), up: 0.72 * CHEST.scale, scale: 2.8, yaw: 0.6 }, { at: inHall(-9.75, 2.75), up: 0, scale: 2.2, yaw: 2.1 }] as const;

type Move = { move: VaultMove; amount: VaultAmount };

export class TidecrownVault {
  private readonly keeper: Keeper;
  private panel: HTMLElement | null = null;
  private readonly tiles = { carried: h('strong'), kept: h('strong') };
  private readonly labels = { carried: h('span'), kept: h('span'), deposit: h('span', { class: 'vault-label' }), withdraw: h('span', { class: 'vault-label' }) };
  private readonly buttons: (Move & { el: HTMLButtonElement })[] = [];
  private readonly status = h('p', { class: 'vault-status', role: 'status', 'aria-live': 'polite' });
  private readonly note = h('p', { class: 'vault-note' });
  /** The last move's outcome, shown under the rows (a refusal that holds now is shown instead). */
  private said: { text: () => string; moved: boolean } | null = null;
  private key = '';
  private busy = false;
  /** Another window holds this character too (seen at the last check). */
  private twin = false;
  private dressing: THREE.Group | null = null;
  private dressed: Promise<void> | null = null;

  constructor(private readonly g: Game, keepers: TidecrownKeepers) {
    this.keeper = keepers.add({
      id: 'tc-vault', ...VAULT_POST,
      spec: { race: 'dwarf', sex: 'female', classId: 'priest', shell: 2, crest: 1, led: 1, name: 'Bell' },
      name: ['금고지기 벨', 'Bell the Vault-keeper'], title: ['🪙 왕실 금고', '🪙 The Royal Vault'],
      prompt: ['금고지기 벨에게 말 걸기 · 왕실 금고', 'Talk to Bell · The Royal Vault'], marker: ['금고', 'Vault'],
      talk: () => this.talk(),
    });
  }

  get unit() { return this.keeper.unit; }

  /** The vault's coins now, read from storage each time (another window may have moved some); null if unreadable. */
  get coins(): number | null { return vaultCoins(localStorageGet(VAULT_KEY)); }

  /** Whether another window holds this character too (false without a journey). */
  private shared(): Promise<boolean> { return this.g.journey?.hold?.shared() ?? Promise.resolve(false); }

  /** The strongbox and the coins at Bell's post, from the props kit Tidecrown's market already uses; once. */
  dress(island: TidecrownIsland): Promise<void> {
    return (this.dressed ??= (async () => {
      const [{ loadTidecrownKit, TideBatch }, { trs }] = await Promise.all([import('./houses'), import('../../world/kit')]);
      const kit = await loadTidecrownKit(), batch = new TideBatch(kit, 'tc-vault-dressing');
      const y = (x: number, z: number) => island.height(x, z) - 0.02;
      // The chest piece is centred on its middle (0.36 down to its base).
      batch.put(kit.props, 'Chest_Wood', trs(CHEST.at[0], y(...CHEST.at) + 0.36 * CHEST.scale, CHEST.at[1], OUT, CHEST.scale), kit.over.props, null);
      // Coins in the king's crown gold (the kit's trim metal reads as grey stacks here).
      const gold = new THREE.MeshStandardMaterial({ name: 'tc-vault-gold', color: '#f3c24f', metalness: 1, roughness: 0.3, emissive: '#3b2600', emissiveIntensity: 0.45 });
      for (const c of HEAPS) batch.put(kit.props, 'Coin_Pile', trs(c.at[0], y(...c.at) + c.up, c.at[1], c.yaw, c.scale), { MI_Trim_Metal: gold }, null, false);
      this.dressing = batch.build();
      island.root.add(this.dressing);
    })().catch((e) => { this.dressed = null; throw e; }));
  }

  /** F at Bell: her greeting over the vault's balances and its deposit and withdraw rows. */
  talk(): void {
    const u = this.keeper.unit;
    if (!u) return;
    this.keeper.greet();
    this.said = null;
    this.panel ??= this.build();
    void this.shared().then((twin) => { this.twin = twin; this.render(); });
    this.g.hud.dialogue.open({
      unit: u, portraitArt: this.keeper.portrait, questTitle: t('🪙 왕실 금고', '🪙 The Royal Vault'),
      paragraphs: [t('어서 오세요, 왕실 금고예요! 여기 맡긴 코인은 다른 캐릭터로도 꺼낼 수 있어요.', 'Welcome to the Royal Vault! Coins you leave here can be taken out by your other characters too.')],
      extra: this.panel,
      buttons: [{ label: t('고마워요', 'Thank you'), primary: true, onClick: () => this.g.hud.dialogue.close() }],
    });
    this.render();
  }

  private build(): HTMLElement {
    const row = (move: VaultMove) => {
      const el = h('div', { class: `vault-row ${move}` }, this.labels[move]);
      for (const amount of [...VAULT_AMOUNTS, 'all'] as const) {
        const b = h('button', { type: 'button', class: 'vault-amt', 'data-move': move, 'data-amount': String(amount) }) as HTMLButtonElement;
        // The second click of a double click moves nothing.
        b.addEventListener('click', (e) => { if (e.detail < 2) void this.move(move, amount); });
        b.addEventListener('mouseenter', () => this.g.audio.sfx('sfx-hover', { volume: 0.3 }));
        this.buttons.push({ move, amount, el: b });
        el.append(b);
      }
      return el;
    };
    return h('section', { class: 'vault' },
      h('div', { class: 'vault-tiles' }, h('div', { class: 'vault-tile carried' }, this.labels.carried, this.tiles.carried), h('div', { class: 'vault-tile kept' }, this.labels.kept, this.tiles.kept)),
      row('deposit'), row('withdraw'), this.status, this.note);
  }

  /** Why the vault cannot be used now; null when it can. */
  refusal(): string | null {
    const g = this.g;
    if (g.spectator) return t('구경하는 중에는 금고를 쓸 수 없어요.', 'Spectators cannot use the vault.');
    if (!g.player.unit.alive) return t('쓰러진 동안에는 금고를 쓸 수 없어요.', 'You cannot use the vault while knocked out.');
    if (g.player.inCombat) return t('싸우는 중에는 금고를 쓸 수 없어요.', 'You cannot use the vault during a fight.');
    if (g.dungeons?.active) return t('던전 안에서는 금고를 쓸 수 없어요.', 'You cannot use the vault in a dungeon.');
    if (!g.journey) return t('지금은 금고를 쓸 수 없어요.', 'The vault cannot be used right now.');
    const lost = g.journey.hold?.lost, halted = g.app.account.halted;
    if (lost === 'loaded') return t('다른 창에서 계정 저장을 불러왔어요. 이 창을 새로 고친 뒤 금고를 써 주세요.', 'Another window loaded your account save. Reload this window to use the vault.');
    if (lost || this.twin) return t('다른 창에서도 이 캐릭터로 놀고 있어요. 그 창을 닫고 이 창을 새로 고쳐 주세요.', 'This character is also playing in another window. Close it and reload this one.');
    if (halted === 'conflict') return t('다른 창에서 먼저 저장해서 지금은 금고를 쓸 수 없어요. 계정 저장을 불러온 뒤 써 주세요.', 'Another window saved first, so the vault is closed for now. Load the account save, then use it.');
    if (halted === 'session') return t('로그인이 만료돼서 지금은 금고를 쓸 수 없어요. 다시 로그인해 주세요.', 'Your login expired, so the vault is closed for now. Please sign in again.');
    if (this.coins === null) return t('금고 기록을 읽을 수 없어서 쓸 수 없어요.', 'The vault record cannot be read, so it cannot be used.');
    return null;
  }

  /**
   * Moves coins between the player and the vault: the vault is written first, then the journey, both in this call; if
   * either write is refused (a journey save that throws counts as refused) both go back as they were. True when coins
   * moved.
   */
  async move(move: VaultMove, amount: VaultAmount): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.render();
    try {
      this.twin = await this.shared();
      if (this.refusal()) return false;
      const g = this.g, vault = this.coins!, carried = g.player.coins, n = vaultAmount(carried, vault, move, amount);
      if (!n) {
        const short = (move === 'deposit' ? carried : vault) < (amount === 'all' ? 1 : amount);
        return this.tell(() => (short ? (move === 'deposit' ? t('가진 코인이 모자라요.', 'You do not have enough coins.') : t('금고에 코인이 모자라요.', 'The vault does not hold enough coins.')) : t('더는 넣을 자리가 없어요.', 'There is no room for more coins.')), false);
      }
      const next = vaultAfter(carried, vault, move, n), before = localStorageGet(VAULT_KEY);
      const failed = () => t('저장하지 못해서 코인을 옮기지 않았어요.', 'Could not save, so no coins moved.');
      if (!localStorageSet(VAULT_KEY, vaultValue(next.vault))) return this.tell(failed, false);
      g.player.coins = next.carried;
      let saved = false;
      try { saved = g.journey!.save(); } catch (e) { console.warn('vault: the journey save threw', e); }
      if (!saved) {
        g.player.coins = carried;
        localStorageSet(VAULT_KEY, before ?? vaultValue(vault));
        return this.tell(failed, false);
      }
      g.audio.sfx('sfx-loot', { volume: 0.7 });
      const text = n.toLocaleString();
      return this.tell(() => (move === 'deposit' ? t(`🪙 ${text} 코인을 금고에 맡겼어요.`, `🪙 ${text} coins put in the vault.`) : t(`🪙 ${text} 코인을 금고에서 꺼냈어요.`, `🪙 ${text} coins taken out of the vault.`)), true);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private tell(text: () => string, moved: boolean): boolean {
    this.said = { text, moved };
    return moved;
  }

  /** Balances, button states and wording, when any of them changed. */
  private render(): void {
    if (!this.panel) return;
    const g = this.g, vault = this.coins, refusal = this.refusal(), carried = g.player.coins, account = !!saveProfile();
    const said = refusal ?? this.said?.text() ?? '', moved = !refusal && !!this.said?.moved;
    const key = `${language()}|${carried}|${vault}|${refusal}|${this.busy}|${account}|${said}|${moved}`;
    if (key === this.key) return;
    this.key = key;
    this.labels.carried.textContent = t('가진 코인', 'Carried');
    this.labels.kept.textContent = t('금고에 맡긴 코인', 'In the vault');
    this.labels.deposit.textContent = t('맡기기', 'Deposit');
    this.labels.withdraw.textContent = t('꺼내기', 'Withdraw');
    this.tiles.carried.textContent = `🪙 ${carried.toLocaleString()}`;
    this.tiles.kept.textContent = vault === null ? '—' : `🪙 ${vault.toLocaleString()}`;
    for (const b of this.buttons) {
      const n = vault === null ? 0 : vaultAmount(carried, vault, b.move, b.amount);
      b.el.disabled = this.busy || !!refusal || !n;
      b.el.textContent = b.amount === 'all' ? t('모두', 'All') : b.amount.toLocaleString();
      const what = b.amount === 'all' ? t('모든', 'all') : b.amount.toLocaleString();
      b.el.setAttribute('aria-label', b.move === 'deposit' ? t(`${what} 코인 맡기기`, `Deposit ${what} coins`) : t(`${what} 코인 꺼내기`, `Withdraw ${what} coins`));
    }
    this.status.textContent = said;
    this.status.classList.toggle('moved', moved);
    this.status.classList.toggle('refused', !!said && !moved);
    this.note.textContent = account
      ? t('이 Google 계정의 모든 캐릭터가 같은 금고를 써요. 계정에 저장되니 다른 컴퓨터에서도 같아요.', 'Every character on this Google account shares this vault. It saves to your account, so it is the same on other computers.')
      : t('로그인하지 않아서 금고는 이 기기에만 있어요. 이 기기의 캐릭터끼리 함께 써요.', 'You are not signed in, so this vault is on this device only, shared by its characters.');
  }

  /** Every frame in the capital: keeps an open vault page true to the balances and to what may be done now. */
  update(): void {
    if (!this.panel) return;
    if (this.g.hud.dialogue.unit !== this.keeper.unit || !this.panel.isConnected) {
      this.said = null;
      return;
    }
    this.render();
  }

  dispose(): void {
    this.dressing?.removeFromParent();
    this.dressing = null;
  }
}
