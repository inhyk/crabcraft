// Light on Tidecrown's ground, painted once from the plan: R is the sky the streets see (dark along the house fronts,
// in the lanes and at the foot of the walls), G the lamps' warm pools, B the forge's and the candles' fire, A the
// ground inside the city wall (its banks are built revetments). The terrain shader reads it; the lamp heads get a
// halo each (one draw for the city).
import * as THREE from 'three';
import { TC_BOUNDS, TC_CITY_WALL } from '../../sim/world/tidecrownGround';
import type { CityLayout } from './cityLayout';
import { TC_FORGE } from './cityPlan';
import { returnArchFrame } from './layout';

export interface GroundLight {
  texture: THREE.DataTexture;
  origin: THREE.Vector2;
  size: THREE.Vector2;
}

/** Metres per texel. */
const RES = 0.5;

export function paintGroundLight(city: CityLayout): GroundLight {
  const x0 = TC_BOUNDS.minX, z0 = TC_BOUNDS.minZ, w = Math.round((TC_BOUNDS.maxX - x0) / RES), h = Math.round((TC_BOUNDS.maxZ - z0) / RES);
  const canvas = (fill: string) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    g.setTransform(1 / RES, 0, 0, 1 / RES, -x0 / RES, -z0 / RES);
    return g;
  };
  // Occlusion: every house, landmark and tall solid, and the walls, in black, blurred out over a few metres.
  const ao = canvas('#fff');
  ao.fillStyle = '#000';
  const poly = (pts: readonly (readonly number[])[]) => {
    ao.beginPath();
    pts.forEach(([x, z], i) => (i ? ao.lineTo(x, z) : ao.moveTo(x, z)));
    ao.closePath();
    ao.fill();
  };
  for (const z of city.zones) for (const l of z.plan.lots) poly(l.corners);
  for (const c of city.colliders) {
    if (c.y1 - c.y0 < 5 || c.hx * c.hz < 1.5) continue;
    const corner = (sx: number, sz: number) => [c.x + c.c * sx * c.hx + c.s * sz * c.hz, c.z - c.s * sx * c.hx + c.c * sz * c.hz];
    poly([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
  }
  ao.strokeStyle = '#000';
  ao.lineWidth = 3;
  ao.beginPath();
  TC_CITY_WALL.forEach(([x, z], i) => (i ? ao.lineTo(x, z) : ao.moveTo(x, z)));
  ao.closePath();
  ao.stroke();
  for (const r of city.walls.runs) {
    const len = 12 * r.sx, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    ao.lineWidth = 1.4;
    ao.beginPath();
    ao.moveTo(r.x - (c * len) / 2, r.z + (s * len) / 2);
    ao.lineTo(r.x + (c * len) / 2, r.z - (s * len) / 2);
    ao.stroke();
  }
  const blurred = canvas('#fff');
  blurred.setTransform(1, 0, 0, 1, 0, 0);
  blurred.filter = `blur(${(2.2 / RES).toFixed(1)}px)`;
  blurred.drawImage(ao.canvas, 0, 0);
  // Pools: soft discs, brightest under the lamp, added up where they meet.
  const pools = (spots: { x: number; z: number; r: number; k: number }[]) => {
    const g = canvas('#000');
    g.globalCompositeOperation = 'lighter';
    for (const { x, z, r, k } of spots) {
      const grad = g.createRadialGradient(x, z, 0, x, z, r);
      grad.addColorStop(0, `rgba(255,255,255,${k})`);
      grad.addColorStop(0.35, `rgba(255,255,255,${k * 0.55})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, z - r, 2 * r, 2 * r);
    }
    return g.getImageData(0, 0, w, h).data;
  };
  const lamps = pools([...city.lamps, ...returnArchFrame().lamps.map(([x, z]) => ({ x, z }))].map((l) => ({ x: l.x, z: l.z, r: 7.5, k: 1 })));
  const c = Math.cos(TC_FORGE.yaw), s = Math.sin(TC_FORGE.yaw);
  const fire = pools([
    { x: TC_FORGE.x + s * 9, z: TC_FORGE.z + c * 9, r: 13, k: 1 },
    ...city.dressing.candles.map(([x, z]) => ({ x, z, r: 3, k: 0.7 })),
  ]);
  const inside = canvas('#000');
  inside.fillStyle = '#fff';
  inside.beginPath();
  TC_CITY_WALL.forEach(([x, z], i) => (i ? inside.lineTo(x, z) : inside.moveTo(x, z)));
  inside.closePath();
  inside.fill();
  const a = blurred.getImageData(0, 0, w, h).data, walled = inside.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = a[i * 4];
    data[i * 4 + 1] = lamps[i * 4];
    data[i * 4 + 2] = fire[i * 4];
    data[i * 4 + 3] = walled[i * 4];
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.userData.tidecrown = true;
  texture.needsUpdate = true;
  return { texture, origin: new THREE.Vector2(x0, z0), size: new THREE.Vector2(w * RES, h * RES) };
}

/** A warm halo at each lamp head, sized in the world (it shrinks with distance), in one draw. */
export function lampHalos(spots: THREE.Vector3[], color = '#ffc271', size = 2.6): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(spots.flatMap((p) => [p.x, p.y, p.z]), 3));
  const col = new THREE.Color(color);
  const mat = new THREE.ShaderMaterial({
    name: 'tc-lamp-halo',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uColor: { value: col }, uSize: { value: size }, uScale: { value: 450 } },
    vertexShader: /* glsl */ `
      uniform float uSize, uScale;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uScale * uSize / -mvPosition.z, 1.5, 160.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      #include <fog_pars_fragment>
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        if (r > 1.0) discard;
        float a = exp(-r * 5.0) * 0.85 + exp(-r * 40.0) * 0.6;
        #ifdef USE_FOG
          a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        #endif
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const p = new THREE.Points(g, mat);
  p.name = 'tc-lamp-halos';
  p.frustumCulled = false;
  p.renderOrder = 3;
  return p;
}
