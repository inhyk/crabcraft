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
//   night-creek { at: [x, z], yaw, from, to (its extent along the flow, local units), taper, wander: [[amp, freq,
//                 phase], ...] (the meander), half (water half width), near, far (bank run on the -v and +v
//                 side), drop (lip to water), bed (water depth), flow (units/s along +u; the sign is the
//                 direction), t0 (song second of the shot's start: flow and rings run on the song clock, so
//                 they carry over a cut), hits: [[t, u, dv, k], ...], splashes: [{ t, u, side, ...night-splash }],
//                 keep: [[x, z, r], ...] (no stones or roots), rocks, roots (per unit of length), cut (regex of
//                 the meshes opened along it), soil, moss, mud, mud2, wetMud, gravel, stone, root, deep,
//                 shallow, sky, moon: [dx, dy, dz], glint, sheen, foam, seed }
//       a creek cut into the ground: the terrain and the forest floor (night-floor) are opened along a
//       meandering channel (discarded in their own shaders, restored on dispose) with banks of layered mud,
//       a steep cut bank with hanging roots on the -v side and a shelving shingle bank on the +v side,
//       stones on the lips, at the waterline and in the stream, and dark water flowing down it whose
//       ripples catch the moon, foam wakes behind the stones and rings where things strike it
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
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

type Ground = (x: number, z: number) => number;
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const f5 = (v: number) => v.toFixed(5);

/** The creek's plan in its own frame: u along the flow, v across; the same numbers in JS and GLSL. */
class CreekShape {
  readonly ox: number;
  readonly oz: number;
  readonly c: number;
  readonly s: number;
  readonly from: number;
  readonly to: number;
  readonly taper: number;
  readonly wander: number[][];
  readonly half: number;
  readonly near: number;
  readonly far: number;
  constructor(cue: FxCue) {
    [this.ox, this.oz] = (cue.at as [number, number]) ?? [0, 0];
    const yaw = num(cue.yaw, 0);
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    this.from = num(cue.from, -10);
    this.to = num(cue.to, 10);
    this.taper = Math.max(0.1, num(cue.taper, 2));
    this.wander = (cue.wander as number[][]) ?? [];
    this.half = num(cue.half, 1);
    this.near = num(cue.near, 0.5);
    this.far = num(cue.far, 0.8);
  }
  end(u: number): number {
    return sstep(this.from, this.from + this.taper, u) * (1 - sstep(this.to - this.taper, this.to, u));
  }
  centre(u: number): number {
    let v = 0;
    for (const [a, f, p] of this.wander) v += a * Math.sin(f * u + p);
    return v;
  }
  halfAt(u: number): number {
    return this.half * (1 + 0.16 * Math.sin(0.83 * u + 0.4) + 0.09 * Math.sin(2.1 * u + 1.7)) * this.end(u);
  }
  /** The lip (where the ground breaks) on a side, from the centre line. */
  lip(u: number, side: number): number {
    const b = side < 0 ? this.near : this.far;
    return this.halfAt(u) + b * (1 + 0.3 * Math.sin(1.7 * u + 0.9 + side * 2.1) + 0.18 * Math.sin(4.3 * u + 2.2 + side * 1.3) + 0.08 * Math.sin(11.3 * u + side * 3.3)) * this.end(u);
  }
  world(u: number, dv: number): [number, number] {
    const v = this.centre(u) + dv;
    return [this.ox + u * this.c - v * this.s, this.oz + u * this.s + v * this.c];
  }
  get sig(): string {
    return [this.ox, this.oz, this.c, this.s, this.from, this.to, this.taper, this.half, this.near, this.far, ...this.wander.flat()].map(f5).join(',');
  }
  glsl(): string {
    const w = this.wander.map(([a, f, p]) => `${f5(a)} * sin(${f5(f)} * u + ${f5(p)})`).join(' + ') || '0.0';
    return /* glsl */ `
      float ckEnd(float u){ return smoothstep(${f5(this.from)}, ${f5(this.from + this.taper)}, u) * (1.0 - smoothstep(${f5(this.to - this.taper)}, ${f5(this.to)}, u)); }
      float ckCentre(float u){ return ${w}; }
      float ckHalf(float u){ return ${f5(this.half)} * (1.0 + 0.16 * sin(0.83 * u + 0.4) + 0.09 * sin(2.1 * u + 1.7)) * ckEnd(u); }
      float ckLip(float u, float side){
        float b = side < 0.0 ? ${f5(this.near)} : ${f5(this.far)};
        return ckHalf(u) + b * (1.0 + 0.3 * sin(1.7 * u + 0.9 + side * 2.1) + 0.18 * sin(4.3 * u + 2.2 + side * 1.3) + 0.08 * sin(11.3 * u + side * 3.3)) * ckEnd(u);
      }
      // > 0 inside the opening: how far in from the lip.
      float creekCut(vec2 xz){
        vec2 d = xz - vec2(${f5(this.ox)}, ${f5(this.oz)});
        float u = d.x * ${f5(this.c)} + d.y * ${f5(this.s)};
        float dv = -d.x * ${f5(this.s)} + d.y * ${f5(this.c)} - ckCentre(u);
        return ckLip(u, dv < 0.0 ? -1.0 : 1.0) - abs(dv);
      }`;
  }
}

