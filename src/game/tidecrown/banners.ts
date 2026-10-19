// Tidecrown's colours on its walls: sea-blue banners with a gold border and the crab crest, hung on every wall and
// ward tower (facing out) and either side of the Pincer Gate. One instanced draw for the cloth, one for the rods;
// the cloth sways from its rod in the shared wind.
import * as THREE from 'three';
import { addPatch, WORLD_UNIFORMS } from '../../world/materials';
import { TC_KEEP, type TcPlacement, TC_PIECES } from './layout';

/** The crest, painted once: blue field, gold border and fringe, a gold crab with raised claws. */
function crestTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d')!;
  const blue = g.createLinearGradient(0, 0, 0, 320);
  blue.addColorStop(0, '#2b4f9e');
  blue.addColorStop(1, '#1d3a7a');
  g.fillStyle = blue;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 280); g.lineTo(64, 318); g.lineTo(0, 280); g.closePath();
  g.fill();
  g.strokeStyle = '#d8b25a';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(8, 6); g.lineTo(120, 6); g.lineTo(120, 276); g.lineTo(64, 308); g.lineTo(8, 276); g.closePath();
  g.stroke();
  // Crab: shell, eyes, six legs and two raised claws.
  g.fillStyle = '#e2bd62';
  g.save();
  g.translate(64, 150);
  g.beginPath(); g.ellipse(0, 10, 26, 18, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#e2bd62'; g.lineCap = 'round';
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(s * 18, 14 + i * 5); g.lineTo(s * 36, 22 + i * 9); g.lineTo(s * 40, 40 + i * 6); g.stroke(); }
    g.beginPath(); g.moveTo(s * 16, 0); g.quadraticCurveTo(s * 34, -14, s * 30, -36); g.stroke();
    g.beginPath(); g.ellipse(s * 28, -44, 9, 13, s * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d3a7a'; g.beginPath(); g.moveTo(s * 28, -58); g.lineTo(s * 24, -42); g.lineTo(s * 33, -46); g.closePath(); g.fill(); g.fillStyle = '#e2bd62';
    g.beginPath(); g.arc(s * 8, -10, 3.5, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.tidecrown = true;
  return t;
}

export function buildBanners(placements: TcPlacement[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tc-banners';
  const W = 3.4, H = 8;
  const cloth = new THREE.PlaneGeometry(W, H, 2, 10).translate(0, -H / 2, 0);
  const mat = new THREE.MeshStandardMaterial({ name: 'tc-banner', map: crestTexture(), side: THREE.DoubleSide, roughness: 0.82, alphaTest: 0.5, transparent: false });
  // Hanging cloth: the lower it hangs below the rod the more it swings, with a ripple across.
  addPatch(mat, 'tc-banner', (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 o = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float hang = clamp(-position.y / ${H.toFixed(1)}, 0.0, 1.0), ph = dot(o.xz, vec2(0.13, 0.07));
        transformed.z += hang * (0.55 * sin(uTime * 1.3 + ph) + 0.25 * sin(uTime * 3.1 + position.y * 0.8 + ph));
        transformed.x += hang * hang * 0.25 * sin(uTime * 0.9 + ph * 1.7);
      }`,
    );
  });
  const rodMat = new THREE.MeshStandardMaterial({ name: 'tc-banner-rod', color: '#c9a24a', metalness: 0.85, roughness: 0.35 });
  const rod = new THREE.CylinderGeometry(0.16, 0.16, W + 0.8, 6).rotateZ(Math.PI / 2);
  const spots: THREE.Matrix4[] = [];
  const hang = (x: number, y: number, z: number, yaw: number) => spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
  const cx = 40, cz = -20;
  for (const p of placements) {
    if (p.piece === 'TC_CityTower' || p.piece === 'TC_WardTower') {
      const ward = p.piece === 'TC_WardTower', ox = ward ? TC_KEEP.x : cx, oz = ward ? TC_KEEP.z : cz;
      const dx = p.x - ox, dz = p.z - oz, l = Math.hypot(dx, dz) || 1, r = (ward ? TC_PIECES.wardTower.r : TC_PIECES.cityTower.r) + 0.3;
      const top = p.y + (ward ? 47 : 26) * p.sy;
      hang(p.x + (dx / l) * r, top, p.z + (dz / l) * r, Math.atan2(dx, dz));
    } else if (p.piece === 'TC_PincerGate') {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const lx of [-13, 13]) {
        const lz = TC_PIECES.pincerGate.d / 2 + 0.4;
        hang(p.x + c * lx + s * lz, p.y + 20, p.z - s * lx + c * lz, p.yaw);
      }
    }
  }
  const banners = new THREE.InstancedMesh(cloth, mat, spots.length), rods = new THREE.InstancedMesh(rod, rodMat, spots.length);
  spots.forEach((m, i) => { banners.setMatrixAt(i, m); rods.setMatrixAt(i, m); });
  banners.castShadow = true;
  rods.castShadow = false;
  banners.computeBoundingSphere();
  rods.computeBoundingSphere();
  banners.name = 'tc-banner-cloth';
  rods.name = 'tc-banner-rods';
  group.add(banners, rods);
  return group;
}
