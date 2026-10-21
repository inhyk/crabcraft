// Deep opacity shadow maps for the fur (Kim and Neumann 2001): the coat is drawn from its key light,
// first for the nearest hair at each texel, then summed into eight depth slabs behind that, so any
// point of any hair can read how much hair lies between it and the light. Strands bent by the wind
// shade their neighbours on every frame, the gaps between locks go dark, and snow clumps leave a
// contact shadow on the hair under them. The shell is in it too, as the groom's ellipsoid.
import * as THREE from 'three';
import { BITS_SHADOW_VERT, HAIR_SHADOW_VERT } from './shader';

/** Slab boundaries behind the nearest hair, robot metres (scaled by the rig to world units). */
const SLABS = [0.0004, 0.001, 0.002, 0.0035, 0.0055, 0.008, 0.012, 0.02];

const DEPTH_FRAG = /* glsl */ `
uniform float uNear;
uniform float uFar;
in float vDepth;
in float vAlpha;
in vec2 vCorner;
layout(location = 0) out vec4 oDepth;
void main() {
  if (vAlpha <= 0.0 || dot(vCorner, vCorner) > 1.0) discard;
  oDepth = vec4(clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

const OPACITY_FRAG = /* glsl */ `
uniform highp sampler2D uDomD0;
uniform vec4 uDomB0;
uniform vec4 uDomB1;
uniform float uNear;
uniform float uFar;
in float vDepth;
in float vAlpha;
in vec2 vCorner;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  if (vAlpha <= 0.0 || dot(vCorner, vCorner) > 1.0) discard;
  float d0 = uNear + texelFetch(uDomD0, ivec2(gl_FragCoord.xy), 0).r * (uFar - uNear);
  float z = vDepth - d0;
  // Cumulative: a fragment counts in every slab whose far side is behind it.
  o0 = vAlpha * step(vec4(z), uDomB0);
  o1 = vAlpha * step(vec4(z), uDomB1);
}
`;

const SHELL_VERT = /* glsl */ `
uniform float uAlpha;
out float vDepth;
out float vAlpha;
out vec2 vCorner;
void main() {
  vCorner = vec2(0.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  vAlpha = uAlpha;
  gl_Position = projectionMatrix * mv;
}
`;

/** Shared by every fur material that reads the map (hair and snow of every set of an actor). */
export interface DomUniforms {
  uDomOn: THREE.IUniform<number>;
  uDomD0: THREE.IUniform<THREE.Texture | null>;
  uDomL0: THREE.IUniform<THREE.Texture | null>;
  uDomL1: THREE.IUniform<THREE.Texture | null>;
  uDomMat: THREE.IUniform<THREE.Matrix4>;
  uDomView: THREE.IUniform<THREE.Matrix4>;
  uDomB0: THREE.IUniform<THREE.Vector4>;
  uDomB1: THREE.IUniform<THREE.Vector4>;
  uDomNear: THREE.IUniform<number>;
  uDomFar: THREE.IUniform<number>;
  uDomK: THREE.IUniform<number>;
  uDomBias: THREE.IUniform<number>;
}

interface Caster {
  /** The drawn mesh whose world matrix the caster follows. */
  of: THREE.Object3D;
  proxy: THREE.Mesh;
  depth: THREE.ShaderMaterial;
  opacity: THREE.ShaderMaterial;
}

export class FurShadow {
  readonly uniforms: DomUniforms;
  private readonly depthRT: THREE.WebGLRenderTarget;
  private readonly layerRT: THREE.WebGLRenderTarget;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly scene = new THREE.Scene();
  private readonly casters: Caster[] = [];
  /** Per pass uniforms every caster shares. */
  private readonly pass = {
    uNear: { value: 0.1 },
    uFar: { value: 10 },
    uTexel: { value: 0.001 },
    uOrtho: { value: 1 },
  };
  private shell: Caster | null = null;

  constructor(readonly res: number) {
    this.depthRT = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.FloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.layerRT = new THREE.WebGLRenderTarget(res, res, {
      count: 2,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.uniforms = {
      uDomOn: { value: 0 },
      uDomD0: { value: this.depthRT.texture },
      uDomL0: { value: this.layerRT.textures[0] },
      uDomL1: { value: this.layerRT.textures[1] },
      uDomMat: { value: new THREE.Matrix4() },
      uDomView: { value: new THREE.Matrix4() },
      uDomB0: { value: new THREE.Vector4() },
      uDomB1: { value: new THREE.Vector4() },
      uDomNear: { value: 0.1 },
      uDomFar: { value: 10 },
      uDomK: { value: 1 },
      uDomBias: { value: 0 },
    };
    this.scene.matrixWorldAutoUpdate = false;
  }

  private caster(of: THREE.Object3D, geometry: THREE.BufferGeometry, vert: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side): Caster {
    const shared = { ...uniforms, ...this.pass, uDomD0: this.uniforms.uDomD0, uDomB0: this.uniforms.uDomB0, uDomB1: this.uniforms.uDomB1 };
    const make = (frag: string, additive: boolean) => {
      const m = new THREE.ShaderMaterial({
        name: additive ? 'fur-dom-opacity' : 'fur-dom-depth',
        glslVersion: THREE.GLSL3,
        vertexShader: vert,
        fragmentShader: frag,
        side,
        depthTest: !additive,
        depthWrite: !additive,
        blending: additive ? THREE.CustomBlending : THREE.NoBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      m.uniforms = shared;
      return m;
    };
    const depth = make(DEPTH_FRAG, false);
    const opacity = make(OPACITY_FRAG, true);
    const proxy = new THREE.Mesh(geometry, depth);
    proxy.matrixAutoUpdate = false;
    proxy.frustumCulled = false;
    this.scene.add(proxy);
    const c = { of, proxy, depth, opacity };
    this.casters.push(c);
    return c;
  }

  /** A set's hair: the same ribbons and strand texture as the drawn mesh. */
  addHair(mesh: THREE.Mesh, strand: Record<string, THREE.IUniform>, hair: THREE.ShaderMaterial): void {
    const u = hair.uniforms;
    this.caster(mesh, mesh.geometry, HAIR_SHADOW_VERT, { ...strand, uTipWidth: u.uTipWidth, uWidthMul: u.uWidthMul, uAlphaK: { value: 1 } }, THREE.DoubleSide);
  }

  /** A set's snow bits: opaque, so a clump shades the hair under it. */
  addBits(mesh: THREE.Mesh, strand: Record<string, THREE.IUniform>): void {
    this.caster(mesh, mesh.geometry, BITS_SHADOW_VERT, { ...strand, uAlphaK: { value: 3 } }, THREE.DoubleSide);
  }

  /** The carapace as the groom's ellipsoid (bind space, metres), riding `bone` through `inverse`. */
  addShell(bone: THREE.Object3D, inverse: THREE.Matrix4, centre: THREE.Vector3, radii: THREE.Vector3): void {
    const holder = new THREE.Object3D();
    holder.matrixAutoUpdate = false;
    const g = new THREE.SphereGeometry(1, 48, 32);
    g.applyMatrix4(new THREE.Matrix4().makeScale(radii.x, radii.y, radii.z).setPosition(centre));
    g.applyMatrix4(inverse);
    bone.add(holder);
    this.shell = this.caster(holder, g, SHELL_VERT, { uAlpha: { value: 40 } }, THREE.FrontSide);
  }

  /**
   * Draws the map for a key light coming from `toLight` (world), over a sphere of the coat at
   * `centre` with `radius`, for a rig `scale` world units to the robot metre.
   */
  render(renderer: THREE.WebGLRenderer, toLight: THREE.Vector3, centre: THREE.Vector3, radius: number, scale: number, k: number): void {
    const cam = this.cam;
    const L = toLight.clone().normalize();
    cam.position.copy(centre).addScaledVector(L, radius * 2);
    cam.up.set(0, 1, 0);
    if (Math.abs(L.y) > 0.98) cam.up.set(0, 0, 1);
    cam.lookAt(centre);
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = radius * 0.5;
    cam.far = radius * 3.5;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.pass.uNear.value = cam.near;
    this.pass.uFar.value = cam.far;
    this.pass.uTexel.value = (radius * 2) / this.res;
    const U = this.uniforms;
    U.uDomView.value.copy(cam.matrixWorldInverse);
    U.uDomMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    U.uDomB0.value.set(SLABS[0], SLABS[1], SLABS[2], SLABS[3]).multiplyScalar(scale);
    U.uDomB1.value.set(SLABS[4], SLABS[5], SLABS[6], SLABS[7]).multiplyScalar(scale);
    U.uDomNear.value = cam.near;
    U.uDomFar.value = cam.far;
    U.uDomK.value = k;
    // A hair does not shade itself: look up a strand's width nearer the light.
    U.uDomBias.value = 0.0003 * scale;
    for (const c of this.casters) {
      c.of.updateWorldMatrix(true, false);
      c.proxy.matrixWorld.copy(c.of.matrixWorld);
      c.proxy.visible = c.of === this.shell?.of || c.of.visible;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.depthRT);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    for (const c of this.casters) c.proxy.material = c.depth;
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(this.layerRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    for (const c of this.casters) c.proxy.material = c.opacity;
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    U.uDomOn.value = 1;
  }

  dispose(): void {
    for (const c of this.casters) {
      c.depth.dispose();
      c.opacity.dispose();
      c.proxy.removeFromParent();
    }
    this.shell?.of.removeFromParent();
    this.shell?.proxy.geometry.dispose();
    this.depthRT.dispose();
    this.layerRT.dispose();
  }
}
