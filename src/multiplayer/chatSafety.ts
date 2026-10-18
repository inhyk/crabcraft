// What a player chooses about other players' chat: who is blocked, whether public chat shows, the one-time
// safety line. Kept in this browser only; the server filters and takes reports (server/chat/safety.ts).
import { t } from '../i18n';

const get = (store: () => Storage, key: string) => { try { return store().getItem(key); } catch { return null; } };
const set = (store: () => Storage, key: string, value: string | null) => {
  try { if (value === null) store().removeItem(key); else store().setItem(key, value); } catch { /* private mode */ }
};
const local = () => localStorage, session = () => sessionStorage;
const json = <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) as T : fallback; } catch { return fallback; } };

/** The server's replacement for a name it will not show (server/chat/filter.ts NEUTRAL_NAME). */
const NEUTRAL_NAME = '게 모험가';
export const displayName = (name: string) => name === NEUTRAL_NAME || /^게 모험가 #\d+$/.test(name) ? t('게 모험가', 'Crab Adventurer') + name.slice(NEUTRAL_NAME.length) : name;

export const REPORT_REASONS = [['abuse', '욕설', 'Bad words'], ['personal', '개인정보 요구', 'Asked for personal info'], ['harassment', '괴롭힘', 'Bullying'], ['other', '기타', 'Other']] as const;

/** A random id for this tab, so the server can keep a mute across reconnects. Never anything about the player. */
export function chatSession() {
  const key = 'cc.chat.session', old = get(session, key);
  if (old && /^[A-Za-z0-9_-]{16,64}$/.test(old)) return old;
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const fresh = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
  set(session, key, fresh);
  return fresh;
}

/** The name a player chose, without the ` #2` the server adds while someone else online has it (server/rooms.ts admit).
 * The number follows arrival order: a block keyed by it would miss the same player next time, and for the neutral
 * name it would catch whoever happens to be the second one renamed. */
const chosen = (name: string) => name.replace(/ #\d+$/, '');

/** Blocked players: by server id for this tab's session, and by chosen name in this browser (except the shared neutral name). */
export class Blocklist {
  private ids: Record<string, string> = json(get(session, 'cc.chat.blockedIds'), {});
  private names: string[] = [...new Set(json<string[]>(get(local, 'cc.chat.blockedNames'), []).map(chosen))];

  has(id: string, name: string) { const n = chosen(name); return id in this.ids || (n !== NEUTRAL_NAME && this.names.includes(n)); }
  block(id: string, name: string) {
    const n = chosen(name);
    this.ids[id] = n;
    if (n !== NEUTRAL_NAME && !this.names.includes(n)) this.names.push(n);
    this.save();
  }
  /** Unblocks a name everywhere: its remembered name and every id blocked under it. */
  unblock(name: string) {
    const n = chosen(name);
    this.names = this.names.filter(b => b !== n);
    for (const [id, b] of Object.entries(this.ids)) if (chosen(b) === n) delete this.ids[id];
    this.save();
  }
  list() { return [...new Set([...this.names, ...Object.values(this.ids).map(chosen)])]; }
  private save() {
    set(session, 'cc.chat.blockedIds', JSON.stringify(this.ids));
    set(local, 'cc.chat.blockedNames', this.names.length ? JSON.stringify(this.names.slice(-200)) : null);
  }
}

/** Esc menu, Settings: public-shard chat lines and bubbles. On unless turned off. */
export const publicChatOn = () => get(local, 'cc.chat.public') !== 'off';
export const setPublicChat = (on: boolean) => set(local, 'cc.chat.public', on ? null : 'off');

/** The safety line shows the first time a player opens the chat in a public world. */
export const safetyNoteSeen = () => get(local, 'cc.chat.safetyNote') === '1';
export const markSafetyNote = () => set(local, 'cc.chat.safetyNote', '1');
