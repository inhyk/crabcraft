// night-floor: a forest floor laid over the world's flat, single-colour ground for close shots. A ground cover
// that hugs the terrain (soil, moss, leaf litter and pebbles in a procedural tiling texture, with broad colour
// drifts so the tiles never read) and dense fine grass blades that sway in the wind. Static meshes built once;
// the sway is a function of the shot clock.
//
//   night-floor { box: [x0, z0, x1, z1], cell (ground mesh spacing, 0.5), lift (0.012), tile (texture tile, 2.6),
//                 soil, moss, litter, litter2 (colours), drift (broad tint, 0.35), count (blades per square unit,
//                 22), height [min, max] (0.12, 0.34), width (0.022), grass, tip (colours), wind (0.06),
//                 clear [[x, z, r], ...] (no grass: water, whose surface draws over the cover), seed }
import * as THREE from 'three';
import { mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Ground = (x: number, z: number) => number;

/** Periodic value noise on a w x w lattice (tiles seamlessly), fbm of `oct` octaves, 0..1. */
function tileNoise(seed: number, w: number) {
  const r = mulberry(seed);
  const lat = Array.from({ length: 6 }, (_, o) => {
    const n = w << o;
    return { n, v: Float32Array.from({ length: n * n }, () => r()) };
  });
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number, oct = 5): number => {
    let s = 0;
    let a = 0.5;
    let tot = 0;
    for (let o = 0; o < Math.min(oct, lat.length); o++) {
      const { n, v: g } = lat[o];
      const x = (((u % 1) + 1) % 1) * n;
      const y = (((v % 1) + 1) % 1) * n;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = sm(x - xi);
      const fy = sm(y - yi);
      const at = (i: number, j: number) => g[((j + n) % n) * n + ((i + n) % n)];
      const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
      const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
      s += a * (top + (bot - top) * fy);
      tot += a;
      a *= 0.5;
    }
    return s / tot;
  };
}

