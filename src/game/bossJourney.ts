import * as THREE from 'three';
import type { Game } from './game';
import type { Boss } from './boss';
import { localStorageGet, localStorageSet } from '../app';
import { h } from '../ui/dom';
import { LEVEL_XP, MAX_LEVEL, canChallenge, patrolReward } from './progression';
import { QUEST_ORDER, QUESTS, type QuestStatus } from './quests';
import './bossJourney.css';

/** The journey stays playable after the first story boss, including after a reload. */
export class BossJourney {
  readonly root: HTMLDetailsElement;
  rustCleared = false;
  abyssCleared = false;
  private kills = 0;
  private last = '';
  private saveAt = 0;
  private readonly key: string;
  private readonly progress = h('p', { class: 'bj-progress' });
  private readonly patrol = h('p', { class: 'bj-patrol' });
  private readonly cards: { boss: Boss; status: HTMLElement; button: HTMLButtonElement }[] = [];
  private readonly aura = new THREE.Group();
  private readonly victory = h('button', { type: 'button', class: 'bj-celebrate', onclick: () => {
    if (this.abyssCleared && this.game.finalBoss.state === 'dead' && !this.game.controlsLocked) { this.save(); void this.game.ending.start(); }
  } }, '✨ 마을에서 승리 축하하기');

  constructor(private readonly game: Game) {
    const spec = game.player.unit.rig.spec;
    this.key = `cc.journey.v1:${spec.race}:${spec.sex}:${spec.classId}:${spec.name}`;
    this.root = h('details', { class: 'boss-journey' }, h('summary', null, '⚔ 보스 여정'),
      h('div', { class: 'bj-heading' }, h('span', null, 'THE TIDELANDS'), h('strong', null, '두 개의 왕관')), this.progress);
    for (const boss of [game.boss, game.finalBoss]) {
      const final = boss.profile.level === 10;
      const status = h('span', { class: 'bj-status' });
      const button = h('button', { type: 'button', onclick: () => this.challenge(boss) }, '도전하기 →');
      const card = h('article', { class: `bj-card ${final ? 'abyss' : 'rust'}` },
        h('div', { class: 'bj-badge' }, `LV ${boss.profile.level}`),
        h('div', null, h('h3', null, boss.profile.name), h('p', null, final ? '심해 파동 · 끌어당기기 · 3단계 폭주' : '닻 내려찍기 · 녹 분사 · 하수인 소환'), status), button);
      this.root.append(card);
      this.cards.push({ boss, status, button });
    }
    this.root.append(this.patrol, h('small', null, '해안의 적을 처치하면 성장해요. 보스전은 각자 진행하며, 성장과 승리는 이 브라우저에 자동 저장됩니다.'), this.victory);
    this.root.addEventListener('keydown', e => e.stopPropagation());
    this.root.addEventListener('focusin', () => window.dispatchEvent(new Event('blur')));
    game.app.ui.append(this.root);
    this.restore();
    this.makeAura();
    this.update(0);
  }

  private restore() {
    try {
      const data = JSON.parse(localStorageGet(this.key) ?? 'null');
      if (!data || !Number.isFinite(data.xp)) return;
      this.game.player.restoreXp(data.xp);
      this.rustCleared = this.game.player.level >= 3 && data.rust === true;
      this.abyssCleared = this.rustCleared && this.game.player.level === 10 && data.abyss === true;
      this.kills = Number.isInteger(data.kills) && data.kills >= 0 && data.kills < 5 ? data.kills : 0;
      for (const id of QUEST_ORDER) {
        if (['locked', 'available', 'active', 'ready', 'done'].includes(data.quests?.[id])) this.game.quests.status[id] = data.quests[id] as QuestStatus;
        for (const o of QUESTS[id].objectives) {
          const n = data.objectives?.[o.id];
          if (Number.isInteger(n) && n >= 0 && n <= o.count) this.game.quests.progress.set(o.id, n);
        }
      }
      if (this.game.quests.status.q3 === 'done') {
        this.game.beaconLit = true;
        this.game.world.setBeaconLit(true);
        this.game.player.unit.blessingUntil = Infinity;
      }
      if (this.abyssCleared) this.game.world.setMood(2);
      for (const [boss, cleared] of [[this.game.boss, this.rustCleared], [this.game.finalBoss, this.abyssCleared]] as const) {
        if (cleared) { boss.state = 'dead'; boss.unit.alive = false; boss.unit.hidden = true; boss.unit.rig.root.visible = false; }
      }
    } catch { /* A missing or damaged local save starts a fresh journey. */ }
  }

  save() {
    localStorageSet(this.key, JSON.stringify({ xp: this.game.player.xp, rust: this.rustCleared, abyss: this.abyssCleared, kills: this.kills,
      quests: this.game.quests.status, objectives: Object.fromEntries(this.game.quests.progress) }));
  }

  onKill() {
    if (!this.rustCleared || this.abyssCleared || this.game.player.level >= MAX_LEVEL) return;
    if (++this.kills >= 5) {
      this.kills = 0;
      const xp = patrolReward(this.game.player.level);
      this.game.player.gainXp(xp);
      this.game.hud.messages.banner('해안 순찰 완료', `다섯 적 처치 · +${xp} XP`, 'quest');
    }
    this.save();
  }

