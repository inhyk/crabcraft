// The arch over the forest road just before Tidecrown's return line (TC_RETURN_LINE), the counterpart of World I's
// King's Gate: two limestone pillars with pinnacles, a round arch of voussoirs under a coping and a crown, the
// kingdom's banners on the pillars, a street lamp either side, and a gilded plaque each way (Clawhaven on the face the
// arrival looks back at). Its frame and colliders are in layout.ts (returnArchFrame, registerReturnArch).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeAll } from '../../world/fountain';
import { type Kit, Scatter, trs } from '../../world/kit';
import { crestTexture } from './banners';
import { returnArchFrame } from './layout';
import type { TidecrownMaterials } from './materials';
import { worldUV } from './structures';

const worldBox = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

type Height = (x: number, z: number) => number;
/** Plaque lettering, gilded on sea blue: Korean above, English below, an arrow toward the place. */
function plaqueTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const row = (y: number, ko: string, en: string, arrow: boolean) => {
    g.save();
    g.translate(0, y);
    const bg = g.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, '#2b4f9e');
    bg.addColorStop(1, '#1d3a7a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 10;
    g.strokeRect(14, 14, 996, 228);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const text = (s: string, font: string, yy: number) => {
      g.font = font;
      g.fillStyle = 'rgba(8,14,40,0.8)';
      g.fillText(s, 512 + 3, yy + 4);
      g.fillStyle = '#f3d08a';
      g.fillText(s, 512, yy);
    };
    text(ko, '800 104px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif', 96);
    text(en, '700 58px Cinzel, "Trajan Pro", Georgia, serif', 190);
    if (arrow) {
      // Down the road: an arrow each side of the name.
      g.fillStyle = '#f3d08a';
      for (const ax of [96, 928]) {
        g.beginPath();
        g.moveTo(ax, 176);
        g.lineTo(ax - 40, 104);
        g.lineTo(ax + 40, 104);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  };
  row(0, '클로헤이븐', 'CLAWHAVEN', true);
  row(256, '타이드크라운', 'TIDECROWN', false);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.tidecrown = true;
  return t;
}

export function buildReturnArch(cityKit: Kit, mats: TidecrownMaterials, lampMaterial: (m: THREE.Material) => THREE.Material, h: Height): { group: THREE.Group; lampHeads: THREE.Vector3[] } {
  const group = new THREE.Group();
  group.name = 'tc-return-arch';
  const f = returnArchFrame(), y0 = h(f.x, f.z);
  const light: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], slate: THREE.BufferGeometry[] = [];
  const P = (lx: number, ly: number, lz: number) => [f.x + f.ux * lx + f.vx * lz, y0 + ly, f.z + f.uz * lx + f.vz * lz] as const;
  const put = (list: THREE.BufferGeometry[], geo: THREE.BufferGeometry, lx: number, ly: number, lz: number, rz = 0) => {
    const [x, y, z] = P(lx, ly, lz);
    list.push(geo.rotateZ(rz).rotateY(f.yaw).translate(x, y, z));
  };
  const pillarTop = 7.2;
  for (const k of [-1, 1]) {
    const lx = f.half * k, [px, pz] = f.pillars[(k + 1) / 2], foot = Math.min(h(px, pz), y0) - 1.4;
    put(dark, worldBox(2.7, y0 - foot + 1.0, 2.7), lx, (foot - y0 + 1.0) / 2, 0);
    put(light, worldBox(2.2, pillarTop - 1.0, 2.2), lx, 1.0 + (pillarTop - 1.0) / 2, 0);
    put(dark, worldBox(2.75, 0.5, 2.75), lx, pillarTop + 0.25, 0);
    put(light, worldBox(1.25, 1.3, 1.25), lx, pillarTop + 1.15, 0);
    put(slate, new THREE.ConeGeometry(1.05, 2.4, 4).rotateY(Math.PI / 4), lx, pillarTop + 3.0, 0);
  }
  const r0 = f.half - 1.1, n = 13;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1 - (i + 0.5) / n), w = (Math.PI * (r0 + 0.55)) / n - 0.06;
    put(i % 2 ? light : dark, worldBox(1.1, w, 1.8), Math.cos(a) * (r0 + 0.55), pillarTop + Math.sin(a) * (r0 + 0.55), 0, a);
  }
  const top = pillarTop + r0 + 1.3;
  for (const k of [-1, 1]) put(light, worldBox(2.3, top - pillarTop - 0.5, 1.5), k * (f.half - 1.45), pillarTop + 0.5 + (top - pillarTop - 0.5) / 2, 0);
  put(dark, worldBox(2 * f.half + 2.6, 0.6, 2.3), 0, top + 0.3, 0);
  put(light, worldBox(2.8, 0.55, 1.1), 0, top + 0.88, 0);
  // World UVs and the kit's vertex colour (the castle's stone reads it).
  const meshOf = (geos: THREE.BufferGeometry[], m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => worldUV(g))), m);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  group.add(meshOf(light, mats.TC_Limestone, 'tc-return-arch-stone'), meshOf(dark, mats.TC_LimestoneDark, 'tc-return-arch-dressings'), meshOf(slate, mats.TC_Slate, 'tc-return-arch-caps'));
  // The crown: three gilded points over the keystone.
  const crown: THREE.BufferGeometry[] = [];
  for (const [lx, hh] of [[-0.95, 1.1], [0, 1.8], [0.95, 1.1]] as [number, number][]) put(crown, new THREE.ConeGeometry(0.4, hh, 4).rotateY(Math.PI / 4), lx, top + 1.15 + hh / 2, 0);
  group.add(meshOf(crown, mats.TC_Gold, 'tc-return-arch-crown'));
  // Plaques on the spandrel, both faces: Clawhaven (and the arrows) toward the arrival, Tidecrown toward the road south.
  const plaque: THREE.BufferGeometry[] = [];
  for (const face of [-1, 1]) {
    const pl = new THREE.PlaneGeometry(5.2, 1.3);
    const uv = pl.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, face < 0 ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
    if (face < 0) pl.rotateY(Math.PI);
    put(plaque, pl, 0, top - 0.75, face * 0.77);
  }
  const plaqueMesh = new THREE.Mesh(mergeAll(plaque), new THREE.MeshStandardMaterial({ name: 'tc-return-plaque', map: plaqueTexture(), roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
  plaqueMesh.name = 'tc-return-plaque';
  plaqueMesh.receiveShadow = true;
  group.add(plaqueMesh);
  // The kingdom's banners on both faces of each pillar.
  const cloth: THREE.BufferGeometry[] = [];
  for (const k of [-1, 1]) for (const face of [-1, 1]) {
    const b = new THREE.PlaneGeometry(1.5, 3.6);
    if (face < 0) b.rotateY(Math.PI);
    put(cloth, b, f.half * k, 4.6, face * 1.14);
  }
  const bannerMesh = new THREE.Mesh(mergeAll(cloth), new THREE.MeshStandardMaterial({ name: 'tc-return-banner', map: crestTexture(), roughness: 0.82, alphaTest: 0.5, side: THREE.DoubleSide }));
  bannerMesh.name = 'tc-return-banners';
  bannerMesh.castShadow = true;
  group.add(bannerMesh);
  // A street lamp either side of the road, north of the pillars.
  const lamps = new Scatter(cityKit, 'tc-return-lamps'), lampHeads: THREE.Vector3[] = [];
  for (const [lx, lz] of f.lamps) {
    lamps.add('TC_Lamp', trs(lx, h(lx, lz) - 0.05, lz, f.yaw));
    lampHeads.push(new THREE.Vector3(lx, h(lx, lz) - 0.05 + 4.45, lz));
  }
  if (cityKit.has('TC_Lamp')) group.add(lamps.build({ materialFor: lampMaterial }));
  return { group, lampHeads };
}
