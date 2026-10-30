import * as THREE from 'three';
import {t,language} from '../i18n';
import type { Game } from './game';
import type { Boss } from './boss';
import type { CrabSpec } from '../crab/types';
import { localStorageGet, localStorageSet } from '../app';
import { SPECTATE } from '../spectate';
import { h } from '../ui/dom';
import { xpForLevel, canChallenge, patrolReward } from './progression';
import {equipmentRank} from './equipment';
import { QUEST_ORDER, QUESTS, type QuestStatus } from './quests';
import { SaveHold } from './saveHold';
import './bossJourney.css';

function readJourneySave(key: string) {
  try {
    const data = JSON.parse(localStorageGet(key) ?? 'null');
    return data && Number.isFinite(data.xp) ? data : null;
  } catch { return null; }
}

/** The journey stays playable after the first story boss, including after a reload. */
export class BossJourney {
  private static saveKey(spec: CrabSpec): string {
    return `cc.journey.v1:${spec.race}:${spec.sex}:${spec.classId}:${spec.name}`;
  }

  /** Preview the same character save that restore() will accept, before models are loaded. */
  static savedChapter(spec: CrabSpec): 1 | 2 | 3 | 4 | 5 | 6 {
    const data=readJourneySave(this.saveKey(spec));return data?.chapter===6&&data.frostCleared?6:data?.chapter===5&&data.frostCleared?5:data?.chapter===4&&data.abyss&&data.trueCleared&&data.finalCleared?4:data?.chapter===3&&data.abyss&&data.trueCleared?3:data?.chapter===2&&data.abyss?2:1;
  }

  readonly root: HTMLDetailsElement;
  rustCleared = false;
  abyssCleared = false;
  trueCleared = false;
  finalCleared = false;
  frostCleared = false;
  emberCleared = false;
  skyCleared = false;
  private world2Celebrated=false;
  private wallet=h('div',{class:'coin-wallet hud-i'});
  firstEndingSeen = false;
  private chapterEnding: HTMLElement | null = null;
  private endingTime = 0;
  private trueStarted = false;
  private chapterCelebrating=false;
  private kills = 0;
  private last = '';
  private saveAt = 0;
  private readonly key: string;
  /** This window's hold on the character's save (saveHold.ts); none for a spectator, who saves nothing. */
  readonly hold: SaveHold | null;
  /** Shown once the hold is lost: this window saves no more until it reloads. */
  private notice: HTMLElement | null = null;
  private readonly progress = h('p', { class: 'bj-progress' });
  private readonly patrol = h('p', { class: 'bj-patrol' });
  private readonly cards: { boss: Boss; status: HTMLElement; button: HTMLButtonElement }[] = [];
  private readonly aura = new THREE.Group();
  private readonly victory = h('button', { type: 'button', class: 'bj-celebrate', onclick: () => {
    if (this.frostCleared && this.game.frostBoss.state === 'dead' && !this.game.controlsLocked) { this.save(); void this.game.ending.start(); }
  } }, '✨ 진짜 엔딩 다시 보기');

  private readonly portal = h('button', {type:'button',class:'bj-portal',onclick:()=>this.enterWorld2()}, '✧ 월드 2 바로가기 →');