  onBossDefeated(boss: Boss) {
    if (boss === this.game.boss) {
      if (this.rustCleared) return;
      this.rustCleared = true;
      this.game.player.gainXp(boss.profile.reward);
      this.game.hud.chat.system('첫 왕관 획득! 해안 순찰로 10레벨을 달성하고 심해의 군주에게 도전하세요.');
    } else {
      if (this.abyssCleared) return;
      this.abyssCleared = true;
      this.game.world.setMood(2);
      this.game.hud.chat.system('두 왕관의 주인! 보스 여정에서 마을 축하 행사를 시작할 수 있어요.');
    }
    this.root.open = true;
    this.save();
  }

  private challenge(boss: Boss) {
    const g = this.game;
    const cleared = boss === g.boss ? this.rustCleared : this.abyssCleared;
    if (cleared || !canChallenge(g.player.level, boss.profile.level, this.rustCleared) || g.controlsLocked || g.player.inCombat || g.encounter.engaged) return;
    if (boss === g.finalBoss && g.boss.state !== 'dead') { g.hud.messages.info('첫 보스의 승리 연출이 끝난 뒤 도전해 주세요.'); return; }
    boss.wake();
    const a = boss.arena;
    // Enter on the deck's walkable approach, facing the centre.
    const dx = Math.sin(a.yaw), dz = Math.cos(a.yaw);
    const distance = Math.min(9, a.radius * 0.85);
    g.player.respawn();
    g.player.unit.teleport(g.world, a.position.x + dx * distance, a.position.z + dz * distance, a.yaw + Math.PI);
    g.follow.cut();
    g.follow.yaw = g.player.unit.yaw + Math.PI;
    g.world.setMood(1);
    g.hud.dialogue.close();
    this.root.open = false;
    g.hud.messages.banner(`LEVEL ${boss.profile.level} · 보스 도전`, boss.profile.name, 'boss');
  }

  update(dt: number) {
    const g = this.game;
    const level = g.player.level;
    if (level >= 3 && !this.rustCleared && g.boss.state === 'dormant') g.boss.wake();
    const state = `${level}|${g.player.xp}|${this.kills}|${this.rustCleared}|${this.abyssCleared}|${g.player.inCombat}|${g.controlsLocked}|${g.finalBoss.state}|${g.boss.state}`;
    if (state !== this.last) {
      this.last = state;
      const next = LEVEL_XP[level];
      this.progress.textContent = level === MAX_LEVEL ? 'LEVEL 10 · 심해의 왕관에 도전할 준비 완료' : `LEVEL ${level} → ${level + 1} · ${next - g.player.xp} XP 남음`;
      for (const { boss, status, button } of this.cards) {
        const cleared = boss === g.boss ? this.rustCleared : this.abyssCleared;
        const unlocked = canChallenge(level, boss.profile.level, this.rustCleared);
        status.textContent = cleared ? '✓ 왕관 획득' : unlocked ? (boss.engaged ? '전투 중' : '도전 가능 · 철의 난파선') : `🔒 ${boss.profile.level}레벨${boss.profile.level === 10 ? ' + 첫 보스 승리' : ''} 필요`;
        button.disabled = cleared || !unlocked || g.controlsLocked || g.player.inCombat || g.encounter.engaged || (boss === g.finalBoss && g.boss.state !== 'dead');
        button.textContent = cleared ? '정복 완료' : boss.engaged ? '전투 중' : '도전하기 →';
      }
      this.patrol.textContent = this.abyssCleared ? '두 왕관을 모두 되찾았습니다.' : this.rustCleared ? `해안 순찰 ${this.kills}/5 · 보너스 ${patrolReward(level)} XP` : '마을 퀘스트와 해안 전투로 3레벨에 도달하세요.';
      this.victory.hidden = !this.abyssCleared;
      this.victory.disabled = g.finalBoss.state !== 'dead' || g.controlsLocked;
    }
    if ((this.saveAt += dt) > 3) { this.saveAt = 0; this.save(); }
    const u = g.finalBoss.unit;
    this.aura.visible = !u.hidden && u.alive;
    this.aura.position.copy(u.pos);
    this.aura.position.y += u.height * 0.8;
    this.aura.rotation.y += dt * (g.finalBoss.enraged ? 1.2 : 0.35);
    this.aura.scale.setScalar(1 + Math.sin(g.time * 2) * 0.035);
  }

  private makeAura() {
    const color = new THREE.MeshStandardMaterial({ color: '#6cecff', emissive: '#189cce', emissiveIntensity: 2.2, metalness: 0.7, roughness: 0.2 });
    const radius = this.game.finalBoss.unit.radius * 1.2;
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + i * 0.35, 0.035, 6, 64), color);
      ring.rotation.x = Math.PI / 2 + i * 0.18;
      this.aura.add(ring);
    }
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), color);
      const a = i / 6 * Math.PI * 2;
      shard.position.set(Math.sin(a) * radius, 0.4, Math.cos(a) * radius);
      this.aura.add(shard);
    }
    this.game.scene.add(this.aura);
  }
  dispose() {
    this.save(); this.root.remove(); this.game.scene.remove(this.aura);
    const materials = new Set<THREE.Material>();
    this.aura.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); materials.add(o.material); } });
    for (const m of materials) m.dispose();
  }
}
