// Late afternoon over Tidecrown: a low warm sun from the south-west (the city's southern faces glow from the ridge),
// a clear blue sky with soft clouds, a pale sea haze, World I's painted sky and water, and the keep's cyan lantern
// with a beam that reads from far away.
import * as THREE from 'three';
import { createSky, createSkyUniforms, type SkyUniforms } from '../../world/sky';
import { noiseTexture } from '../../world/terrain';
import { createWater, type WaterUniforms } from '../../world/water';
import type { TidecrownTerrain } from './terrain';

/** Toward the sun: south-west, about 24 degrees up. */
export const TC_SUN_DIR = new THREE.Vector3(-0.62, 0.42, 0.72).normalize();
export const TC_FOG = { color: new THREE.Color('#cfd9e2'), density: 0.0012 } as const;
export const TC_ENV_INTENSITY = 0.32;

export interface TidecrownAtmosphere {
  group: THREE.Group;
  skyU: SkyUniforms;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  water: { mesh: THREE.Mesh; uniforms: WaterUniforms };
  lanternLight: THREE.PointLight;
  /** Prefiltered sky for reflections (metal, nacre, glass). */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture;
  update(time: number, camera: THREE.Camera, playerX: number, playerZ: number, ground: (x: number, z: number) => number): void;
  dispose(): void;
}

/** A soft vertical shaft above the lantern: additive, brightest at the core and the base, fading upward. */
function lanternBeam(at: THREE.Vector3): THREE.Mesh {
  const height = 760;
  const geo = new THREE.CylinderGeometry(2.4, 6.5, height, 24, 1, true).translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#53f2e4') }, uStrength: { value: 1 }, uHeight: { value: height } },
    vertexShader: /* glsl */ `
      varying float vH; varying vec3 vN; varying vec3 vV;
      uniform float uHeight;
      void main() {
        vH = position.y / uHeight;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vH; varying vec3 vN; varying vec3 vV;
      uniform vec3 uColor; uniform float uStrength;
      void main() {
        float core = pow(abs(dot(vN, vV)), 2.5);
        float a = core * pow(1.0 - vH, 2.2) * (0.35 + 0.65 * smoothstep(0.0, 0.02, vH)) * uStrength;
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(geo, mat);
  beam.position.copy(at).y += 3;
  beam.name = 'tc-lantern-beam';
  beam.renderOrder = 3;
  beam.frustumCulled = false;
  return beam;
}

/** A halo billboard around the lantern so it still reads as a light when it is a few pixels across. */
function lanternHalo(at: THREE.Vector3): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(220,255,252,1)');
  grad.addColorStop(0.18, 'rgba(83,242,228,0.55)');
  grad.addColorStop(0.5, 'rgba(83,242,228,0.12)');
  grad.addColorStop(1, 'rgba(83,242,228,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  sprite.position.copy(at);
  sprite.scale.setScalar(46);
  sprite.name = 'tc-lantern-halo';
  sprite.renderOrder = 3;
  return sprite;
}

export function buildTidecrownAtmosphere(terrain: TidecrownTerrain, quality: 'low' | 'high', uTime: { value: number }, lanternAt: THREE.Vector3): TidecrownAtmosphere {
  const group = new THREE.Group();
  group.name = 'tidecrown-atmosphere';
  const skyU = createSkyUniforms(uTime, noiseTexture());
  skyU.uSunDir.value.copy(TC_SUN_DIR);
  skyU.uMoonDir.value.set(0.3, 0.5, -0.8).normalize();
  skyU.uZenith.value.set('#2c63c6');
  skyU.uMid.value.set('#9cc0e4');
  skyU.uHorizon.value.set('#f7cf9e');
  skyU.uGround.value.set('#cfd9e2');
  skyU.uSunColor.value.set('#fff1cf');
  skyU.uGlow.value.set('#ffa457');
  skyU.uCloudLit.value.set('#fff5e6');
  skyU.uCloudShade.value.set('#9aabc6');
  skyU.uSunVis.value = 1;
  skyU.uCloudCover.value = 0.52;
  const sky = createSky(skyU);
  group.add(sky);

  const water = createWater(skyU, terrain.heightTexture(), new THREE.Vector2(terrain.minX, terrain.minZ), new THREE.Vector2(terrain.sizeX, terrain.sizeZ), quality);
  water.uniforms.uDeep.value.set('#0c4b7a');
  water.uniforms.uShallow.value.set('#33c1b2');
  water.uniforms.uSunLight.value.set('#ffe1b8');
  (water.mesh.material as THREE.ShaderMaterial).uniforms.uTime = uTime;
  water.mesh.position.set(50, 0, 40);
  group.add(water.mesh);

  // Key light: shadows follow a focus ahead of the camera, snapped to shadow texels.
  const sun = new THREE.DirectionalLight('#ffcb8e', 4.6);
  sun.name = 'tidecrown-sun';
  sun.castShadow = true;
  const shadowSize = quality === 'high' ? 4096 : 2048, extent = quality === 'high' ? 72 : 56;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 620 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.06;
  const hemi = new THREE.HemisphereLight('#bac8dc', '#7d6041', 0.8);
  group.add(sun, sun.target, hemi);

  const lanternLight = new THREE.PointLight('#53f2e4', 520, 120, 1.5);
  lanternLight.position.copy(lanternAt);
  group.add(lanternLight, lanternBeam(lanternAt), lanternHalo(lanternAt));

  let envRT: THREE.WebGLRenderTarget | null = null;
  const focus = new THREE.Vector3(), fwd = new THREE.Vector3();
  const texel = (2 * extent) / shadowSize;
  return {
    group,
    skyU,
    sky,
    sun,
    water,
    lanternLight,
    environment(renderer) {
      if (!envRT) {
        const pmrem = new THREE.PMREMGenerator(renderer), scene = new THREE.Scene();
        scene.add(createSky(skyU));
        envRT = pmrem.fromScene(scene, 0, 0.1, 100);
        pmrem.dispose();
        (scene.children[0] as THREE.Mesh).geometry.dispose();
      }
      return envRT.texture;
    },
    update(time, camera, playerX, playerZ, ground) {
      sky.position.copy(camera.position);
      // Shadows follow the player; a free camera far from the player (cinematics, screenshots) takes them along
      // a little ahead of itself instead.
      if (Math.hypot(camera.position.x - playerX, camera.position.z - playerZ) < 40) focus.set(playerX, 0, playerZ);
      else {
        camera.getWorldDirection(fwd);
        focus.copy(camera.position).addScaledVector(fwd.setY(0).normalize(), THREE.MathUtils.clamp(camera.position.y * 1.1, 14, 48));
      }
      focus.y = ground(focus.x, focus.z);
      focus.x = Math.round(focus.x / texel) * texel;
      focus.z = Math.round(focus.z / texel) * texel;
      sun.position.copy(focus).addScaledVector(TC_SUN_DIR, 300);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      lanternLight.intensity = 520 * (0.9 + 0.1 * Math.sin(time * 1.3));
    },
    dispose() {
      envRT?.dispose();
      sun.shadow.dispose();
      water.uniforms.uHeight.value.dispose();
    },
  };
}