/** A weathered stone: a lumpy sphere with a few flat fracture faces, moss on its top. */
function stoneGeometry(seed: number, stone: THREE.Color, moss: THREE.Color): THREE.BufferGeometry {
  const r = mulberry(seed);
  const base = new THREE.IcosahedronGeometry(1, 3);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geo = mergeVertices(base);
  base.dispose();
  const dir = () => new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
  const waves = Array.from({ length: 7 }, () => ({ d: dir(), f: 1.5 + r() * 4.5, p: r() * 6.28, a: 0.03 + r() * 0.09 }));
  const cuts = Array.from({ length: 4 }, () => ({ n: dir(), d: 0.62 + r() * 0.25 }));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const w of waves) k += w.a * Math.sin(v.dot(w.d) * w.f + w.p);
    v.multiplyScalar(k);
    for (const c of cuts) {
      const e = v.dot(c.n) - c.d;
      if (e > 0) v.addScaledVector(c.n, -e * 0.85);
    }
    // A flatter underside, so it sits.
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const k = Math.min(1, Math.max(0, (ny - 0.45) / 0.4)) * (0.6 + 0.4 * Math.sin(pos.getX(i) * 9 + pos.getZ(i) * 7));
    c.copy(stone).lerp(moss, Math.max(0, k)).multiplyScalar(0.8 + 0.35 * r());
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Patch {
  mat: THREE.Material;
  compile: THREE.Material['onBeforeCompile'];
  key: THREE.Material['customProgramCacheKey'];
}

