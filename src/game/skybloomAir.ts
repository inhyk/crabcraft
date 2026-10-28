import * as THREE from 'three';
import {SkybloomSky} from './skybloomSky';
import {skybloomClouds,CLOUD_Y} from './skybloomClouds';
import {skybloomLand,clipTerrainToLip} from './skybloomIsles';

/*
 * Everything in Skybloom's air, built from one sky: the dome, the sun and the hemisphere light it implies, the fog
 * and environment map read off it, the cloud sea below, the cliff skirt and floating isles, the falls and their mist,
 * drifting petals and pollen, and a few gulls wheeling round the island. SkybloomIsland mounts it once; world2 calls
 * frame() every frame to keep the fog on the camera's horizon and the environment map bound only while it is shown.
 */

const PETAL_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float time;
uniform float pixel;
varying vec3 vCol;
varying float vSpin;
varying float vAlpha;
varying float vKind;
const vec3 BOX=vec3(150.,36.,150.);
void main(){
  float kind=step(.62,aSeed.w);
  vec3 p=aSeed.xyz*BOX;
  // Carried on the wind from the south-east, sinking and lifting in the gusts.
  float t=time*(kind>.5?.35:1.);
  p.xz+=vec2(-1.6,-1.1)*t*(.6+aSeed.w*.8);
  p.x+=sin(t*.9+aSeed.z*40.)*1.4;p.z+=cos(t*.7+aSeed.x*40.)*1.1;
  p.y=mod(p.y-t*(.35+aSeed.y*.3)+sin(t*.6+aSeed.x*30.)*.8,BOX.y)+4.;
  vec2 half_=BOX.xz*.5;
  vec2 rel=mod(p.xz-cameraPosition.xz+half_,BOX.xz)-half_;
  p.xz=cameraPosition.xz+rel;
  vec4 mv=viewMatrix*vec4(p,1.);
  float dist=-mv.z;
  float size=(kind>.5?.07:.16+fract(aSeed.w*17.)*.1)*pixel/max(dist,1.);
  gl_PointSize=clamp(size,1.,kind>.5?4.:16.);
  gl_Position=projectionMatrix*mv;
  float m=max(abs(rel.x),abs(rel.y))/half_.x;
  vAlpha=(1.-smoothstep(.38,.5,m))*smoothstep(1.5,4.,dist)*(1.-smoothstep(55.,90.,dist));
  vec3 pink=vec3(.95,.62,.7),white=vec3(1.,.97,.92),lilac=vec3(.72,.65,.95),butter=vec3(.98,.86,.5);
  float c=fract(aSeed.w*7.3);
  vCol=kind>.5?vec3(1.,.9,.55):c<.45?pink:c<.75?white:c<.9?lilac:butter;
  vSpin=t*(1.5+aSeed.x*2.)+aSeed.z*20.;
  vKind=kind;
}
`;
const PETAL_FRAG = /* glsl */ `
uniform vec3 sunLight;
uniform vec3 skyLight;
varying vec3 vCol;
varying float vSpin;
varying float vAlpha;
varying float vKind;
void main(){
  vec2 p=gl_PointCoord-.5;
  float a;
  vec3 col;
  if(vKind>.5){
    // Pollen: a soft warm mote catching the sun.
    a=1.-smoothstep(.1,.5,length(p));
    col=vCol*1.6;
  }else{
    // A petal tumbling: an almond that narrows as it turns edge-on, brighter when its face turns to the sun.
    float c=cos(vSpin),s=sin(vSpin);p=mat2(c,s,-s,c)*p;
    float face=abs(sin(vSpin*.7));
    p.x/=max(.25,face);
    float r=length(p*vec2(1.,1.7))+p.y*.35;
    a=1.-smoothstep(.3,.42,r);
    col=vCol*(skyLight+sunLight*(.25+.75*face));
  }
  a*=vAlpha;
  if(a<.02)discard;
  gl_FragColor=vec4(col,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BIRD_VERT = /* glsl */ `
attribute vec4 aOrbit;
attribute vec4 aFlight;
attribute float aSpan;
uniform float time;
varying float vShade;
#include <fog_pars_vertex>
void main(){
  // aOrbit: centre x, z, radius, phase. aFlight: height, speed (m/s), size, flap rate.
  float ang=aOrbit.w+time*aFlight.y/aOrbit.z;
  vec3 c=vec3(aOrbit.x+sin(ang)*aOrbit.z,aFlight.x+sin(time*.3+aOrbit.w*3.)*3.,aOrbit.y+cos(ang)*aOrbit.z);
  vec3 fwd=normalize(vec3(cos(ang),0.,-sin(ang)));
  vec3 right=normalize(cross(fwd,vec3(0.,1.,0.)));
  // Flap in bursts, glide between them; the wing bends at the wrist.
  float burst=smoothstep(-.2,.4,sin(time*.35+aOrbit.w*5.));
  float flap=sin(time*aFlight.w+aOrbit.w*11.)*burst;
  vec3 p=position*aFlight.z;
  float span=abs(aSpan);
  p.y+=span*aFlight.z*(flap*.55+.12)*(.6+span*.6);
  vec3 w=c+right*p.x+vec3(0.,p.y,0.)+fwd*p.z;
  // Bank into the turn.
  w.y+=p.x*.18;
  vShade=.75+.25*(1.-span)+flap*.12;
  vec4 mvPosition=viewMatrix*vec4(w,1.);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;
const BIRD_FRAG = /* glsl */ `
uniform vec3 birdLit;
uniform vec3 birdTip;
varying float vShade;
#include <fog_pars_fragment>
void main(){
  vec3 col=mix(birdTip,birdLit,smoothstep(.75,.95,vShade))*vShade;
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** A gull: body diamond and two wings, each in two panels so the tip can bend. x across, z forward, y up. */
function birdGeometry(): THREE.InstancedBufferGeometry {
  const pos = [
    0, 0, 0.55, 0.09, 0, 0, 0, 0, -0.5, -0.09, 0, 0, // body
    0.09, 0, 0.12, 0.75, 0.04, 0.02, 0.75, 0.04, -0.2, 0.09, 0, -0.18, // right inner
    0.75, 0.04, 0.02, 1.35, 0, -0.22, 0.75, 0.04, -0.2, // right tip
    -0.09, 0, 0.12, -0.75, 0.04, 0.02, -0.75, 0.04, -0.2, -0.09, 0, -0.18, // left inner
    -0.75, 0.04, 0.02, -1.35, 0, -0.22, -0.75, 0.04, -0.2, // left tip
  ];
  const span: number[] = [];
  for (let i = 0; i < pos.length; i += 3) span.push(Math.min(1, Math.abs(pos[i]) / 1.35) * Math.sign(pos[i] || 1));
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 13, 12, 11, 14, 13, 15, 17, 16];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  const orbit: number[] = [], flight: number[] = [];
  const flocks = [[40, -20, 150, 45], [-60, 60, 120, 32], [10, -180, 90, 60]];
  flocks.forEach(([x, z, r, h], f) => {
    for (let i = 0; i < 5; i++) {
      const k = f * 5 + i;
      orbit.push(x + Math.sin(k * 2.1) * 6, z + Math.cos(k * 1.7) * 6, r + i * 4, f * 2.1 + i * 0.09);
      flight.push(h + Math.sin(k) * 4, 9 + (k % 3), 1.5 + (k % 4) * 0.2, 5 + (k % 5) * 0.6);
    }
  });
  g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(new Float32Array(orbit), 4));
  g.setAttribute('aFlight', new THREE.InstancedBufferAttribute(new Float32Array(flight), 4));
  g.instanceCount = orbit.length / 4;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 50, -40), 400);
  return g;
}

