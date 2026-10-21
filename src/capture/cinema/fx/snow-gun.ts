// snow-gun: the dwarf's blunderbuss. The game has no guns and the contest forbids bringing any, so it is
// built here from primitives in the game's material look: an iron barrel opening into a flared bell, a
// walnut stock, brass bands, lock and trigger guard. It sits in a crab's claw and aims at a point.
//
//   snow-gun { actor, socket ('clawR'), size (1 = about 1.4 units long), grip [x, y, z] (the gun-local
//              point the claw holds), aim [[t, point | 'camera'], ...] (the latest key at t wins),
//              lift [[t, degrees]] (muzzle up), fire (t of the shot), kick (recoil, units), hide [sockets],
//              flash [[t, alpha]...] and flashColor (the glare flooding the lens), shake, light }
// The shot at `fire`: a flame tongue and a glare out of the bell that floods the lens, a smoke ring and
// a smoke cloud rolling out along the barrel, sparks and burning wadding, the gun kicking back and
// climbing, the camera shaking.
import * as THREE from 'three';
import { curve, glowTexture, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import type { Unit } from '../../../game/unit';
import { Sprite } from '../../../game/vfx/atlas';

/** The stage's actor of this id (the latest unit of that name). */
function actorUnit(id: unknown): Unit | null {
  const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
  const us = g?.units ?? [];
  for (let i = us.length - 1; i >= 0; i--) if (us[i].name === id) return us[i];
  return null;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const along = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);

/** The blunderbuss, +z out of the muzzle, origin at the lock; returns the group and the muzzle's z. */
function buildGun(): { gun: THREE.Group; muzzle: number } {
  const iron = new THREE.MeshStandardMaterial({ color: '#4a4f58', metalness: 0.85, roughness: 0.36 });
  const bore = new THREE.MeshStandardMaterial({ color: '#16181c', metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: '#6e3a1a', metalness: 0, roughness: 0.58 });
  const brass = new THREE.MeshStandardMaterial({ color: '#d29a3c', metalness: 0.95, roughness: 0.26 });
  const gun = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    gun.add(m);
    return m;
  };
  // Breech and barrel, a little wider at the back.
  add(along(new THREE.CylinderGeometry(0.075, 0.08, 0.18, 20)), iron, 0, 0, 0.02);
  add(along(new THREE.CylinderGeometry(0.052, 0.064, 0.72, 20)), iron, 0, 0, 0.47);
  // The bell: a lathe out to a thick lip and back in, dark inside.
  const out: THREE.Vector2[] = [
    [0.052, 0], [0.06, 0.06], [0.08, 0.13], [0.115, 0.2], [0.16, 0.26], [0.2, 0.3], [0.212, 0.315],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const inn: THREE.Vector2[] = [[0.198, 0.322], [0.184, 0.3], [0.14, 0.255], [0.095, 0.19], [0.06, 0.1], [0.034, 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
  const bellZ = 0.82;
  add(along(new THREE.LatheGeometry(out, 32)), iron, 0, 0, bellZ);
  add(along(new THREE.LatheGeometry(inn, 32)), bore, 0, 0, bellZ);
  const rim = add(new THREE.TorusGeometry(0.205, 0.016, 10, 40), brass, 0, 0, bellZ + 0.317);
  rim.castShadow = false;
  const hole = add(new THREE.CircleGeometry(0.036, 20), new THREE.MeshBasicMaterial({ color: '#050506' }), 0, 0, bellZ + 0.03);
  hole.castShadow = false;
  // Brass bands along the barrel and a bead at the breech.
  for (const z of [0.16, 0.42, 0.68]) add(new THREE.TorusGeometry(0.064 - z * 0.012, 0.014, 8, 28), brass, 0, 0, z);
  add(along(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 20)), brass, 0, 0, -0.07);
  // The stock: a forestock under the barrel and a butt that drops and widens toward the shoulder.
  add(new THREE.BoxGeometry(0.075, 0.06, 0.5), wood, 0, -0.065, 0.3);
  const butt = new THREE.BoxGeometry(0.09, 0.12, 0.56, 1, 1, 6);
  const p = butt.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = (0.28 - p.getZ(i)) / 0.56; // 0 at the lock, 1 at the butt
    p.setY(i, p.getY(i) * (0.75 + 1.25 * k) - 0.05 - 0.14 * k);
    p.setX(i, p.getX(i) * (1 + 0.35 * k));
    p.setZ(i, p.getZ(i) - 0.36);
  }
  butt.computeVertexNormals();
  add(butt, wood);
  add(new THREE.BoxGeometry(0.1, 0.24, 0.03), brass, 0, -0.17, -0.65); // butt plate
  // Lock plate and hammer on the right, trigger and its guard under the lock.
  add(new THREE.BoxGeometry(0.022, 0.07, 0.16), brass, -0.08, -0.01, 0.0);
  const hammer = add(new THREE.BoxGeometry(0.02, 0.09, 0.025), iron, -0.085, 0.05, -0.04);
  hammer.rotation.x = -0.5;
  const guard = add(new THREE.TorusGeometry(0.05, 0.009, 6, 20, Math.PI), brass, 0, -0.1, -0.02);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  add(new THREE.BoxGeometry(0.012, 0.06, 0.012), iron, 0, -0.1, -0.02);
  return { gun, muzzle: bellZ + 0.32 };
}

/** A soft ring of smoke: a torus whose edges fade where its surface turns away from the view. */
function smokeRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color('#d9dde4') } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uA; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(uColor, f * uA); }`,
  });
}

/** The flame out of the bell: an open cone, hot white at the mouth to orange at its ragged tip. */
function tongueMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uA, uTime; varying vec2 vUv;
      void main(){
        float along = 1.0 - vUv.y; // 0 at the mouth, 1 at the tip
        float rag = 0.75 + 0.25 * sin(vUv.x * 43.0 + uTime * 90.0) * sin(vUv.x * 17.0 - uTime * 60.0);
        float a = smoothstep(rag, 0.0, along) * uA;
        vec3 c = mix(vec3(6.0, 5.0, 3.6), vec3(4.0, 1.2, 0.2), smoothstep(0.0, 0.7, along));
        gl_FragColor = vec4(c * a, a);
      }`,
  });
}

