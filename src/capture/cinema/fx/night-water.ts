// Water for the night elf's run: a puddle and a pond she splashes through, and the sea the beast
// dives into. Every frame is a function of the shot clock, like the rest of the night effects.
//
//   night-pool { at: [x, z], size: [rx, rz], yaw, rise, level, hits: [[t, x, z, k], ...], deep,
//                shallow, sky, moon: [dx, dy, dz], edge, opacity, sheen, sheenP, crestK, rim, rimColor }
//       a still water surface at `level` (or `rise` over the ground at its centre), filling an
//       ellipse with a ragged shore and only where the ground lies under it (a shore that follows the
//       slope); dark with depth, a lavender sky sheen and the moon's glint at grazing angles; each hit
//       sends ring waves out from (x, z) at t that shake the reflection and catch the light, with
//       foam where it struck. `sheen` lays a broad moon path (lobe `sheenP`) that the ripples break
//       into glints, `crestK` lights the ring crests, `rim` a thin wet shine along the shore
//   night-splash { at, from, to, d, scale, dir: [dx, dz], count, sheets, color, gain, drop, flare, spread }
//       water thrown up by a foot or a body: droplet streaks up and forward under gravity, sheets of
//       spray (a crown round the strike), a mist that hangs; `from`/`to` (points) over `d` seconds
//       make a moving wake (born along the line as she runs through), else one burst at `at`.
//       `drop` scales the droplets, `flare` a moonlit glint that blooms where the water breaks,
//       `spread` the droplets' outward speed (low: a column)
//   night-foam { alpha: [[t, a]], cover: [[t, c]], color, color2, dark, center: [x, y], speed, scale, order }
//       white water over the lens as it plunges through a splash: foam and spray streaks rushing out
//       from `center` (screen, -0.5..0.5), teal in their gaps and bubbles; `cover` (0..1) is how much
//       of it is still white
import * as THREE from 'three';
import { NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, fogUniforms, hdr, screenQuad, SCREEN_VERT, syncFog, track } from './night-kit';

const MAX_HITS = 24;
const GRID = 48;

