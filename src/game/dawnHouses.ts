import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {addPatch} from '../world/materials';
import {rng} from '../world/noise';
import type {Lot} from '../world/layout';
import {FROST_NOISE} from './frostPaving';
import {dawnWood, solidPart, woodPart} from './dawnMaterials';

/*
 * Goldsand Harbor's houses, raised on the same lots and footprints the colliders use (dawnLots(); TownBuilder still
 * registers each footprint for the server). A desert town's language, not the kit's European one: thick battered
 * walls with rounded corners, limewash, sandstone or bare mudbrick, flat roofs behind parapets, two-storey houses
 * stepping back to leave a roof terrace, small deep windows under timber lintels with turquoise or indigo shutters,
 * arched doors, rows of protruding roof-beam ends (vigas), striped awnings over the doors and shade sails over the
 * terraces, water jars, rolled rugs and ladders on the roofs, and windcatcher towers on the larger houses.
 * Walls are one mesh, wood one, cloth one, terracotta one.
 */

const STOREY = 3.1, PARAPET = .55, BATTER = .05;

/** Wall colours: limewash, sandstone, mudbrick (linear, slightly varied per house). */
const WALLS = [new THREE.Color('#efe4cf'), new THREE.Color('#d9a86a'), new THREE.Color('#b07a4c'), new THREE.Color('#e8d3b0')];
const PAINTS = ['#2aa3a0', '#2b3a7a', '#2aa3a0', '#b5532c'];
const CLOTH = ['#2b3a7a', '#e3a21a', '#b5532c', '#2aa3a0'];

const WALL_HEAD = /* glsl */ `
varying vec3 vHw;
varying vec3 vHn;
varying float vHg;
${FROST_NOISE}
float hwN3(vec3 p,vec3 w){return fpNoise(p.zy)*w.x+fpNoise(p.xz+3.1)*w.y+fpNoise(p.xy-7.7)*w.z;}
`;
/** Plaster and mudbrick: mottled limewash, dust at the foot, patches fallen away to show the bricks, sun-bleached tops. */
function wallMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-house-walls', color: '#ffffff', roughness: .95, vertexColors: true});
  addPatch(m, 'goldsand-walls', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGround;\nvarying vec3 vHw;\nvarying vec3 vHn;\nvarying float vHg;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvHw=(modelMatrix*vec4(transformed,1.)).xyz;vHn=normalize(mat3(modelMatrix)*objectNormal);vHg=aGround;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${WALL_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 hn=normalize(vHn),hw=abs(hn)/(abs(hn.x)+abs(hn.y)+abs(hn.z));
        float above=vHw.y-vHg;
        float n1=hwN3(vHw*.7,hw),n2=hwN3(vHw*3.1,hw),n3=hwN3(vHw*13.,hw);
        vec3 base=vColor.rgb;
        vec3 c=base*(.9+.12*n1+.06*n2+.05*n3);
        // Hand-trowelled: soft wavy shading across the faces.
        c*=.96+.05*sin(vHw.y*5.+n1*4.);
        // Mudbrick shows where the plaster has fallen away (vertical faces, low and at the corners).
        float side=1.-abs(hn.y);
        float bare=smoothstep(.62,.7,n1*.5+.5+n2*.12+(1.-smoothstep(0.,1.6,above))*.12)*side*step(.5,length(base-vec3(.69,.48,.3))+.0);
        vec2 bq=vec2(dot(vHw.xz,vec2(hn.z,-hn.x))/.36,vHw.y/.16);bq.x+=step(1.,mod(floor(bq.y),2.))*.5;
        vec2 bf=abs(fract(bq)-.5);float brick=smoothstep(.42,.47,max(bf.x*.9,bf.y));
        vec3 mud=mix(vec3(.43,.26,.15),vec3(.5,.32,.19),fract(sin(dot(floor(bq),vec2(12.9,78.2)))*437.5))*(1.-brick*.35);
        c=mix(c,mud,bare);
        // Dust and splash at the foot, sun-bleached on top, a little soot streak under the beam ends.
        c=mix(c,c*vec3(.82,.72,.6),(1.-smoothstep(.0,.9+.4*n2,above))*.6);
        c=mix(c,c*1.06+.02,smoothstep(.7,.95,hn.y));
        diffuseColor.rgb=c;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float fade=1.-smoothstep(10.,35.,length(vViewPosition));
          if(fade>.01){
            #define HW_H(P) (fpNoise((P).xz*4.+(P).y*2.)*.5+fpNoise((P).zy*4.)*.5+fpNoise((P).xy*4.)*.5+fpNoise((P).xz*17.+(P).y*13.)*.2)
            vec3 q=vHw;float e=.03,h0=HW_H(q);
            vec3 g=vec3(HW_H(q+vec3(e,0.,0.))-h0,HW_H(q+vec3(0.,e,0.))-h0,HW_H(q+vec3(0.,0.,e))-h0)/e;
            vec3 nw=inverseTransformDirection(normal,viewMatrix);
            nw=normalize(nw-(g-dot(g,nw)*nw)*.025*fade);
            normal=normalize((viewMatrix*vec4(nw,0.)).xyz);
          }
        }`);
  });
  m.customProgramCacheKey = () => 'goldsand-walls';
  return m;
}

/** Striped canvas (vertex colour the stripe's dye, uv.x across the stripes). */
export function clothMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-canvas', color: '#ffffff', roughness: .95, vertexColors: true, side: THREE.DoubleSide});
  addPatch(m, 'goldsand-canvas', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCu;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvCu=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCu;\n${FROST_NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        float st=step(.5,fract(vCu.x*3.));
        vec3 c=mix(vColor.rgb,vec3(.86,.78,.64),st);
        c*=.88+.14*(fpNoise(vCu*vec2(40.,6.))*.5+.5);
        c*=1.-.25*smoothstep(.7,1.,vCu.y);
        diffuseColor.rgb=c;`);
  });
  m.customProgramCacheKey = () => 'goldsand-canvas';
  return m;
}

