// Tidecrown's ground mesh on World I's splat-painted terrain material (grass, sand, dirt, cobble, rock), with the
// rock and setts re-tinted toward pale limestone. Split into tiles so the camera and the shadow pass cull them.
import * as THREE from 'three';
import { plateauRadius, polyDistance, TC_CITY_WALL, tcCoast, TIDECROWN_GRID } from '../../sim/world/tidecrownGround';
import type { Kit } from '../../world/kit';
import { addPatch } from '../../world/materials';
import { Simplex, smoothstep } from '../../world/noise';
import { createTerrainMaterial, type Terrain } from '../../world/terrain';
import { tcPaving } from './paving';

export class TidecrownTerrain {
  readonly nx = TIDECROWN_GRID.nx;
  readonly nz = TIDECROWN_GRID.nz;
  readonly step = TIDECROWN_GRID.step;
  readonly minX = TIDECROWN_GRID.minX;
  readonly minZ = TIDECROWN_GRID.minZ;
  readonly sizeX = (TIDECROWN_GRID.nx - 1) * TIDECROWN_GRID.step;
  readonly sizeZ = (TIDECROWN_GRID.nz - 1) * TIDECROWN_GRID.step;
  /** RGBA splat: R sand, G cobble, B dirt, A painted rock. */
  readonly splat: Uint8Array;

  constructor(readonly h: Float32Array) {
    this.splat = new Uint8Array(this.nx * this.nz * 4);
    this.paint();
  }

