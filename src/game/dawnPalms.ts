import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {addPatch} from '../world/materials';
import {rng} from '../world/noise';
import {FROST_NOISE} from './frostPaving';

/*
 * Date palms for Goldsand Harbor. A leaning trunk with a slight S-curve, wrapped in the stubs of old frond bases (a
 * ring every 12-18 cm up the trunk in the shader, nothing round it, the trunk itself round and gently uneven); a crown of arching fronds, each a folded
 * ribbon whose leaflets are cut by the shader (pinnate, alpha-tested, swaying with the wind), a skirt of dry fronds
 * hanging under the crown and clusters of dates. All palms are three merged meshes (trunks, fronds, dates).
 */

export interface PalmSpot {x: number; z: number; h: number; lean: number; dir: number; seed: number}

const TRUNK_HEAD = `varying vec2 vPu;\n${FROST_NOISE}`;
function trunkMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-palm-trunk', color: '#ffffff', roughness: .95});
  addPatch(m, 'goldsand-palm-trunk', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPu;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPu=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TRUNK_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // Rings up the trunk where old frond bases fell away (uv.y metres up, every 12-18 cm), nothing round it: a
        // dark scar line under each ring's lip, the lip catching light, grey weathered fibre between.
        float rq=vPu.y/.15+.35*fpNoise(vec2(vPu.y*1.7,3.1));float rf=fract(rq);
        float scar=smoothstep(.0,.12,rf)*(1.-smoothstep(.12,.3,rf));
        float lip=smoothstep(.75,.98,rf);
        float tone=fpNoise(vec2(floor(rq)*.37,1.3))*.5+.5;
        vec3 c=mix(vec3(.34,.25,.17),vec3(.48,.39,.29),tone*.6+.2);
        c=mix(c,vec3(.6,.55,.47),smoothstep(.2,1.,vPu.y/8.)*.25);
        c=mix(c,vec3(.15,.1,.07),scar*.75);
        c*=1.+lip*.18;
        diffuseColor.rgb=c;`);
  });
  m.customProgramCacheKey = () => 'goldsand-palm-trunk';
  return m;
}

function frondMaterial(time: {value: number}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'goldsand-palm-fronds', color: '#ffffff', roughness: .7, side: THREE.DoubleSide, alphaTest: .5, vertexColors: true});
  addPatch(m, 'goldsand-palm-fronds', (shader) => {
    shader.uniforms.plTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float plTime;\nattribute float aTip;\nvarying vec2 vFu;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFu=uv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{float ph=position.x*.4+position.z*.3;transformed.y+=aTip*(.12*sin(plTime*1.3+ph)+.05*sin(plTime*3.1+ph*2.));transformed.x+=aTip*.06*sin(plTime*1.1+ph);}');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vFu;\n${FROST_NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // uv.x: across the frond (-1..1 from the rachis), uv.y: along it (0 base .. 1 tip). Leaflets slant toward the tip.
        float ax=abs(vFu.x),along=vFu.y;
        float width=sin(3.14159*min(1.,along*1.15))*(1.-along*.35);
        float k=(along*24.-ax*2.6);float lf=abs(fract(k)-.5);
        float leaflet=step(lf,.4-ax*.1)*step(ax,width);
        float rachis=step(ax,.06);
        diffuseColor.a=max(leaflet,rachis)*step(.04,along);
        vec3 c=mix(vColor.rgb*.75,vColor.rgb,smoothstep(0.,1.,ax));
        c*=.92+.1*(fpNoise(vec2(floor(k),along*3.))*.5+.5);
        c=mix(c,vec3(.55,.42,.22),smoothstep(.85,1.,along)*.6);
        diffuseColor.rgb=mix(c,vec3(.45,.36,.2),rachis);`);
  });
  m.customProgramCacheKey = () => 'goldsand-palm-fronds';
  return m;
}

export interface DawnPalms {group: THREE.Group; update(time: number): void; count: number}

