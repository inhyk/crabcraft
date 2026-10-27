import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {rng} from '../world/noise';
import {addPatch} from '../world/materials';
import {FROST_NOISE} from './frostPaving';
import {DAWN_WIND, dawnRockTall, rockSand} from '../sim/world/dawnGround';
import {dawnGlows} from './dawnMaterials';
import {DAWN_SAND} from './dawnPaving';
import {dawnRocks} from './world3Colliders';

/*
 * The rock groups ringing the citadel, World III's sculpted boulders. Each collider site (dawnRocks(), radius r + 1)
 * holds a main stone and two or three companions, built bed by bed (strataGeometry: mesas, hoodoos, fallen slabs,
 * long along the wind) and painted here: warm sandstone, every bed its own tone, laminae and partings on the
 * faces, desert varnish down the steep ones, blown sand banked at the foot and lodged on the ledges. All of it is
 * one mesh and one draw (the vent glows of the volcanic island stay empty in the desert).
 */

/** Sites whose z lies south of this are sandstone; the rest basalt. */
const SANDSTONE_Z = -32;

export interface DawnBoulderSite {i: number; x: number; z: number; r: number; basalt: boolean; vent: boolean}
export function dawnBoulderSites(): DawnBoulderSite[] {
  return dawnRocks().map(({i, x, z, r}) => {
    // Goldsand (style sheet): every group is sandstone; no dark rock, no lava.
    void SANDSTONE_Z;
    return {i, x, z, r, basalt: false, vent: false};
  });
}

const HEAD = /* glsl */ `
uniform float dbTime;
uniform vec3 dbSand;
varying vec3 vDbW;
varying vec3 vDbN;
varying vec3 vDbK;
${FROST_NOISE}
float dbN3(vec3 p,vec3 w){return fpNoise(p.zy)*w.x+fpNoise(p.xz+3.1)*w.y+fpNoise(p.xy-7.7)*w.z;}
`;

