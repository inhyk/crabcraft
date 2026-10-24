// night-floor: a forest floor laid over the world's flat, single-colour ground for close shots. A ground cover
// that hugs the terrain (soil, moss, leaf litter and pebbles in a procedural tiling texture, with broad colour
// drifts so the tiles never read) and dense fine grass blades that sway in the wind. Static meshes built once;
// the sway is a function of the shot clock.
//
//   night-floor { box: [x0, z0, x1, z1], cell (ground mesh spacing, 0.5), lift (0.012), tile (texture tile, 2.6),
//                 soil, moss, litter, litter2 (colours), drift (broad tint, 0.35), count (blades per square unit,
//                 22), height [min, max] (0.12, 0.34), width (0.022), grass, tip (colours), wind (0.06),
//                 clear [[x, z, r], ...] (no grass: water, whose surface draws over the cover),
//                 wet (0: off; how dark the cover goes inside the clear circles, a puddle's wet mud), seed,
//                 relief (off unless given): { clods, pebbles (per square unit, 3, 6), bump (soil unevenness, 0.4),
//                   litter (leaves in the tile, 120), size (clod size, 1) }: lumpy earth clods and small stones
//                   seated in the ground, a bumpy cracked soil, sparse crumpled and broken leaves,
//                 blade: 'tuft' (off unless given): the grass grows in tufts of tapered, curved blades of mixed
//                   width and height fanning out from their root,
//                 gust (off unless given): { from: [x, z], t, amp (0.25), decay (1.1 s), hz (1.4) }: a blast's
//                   shock reaching the grass at shot second t: every blade is thrown away from `from` (amp:
//                   tip travel per unit of blade height) and rocks back and forth as the push dies away }
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

/** A crumpled or broken leaf outline: a ragged point-ended lobe, sometimes with a bite out of it. */
function leafPath(g: CanvasRenderingContext2D, r: () => number, l: number): void {
  const n = 14;
  const bite = r() < 0.45 ? Math.floor(r() * n) : -1;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tip = Math.abs(Math.cos(a));
    let rr = (0.42 + 0.58 * tip ** 0.6) * (0.75 + 0.35 * r());
    if (bite >= 0 && Math.abs(i - bite) <= 1) rr *= 0.35;
    const w = Math.sin(a) * 0.45;
    g.lineTo(Math.cos(a) * l * rr, w * l * rr * (1 + 0.3 * Math.sin(a * 3 + l)));
  }
  g.closePath();
}

