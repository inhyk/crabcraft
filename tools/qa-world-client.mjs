// Chrome for Testing -> authenticated loopback host -> actual Area -> production rig observation.
// This exercises the isolated adapter page, not the final Game route or production VM.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './lib/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const providedMetadata = process.env.WORLD_QA_METADATA;
const scratch = providedMetadata ? null : await mkdtemp('/private/tmp/crabcraft-browser-world-');
const metadataPath = providedMetadata ?? join(scratch, 'host.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let host, server, browser;
const handshakeStatuses = [];
const websocketErrors = [];
try {
  if (!providedMetadata) {
    host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', '5287', '--metadata', metadataPath, '--client-origin', 'http://127.0.0.1:5276'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    // Launcher errors may include driver configuration; print no launcher output or credentials.
    host.stderr.on('data', () => {});
  }
  let metadata;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); break; }
    catch { if (host?.exitCode !== null && host?.exitCode !== undefined) throw new Error('QA host exited before readiness'); await pause(100); }
  }
  if (!metadata) throw new Error('QA host readiness timed out');
  const origin = new URL(metadata.origin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || metadata.clientOrigin !== 'http://127.0.0.1:5276') throw new Error('QA host must use the expected loopback origins');
  server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 5276, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
  await server.listen();
  browser = await launchBrowser({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(['local-network-access'], { origin: 'http://127.0.0.1:5276' });
  await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
  const page = await context.newPage(), errors = [];
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  network.on('Network.webSocketHandshakeResponseReceived', event => handshakeStatuses.push(event.response.status));
  network.on('Network.webSocketFrameError', event => websocketErrors.push(event.errorMessage));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__world_client__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>World adapter QA</title><style>body{margin:0;background:#14252d;color:white;font:15px monospace}#status{position:absolute;top:14px;left:18px;padding:10px;background:#14252ddd;border-radius:6px}</style></head><body><div id="status">Connecting to the actual local Area</div></body></html>' }));
  await page.goto('http://127.0.0.1:5276/__world_client__');
  await page.evaluate(async ({ characterId }) => {
    const [THREE, { initAssets }, { Input }, { WorldClient }, { WorldView }] = await Promise.all([
      import('/node_modules/three/build/three.module.js'), import('/src/core/assets.ts'), import('/src/core/input.ts'), import('/src/multiplayer/worldClient.ts'), import('/src/multiplayer/worldView.ts'),
    ]);
    const response = await fetch('/api/account/world-catalog', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('World catalog unavailable');
    const catalog = await response.json();
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1280, 720); renderer.setPixelRatio(1); document.body.append(renderer.domElement); initAssets(renderer);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#152b35');
    scene.add(new THREE.HemisphereLight(0xccecff, 0x66705e, 3)); const sun = new THREE.DirectionalLight(0xfff5df, 3); sun.position.set(7, 10, 4); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1280 / 720, .05, 500);
    const input = new Input(renderer.domElement), game = { input, controlsLocked: false, follow: { yaw: 0, steering: false, forwardYaw: 0 } };
    const records = [], statuses = [], failures = [];
    const view = new WorldView({ root: scene, onError: (_ref, code) => failures.push(code) });
    const client = new WorldClient({ catalog, maxReconnects: 0, resetInput: () => input.reset(), onReset: () => view.reset(), onState: state => statuses.push(state), onSnapshot: (state, events, results) => { view.commit(state, events, results); records.push(...events); }, onEvents: (events, results) => { view.events(events, results); records.push(...events); } });
    const info = document.getElementById('status');
    let stopped = false;
    const frame = now => {
      if (stopped) return;
      client.capture(game, 1 / 60, client.view?.self.player.channel?.kind ?? null); client.pump(now); input.endFrame(); view.render(now, 1 / 60);
      const state = client.view;
      if (state) {
        const actor = state.actors.find(actor => actor.ref.id === state.selfRef.id && actor.ref.life === state.selfRef.life);
        if (actor) { camera.position.set(actor.x + 6, actor.y + 4.5, actor.z + 7); camera.lookAt(actor.x, actor.y + .7, actor.z); }
        info.textContent = `Actual local Area | ${state.world} | tick ${state.header.tick} | ${view.readyCount} rigs | ${client.state}`;
      }
      renderer.render(scene, camera); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.__worldAdapterQA = { client, view, records, statuses, failures, renderer, scene, camera, stop() { stopped = true; client.dispose(); view.dispose(); input.dispose(); renderer.dispose(); } };
    await client.connect(characterId);
  }, { characterId: metadata.characterId });
  await page.waitForFunction(() => { const q = window.__worldAdapterQA, state = q.client.view; return state && q.view.actor(state.selfRef) && q.view.readyCount === q.view.actorCount; }, undefined, { timeout: 45000 });
  const before = await page.evaluate(() => { const state = window.__worldAdapterQA.client.view; return { binding: state.header, position: state.actors.find(actor => actor.ref.id === state.selfRef.id), spec: window.__worldAdapterQA.view.actor(state.selfRef).rig.spec }; });
  if (metadata.appearance && ['race', 'sex', 'classId', 'shell', 'crest', 'led', 'name'].some(key => before.spec[key] !== metadata.appearance[key])) throw new Error('Server identity appearance changed before rendering');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(position => { const state = window.__worldAdapterQA.client.view, actor = state.actors.find(a => a.ref.id === state.selfRef.id); return Math.hypot(actor.x - position.x, actor.z - position.z) > .25; }, before.position, { timeout: 10000 });
  await page.keyboard.up('KeyW'); await page.keyboard.press('Space', { delay: 5 });
  await page.waitForFunction(() => window.__worldAdapterQA.records.some(record => record.event.type === 'jump'), undefined, { timeout: 10000 });
  await page.waitForFunction(() => window.__worldAdapterQA.client.inputWatermarks.consumed > 0);
  const consumedBeforeReconnect = await page.evaluate(() => window.__worldAdapterQA.client.inputWatermarks.consumed);
  const movement = await page.evaluate(position => { const state = window.__worldAdapterQA.client.view, actor = state.actors.find(a => a.ref.id === state.selfRef.id); return Math.hypot(actor.x - position.x, actor.z - position.z); }, before.position);
  await page.evaluate(async characterId => { await window.__worldAdapterQA.client.connect(characterId); }, metadata.characterId);
  await page.waitForFunction(() => { const q = window.__worldAdapterQA, state = q.client.view; return state && q.view.actor(state.selfRef); }, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__worldAdapterQA.client.inputWatermarks.consumed > 0);
  const result = await page.evaluate(oldBinding => {
    const q = window.__worldAdapterQA, state = q.client.view, actor = state.actors.find(a => a.ref.id === state.selfRef.id);
    q.view.render(performance.now(), 0); const rig = q.view.actor(state.selfRef).rig;
    return { state: q.client.state, world: state.world, readyRigs: q.view.readyCount, observedActors: q.view.actorCount, tick: state.header.tick, consumedInput: q.client.inputWatermarks.consumed, freshSession: state.header.session !== oldBinding.session, rootError: Math.hypot(rig.root.position.x - actor.x, rig.root.position.y - actor.y, rig.root.position.z - actor.z), appearance: { race: rig.spec.race, sex: rig.spec.sex, classId: rig.spec.classId, shell: rig.spec.shell, crest: rig.spec.crest, led: rig.spec.led }, failures: q.failures };
  }, before.binding);
  if (result.rootError !== 0 || !result.freshSession || result.failures.length || errors.length) throw new Error(`World adapter observation failed: ${JSON.stringify({ result, errors })}`);
  const screenshot = join(root, 'tmp', 'qa-world-client.png');
  await page.screenshot({ path: screenshot });
  await page.evaluate(() => window.__worldAdapterQA.stop());
  console.log(JSON.stringify({ ...result, consumedBeforeReconnect, movement, jumpObserved: true, screenshot, scope: 'actual local PG/auth/host/Area with isolated adapter page; final Game route, VM and 100-client acceptance remain separate' }, null, 2));
} finally {
  if (handshakeStatuses.some(status => status !== 101)) console.error(JSON.stringify({ websocketHandshakeStatuses: handshakeStatuses }));
  if (websocketErrors.length) console.error(JSON.stringify({ websocketErrors }));
  await browser?.close(); await server?.close();
  if (host) {
    host.kill('SIGTERM');
    for (let attempt = 0; host.exitCode === null && attempt < 100; attempt++) await pause(100);
    if (host.exitCode === null) host.kill('SIGKILL');
  }
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
