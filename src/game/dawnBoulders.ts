import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {rng} from '../world/noise';
import {addPatch} from '../world/materials';
import {FROST_NOISE} from './frostPaving';
import {DAWN_WIND} from '../sim/world/dawnGround';
import {dawnGlows} from './dawnMaterials';
import {DAWN_SAND} from './dawnPaving';
import {dawnRocks} from './world3Colliders';

/*
 * The rock groups ringing the citadel, World III's sculpted boulders. Each collider site (dawnRocks(), radius r + 1)
 * holds a main stone and two or three companions, built bed by bed (strataGeometry: mesas, hoodoos, fallen slabs,
 * long along the wind) and painted here: warm cross-bedded sandstone on the southern, seaward arc; dark
 * vesicular basalt towards the volcano, with sun-baked tops, ochre and grey-green lichen and blown sand banked at
 * the foot. Every third basalt group is split by a lava fissure that glows and breathes. All of it is one mesh and
 * one draw (plus one draw of vent glows).
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
        // aKind: x basalt (0 sandstone), y lava in the partings, z height above the ground at this vertex.
        vec3 bN=normalize(vDbN),bA=abs(bN)/(abs(bN.x)+abs(bN.y)+abs(bN.z));
        float occ=vColor.r,bed=vColor.g,above=vDbK.z;
        float n1=dbN3(vDbW*.55,bA),n2=dbN3(vDbW*2.4,bA),n3=dbN3(vDbW*9.,bA);
        // Sandstone: cross-bedded laminae of honey, cream and rose, varnished darker on the steep faces.
        // Beds of uneven thickness in world height (never stretched with the stone), each its own tone (honey,
        // cream, rose, a darker iron band now and then), thin recessed partings between them, cross-bedded laminae
        // slanting inside the thick ones.
        // The beds are geometry (strataGeometry): each carries its tone in vertex colour g; inside it laminae of a
        // hand's thickness, a recessed parting now and then.
        float by=vDbW.y+n1*.05,bi=floor(by/.13),bh=fpHash12(vec2(bi,7.1)),bf=fract(by/.13);
        float bk=bed;
        vec3 bedC=bk<.3?vec3(.7,.45,.24):bk<.55?vec3(.77,.58,.36):bk<.82?vec3(.68,.41,.23):vec3(.52,.3,.15);
        bedC*=.93+.1*bh;
        float side=1.-smoothstep(.55,.85,abs(bN.y));
        float lamX=mix(.5,sin((vDbW.y-dot(vDbW.xz,vec2(.55,.3))*(bh-.5))*38.+n2*1.2)*.5+.5,side);
        vec3 ss=bedC*(.9+.12*lamX*step(.45,bh));
        float part=(1.-smoothstep(.0,.08,min(bf,1.-bf)))*step(.72,bh);
        ss*=1.-part*.25*side;
        ss=mix(ss,vec3(.55,.3,.2),smoothstep(.62,.9,n1*.5+.5)*.3);
        float lam2=lamX;
        ss=mix(ss,ss*vec3(.72,.62,.55),(1.-bN.y*bN.y)*smoothstep(.2,.7,fpNoise(vec2(vDbW.x+vDbW.z,vDbW.y*.15)*2.))*.5);
        // Basalt: near-black, vesicles, rusty weathering; the tops bleached and warmed by the sun.
        float ves=smoothstep(.55,.8,fpNoise(vDbW.xz*17.+vDbW.y*9.)*.5+.5);
        vec3 bs=mix(vec3(.04,.038,.037),vec3(.11,.1,.095),clamp(.5+.6*n1+.3*n2,0.,1.))*(1.-ves*.4)*(.9+.2*n3);
        bs=mix(bs,vec3(.12,.07,.045),smoothstep(.75,.95,bed)*.25);
        float top=smoothstep(.45,.9,bN.y+n2*.12);
        bs=mix(bs,vec3(.17,.14,.115),top*.35);
        vec3 bC=mix(ss,bs,vDbK.x)*mix(1.,occ*occ,.8);
        // Lichen: ochre rosettes and grey-green crust on the upper faces, more on the basalt.
        float cell=fpNoise(vDbW.xz*5.3+vDbW.y*2.+11.)*.6+fpNoise(vDbW.xz*13.-vDbW.y*4.)*.4;
        float lich=smoothstep(.6,.72,cell*.5+.5)*smoothstep(.2,.6,bN.y+.3*n1)*smoothstep(.3,.8,dbN3(vDbW*.9+2.,bA)*.5+.5)*mix(.35,.9,vDbK.x);
        vec3 lc=mix(vec3(.42,.27,.05),vec3(.2,.22,.13),smoothstep(.4,.7,fpNoise(vDbW.xz*.8+3.)*.5+.5));
        bC=mix(bC,lc*(.85+.3*n3),lich*.8*(1.-vDbK.y));
        // Blown sand banked against the foot and lodged on the ledges.
        float wind=max(0.,dot(bN.xz,normalize(vec2(.9,.35))));
        float skirt=1.-smoothstep(.03,.38+.25*(n2*.5+.5)+.8*wind,above);
        float ledge=smoothstep(.84,.96,bN.y+n2*.08)*smoothstep(.6,.85,n1*.5+.5)*(1.-vDbK.x*.85);
        float sand=max(skirt,ledge*.8);
        // Heat: the rock around a fissure is reddened and the parting itself glows.
        // Fissures: branching zero-lines of a noise, wider low on the stone where the melt rose through.
        float fz=fpNoise(vDbW.xz*.9+vDbW.y*.6)+fpNoise(vDbW.zy*2.3+1.7)*.35;
        float fw=.035+.05*(1.-smoothstep(0.,2.5,above));
        float fiss=vDbK.y*(1.-smoothstep(fw*.4,fw,abs(fz)))*smoothstep(.2,.6,fpNoise(vDbW.xz*.5+vDbW.y*.3)*.5+.5+.3)*(1.-smoothstep(1.5,4.5,above));
        float heat=vDbK.y*(1.-smoothstep(fw,fw*5.,abs(fz)))*(1.-smoothstep(1.5,5.,above))*.7;
        bC=mix(bC,vec3(.16,.05,.02),heat);
        bC=mix(bC,dbSand*(.85+.2*n3),sand*(1.-fiss));
        diffuseColor.rgb=bC;
        float dbGlow=fiss*(.75+.25*sin(dbTime*1.7+vDbW.x*.7+vDbW.z*.4));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.9,.8,vDbK.x*top),.97,sand);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.38,.08)*dbGlow*4.+vec3(.6,.14,.02)*heat*.3;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float fade=(1.-smoothstep(14.,45.,length(vViewPosition)))*(1.-sand*.7);
          if(fade>.01){
            vec3 q=vDbW;float e=.03;
            #define DB_H(Q) (fpNoise((Q).xz*3.+(Q).y)*.35+(fpNoise((Q).zy*11.)*bA.x+fpNoise((Q).xz*11.+3.1)*bA.y+fpNoise((Q).xy*11.)*bA.z)*.3+vDbK.x*smoothstep(.55,.8,fpNoise((Q).xz*17.+(Q).y*9.)*.5+.5)*-.3+(1.-vDbK.x)*side*sin((Q).y*23.+fpNoise((Q).xz*2.4)*3.)*.12)
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
 * Wind-carved sandstone built the way it weathers, bed by bed (stone-local, y up, x along the wind): every bed is a
 * prism of its own outline with a rounded upper edge, hard beds standing proud and soft ones recessed, so the strata
 * read as crisp ledges and partings in silhouette, not as paint on a blob. The lowest beds are sand-blasted into a
 * neck (the undercut of a yardang foot, deep enough on a hoodoo to leave the caprock overhanging), the top bed is
 * planed flat. The outline is a yardang's: long along the wind, the windward nose blunt and the lee tail tapered.
 * Beds stop at hard creases (each bed's sides, its ledge and the cap own their vertices). Vertex colour: r the
 * skylight a face sees (dark under an overhang and low on the neck), g the bed's tone.
 */
