import * as THREE from 'three';
import {SKYBLOOM_SKY_GLSL,type SkybloomSky} from './skybloomSky';

/*
 * Skybloom's sea of clouds, far below the island. One tileable heightfield of packed cumulus puffs (big domes with
 * smaller cauliflower puffs on them) is baked once on the CPU with its gradient; the sea samples it at two scales
 * that drift at different speeds, displaces the big billows in the vertex shader so they make real silhouettes
 * against the cliffs and isles, and lights them like a MeshStandardMaterial would under the same sun and sky:
 * sunlit tops near white with a warm rim, valleys in lavender-blue shade, the far field melting into the dome's
 * own below-horizon colour so there is no seam.
 */

/** Cloud sea base height and billow amplitudes, metres. The island's lip sits 5 to 18 m up. */
export const CLOUD_Y = -40;
const MACRO_AMP = 30, DETAIL_AMP = 6;
/** World metres per texture tile at the two scales. */
const MACRO_TILE = 640, DETAIL_TILE = 170;
const TEX = 256, GRAD_K = 0.08;

const hash = (x: number, y: number, s: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };

/** Max-of-spheres puffs on a periodic grid of `cells` cells: domes of random radius, flat gaps between. */
function puffs(u: number, v: number, cells: number, seed: number, rMin: number, rMax: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let best = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const px = cx + 0.15 + 0.7 * hash(wx, wy, seed), py = cy + 0.15 + 0.7 * hash(wx, wy, seed + 1);
    const r = rMin + (rMax - rMin) * hash(wx, wy, seed + 2), d = Math.hypot(x - px, y - py) / r;
    if (d < 1) best = Math.max(best, Math.sqrt(1 - d * d) * (0.7 + 0.3 * hash(wx, wy, seed + 3)));
  }
  return best;
}

/** RGBA8 tile: R height 0..1, G/B its gradient (per uv unit, scaled by GRAD_K) around 0.5. */
export function bakeCloudPuffs(size = TEX): Uint8Array {
  const h = new Float32Array(size * size);
  let max = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const big = puffs(u, v, 5, 1, 0.75, 1.1), mid = puffs(u, v, 13, 7, 0.6, 1.05), small = puffs(u, v, 31, 13, 0.55, 1);
    // Small puffs ride on the big ones: cauliflower tops, softer in the valleys.
    const v0 = big * 0.68 + mid * 0.24 * (0.45 + 0.55 * big) + small * 0.08 * (0.3 + 0.7 * big);
    h[y * size + x] = v0; max = Math.max(max, v0);
  }
  const out = new Uint8Array(size * size * 4), at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)] / max;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * size / 2, gy = (at(x, y + 1) - at(x, y - 1)) * size / 2, o = (y * size + x) * 4;
    out[o] = Math.round(at(x, y) * 255);
    out[o + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + gx * GRAD_K)) * 255);
    out[o + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + gy * GRAD_K)) * 255);
    out[o + 3] = 255;
  }
  return out;
}

const VERTEX = /* glsl */ `
uniform sampler2D puff;
uniform float time;
varying vec3 vWorld;
varying vec2 vUv1;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vUv1=w.xz/${MACRO_TILE.toFixed(1)}+vec2(time*.0021,time*.0009);
  float far=length(w.xz-cameraPosition.xz);
  // Billows flatten into the far field, where they are a few pixels tall and only shimmer.
  w.y+=texture2D(puff,vUv1).r*${MACRO_AMP.toFixed(1)}*(1.-smoothstep(900.,1600.,far));
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}
`;

