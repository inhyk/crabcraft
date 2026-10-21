// Real production rigs verify the extracted view boundary, not full S2 browser acceptance.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './lib/browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5276, strictPort: true }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await launchBrowser({ headless: true });
  const page = await browser.newPage();
  await page.route('**/__sim_view_input__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Simulation view helper parity</title>' }));
  await page.goto('http://127.0.0.1:5276/__sim_view_input__');
  const result = await page.evaluate(async () => {
    const [THREE, { initAssets }, { createCrab, createEnemyCrab }, { createJellyfishRig }, { applyNumericPose }, { realActionData }, { Pose, sampleClip }, { numericClip }, { initializeNumericPose }] = await Promise.all([
      import('/node_modules/three/build/three.module.js'), import('/src/core/assets.ts'), import('/src/crab/provider.ts'),
      import('/src/crab/jellyfish.ts'), import('/src/game/simUnitView.ts'), import('/src/sim/data/actions.ts'),
      import('/src/sim/pose.ts'), import('/src/sim/data/pose.ts'), import('/src/sim/pose.ts'),
    ]);
    const renderer = new THREE.WebGLRenderer();
    initAssets(renderer);
    let rigs = 0, poses = 0, sockets = 0, maxAnchorDelta = 0;
    const near = (actual, expected, label) => {
      const delta = Math.abs(actual - expected);
      if (!Number.isFinite(delta) || delta > 1e-6) throw new Error(`${label}: ${actual} != ${expected}`);
      return delta;
    };
    const verify = (rig, archetype) => {
      try {
        const state = { x: 7, y: 2.5, z: -3, yaw: .63, lift: .8, archetype, pose: initializeNumericPose(), actions: [], pendingHit: null };
        const scale = rig.root.scale.toArray();
        const candidates = archetype === 'jellyfish' ? [['idle', 0]] : [['idle', .31], ['walk_fwd', .74], ['cast', 3.27], ['break_sixstep', 2.4], ['death', 1.1]];
        for (const [id, seconds] of candidates) {
          if (archetype !== 'jellyfish') {
            const pose = new Pose();
            sampleClip(numericClip(id), seconds, false, pose, true);
            state.pose.appliedQ = Array.from(pose.q);
            state.pose.appliedPosition = Array.from(pose.pos);
            state.pose.appliedRotation = Array.from(pose.rot);
          }
          const before = JSON.stringify(state);
          applyNumericPose(rig, state);
          if (JSON.stringify(state) !== before) throw new Error('View mutated numeric actor');
          rig.root.updateMatrixWorld(true);
          for (const [axis, index] of [['x', 0], ['y', 1], ['z', 2]]) {
            near(rig.root.position[axis], state[axis], `${archetype}/${id} root ${axis}`);
            near(rig.root.scale[axis], scale[index], `${archetype}/${id} scale ${axis}`);
          }
          const actual = rig.getSocket('clawR').getWorldPosition(new THREE.Vector3());
          const expected = realActionData.launchAnchor(state, state.pose);
          for (const axis of ['x', 'y', 'z']) maxAnchorDelta = Math.max(maxAnchorDelta, near(actual[axis], expected[axis], `${archetype}/${id} claw ${axis}`));
          sockets++; poses++;
        }
        rigs++;
      } finally { rig.dispose(); }
    };
    try {
      for (const race of ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren']) {
        for (const sex of ['male', 'female']) for (const classId of ['warrior', 'mage', 'priest']) {
          verify(await createCrab({ race, sex, classId, shell: 0, crest: 0, led: 0, name: 'helper-parity' }), race);
        }
      }
      for (const kind of ['scrapling', 'scavenger', 'corrodius']) verify(await createEnemyCrab(kind), kind);
      verify(await createJellyfishRig(), 'jellyfish');
      return { rigs, poses, sockets, maxAnchorDelta, scope: 'view helper only; full S2 browser acceptance remains separate' };
    } finally { renderer.dispose(); }
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