  constructor(private readonly game: Game) {
    const spec = game.player.unit.rig.spec;
    this.key = BossJourney.saveKey(spec);
    // Before restore() reads the coins, so that a move made in another window from here on is seen.
    this.hold = SPECTATE ? null : new SaveHold(this.key, () => this.showLost());
    this.root = h('details', { class: 'boss-journey' }, h('summary', null, '⚔ 보스 여정'),
      h('div', { class: 'bj-heading' }, h('span', null, 'THE TIDELANDS'), h('strong', null, '세 왕관의 전설')), this.progress);
    for (const boss of [game.boss, game.finalBoss, game.worldBoss,game.dawnBoss,game.frostBoss,game.emberBoss,game.skyBoss]) {
      const final = boss.profile.level >= 10;
      const status = h('span', { class: 'bj-status' });
      const button = h('button', { type: 'button', onclick: () => this.challenge(boss) }, '도전하기 →');
      const card = h('article', { class: `bj-card ${boss.profile.level===750?'sky':boss.profile.level===500?'ember':boss.profile.level===300 ? 'frost' : boss.profile.level===100 ? 'dawn' : boss.profile.level===20 ? 'eclipse' : final ? 'abyss' : 'rust'}` },
        h('div', { class: 'bj-badge' }, `LV ${boss.profile.level}`),
        h('div', null, h('h3', null, boss.profile.name), h('p', null, boss.profile.level === 20 ? '검은 일식 · 안쪽 안전지대 · 별빛 폭주' : final ? '심해 파동 · 끌어당기기 · 3단계 폭주' : '닻 내려찍기 · 녹 분사 · 하수인 소환'), status), button);
      this.root.append(card);
      this.cards.push({ boss, status, button });
    }
    this.root.append(this.portal, this.patrol, h('small', null, '적을 처치하고 퀘스트를 완료하면 성장해요. 로그인하면 계정에도 모험이 자동 저장돼요.'), this.victory);
    this.root.addEventListener('keydown', e => e.stopPropagation());
    this.root.addEventListener('focusin', () => window.dispatchEvent(new Event('blur')));
    game.app.ui.append(this.root);
    game.hud.tracker.el.after(this.wallet);
    this.makeAura();
    this.update(0);
  }

  restore() {
    try {
      const data = readJourneySave(this.key);
      if (!data) return;
      this.game.achievements?.restore(data.achievements);
      const second = Number.isInteger(data.chapter)&&data.chapter>=2&&data.chapter<=6;
      this.game.player.restoreXp(data.xp);
      this.game.player.xpBlessingUntil = Number.isFinite(data.xpBlessingUntil) ? Math.max(0, Math.min(Date.now()+600000, data.xpBlessingUntil)) : 0;
      this.game.player.coins=Number.isSafeInteger(data.coins)&&data.coins>=0?data.coins:0;
      this.game.player.attackRank=equipmentRank(data.attackRank);
      this.game.player.armorRank=equipmentRank(data.armorRank);
      this.game.player.weaponOwned=data.weaponOwned===true||this.game.player.attackRank>0;
      this.game.player.armorOwned=data.armorOwned===true||this.game.player.armorRank>0;
      // The King of Tidecrown's request log; an older save without it starts a fresh log.
      this.game.world2.hub.kingdom?.restore(data.kingdom);
      this.rustCleared = data.rust === true;
      this.abyssCleared = this.rustCleared && data.abyss === true;
      this.firstEndingSeen = this.abyssCleared && data.firstEnding === true;
      this.trueCleared = this.abyssCleared && data.trueCleared === true;
      this.finalCleared=this.trueCleared&&data.finalCleared===true;this.world2Celebrated=this.trueCleared;
      this.frostCleared=this.finalCleared&&data.frostCleared===true;
      this.emberCleared=this.frostCleared&&data.emberCleared===true;this.skyCleared=this.frostCleared&&data.skyCleared===true;
      this.trueStarted = this.frostCleared;
      this.kills = Number.isInteger(data.kills) && data.kills >= 0 && data.kills < 5 ? data.kills : 0;
      for (const id of QUEST_ORDER) {
        if (['locked', 'available', 'active', 'ready', 'done'].includes(data.quests?.[id])) this.game.quests.status[id] = data.quests[id] as QuestStatus;
        for (const o of QUESTS[id].objectives) {
          const n = data.objectives?.[o.id];
          if (Number.isInteger(n) && n >= 0 && n <= o.count) this.game.quests.progress.set(o.id, n);
        }
      }
      this.game.quests.restoreTracking(data.trackedQuests);
      if (typeof data.beacon==='boolean'){this.game.beaconLit=data.beacon;this.game.world.setBeaconLit(data.beacon,true);this.game.world.setMood(data.beacon?1:data.mood===3?3:0,true);}
      else if (this.game.quests.status.q3 === 'done') {
        this.game.beaconLit = true;
        this.game.world.setBeaconLit(true, true);
      }
      const legacyBlessing = !this.rustCleared && !this.abyssCleared && !this.trueCleared;
      this.game.player.unit.blessingUntil = this.game.quests.status.q3 === 'done' && (typeof data.moonwater === 'boolean' ? data.moonwater : legacyBlessing) ? Infinity : 0;
      if (this.abyssCleared && typeof data.beacon!=='boolean') this.game.world.setMood(2);
      for (const [boss, cleared] of [[this.game.boss, this.rustCleared], [this.game.finalBoss, this.abyssCleared], [this.game.worldBoss, this.trueCleared],[this.game.dawnBoss,this.finalCleared],[this.game.frostBoss,this.frostCleared],[this.game.emberBoss,this.emberCleared],[this.game.skyBoss,this.skyCleared]] as const) {
        if (cleared) { boss.state = 'dead'; boss.unit.alive = false; boss.unit.hidden = true; boss.unit.rig.root.visible = false; }
      }
      if (second&&this.abyssCleared) this.game.world2.go(data.chapter===6&&this.frostCleared?6:data.chapter===5&&this.frostCleared?5:data.chapter===4&&this.finalCleared?4:data.chapter>=3&&this.trueCleared?3:2);
    } catch { /* A missing or damaged local save starts a fresh journey. */ }
  }