function boulderMaterial(uniforms: {dbTime: {value: number}; dbSand: {value: THREE.Color}}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnreach-boulders', color: '#ffffff', roughness: .9, vertexColors: true});
  addPatch(m, 'dawn-boulders', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aKind;\nvarying vec3 vDbW;\nvarying vec3 vDbN;\nvarying vec3 vDbK;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDbW=(modelMatrix*vec4(transformed,1.)).xyz;vDbN=normalize(mat3(modelMatrix)*objectNormal);vDbK=aKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // Goldsand's stones are all sandstone (no basalt, no lava since the desert round), so only sandstone is
        // shaded. aKind.z: height above the ground at this vertex.
        vec3 bN=normalize(vDbN),bA=abs(bN)/(abs(bN.x)+abs(bN.y)+abs(bN.z));
        float occ=vColor.r,bed=vColor.g,above=vDbK.z;
        float n1=dbN3(vDbW*.55,bA),n2=dbN3(vDbW*2.4,bA),n3=fpNoise(vDbW.xz*9.+vDbW.y*7.);
        // The beds are geometry (strataGeometry): each carries its tone in vertex colour g (honey, cream, ochre-red,
        // an iron band now and then); inside it laminae of a hand's thickness, a recessed parting now and then,
        // cross-bedding slanting through the thick ones; none of it on the level caps and ledges.
        float by=vDbW.y+n1*.05,bi=floor(by/.13),bh=fpHash12(vec2(bi,7.1)),bf=fract(by/.13);
        vec3 bedC=bed<.3?vec3(.7,.45,.24):bed<.55?vec3(.77,.58,.36):bed<.82?vec3(.68,.41,.23):vec3(.52,.3,.15);
        bedC*=.93+.1*bh;
        float side=1.-smoothstep(.55,.85,abs(bN.y));
        float lamX=mix(.5,sin((vDbW.y-dot(vDbW.xz,vec2(.55,.3))*(bh-.5))*38.+n2*1.2)*.5+.5,side);
        vec3 ss=bedC*(.9+.12*lamX*step(.45,bh));
        float part=(1.-smoothstep(.0,.08,min(bf,1.-bf)))*step(.72,bh);
        ss*=1.-part*.25*side;
        ss=mix(ss,vec3(.55,.3,.2),smoothstep(.62,.9,n1*.5+.5)*.3);
        // Desert varnish streaking down the steep faces.
        ss=mix(ss,ss*vec3(.72,.62,.55),(1.-bN.y*bN.y)*smoothstep(.2,.7,fpNoise(vec2(vDbW.x+vDbW.z,vDbW.y*.15)*2.))*.5);
        vec3 bC=ss*mix(1.,occ*occ,.8)*(.92+.12*n3);
        // Blown sand banked against the foot (highest on the lee) and lodged on the ledges.
        float wind=max(0.,dot(bN.xz,normalize(vec2(.9,.35))));
        float skirt=1.-smoothstep(.03,.38+.25*(n2*.5+.5)+.8*wind,above);
        float ledge=smoothstep(.84,.96,bN.y+n2*.08)*smoothstep(.6,.85,n1*.5+.5);
        float sand=max(skirt,ledge*.8);
        bC=mix(bC,dbSand*(.85+.2*n3),sand);
        diffuseColor.rgb=bC;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.9,.97,sand);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float fade=(1.-smoothstep(14.,45.,length(vViewPosition)))*(1.-sand*.7);
          if(fade>.01){
            vec3 q=vDbW;float e=.03;
            // Grain and the laminae's relief: one noise that varies on every face (no plaid on the level ones).
            #define DB_H(Q) (fpNoise((Q).xz*3.+(Q).y)*.35+fpNoise((Q).xz*11.+(Q).y*9.)*.3+side*sin((Q).y*23.+fpNoise((Q).xz*2.4)*3.)*.12)
            float h0=DB_H(q);
            vec3 g=vec3(DB_H(q+vec3(e,0.,0.))-h0,DB_H(q+vec3(0.,e,0.))-h0,DB_H(q+vec3(0.,0.,e))-h0)/e;
            vec3 nw=inverseTransformDirection(normal,viewMatrix);
            nw=normalize(nw-(g-dot(g,nw)*nw)*.06*fade);
            normal=normalize((viewMatrix*vec4(nw,0.)).xyz);
          }
        }`);
  });
  m.customProgramCacheKey = () => 'dawn-boulders';
  return m;
}

/** One stone's form: a flat-topped mesa block, a hoodoo (narrow neck under a wide caprock) or a fallen slab. */
export interface StrataStone {r: number; h: number; kind: 'mesa' | 'hoodoo' | 'slab'; elong: number; seed: number}

/** A smooth periodic noise round the outline: a few sines with random phases, about -1..1. */
function ringNoise(R: () => number, terms: number) {
  const f: [number, number, number][] = [];
  for (let k = 0; k < terms; k++) f.push([2 + k * 2 + Math.floor(R() * 2), R() * Math.PI * 2, 1 / (1 + k * .8)]);
  const norm = f.reduce((a, [, , w]) => a + w, 0);
  return (t: number) => f.reduce((a, [n, ph, w]) => a + Math.sin(t * n + ph) * w, 0) / norm;
}

/**
 * Wind-carved sandstone, one mass (stone-local, y up, x along the wind). The surface is one sheet of rings from the
 * buried foot to the top, so joints, the outline and the grain run through every bed; the beds are carved into it,
 * not stacked: each is of its own thickness (0.5 to 1.6 times the mean), sand-blasted back toward its base (5 to
 * 25 % on a mesa, a few % up a hoodoo's column) under a lip that rounds over into the shelf of the bed above, its rim
 * wandering in height and broken back in chips where it crumbled. A mesa stands near-vertical with a slight batter,
 * its top domed a little and its rim rounded; a hoodoo is one column tapering downward under a caprock barely wider
 * than its top. The outline is a yardang's: long along the wind, the windward nose blunt and the lee tail tapered.
 * Vertex colour: r the skylight a face sees (dark in the undercuts), g the bed's tone.
 */
export function strataGeometry(k: StrataStone): THREE.BufferGeometry {
  const R = rng(k.seed * 7919 + 13), slab = k.kind === 'slab', hoodoo = k.kind === 'hoodoo', M = slab ? 18 : 34;
  const outline = ringNoise(R, 4);
  const bury = k.h * (slab ? .35 : .3), top = k.h, H = top + bury;
  // Joints: two or three vertical cracks through the whole mass, the stone splitting along them.
  const joints = slab ? [] : Array.from({length: 2 + Math.floor(R() * 2)}, () => [R() * Math.PI * 2, .05 + R() * .05, .06 + R() * .07]);
  // Grain of the whole mass: a few sines in angle and height, the same through every bed.
  const grain = Array.from({length: 3}, (_, j) => [5 + j * 6 + Math.floor(R() * 3), (2.4 + R() * 2) * (j + 1) / k.r, R() * 6.3, .022 / (j + 1)]);
  type Bed = {y0: number; y1: number; u: number; lip: number; tone: number; own: (t: number) => number; rim: (t: number) => number; chips: number[][]};
  const nb = slab ? 2 : hoodoo ? 5 + Math.floor(R() * 2) : 4 + Math.floor(R() * 3);
  const w = Array.from({length: nb}, () => .5 + R() * 1.1);
  if (hoodoo) w[nb - 1] = Math.max(w[nb - 1], 1.1);
  const sum = w.reduce((a, b) => a + b, 0);
  const beds: Bed[] = [];
  let y = -bury;
  for (let b = 0; b < nb; b++) {
    const th = H * w[b] / sum, cap = b === nb - 1;
    const u = slab ? .04 + R() * .06 : hoodoo ? (cap ? .14 + R() * .08 : .03 + R() * .05) : (cap ? .1 + R() * .1 : .05 + R() * .2);
    const chips = Array.from({length: 2 + Math.floor(R() * 3)}, () => [R() * Math.PI * 2, .12 + R() * .2, .04 + R() * .07]);
    beds.push({y0: y, y1: y + th, u, lip: .7 + R() * .14, tone: R(), own: ringNoise(R, 3), rim: ringNoise(R, 3), chips});
    y += th;
  }
  /** The body's width up the stone, t 0 (buried foot) to 1 (top). */
  const body = (t: number, cap: boolean) => slab ? 1 - .05 * t : hoodoo ? (cap ? 1 : .5 + .38 * THREE.MathUtils.smoothstep(t, .05, .8)) : (1.04 - .12 * t) * (1 + .06 * (1 - THREE.MathUtils.smoothstep(t, 0, .25)));
  /** Outline factor round the stone for bed `bed` at angle th; `lipW` weights the crumbled chips (on the lip only). */
  const round = (bed: Bed, th: number, yy: number, lipW: number) => {
    let r = 1 + .16 * outline(th) + .05 * bed.own(th);
    for (const [ja, jw, jd] of joints) { const d = Math.atan2(Math.sin(th - ja), Math.cos(th - ja)); r *= 1 - jd * Math.exp(-((d / jw) ** 2)); }
    for (const [ca, cw, cd] of bed.chips) { const d = Math.atan2(Math.sin(th - ca), Math.cos(th - ca)); r *= 1 - cd * lipW * Math.exp(-((d / cw) ** 4)); }
    for (const [n, f, ph, a] of grain) r *= 1 + a * Math.sin(th * n + yy * f + ph);
    return r;
  };
  /** Radius factor in bed b at s (0 its base, `lip` its widest), with the bed's undercut. */
  const wall = (b: number, s: number) => {
    const bed = beds[b], t = (bed.y0 + s * (bed.y1 - bed.y0) + bury) / H;
    return body(t, b === nb - 1) * (1 - bed.u * Math.pow(1 - THREE.MathUtils.smoothstep(s, 0, bed.lip), 1.4));
  };
  const pos: number[] = [], col: number[] = [], idx: number[] = [], rings: number[] = [];
  const occAt = (yy: number) => .5 + .5 * THREE.MathUtils.smoothstep((yy + bury) / H, .1, .9);
  /** One ring of M vertices: radius factor rad(th), height yy(th), skylight occ. */
  const ring = (rad: (th: number) => number, yy: (th: number) => number, occ: number, tone: number) => {
    rings.push(pos.length / 3);
    for (let i = 0; i < M; i++) {
      const th = i / M * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), rr = rad(th) * k.r;
      pos.push(c * rr * k.elong * (c > 0 ? 1.12 : .9), yy(th), sn * rr * (1 - .28 * Math.max(0, c))); col.push(occ, tone, 0);
    }
  };
  for (let b = 0; b < nb; b++) {
    const bed = beds[b], th = bed.y1 - bed.y0, next = beds[b + 1];
    // The rim wanders in height (up to a fifth of the bed), most at the lip, none at the bed's foot.
    const yAt = (s: number) => (t: number) => bed.y0 + s * th + bed.rim(t) * th * .1 * Math.sin(Math.PI * THREE.MathUtils.clamp((s - bed.lip * .4) / (1 - bed.lip * .4), 0, 1));
    const dark = (s: number) => 1 - .5 * Math.min(1, bed.u / .2) * Math.pow(1 - THREE.MathUtils.smoothstep(s, 0, bed.lip), 1.4);
    for (const s of [0, bed.lip * .3, bed.lip * .65, bed.lip]) {
      const yy = yAt(s);
      ring((t) => round(bed, t, yy(t), s / bed.lip) * wall(b, s), yy, occAt(bed.y0 + s * th) * dark(s), bed.tone);
    }
    const lipY = yAt(bed.lip), lipR = (t: number) => round(bed, t, lipY(t), 1) * wall(b, bed.lip);
    if (next) {
      // The lip rounds over (a quarter ellipse) onto the shelf at the foot of the bed above.
      const nextR = (t: number) => round(next, t, bed.y1, 0) * wall(b + 1, 0);
      for (const q of [.4, .75]) {
        const cq = Math.cos(q * Math.PI / 2), sq = Math.sin(q * Math.PI / 2), yy = (t: number) => lipY(t) + (bed.y1 - lipY(t)) * sq;
        ring((t) => nextR(t) + (lipR(t) - nextR(t)) * cq, yy, occAt(bed.y1) * (.9 + .1 * cq), bed.tone);
      }
    } else {
      // The top: the rim rounds over into a low dome, a little uneven.
      const rr = slab ? .1 : hoodoo ? .14 : .1, dome = (hoodoo ? .07 : .04) * k.r;
      for (const q of [.35, .7, 1]) {
        const cq = Math.cos(q * Math.PI / 2), sq = Math.sin(q * Math.PI / 2);
        ring((t) => lipR(t) * (1 - rr * (1 - cq)), (t) => lipY(t) + (top - lipY(t)) * sq, 1, bed.tone);
      }
      for (const f of [.75, .45, .2]) ring((t) => lipR(t) * (1 - rr) * f, (t) => top + dome * (1 - f * f) + bed.rim(t) * .02 * k.r * f, 1, bed.tone);
      pos.push(0, top + dome, 0); col.push(1, bed.tone, 0);
    }
  }
  for (let r = 1; r < rings.length; r++) for (let i = 0; i < M; i++) {
    const a = rings[r - 1] + i, b = rings[r - 1] + (i + 1) % M, c = rings[r] + i, d = rings[r] + (i + 1) % M;
    idx.push(a, c, b, b, c, d);
  }
  const last = rings[rings.length - 1], cv = pos.length / 3 - 1;
  for (let i = 0; i < M; i++) idx.push(last + i, cv, last + (i + 1) % M);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface DawnBoulders {group: THREE.Group; update(time: number): void}

/** Every rock group as one merged mesh, placed on the gameplay surface. */
export function dawnBoulders(height: (x: number, z: number) => number, sand = DAWN_SAND.clone()): DawnBoulders {
  const group = new THREE.Group(); group.name = 'dawnreach-boulders';
  const geos: THREE.BufferGeometry[] = [], vents: {pos: THREE.Vector3; size: number}[] = [];
  let count = 0;
  // Every stone's long axis lies along the wind, give or take; local +x is downwind.
  const windYaw = -Math.atan2(DAWN_WIND[1], DAWN_WIND[0]);
  const reach = (g: THREE.BufferGeometry) => { const p = g.getAttribute('position'); let m = 0; for (let v = 0; v < p.count; v++) m = Math.max(m, Math.hypot(p.getX(v), p.getZ(v))); return m; };
  const bare = (x: number, z: number) => height(x, z) - rockSand(x, z);
  const fit = (g: THREE.BufferGeometry, max: number) => { const m = reach(g); if (m > max) g.scale(max / m, 1, max / m); return Math.min(m, max); };
  for (const site of dawnBoulderSites()) {
    const R = rng(site.i * 977 + 31);
    // The main stone fills most of the collider (radius r + 1): a mesa block, or on every other big site a hoodoo.
    const tall = dawnRockTall(site.i, site.r);
    const main: StrataStone = {r: site.r * .62, h: tall ? site.r * 1.85 : site.r * (.95 + R() * .3), kind: tall ? 'hoodoo' : 'mesa', elong: 1.1 + R() * .25, seed: site.i * 31 + 3};
    const parts: {g: THREE.BufferGeometry; dx: number; dz: number; yaw: number; tilt: number}[] = [];
    const mg = strataGeometry(main); fit(mg, site.r + .55);
    parts.push({g: mg, dx: 0, dz: 0, yaw: windYaw + (R() - .5) * .5, tilt: 0});
    // Companions: blocks fallen off the caprock lying tilted half in the sand, and a low stack or two.
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const slab = k === 0 || R() < .4, rr = site.r * (slab ? .3 + R() * .15 : .22 + R() * .14);
      const g = strataGeometry({r: rr, h: slab ? rr * (.5 + R() * .25) : rr * (.9 + R() * .5), kind: slab ? 'slab' : 'mesa', elong: 1.05 + R() * .3, seed: site.i * 31 + k * 7 + 5});
      const m = reach(g), a = R() * Math.PI * 2, d = Math.max(0, Math.min(site.r * .75 + m * .5, site.r + .85 - m));
      parts.push({g, dx: Math.cos(a) * d, dz: Math.sin(a) * d, yaw: R() * Math.PI * 2, tilt: slab ? .1 + R() * .22 : 0});
    }
    for (const [k, s] of parts.entries()) {
      const x = site.x + s.dx, z = site.z + s.dz, g = s.g, m = reach(g);
      // The main stone stands on the ground under the sand (rockSand), so the skirt the wind piled round it buries its
      // foot; the blocks fallen off it lie on that sand, sunk a quarter of their height.
      let low = Infinity;
      const ground = k ? height : bare;
      for (let a = 0; a < 12; a++) for (const f of [.4, .9]) low = Math.min(low, ground(x + Math.cos(a * .52) * m * f, z + Math.sin(a * .52) * m * f));
      if (k) { g.computeBoundingBox(); low -= g.boundingBox!.max.y * .25; }
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, s.tilt, 'YXZ'));
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, low, z), q, new THREE.Vector3(1, 1, 1)));
      const pos = g.getAttribute('position') as THREE.BufferAttribute, kind = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) kind.set([site.basalt ? 1 : 0, site.vent && k === 0 ? 1 : 0, pos.getY(v) - height(pos.getX(v), pos.getZ(v))], v * 3);
      g.setAttribute('aKind', new THREE.BufferAttribute(kind, 3));
      geos.push(g); count++;
      if (site.vent && k === 0) { g.computeBoundingBox(); vents.push({pos: new THREE.Vector3(x, g.boundingBox!.max.y + .2, z), size: 2.2 + site.r * .5}); }
    }
  }
  const geo = mergeGeometries(geos, false)!; geos.forEach(g => g.dispose());
  geo.computeBoundingSphere();
  const uniforms = {dbTime: {value: 0}, dbSand: {value: sand}};
  const mesh = new THREE.Mesh(geo, boulderMaterial(uniforms));
  mesh.name = 'dawnreach-boulder-groups'; mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  const glow = dawnGlows(vents, '#ff6a1c', 'dawnreach-vent-glows');
  group.add(glow);
  group.userData.stones = count; group.userData.sites = dawnBoulderSites().length; group.userData.vents = vents.length;
  return {group, update(time) { uniforms.dbTime.value = time; (glow.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }};
}
