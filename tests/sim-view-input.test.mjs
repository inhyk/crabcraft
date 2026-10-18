import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createLivePosition, applyNumericPose } from '../src/game/simUnitView.ts';
import { sampleHeld, captureEdges } from '../src/game/playerInput.ts';
import { InputAccumulator } from '../src/sim/input.ts';

// Exercise the shipped DOM input handlers too; this boundary owns no replacement key state.
const inputSource = readFileSync(new URL('../src/core/input.ts', import.meta.url), 'utf8');
const { code } = transformSync(inputSource, { loader: 'ts', format: 'esm', target: 'es2022' });
const { Input } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function keyboard() {
  const previousWindow = globalThis.window, previousElement = globalThis.Element;
  class Element extends EventTarget { closest() { return null; } }
  const window = new EventTarget(), target = new Element();
  globalThis.window = window;
  globalThis.Element = Element;
  const input = new Input(target);
  const key = (type, code, repeat = false, eventTarget = null) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, repeat });
    if (eventTarget) Object.defineProperty(event, 'target', { value: eventTarget });
    window.dispatchEvent(event);
  };
  return {
    input, key,
    pointer(type, button) {
      const event = new Event(type);
      Object.assign(event, { button, clientX: 0, clientY: 0 });
      (type === 'pointerdown' ? target : window).dispatchEvent(event);
    },
    blur() { window.dispatchEvent(new Event('blur')); },
    close() { input.dispose(); globalThis.window = previousWindow; globalThis.Element = previousElement; },
  };
}
const gameFor = input => ({ input, controlsLocked: false, follow: { yaw: .3, steering: false, forwardYaw: 1.2 } });

test('live position is a native Vector3 with fluent setters, copy, add and distance semantics', () => {
  const state = { x: 1, y: 2, z: 3 }, position = createLivePosition(() => state);
  assert.equal(position instanceof THREE.Vector3, true);
  assert.equal(position.set(2, 4, 6), position);
  assert.deepEqual(state, { x: 2, y: 4, z: 6 });
  assert.equal(position.copy(new THREE.Vector3(1, 2, 3)).add(new THREE.Vector3(4, 5, 6)), position);
  assert.deepEqual(state, { x: 5, y: 7, z: 9 });
  assert.equal(position.distanceTo(new THREE.Vector3(5, 10, 13)), 5);
  assert.equal(position.dot(new THREE.Vector3(2, 0, 1)), 19);
  assert.deepEqual([...position], [5, 7, 9]);
});

test('retained live position follows rebind and life replacement while clones stay detached', () => {
  const old = { x: 1, y: 2, z: 3, ref: { life: 1 } };
  let actor = old;
  const position = createLivePosition(() => actor), clone = position.clone();
  actor = { x: 8, y: 9, z: 10, ref: { life: 2 } };
  assert.deepEqual(position.toArray(), [8, 9, 10]);
  position.setComponent(0, 11).addScaledVector(new THREE.Vector3(1, 2, 3), 2);
  assert.deepEqual(position.toArray(), [13, 13, 16]);
  assert.deepEqual(old, { x: 1, y: 2, z: 3, ref: { life: 1 } });
  assert.deepEqual(clone.toArray(), [1, 2, 3]);
  clone.setScalar(20);
  assert.deepEqual(position.toArray(), [13, 13, 16]);
  actor.x = -7;
  assert.equal(position.x, -7);
});

test('numeric pose writes only the rig transform and joints without applying lift or scale twice', () => {
  const state = Object.freeze({
    x: 7, y: 2.5, z: -3, yaw: .6, lift: .8, alive: false,
    pose: Object.freeze({ appliedQ: Object.freeze([.1, .2, .3]), appliedPosition: Object.freeze([.02, .03, -.04]), appliedRotation: Object.freeze([0, .6, 0, .8]) }),
  });
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); root.scale.set(3, 4, 5);
  let joints;
  const rig = { root, body, metersToUnits: 8, setPose(q) { joints = q; }, update() { assert.fail('The caller owns the visual update'); } };
  applyNumericPose(rig, state);
  assert.deepEqual(root.position.toArray(), [7, 2.5, -3]);
  assert.equal(root.rotation.y, .6);
  assert.deepEqual(root.scale.toArray(), [3, 4, 5]);
  assert.deepEqual(body.position.toArray(), [.16, .24, -.32]);
  assert.deepEqual(body.quaternion.toArray(), [0, .6, 0, .8]);
  assert.equal(joints, state.pose.appliedQ);
});

