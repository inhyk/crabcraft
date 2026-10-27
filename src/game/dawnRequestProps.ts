import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {rng} from '../world/noise';
import type {RequestLook, RequestSite, RequestState} from './dawnRequests';
import {dawnBrass, dawnLanternGlass, dawnSandstone, dawnWood, solidPart, woodPart} from './dawnMaterials';
import {lampParts} from './dawnLamps';
import {boulderGeometry} from './snowRocks';

/*
 * Dawnharbor's request props (the shared placeholders' finished replacements): cargo crates of nailed boards, desert
 * agaves for the herb-gatherer, basalt split by veins of gold ore, giant clams holding a pearl on the shore, the
 * citadel's seals as sandstone stelae with a gilded sun, cairns at the lookouts, and three of the town's own road
 * lamps standing dark until the request lights them. While a request is open a soft gold ring breathes at the foot
 * of its prop; what is gathered is gone once done, a broken seal's sun goes dark.
 */

const RING_VERT = 'varying vec2 vR;void main(){vR=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const RING_FRAG = /* glsl */ `uniform float uTime;uniform float uR;varying vec2 vR;void main(){float r=length(vR)/uR;
  float band=exp(-pow((r-.82)/.07,2.))+exp(-pow(r/.55,2.))*.12,pulse=.7+.3*sin(uTime*2.4);
  float a=band*pulse*(1.-smoothstep(.95,1.,r));if(a<.005)discard;gl_FragColor=vec4(vec3(1.,.78,.36)*a,1.);}`;

export function dawnRequestLook(): RequestLook {
  const items: {style: string; group: THREE.Group; ring: THREE.Mesh; glass?: THREE.MeshStandardMaterial; halo?: THREE.Mesh; sigil?: THREE.MeshStandardMaterial}[] = [];
  const ringMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {uTime: {value: 0}, uR: {value: 1}}, vertexShader: RING_VERT, fragmentShader: RING_FRAG});
  const stoneMat = dawnSandstone('dawnharbor-request-stone'), woodMat = dawnWood('dawnharbor-request-wood'), ironMat = dawnBrass('goldsand-request-brass');
  const agaveMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-agave', color: '#ffffff', vertexColors: true, roughness: .75, side: THREE.DoubleSide});
  const basaltMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-ore-rock', color: '#2a2724', roughness: .85, vertexColors: true});
  const goldMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-ore-gold', color: '#f0c050', metalness: .9, roughness: .25, emissive: '#c07018', emissiveIntensity: .9});
  const shellMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-clam', color: '#e6d7c4', roughness: .55, vertexColors: true, side: THREE.DoubleSide});
  const pearlMat = new THREE.MeshStandardMaterial({name: 'dawnharbor-pearl', color: '#fff4ea', roughness: .12, metalness: .2, emissive: '#ffd9c8', emissiveIntensity: .7});
  const mesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string) => { const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = m.receiveShadow = true; return m; };
  const M = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));

  const crate = (g: THREE.Group, R: () => number) => {
    const w: THREE.BufferGeometry[] = [], b = new THREE.BoxGeometry(1, 1, 1);
    const S = .86, n = 4, bw = S / n;
    // Boards on four sides and the lid, corner battens and a rope sling.
    for (let f = 0; f < 4; f++) for (let k = 0; k < n; k++) {
      const yaw = f * Math.PI / 2, off = -S / 2 + bw * (k + .5);
      const [x, z] = [Math.sin(yaw) * S / 2, Math.cos(yaw) * S / 2];
      w.push(woodPart(b, M(x, off + S / 2 + .02, z, yaw, S - .02, bw - .012, .04), k === 1 && f === 0 ? '#2f6f73' : null, .7));
    }
    for (let k = 0; k < n; k++) w.push(woodPart(b, M(0, S + .03, -S / 2 + bw * (k + .5), 0, S, .04, bw - .012), null, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) w.push(woodPart(b, M(sx * (S / 2 + .01), S / 2 + .02, sz * (S / 2 + .01), 0, .09, S + .04, .09), null, 0, new THREE.Vector3(0, 1, 0)));
    g.add(mesh(w, woodMat, 'dawn-request-crate'));
    b.dispose(); void R;
  };
  const agave = (g: THREE.Group, R: () => number) => {
    const leaves: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 16; k++) {
      const a = k * 2.39996, tilt = .35 + (k / 16) * .9, len = 1.45 - (k / 16) * .5 + R() * .2;
      const blade = new THREE.PlaneGeometry(.24, len, 1, 6), p = blade.getAttribute('position') as THREE.BufferAttribute, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const v = (p.getY(i) + len / 2) / len, x = p.getX(i) * (1 - v * .92);
        // Curl the blade outward and fold it along its midrib.
        p.setXYZ(i, x, v * len, -Math.abs(x) * .5 + v * v * .25);
        const tip = v > .85 ? 1 : 0;
        c.set(tip ? [.42, .25, .1] : [.22 + .12 * v, .4 + .08 * v, .26], i * 3);
      }
      blade.setAttribute('color', new THREE.BufferAttribute(c, 3)); blade.deleteAttribute('uv'); blade.computeVertexNormals();
      leaves.push(blade.applyMatrix4(M(0, .02, 0, a, 1, 1, 1, tilt)));
    }
    g.add(mesh(leaves.map(l => l.index ? l.toNonIndexed() : l), agaveMat, 'dawn-request-agave'));
  };
  const ore = (g: THREE.Group, R: () => number) => {
    const rock = boulderGeometry({r: .65, h: .5, seed: Math.floor(R() * 1e4)}, 7, 1.6);
    const n = rock.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([.9, .9, .9], i * 3);
    rock.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.add(mesh([rock], basaltMat, 'dawn-request-ore-rock'));
    const xs: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const a = R() * Math.PI * 2, d = .15 + R() * .3, h = .18 + R() * .25;
      const cr = new THREE.CylinderGeometry(0, .05 + R() * .03, h, 6, 1).translate(0, h / 2, 0);
      xs.push(solidPart(cr, M(Math.cos(a) * d, .25 + R() * .25, Math.sin(a) * d, R() * 6, 1, 1, 1, (R() - .5) * 1.1, (R() - .5) * 1.1))); cr.dispose();
    }
    g.add(mesh(xs, goldMat, 'dawn-request-ore-gold'));
  };
  const clam = (g: THREE.Group, R: () => number) => {
    const half = (open: number) => {
      const s = new THREE.SphereGeometry(.55, 24, 8, 0, Math.PI, 0, Math.PI / 2), p = s.getAttribute('position') as THREE.BufferAttribute, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ang = Math.atan2(z, x), rib = 1 + .06 * Math.pow(Math.abs(Math.sin(ang * 6)), .6) * (1 - y / .55);
        p.setXYZ(i, x * rib, y * .45, z * rib);
        const band = .5 + .5 * Math.sin(Math.hypot(x, z) * 30);
        c.set([.88 - .12 * band, .8 - .14 * band, .72 - .14 * band], i * 3);
      }
      s.setAttribute('color', new THREE.BufferAttribute(c, 3)); s.deleteAttribute('uv'); s.computeVertexNormals();
      return s.toNonIndexed().applyMatrix4(M(0, .02, 0, 0, 1, 1, 1, 0, 0)).applyMatrix4(new THREE.Matrix4().makeRotationX(open));
    };
    const lower = half(Math.PI).applyMatrix4(M(0, .26, 0));
    const upper = half(-.95).applyMatrix4(M(0, .27, 0));
    g.add(mesh([lower, upper], shellMat, 'dawn-request-clam'));
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(.12, 20, 14), pearlMat); pearl.position.set(0, .3, .12); g.add(pearl);
    void R;
  };
  const stele = (g: THREE.Group, items0: {sigil?: THREE.MeshStandardMaterial}) => {
    const sh = new THREE.Shape(); sh.moveTo(-.45, 0); sh.lineTo(.45, 0); sh.lineTo(.45, 1.35); sh.absarc(0, 1.35, .45, 0, Math.PI, false); sh.closePath();
    const slab = new THREE.ExtrudeGeometry(sh, {depth: .22, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2, curveSegments: 12}).translate(0, .3, -.11);
    const plinth = lathe([[0, 0], [.75, 0], [.75, .14], [.66, .2], [.62, .3], [0, .3]], 6).rotateY(Math.PI / 4).scale(1, 1, .6);
    g.add(mesh([solidPart(slab, new THREE.Matrix4()), solidPart(plinth, new THREE.Matrix4())], stoneMat, 'dawn-request-stele'));
    slab.dispose(); plinth.dispose();
    const sigil = new THREE.MeshStandardMaterial({name: 'dawnharbor-seal-sun', color: '#e8b24a', metalness: .85, roughness: .3, emissive: '#ff9a3c', emissiveIntensity: 1.6});
    const parts: THREE.BufferGeometry[] = [];
    for (const face of [-1, 1]) {
      const disc = new THREE.CylinderGeometry(.16, .16, .03, 24).rotateX(Math.PI / 2);
      parts.push(solidPart(disc, M(0, 1.35, face * .145))); disc.dispose();
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, len = k % 2 ? .1 : .17, ray = new THREE.BoxGeometry(.035, len, .025); parts.push(solidPart(ray, M(Math.cos(a) * (.21 + len / 2), 1.35 + Math.sin(a) * (.21 + len / 2), face * .145, 0, 1, 1, 1, 0, a - Math.PI / 2))); ray.dispose(); }
    }
    g.add(mesh(parts, sigil, 'dawn-request-seal-sun'));
    items0.sigil = sigil;
  };
  const cairn = (g: THREE.Group, R: () => number) => {
    const stones: THREE.BufferGeometry[] = [];
    let y = 0;
    for (let k = 0; k < 5; k++) {
      const r = .55 - k * .09, h = .22 - k * .02, s = boulderGeometry({r, h, seed: Math.floor(R() * 1e4)}, 5, 1.5);
      s.deleteAttribute('color'); stones.push(s.toNonIndexed().applyMatrix4(M((R() - .5) * .06, y + h * .9, (R() - .5) * .06, R() * 6))); y += h * 1.5;
    }
    g.add(mesh(stones, stoneMat, 'dawn-request-cairn'));
  };

  return {
    build(root: THREE.Group, sites: readonly RequestSite[]) {
      const anchors: THREE.Object3D[] = [];
      sites.forEach((site, i) => {
        const R = rng(7001 + i * 31), g = new THREE.Group(), p = site.position;
        g.name = `dawn-request-${site.kind}`; g.position.copy(p); g.rotation.y = R() * Math.PI * 2; root.add(g);
        const item: (typeof items)[number] = {style: site.style, group: g, ring: null!};
        const anchor = new THREE.Object3D(); anchor.position.set(0, 1, 0);
        if (site.style === 'lamp') {
          // A town lamp, set facing the avenue, dark until lit.
          g.rotation.y = 0;
          const yaw = p.x < 0 ? Math.PI / 2 : -Math.PI / 2;
          const parts = lampParts(() => 0, [{x: 0, z: 0, yaw, y: null}]);
          g.add(mesh(parts.stone, stoneMat, 'dawn-request-lamp-foot'), mesh(parts.iron, ironMat, 'dawn-request-lamp-iron'));
          const glass = dawnLanternGlass(); glass.emissiveIntensity = .05;
          const pane = mesh(parts.panes, glass, 'dawn-request-lamp-glass'); pane.castShadow = false; g.add(pane);
          item.glass = glass; anchor.position.copy(parts.flames[0]);
          const halo = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 8), new THREE.MeshBasicMaterial({color: '#ffb35a', transparent: true, opacity: .14, depthWrite: false, blending: THREE.AdditiveBlending}));
          halo.position.copy(parts.flames[0]); halo.visible = false; g.add(halo); item.halo = halo;
        } else if (site.style === 'crate') crate(g, R);
        else if (site.style === 'herb') agave(g, R);
        else if (site.style === 'ore') ore(g, R);
        else if (site.style === 'pearl') clam(g, R);
        else if (site.style === 'seal') { stele(g, item); anchor.position.set(0, 1.35, 0); }
        else cairn(g, R);
        g.add(anchor); anchors.push(anchor);
        const r = site.style === 'visit' ? 2.3 : 1.15, ring = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), ringMat.clone());
        (ring.material as THREE.ShaderMaterial).uniforms.uR.value = r; ring.position.y = .08; ring.renderOrder = 3; ring.visible = false; g.add(ring);
        item.ring = ring; items.push(item);
      });
      return anchors;
    },
    update(time: number, states: readonly RequestState[]) {
      items.forEach((it, i) => {
        const s = states[i]; if (!s) return;
        it.ring.visible = s.pending;
        if (s.pending) (it.ring.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
        if (it.glass) { it.glass.emissiveIntensity = s.done ? 2.4 : s.pending ? .25 + .2 * Math.sin(time * 2.4) : .05; it.halo!.visible = s.done; }
        else if (it.sigil) it.sigil.emissiveIntensity = s.done ? 0 : s.pending ? 1.6 + .6 * Math.sin(time * 2) : .8;
        else if (it.style !== 'visit') it.group.visible = !s.done;
      });
    },
  };
}