/** The relief tile: soil and moss with dry cracks, sparse crumpled leaves, a few small stones; plus its bump map. */
function reliefTexture(cue: FxCue, rel: Record<string, unknown>, seed: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const S = 512;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return [c, c.getContext('2d')!] as const;
  };
  const [c, g] = mk();
  const [cb, gb] = mk();
  const img = g.createImageData(S, S);
  const bim = gb.createImageData(S, S);
  const soil = new THREE.Color(String(cue.soil ?? '#2a2230'));
  const moss = new THREE.Color(String(cue.moss ?? '#2f4a3c'));
  const dark = soil.clone().multiplyScalar(0.5);
  const n1 = tileNoise(seed, 4);
  const n2 = tileNoise(seed + 7, 16);
  const n3 = tileNoise(seed + 13, 64);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const m = Math.min(1, Math.max(0, (n1(u, v, 4) - 0.48) * 4));
      const grit = n2(u, v, 3);
      const fine = n3(u, v, 2);
      const col = soil.clone().lerp(moss, m * 0.8).lerp(dark, Math.max(0, 0.5 - grit) * 0.9);
      const k = 1.15 + 0.45 * grit + 0.35 * (fine - 0.5);
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, col.r * 255 * k);
      img.data[i + 1] = Math.min(255, col.g * 255 * k);
      img.data[i + 2] = Math.min(255, col.b * 255 * k);
      img.data[i + 3] = 255;
      const h = 255 * (0.25 + 0.4 * grit + 0.35 * fine);
      bim.data[i] = bim.data[i + 1] = bim.data[i + 2] = h;
      bim.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gb.putImageData(bim, 0, 0);
  const r = mulberry(seed + 3);
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  // Dry cracks: wandering, forking dark grooves.
  for (let i = 0; i < 70; i++) {
    let x = r() * S;
    let y = r() * S;
    let a = r() * Math.PI * 2;
    const pts: [number, number][] = [[x, y]];
    const len = 8 + Math.floor(r() * 18);
    for (let k = 0; k < len; k++) {
      a += (r() - 0.5) * 1.1;
      x += Math.cos(a) * 4;
      y += Math.sin(a) * 4;
      pts.push([x, y]);
    }
    const w = 0.6 + r() * 1.2;
    wrap((ox, oy) => {
      for (const [gg, style] of [[g, 'rgba(0,0,0,0.55)'], [gb, 'rgba(0,0,0,0.9)']] as const) {
        gg.strokeStyle = style;
        gg.lineWidth = w;
        gg.beginPath();
        pts.forEach(([px, py], k) => (k ? gg.lineTo(px + ox, py + oy) : gg.moveTo(px + ox, py + oy)));
        gg.stroke();
      }
    });
  }
  // Leaves: sparse, dark, crumpled or broken, a lit and a shaded half, raised a little in the bump map.
  const leaf = [String(cue.litter ?? '#4a2a4a'), String(cue.litter2 ?? '#5a3a3a'), '#2e2418'];
  const nl = Math.round(num(rel.litter, 120));
  for (let i = 0; i < nl; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI * 2;
    const l = 5 + r() * 8;
    const col = new THREE.Color(leaf[Math.floor(r() * leaf.length)]).multiplyScalar(0.45 + r() * 0.4);
    const curl = r();
    const ls = Math.floor(r() * 1e6) + 1;
    wrap((ox, oy) => {
      for (const [gg, fill] of [[g, col.getStyle()], [gb, 'rgb(235,235,235)']] as const) {
        const pr = mulberry(ls);
        gg.save();
        gg.translate(x + ox, y + oy);
        gg.rotate(a);
        gg.globalAlpha = gg === g ? 0.9 : 0.6;
        gg.fillStyle = fill;
        leafPath(gg, pr, l);
        gg.fill();
        if (gg === g) {
          // The curled half in shadow, a midrib and veins.
          gg.save();
          gg.clip();
          gg.fillStyle = `rgba(0,0,0,${0.25 + 0.3 * curl})`;
          gg.fillRect(-l, 0, l * 2, l);
          gg.restore();
          gg.strokeStyle = 'rgba(0,0,0,0.4)';
          gg.lineWidth = 0.5;
          gg.beginPath();
          gg.moveTo(-l * 0.9, 0);
          gg.lineTo(l * 0.9, 0);
          gg.stroke();
        }
        gg.restore();
      }
    });
  }
  // A few small dark stones (the big ones are real geometry).
  for (let i = 0; i < 50; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 1 + r() * 2.2;
    const k = 0.2 + r() * 0.25;
    wrap((ox, oy) => {
      const gr = g.createRadialGradient(x + ox - rad * 0.3, y + oy - rad * 0.4, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${120 * k + 30},${115 * k + 30},${110 * k + 28},1)`);
      gr.addColorStop(1, `rgba(${30 * k},${28 * k},${24 * k},1)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
      gb.fillStyle = 'rgb(250,250,250)';
      gb.beginPath();
      gb.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      gb.fill();
    });
  }
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return [tex(c, true), tex(cb, false)];
}