class Gun implements Effect {
  private gun: THREE.Group;
  private inner = new THREE.Group();
  private muzzleZ: number;
  private glare: THREE.Sprite;
  private tongue: THREE.Mesh;
  private tongueMat = tongueMaterial();
  private ring: THREE.Mesh;
  private ringMat = smokeRingMaterial();
  private ringFrom = new THREE.Vector3();
  private ringQ = new THREE.Quaternion();
  private light: THREE.PointLight;
  private hidden: THREE.Object3D[] = [];
  private hid = false;
  private fired = false;
  private v = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const { gun, muzzle } = buildGun();
    this.muzzleZ = muzzle;
    this.gun = new THREE.Group();
    const [gx, gy, gz] = (cue.grip as number[]) ?? [0, 0, 0];
    gun.position.set(-gx, -gy, -gz);
    this.inner.add(gun);
    this.inner.scale.setScalar(num(cue.size, 1));
    this.gun.add(this.inner);
    this.gun.traverse((o) => (o.frustumCulled = false));
    scene.add(this.gun);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffd9a8').multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }));
    this.glare.renderOrder = 998;
    this.glare.visible = false;
    scene.add(this.glare);
    const cone = new THREE.CylinderGeometry(0.16, 0.5, 1, 24, 1, true);
    cone.translate(0, 0.5, 0);
    this.tongue = new THREE.Mesh(along(cone), this.tongueMat);
    this.tongue.position.z = muzzle - 0.04;
    this.tongue.visible = false;
    this.tongue.frustumCulled = false;
    gun.add(this.tongue);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.38, 14, 48), this.ringMat);
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 7;
    scene.add(this.ring);
    this.light = new THREE.PointLight('#ffb35a', 0, num(cue.light, 9), 1.5);
    scene.add(this.light);
  }

  /** The aim point at t: the latest key at or before t. */
  private aim(ctx: FxContext): THREE.Vector3 {
    const keys = (this.cue.aim as [number, unknown][]) ?? [];
    let p: unknown = null;
    for (const [t, pt] of keys) if (t <= ctx.t || p === null) p = pt;
    return p === 'camera' || p === null ? this.v.copy(ctx.camera.position) : this.v.copy(ctx.point(p));
  }

  update(ctx: FxContext): void {
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    if (!this.hid) {
      this.hid = true;
      for (const n of (this.cue.hide ?? []) as string[]) for (const c of u.rig.getSocket(n as never).children) if (c.visible) this.hidden.push(c);
    }
    for (const c of this.hidden) c.visible = false;
    this.gun.visible = !u.hidden;
    u.rig.root.updateMatrixWorld(true);
    const grip = u.rig.getSocket(String(this.cue.socket ?? 'clawR') as never).getWorldPosition(new THREE.Vector3());
    const target = this.aim(ctx);
    this.dir.copy(target).sub(grip).normalize();
    // Recoil: back along the barrel and the muzzle climbing, sharp out and slow back.
    const fire = num(this.cue.fire, Infinity);
    const tau = ctx.t - fire;
    const rec = tau < 0 ? 0 : tau < 0.04 ? tau / 0.04 : Math.exp(-(tau - 0.04) * 6);
    const lift = THREE.MathUtils.degToRad((this.cue.lift ? curve(this.cue.lift as [number, number][], ctx.t) : 0) + 16 * rec);
    this.m.lookAt(grip, target, new THREE.Vector3(0, 1, 0));
    // Matrix4.lookAt points -z at the target (a camera's look); the gun's muzzle is +z.
    this.gun.quaternion.setFromRotationMatrix(this.m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.gun.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -lift));
    this.gun.position.copy(grip).addScaledVector(this.dir, -num(this.cue.kick, 0.18) * rec);
    this.gun.updateMatrixWorld(true);
    const size = num(this.cue.size, 1);
    const muzzle = new THREE.Vector3(0, 0, this.muzzleZ).applyMatrix4(this.inner.children[0].matrixWorld);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.gun.quaternion);

    // The glare out of the bell: blooms in a few frames and dies over half a second.
    const g = tau < 0 ? 0 : tau < 0.12 ? smooth(tau / 0.12) : Math.max(0, 1 - (tau - 0.12) / 0.45);
    this.glare.visible = g > 0.001;
    if (this.glare.visible) {
      this.glare.position.copy(muzzle).addScaledVector(fwd, 0.15 * size);
      this.glare.scale.setScalar(size * (0.6 + 7 * smooth(tau / 0.14)));
      this.glare.material.opacity = g;
    }
    const tg = tau < 0 ? 0 : tau < 0.03 ? tau / 0.03 : Math.max(0, 1 - (tau - 0.03) / 0.22);
    this.tongue.visible = tg > 0.001;
    if (this.tongue.visible) {
      this.tongue.scale.set(1 + tau * 3, 1 + tau * 3, 0.6 + 2.2 * smooth(tau / 0.08));
      this.tongueMat.uniforms.uA.value = tg;
      this.tongueMat.uniforms.uTime.value = ctx.t;
    }
    this.light.position.copy(muzzle).addScaledVector(fwd, 0.4);
    this.light.intensity = tau < 0 ? 0 : num(this.cue.lightI, 80) * (tau < 0.03 ? tau / 0.03 : Math.exp(-(tau - 0.03) * 9));
    if (this.cue.flash) {
      const a = curve(this.cue.flash as [number, number][], ctx.t);
      if (a > 0) ctx.overlay(String(this.cue.flashColor ?? '#fff0d8'), Math.min(1, a));
    }
    if (tau >= 0 && tau < num(this.cue.shakeD, 0.5)) ctx.shake(num(this.cue.shake, 0.12) * (1 - tau / num(this.cue.shakeD, 0.5)) ** 2);

    if (!this.fired && tau >= 0) {
      this.fired = true;
      this.ringFrom.copy(muzzle);
      this.ringQ.copy(this.gun.quaternion);
      this.burst(ctx, muzzle, fwd, size);
    }
    // The smoke ring rolls out along the barrel, widening and thinning.
    const rt = tau;
    this.ring.visible = this.fired && rt >= 0 && rt < 1.6;
    if (this.ring.visible) {
      const d = 2.6 * size * (1 - Math.exp(-rt * 3.2));
      this.ring.position.copy(this.ringFrom).add(new THREE.Vector3(0, 0, d).applyQuaternion(this.ringQ));
      this.ring.position.y += 0.25 * rt;
      this.ring.quaternion.copy(this.ringQ);
      const r = size * (0.12 + 0.7 * (1 - Math.exp(-rt * 2.6)));
      this.ring.scale.set(r, r, r * 0.8);
      this.ringMat.uniforms.uA.value = 0.75 * smooth(rt / 0.06) * Math.max(0, 1 - rt / 1.6);
    }
  }

  private burst(ctx: FxContext, at: THREE.Vector3, fwd: THREE.Vector3, size: number): void {
    const v = ctx.vfx;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.gun.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.gun.quaternion);
    const r = () => Math.random() * 2 - 1;
    // Smoke: a cloud thrown out of the bell that slows and hangs.
    for (let i = 0; i < 46; i++) {
      const s = (2 + Math.random() * 7) * size;
      const vel = fwd.clone().multiplyScalar(s).addScaledVector(side, r() * 1.6 * size).addScaledVector(up, r() * 1.6 * size + 0.4);
      const grey = 0.62 + Math.random() * 0.25;
      v.alpha.emit({ x: at.x, y: at.y, z: at.z, vx: vel.x, vy: vel.y, vz: vel.z, life: 1.4 + Math.random() * 1.2, size: 0.25 * size, sizeEnd: (1.4 + Math.random()) * size, color: new THREE.Color(grey, grey, grey * 1.04), alpha: 0.6, drag: 3.2, sprite: Sprite.Smoke, spin: r(), fadeIn: 0.05 });
    }
    // Sparks and burning wadding.
    for (let i = 0; i < 70; i++) {
      const s = (5 + Math.random() * 12) * size;
      const vel = fwd.clone().multiplyScalar(s).addScaledVector(side, r() * 4 * size).addScaledVector(up, r() * 4 * size);
      v.add.emit({ x: at.x, y: at.y, z: at.z, vx: vel.x, vy: vel.y, vz: vel.z, life: 0.25 + Math.random() * 0.5, size: (0.04 + Math.random() * 0.05) * size, sizeEnd: 0.01, color: new THREE.Color(5, 2.2 + Math.random() * 1.5, 0.5), gravity: 5, drag: 1.6, sprite: Sprite.Spark, stretch: 0.06 });
    }
    v.glow(at, new THREE.Color(8, 6, 4), 2.2 * size, 0.18, 4 * size);
  }

  reset(): void {
    this.fired = false;
  }

  dispose(): void {
    for (const c of this.hidden) c.visible = true;
    this.hidden = [];
    for (const o of [this.gun, this.glare, this.ring, this.light]) o.removeFromParent();
    this.gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.tongueMat.dispose();
    this.glare.material.dispose();
    this.light.dispose();
  }
}

registerEffect('snow-gun', (cue, scene) => new Gun(cue, scene));
