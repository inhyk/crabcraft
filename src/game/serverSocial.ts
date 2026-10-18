import './serverSocial.css';
import type { WorldControl } from '../../server/world/gameplay/protocol.ts';
import type { GameplayCommand } from '../../server/world/gameplay/intents.ts';
import type { EntityRef } from '../sim/types.ts';
import { REPORT_REASONS } from '../multiplayer/chatSafety';
import { t } from '../i18n';

type ChatLine = Extract<WorldControl, { type: 'chatLine' }>;
interface SocialPorts {
  parent: HTMLElement;
  command(command: GameplayCommand): boolean;
  resetInput(): void;
  line(line: ChatLine): void;
}
/** Account-backed UI. Only accepted server controls change preferences or display chat. */
export class ServerSocial {
  readonly button = document.createElement('button');
  private readonly panel = document.createElement('dialog');
  private readonly status = document.createElement('p');
  private readonly history = document.createElement('div');
  private readonly text = document.createElement('input');
  private readonly channel = document.createElement('select');
  private readonly target = document.createElement('select');
  private readonly reason = document.createElement('select');
  private readonly enabled = document.createElement('input');
  private readonly partyOnly = document.createElement('input');
  private readonly actions: HTMLButtonElement[] = [];
  private targets = new Map<string, EntityRef>();
  private preferences: { enabled: boolean; partyOnly: boolean } | null = null;
  private busy = false;
  constructor(private readonly ports: SocialPorts) {
    this.button.className = 'cc-btn small world-chat-open'; this.button.textContent = t('채팅', 'Chat');
    this.button.style.cssText = 'position:absolute;left:16px;bottom:120px;pointer-events:auto;z-index:20';
    this.button.onclick = () => this.show();
    this.panel.className = 'account-dialog world-chat-panel';
    this.panel.addEventListener('keydown', event => event.stopPropagation());
    this.panel.addEventListener('close', () => ports.resetInput());
    const heading = document.createElement('h2'); heading.textContent = t('계정 채팅', 'Account chat');
    const label = (name: string, control: HTMLElement) => { const el = document.createElement('label'); el.textContent = name; el.append(control); return el; };
    this.enabled.type = this.partyOnly.type = 'checkbox';
    this.enabled.onchange = () => { const value = this.enabled.checked; this.sync(); this.send({ kind: 'chatPreferences', enabled: value }); };
    this.partyOnly.onchange = () => { const value = this.partyOnly.checked; this.sync(); this.send({ kind: 'chatPreferences', partyOnly: value }); };
    for (const [value, name] of [['area', t('현재 지역', 'Current area')], ['party', t('파티', 'Party')]]) this.channel.add(new Option(name, value));
    this.channel.setAttribute('aria-label', t('채팅 범위', 'Chat audience'));
    this.text.setAttribute('aria-label', t('메시지', 'Message')); this.text.maxLength = 200; this.text.autocomplete = 'off';
    const form = document.createElement('form');
    const send = this.action(t('보내기', 'Send'), () => { if (this.send({ kind: 'chatSay', channel: this.channel.value as 'area' | 'party', text: this.text.value })) this.text.value = ''; });
    form.append(this.channel, this.text, send); form.onsubmit = event => { event.preventDefault(); send.click(); };
    this.history.setAttribute('role', 'log'); this.history.setAttribute('aria-live', 'polite'); this.history.style.cssText = 'max-height:180px;overflow:auto';
    this.target.setAttribute('aria-label', t('최근 발신자', 'Recent sender')); this.target.add(new Option(t('발신자 선택', 'Choose sender'), ''));
    this.reason.setAttribute('aria-label', t('신고 사유', 'Report reason'));
    for (const [value, ko, en] of REPORT_REASONS) this.reason.add(new Option(t(ko, en), value));
    const moderation = document.createElement('div');
    const targetCommand = (kind: 'chatBlock' | 'chatMute', value: boolean) => { const target = this.targets.get(this.target.value); if (!target) return; this.send(kind === 'chatBlock' ? { kind, target, blocked: value } : { kind, target, muted: value }); };
    moderation.append(this.target,
      this.action(t('차단', 'Block'), () => targetCommand('chatBlock', true)), this.action(t('차단 해제', 'Unblock'), () => targetCommand('chatBlock', false)),
      this.action(t('음소거', 'Mute'), () => targetCommand('chatMute', true)), this.action(t('음소거 해제', 'Unmute'), () => targetCommand('chatMute', false)), this.reason,
      this.action(t('신고', 'Report'), () => { const target = this.targets.get(this.target.value); if (target) this.send({ kind: 'chatReport', target, reason: this.reason.value as typeof REPORT_REASONS[number][0] }); }));
    const close = document.createElement('button'); close.textContent = t('닫기', 'Close'); close.onclick = () => this.panel.close();
    this.status.setAttribute('role', 'status');
    this.panel.append(heading, label(t('채팅 켜기', 'Chat enabled'), this.enabled), label(t('파티 채팅만', 'Party chat only'), this.partyOnly), form, this.history, moderation, this.status, close);
    ports.parent.append(this.button, this.panel); this.sync();
  }
  private action(name: string, callback: () => void): HTMLButtonElement { const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.onclick = callback; this.actions.push(button); return button; }
  get open(): boolean { return this.panel.open; }
  get publicEnabled(): boolean { return !!this.preferences?.enabled && !this.preferences.partyOnly; }
  show(): void { if (!this.panel.open) this.panel.showModal(); this.ports.resetInput(); this.text.focus(); }
  setPublicEnabled(enabled: boolean): void { this.send({ kind: 'chatPreferences', enabled: true, partyOnly: !enabled }); }
  private send(command: GameplayCommand): boolean {
    if (this.busy || !this.preferences) return false;
    if (!this.ports.command(command)) { this.status.textContent = t('연결을 확인해 주세요.', 'Check the connection.'); return false; }
    this.busy = true; this.status.textContent = t('서버 확인 중...', 'Waiting for server...'); this.sync(); return true;
  }
  private sync(): void {
    this.enabled.checked = this.preferences?.enabled ?? false; this.partyOnly.checked = this.preferences?.partyOnly ?? false;
    for (const control of [...this.actions, this.enabled, this.partyOnly]) control.disabled = this.busy || !this.preferences;
  }
  observe(control: WorldControl): void {
    if (control.type === 'chatPreferences') { this.preferences = { enabled: control.enabled, partyOnly: control.partyOnly }; if (!this.busy) this.status.textContent = t('서버 설정을 불러왔습니다.', 'Server settings loaded.'); this.sync(); }
    if (control.type === 'chatResult') { this.busy = false; this.status.textContent = control.ok ? t('서버에서 확인했습니다.', 'Confirmed by server.') : t(`요청 실패: ${control.error}`, `Request failed: ${control.error}`); this.sync(); }
    if (control.type !== 'chatLine') return;
    this.ports.line(control);
    const row = document.createElement('p'); row.textContent = `${control.channel === 'party' ? t('[파티] ', '[Party] ') : ''}${control.line.name}: ${control.line.text}`; this.history.append(row);
    while (this.history.childElementCount > 20) this.history.firstElementChild?.remove();
    const ref = control.line.sender, key = JSON.stringify([ref.area, ref.id, ref.life]);
    if (!this.targets.has(key)) { this.targets.set(key, { ...ref }); this.target.add(new Option(control.line.name, key)); }
    while (this.targets.size > 20) { const first = this.targets.keys().next().value!; this.targets.delete(first); const option = [...this.target.options].find(o => o.value === first); option?.remove(); }
  }
  reset(): void { this.preferences = null; this.busy = false; this.targets.clear(); this.target.length = 1; this.history.replaceChildren(); this.status.textContent = t('다시 연결 중...', 'Reconnecting...'); this.sync(); }
  dispose(): void { this.panel.remove(); this.button.remove(); }
}