  /** Writes the journey now; false if storage refused it or this window no longer holds the character. */
  save(): boolean {
    const value = JSON.stringify({emberCleared:this.emberCleared,skyCleared:this.skyCleared, xpBlessingUntil:this.game.player.xpBlessingUntil,frostCleared:this.frostCleared,achievements:this.game.achievements?.snapshot(),coins:this.game.player.coins,attackRank:this.game.player.attackRank,armorRank:this.game.player.armorRank,weaponOwned:this.game.player.weaponOwned,armorOwned:this.game.player.armorOwned,finalCleared:this.finalCleared,moonwater:this.game.player.unit.blessingUntil===Infinity,beacon:this.game.world.getEnvironment().beacon,mood:this.game.world.getEnvironment().mood,chapter:this.game.world2.chapter,firstEnding:this.firstEndingSeen,trueCleared:this.trueCleared,xp: this.game.player.xp, rust: this.rustCleared, abyss: this.abyssCleared, kills: this.kills,
      quests: this.game.quests.status, objectives: Object.fromEntries(this.game.quests.progress), trackedQuests:this.game.quests.tracked, kingdom:this.game.world2.hub.kingdom?.snapshot() });
    return this.hold ? this.hold.write(value) : localStorageSet(this.key, value);
  }

  private showLost(): void {
    this.notice?.remove();
    this.notice = h('section', { class: 'save-hold-notice', role: 'alert' },
      h('p', null, this.hold?.lost === 'loaded'
        ? t('다른 창에서 계정 저장을 불러왔어요. 이 창의 진행은 이제 저장되지 않으니 새로 고쳐 주세요.', 'Another window loaded your account save. This window no longer saves, so please reload it.')
        : t('다른 창에서 이 캐릭터의 코인이 바뀌었어요. 이 창의 진행은 이제 저장되지 않으니 새로 고쳐 주세요.', 'Another window changed this character’s coins. This window no longer saves, so please reload it.')),
      h('button', { type: 'button', class: 'cc-btn', onclick: () => location.reload() }, t('새로 고치기', 'Reload')));
    this.game.app.ui.append(this.notice);
  }

  onKill() {
    if (!this.rustCleared && this.game.world2.chapter===1) return;
    if (++this.kills >= 5) {
      this.kills = 0;
      const xp = patrolReward(this.game.player.level);
      this.game.player.gainXp(xp);
      this.game.hud.messages.banner(() => (this.game.world2.chapter===4?t('설원 순찰 완료','Snowfield Patrol Complete'):this.game.world2.chapter===2?t('유적 순찰 완료','Ruin Patrol Complete'):t('해안 순찰 완료','Shore Patrol Complete')),() => (t(`다섯 적 처치 · +${xp} XP`,`Five enemies defeated · +${xp} XP`)), 'quest');
    }
    this.save();
  }