const FRAGMENT = /* glsl */ `
${SKYBLOOM_SKY_GLSL}
uniform sampler2D puff;
uniform float time;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform vec3 rimColor;
varying vec3 vWorld;
varying vec2 vUv1;
const float GK=${GRAD_K.toFixed(4)};
void main(){
  vec3 toCam=cameraPosition-vWorld;float dist=length(toCam);vec3 v=toCam/dist;
  vec4 a=texture2D(puff,vUv1);
  // The small scale is turned against the big one so the two tiles never line up.
  const mat2 R=mat2(.8,.6,-.6,.8);
  vec2 uv2=R*vWorld.xz/${DETAIL_TILE.toFixed(1)}+vec2(-time*.0035,time*.0026);
  vec4 b=texture2D(puff,uv2);
  float detail=1.-smoothstep(250.,900.,dist);
  vec2 g1=(a.gb-.5)/GK*${MACRO_AMP.toFixed(1)}/${MACRO_TILE.toFixed(1)};
  vec2 g2=((b.gb-.5)/GK*${DETAIL_AMP.toFixed(1)}/${DETAIL_TILE.toFixed(1)})*R*detail;
  vec2 g=g1+g2;
  vec3 n=normalize(vec3(-g.x,1.,-g.y));
  float h=a.r*.78+b.r*.22*detail;
  // Self-shadow: the big billow between this point and the sun.
#ifdef CLOUD_LOW
  float shadow=0.;
#else
  vec2 s=normalize(skySunDir.xz)*(1./${MACRO_TILE.toFixed(1)})*38.;
  float ahead=max(texture2D(puff,vUv1+s).r,texture2D(puff,vUv1+s*2.2).r*.92);
  float shadow=smoothstep(.04,.22,ahead-a.r)*(.85-.35*a.r);
#endif
  float ndl=dot(n,skySunDir);
  float lit=smoothstep(-.3,.8,ndl)*(1.-shadow);
  // Valleys between the domes sit deep in their own shade, the top of each puff is the brightest white.
  float valley=1.-smoothstep(.05,.55,h);
  vec3 col=cloudShade*(1.-valley*.5)+(cloudLit-cloudShade)*lit*(.55+.45*smoothstep(.15,.85,h));
  // Silver-warm rim where a lit flank turns away from the viewer.
  float rim=pow(1.-max(dot(n,v),0.),3.)*max(ndl,0.);
  col+=rimColor*rim*.5*detail;
  // The far field melts into the dome's own colour below the horizon (the same LUT), so the edge is invisible.
  vec3 d=-v;
  vec3 far=skybloomSky(vec3(d.x,min(d.y,-.03),d.z));
  float haze=smoothstep(260.,2000.,dist);
  col=mix(col,far,pow(haze,1.1));
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Rings around the island out to past the far plane: dense where billows are near, sparse at the horizon. */
function seaGeometry(rIn: number, rOut: number, rings: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const r = rIn + (rOut - rIn) * Math.pow(j / rings, 1.9);
    for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; pos.push(Math.sin(a) * r, 0, Math.cos(a) * r); }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rOut);
  return g;
}

export interface SkybloomClouds { mesh: THREE.Mesh; material: THREE.ShaderMaterial; texture: THREE.DataTexture }

/** The cloud sea as one mesh, sharing the dome's sky LUT and sun. */
export function skybloomClouds(sky: SkybloomSky): SkybloomClouds {
  const texture = new THREE.DataTexture(bakeCloudPuffs(), TEX, TEX, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    name: 'skybloom-cloud-sea',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...sky.uniforms,
      puff: { value: texture },
      time: { value: 0 },
      cloudLit: { value: sky.cloudLit },
      cloudShade: { value: sky.cloudShade },
      rimColor: { value: new THREE.Color('#fff0d8').multiplyScalar(0.9) },
    },
  });
  material.addEventListener('dispose', () => texture.dispose());
  // The hole under the island is closed by the cliff skirt, which reaches below the deepest valley.
  const mesh = new THREE.Mesh(seaGeometry(95, 2300, 120, 256), material);
  mesh.position.y = CLOUD_Y;
  mesh.name = 'skybloom-cloud-sea';
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  return {mesh, material, texture};
}