export function dawnPalms(spots: readonly PalmSpot[], height: (x: number, z: number) => number): DawnPalms {
  const group = new THREE.Group(); group.name = 'goldsand-date-palms';
  const trunks: THREE.BufferGeometry[] = [], fronds: THREE.BufferGeometry[] = [], dates: THREE.BufferGeometry[] = [];
  const time = {value: 0};
  const up = new THREE.Vector3(0, 1, 0);
  for (const s of spots) {
    const R = rng(s.seed * 131 + 7), y0 = height(s.x, s.z) - .3;
    const dir = new THREE.Vector3(Math.cos(s.dir), 0, Math.sin(s.dir));
    // Trunk path: lean out, then curve back a little toward the vertical.
    const pts: THREE.Vector3[] = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N, off = s.lean * s.h * (t * t * .9 + Math.sin(t * Math.PI) * .12);
      pts.push(new THREE.Vector3(s.x, y0 + t * s.h, s.z).addScaledVector(dir, off));
    }
    const curve = new THREE.CatmullRomCurve3(pts), seg = 48, radial = 14, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const frames = curve.computeFrenetFrames(seg, false);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, c = curve.getPointAt(t), n = frames.normals[i], b = frames.binormals[i];
      const yUp = t * s.h, ridge = 1 + .025 * Math.sin(yUp * 1.7) * Math.sin(yUp * .63);
      const r = (.24 - .08 * t + .12 * Math.exp(-t * 18)) * ridge;
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
        pos.push(c.x + (n.x * cx + b.x * cy) * r, c.y + (n.y * cx + b.y * cy) * r, c.z + (n.z * cx + b.z * cy) * r);
        uv.push(j / radial, yUp);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setIndex(idx); tg.computeVertexNormals();
    trunks.push(tg.toNonIndexed()); tg.dispose();
    const top = curve.getPointAt(1);
    // Fronds: live ones arch out and down, a few young ones stand up, dry ones hang under the crown.
    const nf = 16 + Math.floor(R() * 5);
    for (let k = 0; k < nf + 6; k++) {
      const dry = k >= nf, young = !dry && k < 3;
      const az = k * 2.39996 + R() * .3, len = dry ? 1.8 + R() * .5 : young ? 2.0 + R() * .4 : 2.6 + R() * .9;
      const rise = dry ? -1.25 - R() * .2 : young ? .9 + R() * .3 : .35 - R() * .55, droop = dry ? .1 : young ? .25 : .9 + R() * .4;
      const fd = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const M = 18, fp: number[] = [], fu: number[] = [], fi: number[] = [], tip: number[] = [], col: number[] = [];
      const green = dry ? new THREE.Color('#7a5f36') : new THREE.Color('#4f7a3a').offsetHSL((R() - .5) * .03, 0, (R() - .5) * .06);
      for (let i = 0; i <= M; i++) {
        const t = i / M, along = t * len;
        // The rachis: out along fd, up by the rise angle, falling away toward the tip.
        const c = top.clone().addScaledVector(fd, Math.cos(rise) * along).addScaledVector(up, Math.sin(rise) * along - droop * t * t * len * .45);
        const side = new THREE.Vector3().crossVectors(up, fd).normalize(), w = .55 * (1 - t * .3);
        for (const sgn of [-1, 0, 1]) {
          // Folded into a shallow V along the rachis.
          const p = c.clone().addScaledVector(side, sgn * w).addScaledVector(up, Math.abs(sgn) * .12 * (1 - t));
          fp.push(p.x, p.y, p.z); fu.push(sgn, t); tip.push(t * t); col.push(green.r, green.g, green.b);
        }
      }
      for (let i = 0; i < M; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; fi.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
      g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(fi); g.computeVertexNormals(); fronds.push(g.toNonIndexed()); g.dispose();
    }
    // Dates: two or three hanging clusters of small fruit under the crown.
    const date = new THREE.SphereGeometry(.045, 6, 4);
    for (let c = 0; c < 2 + Math.floor(R() * 2); c++) {
      const az = R() * Math.PI * 2, base = top.clone().add(new THREE.Vector3(Math.cos(az) * .3, -.35, Math.sin(az) * .3));
      for (let k = 0; k < 26; k++) {
        const p = base.clone().add(new THREE.Vector3((R() - .5) * .3, -R() * .55, (R() - .5) * .3));
        const g = date.clone().scale(1, 1.35, 1).translate(p.x, p.y, p.z);
        g.deleteAttribute('uv'); dates.push(g.toNonIndexed()); g.dispose();
      }
    }
    date.dispose();
  }
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; group.add(m);
  };
  mk(trunks, trunkMaterial(), 'goldsand-palm-trunks');
  mk(fronds, frondMaterial(time), 'goldsand-palm-fronds');
  mk(dates, new THREE.MeshStandardMaterial({name: 'goldsand-dates', color: '#8a4a1c', roughness: .45}), 'goldsand-palm-dates');
  return {group, count: spots.length, update(t) { time.value = t; }};
}