  onBossDefeated(boss: Boss) {
    // Coins and XP share the same per-victory claim, including replicated deaths.
    const coins = boss.claimVictoryCoins();
    if (coins > 0) {
      this.game.player.coins = Math.min(Number.MAX_SAFE_INTEGER, this.game.player.coins + coins);
      const grantsBlessing=boss===this.game.worldBoss||boss===this.game.dawnBoss;
      if(grantsBlessing){
        this.game.player.xpBlessingUntil=Date.now()+600000;
        this.game.hud.messages.info(t('성장의 축복! 10분 동안 모든 경험치 1.5배','Growth blessing! All XP ×1.5 for 10 minutes'));
        this.game.vfx.mendGlow(this.game.player.unit);
      }
      const beforeXp=this.game.player.xp;
      this.game.player.gainXp(boss.profile.reward,!grantsBlessing);
      const reward=this.game.player.xp-beforeXp;
      this.game.hud.chat.system(t(`보스 처치! +${coins.toLocaleString()} 코인 · +${reward.toLocaleString()} XP`, `Boss defeated! +${coins.toLocaleString()} coins · +${reward.toLocaleString()} XP`));
      this.save();
    }
    if(boss===this.game.emberBoss||boss===this.game.skyBoss){
      const fire=boss===this.game.emberBoss;if(fire?this.emberCleared:this.skyCleared)return;
      if(fire)this.emberCleared=true;else this.skyCleared=true;
      this.game.hud.messages.banner(()=>fire?t('잿불 왕관을 되찾았어요!','The Ember Crown is reclaimed!'):t('하늘숲에 바람이 돌아왔어요!','The winds return to Skybloom!'),()=>t('보스 여정에서 다시 도전할 수 있어요','Challenge again from Boss Journey'),'quest');
    } else if (boss === this.game.boss) {
      if (this.rustCleared) return;
      this.rustCleared = true;
      this.game.hud.chat.system(t('첫 왕관 획득! 해안 순찰로 10레벨을 달성하고 심해의 군주에게 도전하세요.','First crown reclaimed! Patrol the shore, reach level 10 and challenge the Lord of the Deep.'));
    } else if(boss===this.game.frostBoss){
      if(this.frostCleared)return;this.frostCleared=true;this.game.hud.messages.banner(()=>t('영원의 겨울을 녹였어요!','Eternal winter has ended!'),()=>t('미라 구출 · 서리 왕관 획득 · +18,000 XP','Mira rescued · Frozen crown reclaimed · +18,000 XP'),'quest');
    } else if(boss===this.game.dawnBoss){
      if(this.finalCleared)return;this.finalCleared=true;this.game.hud.chat.system(t('설원으로 가는 길이 열렸어요! 보레아스에게 잡힌 미라를 구하러 가요.','The route to Frostlight is open! Rescue Mira from Boreas.'));
    } else if (boss === this.game.worldBoss) {
      if(this.trueCleared) return;
      this.trueCleared=true;
      this.game.hud.chat.system(t('세 번째 왕관을 되찾았습니다. 골드샌드 항구로 가는 항로가 열렸어요.','The third crown is reclaimed. The sea route to Goldsand Harbor is open.'));
    } else {
      if (this.abyssCleared) return;
      this.abyssCleared = true;
      this.game.world.setMood(2);
      this.game.hud.chat.system(t('심해의 왕관을 되찾았습니다. 잠시 뒤 첫 엔딩과 숨겨진 세계가 열립니다.','You reclaimed the Deep Crown. The first ending and a hidden world await.'));
    }
    this.root.open = true;
    this.save();
  }

  private canJoin(boss: Boss): boolean {
    const g=this.game;
    return !!g.multiplayer?.battle.active && g.encounter===boss && boss.engaged &&
      Math.hypot(g.player.unit.pos.x-boss.arena.position.x,g.player.unit.pos.z-boss.arena.position.z)>boss.arena.radius+3;
  }