  private paint(): void {
    const { nx, nz, step, minX, minZ, h, splat } = this;
    const N = new Simplex(23), pave = { cobble: 0, dirt: 0, clear: 0 };
    const put = (k: number, ch: number, w: number) => {
      const v = Math.round(Math.max(0, Math.min(1, w)) * 255);
      if (v > splat[k * 4 + ch]) splat[k * 4 + ch] = v;
    };
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * step;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * step, k = j * nx + i, y = h[k];
        const n = N.fbm(x * 0.05, z * 0.05, 2), c = tcCoast(x, z);
        // Beaches along low shores, sand under the shallows.
        if (y < 3.6 + n) put(k, 0, (1 - smoothstep(9 + 4 * n, 15 + 4 * n, c.d)) * (1 - smoothstep(2.2 + n, 3.6 + n, y)));
        if (y < 0.4) put(k, 0, 1);
        if (x > -150 && x < 260 && z > -250 && z < 345) {
          tcPaving(x, z, pave);
          put(k, 1, pave.cobble);
          put(k, 2, pave.dirt);
        }
        // Worn earth along the foot of the city wall, and patches in the lawns and under the pines.
        const wd = polyDistance(x, z, TC_CITY_WALL);
        if (Math.abs(wd) < 9) put(k, 2, (1 - smoothstep(3, 9, Math.abs(wd))) * (0.55 + 0.4 * n));
        const patches = N.fbm(x * 0.031 + 11, z * 0.031, 3);
        if (c.south > c.north && c.d > 12) put(k, 2, smoothstep(0.05, 0.45, patches) * 0.75);
        else if (wd > 6) put(k, 2, smoothstep(0.25, 0.6, patches) * 0.6);
        // The keep's rock shows bare limestone around its rim; the overlook has its outcrops.
        const rim = plateauRadius(x, z);
        if (rim > 0.9 && rim < 1.08) put(k, 3, (1 - smoothstep(0.03, 0.08, Math.abs(rim - 1.0))) * 0.9);
        if (c.d > 0 && c.d < 7 && y > 7) put(k, 3, 1 - smoothstep(3, 7, c.d));
      }
    }
  }

  splatTexture(): THREE.DataTexture {
    const t = new THREE.DataTexture(this.splat, this.nx, this.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  /** Heights as a half-float texture for the water shader (depth tint and shore foam). */
  heightTexture(): THREE.DataTexture {
    const data = new Uint16Array(this.nx * this.nz);
    for (let k = 0; k < data.length; k++) data[k] = THREE.DataUtils.toHalfFloat(this.h[k]);
    const t = new THREE.DataTexture(data, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /** Tiles of the grid (shared edge vertices), triangulated as gridHeight() walks them. */
  buildMeshes(material: THREE.Material, tiles = 5): THREE.Group {
    const { nx, nz, step, minX, minZ, h } = this;
    const group = new THREE.Group();
    group.name = 'tidecrown-terrain';
    const per = Math.ceil((nx - 1) / tiles);
    for (let tj = 0; tj < tiles; tj++) {
      for (let ti = 0; ti < tiles; ti++) {
        const i0 = ti * per, i1 = Math.min(nx - 1, i0 + per), j0 = tj * per, j1 = Math.min(nz - 1, j0 + per);
        if (i1 <= i0 || j1 <= j0) continue;
        const cw = i1 - i0 + 1, ch = j1 - j0 + 1;
        const pos = new Float32Array(cw * ch * 3), nor = new Float32Array(cw * ch * 3);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const k = j * nx + i, o = ((j - j0) * cw + (i - i0)) * 3;
            pos[o] = minX + i * step;
            pos[o + 1] = h[k];
            pos[o + 2] = minZ + j * step;
            const ax = h[j * nx + Math.max(0, i - 1)] - h[j * nx + Math.min(nx - 1, i + 1)];
            const az = h[Math.max(0, j - 1) * nx + i] - h[Math.min(nz - 1, j + 1) * nx + i];
            const l = Math.sqrt(ax * ax + 4 * step * step + az * az);
            nor[o] = ax / l;
            nor[o + 1] = (2 * step) / l;
            nor[o + 2] = az / l;
          }
        }
        const idx = new Uint32Array((cw - 1) * (ch - 1) * 6);
        let p = 0;
        for (let j = 0; j < ch - 1; j++) {
          for (let i = 0; i < cw - 1; i++) {
            const a = j * cw + i, b = a + 1, c = a + cw, d = c + 1;
            idx[p++] = a; idx[p++] = c; idx[p++] = b;
            idx[p++] = b; idx[p++] = c; idx[p++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `tidecrown-terrain-${ti}-${tj}`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    return group;
  }
}

/**
 * World I's terrain material over Tidecrown's splat. Its rock turns pale limestone with grey seams and its setts
 * lose the warm brown, like the city's paving stone.
 */
export function tidecrownTerrainMaterial(terrain: TidecrownTerrain, village: Kit, nature: Kit, uTime: { value: number }): THREE.MeshStandardMaterial {
  const mat = createTerrainMaterial(
    terrain as unknown as Terrain,
    { cobble: village.material('MI_UnevenBrick')?.map ?? null, cobbleNormal: village.material('MI_UnevenBrick')?.normalMap ?? null, rock: nature.material('Rocks')?.map ?? null },
    { uTime },
  );
  addPatch(mat, 'tidecrown-limestone', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('vec3 cobC = texture2D(uCobble, ccXZ * 0.22).rgb * cc_srgb(vec3(1.08, 0.94, 0.80));', 'vec3 cobC = texture2D(uCobble, ccXZ * 0.22).rgb * cc_srgb(vec3(1.3, 1.22, 1.08));')
      .replace('vec3 stone = mix(cc_srgb(vec3(0.66, 0.52, 0.40)), cc_srgb(vec3(0.55, 0.47, 0.42)), n2);', 'vec3 stone = mix(cc_srgb(vec3(0.80, 0.76, 0.66)), cc_srgb(vec3(0.66, 0.65, 0.62)), n2);')
      .replace('rockC = mix(rockC, stone * strata, 0.55);', 'rockC = mix(rockC * vec3(1.05, 1.06, 1.08), stone * strata, 0.72);');
  });
  return mat;
}
