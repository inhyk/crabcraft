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

/** Cloud sea base height (the valley floor) and billow amplitudes, metres. The island's lip sits 5 to 18 m up. */
export const CLOUD_Y = -74;
const MACRO_AMP = 50, DETAIL_AMP = 7;
/** Typical lit top of the billows: where rock and water sink into the cloud. */
export const CLOUD_TOP = CLOUD_Y + MACRO_AMP * 0.62;
/** World metres per texture tile at the two scales. */
const MACRO_TILE = 640, DETAIL_TILE = 230;
const TEX = 256, GRAD_K = 0.03;
/** The island's lip ellipse (skybloomIsles.ts): billows bank up against the cliff in a collar round it. */
const LIP_RX = 128 * 0.83, LIP_RZ = 155 * 0.83, LIP_CZ = 2;

const hash = (x: number, y: number, s: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };

/** Max-of-spheres puffs on a periodic grid of `cells` cells: domes of random radius and height, gaps between. */
function puffs(u: number, v: number, cells: number, seed: number, rMin: number, rMax: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let best = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const px = cx + 0.15 + 0.7 * hash(wx, wy, seed), py = cy + 0.15 + 0.7 * hash(wx, wy, seed + 1);
    const r = rMin + (rMax - rMin) * hash(wx, wy, seed + 2), d = Math.hypot(x - px, y - py) / r;
    if (d < 1) best = Math.max(best, Math.sqrt(1 - d * d) * (0.55 + 0.45 * hash(wx, wy, seed + 3)));
  }
  return best;
}

/**
 * RGBA8 tile: R height 0..1, G/B its gradient (per uv unit, scaled by GRAD_K) around 0.5. Big domes spaced so lanes
 * of deep valley run between them (a cloud sea seen from above reads by those shaded lanes), mid and small puffs
 * boiling on their tops: cauliflower crowns, smooth valley floors.
 */
