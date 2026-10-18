// The night scene's looks: a colour grade, a big moon, glows, a speed-line whoosh and the night elf's
// violet change. Every effect is a function of the shot clock.
//
//   night-grade   { mul, mulTop, gain, lift, k }    multiply the picture (top and bottom tints) and lift
//                                                    its blacks; `k` [[t, 0..1]] blends it in
//   night-moon    { dir, size, color, k, glow, glowColor, glowA, sky }   a moon disc of `size` degrees;
//                                                    the sky's own small moon moves behind it (sky: 'keep' leaves it)
//   night-glow    { at, size, color, k, depthTest }  an additive glow billboard (`k` [[t, i]] or number)
//   night-streaks { alpha, color, color2, center, speed, density, fill }   radial speed lines over the lens
//   night-burst   { at, d, size, color, color2, light, gain }   a flash, rays, rings and sparkles from a point
//   night-veil    { alpha, color, gain, order }      a colour over the view drawn inside the scene, under
//                                                    the particles (leaves blowing across a white screen)
import * as THREE from 'three';
import { envelope, glowTexture, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, GLSL, hdr, screenQuad, SCREEN_VERT, track, vec } from './night-kit';

class Grade implements Effect {
  private mul: THREE.Mesh;
  private lift: THREE.Mesh;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const gain = num(cue.gain, 1);
    const mulMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uBot: { value: hdr(cue.mul, gain, '#ffffff') },
        uTop: { value: hdr(cue.mulTop ?? cue.mul, num(cue.gainTop, gain), '#ffffff') },
        uK: { value: 1 },
        uSplit: { value: new THREE.Vector2(...((cue.split as [number, number]) ?? [0.35, 0.95])) },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uBot, uTop; uniform float uK; uniform vec2 uSplit; varying vec2 vUv;
        void main(){
          vec3 m = mix(uBot, uTop, smoothstep(uSplit.x, uSplit.y, vUv.y));
          gl_FragColor = vec4(mix(vec3(1.0), m, uK), 1.0);
        }`,
    });
    const liftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uC: { value: hdr(cue.lift ?? '#000000', num(cue.liftK, 1)) }, uK: { value: 1 } },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uK; varying vec2 vUv; void main(){ gl_FragColor = vec4(uC * uK, 1.0); }`,
    });
    this.mul = screenQuad(mulMat, num(cue.order, 990));
    this.lift = screenQuad(liftMat, num(cue.order, 990) + 1);
    scene.add(this.mul, this.lift);
  }

  update(ctx: FxContext): void {
    const k = this.cue.k !== undefined ? track(this.cue.k, ctx.t, 1) : envelope(this.cue, ctx.t);
    this.mul.visible = this.lift.visible = k > 0.001;
    (this.mul.material as THREE.ShaderMaterial).uniforms.uK.value = k;
    (this.lift.material as THREE.ShaderMaterial).uniforms.uK.value = k;
  }

  dispose(): void {
    for (const m of [this.mul, this.lift]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** A moon far out along `dir`, its disc `size` degrees across, hidden behind terrain. */
class Moon implements Effect {
  private disc: THREE.Mesh;
  private halo: THREE.Mesh;
  private dir: THREE.Vector3;
  /** The sky dome's moon direction (moved behind this moon while it shows) and its own value. */
  private skyMoon: THREE.Vector3 | null = null;
  private skyMoonWas = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.dir = vec(cue.dir, [-0.35, 0.55, 0.76]).normalize();
    if (cue.sky !== 'keep') {
      scene.traverse((o) => {
        const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
        if (!this.skyMoon && o.name === 'sky' && u?.uMoonDir) this.skyMoon = u.uMoonDir.value as THREE.Vector3;
      });
      if (this.skyMoon) this.skyMoonWas.copy(this.skyMoon);
    }
    const discMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uC: { value: hdr(cue.color ?? '#f4ecff', num(cue.intensity, 2.2)) }, uK: { value: 1 }, uSeed: { value: num(cue.seed, 3) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC; uniform float uK, uSeed; varying vec2 vUv;
        ${GLSL}
        void main(){
          vec2 q = vUv * 2. - 1.; float r = length(q);
          float disc = smoothstep(1.0, 0.985, r);
          if (disc < 0.002) discard;
          float z = sqrt(max(0., 1. - r * r));
          vec3 n = vec3(q, z);
          // Maria and craters: low-frequency patches and a few rings.
          float maria = smoothstep(0.45, 0.7, fbm(vec3(q * 2.2 + uSeed, 1.0)));
          float fine = fbm(vec3(q * 9.0 + uSeed * 3., 2.0));
          float shade = 1.0 - 0.32 * maria - 0.18 * fine;
          float limb = 0.55 + 0.45 * pow(z, 0.6);
          gl_FragColor = vec4(uC * shade * limb, disc * uK);
        }`,
    });
    const haloMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uC: { value: hdr(cue.glowColor ?? '#a58cff', num(cue.glowA, 0.6)) }, uK: { value: 1 }, uR: { value: 1 / num(cue.glow, 4) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC; uniform float uK, uR; varying vec2 vUv;
        void main(){
          float r = length(vUv * 2. - 1.);
          float a = exp(-max(0., r - uR) * 5.0) * smoothstep(1.0, 0.6, r) * 0.6 + exp(-max(0., r - uR) * 18.) * 0.5;
          gl_FragColor = vec4(uC * a * uK, 1.0);
        }`,
    });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), discMat);
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMat);
    for (const m of [this.disc, this.halo]) m.frustumCulled = false;
    this.halo.renderOrder = -5;
    this.disc.renderOrder = -4;
    scene.add(this.halo, this.disc);
  }

  update(ctx: FxContext): void {
    const k = this.cue.k !== undefined ? track(this.cue.k, ctx.t, 1) : envelope(this.cue, ctx.t);
    const vis = k > 0.001;
    this.disc.visible = this.halo.visible = vis;
    // The world puts its moon back every frame (its mood), so this runs every frame too.
    if (this.skyMoon) this.skyMoon.copy(vis ? this.dir : this.skyMoonWas);
    if (!vis) return;
    const dist = 1200;
    const r = dist * Math.tan(THREE.MathUtils.degToRad(num(this.cue.size, 8)) / 2);
    const p = ctx.camera.position.clone().addScaledVector(this.dir, dist);
    for (const m of [this.disc, this.halo]) {
      m.position.copy(p);
      m.quaternion.copy(ctx.camera.quaternion);
    }
    this.disc.scale.setScalar(r);
    this.halo.scale.setScalar(r * num(this.cue.glow, 4));
    (this.disc.material as THREE.ShaderMaterial).uniforms.uK.value = k;
    (this.halo.material as THREE.ShaderMaterial).uniforms.uK.value = k;
  }

  dispose(): void {
    this.skyMoon?.copy(this.skyMoonWas);
    for (const m of [this.disc, this.halo]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** An additive glow sprite at a point: a staff tip, a sky lit from below, a lantern. */
class Glow implements Effect {
  private sprite: THREE.Sprite;
  private base: THREE.Color;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.base = new THREE.Color(String(cue.color ?? '#9dff4a'));
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: this.base.clone(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: cue.depthTest !== false, transparent: true, fog: false }),
    );
    this.sprite.renderOrder = num(cue.order, 8);
    scene.add(this.sprite);
  }

  update(ctx: FxContext): void {
    const k = this.cue.k !== undefined ? track(this.cue.k, ctx.t, 0) * envelope({ ...this.cue, fadeIn: this.cue.fadeIn ?? 0.0001 }, ctx.t) : envelope(this.cue, ctx.t) * num(this.cue.intensity, 2);
    const pulse = 1 + num(this.cue.pulse, 0) * Math.sin(ctx.t * num(this.cue.rate, 9) + 1.3) * Math.sin(ctx.t * 3.1);
    this.sprite.visible = k > 0.001;
    if (!this.sprite.visible) return;
    this.sprite.position.copy(ctx.point(this.cue.at));
    this.sprite.scale.setScalar(num(this.cue.size, 4) * (this.cue.grow ? track(this.cue.grow, ctx.t, 1) : 1));
    this.sprite.material.color.copy(this.base).multiplyScalar(k * pulse);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.sprite.material.dispose();
  }
}