test('held keys retain old movement aliases, opposite-key cancellation and camera turn', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    for (const code of ['ArrowUp', 'KeyA', 'ArrowLeft', 'ShiftRight']) keys.key('keydown', code);
    sampleHeld(game, accumulator, .1);
    const frame = accumulator.next();
    assert.deepEqual([frame.forward, frame.strafe, frame.turn, frame.sprint], [1, 1, 1, true]);
    assert.ok(Math.abs(game.follow.yaw - .59) < 1e-12);
    for (const code of ['KeyS', 'KeyD', 'KeyE']) keys.key('keydown', code);
    sampleHeld(game, accumulator, .1);
    const opposed = accumulator.next();
    assert.deepEqual([opposed.forward, opposed.strafe, opposed.turn], [0, 0, 0]);
  } finally { keys.close(); }
});

test('both mouse buttons override backwards and left drag preserves camera yaw', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyS'); keys.key('keydown', 'KeyQ');
    keys.pointer('pointerdown', 0); keys.pointer('pointerdown', 2);
    game.follow.steering = true;
    sampleHeld(game, accumulator, .2);
    const frame = accumulator.next();
    assert.equal(frame.forward, 1); assert.equal(frame.turn, 1);
    assert.equal(frame.steeringYaw, 1.2); assert.equal(game.follow.yaw, .3);
  } finally { keys.close(); }
});

test('short presses survive zero-tick render frames and are consumed once over catch-up ticks', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'Space'); keys.key('keyup', 'Space');
    sampleHeld(game, accumulator, .005); captureEdges(game, accumulator); keys.input.endFrame();
    keys.key('keydown', 'KeyB'); keys.key('keyup', 'KeyB');
    sampleHeld(game, accumulator, .005); captureEdges(game, accumulator); keys.input.endFrame();
    // This already-authorized callback uses the same command queue.
    accumulator.push({ kind: 'ability', slot: 3 });
    for (let frame = 0; frame < 3; frame++) { sampleHeld(game, accumulator, .005); captureEdges(game, accumulator); keys.input.endFrame(); }
    assert.deepEqual(accumulator.next().commands, [{ kind: 'jump' }, { kind: 'dance' }, { kind: 'ability', slot: 3 }]);
    assert.deepEqual(accumulator.next().commands, []);
    assert.deepEqual(accumulator.next().commands, []);
  } finally { keys.close(); }
});

test('held and repeated B keydown never replay a dance command in later frames', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyB'); captureEdges(game, accumulator); keys.input.endFrame();
    assert.deepEqual(accumulator.next().commands, [{ kind: 'dance' }]);
    keys.key('keydown', 'KeyB', true); captureEdges(game, accumulator); keys.input.endFrame();
    assert.deepEqual(accumulator.next().commands, []);
  } finally { keys.close(); }
});

test('locks neutralize movement and suppress new edges while a forge callback still queues', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    for (const code of ['KeyW', 'KeyA', 'KeyQ', 'ShiftLeft', 'Space', 'KeyB']) keys.key('keydown', code);
    game.controlsLocked = true; game.follow.steering = true;
    accumulator.push({ kind: 'forgeBuy', npcId: 'smith' });
    sampleHeld(game, accumulator, .1); captureEdges(game, accumulator);
    const frame = accumulator.next();
    assert.deepEqual([frame.forward, frame.strafe, frame.turn, frame.sprint, frame.steeringYaw], [0, 0, 0, false, null]);
    assert.equal(game.follow.yaw, .3);
    assert.deepEqual(frame.commands, [{ kind: 'forgeBuy', npcId: 'smith' }]);
  } finally { keys.close(); }
});

test('channel hold preserves recall priority and the active F channel kind', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyF'); sampleHeld(game, accumulator, .01, 'waystone');
    assert.equal(accumulator.next().heldChannel, 'waystone');
    sampleHeld(game, accumulator, .01); assert.equal(accumulator.next().heldChannel, 'beacon');
    keys.key('keydown', 'KeyT'); sampleHeld(game, accumulator, .01, 'waystone');
    assert.equal(accumulator.next().heldChannel, 'recall');
    keys.key('keyup', 'KeyT'); keys.key('keyup', 'KeyF'); sampleHeld(game, accumulator, .01);
    assert.equal(accumulator.next().heldChannel, null);
  } finally { keys.close(); }
});

