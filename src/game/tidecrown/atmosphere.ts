// Late afternoon over Tidecrown: a low golden sun from the south-west rakes the limestone (the city's southern faces
// glow from the ridge and the bridge) and throws long shadows; a cool lilac sky fills the shade, a warm haze pales the
// distance, the sky grades from deep blue overhead to a peach horizon, and the keep's cyan lantern sends a beam that
// reads from far away.
import * as THREE from 'three';
import { createSky, createSkyUniforms, type SkyUniforms } from '../../world/sky';
import { noiseTexture } from '../../world/terrain';
import { createWater, type WaterUniforms } from '../../world/water';
import type { TidecrownTerrain } from './terrain';

/** Toward the sun: south-west by west, about 16 degrees up. */
export const TC_SUN_DIR = new THREE.Vector3(-0.83, 0.276, 0.48).normalize();
/** Haze: lilac pearl looking away from the sun, warm gold looking into it. */
export const TC_FOG = { color: new THREE.Color('#dcd6e6'), toward: new THREE.Color('#f4d6ae'), density: 0.0006 } as const;
export const TC_ENV_INTENSITY = 0.24;

export interface TidecrownAtmosphere {
  group: THREE.Group;
  skyU: SkyUniforms;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  water: { mesh: THREE.Mesh; uniforms: WaterUniforms };
  lanternLight: THREE.PointLight;
  /** The haze colour for a camera: warmer the more it faces the sun. */
  hazeColor(camera: THREE.Camera, out: THREE.Color): THREE.Color;
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

/** World I's painted sky with its high wisps thinned, so the sky reads as cumulus over a clear evening. */
function tidecrownSky(u: SkyUniforms): THREE.Mesh {
  const sky = createSky(u), mat = sky.material as THREE.ShaderMaterial;
  mat.fragmentShader = mat.fragmentShader.replace('smoothstep(0.08, 0.3, y) * 0.5', 'smoothstep(0.08, 0.3, y) * 0.2');
  return sky;
}

export function buildTidecrownAtmosphere(terrain: TidecrownTerrain, quality: 'low' | 'high', uTime: { value: number }, lanternAt: THREE.Vector3): TidecrownAtmosphere {
  const group = new THREE.Group();
  group.name = 'tidecrown-atmosphere';
  const skyU = createSkyUniforms(uTime, noiseTexture());
  skyU.uSunDir.value.copy(TC_SUN_DIR);
  skyU.uMoonDir.value.set(0.3, 0.5, -0.8).normalize();
  // Deep blue-violet overhead, a lilac band away from the sun and peach toward it; clouds peach and rose.
  skyU.uZenith.value.set('#4a5fd0');
  skyU.uMid.value.set('#c6b8de');
  skyU.uHorizon.value.set('#ffc68a');
  skyU.uGround.value.set('#e6cfb8');
  skyU.uSunColor.value.set('#fff0cc');
  skyU.uGlow.value.set('#ffa050');
  skyU.uCloudLit.value.set('#ffe4c8');
  skyU.uCloudShade.value.set('#d4b6ca');
  skyU.uSunVis.value = 1;
  skyU.uCloudCover.value = 0.62;
  const sky = tidecrownSky(skyU);
  group.add(sky);

  const water = createWater(skyU, terrain.heightTexture(), new THREE.Vector2(terrain.minX, terrain.minZ), new THREE.Vector2(terrain.sizeX, terrain.sizeZ), quality);
  water.uniforms.uDeep.value.set('#0c4b7a');
  water.uniforms.uShallow.value.set('#33c1b2');
  water.uniforms.uSunLight.value.set('#ffd6a4');
  (water.mesh.material as THREE.ShaderMaterial).uniforms.uTime = uTime;
  water.mesh.position.set(50, 0, 40);
  group.add(water.mesh);

  // Key light: shadows follow a focus ahead of the camera, snapped to shadow texels.
  const sun = new THREE.DirectionalLight('#ffb370', 5.1);
  sun.name = 'tidecrown-sun';
  sun.castShadow = true;
  const shadowSize = quality === 'high' ? 4096 : 2048, extent = quality === 'high' ? 72 : 56;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 620 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.06;
  // Cool lilac sky fill for the shade, warm bounce from the ground.
  const hemi = new THREE.HemisphereLight('#9497ea', '#a27b56', 0.6);
  group.add(sun, sun.target, hemi);

  const lanternLight = new THREE.PointLight('#53f2e4', 520, 120, 1.5);
  lanternLight.position.copy(lanternAt);
  group.add(lanternLight, lanternBeam(lanternAt), lanternHalo(lanternAt));

  let envRT: THREE.WebGLRenderTarget | null = null;
  const focus = new THREE.Vector3(), fwd = new THREE.Vector3(), look = new THREE.Vector3();
  const sunFlat = TC_SUN_DIR.clone().setY(0).normalize();
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
        scene.add(tidecrownSky(skyU));
        envRT = pmrem.fromScene(scene, 0, 0.1, 100);
        pmrem.dispose();
        (scene.children[0] as THREE.Mesh).geometry.dispose();
      }
      return envRT.texture;
    },
    hazeColor(camera, out) {
      camera.getWorldDirection(look);
      const t = (Math.hypot(look.x, look.z) > 1e-3 ? look.setY(0).normalize().dot(sunFlat) : 0) * 0.5 + 0.5;
      return out.copy(TC_FOG.color).lerp(TC_FOG.toward, t * t);
    },
    update(time, camera, playerX, playerZ, ground) {
      sky.position.copy(camera.position);
      // Shadows follow the player; a free camera far from the player (cinematics, screenshots) takes them to the
      // ground it looks down at, or a little ahead of itself.
      if (Math.hypot(camera.position.x - playerX, camera.position.z - playerZ) < 40) focus.set(playerX, 0, playerZ);
      else {
        camera.getWorldDirection(fwd);
        const down = fwd.y < -0.08 ? (camera.position.y - ground(camera.position.x, camera.position.z)) / -fwd.y : 0;
        if (down > 48) focus.copy(camera.position).addScaledVector(fwd, Math.min(down, 420));
        else focus.copy(camera.position).addScaledVector(fwd.setY(0).normalize(), THREE.MathUtils.clamp(camera.position.y * 1.1, 14, 48));
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
