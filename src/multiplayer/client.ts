import * as THREE from 'three';
import type { Game } from '../game/game';
import { Unit } from '../game/unit';
import { createCrab } from '../crab/provider';
import type { CrabSpec } from '../crab/types';
import { createMotionController } from '../motion/provider';
import type { MotionId } from '../motion/types';
import { h } from '../ui/dom';
import './multiplayer.css';

type State = { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean };
type Peer = { spec: CrabSpec; unit: Unit | null; state: State | null };

export class Multiplayer {
  readonly root: HTMLDetailsElement;
  private ws: WebSocket | null = null;
  private peers = new Map<string, Peer>();
  private room = '';
  private ownId = '';
  private disposed = false;
  private elapsed = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private status = h('p', { class: 'mp-status', role: 'status' }, '혼자 플레이 중');
  private code = h('div', { class: 'mp-code' });
  private roster = h('div', { class: 'mp-roster' });
  private log = h('div', { class: 'mp-log', role: 'log', 'aria-label': '방 채팅' });
  private input = h('input', { maxlength: 6, placeholder: '방 코드 6자리', 'aria-label': '방 코드', autocomplete: 'off' });
  private chat = h('input', { maxlength: 200, placeholder: '친구에게 말하기', 'aria-label': '채팅 메시지', autocomplete: 'off' });
  private create = h('button', { type: 'button', onclick: () => this.connect('create') }, '방 만들기');
  private join = h('button', { type: 'submit' }, '참가');
  private leave = h('button', { type: 'button', onclick: () => this.disconnect() }, '나가기');
  private share = h('button', { type: 'button', onclick: () => void this.copyInvite() }, '초대 링크 복사');
  private invite = h('input', { readonly: true, class: 'mp-invite', 'aria-label': '초대 링크', onclick: (e: Event) => (e.target as HTMLInputElement).select() });
  private sendButton = h('button', { type: 'submit' }, '전송');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private game: Game) {
    const form = h('form', { onsubmit: (e: Event) => { e.preventDefault(); this.connect('join', this.input.value); } }, this.input, this.join);
    const chatForm = h('form', { onsubmit: (e: Event) => {
      e.preventDefault();
      if (this.room && this.chat.value.trim()) { this.send({ type: 'chat', text: this.chat.value }); this.chat.value = ''; }
    } }, this.chat, this.sendButton);
    this.root = h('details', { class: 'mp-panel', open: new URLSearchParams(location.search).has('multiplayer') || new URLSearchParams(location.search).has('room') },
      h('summary', null, '🦀 멀티플레이'), this.status,
      h('p', null, '최대 8명 · 함께 탐험하고 채팅해요. 퀘스트와 몬스터 전투는 각자 진행해요.'),
      this.code, h('div', { class: 'mp-row' }, this.create, this.share, this.leave), form, this.invite, this.roster,
      h('div', { class: 'mp-row' }, h('button', { type: 'button', onclick: () => this.emote('gesture_hello') }, '👋 인사'), h('button', { type: 'button', onclick: () => this.emote('dance_crab') }, '💃 춤')),
      this.log, chatForm,
    );
    // Opening a form clears held movement keys. Typing never controls the crab.
    this.root.addEventListener('focusin', () => window.dispatchEvent(new Event('blur')));
    this.root.addEventListener('keydown', e => e.stopPropagation());
    game.hud.sidePanels.prepend(this.root);
    game.player.unit.onAction = action => this.send({ type: 'action', action });
    this.updateUi();
    const room = new URLSearchParams(location.search).get('room');
    if (room) { this.input.value = room; this.timer = setTimeout(() => this.connect('join', room), 500); }
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 65536) this.ws.send(JSON.stringify(msg));
  }

  private connect(type: 'create' | 'join', room = '') {
    if (this.disposed) return;
    const code = room.trim().toUpperCase();
    if (type === 'join' && !/^[A-F0-9]{6}$/.test(code)) { this.status.textContent = '방 코드 6자리를 확인해 주세요.'; return; }
    this.closeSocket();
    this.room = '';
    this.retries = 0;
    this.openSocket(type, code);
  }

  private openSocket(type: 'create' | 'join', code: string) {
    this.status.textContent = '연결 중…';
    const url = new URL(import.meta.env.VITE_MULTIPLAYER_URL || '/multiplayer', location.href);
    url.protocol = url.protocol === 'https:' || location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = ''; url.hash = '';
    url.searchParams.set('mode', type);
    if (code) url.searchParams.set('room', code);
    const ws = new WebSocket(url);
    this.ws = ws;
    this.updateUi();
    const timeout = setTimeout(() => ws.close(), 10000);
    ws.onopen = () => { clearTimeout(timeout); if (this.ws === ws) this.send({ type, room: code, spec: this.game.player.unit.rig.spec }); };
    ws.onmessage = e => {
      if (this.ws !== ws || this.disposed) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          this.room = msg.room; this.ownId = msg.id; this.retries = 0;
          for (const p of msg.players) this.addPeer(p.id, p.spec, p.state);
          this.status.textContent = '연결됨 · 친구를 초대해 보세요!';
          this.input.value = this.room;
          this.note(`방 ${this.room}에 참가했어요.`);
          this.updateUi();
          break;
        case 'joined': this.addPeer(msg.id, msg.spec, null); this.note(`${msg.spec.name}님이 들어왔어요.`); this.updateUi(); break;
        case 'left': this.removePeer(msg.id); this.updateUi(); break;
        case 'state': { const p = this.peers.get(msg.id); if (p) p.state = msg.state; break; }
        case 'action': this.peers.get(msg.id)?.unit?.act(msg.action); break;
        case 'chat':
          this.note(`${msg.name}: ${msg.text}`);
          { const unit = msg.id === this.ownId ? this.game.player.unit : this.peers.get(msg.id)?.unit;
            if (unit) this.game.hud.bubbles.say(this.game, unit, msg.text); }
          break;
        case 'error': this.status.textContent = msg.message; this.room = ''; this.closeSocket(); this.updateUi(); break;
      }
    };
    ws.onerror = () => { /* onclose handles retry and the user-facing error */ };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws !== ws || this.disposed) return;
      this.ws = null;
      this.clearPeers();
      if (this.room && this.retries++ < 5) {
        this.status.textContent = '연결이 끊겼어요. 다시 연결 중…';
        const previousRoom = this.room;
        this.retry = setTimeout(() => this.openSocket('join', previousRoom), 1500);
      } else { this.room = ''; this.status.textContent = '연결할 수 없어요. 서버와 방 코드를 확인하고 다시 참가해 주세요.'; }
      this.updateUi();
    };
  }

  private addPeer(id: string, spec: CrabSpec, state: State | null) {
    if (this.peers.has(id) || id === this.ownId) return;
    const peer: Peer = { spec, state, unit: null };
    this.peers.set(id, peer);
    void createCrab(spec).then(rig => {
      if (this.disposed || this.peers.get(id) !== peer) { rig.dispose(); return; }
      const unit = new Unit(spec.name, 'remote', 'friendly', rig, createMotionController(rig));
      unit.title = '함께 탐험 중'; unit.targetable = false; unit.invulnerable = true;
      const spawn = state ?? this.game.player.unit.pos;
      unit.pos.set(spawn.x, 'y' in spawn ? spawn.y : 0, spawn.z);
      unit.hidden = !peer.state;
      this.game.scene.add(rig.root);
      this.game.units.push(unit);
      unit.measure();
      peer.unit = unit;
    }).catch(() => { if (!this.disposed) this.note(`${spec.name} 캐릭터를 불러오지 못했어요.`); });
  }

  update(dt: number) {
    this.elapsed += dt;
    if (this.room && this.elapsed >= 0.05) {
      this.elapsed = 0;
      const u = this.game.player.unit;
      this.send({ type: 'state', state: { x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.yaw, hp: u.hp, maxHp: u.maxHp, alive: u.alive } });
    }
    for (const p of this.peers.values()) {
      const u = p.unit, s = p.state;
      if (!u || !s) continue;
      u.hidden = false;
      const goal = new THREE.Vector3(s.x, s.y, s.z);
      const k = u.pos.distanceToSquared(goal) > 100 ? 1 : 1 - Math.exp(-18 * dt);
      u.pos.lerp(goal, k);
      const angle = Math.atan2(Math.sin(s.yaw - u.yaw), Math.cos(s.yaw - u.yaw));
      u.setYaw(u.yaw + angle * k);
      u.hp = s.hp; u.maxHp = s.maxHp; u.alive = s.alive;
      u.feedLocomotion(dt);
      if (this.game.hud.menu.open) u.updateVisual(dt);
    }
  }

  private emote(action: MotionId) { if (this.room && this.game.player.unit.alive) this.game.player.unit.act(action); }
  private note(text: string) {
    this.log.append(h('div', null, text));
    while (this.log.childElementCount > 40) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
  private updateUi() {
    const connected = !!this.room && this.ws?.readyState === WebSocket.OPEN;
    const connecting = this.ws?.readyState === WebSocket.CONNECTING;
    this.create.disabled = !!connecting || !!connected;
    this.join.disabled = !!connecting || !!connected;
    this.share.disabled = !connected;
    this.leave.disabled = !this.ws && !this.room;
    this.chat.disabled = !connected; this.sendButton.disabled = !connected;
    this.code.textContent = this.room;
    this.roster.textContent = this.room ? `${this.peers.size + 1}/8명 · ${[this.game.player.unit.name, ...[...this.peers.values()].map(p => p.spec.name)].join(', ')}` : '';
    this.invite.hidden = !connected;
    this.invite.value = this.inviteUrl();
  }
  private inviteUrl() {
    const url = new URL(location.href);
    url.search = ''; url.hash = '';
    url.searchParams.set('room', this.room);
    return url.toString();
  }
  private async copyInvite() {
    try { await navigator.clipboard.writeText(this.inviteUrl()); this.status.textContent = '초대 링크를 복사했어요!'; }
    catch { this.invite.select(); this.status.textContent = '아래 초대 링크를 복사해 주세요.'; }
  }
  private removePeer(id: string) {
    const p = this.peers.get(id);
    if (p?.unit) {
      if (this.game.player.target === p.unit) this.game.player.setTarget(null);
      this.game.scene.remove(p.unit.rig.root);
      this.game.units = this.game.units.filter(u => u !== p.unit);
      p.unit.dispose();
    }
    this.peers.delete(id);
  }
  private clearPeers() { for (const id of this.peers.keys()) this.removePeer(id); }
  private closeSocket() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws; this.ws = null;
    ws?.close(); this.clearPeers();
  }
  private disconnect() { this.room = ''; this.closeSocket(); this.status.textContent = '혼자 플레이 중'; this.updateUi(); }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.game.player.unit.onAction = null;
    this.closeSocket(); this.root.remove();
  }
}