test('blur stops held movement and a new focused keydown restores it', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyW'); keys.key('keydown', 'KeyF'); sampleHeld(game, accumulator, .01);
    assert.equal(accumulator.next().forward, 1); keys.input.endFrame();
    keys.blur(); sampleHeld(game, accumulator, .01);
    const blurred = accumulator.next(); assert.equal(blurred.forward, 0); assert.equal(blurred.heldChannel, null);
    keys.key('keydown', 'KeyW'); sampleHeld(game, accumulator, .01);
    assert.equal(accumulator.next().forward, 1);
  } finally { keys.close(); }
});

test('focus on typing fields and UI activation retains the shipped input ownership', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyW', false, { tagName: 'INPUT' });
    keys.key('keydown', 'KeyB', false, { tagName: 'TEXTAREA' });
    const button = new globalThis.Element(); button.closest = () => button;
    keys.key('keydown', 'Space', false, button);
    sampleHeld(game, accumulator, .01); captureEdges(game, accumulator);
    const frame = accumulator.next(); assert.equal(frame.forward, 0); assert.deepEqual(frame.commands, []);
  } finally { keys.close(); }
});

test('clearing on area/ownership change removes old actor edges and held state', () => {
  const keys = keyboard();
  try {
    const game = gameFor(keys.input), accumulator = new InputAccumulator();
    keys.key('keydown', 'KeyW'); keys.key('keydown', 'Space');
    sampleHeld(game, accumulator, .01); captureEdges(game, accumulator); keys.input.endFrame();
    accumulator.clear();
    const nextActor = accumulator.next(); assert.equal(nextActor.forward, 0); assert.deepEqual(nextActor.commands, []);
    keys.blur(); sampleHeld(game, accumulator, .01); captureEdges(game, accumulator);
    assert.deepEqual(accumulator.next().commands, []);
  } finally { keys.close(); }
});

test('reset clears same-frame keyboard and button edges before ownership/focus sampling',()=>{
 const k=keyboard();try{k.key('keydown','Space');k.pointer('pointerdown',0);k.input.reset();assert.equal(k.input.wasPressed('Space'),false);assert.equal(k.input.wasButtonPressed(0),false);assert.equal(k.input.isDown('Space'),false);const q=new InputAccumulator();captureEdges(gameFor(k.input),q);assert.deepEqual(q.next().commands,[]);}finally{k.close();}
});

test('server Unit observation reads live immutable snapshots and rejects every numeric authority entry point',async()=>{
 const {build}=await import('esbuild');const bundled=await build({entryPoints:[new URL('../src/game/unit.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});const {Unit}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
 let renders=0,actions=0;const rig={root:new THREE.Group(),update(){renders++;}},motion={update(){actions++;}};
 let state={ref:{area:'world',id:3,life:1},x:1,y:2,z:3,kind:'player',reaction:'player',archetype:'human',hp:100,maxHp:100,level:1,yaw:0,radius:1,height:2,alive:true,hidden:false,targetable:true,invulnerable:false,stunUntil:0,slowUntil:0,slowPct:0,rust:0,rustUntil:0,absorb:0,absorbMax:0,absorbUntil:0,blessingUntil:0,pushX:0,pushZ:0,pushTime:0,lift:0,pose:{appliedQ:[],appliedPosition:[0,0,0],appliedRotation:[0,0,0,1],localVx:3,localVz:4}};
 const unit=new Unit('observed','remote','player',rig,motion);unit.bindWorldView(()=>state);const pos=unit.pos,clone=pos.clone();state={...state,x:8,hp:75,ref:{...state.ref,life:2}};
 assert.equal(pos.x,8);assert.equal(unit.hp,75);assert.equal(unit.ref.life,2);assert.equal(unit.moveSpeed,5);assert.equal(clone.x,1);
 for(const write of [()=>pos.set(0,0,0),()=>unit.hp=0,()=>unit.setYaw(1),()=>unit.act('idle'),()=>unit.moveTo({},0,0,.1),()=>unit.teleport({},0,0),()=>unit.feedLocomotion(.1),()=>unit.updateHit(.1),()=>unit.cancelPendingHit()])assert.throws(write,/readonly|server state/);
 unit.updateVisual(.1);assert.equal(renders,0);assert.equal(actions,0);assert.equal(state.hp,75);
});
