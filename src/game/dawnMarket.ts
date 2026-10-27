import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {addPatch} from '../world/materials';
import {rng} from '../world/noise';
import {dawnWood, solidPart, woodPart} from './dawnMaterials';
import {FROST_NOISE} from './frostPaving';

/*
 * Goldsand's souk stalls: four timber poles under a striped canvas roof that sags between them, a scalloped valance
 * at the front, a low counter, and the goods: woven baskets heaped with spices (saffron, paprika, turmeric, cumin,
 * dried mint), dates, stacked terracotta and tall water jars, all standing on a patterned rug. Everything merges into
 * five meshes for the whole market.
 */

/** Striped canvas (vertex colour the stripe's dye, uv.x across the stripes). */
function clothMaterial(): THREE.MeshStandardMaterial {
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
function terracottaMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-terracotta', color: '#ffffff', roughness: .8, vertexColors: true});
  addPatch(m, 'goldsand-terracotta', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTw=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTw;\n${FROST_NOISE}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=vColor.rgb*(.85+.2*(fpNoise(vTw.xz*9.+vTw.y*7.)*.5+.5))*(.92+.08*sin(vTw.y*60.));');
  });
  m.customProgramCacheKey = () => 'goldsand-terracotta';
  return m;
}


const SPICES = ['#c8501c', '#e3a21a', '#d6b02a', '#7a4a22', '#6f7a3a', '#9e2a1a'];
const DYES = ['#2b3a7a', '#b5532c', '#2aa3a0', '#e3a21a'];