export function strataGeometry(k: StrataStone): THREE.BufferGeometry {
  const R = rng(k.seed * 7919 + 13), M = k.kind === 'slab' ? 16 : 30;
  const outline = ringNoise(R, 4);
  const bury = k.kind === 'slab' ? k.h * .35 : k.h * .22, top = k.h, H = top + bury;
  // Joints: two or three vertical cracks cut through the whole stack, the stone splitting along them.
  const joints = k.kind === 'slab' ? [] : Array.from({length: 2 + Math.floor(R() * 2)}, () => [R() * Math.PI * 2, .05 + R() * .05, .08 + R() * .08]);
  // Beds alternate: thick soft ones the wind hollows into a concave slope, thin hard ones that stand out as ledges.
  type Bed = {y0: number; y1: number; s: number; hard: boolean; tone: number; own: (t: number) => number; ox: number; oz: number};
  const beds: Bed[] = [];
  if (k.kind === 'slab') {
    const mid = -bury + H * (.45 + R() * .2);
    beds.push({y0: -bury, y1: mid, s: 1, hard: false, tone: R(), own: ringNoise(R, 2), ox: 0, oz: 0}, {y0: mid, y1: top, s: .97, hard: true, tone: R(), own: ringNoise(R, 2), ox: 0, oz: 0});
  } else {
    let y = -bury, hard = R() < .4;
    while (y < top - .05) {
      let th = hard ? Math.max(.12, H * (.05 + R() * .05)) : H * (.13 + R() * .14);
      if (top - (y + th) < Math.max(.15, H * .08)) th = top - y;
      const t = (y + th / 2 + bury) / H;
      // Section: the sand-blasted neck low down (deep on a hoodoo), the caprock wider than what holds it up.
      let s = k.kind === 'hoodoo' ? .48 + .52 * THREE.MathUtils.smoothstep(t, .3, .82) : .78 + .22 * THREE.MathUtils.smoothstep(t, .04, .38);
      s *= hard ? 1.05 : .97;
      beds.push({y0: y, y1: y + th, s, hard, tone: R(), own: ringNoise(R, 3), ox: (R() - .5) * .08, oz: (R() - .5) * .08});
      y += th; hard = !hard;
    }
    const cap = beds[beds.length - 1];
    cap.s = Math.max(cap.s, k.kind === 'hoodoo' ? 1.1 : 1.02); cap.hard = true;
    beds[0].s *= 1.05; // the buried foot flares into the sand
  }
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const at = (bed: Bed, i: number, scale: number, yy: number, occ: number) => {
    const th = i / M * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    let rad = 1 + .16 * outline(th) + (bed.hard ? .04 : .08) * bed.own(th);
    for (const [ja, jw, jd] of joints) { const d = Math.atan2(Math.sin(th - ja), Math.cos(th - ja)); rad *= 1 - jd * Math.exp(-((d / jw) ** 2)); }
    rad *= k.r * scale;
    // Yardang outline: long downwind (+x), the lee tail narrower.
    const x = c * rad * k.elong * (c > 0 ? 1.12 : .9) + bed.ox * k.r, z = sn * rad * (1 - .28 * Math.max(0, c)) + bed.oz * k.r;
    pos.push(x, yy, z); col.push(occ, bed.tone, 0);
    return pos.length / 3 - 1;
  };
  const band = (rings: number[]) => { // quads between consecutive rings of M vertices each
    for (let r = 1; r < rings.length; r++) for (let i = 0; i < M; i++) {
      const a = rings[r - 1] + i, b = rings[r - 1] + (i + 1) % M, c = rings[r] + i, d = rings[r] + (i + 1) % M;
      idx.push(a, c, b, b, c, d);
    }
  };
  const ring = (bed: Bed, scale: number, yy: number, occ: number) => { let first = -1; for (let i = 0; i < M; i++) { const v = at(bed, i, scale, yy, occ); if (first < 0) first = v; } return first; };
  const occAt = (yy: number) => .5 + .5 * THREE.MathUtils.smoothstep((yy + bury) / H, .1, .9);
  for (let b = 0; b < beds.length; b++) {
    const bed = beds[b], next = beds[b + 1], th = bed.y1 - bed.y0;
    const ch = Math.min(bed.hard ? .06 : .14, th * .3), inset = ch / k.r * .8;
    // Under an overhanging bed this one sees little sky; a hollow soft bed is darker in its waist.
    const shade = next && next.s > bed.s ? .55 : 1, below = b && beds[b - 1].s > bed.s ? .7 : 1;
    const rings = [ring(bed, bed.s * (bed.hard ? 1 : .985), bed.y0, occAt(bed.y0) * below)];
    if (!bed.hard) rings.push(ring(bed, bed.s * .88, bed.y0 + th * .5, occAt(bed.y0 + th * .5) * .85 * Math.min(shade, below) ** .5));
    rings.push(ring(bed, bed.s * .975, bed.y1 - ch, occAt(bed.y1) * shade), ring(bed, bed.s * .975 - inset, bed.y1 - ch * .12, occAt(bed.y1) * shade));
    band(rings);
    if (next) {
      // The parting: a ledge (the next bed set back) or the underside of an overhang, its own crease.
      const l0 = ring(bed, bed.s * .975 - inset, bed.y1 - ch * .12, .85 * shade), l1 = ring(next, next.s * (next.hard ? 1 : .985), bed.y1, .8);
      band([l0, l1]);
    } else {
      // The caprock's planed top, fanned from its middle.
      const c0 = ring(bed, bed.s * .975 - inset, bed.y1 - ch * .12, 1);
      pos.push(bed.ox * k.r, bed.y1 - ch * .05, bed.oz * k.r); col.push(1, bed.tone, 0);
      const cv = pos.length / 3 - 1;
      for (let i = 0; i < M; i++) idx.push(c0 + i, cv, c0 + (i + 1) % M);
    }
  }
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
  const fit = (g: THREE.BufferGeometry, max: number) => { const m = reach(g); if (m > max) g.scale(max / m, 1, max / m); return Math.min(m, max); };
  for (const site of dawnBoulderSites()) {
    const R = rng(site.i * 977 + 31);
    // The main stone fills most of the collider (radius r + 1): a mesa block, or on every other big site a hoodoo.
    const tall = site.r >= 3 && site.i % 2 === 0;
    const main: StrataStone = {r: site.r * .62, h: tall ? site.r * 1.7 : site.r * (.85 + R() * .3), kind: tall ? 'hoodoo' : 'mesa', elong: 1.1 + R() * .25, seed: site.i * 31 + 3};
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
      let low = Infinity;
      for (let a = 0; a < 12; a++) for (const f of [.4, .9]) low = Math.min(low, height(x + Math.cos(a * .52) * m * f, z + Math.sin(a * .52) * m * f));
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
