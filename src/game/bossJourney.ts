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
  trueCleared = false;
  firstEndingSeen = false;
  private chapterEnding: HTMLElement | null = null;
  private endingTime = 0;
  private trueStarted = false;
  private kills = 0;
  private last = '';
  private saveAt = 0;
  private readonly key: string;
  private readonly progress = h('p', { class: 'bj-progress' });
  private readonly patrol = h('p', { class: 'bj-patrol' });
  private readonly cards: { boss: Boss; status: HTMLElement; button: HTMLButtonElement }[] = [];
  private readonly aura = new THREE.Group();
  private readonly victory = h('button', { type: 'button', class: 'bj-celebrate', onclick: () => {
    if (this.trueCleared && this.game.worldBoss.state === 'dead' && !this.game.controlsLocked) { this.save(); void this.game.ending.start(); }
  } }, '✨ 진짜 엔딩 다시 보기');

  private readonly portal = h('button', {type:'button',class:'bj-portal',onclick:()=>this.enterWorld2()}, '✧ 숨겨진 월드 2로 들어가기 →');

  constructor(private readonly game: Game) {
    const spec = game.player.unit.rig.spec;
    this.key = `cc.journey.v1:${spec.race}:${spec.sex}:${spec.classId}:${spec.name}`;
    this.root = h('details', { class: 'boss-journey' }, h('summary', null, '⚔ 보스 여정'),
      h('div', { class: 'bj-heading' }, h('span', null, 'THE TIDELANDS'), h('strong', null, '세 왕관의 전설')), this.progress);
    for (const boss of [game.boss, game.finalBoss, game.worldBoss]) {
      const final = boss.profile.level >= 10;
      const status = h('span', { class: 'bj-status' });
      const button = h('button', { type: 'button', onclick: () => this.challenge(boss) }, '도전하기 →');
      const card = h('article', { class: `bj-card ${boss.profile.level===20 ? 'eclipse' : final ? 'abyss' : 'rust'}` },
        h('div', { class: 'bj-badge' }, `LV ${boss.profile.level}`),
        h('div', null, h('h3', null, boss.profile.name), h('p', null, boss.profile.level === 20 ? '검은 일식 · 안쪽 안전지대 · 별빛 폭주' : final ? '심해 파동 · 끌어당기기 · 3단계 폭주' : '닻 내려찍기 · 녹 분사 · 하수인 소환'), status), button);
      this.root.append(card);
      this.cards.push({ boss, status, button });
    }
    this.root.append(this.portal, this.patrol, h('small', null, '해안의 적을 처치하면 성장해요. 멀티플레이에서는 보스전도 함께 진행하며, 성장과 승리는 이 브라우저에 자동 저장됩니다.'), this.victory);
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
      const second = data.chapter === 2 && data.abyss === true && data.firstEnding === true;
      this.game.player.restoreXp(Math.min(data.xp, LEVEL_XP[second ? 19 : 9]));
      this.rustCleared = data.rust === true;
      this.abyssCleared = this.rustCleared && data.abyss === true;
      this.firstEndingSeen = this.abyssCleared && data.firstEnding === true;
      this.trueCleared = second && data.trueCleared === true;
      this.trueStarted = this.trueCleared;
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
      for (const [boss, cleared] of [[this.game.boss, this.rustCleared], [this.game.finalBoss, this.abyssCleared], [this.game.worldBoss, this.trueCleared]] as const) {
        if (cleared) { boss.state = 'dead'; boss.unit.alive = false; boss.unit.hidden = true; boss.unit.rig.root.visible = false; }
      }
      if (second) this.game.world2.enter();
    } catch { /* A missing or damaged local save starts a fresh journey. */ }
  }

  save() {
    localStorageSet(this.key, JSON.stringify({ chapter:this.game.world2.chapter,firstEnding:this.firstEndingSeen,trueCleared:this.trueCleared,xp: this.game.player.xp, rust: this.rustCleared, abyss: this.abyssCleared, kills: this.kills,
      quests: this.game.quests.status, objectives: Object.fromEntries(this.game.quests.progress) }));
  }

  onKill() {
    if (!this.rustCleared || this.trueCleared || this.game.player.level >= (this.game.world2.chapter === 2 ? MAX_LEVEL : 10)) return;
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
    } else if (boss === this.game.worldBoss) {
      if(this.trueCleared) return;
      this.trueCleared=true;
      this.game.hud.chat.system('세 번째 왕관을 되찾았습니다. 두 세계에 빛이 돌아옵니다.');
    } else {
      if (this.abyssCleared) return;
      this.abyssCleared = true;
      this.game.world.setMood(2);
      this.game.hud.chat.system('심해의 왕관을 되찾았습니다. 잠시 뒤 첫 엔딩과 숨겨진 세계가 열립니다.');
    }
    this.root.open = true;
    this.save();
  }

  private challenge(boss: Boss) {
    const g = this.game;
    const cleared = boss === g.boss ? this.rustCleared : boss === g.worldBoss ? this.trueCleared : this.abyssCleared;
    if (cleared || !canChallenge(g.player.level, boss.profile.level, this.rustCleared, this.abyssCleared, g.world2.chapter) || g.controlsLocked || g.player.inCombat || g.encounter.engaged) return;
    if (boss === g.finalBoss && g.boss.state !== 'dead') { g.hud.messages.info('첫 보스의 승리 연출이 끝난 뒤 도전해 주세요.'); return; }
    if (!g.multiplayer?.battle.challenge(boss === g.boss ? 'b3' : boss === g.worldBoss ? 'b20' : 'b10')) boss.wake();
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
    if (g.multiplayer?.battle.authority !== false && g.partyLevel >= 3 && !this.rustCleared && g.boss.state === 'dormant') g.boss.wake();
    if (this.abyssCleared && !this.firstEndingSeen && g.finalBoss.state === 'dead' && !this.chapterEnding && g.world2.chapter === 1) this.showChapterEnding();
    if(this.chapterEnding) {
      this.endingTime+=dt;
      this.chapterEnding.classList.toggle('revealed',this.endingTime>4);
      const button=this.chapterEnding.querySelector('button')!; button.disabled=this.endingTime<5;
      if(this.endingTime>12 && g.multiplayer?.battle.authority !== false) this.finishChapterEnding();
    }
    if(this.trueCleared && g.worldBoss.state==='dead' && !this.trueStarted && !g.ending.active) { this.trueStarted=true; this.save(); void g.ending.start(); }
    const state = `${level}|${g.player.xp}|${this.kills}|${this.rustCleared}|${this.abyssCleared}|${g.player.inCombat}|${g.controlsLocked}|${g.finalBoss.state}|${g.boss.state}|${g.worldBoss.state}|${g.world2.chapter}|${this.firstEndingSeen}|${this.trueCleared}`;
    if (state !== this.last) {
      this.last = state;
      const next = LEVEL_XP[level];
      this.progress.textContent = level >= (g.world2.chapter === 2 ? 20 : 10) ? `LEVEL ${level} · 왕관에 도전할 준비 완료` : `LEVEL ${level} → ${level + 1} · ${next - g.player.xp} XP 남음`;
      for (const { boss, status, button } of this.cards) {
        const cleared = boss === g.boss ? this.rustCleared : boss === g.worldBoss ? this.trueCleared : this.abyssCleared;
        const unlocked = canChallenge(level, boss.profile.level, this.rustCleared, this.abyssCleared, g.world2.chapter);
        status.textContent = cleared ? '✓ 왕관 획득' : unlocked ? (boss.engaged ? '전투 중' : boss === g.worldBoss ? '도전 가능 · 별의 왕좌' : '도전 가능 · 철의 난파선') : `🔒 ${boss.profile.level}레벨${boss.profile.level === 20 ? ' + 월드 2' : boss.profile.level === 10 ? ' + 첫 보스 승리' : ''} 필요`;
        button.disabled = cleared || !unlocked || g.controlsLocked || g.player.inCombat || g.encounter.engaged || (boss === g.finalBoss && g.boss.state !== 'dead');
        button.textContent = cleared ? '정복 완료' : boss.engaged ? '전투 중' : '도전하기 →';
      }
      this.portal.hidden = !(this.abyssCleared && this.firstEndingSeen && g.world2.chapter === 1);
      this.patrol.textContent = this.trueCleared ? '세 왕관을 되찾고 두 세계를 구했습니다.' : g.world2.chapter === 2 ? `WORLD II · 유적 순찰 ${this.kills}/5 · +${patrolReward(level)} XP · 목표 20레벨` : this.abyssCleared ? '첫 엔딩 너머, 숨겨진 별의 섬으로…' : this.rustCleared ? `해안 순찰 ${this.kills}/5 · 보너스 ${patrolReward(level)} XP` : '마을 퀘스트와 해안 전투로 3레벨에 도달하세요.';
      this.victory.hidden = !this.trueCleared;
      this.victory.disabled = g.worldBoss.state !== 'dead' || g.controlsLocked;
    }
    if ((this.saveAt += dt) > 3) { this.saveAt = 0; this.save(); }
    const crowned = g.world2.chapter===2 ? g.worldBoss : g.finalBoss;
    const u = crowned.unit;
    this.aura.visible = !u.hidden && u.alive;
    this.aura.position.copy(u.pos);
    this.aura.position.y += u.height * 0.8;
    this.aura.rotation.y += dt * (crowned.enraged ? 1.2 : 0.35);
    this.aura.scale.setScalar(1 + Math.sin(g.time * 2) * 0.035);
  }

  private showChapterEnding() {
    const g=this.game; this.endingTime=0; g.cinematic=true;
    g.player.setTarget(null); g.player.unit.invulnerable=true; g.hud.dialogue.close(); g.hud.setCinematic(true);
    this.chapterEnding=h('section',{class:'chapter-ending',role:'dialog','aria-label':'첫 엔딩'},
      h('div',{class:'ce-stars'}),h('span',{class:'ce-kicker'},'CHAPTER I · THE TIDELANDS'),
      h('div',{class:'ce-crown'},'♛'),h('h1',null,'심해의 왕관'),
      h('p',null,'녹의 파도가 잠들고, 해안에 다시 빛이 돌아왔습니다.'),
      h('div',{class:'ce-reveal'},h('span',null,'하지만 왕관 속에는 또 하나의 별이 잠들어 있었습니다.'),h('h2',null,'WORLD II · 잊힌 별의 섬'),h('p',null,'수정 유적 · 20레벨 · 일식의 여왕 · 진짜 엔딩')),
      h('button',{type:'button',disabled:true,onclick:()=>this.finishChapterEnding()},'새로운 모험을 시작하기 →'));
    g.app.ui.append(this.chapterEnding);
  }
  private finishChapterEnding() {
    this.firstEndingSeen=true; this.closeChapterEnding(); this.save();
    this.root.open=true;
    if(this.game.multiplayer?.battle.authority === false) {
      this.game.hud.messages.info('방장이 차원문을 열면 모두 함께 월드 2로 이동해요.');
    } else this.enterWorld2();
  }
  closeChapterEnding() {
    if(!this.chapterEnding) return;
    this.chapterEnding.remove(); this.chapterEnding=null;
    this.game.cinematic=false; this.game.player.unit.invulnerable=false; this.game.hud.setCinematic(false);
  }
  private enterWorld2() {
    if(!this.abyssCleared || !this.firstEndingSeen || this.game.world2.chapter===2) return;
    if(!this.game.multiplayer?.battle.enterWorld2()) this.game.world2.enter();
    this.root.open=false; this.save();
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
    this.closeChapterEnding(); this.save(); this.root.remove(); this.game.scene.remove(this.aura);
    const materials = new Set<THREE.Material>();
    this.aura.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); materials.add(o.material); } });
    for (const m of materials) m.dispose();
  }
}
