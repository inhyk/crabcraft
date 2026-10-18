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
import { Link, type Lost, type Message, type Mode } from './link';
import { Blocklist, REPORT_REASONS, chatSession, displayName, markSafetyNote, publicChatOn, safetyNoteSeen } from './chatSafety';

type State = { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean; level?: number };
/** `dance`: the peer's breakdance, replayed here move by move as the peer announces them. */
type Peer = { spec: CrabSpec; unit: Unit | null; state: State | null; dance: BreakRoutine | null };
const ROMAN = ['', 'I', 'II', 'III', 'IV'];

/**
 * Entering the world joins a public shard of the current world area; travelling moves to that area's shard.
 * A shard shares presence, emotes and chat, and opt-in shared combat, lighthouse and boats. Quests, saves and portal travel stay personal.
 * A code room with friends (`room`) shares one simulated world: bosses, travel and parties.
 * A dropped shard socket keeps coming back (see ./link); a code room retries a few times, then returns to the public world.
 * The server masks chat; here a player can block and report others and hide public chat (./chatSafety).
 */
export class Multiplayer {
  readonly root: HTMLDetailsElement;
  readonly battle: BattleSync;
  private readonly link: Link;
  private peers = new Map<string, Peer>();
  private room = '';
  /** Public shard code and its world area while in one. */
  private shard = '';
  private area = 0;
  private offline = false;
  private ownId = '';
  private disposed = false;
  private elapsed = 0;
  private partyElapsed=0;
  private partyKey='';
  private partySize:ResizeObserver;
  private socialKey='';
  private readonly peerGoal=new THREE.Vector3();
  private rejoinParty: number | null = null;
  private status = h('p', { class: 'mp-status', role: 'status' }, '연결 중…');
  private summary = h('summary', null, '🦀');
  private intro = h('p', { class: 'mp-intro' });
  private friends = h('h3', { class: 'mp-friends' });
  private reconnect = h('button', { type: 'button', class: 'mp-reconnect', hidden: true, onclick: () => this.connect('enter') }, '다시 연결');
  private modeRow: HTMLElement;
  private partyRow: HTMLElement;
  private code = h('div', { class: 'mp-code' });
  private roster = h('div', { class: 'mp-roster' });
  private log = h('div', { class: 'mp-log', role: 'log', 'aria-label': '방 채팅' });
  private input = h('input', { maxlength: 6, placeholder: '방 코드 6자리', 'aria-label': '방 코드', autocomplete: 'off' });
  private chat = h('input', { maxlength: 200, placeholder: '친구에게 말하기', 'aria-label': '채팅 메시지', autocomplete: 'off' });
  private pendingDuel = false;
  private duelCreate = h('button', { type:'button', class:'mp-duel-create', onclick:()=>this.connect('create','',true) }, '⚔ 친구랑 싸우기');
  private duelHelp = h('p', {class:'mp-duel-help'});
  private create = h('button', { type: 'button', onclick: () => this.connect('create') }, '방 만들기');
  private join = h('button', { type: 'submit' }, '참가');
  private leave = h('button', { type: 'button', onclick: () => this.disconnect() }, '나가기');
  private share = h('button', { type: 'button', onclick: () => void this.copyInvite() }, '초대 링크 복사');
  private invite = h('input', { readonly: true, class: 'mp-invite', 'aria-label': '초대 링크', onclick: (e: Event) => (e.target as HTMLInputElement).select() });
  private sendButton = h('button', { type: 'submit' }, '전송');
  private partyPanel=h('section',{class:'mp-party mp-party-hud',hidden:true,'aria-label':t('파티원 목록','Party roster')});
  private statusText:[string,string]=['연결 중…','Connecting…'];
  private readonly blocked = new Blocklist();
  private readonly session = chatSession();
  private publicChat = publicChatOn();
  /** The player whose block and report buttons are open, from the roster or a chat line. */
  private picked: { id: string; name: string; reporting: boolean } | null = null;
  private actions = h('div', { class: 'mp-act', role: 'group', hidden: true });
  private blockedList = h('details', { class: 'mp-blocked', hidden: true });
  private rosterKey = '';
  private renamedNoted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private game: Game) {
    this.link = new Link((mode, room) => this.socketUrl(mode, room), {
      hello: (mode, room) => {
        const spec = this.game.player.unit.rig.spec;
        const session = this.session;
        return mode === 'enter' ? { type: mode, area: this.game.world2.chapter, combatVersion:1, snowWorld:true, sharedWorld:1, spec, session } : { type: mode, room, combatVersion: 1, snowWorld:true, spec, session };
      },
      message: msg => this.receive(msg),
      lost: info => this.lost(info),
      back: ({ gap, restart }) => {
        // A short blip passes unnoticed; after a longer gap in the public world, say why the crowd vanished and came back.
        if (gap < 3000 || this.room) return;
        this.game.hud.messages.info(restart ? t('서버가 다시 시작돼서 다시 연결했어요.','Reconnected after a server restart.') : t('다시 연결했어요.','Reconnected.'));
      },
    });
    this.battle = new BattleSync(game, packet => this.send(packet), () => this.peers);
    const form = h('form', { onsubmit: (e: Event) => { e.preventDefault(); this.connect('join', this.input.value); } }, this.input, this.join);
    const chatForm = h('form', { onsubmit: (e: Event) => {
      e.preventDefault();
      if ((this.room || this.shard) && this.chat.value.trim()) { this.send({ type: 'chat', text: this.chat.value }); this.chat.value = ''; }
    } }, this.chat, this.sendButton);
    // Once, the first time the chat opens among strangers.
    this.chat.addEventListener('focus', () => {
      if (!this.shard || safetyNoteSeen()) return;
      markSafetyNote();
      this.note(t('모르는 사람에게 이름, 학교, 전화번호를 알려 주지 마세요.','Never share your name, school or phone number with strangers.'), 'mp-safety');
    });
    this.modeRow = h('div',{class:'mp-row'},h('button',{type:'button','data-mode':'coop',onclick:()=>this.battle.setMode('coop')},t('협동 모드','Co-op')),h('button',{type:'button','data-mode':'pvp',onclick:()=>this.battle.setMode('pvp')},t('⚔ 싸우기 모드','⚔ PvP')));
    this.partyRow = h('div',{class:'mp-row'},...([0,1,2,3,4].map(p=>h('button',{type:'button','data-party':p,onclick:()=>this.battle.setParty(p)},p===0?t('혼자','Solo'):`${t('파티','Party')} ${p}`))));
    const params = new URLSearchParams(location.search);
    this.root = h('details', { class: 'mp-panel', open: params.has('multiplayer') || params.has('room') },
      this.summary, this.status, this.intro, this.roster, this.blockedList, this.reconnect,
      this.friends, this.code, h('div', { class: 'mp-row' }, this.create, this.duelCreate, this.share, this.leave), form, this.invite,
      h('div', { class: 'mp-row' }, h('button', { type: 'button', 'data-emote':'hello', onclick: () => this.emote('gesture_hello') }, '👋 인사'), h('button', { type: 'button', 'data-emote':'dance', onclick: () => this.emote('dance_crab') }, '💃 춤'),
        // The B emote. The button gives the keyboard back so moving can end the routine.
        h('button', { type: 'button', 'data-emote':'breakdance', onclick: (e: Event) => { (e.currentTarget as HTMLElement).blur(); this.game.player.toggleBreakdance(); } }, '🕺 브레이크댄스')),
      this.modeRow, this.duelHelp, this.partyRow,
      this.actions,this.log, chatForm,
    );
    // Opening a form clears held movement keys. Typing never controls the crab.
    this.root.addEventListener('focusin', () => window.dispatchEvent(new Event('blur')));
    this.root.addEventListener('keydown', e => e.stopPropagation());
    game.hud.tracker.el.after(this.root);
    game.hud.root.append(this.partyPanel);
    this.partySize=new ResizeObserver(()=>game.app.ui.style.setProperty('--party-roster-height',`${this.partyPanel.offsetHeight}px`));
    this.partySize.observe(this.partyPanel);
    game.player.unit.onAction = action => this.send({ type: 'action', action });
    game.player.unit.onBreakdanceStop = () => this.send({ type: 'action', action: 'breakdance_stop' });
    this.refreshLanguage();
    // An invite link joins its room; otherwise the player goes online with everyone in this world area.
    const room = params.get('room');
    if (room) { this.input.value = room; this.timer = setTimeout(() => /^[A-F0-9]{6}$/i.test(room.trim()) ? this.connect('join', room) : this.connect('enter'), 500); }
    else this.connect('enter');
  }

  /** For tools: the current socket and pending retry. */
  get ws() { return this.link.ws; }
  get retry() { return this.link.retry; }

  /** Opens the panel at the room controls, for the game menu. */
  showFriends() {
    this.root.open = true;
    this.friends.scrollIntoView({ block: 'nearest' });
    if (!this.room) this.create.focus();
  }

  private send(msg: unknown) { this.link.send(msg); }

  private connect(type: Mode, room = '', duel = false) {
    if (this.disposed) return;
    const code = room.trim().toUpperCase();
    if (type === 'join' && !/^[A-F0-9]{6}$/.test(code)) { this.setStatus('방 코드 6자리를 확인해 주세요.','Check the six-character room code.'); return; }
    this.pendingDuel=type==='create'&&duel;
    this.battle.leave(); this.closeSocket();
    this.room = ''; this.shard = ''; this.area = 0;
    this.setStatus('연결 중…','Connecting…');
    this.link.connect(type, code);
    this.updateUi();
  }

  private socketUrl(type: Mode, code: string) {
    const url = new URL(import.meta.env.VITE_MULTIPLAYER_URL || '/multiplayer', location.href);
    url.protocol = url.protocol === 'https:' || location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = ''; url.hash = '';
    url.searchParams.set('mode', type);
    if (code) url.searchParams.set('room', code);
    return url;
  }

  private receive(msg: Message) {
    if (this.disposed) return;
    switch (msg.type) {
      case 'welcome': {
        this.ownId = msg.id; this.offline = false;
        // Only the visible label changes; the original spec still owns local saves.
        if(typeof msg.displayName==='string')this.game.player.unit.name=displayName(msg.displayName);
        if(msg.nameConflict===true)this.note(t(`이미 사용 중인 이름이라 ‘${this.game.player.unit.name}’로 표시해요.`,`That name is already in use, so you appear as “${this.game.player.unit.name}”.`),'mp-system');
        if (msg.public) {
          this.shard = msg.room; this.area = msg.area; this.room = '';
          if(msg.sharedWorld===1)this.battle.join(msg.id,msg.host,msg.world,true);
          this.note(t(`월드 ${ROMAN[this.area]}에 들어왔어요. 근처 모험가와 인사해 보세요.`,`Entered World ${ROMAN[this.area]}. Say hello to the adventurers nearby.`));
        } else {
          this.room = msg.room; this.shard = ''; this.area = 0;
          this.battle.join(msg.id, msg.host, msg.world);
          if(this.pendingDuel){this.pendingDuel=false;this.battle.setMode('pvp');}
          // A transport retry receives a new ID; restore only its explicit team choice.
          const party=this.rejoinParty;this.rejoinParty=null;
          if(party!==null)this.battle.setParty(party);
          this.setStatus('연결됨 · 친구를 초대해 보세요!','Connected · Invite a friend!');
          this.input.value = this.room;
          this.note(t(`방 ${this.room}에 참가했어요.`,`Joined room ${this.room}.`));
        }
        if (typeof msg.renamed === 'string' && !this.renamedNoted) {
          this.renamedNoted = true;
          this.note(t(`이름에 쓸 수 없는 말이 있어서 다른 모험가에게는 ‘${displayName(msg.renamed)}’로 보여요.`,`Your name has words that cannot be shown, so others see you as “${displayName(msg.renamed)}”.`), 'mp-system');
        }
        for (const p of msg.players) this.addPeer(p.id, p.spec, p.state);
        this.updateUi();
        break;
      }
      case 'authority': this.battle.elect(msg.host); break;
      case 'world': if (!this.battle.authority) this.battle.apply(msg.world); break;
      case 'combat': this.battle.receive(msg.id, msg.event); break;
      case 'joined': { this.addPeer(msg.id, msg.spec, null); const name = displayName(msg.spec.name); this.note(t(`${name}님이 들어왔어요.`,`${name} joined.`)); this.updateUi(); break; }
      case 'left': this.removePeer(msg.id); this.updateUi(); break;
      case 'state': { const p = this.peers.get(msg.id); if (p) p.state = msg.state; break; }
      case 'action': this.peerAction(msg.id, msg.action); break;
      case 'chat': {
        const line = this.chatLine(String(msg.id), String(msg.name), String(msg.text));
        const unit = msg.id === this.ownId ? this.game.player.unit : this.peers.get(msg.id)?.unit;
        if (unit && !line.hidden) this.game.hud.bubbles.say(this.game, unit, msg.text);
        break;
      }
      case 'chatRefused': {
        const why: Record<string, [string, string]> = { fast: ['조금 천천히 보내 주세요.', 'Slow down a little.'], burst: ['너무 많이 보냈어요. 잠시 뒤에 다시 보내 주세요.', 'Too many messages. Wait a moment.'], repeat: ['같은 말은 조금 뒤에 다시 보낼 수 있어요.', 'You just sent that. Try again later.'] };
        this.note(t(...(why[msg.reason] ?? why.fast)), 'mp-system');
        break;
      }
      case 'reported':
        this.note(msg.ok ? t('신고를 보냈어요. 알려 줘서 고마워요.','Report sent. Thank you for telling us.') : t('신고를 보내지 못했어요. 이미 신고했거나 잠시 뒤에 다시 할 수 있어요.','Could not send the report. You may have reported them already; try again later.'), 'mp-system');
        break;
      case 'error': {
        const error = this.serverError(String(msg.message)), tried = this.link.mode;
        this.room = ''; this.shard = ''; this.area = 0; this.battle.leave(); this.closeSocket();
        // A room that cannot be made or joined leaves the player in the public world.
        if (tried !== 'enter') { this.note(t(...error)); this.game.hud.messages.info(t(...error)); this.connect('enter'); }
        else { this.setStatus(...error); this.goOffline(); }
        this.updateUi();
        break;
      }
    }
  }

  /** The socket dropped. The link is already retrying unless a code room has run out of tries. */
  private lost({ mode, attempt, delay, welcomed }: Lost) {
    if (this.disposed) return;
    this.clearPeers();
    if (mode !== 'enter') {
      if (delay === null) {
        // Instead of going offline, back to the public world.
        this.rejoinParty = null; this.battle.leave(); this.room = '';
        const text: [string, string] = welcomed
          ? ['방에 다시 연결하지 못해 공개 월드로 돌아왔어요.','Could not reconnect to the room. Back in the public world.']
          : ['방에 연결할 수 없어요. 방 코드를 확인하고 다시 참가해 주세요.','Could not connect. Check the room code and try joining again.'];
        this.note(t(...text)); this.game.hud.messages.info(t(...text));
        this.connect('enter');
        return;
      }
      this.rejoinParty ??= this.battle.parties[this.ownId] ?? null;
      this.setStatus('연결이 끊겼어요. 다시 연결 중…','Disconnected. Reconnecting…');
    } else {
      this.battle.leave();this.shard = ''; this.area = 0;
      // The link keeps trying for as long as the player is in the world; after a few misses say so and offer the button.
      if (welcomed && attempt <= 4) this.setStatus('연결이 끊겼어요. 다시 연결 중…','Disconnected. Reconnecting…');
      else { this.setStatus('오프라인 · 서버에 연결할 수 없어 혼자 플레이해요.','Offline · Could not reach the server, playing solo.'); this.goOffline(); }
    }
    this.updateUi();
  }

  private addPeer(id: string, spec: CrabSpec, state: State | null) {
    if (this.peers.has(id) || id === this.ownId) return;
    const peer: Peer = { spec, state, unit: null, dance: null };
    void preloadRoutine();
    this.peers.set(id, peer);
    void createCrab(spec).then(rig => {
      if (this.disposed || this.peers.get(id) !== peer) { rig.dispose(); return; }
      const unit = new Unit(displayName(spec.name), 'remote', 'friendly', rig, createMotionController(rig));
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

  /** Without a server the game plays on alone; say so once until a connection comes back. */
  private goOffline() {
    this.shard = ''; this.area = 0;
    if (!this.offline) this.game.hud.messages.info(t('서버에 연결할 수 없어 혼자 플레이해요.','Could not reach the server. Playing offline.'));
    this.offline = true;
  }

  update(dt: number) {
    this.elapsed += dt;
    // Each world area has its own shards: travelling leaves this one for one where you arrive.
    if (this.shard && this.area !== this.game.world2.chapter && this.link.open) this.connect('enter');
    if ((this.room || this.shard) && this.elapsed >= 0.05) {
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
      u.title=this.battle.active?`${rival?t('대전 상대','Rival'):t('친구','Friend')} · ${t('파티','Party')} ${this.battle.partyOf(id)||'—'}`:t('모험가','Adventurer');
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
    if(!this.room)return;
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
    this.partyPanel.setAttribute('aria-label',t('파티원 목록','Party roster'));
    this.partyPanel.replaceChildren(h('h3',null,t('파티원','Party members')),h('strong',null,heading),...members.map(p=>
      h('div',{class:`mp-member party-${p.party}`},h('span',null,`${p.party?`${partyLabel} ${p.party}`:soloLabel} · ${p.name}`),h('meter',{min:0,max:p.max,value:p.hp}),h('small',null,`${Math.ceil(p.hp)} / ${Math.ceil(p.max)}`))));
  }

  mapParty(unit:Unit):{party:number;teammate:boolean}|null{
    // Strangers in a public shard are shown nearby, without arrows that follow them across the map.
    for(const [id,peer] of this.peers)if(peer.unit===unit)return this.battle.active?{party:this.battle.partyOf(id),teammate:this.battle.sameParty(this.ownId,id)}:{party:0,teammate:false};
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
  private note(text: string, cls = '') {
    this.append(h('div', { class: cls || undefined }, text));
  }
  private append(line: HTMLElement) {
    this.log.append(line);
    while (this.log.childElementCount > 40) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
  /** A chat line; another player's name opens block and report. Returns it hidden when that player is blocked or public chat is off. */
  private chatLine(id: string, name: string, text: string) {
    const own = id === this.ownId, shown = displayName(name);
    const who = own ? h('strong', null, shown) : h('button', { type: 'button', class: 'mp-who', 'aria-label': t(`${shown}: 차단 또는 신고`,`${shown}: block or report`), onclick: () => this.pick({ id, name }) }, shown);
    const line = h('div', { class: 'mp-line', 'data-id': id, 'data-name': name, 'data-public': this.shard ? '1' : null }, who, ': ', text);
    line.hidden = this.hides(line);
    this.append(line);
    return line;
  }
  private hides(line: HTMLElement) {
    return (line.dataset.public === '1' && !this.publicChat) || (line.dataset.id !== this.ownId && this.blocked.has(line.dataset.id!, line.dataset.name!));
  }
  /** After a block, an unblock or the public chat switch: which lines and bubbles show. */
  private refreshChat() {
    for (const line of this.log.querySelectorAll<HTMLElement>('.mp-line')) line.hidden = this.hides(line);
    for (const [id, p] of this.peers) if (p.unit && ((this.shard && !this.publicChat) || this.blocked.has(id, p.spec.name))) this.game.hud.bubbles.forget(p.unit);
    this.renderBlocked(); this.rosterKey = ''; this.updateUi();
  }
  /** Esc menu, Settings: show or hide public-shard chat. Rooms with friends are not affected. */
  setPublicChat(on: boolean) {
    if (on === this.publicChat) return;
    this.publicChat = on;
    this.note(on ? t('공개 채팅을 켰어요.','Public chat is on.') : t('공개 채팅을 껐어요. Esc 메뉴의 설정에서 다시 켤 수 있어요.','Public chat is off. Turn it back on in Settings (Esc).'), 'mp-system');
    this.refreshChat();
  }
  /** Opens (or with null closes) the block and report buttons for a player. */
  private pick(who: { id: string; name: string } | null, reporting = false) {
    this.picked = who && { ...who, reporting };
    const p = this.picked;
    this.actions.hidden = !p;
    if (!p) { this.actions.replaceChildren(); return; }
    const shown = displayName(p.name), blocked = this.blocked.has(p.id, p.name);
    const button = (label: string, run: () => void, cls = '') => h('button', { type: 'button', class: cls || undefined, onclick: run }, label);
    this.actions.setAttribute('aria-label', t(`${shown}에게 할 일`,`Actions for ${shown}`));
    this.actions.replaceChildren(
      h('strong', null, reporting ? t(`${shown}님을 신고하는 이유`,`Why are you reporting ${shown}?`) : shown),
      h('div', { class: 'mp-row' }, ...(reporting
        ? [...REPORT_REASONS.map(([reason, ko, en]) => button(t(ko, en), () => { this.send({ type: 'report', id: p.id, reason }); this.pick(null); })), button(t('취소','Cancel'), () => this.pick(null))]
        : [blocked ? button(t('차단 풀기','Unblock'), () => { this.blocked.unblock(p.name); this.pick(null); this.refreshChat(); }) : button(t('🚫 차단','🚫 Block'), () => this.block(p.id, p.name), 'mp-block'),
          button(t('🚩 신고','🚩 Report'), () => this.pick(p, true), 'mp-report'), button(t('닫기','Close'), () => this.pick(null))])));
    this.actions.scrollIntoView({ block: 'nearest' });
  }
  private block(id: string, name: string) {
    this.blocked.block(id, name);
    this.pick(null);
    const shown = displayName(name);
    this.note(t(`${shown}님을 차단했어요. 채팅과 말풍선이 보이지 않아요.`,`Blocked ${shown}. You will not see their chat or bubbles.`), 'mp-system');
    this.refreshChat();
  }
  private renderBlocked() {
    const names = this.blocked.list();
    this.blockedList.hidden = !names.length;
    this.blockedList.replaceChildren(h('summary', null, t(`차단한 모험가 ${names.length}명`,`Blocked players: ${names.length}`)),
      ...names.map(name => h('div', { class: 'mp-row mp-blocked-row' }, h('span', null, displayName(name)),
        h('button', { type: 'button', 'aria-label': t(`${displayName(name)} 차단 풀기`,`Unblock ${displayName(name)}`), onclick: () => { this.blocked.unblock(name); this.refreshChat(); } }, t('차단 풀기','Unblock')))));
  }
  /** Players here; each other player's name opens block and report. Rebuilt only when it changes, so focus stays. */
  private renderRoster(online: boolean, count: number) {
    const others = [...this.peers].map(([id, p]) => [id, p.spec.name] as const);
    const key = JSON.stringify([online, count, this.game.player.unit.name, others, others.map(([id, name]) => this.blocked.has(id, name)), t('명',' players')]);
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    if (!online) { this.roster.replaceChildren(); return; }
    this.roster.replaceChildren(`${count}/8${t('명',' players')} · `, h('span', null, this.game.player.unit.name),
      ...others.flatMap(([id, name]) => {
        const shown = displayName(name), blocked = this.blocked.has(id, name);
        return [', ', h('button', { type: 'button', class: `mp-who${blocked ? ' blocked' : ''}`, 'aria-label': t(`${shown}${blocked ? ' (차단함)' : ''}: 차단 또는 신고`,`${shown}${blocked ? ' (blocked)' : ''}: block or report`), onclick: () => this.pick({ id, name }) }, shown)];
      }));
  }
  private updateUi() {
    const open = this.link.open;
    const connected = !!this.room && open, online = connected || (!!this.shard && open);
    const connecting = this.link.connecting;
    const count = this.peers.size + 1;
    this.create.disabled = this.duelCreate.disabled = !!connecting || !!connected;
    this.join.disabled = !!connecting || !!connected;
    this.share.disabled = !connected;
    this.leave.disabled = !this.room; this.leave.hidden = !this.room;
    const muted = !!this.shard && !this.publicChat;
    this.chat.disabled = !online || muted; this.sendButton.disabled = !online || muted;
    this.chat.placeholder = muted ? t('공개 채팅이 꺼져 있어요','Public chat is off') : t('함께 있는 모험가에게 말하기','Message everyone here');
    this.code.textContent = this.room;
    this.renderRoster(online, count);
    this.invite.hidden = !connected;
    this.invite.value = this.inviteUrl();
    // Offline, the link still retries on its own; the button tries now.
    this.reconnect.hidden = !this.offline || !!connecting || open;
    this.duelHelp.hidden=!this.room;
    this.modeRow.hidden = this.partyRow.hidden = this.partyPanel.hidden = !this.room;
    if (online && !this.room) this.setStatus(`온라인 · 월드 ${ROMAN[this.area]} · ${count}명이 함께 있어요`,`Online · World ${ROMAN[this.area]} · ${count} here`);
    this.summary.textContent = this.room ? t(`🦀 친구와 방 · ${count}명`,`🦀 Room with friends · ${count}`) : online ? t(`🦀 온라인 · ${count}명`,`🦀 Online · ${count}`) : this.offline ? t('🦀 오프라인','🦀 Offline') : t('🦀 연결 중…','🦀 Connecting…');
    this.intro.textContent = this.room
      ? t('최대 8명 · 함께 모험하거나 싸우기 모드로 대전해요. 같은 파티는 서로 공격하지 않아요. 퀘스트는 각자 진행해요.','Up to 8 players · Adventure together or duel in PvP. Teammates cannot hurt each other. Quests progress individually.')
      : t('같은 월드에서 몬스터 체력·등대·배를 함께 공유해요. 퀘스트와 포탈 이동은 각자 진행해요.','Share monster health, lighthouse and boats in the same world. Quests and portal travel stay personal.');
  }
  private setStatus(ko:string,en:string){this.statusText=[ko,en];this.status.textContent=t(ko,en);}
  private serverError(message:string):[string,string]{
    const errors:[string,string][]=[['게임 버전이 달라요. 모두 새로고침한 뒤 같은 방에 들어와 주세요.','Game versions differ. Everyone must refresh before joining.'],['캐릭터 정보를 확인해 주세요.','Invalid character.'],['서버가 가득 찼어요. 잠시 뒤 다시 시도하세요.','Server full. Try again later.'],['방을 찾을 수 없어요. 6자리 코드를 확인하세요.','Room not found. Check the six-character code.'],['방이 가득 찼어요. 최대 8명까지 참가할 수 있어요.','Room is full (8 players).']];
    return errors.find(pair=>pair.includes(message))??[message,message];
  }
  refreshLanguage(){
    this.duelCreate.textContent=t('⚔ 친구랑 싸우기','⚔ Battle a friend');
    this.duelHelp.textContent=t('대전 방법: 방 코드나 초대 링크를 친구에게 보내세요. 서로 가까이에서 친구를 클릭하거나 Tab으로 선택하고 공격 기술을 사용하세요. 같은 파티끼리는 피해를 주지 않아요. 방장은 협동 모드로 돌아갈 수 있어요.','How to duel: share the room code or invite link. Meet nearby, click your friend or select them with Tab, then use attack skills. Teammates are protected. The host can return to Co-op.');
    this.friends.textContent=t('친구와 방 만들기','Room with friends');
    for(const [button,ko,en] of [[this.create,'방 만들기','Create room'],[this.join,'참가','Join'],[this.leave,'나가기','Leave'],[this.share,'초대 링크 복사','Copy invite link'],[this.sendButton,'전송','Send'],[this.reconnect,'다시 연결','Reconnect']] as const)button.textContent=t(ko,en);
    this.input.placeholder=t('방 코드 6자리','Six-character room code');this.input.setAttribute('aria-label',t('방 코드','Room code'));
    this.chat.setAttribute('aria-label',t('채팅 메시지','Chat message'));
    this.log.setAttribute('aria-label',t('채팅','Chat'));this.invite.setAttribute('aria-label',t('초대 링크','Invite link'));
    this.root.querySelector('[data-emote="hello"]')!.textContent=t('👋 인사','👋 Wave');this.root.querySelector('[data-emote="dance"]')!.textContent=t('💃 춤','💃 Dance');
    this.root.querySelector('[data-emote="breakdance"]')!.textContent=t('🕺 브레이크댄스','🕺 Breakdance');
    this.rosterKey='';if(this.picked)this.pick(this.picked,this.picked.reporting);this.renderBlocked();
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
    this.link.stop(); this.clearPeers();
  }
  /** Leaving a room with friends goes back to the public world. */
  pauseDungeonConnection(){this.closeSocket();}
  createDungeonRoom(){this.connect('create');}
  leaveDungeonRoom(){this.disconnect();}
  private disconnect() { this.connect('enter'); }
  dispose() {
    this.disposed = true;
    this.partySize.disconnect();
    this.game.app.ui.style.removeProperty('--party-roster-height');
    if (this.timer) clearTimeout(this.timer);
    this.game.player.unit.onAction = null;
    this.game.player.unit.onBreakdanceStop = null;
    this.battle.dispose(); this.closeSocket(); this.link.dispose(); this.root.remove(); this.partyPanel.remove();
  }
}