  private challenge(boss: Boss) {
    const g = this.game;
    const joining=this.canJoin(boss);
    if (boss.profile.level<20&&!g.beaconLit){g.hud.messages.info(t('등대를 켜면 밤이 되고 보스가 깨어나요.','Light the lighthouse to summon night and awaken the boss.'));return;}
    if (boss.state === 'dying' || !canChallenge(g.player.level, boss.profile.level, this.rustCleared, this.abyssCleared, g.world2.chapter) || g.controlsLocked || g.player.inCombat || (g.encounter.engaged&&!joining)) return;
    if (boss === g.finalBoss && g.boss.state !== 'dead') { g.hud.messages.info(t('첫 보스의 승리 연출이 끝난 뒤 도전해 주세요.','Wait until the first boss victory sequence ends.')); return; }
    if (!joining && !g.multiplayer?.battle.challenge(boss===g.skyBoss?'b750':boss===g.emberBoss?'b500':boss===g.frostBoss?'b300':boss===g.dawnBoss?'b30':boss === g.boss ? 'b3' : boss === g.worldBoss ? 'b20' : 'b10')) boss.wake();
    const a = boss.arena;
    // Enter on the deck's walkable approach, facing the centre.
    const dx = Math.sin(a.yaw), dz = Math.cos(a.yaw);
    const distance = Math.min(9, a.radius * 0.85);
    if(!joining)g.player.respawn();
    else {g.player.cancelChannel();g.player.interruptCast();g.player.setTarget(null);}
    g.player.unit.teleport(g.world, a.position.x + dx * distance, a.position.z + dz * distance, a.yaw + Math.PI);
    g.follow.cut();
    g.follow.yaw = g.player.unit.yaw + Math.PI;
    if(boss.profile.level<20)g.world.setMood(1);
    g.hud.dialogue.close();
    this.root.open = false;
    g.hud.messages.banner(() => (joining?t(`LEVEL ${boss.profile.level} · 전투 합류`,`LEVEL ${boss.profile.level} · BATTLE JOINED`):t(`LEVEL ${boss.profile.level} · 보스 도전`,`LEVEL ${boss.profile.level} · BOSS CHALLENGE`)),() => (boss.profile.name), 'boss');
  }

  update(dt: number) {
    const g = this.game;
    this.root.hidden = g.ending.active || g.cinematic;this.wallet.hidden=this.root.hidden;
    if (g.multiplayer?.battle.authority !== false && g.world2.chapter===1 && g.beaconLit && g.partyLevel >= 3 && !this.rustCleared && g.boss.state === 'dormant') g.boss.wake();
    if (g.multiplayer?.battle.mode!=='pvp' && this.abyssCleared && !this.firstEndingSeen && g.finalBoss.state === 'dead' && !this.chapterEnding && !this.chapterCelebrating && !g.ending.active && g.world2.chapter === 1) this.showChapterEnding();
    if(this.chapterEnding) {
      this.endingTime+=dt;
      this.chapterEnding.classList.toggle('revealed',this.endingTime>4);
      const button=this.chapterEnding.querySelector('button')!; button.disabled=this.endingTime<5;
      if(this.endingTime>12 && g.multiplayer?.battle.authority !== false) this.finishChapterEnding();
    }
    if(g.multiplayer?.battle.mode!=='pvp' && this.frostCleared && g.frostBoss.state==='dead' && g.world2.chapter===4 && !this.trueStarted && !g.ending.active) { this.trueStarted=true; this.save(); void g.ending.start(); }
    if(this.trueCleared&&g.worldBoss.state==='dead'&&!this.world2Celebrated&&!g.ending.active&&g.world2.chapter===2){this.world2Celebrated=true;g.hud.messages.banner(()=>t('월드3의 항로가 열렸어요!','The route to World III is open!'),()=>t('북쪽 별길의 포탈을 타고 친구를 구하러 떠나요','Take the north Starroad portal to rescue your friend'),'quest');this.save();}
    this.render();
    if ((this.saveAt += dt) > 3) { this.saveAt = 0; this.save(); }
    const crowned = g.world2.chapter===6?g.skyBoss:g.world2.chapter===5?g.emberBoss:g.world2.chapter===4?g.frostBoss:g.world2.chapter===3?g.dawnBoss:g.world2.chapter===2 ? g.worldBoss : g.finalBoss;
    const u = crowned.unit;
    this.aura.visible = !u.hidden && u.alive;
    this.aura.position.copy(u.pos);
    this.aura.position.y += u.height * 0.8;
    this.aura.rotation.y += dt * (crowned.enraged ? 1.2 : 0.35);
    this.aura.scale.setScalar(1 + Math.sin(g.time * 2) * 0.035);
  }

