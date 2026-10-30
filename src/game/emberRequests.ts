import * as THREE from 'three';
import type {RequestLook,RequestSite,RequestState} from './dawnRequests';

/*
 * Emberreach's quest props (World V only; World VI keeps the shared shapes). The guide lanterns are basalt waystones:
 * a hexagonal column like the island's own basalt on a stepped dressed plinth, a brass-rimmed fire bowl on top and a
 * fire glyph cut into the face toward the road. The glyph smoulders while nobody needs the stone, pulses amber while
 * its quest waits, and once lit the bowl burns and the glyph glows steady. Same sites, same anchor height (the hold-F
 * channel aims 2.2 m up) as the shared lamp. The other kinds keep the shared marker shapes, shown only while their
 * quest waits, as DawnRequests draws them.
 */

const PALETTE: Record<string, string> = {crate: '#dca86c', herb: '#7de9a0', ore: '#ff935c', pearl: '#a6ecff', seal: '#d7bbff', visit: '#fff1bd'};

/** The fire glyph: a flame in a ring with three strokes under it, white on black (used as additive light). */
function glyphTexture() {
 const c = document.createElement('canvas'); c.width = c.height = 128;
 const g = c.getContext('2d')!;
 g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
 g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
 g.lineWidth = 7; g.beginPath(); g.arc(64, 54, 34, 0, Math.PI * 2); g.stroke();
 g.beginPath(); g.moveTo(64, 26); g.quadraticCurveTo(84, 50, 76, 66); g.quadraticCurveTo(70, 78, 64, 78); g.quadraticCurveTo(52, 78, 50, 64);
 g.quadraticCurveTo(50, 54, 58, 46); g.quadraticCurveTo(58, 56, 64, 58); g.quadraticCurveTo(62, 42, 64, 26); g.fill();
 g.lineWidth = 6; for (const [x0, x1, y] of [[40, 88, 100], [48, 80, 112], [58, 70, 122]]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
 const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
 return t;
}

/** The waystone's stone and brass in one geometry (vertex colours), standing at the origin, glyph face toward +z. */
function waystoneGeometry() {
 const parts: THREE.BufferGeometry[] = [];
 const add = (g: THREE.BufferGeometry, hex: string, m: THREE.Matrix4) => {
  const s = g.index ? g.toNonIndexed() : g; s.applyMatrix4(m); s.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = s.getAttribute('position').count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  s.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(s);
 };
 const M = (x = 0, y = 0, z = 0, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
 // Stepped plinth of dressed basalt, sunk a little into the ash, and loose blocks at its foot.
 add(new THREE.CylinderGeometry(.82, .9, .32, 6), '#2b2d34', M(0, .06, 0, Math.PI / 6));
 add(new THREE.CylinderGeometry(.6, .66, .26, 6), '#34363d', M(0, .34, 0));
 for (const [a, r, s] of [[.6, 1.05, .22], [2.4, 1.1, .17], [4.3, 1.0, .2]]) add(new THREE.CylinderGeometry(s, s * 1.1, s * 1.3, 6), '#2a2b31', new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, s * .35, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(.5 * Math.sin(a * 3), a, .4 * Math.cos(a * 2))), new THREE.Vector3(1, 1, 1)));
 // The column: slightly tapered, a face (flat side) toward +z for the glyph; cut bands below the glyph and at the top.
 add(new THREE.CylinderGeometry(.3, .37, 1.62, 6, 4), '#1e1d22', M(0, 1.28, 0, Math.PI / 6));
 add(new THREE.CylinderGeometry(.36, .37, .08, 6), '#3f4048', M(0, .86, 0, Math.PI / 6));
 add(new THREE.CylinderGeometry(.34, .32, .1, 6), '#3f4048', M(0, 2.06, 0, Math.PI / 6));
 // Fire bowl: brass rim on a squat iron bowl.
 add(new THREE.LatheGeometry([[.08, 0], [.3, .05], [.42, .2], [.44, .26], [.38, .26], [.26, .12], [0, .1]].map(([r, y]) => new THREE.Vector2(r, y)), 12), '#26252a', M(0, 2.1, 0));
 add(new THREE.TorusGeometry(.42, .035, 5, 18).rotateX(Math.PI / 2), '#c8923c', M(0, 2.36, 0));
 const g = mergeAll(parts), P = g.getAttribute('position'), C = g.getAttribute('color');
 // Hewn, not turned: each corner nudged a few centimetres (brass and bowl excepted), then ash on the up faces.
 const h = (x: number, y: number, z: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v) - .5; };
 for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (y > 2.09) continue; const k = .035; P.setXYZ(i, x + h(x, y, z) * k, y + h(y, z, x) * k * .6, z + h(z, x, y) * k); }
 g.computeVertexNormals();
 const N = g.getAttribute('normal'), ash = new THREE.Color('#77727a');
 for (let i = 0; i < P.count; i++) { if (P.getY(i) > 2.09) continue; const up = Math.max(0, N.getY(i)); if (up > .7) { const t = (up - .7) / .3 * .7; C.setXYZ(i, C.getX(i) + (ash.r - C.getX(i)) * t, C.getY(i) + (ash.g - C.getY(i)) * t, C.getZ(i) + (ash.b - C.getZ(i)) * t); } }
 return g;
}
function mergeAll(list: THREE.BufferGeometry[]) {
 let n = 0; for (const g of list) n += g.getAttribute('position').count;
 const p = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0;
 for (const g of list) { p.set(g.getAttribute('position').array as Float32Array, o * 3); c.set(g.getAttribute('color').array as Float32Array, o * 3); o += g.getAttribute('position').count; g.dispose(); }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
 return g;
}

