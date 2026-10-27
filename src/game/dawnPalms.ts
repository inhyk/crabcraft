import * as THREE from 'three';
import {FROST_NOISE} from './frostPaving';
import {Acc, CR} from './dawnAdobe';
import {rng} from '../world/noise';

/*
 * Goldsand Harbor's date palms: a leaning, slightly curved trunk ringed with old leaf bases (dawnCraft bark), a crown
 * of long pinnate fronds that arch up and droop at the tips, a skirt of dry fronds hanging under the crown and
 * clusters of dates. A frond is two folded ribbons either side of the midrib; the leaflets are cut out of the ribbon
 * in the shader (slanted toward the tip, ragged ends), its shadow cut the same way. Fronds sway from the crown out.
 */

const FROND_HEAD = `${FROST_NOISE}
attribute vec2 aFrUv;
attribute vec2 aFr;
uniform float frTime;
varying vec2 vFrUv;
varying float vFrSeed;
`;
const FROND_SWAY = /* glsl */ `{
  float w=aFr.x,ph=aFr.y*6.28;
  transformed+=vec3(.7,.0,.5)*w*(.16*sin(frTime*1.2+ph)+.05*sin(frTime*2.9+ph*1.7))+vec3(0.,1.,0.)*w*.05*sin(frTime*1.7+ph);
  vFrUv=aFrUv;vFrSeed=aFr.y;
}`;
// Leaflets: about 34 a side, slanted toward the tip, shorter near the base and the tip, ragged ends; midrib kept.
const FROND_CUT = /* glsl */ `
  float frA=vFrUv.x,frX=abs(vFrUv.y);
  float frN=frA*34.+frX*2.2;float frId=floor(frN),frF=fract(frN);
  float frLen=(.55+.45*sin(3.1416*pow(frA,.8)))*(.82+.18*fpHash12(vec2(frId,vFrSeed*7.)));
  bool frKeep=frX<.07||(frF<.58&&frX<frLen);
  if(!frKeep)discard;
`;

export function dawnFrondMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-palm-fronds', color: '#ffffff', roughness: .72, vertexColors: true, side: THREE.DoubleSide});
  const u = {frTime: {value: 0}};
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${FROND_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${FROND_SWAY}`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying vec2 vFrUv;\nvarying float vFrSeed;\n`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FROND_CUT}
        {vec3 c=diffuseColor.rgb;
         // Lighter midrib, yellowing tips, a darker, waxy upper side and a paler underside.
         c=mix(c,vec3(.62,.6,.36),(1.-smoothstep(.03,.07,frX))*.6);
         c=mix(c,vec3(.6,.52,.26),smoothstep(.72,1.,frA)*.45);
         c*=.82+.3*frF*(1.-frF)*4.*.5+.12*fpNoise(vec2(frId,vFrSeed*3.));
         if(!gl_FrontFacing)c=c*1.08+vec3(.03,.035,.0);
         diffuseColor.rgb=c;}`);
  };
  m.customProgramCacheKey = () => 'goldsand-palm-fronds';
  m.userData.time = u.frTime;
  return m;
}

/** Shadow caster for the fronds: the same sway and leaflet cut. */
export function dawnFrondDepth(time: {value: number}): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide});
  m.onBeforeCompile = (s) => {
    s.uniforms.frTime = time;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${FROND_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${FROND_SWAY}`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying vec2 vFrUv;\nvarying float vFrSeed;\n`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FROND_CUT}`);
  };
  m.customProgramCacheKey = () => 'goldsand-palm-fronds-depth';
  return m;
}

const V = THREE.Vector3;

