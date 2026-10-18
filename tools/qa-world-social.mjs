// Local real Chrome -> account handler -> v3 host -> disposable Postgres.
// Records transport success separately from native Game UI coverage. Never grants progression.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.WORLD_QA_BROWSER_PORT ?? 5279);
assert(Number.isInteger(port) && port > 0 && port < 65536);
const clientOrigin = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp('/private/tmp/crabcraft-social-');
const metadataPath = join(scratch, 'host.json');
const output = join(root, 'output/playwright/world-social');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], result = { scope: 'Local actual Game source served by Vite, real account handler/PG/v3 host. Not production bundle or deployment.', checks: {}, gaps: [] };
let host, vite, browser;
try {
  await mkdir(output, { recursive: true });
  host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', '0', '--metadata', metadataPath, '--client-origin', clientOrigin, '--party', '1'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  let metadata;
  for (let i = 0; i < 300; i++) {
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); break; }
    catch { if (host.exitCode !== null) throw new Error('Local QA host exited before readiness'); await sleep(100); }
  }
  assert(metadata && metadata.partyEnabled, 'Real party/chat fixture must be ready');
  const hostURL = new URL(metadata.origin); assert.equal(hostURL.hostname, '127.0.0.1'); assert.equal(metadata.clientOrigin, clientOrigin);
  vite = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/world': { target: hostURL.origin, ws: true }, '/api/account': { target: hostURL.origin } } } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function open(characterId) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.grantPermissions(['local-network-access'], { origin: clientOrigin });
    await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('cc.language', 'en'));
    await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(characterId)}`);
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.cc?.game?.server?.ready && !document.querySelector('.loading'), undefined, { timeout: 120000 });
    // Observation-only tap: retain the native callback; do not render or synthesize controls here.
    await page.evaluate(() => {
      const client = window.cc.game.server.client, previous = client.options.onControl;
      window.socialQA = { controls: [], nativeControlHandler: typeof previous === 'function' };
      client.options.onControl = control => { window.socialQA.controls.push(structuredClone(control)); previous?.(control); };
    });
    return page;
  }
  const leader = await open(metadata.characterId);
  const secondId = await leader.evaluate(async appearance => {
    const response = await fetch('/api/account/world-characters', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Crabcraft-Account': '1' }, body: JSON.stringify({ appearance: { ...appearance, name: 'Social QA Second' } }) });
    if (!response.ok) throw new Error(`Character fixture creation failed: ${response.status}`);
    return (await response.json()).character.characterId;
  }, metadata.appearance);
  const guest = await open(secondId);
  async function send(page, command, test) {
    const start = await page.evaluate(command => { const index = window.socialQA.controls.length; if (!window.cc.game.server.command(command)) throw new Error('Command was rejected locally'); return index; }, command);
    await page.waitForFunction(({ start, test }) => window.socialQA.controls.slice(start).some(c => c.type === test.type && (!test.operation || c.operation === test.operation) && (test.ok === undefined || c.ok === test.ok)), { start, test }, { timeout: 15000 });
    return page.evaluate(({ start, test }) => window.socialQA.controls.slice(start).find(c => c.type === test.type && (!test.operation || c.operation === test.operation)), { start, test });
  }
  await send(leader, { kind: 'chatPreferences', enabled: true, partyOnly: false }, { type: 'chatPreferences' });
  await send(guest, { kind: 'chatPreferences' }, { type: 'chatPreferences' });
  const publicText = 'Social QA public hello';
  await leader.locator('.world-chat-open').click();
  await leader.getByRole('textbox', { name: 'Message', exact: true }).fill(publicText);
  await leader.getByRole('button', { name: 'Send', exact: true }).click();
  await guest.waitForFunction(text => window.socialQA.controls.some(c => c.type === 'chatLine' && c.channel === 'area' && c.line.text === text), publicText);
  result.checks.publicChatTransport = true;
  result.checks.publicChatNativeDOM = await guest.locator('.chat').innerText().then(text => text.includes(publicText));
  await leader.locator('.world-chat-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await leader.evaluate(() => window.cc.game.server.showFriends());
  await leader.getByRole('button', { name: 'Create party', exact: true }).click();
  await leader.waitForFunction(() => window.socialQA.controls.some(c => c.type === 'party' && c.state));
  const party = await leader.evaluate(() => window.socialQA.controls.filter(c => c.type === 'party' && c.state).at(-1));
  await guest.evaluate(() => window.cc.game.server.showFriends());
  await guest.getByRole('textbox', { name: '6-character party code', exact: true }).fill(party.state.code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await leader.waitForFunction(() => window.socialQA.controls.some(c => c.type === 'party' && c.state?.members.length === 2));
  await leader.getByRole('button', { name: 'Enable private-party PvP', exact: true }).click();
  await guest.waitForFunction(() => window.socialQA.controls.some(c => c.type === 'party' && c.state?.pvp));
  result.checks.partyTwoMembersAndPvpControl = true;
  await guest.getByRole('button', { name: 'Disable private-party PvP', exact: true }).waitFor();
  assert.equal(await guest.getByRole('button', { name: 'Disable private-party PvP', exact: true }).isEnabled(), false);
  result.checks.nativePartyPanelAndLeaderPolicy = true;
  await guest.screenshot({ path: join(output, 'party-members.png') });
  for (const page of [leader, guest]) await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
  result.checks.publicAreaModeUnchanged = await guest.evaluate(() => { const env = window.cc.game.server.client.view.features.environment; return env.mode === 'public' && env.pvp === 'disabled'; });
  assert.equal(result.checks.publicAreaModeUnchanged, true, 'Party preference must not enable public-world PvP');
  const partyText = 'Social QA party hello'; await sleep(750);
  await send(leader, { kind: 'chatSay', channel: 'party', text: partyText }, { type: 'chatResult', operation: 'say', ok: true });
  await guest.waitForFunction(text => window.socialQA.controls.some(c => c.type === 'chatLine' && c.channel === 'party' && c.line.text === text), partyText);
  result.checks.partyChatTransport = true;
  result.checks.partyChatNativeDOM = await guest.locator('.chat').innerText().then(text => text.includes(partyText));
  assert.equal(result.checks.publicChatNativeDOM, true); assert.equal(result.checks.partyChatNativeDOM, true);
  await send(guest, { kind: 'chatPreferences', enabled: false, partyOnly: true }, { type: 'chatPreferences' });
  const session = await guest.evaluate(() => window.cc.game.server.client.view.header.session);
  await guest.evaluate(id => window.cc.game.server.client.connect(id), secondId);
  await guest.waitForFunction(previous => { const g = window.cc.game; return g.server.ready && g.server.client.view.header.session !== previous && window.socialQA.controls.filter(c => c.type === 'chatPreferences' && !c.enabled && c.partyOnly).length >= 2; }, session, { timeout: 30000 });
  result.checks.accountPreferencesReconnect = true;
  result.checks.partyReconnect = await guest.evaluate(() => window.socialQA.controls.filter(c => c.type === 'party' && c.state?.members.length === 2).length >= 2);
  await guest.locator('.world-chat-open').click();
  assert.equal(await guest.getByRole('checkbox', { name: 'Chat enabled', exact: true }).isChecked(), false);
  assert.equal(await guest.getByRole('checkbox', { name: 'Party chat only', exact: true }).isChecked(), true);
  result.checks.nativePreferencesRecovered = true;
  result.checks.nativeControlHandler = await guest.evaluate(() => window.socialQA.nativeControlHandler);
  result.checks.noBrowserArea = await guest.evaluate(() => window.cc.game.core === null && !window.cc.game.multiplayer);
  result.checks.endingHook = await guest.evaluate(() => typeof window.cc.game.server.presentation.ports.onEnding === 'function');
  if (!result.checks.publicChatNativeDOM || !result.checks.partyChatNativeDOM) result.gaps.push('Game does not render accepted account chat controls.');
  if (!result.checks.nativeControlHandler) result.gaps.push('Native Game party/preferences controls are not connected.');
  if (!result.checks.endingHook) result.gaps.push('Ending recovery has no Game choreography callback. No ending completion was simulated.');
  result.gaps.push('Two characters share one disposable account. Cross-account mute/block isolation and non-member party exclusion need a separate account fixture.');
  result.gaps.push('No earned boss gate/private encounter was entered; private-party HUD and ending choreography remain unverified.');
  await guest.screenshot({ path: join(output, 'guest-social.png') });
  await leader.screenshot({ path: join(output, 'leader-social.png') });
  assert.deepEqual(errors, []); result.checks.noBrowserErrors = true;
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) await page.evaluate(() => window.cc?.game?.server?.client.dispose()).catch(() => {});
  await sleep(150); await browser?.close(); await vite?.close();
  if (host && host.exitCode === null) { host.kill('SIGTERM'); for (let i = 0; i < 100 && host.exitCode === null; i++) await sleep(100); if (host.exitCode === null) host.kill('SIGKILL'); }
  await rm(scratch, { recursive: true, force: true });
}
