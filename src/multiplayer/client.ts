import { BattleSync } from './battle';
import { BreakRoutine, preloadRoutine } from '../game/breakdance';
import { ROUTINE } from '../motion/breakdance';
import * as THREE from 'three';
import type { Game } from '../game/game';
import { Unit } from '../game/unit';
import { createCrab } from '../crab/provider';
import type { CrabSpec } from '../crab/types';
import { createMotionController } from '../motion/provider';
import type { MotionId } from '../motion/types';
import { h } from '../ui/dom';
import './multiplayer.css';
import {t} from '../i18n';

type State = { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean; level?: number };
/** `dance`: the peer's breakdance, replayed here move by move as the peer announces them. */
type Peer = { spec: CrabSpec; unit: Unit | null; state: State | null; dance: BreakRoutine | null };

export class Multiplayer {
  readonly root: HTMLDetailsElement;
  readonly battle: BattleSync;
  private ws: WebSocket | null = null;
  private peers = new Map<string, Peer>();
  private room = '';
  private ownId = '';
  private disposed = false;
  private elapsed = 0;
  private partyElapsed=0;
  private partyKey='';
  private socialKey='';
  private readonly peerGoal=new THREE.Vector3();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private rejoinParty: number | null = null;
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
  private partyPanel=h('div',{class:'mp-party'});
  private statusText:[string,string]=['혼자 플레이 중','Playing solo'];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private game: Game) {
    this.battle = new BattleSync(game, packet => this.send(packet), () => this.peers);
    const form = h('form', { onsubmit: (e: Event) => { e.preventDefault(); this.connect('join', this.input.value); } }, this.input, this.join);
    const chatForm = h('form', { onsubmit: (e: Event) => {
      e.preventDefault();
      if (this.room && this.chat.value.trim()) { this.send({ type: 'chat', text: this.chat.value }); this.chat.value = ''; }
    } }, this.chat, this.sendButton);
    this.root = h('details', { class: 'mp-panel', open: new URLSearchParams(location.search).has('multiplayer') || new URLSearchParams(location.search).has('room') },
      h('summary', null, t('🦀 멀티플레이','🦀 Multiplayer')), this.status,
      h('p', {class:'mp-intro'}, t('최대 8명 · 함께 모험하거나 싸우기 모드로 대전해요. 같은 파티는 서로 공격하지 않아요. 퀘스트는 각자 진행해요.','Up to 8 players · Adventure together or duel in PvP. Teammates cannot hurt each other. Quests progress individually.')),
      this.code, h('div', { class: 'mp-row' }, this.create, this.share, this.leave), form, this.invite, this.roster,
      h('div', { class: 'mp-row' }, h('button', { type: 'button', 'data-emote':'hello', onclick: () => this.emote('gesture_hello') }, '👋 인사'), h('button', { type: 'button', 'data-emote':'dance', onclick: () => this.emote('dance_crab') }, '💃 춤'),
        // The B emote. The button gives the keyboard back so moving can end the routine.
        h('button', { type: 'button', 'data-emote':'breakdance', onclick: (e: Event) => { (e.currentTarget as HTMLElement).blur(); this.game.player.toggleBreakdance(); } }, '🕺 브레이크댄스')),
      h('div',{class:'mp-row'},h('button',{type:'button','data-mode':'coop',onclick:()=>this.battle.setMode('coop')},t('협동 모드','Co-op')),h('button',{type:'button','data-mode':'pvp',onclick:()=>this.battle.setMode('pvp')},t('⚔ 싸우기 모드','⚔ PvP'))),
      h('div',{class:'mp-row'},...([0,1,2,3,4].map(p=>h('button',{type:'button','data-party':p,onclick:()=>this.battle.setParty(p)},p===0?t('혼자','Solo'):`${t('파티','Party')} ${p}`)))),
      this.partyPanel,this.log, chatForm,
    );
    // Opening a form clears held movement keys. Typing never controls the crab.
    this.root.addEventListener('focusin', () => window.dispatchEvent(new Event('blur')));
    this.root.addEventListener('keydown', e => e.stopPropagation());
    game.hud.tracker.el.after(this.root);
    game.player.unit.onAction = action => this.send({ type: 'action', action });
    game.player.unit.onBreakdanceStop = () => this.send({ type: 'action', action: 'breakdance_stop' });
    this.refreshLanguage();
    const room = new URLSearchParams(location.search).get('room');
    if (room) { this.input.value = room; this.timer = setTimeout(() => this.connect('join', room), 500); }
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 65536) this.ws.send(JSON.stringify(msg));
  }

  private connect(type: 'create' | 'join', room = '') {
    if (this.disposed) return;
    const code = room.trim().toUpperCase();
    if (type === 'join' && !/^[A-F0-9]{6}$/.test(code)) { this.setStatus('방 코드 6자리를 확인해 주세요.','Check the six-character room code.'); return; }
    this.battle.leave(); this.closeSocket();
    this.room = '';
    this.retries = 0;
    this.openSocket(type, code);
  }

  private openSocket(type: 'create' | 'join', code: string) {
    this.setStatus('연결 중…','Connecting…');
    const url = new URL(import.meta.env.VITE_MULTIPLAYER_URL || '/multiplayer', location.href);
    url.protocol = url.protocol === 'https:' || location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = ''; url.hash = '';
    url.searchParams.set('mode', type);
    if (code) url.searchParams.set('room', code);
    const ws = new WebSocket(url);
    this.ws = ws;
    this.updateUi();
    const timeout = setTimeout(() => ws.close(), 10000);
    ws.onopen = () => { clearTimeout(timeout); if (this.ws === ws) this.send({ type, room: code, combatVersion: 1, spec: this.game.player.unit.rig.spec }); };
    ws.onmessage = e => {
      if (this.ws !== ws || this.disposed) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          this.room = msg.room; this.ownId = msg.id; this.retries = 0;
          this.battle.join(msg.id, msg.host, msg.world);
          // A transport retry receives a new ID; restore only its explicit team choice.
          const party=this.rejoinParty;this.rejoinParty=null;
          if(party!==null)this.battle.setParty(party);
          for (const p of msg.players) this.addPeer(p.id, p.spec, p.state);
          this.setStatus('연결됨 · 친구를 초대해 보세요!','Connected · Invite a friend!');
          this.input.value = this.room;
          this.note(t(`방 ${this.room}에 참가했어요.`,`Joined room ${this.room}.`));
          this.updateUi();
          break;
        case 'authority': this.battle.elect(msg.host); break;
        case 'world': if (!this.battle.authority) this.battle.apply(msg.world); break;
        case 'combat': this.battle.receive(msg.id, msg.event); break;
        case 'joined': this.addPeer(msg.id, msg.spec, null); this.note(t(`${msg.spec.name}님이 들어왔어요.`,`${msg.spec.name} joined.`)); this.updateUi(); break;
        case 'left': this.removePeer(msg.id); this.updateUi(); break;
        case 'state': { const p = this.peers.get(msg.id); if (p) p.state = msg.state; break; }
        case 'action': this.peerAction(msg.id, msg.action); break;
        case 'chat':
          this.note(`${msg.name}: ${msg.text}`);
          { const unit = msg.id === this.ownId ? this.game.player.unit : this.peers.get(msg.id)?.unit;
            if (unit) this.game.hud.bubbles.say(this.game, unit, msg.text); }
          break;
        case 'error': this.setStatus(...this.serverError(String(msg.message))); this.room = ''; this.battle.leave(); this.closeSocket(); this.updateUi(); break;
      }
    };
    ws.onerror = () => { /* onclose handles retry and the user-facing error */ };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws !== ws || this.disposed) return;
      this.ws = null;
      this.clearPeers();
      if (this.room && this.retries++ < 5) {
        this.rejoinParty ??= this.battle.parties[this.ownId] ?? null;
        this.setStatus('연결이 끊겼어요. 다시 연결 중…','Disconnected. Reconnecting…');
        const previousRoom = this.room;
        this.retry = setTimeout(() => this.openSocket('join', previousRoom), 1500);
      } else { this.rejoinParty=null;this.battle.leave(); this.room = ''; this.setStatus('연결할 수 없어요. 서버와 방 코드를 확인하고 다시 참가해 주세요.','Could not connect. Check the room code and try joining again.'); }
      this.updateUi();
    };
  }

  private addPeer(id: string, spec: CrabSpec, state: State | null) {
    if (this.peers.has(id) || id === this.ownId) return;
    const peer: Peer = { spec, state, unit: null, dance: null };
    void preloadRoutine();
    this.peers.set(id, peer);
    void createCrab(spec).then(rig => {
      if (this.disposed || this.peers.get(id) !== peer) { rig.dispose(); return; }
      const unit = new Unit(spec.name, 'remote', 'friendly', rig, createMotionController(rig));
      unit.title = t('함께 전투 중','Adventuring together'); unit.targetable = false; unit.invulnerable = true;
      const spawn = state ?? this.game.player.unit.pos;
      unit.pos.set(spawn.x, 'y' in spawn ? spawn.y : 0, spawn.z);
      unit.hidden = !peer.state;
      this.game.scene.add(rig.root);
      this.game.units.push(unit);
      unit.measure();
      peer.unit = unit;
    }).catch(() => { if (!this.disposed) this.note(t(`${spec.name} 캐릭터를 불러오지 못했어요.`,`Could not load ${spec.name}’s character.`)); });
  }

  update(dt: number) {
    this.elapsed += dt;
    if (this.room && this.elapsed >= 0.05) {
      this.elapsed = 0;
      const u = this.game.player.unit;
      this.send({ type: 'state', state: { x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.yaw, hp: u.hp, maxHp: u.maxHp, alive: u.alive, level: u.level } });
    }
    for (const [id,p] of this.peers) {
      const u = p.unit, s = p.state;
      if (!u || !s) continue;
      u.hidden = false;
      const rival=this.battle.mode==='pvp'&&!this.battle.sameParty(this.ownId,id);
      u.reaction=rival?'hostile':'friendly';u.targetable=rival;u.invulnerable=!rival;
      u.title=`${rival?t('대전 상대','Rival'):t('친구','Friend')} · ${t('파티','Party')} ${this.battle.partyOf(id)||'—'}`;
      const goal = this.peerGoal.set(s.x, s.y, s.z);
      const k = u.pos.distanceToSquared(goal) > 100 ? 1 : 1 - Math.exp(-18 * dt);
      u.pos.lerp(goal, k);
      const angle = Math.atan2(Math.sin(s.yaw - u.yaw), Math.cos(s.yaw - u.yaw));
      u.setYaw(u.yaw + angle * k);
      u.hp = s.hp; u.maxHp = s.maxHp; u.alive = s.alive; u.level = s.level ?? 1;
      u.feedLocomotion(dt);
      p.dance?.update(dt);
      if (this.game.hud.menu.open) u.updateVisual(dt);
    }
    this.battle.update(dt);
    this.partyElapsed+=dt;
    if(this.partyElapsed>=.25){this.partyElapsed=0;this.updateSocialButtons();this.updatePartyPanel();}
  }

  private updatePartyPanel(){
    const heading=this.battle.mode==='pvp'?t('⚔ 싸우기 모드 · 같은 파티는 공격하지 않아요','⚔ PvP · teammates are protected'):t('🤝 협동 모드 · 모두 함께 모험해요','🤝 Co-op · adventure together');
    const members=[{id:this.ownId,name:this.game.player.unit.name,unit:this.game.player.unit},...[...this.peers].map(([id,p])=>({id,name:p.spec.name,unit:p.unit}))].map(p=>({
      id:p.id,name:p.name,hp:p.unit?.hp??0,max:p.unit?.maxHp??1,party:this.battle.partyOf(p.id),
    }));
    // Keep the existing nodes while their displayed state is unchanged. In particular,
    // an idle room must not rebuild all health meters four times every second.
    const partyLabel=t('파티','Party'),soloLabel=t('개인','Solo');
    const key=JSON.stringify([heading,partyLabel,soloLabel,members]);
    if(key===this.partyKey)return;
    this.partyKey=key;
    this.partyPanel.replaceChildren(h('strong',null,heading),...members.map(p=>
      h('div',{class:`mp-member party-${p.party}`},h('span',null,`${p.party?`${partyLabel} ${p.party}`:soloLabel} · ${p.name}`),h('meter',{min:0,max:p.max,value:p.hp}),h('small',null,`${Math.ceil(p.hp)} / ${Math.ceil(p.max)}`))));
  }

  mapParty(unit:Unit):{party:number;teammate:boolean}|null{
    for(const [id,peer] of this.peers)if(peer.unit===unit)return {party:this.battle.partyOf(id),teammate:this.battle.sameParty(this.ownId,id)};
    return null;
  }

  private emote(action: MotionId) { if (this.game.player.unit.alive) this.game.player.unit.act(action); }
  /** A peer's clip, or a move of its breakdance (played with the routine's timing), or its stop. */
  private peerAction(id: string, action: string) {
    const p = this.peers.get(id), u = p?.unit;
    if (!p || !u) return;
    const step = ROUTINE.findIndex(s => s.id === action);
    if (step >= 0) (p.dance ??= new BreakRoutine(u)).follow(step);
    else if (action === 'breakdance_stop') p.dance?.cancel();
    else u.act(action as MotionId);
  }
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
    this.roster.textContent = this.room ? `${this.peers.size+1}/8${t('명',' players')} · ${[this.game.player.unit.name,...[...this.peers.values()].map(p=>p.spec.name)].join(', ')}` : '';
    this.invite.hidden = !connected;
    this.invite.value = this.inviteUrl();
  }
  private setStatus(ko:string,en:string){this.statusText=[ko,en];this.status.textContent=t(ko,en);}
  private serverError(message:string):[string,string]{
    const errors:[string,string][]=[['캐릭터 정보를 확인해 주세요.','Invalid character.'],['서버가 가득 찼어요. 잠시 뒤 다시 시도하세요.','Server full. Try again later.'],['방을 찾을 수 없어요. 6자리 코드를 확인하세요.','Room not found. Check the six-character code.'],['방이 가득 찼어요. 최대 8명까지 참가할 수 있어요.','Room is full (8 players).']];
    return errors.find(pair=>pair.includes(message))??[message,message];
  }
  refreshLanguage(){
    this.root.querySelector('summary')!.textContent=t('🦀 멀티플레이','🦀 Multiplayer');
    this.root.querySelector('.mp-intro')!.textContent=t('최대 8명 · 함께 모험하거나 싸우기 모드로 대전해요. 같은 파티는 서로 공격하지 않아요. 퀘스트는 각자 진행해요.','Up to 8 players · Adventure together or duel in PvP. Teammates cannot hurt each other. Quests progress individually.');
    for(const [button,ko,en] of [[this.create,'방 만들기','Create room'],[this.join,'참가','Join'],[this.leave,'나가기','Leave'],[this.share,'초대 링크 복사','Copy invite link'],[this.sendButton,'전송','Send']] as const)button.textContent=t(ko,en);
    this.input.placeholder=t('방 코드 6자리','Six-character room code');this.input.setAttribute('aria-label',t('방 코드','Room code'));
    this.chat.placeholder=t('친구에게 말하기','Message your friends');this.chat.setAttribute('aria-label',t('채팅 메시지','Chat message'));
    this.log.setAttribute('aria-label',t('방 채팅','Room chat'));this.invite.setAttribute('aria-label',t('초대 링크','Invite link'));
    this.root.querySelector('[data-emote="hello"]')!.textContent=t('👋 인사','👋 Wave');this.root.querySelector('[data-emote="dance"]')!.textContent=t('💃 춤','💃 Dance');
    this.root.querySelector('[data-emote="breakdance"]')!.textContent=t('🕺 브레이크댄스','🕺 Breakdance');
    this.setStatus(...this.statusText);this.updateUi();this.updateSocialButtons();
  }
  private updateSocialButtons(){
    const key=JSON.stringify([t('파티','Party'),this.battle.active,this.battle.authority,this.game.encounter.engaged,!!this.room,this.battle.mode,this.battle.partyOf(this.ownId)]);
    if(key===this.socialKey)return;
    this.socialKey=key;
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')){
      const mode=button.dataset.mode!;button.textContent=mode==='coop'?t('협동 모드','Co-op'):t('⚔ 싸우기 모드','⚔ PvP');
      button.disabled=!this.battle.active||!this.battle.authority||this.game.encounter.engaged;
      button.title=!!this.room&&!this.battle.authority?t('방장이 모드를 바꿀 수 있어요.','Only the host can change the mode.'):'';
      button.setAttribute('aria-pressed',String(this.battle.mode===mode));
    }
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-party]')){
      const party=Number(button.dataset.party);button.disabled=!this.battle.active;button.textContent=party===0?t('혼자','Solo'):`${t('파티','Party')} ${party}`;
      button.setAttribute('aria-pressed',String(this.battle.partyOf(this.ownId)===party));
    }
  }
  private inviteUrl() {
    const url = new URL(location.href);
    url.search = ''; url.hash = '';
    url.searchParams.set('room', this.room);
    return url.toString();
  }
  private async copyInvite() {
    try { await navigator.clipboard.writeText(this.inviteUrl()); this.setStatus('초대 링크를 복사했어요!','Invite link copied!'); }
    catch { this.invite.select(); this.setStatus('아래 초대 링크를 복사해 주세요.','Copy the invite link below.'); }
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
    this.rejoinParty=null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws; this.ws = null;
    ws?.close(); this.clearPeers();
  }
  private disconnect() { this.battle.leave(); this.room = ''; this.closeSocket(); this.setStatus('혼자 플레이 중','Playing solo'); this.updateUi(); }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.game.player.unit.onAction = null;
    this.game.player.unit.onBreakdanceStop = null;
    this.battle.dispose(); this.closeSocket(); this.root.remove();
  }
}