/** A lump: an icosphere pushed about by noise (a clod of earth, or smoother for a stone). */
function lumpGeometry(seed: number, rough: number, detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const r = mulberry(seed);
  const bumps = Array.from({ length: 7 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), (r() - 0.3) * rough] as const);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1;
    for (const [d, a] of bumps) k += a * Math.max(0, v.dot(d)) ** 3;
    k += (Math.sin(v.x * 9 + seed) * Math.sin(v.y * 7) * Math.sin(v.z * 8)) * rough * 0.25;
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** One grass blade, 1 tall: a tapered strip curving forward, base dark to tip light (vertex colours). */
function bladeGeometry(width: number, tuft = false): THREE.BufferGeometry {
  if (tuft) return tuftBlade(width);
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

/** A tuft's blade, 1 tall: widest a little above the root, tapering to a sharp tip, curving over. */
function tuftBlade(width: number): THREE.BufferGeometry {
  const seg = 7;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const h = i / seg;
    const w = width * Math.min(1, 0.55 + h * 4) * (1 - h) ** 0.9;
    const bend = 0.32 * h * h;
    const y = h * (1 - 0.12 * h * h);
    pos.push(-w, y, bend, w, y, bend);
    const k = 0.3 + 0.7 * h;
    col.push(k, k, k, k, k, k);
    nor.push(0, 1 - h * 0.5, 0.35 + h * 0.6, 0, 1 - h * 0.5, 0.35 + h * 0.6);
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
  /** The gust's world direction (x, z) and its push now (see `gust`). */
  private uGust = { value: new THREE.Vector3() };
  private gust: { t: number; amp: number; decay: number; hz: number } | null = null;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private tex: THREE.Texture;
  private bump: THREE.Texture | null = null;

  constructor(cue: FxCue, scene: THREE.Scene, ground: Ground) {
    const [x0, z0, x1, z1] = (cue.box as number[]) ?? [-5, -5, 5, 5];
    const seed = num(cue.seed, 11);
    const clear = (cue.clear as [number, number, number][]) ?? [];
    const inClear = (x: number, z: number, pad = 0) => clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + pad);
    const lift = num(cue.lift, 0.012);
    const wet = num(cue.wet, 0);

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
        let d = 1 - driftK + driftK * 2 * drift(x / 40, z / 40, 3);
        // Wet, dark mud under the water, fading out across the circle's outer third.
        if (wet > 0) for (const [cx, cz, r] of clear) d *= 1 - wet * Math.min(1, Math.max(0, (r - Math.hypot(x - cx, z - cz)) / (r * 0.35)));
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
    const rel = cue.relief as Record<string, unknown> | undefined;
    if (rel) [this.tex, this.bump] = reliefTexture(cue, rel, seed);
    else this.tex = floorTexture(cue, seed);
    const floorMat = new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 0.95, metalness: 0 });
    if (this.bump) {
      floorMat.bumpMap = this.bump;
      floorMat.bumpScale = num(rel!.bump, 0.4);
    }
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
    const tuft = cue.blade === 'tuft';
    const blade = bladeGeometry(num(cue.width, tuft ? 0.01 : 0.022), tuft);
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const uTime = this.uTime;
    const wind = num(cue.wind, 0.06);
    const uGust = this.uGust;
    const g = cue.gust as { from?: [number, number]; t?: number; amp?: number; decay?: number; hz?: number } | undefined;
    if (g?.from) {
      const dir = new THREE.Vector2((x0 + x1) / 2 - g.from[0], (z0 + z1) / 2 - g.from[1]).normalize();
      uGust.value.set(dir.x, dir.y, 0);
      this.gust = { t: num(g.t, 0), amp: num(g.amp, 0.25), decay: num(g.decay, 1.1), hz: num(g.hz, 1.4) };
    }
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.uniforms.uGust = uGust;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uGust;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.37 + ip.z * 0.23;
          float hh = position.y * position.y;
          transformed.x += ${wind.toFixed(4)} * hh * (sin(uTime * 1.6 + ph) + 0.45 * sin(uTime * 3.7 + ph * 1.9));
          transformed.z += ${(wind * 0.5).toFixed(4)} * hh * sin(uTime * 2.3 + ph * 1.3);
          if (uGust.z != 0.0) {
            // The push is along a world direction: take it into the blade's own (scaled, turned) frame.
            mat3 im = mat3(instanceMatrix);
            vec3 gw = vec3(uGust.x, 0.0, uGust.y) * uGust.z * hh * length(im[1]) * (0.75 + 0.5 * sin(ph * 3.1));
            transformed += inverse(im) * gw;
          }`,
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
    if (tuft) {
      // Tufts: blades fanning out of a root, the outer ones leaning further; tufts thicker in clumps.
      for (let c = 0, tufts = Math.round(count / 14); c < tufts && n < count; c++) {
        const cx = x0 + r() * (x1 - x0);
        const cz = z0 + r() * (z1 - z0);
        if (r() > 0.2 + 0.95 * clump(cx / 18, cz / 18, 3) || inClear(cx, cz, 0.3)) continue;
        const th = h0 + (h1 - h0) * r() ** 1.3;
        const k = Math.min(count - n, 7 + Math.floor(r() * 16));
        const shade = r();
        for (let b = 0; b < k; b++) {
          const a = r() * Math.PI * 2;
          const rr = Math.sqrt(r()) * 0.045;
          const x = cx + Math.cos(a) * rr;
          const z = cz + Math.sin(a) * rr;
          const h = th * (0.45 + 0.65 * r());
          p.set(x, ground(x, z), z);
          // Facing out of the tuft (its bend leans away from the root), more for the outer blades.
          const out = 0.1 + 0.6 * (rr / 0.045) + (r() - 0.5) * 0.3;
          e.set(out, Math.PI / 2 - a + (r() - 0.5) * 0.6, (r() - 0.5) * 0.25, 'YXZ');
          q.setFromEuler(e);
          s.set(0.45 + r() * 0.95, h, h);
          m.compose(p, q, s);
          grass.setMatrixAt(n, m);
          grass.setColorAt(n, base.clone().lerp(tip, 0.15 + 0.5 * shade * r()).multiplyScalar(0.75 + 0.4 * r()));
          n++;
        }
      }
    } else for (let i = 0; i < count; i++) {
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
    if (rel) this.lumps(rel, cue, x0, z0, x1, z1, seed, inClear, ground);
    scene.add(this.group);
  }

  /** Clods of earth and small stones, instanced, seated part-way into the ground. */
  private lumps(rel: Record<string, unknown>, cue: FxCue, x0: number, z0: number, x1: number, z1: number, seed: number, inClear: (x: number, z: number, pad?: number) => boolean, ground: Ground): void {
    const area = (x1 - x0) * (z1 - z0);
    const r = mulberry(seed + 31);
    const size = num(rel.size, 1);
    const soil = new THREE.Color(String(cue.soil ?? '#2a2230'));
    const kinds = [
      // clods: dark soil, rough, flattened; stones: grey, smoother, a little shine
      { n: Math.round(num(rel.clods, 3) * area), geo: lumpGeometry(seed + 1, 0.9, 2), mat: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), s: [0.03, 0.13], flat: 0.6, sink: 0.3, col: () => soil.clone().multiplyScalar(0.8 + 0.6 * r()) },
      { n: Math.round(num(rel.pebbles, 6) * area), geo: lumpGeometry(seed + 2, 0.4, 2), mat: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }), s: [0.012, 0.045], flat: 0.65, sink: 0.25, col: () => new THREE.Color('#6b665c').lerp(soil, 0.3 + 0.4 * r()).multiplyScalar(0.45 + 0.5 * r()) },
    ];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const k of kinds) {
      const mesh = new THREE.InstancedMesh(k.geo, k.mat, Math.max(1, k.n));
      let n = 0;
      for (let i = 0; i < k.n; i++) {
        const x = x0 + r() * (x1 - x0);
        const z = z0 + r() * (z1 - z0);
        const sz = (k.s[0] + (k.s[1] - k.s[0]) * r() ** 2.2) * size;
        if (inClear(x, z, 0.1)) continue;
        sc.set(sz * (0.8 + 0.5 * r()), sz * k.flat * (0.7 + 0.5 * r()), sz * (0.8 + 0.5 * r()));
        p.set(x, ground(x, z) - sc.y * k.sink, z);
        e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4);
        q.setFromEuler(e);
        m.compose(p, q, sc);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, k.col());
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.geos.push(k.geo);
      this.mats.push(k.mat);
    }
  }

  update(ctx: FxContext): void {
    this.uTime.value = ctx.t;
    const g = this.gust;
    if (g) {
      // Thrown over in a tenth of a second, then a damped rocking.
      const age = ctx.t - g.t;
      this.uGust.value.z = age <= 0 ? 0 : g.amp * Math.min(1, age / 0.1) * Math.exp(-age / g.decay) * Math.cos(2 * Math.PI * g.hz * Math.max(0, age - 0.1));
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
    this.bump?.dispose();
  }
}

registerEffect('night-floor', (cue, scene, ground) => new Floor(cue, scene, ground));