export function emberRequestLook(height: (x: number, z: number) => number): RequestLook {
 type Node = {style: string; glyph?: THREE.MeshBasicMaterial; coals?: THREE.MeshBasicMaterial; flame?: THREE.Mesh; mesh?: THREE.Mesh; ring?: THREE.Mesh; base: THREE.Vector3; phase: number};
 const nodes: Node[] = [];
 return {
  build(root: THREE.Group, sites: readonly RequestSite[]) {
   const stoneGeo = waystoneGeometry(), stoneMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .92, metalness: 0, flatShading: true, envMapIntensity: .55});
   stoneMat.name = 'ember-waystone';
   const glyphTex = glyphTexture(), glyphGeo = new THREE.PlaneGeometry(.48, .48);
   const coalGeo = new THREE.CircleGeometry(.34, 12).rotateX(-Math.PI / 2);
   const flameGeo = new THREE.ConeGeometry(.24, .7, 7, 1, true).translate(0, .35, 0);
   const support = new THREE.MeshStandardMaterial({color: '#4c514e', roughness: .85});
   const geos: Record<string, THREE.BufferGeometry> = {crate: new THREE.BoxGeometry(1.3, 1.1, 1.3), herb: new THREE.IcosahedronGeometry(.55, 0), ore: new THREE.DodecahedronGeometry(.7, 0), pearl: new THREE.SphereGeometry(.55, 12, 8), seal: new THREE.TorusGeometry(.6, .16, 6, 18), visit: new THREE.OctahedronGeometry(.55)};
   return sites.map((s, i) => {
    const p = s.position;
    if (s.style === 'lamp') {
     // Face the glyph toward the avenue (x = 0), where the player comes from.
     const grp = new THREE.Group(); grp.position.copy(p); grp.position.y = height(p.x, p.z) - .08; grp.rotation.y = Math.abs(p.x) < .5 ? 0 : Math.atan2(-Math.sign(p.x), 0);
     grp.name = `ember-waystone-${i}`;
     const stone = new THREE.Mesh(stoneGeo, stoneMat); stone.castShadow = stone.receiveShadow = true; grp.add(stone);
     const glyph = new THREE.MeshBasicMaterial({map: glyphTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, color: '#ff6a24', polygonOffset: true, polygonOffsetFactor: -2});
     const gm = new THREE.Mesh(glyphGeo, glyph); // On the face: the column's apothem at the glyph's height (radius .3 at the top, .37 at the foot), a hair proud.
     gm.position.set(0, 1.42, (.3 + .07 * (2.09 - 1.42) / 1.62) * Math.cos(Math.PI / 6) + .02); grp.add(gm);
     const coals = new THREE.MeshBasicMaterial({color: '#ff5a14'});
     const cm = new THREE.Mesh(coalGeo, coals); cm.position.y = 2.27; grp.add(cm);
     const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({color: '#ff9a3a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: .85}));
     flame.position.y = 2.28; flame.visible = false; grp.add(flame);
     root.add(grp);
     nodes.push({style: 'lamp', glyph, coals, flame, base: p.clone(), phase: i * 1.7});
     const anchor = new THREE.Object3D(); anchor.position.set(p.x, p.y + 2.2, p.z); root.add(anchor);
     return anchor;
    }
    // Other kinds: the shared marker shapes (DawnRequests' placeholders), shown while their quest waits.
    const color = PALETTE[s.style] ?? '#ffffff';
    const material = new THREE.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .2, roughness: .45, metalness: .2});
    const mesh = new THREE.Mesh(geos[s.style] ?? geos.visit, material); mesh.position.copy(p).y += 1; mesh.castShadow = true; mesh.name = s.kind; root.add(mesh);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s.style === 'visit' ? 2.3 : .95, .045, 4, 32), new THREE.MeshBasicMaterial({color, transparent: true, opacity: .5, depthWrite: false}));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(p).y += .18; root.add(ring);
    if (s.style === 'herb') for (let k = 0; k < 3; k++) { const leaf = new THREE.Mesh(new THREE.ConeGeometry(.2, .8, 5), material); leaf.position.set(Math.sin(k * 2.1) * .4, -.55, Math.cos(k * 2.1) * .4); leaf.rotation.z = .5; mesh.add(leaf); }
    else if (s.style === 'crate') mesh.add(new THREE.Mesh(new THREE.BoxGeometry(1.37, .16, 1.37), support));
    nodes.push({style: s.style, mesh, ring, base: p.clone(), phase: 0});
    return mesh;
   });
  },
  update(time: number, states: readonly RequestState[]) {
   nodes.forEach((n, i) => {
    const st = states[i]; if (!st) return;
    if (n.style === 'lamp') {
     const lit = st.done, k = lit ? 2.4 + .25 * Math.sin(time * 5.3 + n.phase) : st.pending ? 1.1 + .7 * (Math.sin(time * 2.2 + n.phase) * .5 + .5) : 1.15 + .15 * Math.sin(time * .9 + n.phase);
     n.glyph!.color.setRGB(1 * k, .42 * k, .14 * k);
     const c = lit ? 2.4 : st.pending ? 1.4 : 1.0; n.coals!.color.setRGB(c, c * .36, c * .09);
     n.flame!.visible = lit; if (lit) { const f = 1 + .18 * Math.sin(time * 9 + n.phase) + .1 * Math.sin(time * 23 + n.phase); n.flame!.scale.set(1 / f ** .5, f, 1 / f ** .5); n.flame!.rotation.y = time * .7; }
     return;
    }
    const mesh = n.mesh!, mat = mesh.material as THREE.MeshStandardMaterial;
    mesh.visible = st.pending; n.ring!.visible = st.pending;
    mat.emissiveIntensity = st.pending ? .5 + Math.sin(time * 2) * .2 : .05;
    mesh.rotation.y = time * .4; mesh.position.y = n.base.y + 1 + Math.sin(time * 2 + n.base.x) * .12;
   });
  },
 };
}