const PETALS = 900;

export class SkybloomAir {
  /** A clear late morning: the sun 35 degrees up in the east-south-east, a three-quarter side light on the default look up the avenue to the world tree (style-w6.md). */
  readonly sky = new SkybloomSky({azimuth: 67.5, elevation: 35, gain: 1.12});
  readonly sun = new THREE.DirectionalLight();
  readonly hemi = new THREE.HemisphereLight();
  /** Materials with a `time` uniform for the island's update. */
  readonly animated: THREE.ShaderMaterial[] = [];
  private petals?: THREE.Points;
  private clouds?: THREE.ShaderMaterial;
  private bound: {env: THREE.Texture | null; intensity: number} | null = null;
  private quality: 'high' | 'low' | null = null;
  readonly stats = {isles: 0, falls: 0, terrainClipped: 0};

  /** Build it all under `root`. `terrain` (the island's ground mesh) is clipped to the cliff's lip. */
  mount(root: THREE.Object3D, terrain?: THREE.Mesh | null): THREE.ShaderMaterial[] {
    const sky = this.sky;
    root.add(sky.mesh);
    const clouds = skybloomClouds(sky);
    this.clouds = clouds.material;
    root.add(clouds.mesh);
    const mist = sky.cloudShade.clone().lerp(sky.cloudLit, 0.35);
    // Cloud bounce on rock undersides (#c9d3e8 at about 0.4 of the lit cloud, refs-w6-sky 3.1).
    const bounce = new THREE.Color('#c9d3e8').multiplyScalar(0.42);
    const land = skybloomLand({mist, cloudLit: sky.cloudLit, bounce});
    root.add(land.land, land.falls, land.mist);
    this.stats.isles = land.isles; this.stats.falls = land.fallCount;
    if (terrain) this.stats.terrainClipped = clipTerrainToLip(terrain.geometry);
    // Petals and pollen: positions live on the GPU, wrapped round the camera.
    const seeds = new Float32Array(PETALS * 4);
    for (let i = 0; i < seeds.length; i++) { const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453; seeds[i] = h - Math.floor(h); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PETALS * 3), 3));
    pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    const petalMat = new THREE.ShaderMaterial({
      name: 'skybloom-petals', vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, transparent: true, depthWrite: false,
      uniforms: {time: {value: 0}, pixel: {value: 900}, sunLight: {value: sky.sunColor.clone().multiplyScalar(sky.sunIntensity * 0.16)}, skyLight: {value: sky.hemiSky.clone().multiplyScalar(0.18)}},
    });
    const petals = this.petals = new THREE.Points(pg, petalMat);
    petals.name = 'skybloom-petals'; petals.frustumCulled = false;
    petals.onBeforeRender = (renderer, _s, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      petalMat.uniforms.pixel.value = renderer.getDrawingBufferSize(this.tmpSize).y / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 45) / 2)));
    };
    root.add(petals);
    const birdMat = new THREE.ShaderMaterial({
      name: 'skybloom-gulls', vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {time: {value: 0}, birdLit: {value: sky.cloudLit.clone().multiplyScalar(0.85)}, birdTip: {value: new THREE.Color('#3e4a66')}}]),
    });
    const birds = new THREE.Mesh(birdGeometry(), birdMat);
    birds.name = 'skybloom-gulls';
    root.add(birds);
    // The sun and the fill the sky implies. The shadow box covers the whole play area from this sun.
    const sun = this.sun;
    sun.color.copy(sky.sunColor); sun.intensity = sky.sunIntensity;
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: SUN_DISTANCE + 160});
    sun.shadow.camera.updateProjectionMatrix();
    this.shadowTexel = (2 * SHADOW_HALF) / 2048;
    this.sunRight.crossVectors(THREE.Object3D.DEFAULT_UP, sky.sunDir).normalize(); this.sunUp.crossVectors(sky.sunDir, this.sunRight).normalize();
    this.followSun(0, 10, 0);
    sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.12;
    // The fill is a little under the dome's own level: shade keeps 40 to 55 percent of the lit value, not a wash.
    this.hemi.color.copy(sky.hemiSky); this.hemi.groundColor.copy(sky.hemiGround); this.hemi.intensity = 0.75;
    root.add(sun, sun.target, this.hemi);
    root.userData.skybloomAir = {cloudY: CLOUD_Y, ...this.stats};
    this.animated.push(sky.material, clouds.material, ...land.animated, petalMat, birdMat);
    return this.animated;
  }

  /**
   * Per frame from world2: while Skybloom is shown, the fog takes the sky's horizon in the camera's direction and
   * this sky's environment map is bound; once it is not, the map that was there before comes back.
   */
  frame(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, quality: 'high' | 'low', active: boolean): void {
    if (!active) {
      if (this.bound) { if (scene.environment === this.sky.environment(renderer)) { scene.environment = this.bound.env; scene.environmentIntensity = this.bound.intensity; } this.bound = null; }
      return;
    }
    const env = this.sky.environment(renderer);
    if (scene.environment !== env) { this.bound = {env: scene.environment, intensity: scene.environmentIntensity}; scene.environment = env; scene.environmentIntensity = this.sky.envIntensity; }
    const fog = scene.fog, e = camera.matrixWorld.elements;
    // The shadow box sits ahead of the camera, where the frame's shadows are.
    this.followSun(e[12] - e[8] * 45, 10, e[14] - e[10] * 45);
    if (fog instanceof THREE.FogExp2) {
      this.sky.fogColor(-e[8], -e[10], fog.color);
      fog.density = this.sky.fogDensity(e[13], -e[9]);
    }
    if (quality !== this.quality) {
      this.quality = quality;
      this.sky.setQuality(quality);
      const low = quality === 'low', c = this.clouds;
      if (c && ('CLOUD_LOW' in c.defines) !== low) { c.defines = low ? {CLOUD_LOW: ''} : {}; c.needsUpdate = true; }
      this.petals?.geometry.setDrawRange(0, low ? PETALS / 3 : PETALS);
    }
  }
  /** Re-centre the shadow box on (x, y, z), snapped to whole texels so shadow edges do not crawl. */
  private followSun(x: number, y: number, z: number): void {
    const p = this.tmp.set(x, y, z), t = this.shadowTexel, sun = this.sun, dir = this.sky.sunDir;
    const pr = Math.round(p.dot(this.sunRight) / t) * t, pu = Math.round(p.dot(this.sunUp) / t) * t, pf = p.dot(dir);
    sun.target.position.copy(this.sunRight).multiplyScalar(pr).addScaledVector(this.sunUp, pu).addScaledVector(dir, pf);
    sun.position.copy(sun.target.position).addScaledVector(dir, SUN_DISTANCE);
  }
  private shadowTexel = 0.1;
  private readonly sunRight = new THREE.Vector3();
  private readonly sunUp = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpSize = new THREE.Vector2();
}

/** Half-width of the shadow box (metres) and how far up the sun ray its camera sits: a low sun's long shadows fit. */
const SHADOW_HALF = 95, SUN_DISTANCE = 210;
