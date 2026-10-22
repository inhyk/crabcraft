// Gulls wheeling round the spire, over the harbour and above the estuary: one instanced draw, flight and wingbeat in
// the vertex shader from per-bird orbit parameters.
import * as THREE from 'three';
import { rng } from '../../world/noise';
import { TC_KEEP, tcAxis } from './layout';

/** Flock centres (x, y, z), orbit radius range and bird count. */
const [EX, EZ] = tcAxis(-50);
const FLOCKS: [number, number, number, number, number, number][] = [
  [TC_KEEP.x, 150, TC_KEEP.z, 34, 70, 18],
  [262, 34, 0, 26, 60, 16],
  [EX, 36, EZ, 30, 55, 12],
];

export function buildGulls(uTime: { value: number }): THREE.Mesh {
  // A bird: two swept wings meeting at a short body, 2.2 across.
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, -1.1, 0.05, -0.35, 0, 0, -0.2, 0, 0, 0.5, 0, 0, -0.2, 1.1, 0.05, -0.35, 0, 0.02, 0.5, 0, 0.02, -0.7, 0.12, 0, -0.1], 3));
  const R = rng(733), centre: number[] = [], orbit: number[] = [];
  let count = 0;
  for (const [x, y, z, r0, r1, n] of FLOCKS) {
    for (let i = 0; i < n; i++) {
      centre.push(x + (R() - 0.5) * 20, y + (R() - 0.5) * 22, z + (R() - 0.5) * 20);
      orbit.push(r0 + R() * (r1 - r0), (0.12 + R() * 0.12) * (R() < 0.5 ? -1 : 1), R() * Math.PI * 2, R() * Math.PI * 2);
      count++;
    }
  }
  geo.setAttribute('aCentre', new THREE.InstancedBufferAttribute(new Float32Array(centre), 3));
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(new Float32Array(orbit), 4));
  geo.instanceCount = count;
  const mat = new THREE.MeshBasicMaterial({ name: 'tc-gulls', color: '#f3efe6', side: THREE.DoubleSide, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aCentre;\nattribute vec4 aOrbit;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        {
          float a = aOrbit.z + uTime * aOrbit.y;
          vec3 c = aCentre + vec3(cos(a) * aOrbit.x, sin(uTime * 0.31 + aOrbit.w) * 4.0, sin(a) * aOrbit.x);
          vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(aOrbit.y));
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
          float span = abs(position.x);
          // Wingbeats with glides between them; banked into the turn.
          float beat = sin(uTime * 7.0 + aOrbit.w * 5.0) * (0.55 + 0.45 * sin(uTime * 0.7 + aOrbit.w));
          vec3 up = normalize(vec3(0.0, 1.0, 0.0) - right * 0.35 * sign(aOrbit.y));
          transformed = c + right * position.x * 1.6 + up * (position.y + span * beat * 0.7) + fwd * position.z * 1.6;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'tc-gulls';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'tidecrown-gulls';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  return mesh;
}