/** Frond builder: two folded half-ribbons along a drooping midrib. */
class Fronds {
  P: number[] = []; N: number[] = []; C: number[] = []; T: number[] = []; F: number[] = [];
  add(base: THREE.Vector3, dir: THREE.Vector3, len: number, droop: number, width: number, col: THREE.Color, seed: number, swayAt: number) {
    const S = 12, side = new V().crossVectors(dir, new V(0, 1, 0)).normalize();
    if (side.lengthSq() < .5) side.set(1, 0, 0);
    const spine: THREE.Vector3[] = [], tang: THREE.Vector3[] = [];
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      spine.push(base.clone().addScaledVector(dir, len * t).add(new V(0, -droop * len * t * t, 0)));
    }
    for (let i = 0; i <= S; i++) tang.push(spine[Math.min(S, i + 1)].clone().sub(spine[Math.max(0, i - 1)]).normalize());
    const sw = (t: number) => swayAt + t * t;
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < S; i++) {
        const quad: [THREE.Vector3, number, number][] = [];
        for (const [j, e] of [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]] as const) {
          const t = j / S, w = width * (.25 + .75 * Math.sin(Math.PI * Math.min(1, t * 1.15 + .05))) * (1 - .55 * t);
          // Leaflets fold up in a V and hang a little at the edge.
          const out = new V().crossVectors(tang[j], new V(0, 1, 0)).normalize();
          if (out.lengthSq() < .5) out.copy(side);
          const p = spine[j].clone().addScaledVector(out, sgn * w * e).add(new V(0, w * e * (.32 - .55 * t), 0));
          quad.push([p, t, sgn * e]);
        }
        const [a, b, c, d] = quad;
        const n = new V().subVectors(b[0], a[0]).cross(new V().subVectors(d[0], a[0])).normalize();
        if (n.y < 0) n.negate();
        for (const [p, t, e] of [a, b, c, a, c, d]) {
          this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.C.push(col.r, col.g, col.b); this.T.push(t, e); this.F.push(sw(t), seed);
        }
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aFrUv', new THREE.Float32BufferAttribute(this.T, 2));
    g.setAttribute('aFr', new THREE.Float32BufferAttribute(this.F, 2));
    g.computeBoundingSphere();
    return g;
  }
}

export interface DawnPalmSet { mesh: THREE.Mesh; update(time: number): void; count: number }

/**
 * Palms at [x, z, height, lean]: trunks into `craft` (bark), fronds and dates returned as their own mesh. `y` is the
 * ground at (x, z).
 */