/** Radial speed lines and a coloured fill over the lens (the whoosh between worlds). */
class Streaks implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: 0 },
        uFill: { value: 0 },
        uC1: { value: hdr(cue.color ?? '#7ff6ff', num(cue.gain, 2)) },
        uC2: { value: hdr(cue.color2 ?? '#ffffff', num(cue.gain, 2)) },
        uCenter: { value: new THREE.Vector2(...((cue.center as [number, number]) ?? [0.5, 0.5])) },
        uSpeed: { value: num(cue.speed, 3) },
        uDensity: { value: num(cue.density, 60) },
        uAspect: { value: 2.2 },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA, uFill, uSpeed, uDensity, uAspect; uniform vec3 uC1, uC2; uniform vec2 uCenter; varying vec2 vUv;
        ${GLSL}
        void main(){
          vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
          float r = length(p); float a = atan(p.y, p.x) / 6.2831853 + 0.5;
          float lane = vnoise(vec3(a * uDensity, 0.0, 1.0));
          float n = vnoise(vec3(a * uDensity, (log(r + 0.02) - uTime * uSpeed) * 2.0, lane * 7.0));
          float n2 = vnoise(vec3(a * uDensity * 2.7 + 13.0, (log(r + 0.02) - uTime * uSpeed * 1.4) * 3.0, 4.0));
          float s = smoothstep(0.62, 0.95, n) + 0.6 * smoothstep(0.7, 0.98, n2);
          float m = smoothstep(0.05, 0.75, r);
          vec3 c = mix(uC1, uC2, smoothstep(0.4, 0.9, n2));
          vec3 fill = uC1 * uFill * (0.35 + 0.65 * smoothstep(1.2, 0.0, r));
          gl_FragColor = vec4((c * s * m + fill) * uA, 1.0);
        }`,
    });
    this.mesh = screenQuad(this.mat, 995);
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = this.cue.alpha ? track(this.cue.alpha, ctx.t, 0) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    const u = this.mat.uniforms;
    u.uTime.value = ctx.t;
    u.uA.value = a;
    u.uFill.value = this.cue.fill !== undefined ? track(this.cue.fill, ctx.t, 0) : 0;
    u.uAspect.value = ctx.camera.aspect;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** The change: a flash and star rays, rings racing out, sparkles and petals spiralling off a point. */
class Burst implements Effect {
  private sparks: Billboards;
  private glows: Billboards;
  private rays: THREE.Mesh;
  private light: THREE.PointLight;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = num(cue.size, 2.5);
    const c1 = hdr(cue.color ?? '#b066ff', 1);
    const c2 = hdr(cue.color2 ?? '#ff7ad9', 1);
    const shared = { uC: { value: new THREE.Vector3() }, uS: { value: S }, uC1: { value: c1 }, uC2: { value: c2 }, uD: { value: num(cue.d, 1.0) }, uK: { value: num(cue.gain, 1) } };
    const decl = 'uniform vec3 uC, uC1, uC2; uniform float uS, uD, uK;';
    this.sparks = new Billboards(scene, {
      count: num(cue.count, 260),
      seed: 21,
      sprite: 1,
      decl,
      uniforms: shared,
      body: /* glsl */ `
        float born = s2.x * 0.25; float t = tau - born; float life = 0.5 + 0.9 * s1.w;
        if (t > 0.0 && t < life) {
          vec3 d = dirFrom(s1.xy); d.y = d.y * 0.7 + 0.2;
          vec3 sw = normalize(cross(d, vec3(0., 1., 0.)) + 1e-4);
          float sp = uS * (2.5 + 5.0 * s1.z);
          float k = 2.2;
          vec3 v0 = d * sp + sw * sp * 0.6 * (s2.y - 0.5);
          pos = uC + v0 * (1. - exp(-k * t)) / k + vec3(0., 0.6 * t * t, 0.);
          vel = v0 * exp(-k * t) + vec3(0., 1.2 * t, 0.);
          stretch = 0.08;
          size = uS * 0.025 * (0.6 + s2.z);
          float f = 1. - t / life;
          col = vec4(mix(uC2, uC1, s2.w) * (2.0 + 6.0 * f) * uK, f);
        }`,
    });
    this.glows = new Billboards(scene, {
      count: 6,
      seed: 22,
      sprite: 2,
      decl,
      uniforms: shared,
      body: /* glsl */ `
        int i = int(idx * 5.0 + 0.5);
        if (i == 0) { size = uS * (1.2 + 3.0 * (1. - exp(-tau * 9.))); col = vec4(mix(uC1, vec3(1.), 0.5) * 6.0, exp(-tau * 5.)); pos = uC; }
        else if (i == 1) { size = uS * 1.6; col = vec4(uC1 * 3.0, smoothstep(0.0, 0.05, tau) * (1. - smoothstep(uD * 0.6, uD, tau))); pos = uC; }
        else if (i == 2) { size = uS * 0.7; col = vec4(vec3(1.0, 0.9, 1.0) * 8.0, exp(-tau * 3.)); pos = uC; }
        else {
          float t = tau - float(i - 3) * 0.12;
          if (t > 0.0) { pos = uC; size = uS * (0.3 + 5.0 * (1. - exp(-t * 4.))); col = vec4(mix(uC1, uC2, float(i - 3) * 0.5) * 3.0, exp(-t * 3.)); }
        }
        col.rgb *= uK;`,
      depthTest: true,
    });
    const rayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uA: { value: 0 }, uC: { value: c1.clone().lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(4) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA; uniform vec3 uC; varying vec2 vUv;
        ${GLSL}
        void main(){
          vec2 q = vUv * 2. - 1.; float r = length(q); float a = atan(q.y, q.x);
          float rays = pow(vnoise(vec3(a * 7.0, uTime * 2.0, 0.0)), 3.0) * 1.6 + pow(abs(cos(a * 2.0)), 40.0) * 1.2;
          float f = rays * smoothstep(1.0, 0.05, r) * smoothstep(0.0, 0.08, r) + exp(-r * 9.) * 1.5;
          gl_FragColor = vec4(uC * f * uA, 1.0);
        }`,
    });
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rayMat);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 9;
    scene.add(this.rays);
    this.light = new THREE.PointLight(c1.clone(), 0, S * 14, 1.4);
    scene.add(this.light);
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const d = num(this.cue.d, 1.0);
    const on = tau >= 0 && tau < d + 1.6;
    const c = ctx.point(this.cue.at);
    for (const b of [this.sparks, this.glows]) {
      (b.u.uC.value as THREE.Vector3).copy(c);
      b.set(tau, ctx, on);
    }
    const ra = on ? num(this.cue.gain, 1) * Math.exp(-Math.max(0, tau) * 3.2) * Math.min(1, tau / 0.03) : 0;
    this.rays.visible = ra > 0.002;
    const rm = this.rays.material as THREE.ShaderMaterial;
    rm.uniforms.uA.value = ra;
    rm.uniforms.uTime.value = ctx.t;
    this.rays.position.copy(c);
    this.rays.quaternion.copy(ctx.camera.quaternion);
    this.rays.scale.setScalar(num(this.cue.size, 2.5) * 5);
    this.light.position.copy(c).y += 0.5;
    this.light.intensity = on ? num(this.cue.light, 300) * (Math.exp(-tau * 2.5) * 0.8 + 0.2 * (1 - Math.min(1, tau / d))) : 0;
  }

  dispose(): void {
    this.sparks.dispose();
    this.glows.dispose();
    this.rays.removeFromParent();
    this.rays.geometry.dispose();
    (this.rays.material as THREE.Material).dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }
}

/** A screen colour drawn in the scene before the particles, so leaves can cross a white frame. */
class Veil implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uC: { value: hdr(cue.color ?? '#ffffff', num(cue.gain, 4)) }, uA: { value: 0 } },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uA; varying vec2 vUv; void main(){ gl_FragColor = vec4(uC, uA); }`,
    });
    this.mesh = screenQuad(this.mat, num(cue.order, 4));
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = this.cue.alpha ? track(this.cue.alpha, ctx.t, 0) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    this.mat.uniforms.uA.value = Math.min(1, a);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

registerEffect('night-veil', (cue, scene) => new Veil(cue, scene));
registerEffect('night-grade', (cue, scene) => new Grade(cue, scene));
registerEffect('night-moon', (cue, scene) => new Moon(cue, scene));
registerEffect('night-glow', (cue, scene) => new Glow(cue, scene));
registerEffect('night-streaks', (cue, scene) => new Streaks(cue, scene));
registerEffect('night-burst', (cue, scene) => new Burst(cue, scene));