  /** Refresh copy while a solo Settings menu pauses simulation; never advance encounters. */
  refreshLanguage(): void { this.last = ''; this.render(); if (this.notice) this.showLost(); }

  private render(): void {
    const g = this.game, level = g.player.level;
    const remaining=Math.max(0,Math.ceil((g.player.xpBlessingUntil-Date.now())/1000));
    const state = `${remaining}|${language()}|${g.beaconLit}|${level}|${g.player.xp}|${this.kills}|${this.rustCleared}|${this.abyssCleared}|${g.player.inCombat}|${g.controlsLocked}|${this.canJoin(g.encounter)}|${g.finalBoss.state}|${g.boss.state}|${g.worldBoss.state}|${g.world2.chapter}|${this.firstEndingSeen}|${this.trueCleared}|${this.finalCleared}|${g.dawnBoss.state}|${g.player.coins}|${g.player.attackRank}|${g.player.armorRank}|${this.frostCleared}|${g.frostBoss.state}|${this.emberCleared}|${this.skyCleared}|${g.emberBoss.state}|${g.skyBoss.state}`;
    if (state !== this.last) {
      this.last = state;
      this.root.querySelector('summary')!.textContent=t('⚔ 보스 여정','⚔ Boss journey');
      this.root.querySelector('.bj-heading strong')!.textContent=t('여섯 세계와 일곱 왕관의 전설','Six Worlds, Seven Crowns');
      this.portal.textContent=t('✧ 월드 2 바로가기 →','✧ Travel to World II →');this.victory.textContent=t('✨ 춤추는 엔딩 다시 보기','✨ Replay the dance ending');
      this.wallet.textContent=t(`🪙 ${g.player.coins} · 무기 +${g.player.attackRank} · 방어구 +${g.player.armorRank}`,`🪙 ${g.player.coins} · Weapon +${g.player.attackRank} · Armor +${g.player.armorRank}`);this.wallet.hidden=g.cinematic||g.ending.active;
      if(remaining)this.wallet.textContent+=t(` · ✦ XP 1.5배 ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`,` · ✦ XP ×1.5 ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`);
      const next = xpForLevel(level+1);
      this.progress.textContent = t(`LEVEL ${level} → ${level + 1} · ${next - g.player.xp} XP 남음`,`LEVEL ${level} → ${level+1} · ${next-g.player.xp} XP to go`);
      for (const { boss, status, button } of this.cards) {
        const cleared = boss===g.skyBoss?this.skyCleared:boss===g.emberBoss?this.emberCleared:boss===g.frostBoss?this.frostCleared:boss === g.boss ? this.rustCleared : boss===g.dawnBoss?this.finalCleared:boss === g.worldBoss ? this.trueCleared : this.abyssCleared;
        const unlocked = canChallenge(level, boss.profile.level, this.rustCleared, this.abyssCleared, g.world2.chapter);
        const needsBeacon=boss.profile.level<20&&!g.beaconLit;
        const joining=this.canJoin(boss);
        status.textContent = cleared ? t('✓ 왕관 획득','✓ Crown reclaimed') : needsBeacon ? t('등대를 켜면 도전할 수 있어요.','Light the lighthouse to challenge this boss.') : unlocked ? (boss.engaged ? t('전투 중','In battle') : boss===g.skyBoss?t('도전 가능 · 세계수 성역','Ready · Worldtree Sanctuary'):boss===g.emberBoss?t('도전 가능 · 잿불 성역','Ready · Ember Sanctuary'):boss===g.frostBoss?t('도전 가능 · 얼음 왕좌','Ready · Frozen Throne'):boss===g.dawnBoss?t('도전 가능 · 황혼 성채','Ready · Twilight Citadel'):boss === g.worldBoss ? t('도전 가능 · 별의 왕좌','Ready · The Star Throne') : t('도전 가능 · 철의 난파선','Ready · The Iron Wreck')) : t(`🔒 ${boss.profile.level}레벨${boss.profile.level===750?' + 월드 6':boss.profile.level===500?' + 월드 5':boss.profile.level===300?' + 월드 4':boss.profile.level===100?' + 월드 3':boss.profile.level === 20 ? ' + 월드 2' : boss.profile.level === 10 ? ' + 첫 보스 승리' : ''} 필요`,`🔒 Requires level ${boss.profile.level}${boss.profile.level===750?' + World VI':boss.profile.level===500?' + World V':boss.profile.level===300?' + World IV':boss.profile.level===100?' + World III':boss.profile.level===20?' + World II':boss.profile.level===10?' + first boss victory':''}`);
        if(boss===this.game.worldBoss||boss===this.game.dawnBoss)status.textContent+=t(' · 처치 시 모든 XP 1.5배 · 10분',' · On victory: all XP ×1.5 · 10 min');
        status.textContent += t(` · 처치 보상 ${boss.profile.coins.toLocaleString()} 코인 · ${boss.profile.reward.toLocaleString()} XP`, ` · Victory reward: ${boss.profile.coins.toLocaleString()} coins · ${boss.profile.reward.toLocaleString()} XP`);
        button.disabled = boss.state === 'dying' || needsBeacon || !unlocked || g.controlsLocked || g.player.inCombat || (g.encounter.engaged&&!joining) || (boss === g.finalBoss && g.boss.state !== 'dead');
        button.textContent = boss.state === 'dead' ? t('다시 도전하기 →','Challenge again →') : boss.engaged ? joining?t('전투 합류 →','Join battle →'):t('전투 중','In battle') : t('도전하기 →','Challenge →');
        const card=button.closest('article')!;card.querySelector('h3')!.textContent=boss.profile.name;boss.unit.name=boss.profile.name;boss.unit.title=boss.profile.title;
        card.querySelector('p')!.textContent=boss.profile.level===750?t('바람 십자 · 별꽃 폭격 · 세계수의 안식처 · 750레벨','Windcross · Starflower barrage · Worldtree sanctuary · Level 750'):boss.profile.level===500?t('엇갈린 용암 폭격 · 화염 칼날 · 분화구 폭주 · 500레벨','Staggered magma · Furnace blades · Caldera enrage · Level 500'):boss.profile.level===300?t('서리 감옥 · 7중 눈보라 · 빙결 파동 · 300레벨','Frost prison · Sevenfold blizzard · Glacial pulse · Level 300'):boss.profile.level===100?t('8방향 화염 · 5중 폭격 · 극한 폭주 · 100레벨','Eight fire rays · Five bombs · Extreme enrage · Level 100'):boss.profile.level===20?t('검은 일식 · 안쪽 안전지대 · 별빛 폭주','Black Eclipse · Inner sanctuary · Starfall enrage'):boss.profile.level===10?t('심해 파동 · 끌어당기기 · 3단계 폭주','Tidal Nova · Undertow · Phase III enrage'):t('닻 내려찍기 · 녹 분사 · 하수인 소환','Anchor Slam · Rust Spray · Rustling summons');
      }
      this.portal.hidden = g.world2.chapter !== 1;this.portal.disabled=!this.abyssCleared;
      this.patrol.textContent = g.world2.chapter>=5?t(`WORLD ${g.world2.chapter===5?'V · 잿불 군도':'VI · 하늘숲'} · 마을 퀘스트 12개 · 순찰 ${this.kills}/5`,`WORLD ${g.world2.chapter===5?'V · Emberreach':'VI · Skybloom'} · 12 village quests · Patrol ${this.kills}/5`):g.world2.chapter===4?t(`WORLD IV · 서리빛 설원 · 목표 300레벨 · 순찰 ${this.kills}/5 · +${patrolReward(level)} XP`,`WORLD IV · Frostlight · Reach level 300 · Patrol ${this.kills}/5 · +${patrolReward(level)} XP`):g.world2.chapter===3?t(`WORLD III · 설원으로 가는 길 · 목표100레벨 · 순찰 ${this.kills}/5`,`WORLD III · The road to Frostlight · Reach level 100 · Patrol ${this.kills}/5`):this.trueCleared ? t('월드3가 열렸어요. 북쪽 별길의 포탈로 친구를 구하러 가세요.','World III is open. Take the north Starroad portal to rescue your friend.') : g.world2.chapter === 2 ? t(`WORLD II · 유적 순찰 ${this.kills}/5 · +${patrolReward(level)} XP · 목표 20레벨`,`WORLD II · Ruin patrol ${this.kills}/5 · +${patrolReward(level)} XP · Reach level 20`) : this.abyssCleared ? t('첫 엔딩 너머, 숨겨진 별의 섬으로…','Beyond the first ending, a hidden island awaits…') : this.rustCleared ? t(`해안 순찰 ${this.kills}/5 · 보너스 ${patrolReward(level)} XP`,`Shore patrol ${this.kills}/5 · Bonus ${patrolReward(level)} XP`) : t('마을 퀘스트와 해안 전투로 3레벨에 도달하세요.','Reach level 3 through village quests and shore battles.');
      this.root.querySelector('small')!.textContent=t('적을 처치하고 퀘스트를 완료하면 성장해요. 로그인하면 계정에도 모험이 자동 저장돼요.','Grow by defeating enemies and completing quests. Sign in to save your adventure to your account too.');
      this.victory.hidden = !this.frostCleared;
      this.victory.disabled = g.frostBoss.state !== 'dead' || g.controlsLocked;
    }
  }