/** Knotted rugs: border bands, a field of lozenges and a central medallion; vertex colour is the field colour. */
function rugMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-rug', color: '#ffffff', roughness: 1, vertexColors: true});
  addPatch(m, 'goldsand-rug', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRu;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRu=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRu;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec2 u=vRu,c=abs(u-.5)*2.;float edge=max(c.x,c.y);
        vec3 field=vColor.rgb,ivory=vec3(.78,.7,.55),dark=vec3(.12,.07,.05),gold=vec3(.75,.5,.12);
        vec3 col=field;
        col=mix(col,ivory,step(.78,edge)*step(edge,.86));
        col=mix(col,dark,step(.86,edge)*step(edge,.93));
        col=mix(col,field*.6+gold*.4,step(.93,edge));
        vec2 l=fract(u*vec2(6.,4.))-.5;float lz=abs(l.x)+abs(l.y);
        col=mix(col,field*.55+ivory*.25,step(lz,.22)*step(edge,.72));
        float med=abs(u.x-.5)*1.6+abs(u.y-.5)*2.2;
        col=mix(col,gold,step(med,.32)*step(.24,med));col=mix(col,ivory,step(med,.12));
        col*=.88+.12*fract(sin(dot(floor(u*vec2(140.,90.)),vec2(12.9,78.2)))*437.5);
        diffuseColor.rgb=col;`);
  });
  m.customProgramCacheKey = () => 'goldsand-rug';
  return m;
}

const tint = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation) => {
  const n = g.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
};

export function dawnMarket(spots: readonly {x: number; z: number; yaw: number}[], height: (x: number, z: number) => number): {group: THREE.Group; goods: number} {
  const group = new THREE.Group(); group.name = 'goldsand-souk';
  const wood: THREE.BufferGeometry[] = [], cloth: THREE.BufferGeometry[] = [], clay: THREE.BufferGeometry[] = [], rugs: THREE.BufferGeometry[] = [], heaps: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1), pole = new THREE.CylinderGeometry(.045, .055, 1, 7);
  const basket = lathe([[0, 0], [.2, 0], [.26, .06], [.28, .2], [.3, .24], [.27, .25], [0, .24]], 14);
  const heap = lathe([[0, .2], [.27, .2], [.24, .27], [.15, .35], [0, .39]], 12);
  const amph = lathe([[0, 0], [.07, 0], [.06, .05], [.18, .2], [.22, .4], [.18, .58], [.08, .68], [.07, .78], [.1, .8], [0, .8]], 14);
  const pot = lathe([[0, 0], [.12, 0], [.19, .08], [.2, .17], [.14, .26], [.15, .29], [0, .29]], 14);
  let goods = 0;
  for (const [si, s] of spots.entries()) {
    const R = rng(5003 + si * 17), y = height(s.x, s.z);
    const base = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1));
    const M = (x: number, yy: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().compose(new THREE.Vector3(x, yy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz)));
    const W = 2.8, D = 2.2, H = 2.35, dye = DYES[si % DYES.length];
    // Poles (front a little taller so the roof sheds toward the back) and the ridge and eaves rails.
    for (const [px, pz, h] of [[-W / 2, D / 2, H + .2], [W / 2, D / 2, H + .2], [-W / 2, -D / 2, H - .15], [W / 2, -D / 2, H - .15]] as const) wood.push(woodPart(pole, M(px, h / 2, pz, 0, 1, h, 1), null, 0, new THREE.Vector3(0, 1, 0)));
    for (const [pz, h] of [[D / 2, H + .2], [-D / 2, H - .15]] as const) wood.push(woodPart(box, M(0, h - .03, pz, 0, W + .2, .07, .07), null, 0));
    // The canvas roof: sagging between the rails, lifted at the centre, with a scalloped valance at the front.
    {
      const g = new THREE.PlaneGeometry(W + .3, D + .4, 12, 8).rotateX(-Math.PI / 2), p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), u = x / (W + .3) + .5, v = z / (D + .4) + .5;
        p.setY(i, H - .15 + v * .35 + .28 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) - .12 * Math.sin(Math.PI * u) * (1 - Math.sin(Math.PI * v)));
        uv.setXY(i, u * (W + .3), v);
      }
      g.computeVertexNormals(); cloth.push(tint(solidPart(g, M(0, 0, 0), true), dye)); g.dispose();
      const val = new THREE.PlaneGeometry(W + .3, .38, 16, 2), vp = val.getAttribute('position') as THREE.BufferAttribute, vu = val.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < vp.count; i++) { const x = vp.getX(i), yv = vp.getY(i); if (yv < 0) vp.setY(i, yv - .09 * Math.abs(Math.sin(x / (W + .3) * Math.PI * 7))); vu.setXY(i, (x / (W + .3) + .5) * (W + .3), .9); }
      val.computeVertexNormals(); cloth.push(tint(solidPart(val, M(0, H + .02, D / 2 + .18), true), dye)); val.dispose();
    }
    // The rug under the stall, a low counter at the front.
    {
      const rg = new THREE.PlaneGeometry(W + .6, D + .9).rotateX(-Math.PI / 2);
      rugs.push(tint(solidPart(rg, M(0, .035, .25, (R() - .5) * .08), true), DYES[(si + 1 + Math.floor(R() * 3)) % DYES.length])); rg.dispose();
      wood.push(woodPart(box, M(0, .62, D / 2 - .3, 0, W - .3, .06, .55), null, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(woodPart(box, M(sx * (W / 2 - .25), .3, D / 2 - .3 + sz * .22, 0, .06, .6, .06), null, 0, new THREE.Vector3(0, 1, 0)));
      wood.push(woodPart(box, M(0, .45, D / 2 - .05, 0, W - .3, .3, .03), dye, .6));
    }
    // Spice baskets along the counter, each heaped with a colour.
    const nb = 4;
    for (let k = 0; k < nb; k++) {
      const x = -W / 2 + .5 + k * (W - 1) / (nb - 1);
      wood.push(woodPart(basket, M(x, .65, D / 2 - .3, R() * 6, .8, .8, .8), null, 0, new THREE.Vector3(0, 1, 0)));
      heaps.push(tint(solidPart(heap, M(x, .65, D / 2 - .3, 0, .8, .8 + R() * .3, .8)), SPICES[(si + k) % SPICES.length])); goods++;
    }
    // Dates in a big basket on the rug; jars and pots stacked at the back and side.
    wood.push(woodPart(basket, M(-W / 2 + .45, 0, -.2, 0, 1.4, 1.2, 1.4), null, 0, new THREE.Vector3(0, 1, 0)));
    heaps.push(tint(solidPart(heap, M(-W / 2 + .45, 0, -.2, 0, 1.4, 1.3, 1.4)), '#6a3216')); goods++;
    for (let k = 0; k < 5; k++) {
      const big = k < 2, x = big ? W / 2 - .35 - k * .45 : -.3 + (k - 2) * .38, z = big ? -D / 2 + .35 : -.55;
      clay.push(tint(solidPart(big ? amph : pot, M(x, 0, z, R() * 6, big ? 1.2 : 1, big ? 1.2 : 1, big ? 1.2 : 1)), k % 2 ? '#b5532c' : '#c98a52')); goods++;
    }
  }
  [box, pole, basket, heap, amph, pot].forEach(g => g.dispose());
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; group.add(m);
  };
  mk(wood, dawnWood('goldsand-souk-wood'), 'goldsand-souk-wood');
  mk(cloth, clothMaterial(), 'goldsand-souk-canvas');
  mk(clay, terracottaMaterial(), 'goldsand-souk-pottery');
  mk(rugs, rugMaterial(), 'goldsand-souk-rugs', false);
  mk(heaps, new THREE.MeshStandardMaterial({name: 'goldsand-spice', color: '#ffffff', roughness: 1, vertexColors: true}), 'goldsand-souk-spices');
  group.userData.stalls = spots.length; group.userData.goods = goods;
  return {group, goods};
}