export function bakeCloudPuffs(size = TEX): Uint8Array {
  const h = new Float32Array(size * size);
  let max = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const big = puffs(u, v, 9, 1, 0.55, 0.85), mid = puffs(u, v, 21, 7, 0.5, 0.9), small = puffs(u, v, 47, 13, 0.5, 0.95);
    const v0 = big * 0.66 + mid * 0.26 * (0.25 + 0.75 * big) + small * 0.08 * (0.2 + 0.8 * big);
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

/** Billow amplitude scale at a world point: flat in the far field, banked up in a collar round the island's foot. */
const AMP_GLSL = /* glsl */ `
float seaAmp(vec2 xz,float far){
  float e=length(vec2(xz.x/${LIP_RX.toFixed(2)},(xz.y-${LIP_CZ.toFixed(1)})/${LIP_RZ.toFixed(2)}));
  float collar=smoothstep(.55,.9,e)*(1.-smoothstep(1.05,1.5,e));
  return (1.+.25*collar)*(1.-smoothstep(900.,1700.,far));
}
`;

const VERTEX = /* glsl */ `
uniform sampler2D puff;
uniform float time;
varying vec3 vWorld;
varying vec2 vUv1;
varying float vAmp;
${AMP_GLSL}
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vUv1=w.xz/${MACRO_TILE.toFixed(1)}+vec2(time*.0021,time*.0009);
  float far=length(w.xz-cameraPosition.xz);
  vAmp=seaAmp(w.xz,far);
  w.y+=texture2D(puff,vUv1).r*${MACRO_AMP.toFixed(1)}*vAmp;
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
uniform vec3 cloudDeep;
uniform vec3 rimColor;
varying vec3 vWorld;
varying vec2 vUv1;
varying float vAmp;
const float GK=${GRAD_K.toFixed(4)};
void main(){
  vec3 toCam=cameraPosition-vWorld;float dist=length(toCam);vec3 v=toCam/dist;
  vec4 a=texture2D(puff,vUv1);
  // The small scale is turned against the big one so the two tiles never line up.
  const mat2 R=mat2(.8,.6,-.6,.8);
  vec2 uv2=R*vWorld.xz/${DETAIL_TILE.toFixed(1)}+vec2(-time*.0035,time*.0026);
  vec4 b=texture2D(puff,uv2);
  float detail=1.-smoothstep(300.,1000.,dist);
  vec2 g1=(a.gb-.5)/GK*${MACRO_AMP.toFixed(1)}*vAmp/${MACRO_TILE.toFixed(1)};
  vec2 g2=((b.gb-.5)/GK*${DETAIL_AMP.toFixed(1)}/${DETAIL_TILE.toFixed(1)})*R*detail*.6;
  vec3 n=normalize(vec3(-(g1.x+g2.x),1.,-(g1.y+g2.y)));
  float h=a.r;
  vec3 L=skySunDir;
  float ndl=dot(n,L);
  // Self-shadow: march the baked heights toward the sun; a billow that rises above the sun ray darkens the lane
  // behind it, so every dome throws its shade across the valley on its far side.
  float occ=0.;
#ifndef CLOUD_LOW
  vec2 sd=normalize(L.xz);float tanEl=L.y/max(length(L.xz),1e-3);
  float h0=h*${MACRO_AMP.toFixed(1)}*vAmp;
  for(int k=1;k<=4;k++){
    float dk=float(k*k)*3.+float(k)*3.;
    float hk=texture2D(puff,vUv1+sd*dk/${MACRO_TILE.toFixed(1)}).r*${MACRO_AMP.toFixed(1)}*vAmp;
    occ=max(occ,smoothstep(0.,7.,hk-h0-dk*tanEl));
  }
  occ*=detail*.6+.4;
#endif
  // The island's own shadow on the sea: follow the sun ray up to the turf and test the lip outline (capes included
  // on average), so from the air the island floats over its shadow.
  vec2 q=vWorld.xz+L.xz*((8.-vWorld.y)/max(L.y,.05));
  float ie=length(vec2(q.x/${LIP_RX.toFixed(2)},(q.y-${LIP_CZ.toFixed(1)})/${LIP_RZ.toFixed(2)}));
  occ=max(occ,1.-smoothstep(.96,1.1,ie+.03*(b.r-.5)));
  // Wrap light so puffs never go black; the powder term darkens thin low edges a touch; valleys sit in their own AO.
  float lit=smoothstep(-.15,.75,ndl)*(1.-occ*.85);
  float powder=1.-exp(-5.*(h+.08));
  float cav=smoothstep(.0,.5,h+b.r*.12*detail);
  vec3 shade=mix(cloudDeep,cloudShade,cav);
  vec3 col=mix(shade,cloudLit,lit*mix(.45,1.,powder));
  col*=mix(.82,1.,cav);
  // Warm silver where a lit flank turns away from the viewer, and looking toward the sun through thin edges.
  float rim=pow(1.-max(dot(n,v),0.),3.);
  float silver=pow(max(dot(-v,L),0.),8.);
  col+=rimColor*(.35*rim*lit+.4*silver*(1.-h))*detail;
  // The far field melts into the dome's own colour below the horizon (the same LUT), so the edge is invisible.
  vec3 d=-v;
  vec3 far=skybloomSky(vec3(d.x,min(d.y,-.03),d.z));
  col=mix(col,far,pow(smoothstep(600.,2300.,dist),1.5));
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
      cloudDeep: { value: sky.cloudDeep },
      rimColor: { value: new THREE.Color('#fff0d8').multiplyScalar(0.9) },
    },
  });
  material.addEventListener('dispose', () => texture.dispose());
  // The hole under the island is closed by the cliff skirt, which reaches below the deepest valley; inside it the
  // billows are hidden in the rock.
  const mesh = new THREE.Mesh(seaGeometry(55, 2300, 130, 256), material);
  mesh.position.y = CLOUD_Y;
  mesh.name = 'skybloom-cloud-sea';
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  return {mesh, material, texture};
}