class Creek implements Effect {
  private group = new THREE.Group();
  private shape: CreekShape;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private water: THREE.ShaderMaterial;
  private splashes: Splash[] = [];
  private patches: Patch[] = [];
  private scanned = false;
  private t0: number;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: Ground,
  ) {
    const k = (this.shape = new CreekShape(cue));
    const seed = num(cue.seed, 41);
    const drop = num(cue.drop, 0.35);
    const bed = num(cue.bed, 0.3);
    this.t0 = num(cue.t0, 0);
    const keep = (cue.keep as [number, number, number][]) ?? [];
    const kept = (x: number, z: number, pad = 0) => keep.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r + pad);
    const C = (v: unknown, d: string) => new THREE.Color(String(v ?? d));
    const soil = C(cue.soil, '#2a2232');
    const moss = C(cue.moss, '#2a3d3a');
    const mud = C(cue.mud, '#1d1620');
    const mud2 = C(cue.mud2, '#2c2128');
    const wetMud = C(cue.wetMud, '#09070c');
    const gravel = C(cue.gravel, '#3c3846');

    /** Water level along the creek: the ground on its centre line, `drop` down. */
    const level = (u: number) => {
      const [x, z] = k.world(u, 0);
      return ground(x, z) - drop * k.end(u);
    };
    const wobble = (u: number, t: number, side: number) => Math.sin(u * 6.3 + t * 4.1 + side) * 0.5 + Math.sin(u * 13.7 - t * 7.9) * 0.3 + Math.sin(u * 29.3 + t * 17.1 + side * 2) * 0.2;
    /** Surface height at (u, dv) and how far down the bank it is (0 at the lip, 1 at the water, 2 the bed). */
    const surface = (u: number, dv: number, g: number, wl: number): [number, number] => {
      const side = dv < 0 ? -1 : 1;
      const d = Math.abs(dv);
      const lip = k.lip(u, side);
      const hw = k.halfAt(u);
      if (d >= lip) return [g - 0.03, 0];
      if (d >= hw) {
        const t = (lip - d) / Math.max(1e-3, lip - hw);
        // The cut bank drops steeply from its lip; the shingle bank shelves into the water.
        const prof = side < 0 ? 1 - (1 - t) ** 3 : 0.55 * t + 0.45 * (1 - (1 - t) ** 2);
        return [g + (wl - 0.04 - g) * prof + 0.045 * Math.sin(Math.PI * t) * wobble(u, t, side), t];
      }
      const q = d / Math.max(1e-3, hw);
      return [wl - 0.04 - bed * (1 - q * q) + 0.02 * wobble(u, q, 3), 1 + (1 - q)];
    };

    // The banks and bed: rows along the flow, columns packed at the lip and down the bank.
    const step = 0.1;
    const rows = Math.round((k.to - k.from) / step);
    const n1 = 6;
    const n2 = 14;
    const outs = [0.12, 0.4];
    const perSide = n1 + n2 + outs.length;
    const cols = 1 + 2 * perSide;
    const pos: number[] = [];
    const colr: number[] = [];
    const wet: number[] = [];
    const rnd = mulberry(seed);
    const col = new THREE.Color();
    for (let i = 0; i <= rows; i++) {
      const u = k.from + i * step;
      const wl = level(u);
      const hw = k.halfAt(u);
      const ds = (side: number) => {
        const lip = k.lip(u, side);
        return [
          ...Array.from({ length: n1 }, (_, j) => (hw * (j + 1)) / n1),
          ...Array.from({ length: n2 }, (_, j) => hw + ((lip - hw) * (j + 1)) / n2),
          ...outs.map((o) => lip + o),
        ];
      };
      const row = [...ds(-1).reverse().map((d) => -d), 0, ...ds(1)];
      for (const dv of row) {
        const [x, z] = k.world(u, dv);
        const g = ground(x, z);
        const [y, t] = surface(u, dv, g, wl);
        pos.push(x, y, z);
        const side = dv < 0 ? -1 : 1;
        const n = rnd();
        if (t <= 0) col.copy(soil);
        else if (t <= 1) {
          // Layered earth down the cut bank (strata by depth), shingle speckle on the far bank, wet near the water.
          const strata = 0.5 + 0.5 * Math.sin((g - y) * 48 + 2 * Math.sin(u * 1.3) + Math.sin(u * 4.1) * 0.6);
          col.copy(mud).lerp(mud2, strata * 0.75);
          if (side > 0) col.lerp(gravel, Math.max(0, (t - 0.2) / 0.8) * (0.35 + 0.65 * n));
          col.lerp(soil, Math.max(0, 1 - t / 0.12));
          if (t < 0.25) col.lerp(moss, (1 - t / 0.25) * 0.5 * (0.5 + 0.5 * Math.sin(u * 3.1 + side)));
          col.lerp(wetMud, Math.max(0, (t - 0.55) / 0.45) ** 1.5 * 0.85);
          col.multiplyScalar(0.85 + 0.3 * n);
        } else col.copy(wetMud).multiplyScalar(0.7 + 0.5 * n);
        colr.push(col.r, col.g, col.b);
        wet.push(t <= 0 ? 0 : Math.min(1, Math.max(0, (t - 0.4) / 0.6)) ** 1.2);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    const bankGeo = new THREE.BufferGeometry();
    bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bankGeo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    bankGeo.setAttribute('aWet', new THREE.Float32BufferAttribute(wet, 1));
    bankGeo.setIndex(idx);
    bankGeo.computeVertexNormals();
    // Wet mud catches the moon: rougher dry earth, glossy at the waterline.
    const bankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    bankMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = aWet;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWet;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vWet);');
    };
    bankMat.customProgramCacheKey = () => 'night-creek-bank';
    const bank = new THREE.Mesh(bankGeo, bankMat);
    bank.name = 'cinema-creek-bank';
    bank.receiveShadow = true;
    this.group.add(bank);
    this.geos.push(bankGeo);
    this.mats.push(bankMat);

    // Stones: boulders sunk in the lips, wet stones at the waterline and in the stream, shingle on the far bank.
    const stoneC = C(cue.stone, '#433e4e');
    const shapes = [0, 1, 2].map((i) => stoneGeometry(seed + 11 * i, stoneC, moss));
    type Inst = { x: number; y: number; z: number; s: [number, number, number]; yaw: number; tone: number; wet: boolean };
    const stones: Inst[] = [];
    const wakes: number[][] = [];
    const per = num(cue.rocks, 1);
    /** A stone at (u, dv), sunk `sink` of its height into the bank, or with `breach` set, its top that far out of the water. */
    const place = (u: number, dv: number, size: number, sink: number, flat: number, wetStone: boolean, pad: number, breach = 0) => {
      const [x, z] = k.world(u, dv);
      if (kept(x, z, pad + size)) return false;
      const [y] = surface(u, dv, ground(x, z), level(u));
      const sy = size * flat * (0.75 + 0.4 * rnd());
      stones.push({ x, y: breach ? level(u) - sy * (1 - breach) : y - sy * sink, z, s: [size * (0.8 + 0.5 * rnd()), sy, size * (0.8 + 0.5 * rnd())], yaw: rnd() * 6.28, tone: 0.6 + 0.5 * rnd(), wet: wetStone });
      return true;
    };
    for (let u = k.from + 1.5; u < k.to - 1.5; u += (0.5 + 1.1 * rnd()) / per) {
      const side = rnd() < 0.5 ? -1 : 1;
      if (k.end(u) < 0.6) continue;
      place(u, side * (k.lip(u, side) + (rnd() - 0.45) * 0.4), 0.18 + 0.36 * rnd() ** 1.5, 0.3, 0.85, false, 0.1);
    }
    for (let u = k.from + 1; u < k.to - 1; u += (0.18 + 0.4 * rnd()) / per) {
      const side = rnd() < 0.5 ? -1 : 1;
      if (k.end(u) < 0.5) continue;
      place(u, side * k.halfAt(u) * (0.88 + 0.25 * rnd()), 0.08 + 0.18 * rnd() ** 1.4, 0.4, 0.75, true, 0.05);
    }
    for (let u = k.from + 2; u < k.to - 2; u += (1.2 + 1.8 * rnd()) / per) {
      const dv = (rnd() * 2 - 1) * k.halfAt(u) * 0.65;
      const size = 0.11 + 0.15 * rnd();
      if (place(u, dv, size, 0, 0.7, true, 0, 0.45 + 0.25 * rnd())) wakes.push([u, dv, size * 0.95]);
    }
    for (let u = k.from + 1; u < k.to - 1; u += 0.08 / per) {
      const lip = k.lip(u, 1);
      const hw = k.halfAt(u);
      if (k.end(u) < 0.5) continue;
      place(u, hw + (lip - hw) * (0.1 + 0.85 * rnd()), 0.025 + 0.045 * rnd() ** 2, 0.4, 0.55, false, 0);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const wetStones of [false, true]) {
      const list = stones.filter((s) => s.wet === wetStones);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: wetStones ? 0.32 : 0.85, metalness: 0 });
      for (let g = 0; g < shapes.length; g++) {
        const mine = list.filter((_, i) => i % shapes.length === g);
        if (!mine.length) continue;
        const mesh = new THREE.InstancedMesh(shapes[g], mat, mine.length);
        mine.forEach((s, i) => {
          e.set((rnd() - 0.5) * 0.3, s.yaw, (rnd() - 0.5) * 0.3);
          q.setFromEuler(e);
          m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(...s.s));
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(s.tone * (wetStones ? 0.6 : 0.9)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        mesh.name = 'cinema-creek-stones';
        this.group.add(mesh);
      }
      this.mats.push(mat);
    }
    this.geos.push(...shapes);

    // Roots: out of the lip, down the face of the cut bank (some trailing into the water), a few on the far side.
    const tubes: THREE.BufferGeometry[] = [];
    const rootPer = num(cue.roots, 1.6);
    for (const side of [-1, 1]) {
      for (let u = k.from + 2; u < k.to - 2; u += (side < 0 ? 0.35 + 0.5 * rnd() : 1.0 + 1.6 * rnd()) / rootPer) {
        if (k.end(u) < 0.7) continue;
        const [x0, z0] = k.world(u, side * k.lip(u, side));
        if (kept(x0, z0, 0.2)) continue;
        const hang = side < 0 && rnd() < 0.55;
        const length = hang ? 1.08 : 0.35 + 0.5 * rnd();
        const drift = (rnd() - 0.5) * 0.5;
        const stand = 0.02 + 0.05 * rnd();
        const pts: THREE.Vector3[] = [];
        const at = (t: number, lift: number) => {
          const uu = u + drift * t;
          const lip = k.lip(uu, side);
          const hw = k.halfAt(uu);
          const dv = side * (t < 0 ? lip - t * 0.3 : t <= 1 ? lip - (lip - hw) * t : hw * (1 - (t - 1) * 1.5));
          const [x, z] = k.world(uu, dv);
          const [y] = surface(uu, dv, ground(x, z), level(uu));
          return new THREE.Vector3(x, (t < 0 ? ground(x, z) - 0.08 : t > 1 ? level(uu) - 0.06 : y) + lift, z);
        };
        pts.push(at(-0.8, 0), at(0.02, 0.02));
        for (let j = 1; j <= 4; j++) {
          const t = (length * j) / 4;
          pts.push(at(t, t > 1 ? 0 : stand + 0.04 * Math.sin(Math.PI * Math.min(1, t)) + 0.02 * Math.sin(j * 2.3 + u)));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const r0 = (side < 0 ? 0.022 : 0.016) + 0.024 * rnd() ** 2;
        const segs = 28;
        const radial = 6;
        const tube = new THREE.TubeGeometry(curve, segs, r0, radial, false);
        const tp = tube.attributes.position as THREE.BufferAttribute;
        const P = new THREE.Vector3();
        const V = new THREE.Vector3();
        for (let i = 0; i <= segs; i++) {
          curve.getPointAt(i / segs, P);
          const taper = 1 - 0.75 * (i / segs) ** 1.4;
          for (let j = 0; j <= radial; j++) {
            const vi = i * (radial + 1) + j;
            V.fromBufferAttribute(tp, vi).sub(P).multiplyScalar(taper).add(P);
            tp.setXYZ(vi, V.x, V.y, V.z);
          }
        }
        tube.deleteAttribute('uv');
        tubes.push(tube);
      }
    }
    if (tubes.length) {
      const rootGeo = mergeGeometries(tubes)!;
      for (const t of tubes) t.dispose();
      rootGeo.computeVertexNormals();
      const rootMat = new THREE.MeshStandardMaterial({ color: C(cue.root, '#3a2c2a'), roughness: 0.8, metalness: 0 });
      const roots = new THREE.Mesh(rootGeo, rootMat);
      roots.name = 'cinema-creek-roots';
      this.group.add(roots);
      this.geos.push(rootGeo);
      this.mats.push(rootMat);
    }

    // The water: a sheet at the level of each cross-section, as wide as the channel, fading where it shallows.
    const wcols = 28;
    const wpos: number[] = [];
    const wloc: number[] = [];
    const wdep: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const u = k.from + i * step;
      const wl = level(u);
      const w = k.halfAt(u) + 0.3 * k.end(u);
      for (let j = 0; j < wcols; j++) {
        const dv = -w + (2 * w * j) / (wcols - 1);
        const [x, z] = k.world(u, dv);
        const [y] = surface(u, dv, ground(x, z), wl);
        wpos.push(x, wl, z);
        wloc.push(u, dv);
        wdep.push(wl - y);
      }
    }
    const widx: number[] = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < wcols - 1; j++) {
        const a = i * wcols + j;
        widx.push(a, a + 1, a + wcols, a + 1, a + wcols + 1, a + wcols);
      }
    }
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    waterGeo.setAttribute('aL', new THREE.Float32BufferAttribute(wloc, 2));
    waterGeo.setAttribute('aDepth', new THREE.Float32BufferAttribute(wdep, 1));
    waterGeo.setIndex(widx);
    const hits = ((cue.hits as number[][]) ?? []).slice(0, MAX_HITS);
    const MAX_WAKES = 12;
    wakes.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
    this.water = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFlow: { value: num(cue.flow, -0.6) },
        uRot: { value: new THREE.Vector2(k.c, k.s) },
        uHits: { value: Array.from({ length: MAX_HITS }, (_, i) => (hits[i] ? new THREE.Vector4(hits[i][1], hits[i][2], hits[i][0] + this.t0, hits[i][3] ?? 1) : new THREE.Vector4(0, 0, 1e9, 0))) },
        uWakes: { value: Array.from({ length: MAX_WAKES }, (_, i) => (wakes[i] ? new THREE.Vector4(wakes[i][0], wakes[i][1], wakes[i][2], 0) : new THREE.Vector4(0, 0, 0, 0))) },
        uDeep: { value: hdr(cue.deep ?? '#010103', 1) },
        uShallow: { value: hdr(cue.shallow ?? '#0a0812', 1) },
        uSky: { value: hdr(cue.sky ?? '#120e24', num(cue.skyK, 1)) },
        uMoon: { value: new THREE.Vector3(...((cue.moon as [number, number, number]) ?? [1, 0.22, 0.1])).normalize() },
        uMoonC: { value: hdr(cue.moonColor ?? '#e8e2ff', num(cue.glint, 5)) },
        uSheen: { value: hdr(cue.moonColor ?? '#e8e2ff', num(cue.sheen, 0.5)) },
        uFoamC: { value: hdr(cue.foam ?? '#8c86b8', 1) },
        ...fogUniforms(),
      },
      vertexShader: /* glsl */ `
        attribute vec2 aL; attribute float aDepth;
        varying vec3 vW; varying vec2 vL; varying float vDepth;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = aL; vDepth = aDepth; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFlow;
        uniform vec2 uRot;
        uniform vec4 uHits[${MAX_HITS}];
        uniform vec4 uWakes[${MAX_WAKES}];
        uniform vec3 uDeep, uShallow, uSky, uMoon, uMoonC, uSheen, uFoamC;
        uniform vec3 uFogColor; uniform float uFogMode, uFogA, uFogB;
        varying vec3 vW; varying vec2 vL; varying float vDepth;
        ${NOISE}
        float fogAmount(float d){
          if (uFogMode < 0.5) return 0.;
          if (uFogMode < 1.5) return 1. - exp(-uFogA * uFogA * d * d);
          return smoothstep(uFogA, uFogB, d);
        }
        // The running surface: long swells and fine chop carried down the flow.
        float ripple(vec2 p){
          float fl = uTime * uFlow;
          return fbm(vec3((p.x - fl) * 1.4, p.y * 2.8, uTime * 0.25)) * 0.65
               + vnoise(vec3((p.x - fl * 1.35) * 5.0, p.y * 7.0, uTime * 0.9)) * 0.35;
        }
        void main(){
          if (vDepth < -0.02) discard;
          vec2 p = vL;
          float e = 0.025;
          float h0 = ripple(p);
          vec2 g = vec2(ripple(p + vec2(e, 0.)) - h0, ripple(p + vec2(0., e)) - h0) / e * 0.07;
          float crest = 0.0; float foam = 0.0;
          for (int i = 0; i < ${MAX_HITS}; i++) {
            vec4 h = uHits[i];
            float age = uTime - h.z;
            if (age < 0.0 || age > 3.0) continue;
            // Rings drift down with the water.
            vec2 q = p - h.xy - vec2(uFlow * age, 0.0); float rr = length(q) + 1e-4;
            for (int j = 0; j < 3; j++) {
              float a2 = age - float(j) * 0.14;
              if (a2 < 0.0) continue;
              float R = 0.12 + 1.6 * a2 * h.w / (1.0 + 0.6 * a2);
              float x = (rr - R) / (0.06 + 0.05 * a2);
              float env = exp(-x * x) * exp(-a2 * 1.4) * h.w * (1.0 - float(j) * 0.3);
              g += q / rr * cos(x * 3.0) * env * 0.8;
              crest += max(0.0, sin(x * 3.0 + 1.2)) * env;
            }
            float fr = 0.15 + 0.45 * age;
            foam += exp(-rr * rr / (fr * fr * h.w)) * exp(-age * 2.6) * smoothstep(0.35, 0.65, fbm(vec3(q * 6.0, age * 2.0 + h.x))) * h.w * smoothstep(0.25, 0.5, h.w);
          }
          crest *= 0.35;
          // Stones in the stream: water piling round each, a broken V of foam trailing downstream.
          float down = sign(uFlow);
          for (int i = 0; i < ${MAX_WAKES}; i++) {
            vec4 s = uWakes[i];
            if (s.z <= 0.0) continue;
            vec2 q = p - s.xy; float a = q.x * down; float dd = length(q);
            // The pile-up hugs the upstream face and thins round the flanks.
            float ring = exp(-pow((dd - s.z * 1.05) / (0.03 + 0.15 * s.z), 2.0)) * smoothstep(0.5, -0.7, a / (dd + 1e-3));
            float w = a > 0.0 ? exp(-pow((abs(q.y) - s.z * 0.6 - 0.28 * a) / (0.035 + 0.07 * a), 2.0)) * exp(-a * 1.3) : 0.0;
            float streak = smoothstep(0.4, 0.72, fbm(vec3(a * 5.0 - uTime * abs(uFlow) * 5.0, q.y * 12.0, uTime * 0.7 + float(i) * 3.1)));
            foam += ring * 0.45 * (0.3 + streak) + w * streak * 0.8;
            crest += ring * 0.6 + w * 0.6;
            g += q / (dd + 1e-3) * ring * 0.12;
          }
          // Lace along the shores.
          foam += smoothstep(0.08, 0.0, vDepth) * smoothstep(0.48, 0.74, fbm(vec3((p.x - uTime * uFlow) * 3.2, p.y * 9.0, uTime * 0.4))) * 0.5;
          vec2 gw = g.x * uRot + g.y * vec2(-uRot.y, uRot.x);
          vec3 N = normalize(vec3(-gw.x, 1.0, -gw.y));
          vec3 V = normalize(vW - cameraPosition);
          vec3 R = reflect(V, N);
          float cosT = max(0.0, dot(-V, N));
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 body = mix(uShallow, uDeep, smoothstep(0.03, 0.3, vDepth));
          // Long streaks of the canopy's sky slide down the flow on the dark water.
          float streaks = smoothstep(0.42, 0.7, fbm(vec3((p.x - uTime * uFlow * 1.2) * 0.9, p.y * 6.0, uTime * 0.15)));
          vec3 sky = uSky * (0.3 + 0.7 * smoothstep(-0.1, 0.6, R.y)) * (0.7 + 1.1 * streaks);
          vec3 col = mix(body, sky, F);
          float mo = max(0.0, dot(R, uMoon));
          // The moon broken into glints by the ripples, a faint path under them.
          col += uMoonC * pow(mo, 400.0) * (0.4 + 0.6 * F);
          float glit = smoothstep(0.64, 0.86, fbm(vec3(vW.xz * 7.0 + gw * 30.0, uTime * 1.3)));
          col += uSheen * pow(mo, 34.0) * (0.02 + 1.4 * glit + 2.0 * crest);
          float fo = clamp(foam, 0.0, 1.0);
          col = mix(col, uFoamC, fo * 0.75);
          float a = smoothstep(0.0, 0.05, vDepth) * mix(0.9, 1.0, F);
          a = max(a, fo * smoothstep(-0.02, 0.02, vDepth));
          gl_FragColor = vec4(mix(col, uFogColor, fogAmount(length(vW - cameraPosition))), a);
        }`,
    });
    const water = new THREE.Mesh(waterGeo, this.water);
    water.renderOrder = num(cue.order, 3);
    water.frustumCulled = false;
    water.name = 'cinema-creek-water';
    this.group.add(water);
    this.geos.push(waterGeo);
    for (const s of (cue.splashes as FxCue[]) ?? []) {
      const u = num(s.u, 0);
      const side = num(s.side, 1);
      const [x, z] = k.world(u, side * k.halfAt(u) * num(s.inset, 0.9));
      this.splashes.push(new Splash({ ...s, at: [x, level(u) + 0.02, z] }, scene));
    }
    scene.add(this.group);
  }

  /** Open the terrain and the forest floor along the channel (their own shaders discard inside it). */
  private carve(scene: THREE.Scene): void {
    const re = new RegExp(String(this.cue.cut ?? '^(terrain|cinema-forest-floor|cinema-forest-blades)$'));
    const glsl = this.shape.glsl();
    const sig = this.shape.sig;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !re.test(mesh.name)) return;
      // Instanced blades go whole: kept or dropped by their root, a little clear of the lip.
      const margin = (mesh as THREE.InstancedMesh).isInstancedMesh ? -0.04 : 0;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (this.patches.some((p) => p.mat === mat)) continue;
        const compile = mat.onBeforeCompile;
        const key = mat.customProgramCacheKey;
        mat.onBeforeCompile = (sh, r) => {
          compile.call(mat, sh, r);
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vCkXZ;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              #ifdef USE_INSTANCING
                vCkXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
              #else
                vCkXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
              #endif`);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec2 vCkXZ;\n${glsl}`)
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (creekCut(vCkXZ) > ${f5(margin)}) discard;`);
        };
        mat.customProgramCacheKey = () => `${key.call(mat)}|creek:${sig}`;
        mat.needsUpdate = true;
        this.patches.push({ mat, compile, key });
      }
    });
  }

  update(ctx: FxContext): void {
    if (!this.scanned) {
      this.scanned = true;
      this.carve(ctx.scene);
    }
    this.water.uniforms.uTime.value = ctx.t + this.t0;
    syncFog(this.water.uniforms, ctx.scene);
    for (const s of this.splashes) s.update(ctx);
  }

  dispose(): void {
    for (const p of this.patches) {
      p.mat.onBeforeCompile = p.compile;
      p.mat.customProgramCacheKey = p.key;
      p.mat.needsUpdate = true;
    }
    this.patches = [];
    for (const s of this.splashes) s.dispose();
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.water.dispose();
  }
}

registerEffect('night-pool', (cue, scene, ground) => new Pool(cue, scene, ground));
registerEffect('night-creek', (cue, scene, ground) => new Creek(cue, scene, ground));
registerEffect('night-splash', (cue, scene) => new Splash(cue, scene));
registerEffect('night-foam', (cue, scene) => new Foam(cue, scene));