class Pool implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const [cx, cz] = (cue.at as [number, number]) ?? [0, 0];
    const [rx, rz] = (cue.size as [number, number]) ?? [1, 1];
    const yaw = num(cue.yaw, 0);
    const level = cue.level !== undefined ? num(cue.level, 0) : ground(cx, cz) + num(cue.rise, 0.05);
    // Depth under the surface over the ellipse's box, 0..1 for -0.25..+1.25 units.
    const ex = rx * 1.25;
    const ez = rz * 1.25;
    const data = new Uint8Array(GRID * GRID * 4);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const lx = (i / (GRID - 1) * 2 - 1) * ex;
        const lz = (j / (GRID - 1) * 2 - 1) * ez;
        const d = level - ground(cx + lx * c + lz * s, cz - lx * s + lz * c);
        const v = Math.round(255 * Math.min(1, Math.max(0, (d + 0.25) / 1.5)));
        data.set([v, v, v, 255], (j * GRID + i) * 4);
      }
    }
    this.tex = new THREE.DataTexture(data, GRID, GRID);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const hits = ((cue.hits as number[][]) ?? []).slice(0, MAX_HITS);
    const hitV = Array.from({ length: MAX_HITS }, (_, i) => {
      const h = hits[i];
      return h ? new THREE.Vector4(h[1], h[2], h[0], h[3] ?? 1) : new THREE.Vector4(0, 0, 1e9, 0);
    });
    const moon = new THREE.Vector3(...((cue.moon as [number, number, number]) ?? [-0.4, 0.35, 0.8])).normalize();
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDepth: { value: this.tex },
        uBox: { value: new THREE.Vector4(cx, cz, ex, ez) },
        uR: { value: new THREE.Vector2(rx, rz) },
        uRot: { value: new THREE.Vector2(c, s) },
        uHits: { value: hitV },
        uDeep: { value: hdr(cue.deep ?? '#030208', 1) },
        uShallow: { value: hdr(cue.shallow ?? '#141026', 1) },
        uSky: { value: hdr(cue.sky ?? '#3c3366', num(cue.skyK, 1)) },
        uMoon: { value: moon },
        uMoonC: { value: hdr(cue.moonColor ?? '#f0e8ff', num(cue.glint, 6)) },
        uEdge: { value: num(cue.edge, 0.25) },
        uOpacity: { value: num(cue.opacity, 0.92) },
        uRing: { value: num(cue.ring, 1) },
        uSheen: { value: hdr(cue.moonColor ?? '#f0e8ff', num(cue.sheen, 0)) },
        uSheenP: { value: num(cue.sheenP, 18) },
        uCrestK: { value: num(cue.crestK, 0.07) },
        uRim: { value: hdr(cue.rimColor ?? '#c8bcff', num(cue.rim, 0)) },
        ...fogUniforms(),
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uEdge, uOpacity, uRing, uSheenP, uCrestK;
        uniform vec3 uSheen, uRim;
        uniform sampler2D uDepth;
        uniform vec4 uBox; uniform vec2 uR, uRot;
        uniform vec4 uHits[${MAX_HITS}];
        uniform vec3 uDeep, uShallow, uSky, uMoon, uMoonC;
        uniform vec3 uFogColor; uniform float uFogMode, uFogA, uFogB;
        varying vec3 vW;
        ${NOISE}
        float fogAmount(float d){
          if (uFogMode < 0.5) return 0.;
          if (uFogMode < 1.5) return 1. - exp(-uFogA * uFogA * d * d);
          return smoothstep(uFogA, uFogB, d);
        }
        void main(){
          vec2 d = vW.xz - uBox.xy;
          vec2 l = vec2(d.x * uRot.x - d.y * uRot.y, d.x * uRot.y + d.y * uRot.x);
          float r = length(l / uR) + (fbm(vec3(l * 0.9, 1.3)) - 0.5) * 2.0 * uEdge;
          float inside = smoothstep(1.0, 0.86, r);
          float dep = texture2D(uDepth, l / uBox.zw * 0.5 + 0.5).r * 1.5 - 0.25;
          float wet = smoothstep(0.0, 0.05, dep) * inside;
          if (wet < 0.003) discard;
          // Slope of the surface: a slow breeze ripple plus the rings of every hit.
          vec2 g = vec2(0.);
          float e = 0.06;
          float n0 = fbm(vec3(vW.xz * 2.2, uTime * 0.35));
          g += vec2(fbm(vec3((vW.xz + vec2(e, 0.)) * 2.2, uTime * 0.35)) - n0, fbm(vec3((vW.xz + vec2(0., e)) * 2.2, uTime * 0.35)) - n0) / e * 0.025;
          float crest = 0.0; float foam = 0.0;
          for (int i = 0; i < ${MAX_HITS}; i++) {
            vec4 h = uHits[i];
            float age = uTime - h.z;
            if (age < 0.0 || age > 3.0) continue;
            vec2 q = vW.xz - h.xy; float rr = length(q) + 1e-4;
            float k = h.w * uRing;
            for (int j = 0; j < 3; j++) {
              float a2 = age - float(j) * 0.14;
              if (a2 < 0.0) continue;
              float R = 0.15 + 1.9 * a2 * h.w / (1.0 + 0.6 * a2);
              float x = (rr - R) / (0.07 + 0.06 * a2);
              float env = exp(-x * x) * exp(-a2 * 1.6) * k * (1.0 - float(j) * 0.3);
              g += q / rr * cos(x * 3.0) * env * 0.9;
              crest += max(0.0, sin(x * 3.0 + 1.2)) * env;
            }
            float fr = 0.18 + 0.5 * age;
            foam += exp(-rr * rr / (fr * fr * h.w)) * exp(-age * 2.4) * smoothstep(0.35, 0.65, fbm(vec3(q * 6.0, age * 2.0 + h.x))) * h.w;
          }
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(vW - cameraPosition);
          vec3 R = reflect(V, N);
          float cosT = max(0.0, dot(-V, N));
          float F = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
          vec3 sky = uSky * (0.35 + 0.65 * smoothstep(-0.1, 0.6, R.y));
          vec3 body = mix(uShallow, uDeep, smoothstep(0.02, 0.45, dep));
          vec3 col = mix(body, sky, F);
          col += uMoonC * pow(max(0.0, dot(R, uMoon)), 160.0) * (0.4 + 0.6 * F);
          col += uMoonC * uCrestK * crest * (0.3 + F);
          // The moon's path on the water, broken by the breeze and the rings into glints.
          float path = pow(max(0.0, dot(R, uMoon)), uSheenP);
          float glit = smoothstep(0.66, 0.86, fbm(vec3(vW.xz * 6.0 + g * 40.0, uTime * 1.1)));
          col += uSheen * path * (0.15 + 3.0 * glit + 4.0 * crest);
          // A wet shine along the shore.
          float rim = smoothstep(0.72, 0.84, r) * smoothstep(0.98, 0.86, r) * smoothstep(0.0, 0.03, dep);
          col += uRim * rim * (0.6 + 0.8 * fbm(vec3(l * 3.0, 2.0)));
          col = mix(col, vec3(0.86, 0.84, 1.0), clamp(foam, 0.0, 1.0) * 0.85);
          float a = wet * mix(uOpacity * smoothstep(0.0, 0.25, dep) + 0.25, 1.0, F) ;
          a = clamp(max(max(a, clamp(foam, 0.0, 1.0)), rim * step(0.001, uRim.r + uRim.g + uRim.b)), 0.0, 1.0) * wet;
          float fog = fogAmount(length(vW - cameraPosition));
          gl_FragColor = vec4(mix(col, uFogColor, fog), a);
        }`,
    });
    const geo = new THREE.PlaneGeometry(2 * ex, 2 * ez, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(cx, level, cz);
    this.mesh.rotation.y = yaw;
    this.mesh.renderOrder = num(cue.order, 3);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    this.mat.uniforms.uTime.value = ctx.t;
    syncFog(this.mat.uniforms, ctx.scene);
    this.mesh.visible = ctx.t >= this.cue.t;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

class Splash implements Effect {
  private drops: Billboards;
  private sheets: Billboards;
  private mist: Billboards;
  private flare: Billboards;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = num(cue.scale, 1);
    const [dx, dz] = (cue.dir as [number, number]) ?? [0, 0];
    const shared = {
      uA: { value: new THREE.Vector3() },
      uB: { value: new THREE.Vector3() },
      uS: { value: S },
      uD: { value: num(cue.d, 0) },
      uF: { value: new THREE.Vector3(dx, 0, dz) },
      uC: { value: hdr(cue.color ?? '#e6e0ff', num(cue.gain, 1)) },
      uUp: { value: num(cue.up, 1) },
      uMistA: { value: num(cue.mistA, 0.1) },
      uDrop: { value: num(cue.drop, 1) },
      uFlare: { value: num(cue.flare, 0) },
      uSpread: { value: num(cue.spread, 1) },
    };
    const decl = 'uniform vec3 uA, uB, uF, uC; uniform float uS, uD, uUp, uMistA, uDrop, uFlare, uSpread;';
    // Born at b (0..d) where she was then; a single splash is born within its first frames.
    const born = /* glsl */ `
      float b = uD > 0.0 ? s2.x * uD : s2.x * 0.06 * uS;
      float t = tau - b;
      vec3 o = mix(uA, uB, uD > 0.0 ? b / uD : 0.0);
      vec3 side = normalize(vec3(-uF.z, 0., uF.x) + 1e-4);`;
    this.drops = new Billboards(scene, {
      count: Math.round(num(cue.count, 220)),
      seed: num(cue.seed, 31),
      sprite: 1,
      decl,
      uniforms: shared,
      additive: true,
      depthWrite: true,
      doubleSide: true,
      body: /* glsl */ `${born}
        float life = 0.35 + 0.55 * s1.w;
        if (t > 0.0 && t < life) {
          float ang = s1.x * 6.2831853;
          vec3 rad = vec3(cos(ang), 0., sin(ang));
          float up = uS * uUp * (1.8 + 3.6 * s1.y * s1.y);
          vec3 v0 = rad * uS * uSpread * (1.0 + 2.6 * s1.z) + uF * uS * (1.2 + 2.4 * s2.y) + vec3(0., up, 0.);
          float g = 9.8 * sqrt(uS);
          pos = o + rad * 0.12 * uS + v0 * t + vec3(0., -0.5 * g * t * t, 0.);
          vel = v0 + vec3(0., -g * t, 0.);
          // Mostly fine drops, a few fat ones.
          if (pos.y < o.y - 0.03) size = 0.0; else size = uS * uDrop * (0.014 + 0.06 * s2.z * s2.z * s2.z);
          stretch = 0.028;
          float f = 1. - t / life;
          col = vec4(uC * (2.2 + 2.8 * s2.w), smoothstep(0.0, 0.25, f));
        }`,
    });
    this.sheets = new Billboards(scene, {
      count: Math.round(num(cue.sheets, 70)),
      seed: num(cue.seed, 31) + 1,
      sprite: 1,
      decl,
      uniforms: shared,
      additive: true,
      depthWrite: true,
      doubleSide: true,
      body: /* glsl */ `${born}
        float life = 0.3 + 0.35 * s1.w;
        if (t > 0.0 && t < life) {
          float ang = s1.x * 6.2831853;
          vec3 rad = vec3(cos(ang), 0., sin(ang));
          float k = t / life;
          // A crown: thrown out and up, then falling back; leaning the way she runs.
          float h = uS * uUp * (0.35 + 0.75 * s1.y) * sin(3.14159 * min(1.0, k * 1.1));
          float r = 0.15 + (0.45 + 0.4 * s1.z) * (1.0 - exp(-t * 6.0));
          pos = o + rad * uS * r + uF * uS * 0.5 * t * (1.0 + s2.y) + vec3(0., h, 0.);
          // Along the sheet's own motion: out from the strike and up, then over and down.
          vel = rad * uS * 6.0 * exp(-t * 6.0) * (0.45 + 0.4 * s1.z) + vec3(0., uS * uUp * (0.35 + 0.75 * s1.y) * 3.14159 / life * cos(3.14159 * min(1.0, k * 1.1)), 0.) + uF * uS * 0.5;
          stretch = 0.09;
          size = uS * uDrop * (0.03 + 0.04 * s2.z);
          col = vec4(uC * (0.9 + 0.8 * s2.w), (1.0 - k) * smoothstep(0.0, 0.03, t) * 0.6);
        }`,
    });
    this.flare = new Billboards(scene, {
      count: num(cue.flare, 0) > 0 ? (num(cue.d, 0) > 0 ? 8 : 3) : 0,
      seed: num(cue.seed, 31) + 3,
      sprite: 2,
      decl,
      uniforms: shared,
      additive: true,
      body: /* glsl */ `${born}
        float life = 0.16 + 0.12 * s1.w;
        if (t > 0.0 && t < life) {
          float k = t / life;
          pos = o + vec3((s1.x - 0.5) * 0.5, 0.03 + 0.1 * s1.y, (s1.z - 0.5) * 0.5) * uS;
          size = uS * (0.07 + 0.12 * s2.z) * (0.6 + 0.6 * k);
          col = vec4(uC * uFlare, (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.02, t));
        }`,
    });
    this.mist = new Billboards(scene, {
      count: Math.round(num(cue.mist, 14)),
      seed: num(cue.seed, 31) + 2,
      sprite: 0,
      decl,
      uniforms: shared,
      additive: false,
      body: /* glsl */ `${born}
        float life = 0.9 + 0.8 * s1.w;
        if (t > 0.0 && t < life) {
          float k = t / life;
          float ang = s1.x * 6.2831853;
          pos = o + vec3(cos(ang), 0., sin(ang)) * uS * 0.4 * s1.z + vec3(0., uS * (0.15 + 0.5 * k * s1.y), 0.) + uF * uS * 0.3 * t;
          size = uS * (0.35 + 0.5 * k) * (0.7 + 0.6 * s2.z);
          rot = s2.w * 6.28;
          col = vec4(uC * 0.7, (1.0 - k) * smoothstep(0.0, 0.1, t) * uMistA);
        }`,
    });
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const from = this.cue.from ?? this.cue.at;
    this.a.copy(ctx.point(from));
    this.b.copy(ctx.point(this.cue.to ?? from));
    const on = tau >= 0 && tau < num(this.cue.d, 0) + 2.5;
    for (const bb of [this.drops, this.sheets, this.mist, this.flare]) {
      (bb.u.uA.value as THREE.Vector3).copy(this.a);
      (bb.u.uB.value as THREE.Vector3).copy(this.b);
      bb.set(tau, ctx, on);
    }
    if (this.cue.k !== undefined) (this.drops.u.uC.value as THREE.Color).copy(hdr(this.cue.color ?? '#e6e0ff', num(this.cue.gain, 1) * track(this.cue.k, ctx.t, 1)));
  }

  dispose(): void {
    this.drops.dispose();
    this.sheets.dispose();
    this.mist.dispose();
    this.flare.dispose();
  }
}

class Foam implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const [cx, cy] = (cue.center as [number, number]) ?? [0, 0];
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: 0 },
        uCover: { value: 1 },
        uAspect: { value: 1 },
        uCenter: { value: new THREE.Vector2(cx, cy) },
        uSpeed: { value: num(cue.speed, 1.6) },
        uScale: { value: num(cue.scale, 1) },
        uW: { value: hdr(cue.color ?? '#f6feff', num(cue.gain, 1.6)) },
        uT: { value: hdr(cue.color2 ?? '#6fd2e0', num(cue.gain2, 1)) },
        uD: { value: hdr(cue.dark ?? '#0a3440', 1) },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA, uCover, uAspect, uSpeed, uScale;
        uniform vec2 uCenter; uniform vec3 uW, uT, uD;
        varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) - uCenter;
          float r = length(p) + 1e-3;
          float ang = atan(p.y, p.x);
          // Spray streaks rushing out from the centre: noise stretched along the radius.
          float lr = log(r) * 2.4 - uTime * uSpeed;
          vec2 ca = vec2(cos(ang), sin(ang));
          float st = fbm(vec3(ca * 2.6 * uScale, lr * 0.55));
          float fine = fbm(vec3(ca * 9.0 * uScale, lr * 1.4 + 3.0));
          // Foam: churning cells drifting out with the streaks.
          vec2 q = p * 3.2 * uScale / (0.6 + 0.4 * uTime);
          float fm = fbm(vec3(q + ca * uTime * 0.8, uTime * 0.9));
          float body = fm * 0.55 + st * 0.45;
          float white = smoothstep(1.0 - uCover - 0.18, 1.0 - uCover + 0.12, body + 0.18 * smoothstep(0.55, 0.0, r));
          // Bubbles and holes in the white: small dark-teal pocks.
          float pock = smoothstep(0.66, 0.74, fbm(vec3(q * 3.5, uTime * 1.6 + 7.0)));
          vec3 base = mix(uD, uT, smoothstep(0.25, 0.75, st * 0.6 + fine * 0.6));
          vec3 col = mix(base, uW, white * (1.0 - pock * 0.7));
          col += uW * 0.35 * smoothstep(0.62, 0.8, fine) * white;
          gl_FragColor = vec4(col, uA);
        }`,
    });
    this.mesh = screenQuad(this.mat, num(cue.order, 4));
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = track(this.cue.alpha, ctx.t, 0);
    this.mesh.visible = a > 0.001;
    const u = this.mat.uniforms;
    u.uA.value = Math.min(1, a);
    u.uTime.value = ctx.t - this.cue.t;
    u.uCover.value = track(this.cue.cover, ctx.t, 1);
    u.uAspect.value = ctx.camera.aspect;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

registerEffect('night-pool', (cue, scene, ground) => new Pool(cue, scene, ground));
registerEffect('night-splash', (cue, scene) => new Splash(cue, scene));
registerEffect('night-foam', (cue, scene) => new Foam(cue, scene));