/** The ground cover's tile: soil, moss in noise patches, scattered leaves and pebbles. */
function floorTexture(cue: FxCue, seed: number): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const soil = new THREE.Color(String(cue.soil ?? '#2a2230'));
  const moss = new THREE.Color(String(cue.moss ?? '#2f4a3c'));
  const dark = soil.clone().multiplyScalar(0.55);
  const n1 = tileNoise(seed, 4);
  const n2 = tileNoise(seed + 7, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const m = Math.min(1, Math.max(0, (n1(u, v, 4) - 0.45) * 4));
      const grit = n2(u, v, 3);
      const col = soil.clone().lerp(moss, m).lerp(dark, Math.max(0, 0.5 - grit) * 0.9);
      const k = 0.82 + 0.36 * grit;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, col.r * 255 * k);
      img.data[i + 1] = Math.min(255, col.g * 255 * k);
      img.data[i + 2] = Math.min(255, col.b * 255 * k);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const r = mulberry(seed + 3);
  const leaf = [String(cue.litter ?? '#4a2a4a'), String(cue.litter2 ?? '#5a3a3a'), '#3a2a20'];
  // Leaves and twigs, wrapped at the edges so the tile stays seamless.
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  for (let i = 0; i < 520; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const l = 4 + r() * 7;
    const col = leaf[Math.floor(r() * leaf.length)];
    const shade = 0.7 + r() * 0.5;
    wrap((ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      g.globalAlpha = 0.85;
      g.fillStyle = new THREE.Color(col).multiplyScalar(shade).getStyle();
      g.beginPath();
      g.ellipse(0, 0, l, l * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(-l, 0);
      g.lineTo(l, 0);
      g.stroke();
      g.restore();
    });
  }
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 1.5 + r() * 3.5;
    const k = 0.35 + r() * 0.3;
    wrap((ox, oy) => {
      const gr = g.createRadialGradient(x + ox - rad * 0.3, y + oy - rad * 0.3, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${170 * k + 40},${160 * k + 40},${185 * k + 40},1)`);
      gr.addColorStop(1, `rgba(${40 * k},${36 * k},${48 * k},1)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** One grass blade, 1 tall: a tapered strip curving forward, base dark to tip light (vertex colours). */
function bladeGeometry(width: number): THREE.BufferGeometry {
  const seg = 4;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const h = i / seg;
    const w = width * (1 - h) ** 0.8;
    const bend = 0.18 * h * h;
    pos.push(-w, h, bend, w, h, bend);
    const k = 0.35 + 0.65 * h;
    col.push(k, k, k, k, k, k);
    nor.push(0, 1, 0.3, 0, 1, 0.3);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

class Floor implements Effect {
  private group = new THREE.Group();
  private uTime = { value: 0 };
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private tex: THREE.Texture;

  constructor(cue: FxCue, scene: THREE.Scene, ground: Ground) {
    const [x0, z0, x1, z1] = (cue.box as number[]) ?? [-5, -5, 5, 5];
    const seed = num(cue.seed, 11);
    const clear = (cue.clear as [number, number, number][]) ?? [];
    const inClear = (x: number, z: number, pad = 0) => clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + pad);
    const lift = num(cue.lift, 0.012);

    // The ground cover: a grid hugging the terrain, just under anything the shot floats on the ground.
    const cell = num(cue.cell, 0.5);
    const nx = Math.max(1, Math.round((x1 - x0) / cell));
    const nz = Math.max(1, Math.round((z1 - z0) / cell));
    const tile = num(cue.tile, 2.6);
    const drift = tileNoise(seed + 21, 2);
    const driftK = num(cue.drift, 0.35);
    const pos: number[] = [];
    const uv: number[] = [];
    const colr: number[] = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = z0 + ((z1 - z0) * j) / nz;
        pos.push(x, ground(x, z) + lift, z);
        uv.push(x / tile, z / tile);
        const d = 1 - driftK + driftK * 2 * drift(x / 40, z / 40, 3);
        colr.push(d, d, d * 1.04);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.tex = floorTexture(cue, seed);
    const floorMat = new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 0.95, metalness: 0 });
    const floor = new THREE.Mesh(geo, floorMat);
    floor.receiveShadow = true;
    floor.name = 'cinema-forest-floor';
    this.group.add(floor);
    this.geos.push(geo);
    this.mats.push(floorMat);

    // The grass: instanced blades scattered over the box.
    const per = num(cue.count, 22);
    const count = Math.round(per * (x1 - x0) * (z1 - z0));
    const [h0, h1] = (cue.height as number[]) ?? [0.12, 0.34];
    const blade = bladeGeometry(num(cue.width, 0.022));
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const uTime = this.uTime;
    const wind = num(cue.wind, 0.06);
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.37 + ip.z * 0.23;
          float hh = position.y * position.y;
          transformed.x += ${wind.toFixed(4)} * hh * (sin(uTime * 1.6 + ph) + 0.45 * sin(uTime * 3.7 + ph * 1.9));
          transformed.z += ${(wind * 0.5).toFixed(4)} * hh * sin(uTime * 2.3 + ph * 1.3);`,
        );
    };
    const grass = new THREE.InstancedMesh(blade, grassMat, count);
    grass.name = 'cinema-forest-blades';
    const r = mulberry(seed + 5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const base = new THREE.Color(String(cue.grass ?? '#24402f'));
    const tip = new THREE.Color(String(cue.tip ?? '#6f8f6a'));
    const clump = tileNoise(seed + 9, 8);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const x = x0 + r() * (x1 - x0);
      const z = z0 + r() * (z1 - z0);
      // Thicker in clumps, thin on bare patches.
      if (r() > 0.25 + 0.95 * clump(x / 18, z / 18, 3) || inClear(x, z, 0.3)) continue;
      const h = h0 + (h1 - h0) * r() ** 1.5;
      p.set(x, ground(x, z), z);
      e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
      q.setFromEuler(e);
      s.set(1, h, h);
      m.compose(p, q, s);
      grass.setMatrixAt(n, m);
      grass.setColorAt(n, base.clone().lerp(tip, r() * 0.6));
      n++;
    }
    grass.count = n;
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.frustumCulled = false;
    this.group.add(grass);
    this.geos.push(blade);
    this.mats.push(grassMat);
    scene.add(this.group);
  }

  update(ctx: FxContext): void {
    this.uTime.value = ctx.t;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}

registerEffect('night-floor', (cue, scene, ground) => new Floor(cue, scene, ground));