export function dawnPalmGrove(craft: Acc, spots: readonly (readonly [number, number, number, number])[], y: (x: number, z: number) => number, seed = 77): DawnPalmSet {
  const R = rng(seed), fr = new Fronds();
  const greens = ['#4f7a3a', '#557f3c', '#48733a', '#5d8442'].map(c => new THREE.Color(c));
  const dry = [new THREE.Color('#8a6a3c'), new THREE.Color('#7a5c36'), new THREE.Color('#9b7a48')];
  for (const [x, z, H, lean] of spots) {
    const gy = y(x, z), a = R() * Math.PI * 2, s = R() * 100;
    // Trunk: leans one way, bows back a little near the top; thicker at the foot.
    const pts: THREE.Vector3[] = [], n = Math.ceil(H / .5);
    for (let i = 0; i <= n; i++) {
      const t = i / n, bend = lean * H * (t * .9 - .35 * t * t);
      pts.push(new V(x + Math.cos(a) * bend, gy - .25 + H * t, z + Math.sin(a) * bend));
    }
    const prevA3 = craft.a3, prevCol = craft.col.clone();
    craft.a3 = [CR.bark, 0, s]; craft.col.set('#6b4a2e');
    const radial = 9, rad = (t: number) => (.26 - .1 * t + .12 * Math.max(0, .12 - t) / .12);
    for (let i = 0; i < pts.length - 1; i++) {
      const sub = 3;
      for (let k = 0; k < sub; k++) {
        const t0 = (i + k / sub) / n, t1 = (i + (k + 1) / sub) / n;
        const p0 = pts[i].clone().lerp(pts[i + 1], k / sub), p1 = pts[i].clone().lerp(pts[i + 1], (k + 1) / sub);
        // Ring bumps of old leaf bases.
        const r0 = rad(t0) * (1 + .07 * Math.max(0, Math.sin(t0 * H / .17 * Math.PI * 2))), r1 = rad(t1) * (1 + .07 * Math.max(0, Math.sin(t1 * H / .17 * Math.PI * 2)));
        for (let j = 0; j < radial; j++) {
          const u0 = j / radial * Math.PI * 2, u1 = (j + 1) / radial * Math.PI * 2;
          const q = (p: THREE.Vector3, r: number, u: number) => new V(p.x + Math.cos(u) * r, p.y, p.z + Math.sin(u) * r);
          const nn = (u: number) => new V(Math.cos(u), 0, Math.sin(u));
          const A = q(p0, r0, u0), B = q(p0, r0, u1), C = q(p1, r1, u1), D = q(p1, r1, u0);
          const uv = [j / radial * 1.4, t0 * H, (j + 1) / radial * 1.4, t0 * H, (j + 1) / radial * 1.4, t1 * H, j / radial * 1.4, t1 * H];
          craft.vert(A, nn(u0), uv[0], uv[1]); craft.vert(C, nn(u1), uv[4], uv[5]); craft.vert(B, nn(u1), uv[2], uv[3]);
          craft.vert(A, nn(u0), uv[0], uv[1]); craft.vert(D, nn(u0), uv[6], uv[7]); craft.vert(C, nn(u1), uv[4], uv[5]);
        }
      }
    }
    // A boss of leaf bases at the crown.
    const top = pts[pts.length - 1];
    craft.a3 = [CR.bark, 0, s + 3]; craft.col.set('#5c4a2c');
    const boss = new THREE.SphereGeometry(.3, 9, 6);
    craft.geo(boss, new THREE.Matrix4().compose(top.clone().add(new V(0, -.05, 0)), new THREE.Quaternion(), new V(1, 1.3, 1)), 1.4);
    boss.dispose();
    // Dates: a few hanging clusters of small fruit under the crown.
    craft.a3 = [CR.spice, 0, s]; craft.col.set('#b8641c');
    const fruit = new THREE.IcosahedronGeometry(.045, 0);
    for (let c = 0; c < 3; c++) {
      const ca = a + c * 2.1 + R(), cx = top.x + Math.cos(ca) * .3, cz = top.z + Math.sin(ca) * .3;
      for (let k = 0; k < 22; k++) {
        const t = R(), rr = .05 + .12 * t, fa = R() * 6.28;
        craft.geo(fruit, new THREE.Matrix4().makeTranslation(cx + Math.cos(fa) * rr, top.y - .25 - t * .55, cz + Math.sin(fa) * rr));
      }
    }
    fruit.dispose();
    craft.a3 = prevA3; craft.col.copy(prevCol);
    // Crown: live fronds in two whorls, a skirt of dry ones hanging under.
    const live = 15 + Math.floor(R() * 4);
    for (let i = 0; i < live; i++) {
      const az = i * 2.39996 + R() * .3, up = .9 - (i / live) * 1.25 + (R() - .5) * .2;
      const dir = new V(Math.cos(az) * Math.cos(up), Math.sin(up), Math.sin(az) * Math.cos(up)).normalize();
      const len = (2.6 + R() * .8) * Math.min(1.15, .55 + H / 16);
      fr.add(top.clone().add(new V(0, .1, 0)), dir, len, .45 + (i / live) * .5, .52, greens[Math.floor(R() * greens.length)].clone().multiplyScalar(.9 + R() * .2), s + i * .37, .25);
    }
    for (let i = 0; i < 6; i++) {
      const az = R() * 6.28, dir = new V(Math.cos(az) * .35, -1, Math.sin(az) * .35).normalize();
      fr.add(top.clone().add(new V(0, -.15, 0)), dir, 1.6 + R() * .6, .05, .34, dry[i % dry.length], s + 9 + i, .05);
    }
  }
  const mat = dawnFrondMaterial();
  const mesh = new THREE.Mesh(fr.build(), mat);
  mesh.name = 'goldsand-palm-fronds'; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = dawnFrondDepth(mat.userData.time);
  return {mesh, count: spots.length, update(time) { mat.userData.time.value = time; }};
}
