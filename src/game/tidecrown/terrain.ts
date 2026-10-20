// Tidecrown's ground mesh on World I's splat-painted terrain material (grass, sand, dirt, cobble, rock), with the
// rock and setts re-tinted toward pale limestone. Split into tiles so the camera and the shadow pass cull them.
import * as THREE from 'three';
import { TIDECROWN_GRID } from '../../sim/world/tidecrownGround';
import type { Kit } from '../../world/kit';
import { addPatch } from '../../world/materials';
import { createTerrainMaterial, type Terrain } from '../../world/terrain';
import type { GroundLight } from './groundLight';
import { paintTidecrownSplat } from './splat';

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

  /** `splat`: paintTidecrownSplat(h) worked out elsewhere (the heights worker). */
  constructor(readonly h: Float32Array, splat?: Uint8Array) {
    this.splat = splat ?? paintTidecrownSplat(h);
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

/** World I's rock block in the terrain shader, replaced whole for Tidecrown. */
const W1_ROCK = /if \(ccRock > 0\.003\) \{[\s\S]*?col = mix\(col, rockC, ccRock\);\n\}/;

/**
 * Tidecrown's limestone. World I samples its rock noise from above, which smears down steep faces; here every lookup
 * is projected along the face's own plane (triplanar), and steep faces are cut into beds about 2.4 high: each bed
 * its own tone, a lit lip on top, a dark undercut beneath the bed above, and joints that stop at the bed boundaries.
 * The beds also tilt the normal (tcTilt) so the lips catch the sun. Flat painted rock keeps the plain stone.
 */
const TC_ROCK = `if (ccRock > 0.003) {
  vec3 tw = pow(abs(nW), vec3(4.0));
  tw /= tw.x + tw.y + tw.z;
  vec4 tn = texture2D(uNoise, vCcWorld.zy * 0.021) * tw.x + texture2D(uNoise, vCcWorld.xz * 0.021) * tw.y + texture2D(uNoise, vCcWorld.xy * 0.021) * tw.z;
  float steep = smoothstep(0.3, 0.6, slope);
  // Beds from about 1.7 to 3.8 thick, dipping gently and wandering a little along the face.
  float bedY = vCcWorld.y * 0.42 + 0.22 * sin(vCcWorld.y * 0.3 + 1.3) + dot(vCcWorld.xz, vec2(0.011, 0.007)) + (tn.r - 0.5) * 0.6 * steep;
  float bed = floor(bedY), f = fract(bedY), fw = fwidth(bedY);
  float h1 = fract(sin(bed * 12.9898 + 4.1) * 43758.5453), h2 = fract(h1 * 7.13 + 0.31);
  // Most bed tops stand out as ledges over an undercut; the rest are fine seams within a thicker bank.
  float ledge = mix(0.35, 1.0, step(0.35, h2));
  float lip = smoothstep(0.6, 0.9, f) * (1.0 - smoothstep(0.94 - fw, 1.0, f)) * ledge;
  float under = (1.0 - smoothstep(0.0, 0.17 + fw, f)) * ledge;
  // Joints: a row of the noise per bed, read along the face (z on faces turned to x, x on faces turned to z); some
  // beds are massive and have none.
  float side = tw.x / max(tw.x + tw.z, 1e-3);
  float jn = mix(texture2D(uNoise, vec2(vCcWorld.x * 0.045, bed * 0.531)).r, texture2D(uNoise, vec2(vCcWorld.z * 0.045, bed * 0.531)).r, side);
  float joint = (1.0 - smoothstep(0.0, 0.012 + 1.5 * fwidth(jn), abs(jn - 0.5))) * step(0.62, h1) * smoothstep(0.12, 0.3, f) * (1.0 - smoothstep(0.82, 0.92, f));
  vec3 grain = cc_tri(uRock, vCcWorld, nW, 0.16) * vec3(1.05, 1.06, 1.08);
  vec3 lime = mix(cc_srgb(vec3(0.83, 0.77, 0.66)), cc_srgb(vec3(0.67, 0.66, 0.62)), smoothstep(0.3, 0.7, tn.r + (h1 - 0.5) * 0.5 * steep));
  lime = mix(lime, cc_srgb(vec3(0.80, 0.68, 0.53)), smoothstep(0.58, 0.8, tn.a) * 0.45);
  lime *= 1.0 + steep * (0.2 * (h1 - 0.5) + 0.18 * lip - 0.5 * under - 0.24 * joint);
  vec3 rockC = mix(grain, lime, 0.74);
  // Inside the city wall a bank no painted rock claims is a built revetment: rubble in the walls' limestone, its
  // joints darker toward the foot.
  float rev = tcL.a * steep * (1.0 - smoothstep(0.2, 0.5, sp.a));
  if (rev > 0.01) {
    vec3 rub = texture2D(uCobble, vCcWorld.zy * 0.26).rgb * tw.x + texture2D(uCobble, vCcWorld.xz * 0.26).rgb * tw.y + texture2D(uCobble, vCcWorld.xy * 0.26).rgb * tw.z;
    float rl = dot(rub, vec3(0.299, 0.587, 0.114));
    vec3 revC = mix(cc_srgb(vec3(0.36, 0.34, 0.31)), cc_srgb(vec3(0.84, 0.79, 0.69)), smoothstep(0.07, 0.3, rl)) * (0.86 + 0.2 * tn.g);
    rockC = mix(rockC, revC, rev);
  }
  // Damp and weed along the waterline.
  float wet = 1.0 - smoothstep(0.2, 2.6, vCcWorld.y + (tn.b - 0.5) * 1.6);
  rockC = mix(rockC, rockC * cc_srgb(vec3(0.5, 0.56, 0.48)), wet * 0.85);
  tcTilt = steep * ccRock * (0.5 * lip - 0.75 * under) * (1.0 - rev);
  col = mix(col, rockC, ccRock);
}`;

/**
 * Tidecrown's setts: the kit's cobble regraded by its own value onto cool grey limestone setts (away from the crabs'
 * reds and the walls' warm cream), varied in broad patches and stone to stone, with dark wet joints near the house
 * fronts, a paler polished wear in the open and damp patches that hold the sky.
 */
const TC_COB = `vec3 cobT = texture2D(uCobble, ccXZ * 0.22).rgb;
  float cobL = dot(cobT, vec3(0.299, 0.587, 0.114));
  float face = smoothstep(0.07, 0.3, cobL);
  vec3 tint = mix(cc_srgb(vec3(0.8, 0.76, 0.7)), cc_srgb(vec3(0.85, 0.77, 0.65)), smoothstep(0.3, 0.7, nzA.r));
  tint = mix(tint, cc_srgb(vec3(0.7, 0.72, 0.76)), smoothstep(0.5, 0.75, n3) * 0.5);
  tint = mix(tint, cc_srgb(vec3(0.9, 0.85, 0.77)), smoothstep(0.6, 0.85, nzA.a) * 0.5);
  tint *= 0.82 + 0.36 * n2;
  float tcOpen = smoothstep(0.6, 0.97, tcL.r);
  vec3 cobC = mix(cc_srgb(vec3(0.25, 0.24, 0.24)) * mix(0.55, 1.0, tcOpen), tint, face) * (0.8 + 0.5 * cobL);
  cobC *= 1.0 + 0.16 * tcOpen * face * smoothstep(0.35, 0.7, nzA.g);
  tcPuddle = smoothstep(0.6, 0.68, nzA.g + (n2 - 0.5) * 0.08) * (1.0 - smoothstep(0.2, 0.32, slope));
  cobC *= 1.0 - 0.38 * tcPuddle;`;

/**
 * World I's terrain material over Tidecrown's splat: its rock becomes bedded limestone (TC_ROCK), its setts lose the
 * warm brown like the city's paving stone, and the setts stay off steep faces (their normal map would light a cliff
 * as if it were flat).
 */
export function tidecrownTerrainMaterial(terrain: TidecrownTerrain, village: Kit, nature: Kit, uTime: { value: number }, light: GroundLight): THREE.MeshStandardMaterial {
  const mat = createTerrainMaterial(
    terrain as unknown as Terrain,
    { cobble: village.material('MI_UnevenBrick')?.map ?? null, cobbleNormal: village.material('MI_UnevenBrick')?.normalMap ?? null, rock: nature.material('Rocks')?.map ?? null },
    { uTime },
  );
  addPatch(mat, 'tidecrown-limestone', (shader) => {
    Object.assign(shader.uniforms, { uTcLight: { value: light.texture }, uTcLightO: { value: light.origin }, uTcLightS: { value: light.size } });
    const fs = shader.fragmentShader;
    if (!W1_ROCK.test(fs)) console.error('tidecrown terrain: World I rock block not found, limestone not applied');
    shader.fragmentShader = fs
      .replace('float ccRock;', 'float ccRock;\nfloat tcTilt = 0.0;\nfloat tcPuddle = 0.0;\nuniform sampler2D uTcLight;\nuniform vec2 uTcLightO;\nuniform vec2 uTcLightS;\nvec4 tcL;')
      .replace('vec4 sp = texture2D(uSplat, (ccXZ - uOrigin) / uSize);', 'vec4 sp = texture2D(uSplat, (ccXZ - uOrigin) / uSize);\ntcL = texture2D(uTcLight, (ccXZ - uTcLightO) / uTcLightS);')
      // The streets' light (groundLight.ts): darker along the house fronts and in the lanes, warm under the lamps.
      .replace('diffuseColor.rgb *= col;', 'diffuseColor.rgb *= col * mix(0.38, 1.0, tcL.r);')
      // The forest road's earth calmer and less orange; on the south shore only true cliffs turn to rock (the road's cut
      // banks stay grass).
      .replace('vec3 dirtC = cc_srgb(vec3(0.55, 0.40, 0.25)) * (0.82 + 0.3 * n2);', 'vec3 dirtC = cc_srgb(vec3(0.5, 0.43, 0.35)) * (0.84 + 0.26 * n2);')
      .replace('ccRock = max(smoothstep(0.30, 0.42, slope', 'float tcWild = smoothstep(200.0, 214.0, vCcWorld.z);\nccRock = max(smoothstep(mix(0.30, 0.5, tcWild), mix(0.42, 0.66, tcWild), slope')
      // Damp setts: smoother, the sky in them.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, tcPuddle * ccCob);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * (tcL.g * tcL.g * 0.42) + vec3(1.0, 0.38, 0.1) * (tcL.b * tcL.b * 0.7);')
      // Slope from the triangle itself as well: on a cliff two grid cells wide the vertex normals lean at its foot and
      // brow, and grass, sand or setts would show there in spikes.
      .replace('float slope = 1.0 - nW.y;', 'float slope = max(1.0 - nW.y, 1.0 - abs(normalize(cross(dFdx(vCcWorld), dFdy(vCcWorld))).y));')
      .replace('vec3 cobC = texture2D(uCobble, ccXZ * 0.22).rgb * cc_srgb(vec3(1.08, 0.94, 0.80));', TC_COB)
      .replace(/(ccCob = smoothstep\([^;]*;)/, '$1\nccCob *= 1.0 - smoothstep(0.25, 0.4, slope);')
      .replace(W1_ROCK, TC_ROCK)
      .replace('normal = normalize(mix(normal, vn, ccCob * 0.85));', 'normal = normalize(mix(normal, vn, ccCob * 0.85 * (1.0 - 0.6 * tcPuddle)));')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (tcTilt != 0.0) normal = normalize(normal + normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) * tcTilt);`,
      );
  });
  return mat;
}
