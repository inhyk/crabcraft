// The developer monitor's spectator view: the real game, invisible, following one player of one room on the relay.
// `/?observe=<room>&follow=<player id>&area=<1-6>` (docs/features/developer-monitor.md). Everything but the 3D canvas is hidden.

export type Chapter = 1 | 2 | 3 | 4 | 5 | 6;
export type Spectate = { room: string; follow: string; area: Chapter };

/** A public shard (W + area + 4 hex) or a private room code, a player id, and the world to load first. */
export function spectateOf(value: { observe?: unknown; follow?: unknown; area?: unknown }): Spectate | null {
  const room = String(value.observe ?? '').toUpperCase(), follow = String(value.follow ?? ''), area = Number(value.area);
  if (!/^(W[1-6][0-9A-F]{4}|[0-9A-F]{6})$/.test(room) || !/^[\w-]{1,64}$/.test(follow)) return null;
  return { room, follow, area: (Number.isInteger(area) && area >= 1 && area <= 6 ? area : 1) as Chapter };
}

export const SPECTATE: Spectate | null = typeof location === 'undefined' ? null
  : spectateOf(Object.fromEntries(new URLSearchParams(location.search)));

const CHROME = `
html.cc-spectate, html.cc-spectate body { background: #050708; }
html.cc-spectate body > :not(#app):not(.cc-spectate-signal), html.cc-spectate #app > :not(canvas) { display: none !important; }
html.cc-spectate .cc-spectate-signal { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; background: repeating-linear-gradient(0deg, #0d1417 0 2px, #10191c 2px 4px); color: #ecd08a; font: 600 13px/1 ui-monospace, monospace; letter-spacing: .2em; pointer-events: none; }
html.cc-spectate .cc-spectate-signal[hidden] { display: none; }`;

/** Only the canvas shows: no HUD, menus, dialogs, notices or tooltips, wherever they are attached. */
export function spectateChrome(): void {
  document.documentElement.classList.add('cc-spectate');
  const style = document.createElement('style');
  style.textContent = CHROME;
  document.head.append(style);
}