/** Glazed and unglazed terracotta: jars, chimney pots. */
export function terracottaMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-terracotta', color: '#ffffff', roughness: .8, vertexColors: true});
  addPatch(m, 'goldsand-terracotta', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTw=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTw;\n${FROST_NOISE}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=vColor.rgb*(.85+.2*(fpNoise(vTw.xz*9.+vTw.y*7.)*.5+.5))*(.92+.08*sin(vTw.y*60.));');
  });
  m.customProgramCacheKey = () => 'goldsand-terracotta';
  return m;
}

/**
 * A battered prism with rounded vertical corners: rings of a rounded rectangle from y0 to y1 (inset grows by
 * `batter` per metre), with an optional top cap. `inward` flips it to face inside (parapets' inner faces).
 */
function shell(w: number, d: number, r: number, y0: number, y1: number, batter: number, cap: boolean, inward = false, inset0 = 0): THREE.BufferGeometry {
  const ring = (y: number) => {
    const ins = inset0 + (y - y0) * batter, hw = w / 2 - ins, hd = d / 2 - ins, rr = Math.max(.05, Math.min(r, hw, hd) - ins * .3), pts: THREE.Vector2[] = [];
    for (const [cx, cz, a0] of [[hw - rr, hd - rr, 0], [-(hw - rr), hd - rr, Math.PI / 2], [-(hw - rr), -(hd - rr), Math.PI], [hw - rr, -(hd - rr), Math.PI * 1.5]] as const)
      for (let k = 0; k <= 4; k++) { const a = a0 + k / 4 * Math.PI / 2; pts.push(new THREE.Vector2(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)); }
    return pts;
  };
  const A = ring(y0), B = ring(y1), pos: number[] = [], idx: number[] = [];
  const n = A.length;
  for (const p of A) pos.push(p.x, y0, p.y);
  for (const p of B) pos.push(p.x, y1, p.y);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (inward) idx.push(i, n + i, j, j, n + i, n + j); else idx.push(i, j, n + i, j, n + j, n + i);
  }
  if (cap) {
    const c = pos.length / 3; pos.push(0, y1, 0);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(c, n + j, n + i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const out = g.toNonIndexed(); out.computeVertexNormals(); g.dispose();
  return out;
}

export interface DawnHouses {group: THREE.Group; doors: {pos: THREE.Vector3; yaw: number}[]; stats: Record<string, number>}

/** Raise every lot as a Goldsand house. `height` is the gameplay surface. */
export function dawnHouses(lots: readonly Lot[], height: (x: number, z: number) => number): DawnHouses {
  const group = new THREE.Group(); group.name = 'goldsand-houses';
  const walls: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], cloth: THREE.BufferGeometry[] = [], clay: THREE.BufferGeometry[] = [];
  const doors: {pos: THREE.Vector3; yaw: number}[] = [];
  const stats = {houses: 0, windows: 0, vigas: 0, windcatchers: 0, awnings: 0, sails: 0, jars: 0};
  const box = new THREE.BoxGeometry(1, 1, 1), beam = new THREE.CylinderGeometry(.085, .095, 1, 8);
  const jar = lathe([[0, 0], [.13, 0], [.2, .08], [.25, .25], [.24, .42], [.16, .55], [.1, .6], [.12, .64], [.1, .66], [0, .66]], 14);
  const tag = (g: THREE.BufferGeometry, color: THREE.Color, ground: number) => {
    const n = g.getAttribute('position').count, c = new Float32Array(n * 3), a = new Float32Array(n);
    for (let i = 0; i < n; i++) { c.set([color.r, color.g, color.b], i * 3); a[i] = ground; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aGround', new THREE.BufferAttribute(a, 1));
    return g;
  };
  const colored = (g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation) => {
    const out = solidPart(g, m), n = out.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(color);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3)); return out;
  };
  // A cloth panel (w x l) with uv for stripes, sagging; placed by m.
  const canvas = (w: number, l: number, sag: number, m: THREE.Matrix4, dye: string) => {
    const g = new THREE.PlaneGeometry(w, l, 8, 6), p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / w + .5, v = p.getY(i) / l + .5; p.setZ(i, -sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)); uv.setXY(i, u * w, v); }
    g.computeVertexNormals();
    const out = g.toNonIndexed().applyMatrix4(m), n = out.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(dye);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.dispose(); return out;
  };

  for (const lot of lots) {
    const R = rng(Math.abs(Math.round(lot.x * 31 + lot.z * 17)) + 11);
    const W = lot.sx * 2, D = lot.sz * 2;
    // The lot is flattened at lot.h; the footing goes down to the lowest ground under the footprint.
    let low = Infinity;
    for (const fx of [-.5, 0, .5]) for (const fz of [-.5, 0, .5]) {
      const lx = fx * W, lz = fz * D, wx = lot.x + Math.cos(lot.yaw) * lx + Math.sin(lot.yaw) * lz, wz = lot.z - Math.sin(lot.yaw) * lx + Math.cos(lot.yaw) * lz;
      low = Math.min(low, height(wx, wz));
    }
    const y0 = lot.h, base = new THREE.Matrix4().compose(new THREE.Vector3(lot.x, y0, lot.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lot.yaw), new THREE.Vector3(1, 1, 1));
    const L = (m: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(base, m);
    const M = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => L(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz)));
    const wallCol = WALLS[(lot.style + Math.floor(R() * 4)) % WALLS.length].clone().multiplyScalar(.94 + R() * .1);
    const paint = PAINTS[Math.floor(R() * PAINTS.length)], dye = CLOTH[Math.floor(R() * CLOTH.length)];
    const big = lot.kind !== 'house', floors = big ? 2 : lot.floors;
    const H1 = STOREY + (big ? .4 : 0);
    // Footing, then the ground storey with its parapet.
    const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, col = wallCol) => walls.push(tag(solidPart(g, m), col, y0));
    add(shell(W + .3, D + .3, .5, low - y0 - .8, .35, .02, false), base, wallCol.clone().multiplyScalar(.82));
    add(shell(W, D, .45, .3, H1, BATTER, false), base);
    const topIns = (H1 - .3) * BATTER, pw = W - topIns * 2, pd = D - topIns * 2;
    add(shell(pw, pd, .4, H1, H1 + PARAPET, .01, false), base);
    add(shell(pw - .5, pd - .5, .3, H1 - .25, H1 + PARAPET, -.01, false, true), base);
    // Parapet top and the roof deck.
    add(shell(pw - .02, pd - .02, .4, H1 + PARAPET, H1 + PARAPET + .06, .12, true), base);
    add(shell(pw - .5, pd - .5, .3, H1 - .3, H1 - .25, 0, true), base, wallCol.clone().multiplyScalar(.9));
    let roofTop = H1 + PARAPET, upper: {w: number; d: number; z: number} | null = null;
    if (floors > 1) {
      // The upper storey steps back to the rear, leaving a terrace over the street.
      const uw = W * .7, ud = D * .55, uz = -(D - ud) / 2 + .35;
      upper = {w: uw, d: ud, z: uz};
      const H2 = H1 + STOREY - .3;
      add(shell(uw, ud, .4, H1 - .25, H2, BATTER * .8, false), L(new THREE.Matrix4().makeTranslation(0, 0, uz)));
      const ins2 = (H2 - H1) * BATTER * .8;
      add(shell(uw - ins2 * 2, ud - ins2 * 2, .35, H2, H2 + PARAPET * .8, .01, false), L(new THREE.Matrix4().makeTranslation(0, 0, uz)));
      add(shell(uw - ins2 * 2 - .02, ud - ins2 * 2 - .02, .35, H2 + PARAPET * .8, H2 + PARAPET * .8 + .06, .12, true), L(new THREE.Matrix4().makeTranslation(0, 0, uz)));
      roofTop = H2 + PARAPET * .8;
    }
    // Vigas: beam ends along the front and sides just under the parapet.
    const faceZ = (y: number) => D / 2 - (y - .3) * BATTER, faceX = (y: number) => W / 2 - (y - .3) * BATTER;
    const vy = H1 - .28;
    for (let x = -W / 2 + .7; x <= W / 2 - .6; x += .72) { wood.push(woodPart(beam, M(x, vy, faceZ(vy) + .15, 0, 1, .45, 1, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0))); stats.vigas++; }
    for (const s of [-1, 1]) for (let z = -D / 2 + .8; z <= D / 2 - .7; z += .9) { wood.push(woodPart(beam, M(s * (faceX(vy) + .15), vy, z, 0, 1, .45, 1, 0, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0))); stats.vigas++; }
    // Door: an arched opening in the front, a planked door in a turquoise or indigo frame, a lintel beam.
    const dx = big ? 0 : (R() < .5 ? -1 : 1) * W * .18, dw = big ? 1.6 : 1.1, dh = big ? 2.5 : 2.15;
    {
      const sh = new THREE.Shape(); sh.moveTo(-dw / 2, 0); sh.lineTo(dw / 2, 0); sh.lineTo(dw / 2, dh - dw / 2); sh.absarc(0, dh - dw / 2, dw / 2, 0, Math.PI, false); sh.closePath();
      const fr = new THREE.Shape(); const fw = dw + .36, fh = dh + .18;
      fr.moveTo(-fw / 2, 0); fr.lineTo(fw / 2, 0); fr.lineTo(fw / 2, fh - fw / 2); fr.absarc(0, fh - fw / 2, fw / 2, 0, Math.PI, false); fr.closePath(); fr.holes.push(sh);
      const zf = faceZ(1.2);
      const frame = new THREE.ExtrudeGeometry(fr, {depth: .12, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2, curveSegments: 10});
      add(frame, M(dx, .3, zf - .04), wallCol.clone().multiplyScalar(1.05)); frame.dispose();
      const leaf = new THREE.ExtrudeGeometry(sh, {depth: .06, bevelEnabled: false, curveSegments: 10});
      wood.push(woodPart(leaf, M(dx, .3, zf - .1), paint, .85, new THREE.Vector3(0, 1, 0))); leaf.dispose();
      for (let k = -1; k <= 1; k += 2) wood.push(woodPart(box, M(dx + k * dw * .22, .3 + dh * .45, zf - .03, 0, .05, dh * .8, .02), null, 0, new THREE.Vector3(0, 1, 0)));
      doors.push({pos: new THREE.Vector3(dx + dw / 2 + .35, 1.85, zf + .02).applyMatrix4(base), yaw: lot.yaw});
    }
    // Small deep windows: a dark recess, a sill, a timber lintel, painted shutters folded open.
    const win = (x: number, y: number, face: 'front' | 'left' | 'right' | 'back', w = .62, h = .8) => {
      const yaw = face === 'front' ? 0 : face === 'back' ? Math.PI : face === 'left' ? -Math.PI / 2 : Math.PI / 2;
      const off = face === 'front' || face === 'back' ? faceZ(y) : faceX(y);
      const at = (lx: number, ly: number, lz: number) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [lx * c + (off + lz) * s, ly, -lx * s + (off + lz) * c] as const; };
      const [rx, ry, rz] = at(x, y, -.01);
      walls.push(tag(colored(box, M(rx, ry, rz, yaw, w, h, .04), '#000'), new THREE.Color('#1c130d'), y0));
      for (const [lx, lw, lh] of [[-w / 2 - .05, .1, h + .1], [w / 2 + .05, .1, h + .1]] as const) { const [a, b, c] = at(x + lx, y, .04); add(new THREE.BoxGeometry(lw, lh, .16), M(a, b, c, yaw)); }
      { const [a, b, c] = at(x, y - h / 2 - .06, .08); add(new THREE.BoxGeometry(w + .3, .1, .24), M(a, b, c, yaw)); }
      { const [a, b, c] = at(x, y + h / 2 + .1, .1); wood.push(woodPart(box, M(a, b, c, yaw, w + .55, .14, .22), null, 0)); }
      for (const s of [-1, 1]) { const [a, b, c] = at(x + s * (w / 2 + .2), y, .1); wood.push(woodPart(box, M(a, b, c, yaw + s * 1.25, w / 2, h - .06, .035), paint, .9, new THREE.Vector3(0, 1, 0))); }
      stats.windows++;
    };
    const wy = 1.75;
    for (const x of big ? [-W * .32, W * .32] : [dx > 0 ? -W * .22 : W * .22]) win(x, wy, 'front');
    for (const face of ['left', 'right'] as const) win((R() - .5) * D * .3, wy + (R() - .5) * .2, face, .5, .7);
    if (upper) {
      // Upper windows on the terrace front, and a shade sail over the terrace.
      const uf = (y: number) => upper!.z + upper!.d / 2 - (y - H1) * BATTER * .8;
      for (const x of [-upper.w * .22, upper.w * .22]) {
        const y = H1 + 1.5;
        walls.push(tag(colored(box, M(x, y, uf(y) - .01, 0, .5, .75, .04), '#000'), new THREE.Color('#1c130d'), y0));
        wood.push(woodPart(box, M(x, y + .48, uf(y) + .1, 0, .95, .13, .2), null, 0));
        stats.windows++;
      }
      const tz0 = upper.z + upper.d / 2, tz1 = D / 2 - topIns - .2;
      if (tz1 - tz0 > 1) {
        for (const s of [-1, 1]) wood.push(woodPart(new THREE.CylinderGeometry(.05, .05, 2.3, 6), M(s * (pw / 2 - .4), H1 + 1.1, tz1 - .1), null, 0, new THREE.Vector3(0, 1, 0)));
        cloth.push(canvas(pw - .8, tz1 - tz0, .18, M(0, H1 + 2.15, (tz0 + tz1) / 2, 0, 1, 1, 1, -Math.PI / 2 - .12), dye)); stats.sails++;
        // A rolled rug and jars on the terrace.
        wood.push(woodPart(new THREE.CylinderGeometry(.13, .13, 1.6, 10), M(-pw / 4, H1 - .1, (tz0 + tz1) / 2, 0, 1, 1, 1, 0, Math.PI / 2), CLOTH[(Math.floor(R() * 4) + 1) % 4], .95));
      }
      // A ladder from the terrace to the upper roof.
      const lx = upper.w / 2 - .5, lz = upper.z + upper.d / 2 + .35, lh = roofTop - H1 + .5;
      for (const s of [-.22, .22]) wood.push(woodPart(box, M(lx + s, H1 - .25 + lh / 2, lz, 0, .06, lh, .06, -.18), null, 0, new THREE.Vector3(0, 1, 0)));
      for (let k = 1; k < lh / .32; k++) wood.push(woodPart(box, M(lx, H1 - .25 + k * .32, lz + Math.sin(.18) * (k * .32 - lh / 2) * -1, 0, .44, .04, .04), null, 0));
    }
    // Jars on the roof, gathered in a corner.
    const jars = 2 + Math.floor(R() * 3);
    for (let k = 0; k < jars; k++) {
      const jx = (upper ? -upper.w / 2 + .5 : -pw / 2 + .6) + k * .5 + R() * .1, jz = (upper ? upper.z - upper.d / 2 + .55 : -pd / 2 + .6) + (k % 2) * .4, jy = (upper ? roofTop - PARAPET * .8 : H1 - .25);
      clay.push(colored(jar, M(jx, jy, jz, R() * 6, .9 + R() * .3), k % 3 ? '#b5532c' : '#c98a52')); stats.jars++;
    }
    // Windcatcher on the larger houses: a square tower with slotted vents high up.
    if (big || R() < .3) {
      const tx = (upper ? upper.w / 2 - .7 : pw / 2 - .8), tz = (upper ? upper.z - upper.d / 2 + .7 : -pd / 2 + .8), ty = roofTop - (upper ? PARAPET * .8 : PARAPET) - .1, th = 3.4;
      add(shell(1.25, 1.25, .12, ty, ty + th, .015, true), L(new THREE.Matrix4().makeTranslation(tx, 0, tz)));
      for (const f of [0, 1, 2, 3]) for (const k of [-1, 0, 1]) {
        const a = f * Math.PI / 2, ox = Math.sin(a) * .62, oz = Math.cos(a) * .62, px = Math.cos(a) * k * .3, pz = -Math.sin(a) * k * .3;
        walls.push(tag(colored(box, M(tx + ox + px, ty + th - .75, tz + oz + pz, a, .14, 1.0, .04), '#000'), new THREE.Color('#1c130d'), y0));
      }
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; wood.push(woodPart(beam, M(tx + Math.sin(a) * .7, ty + th - .2, tz + Math.cos(a) * .7, a, 1, .35, 1, Math.PI / 2), null, 0, new THREE.Vector3(0, 1, 0))); }
      stats.windcatchers++;
    }
    // Striped awning over the door on two poles.
    {
      const zf = faceZ(2.4), aw = dw + 1.2, al = 1.5;
      for (const s of [-1, 1]) wood.push(woodPart(new THREE.CylinderGeometry(.04, .045, 2.25, 6), M(dx + s * aw / 2, 1.42, zf + al - .05), null, 0, new THREE.Vector3(0, 1, 0)));
      wood.push(woodPart(box, M(dx, 2.6, zf + .06, 0, aw + .2, .1, .1), null, 0));
      cloth.push(canvas(aw, al, .1, M(dx, 2.52, zf + al / 2, 0, 1, 1, 1, -Math.PI / 2 + .45), dye)); stats.awnings++;
    }
    stats.houses++;
  }
  box.dispose(); beam.dispose(); jar.dispose();
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = m.receiveShadow = true; group.add(m);
  };
  mk(walls, wallMaterial(), 'goldsand-house-walls');
  mk(wood, dawnWood('goldsand-house-wood'), 'goldsand-house-wood');
  mk(cloth, clothMaterial(), 'goldsand-house-canvas');
  mk(clay, terracottaMaterial(), 'goldsand-house-jars');
  group.userData.stats = stats;
  return {group, doors, stats};
}