  private showChapterEnding() {
    this.chapterCelebrating=true;
    void this.game.ending.start('chapter',()=>{this.chapterCelebrating=false;this.showChapterReveal();});
  }
  private showChapterReveal() {
    const g=this.game; this.endingTime=0; g.cinematic=true;
    g.player.setTarget(null); g.player.unit.invulnerable=true; g.hud.dialogue.close(); g.hud.setCinematic(true);
    this.chapterEnding=h('section',{class:'chapter-ending',role:'dialog','aria-label':t('첫 엔딩','First ending')},
      h('div',{class:'ce-stars'}),h('span',{class:'ce-kicker'},'CHAPTER I · THE TIDELANDS'),
      h('div',{class:'ce-crown'},'♛'),h('h1',null,t('심해의 왕관','The Deep Crown')),
      h('p',null,t('녹의 파도가 잠들고, 해안에 다시 빛이 돌아왔습니다.','The rust tide sleeps. Light has returned to the shore.')),
      h('div',{class:'ce-reveal'},h('span',null,t('하지만 왕관 속에는 또 하나의 별이 잠들어 있었습니다.','But another star was hidden inside the crown…')),h('h2',null,t('WORLD II · 잊힌 별의 섬','WORLD II · Isle of Forgotten Stars')),h('p',null,t('수정 유적 · 20레벨 일식 여왕 · 골드샌드 항구로 이어지는 항로','Crystal ruins · Level 20 Eclipse Queen · A route to Goldsand Harbor'))),
      h('button',{type:'button',disabled:true,onclick:()=>this.finishChapterEnding()},t('새로운 모험을 시작하기 →','Begin a new adventure →')));
    g.app.ui.append(this.chapterEnding);
  }
  private finishChapterEnding() {
    this.firstEndingSeen=true; this.closeChapterEnding(); this.save();
    this.root.open=true;
    if(this.game.multiplayer?.battle.authority === false&&!this.game.multiplayer.battle.sharedArea) {
      this.game.hud.messages.info(t('방장이 차원문을 열면 모두 함께 월드 2로 이동해요.','When the host opens the portal, everyone will travel to World II together.'));
    } else this.enterWorld2();
  }
  closeChapterEnding() {
    this.chapterCelebrating=false;
    if(!this.chapterEnding) return;
    this.chapterEnding.remove(); this.chapterEnding=null;
    this.game.cinematic=false; this.game.player.unit.invulnerable=false; this.game.hud.setCinematic(false);
  }
  private enterWorld2() {
    if(this.game.world2.chapter!==1 || this.game.controlsLocked) return;
    if(!this.abyssCleared){this.game.world2.go(2);return;}
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
    this.closeChapterEnding(); this.save(); this.root.remove();this.wallet.remove(); this.game.scene.remove(this.aura);
    this.hold?.dispose(); this.notice?.remove();
    const materials = new Set<THREE.Material>();
    this.aura.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); materials.add(o.material); } });
    for (const m of materials) m.dispose();
  }
}
