import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe, tube} from '../world/geom';
import {dawnBrass, dawnGlows, dawnLanternGlass, dawnSandstone, solidPart} from './dawnMaterials';
import {dawnLampPosts} from './world3Colliders';

/*
 * Dawnharbor's road lamps: a turned sandstone foot, a slender iron post with a collar and finial, a scrolled arm
 * reaching over the road and a six-paned lantern hanging from it, lit amber with a soft halo. All posts merge into
 * one mesh per material (stone, iron, glass) plus one draw of halos.
 */

/** Height of the arm above the ground, and its reach from the post to the lantern's hook. */
const ARM_Y = 2.95, REACH = .82;
/** The lantern's centre, below the hook. */
const LANTERN_DROP = .38;

export interface DawnLamps {group: THREE.Group; flames: THREE.Vector3[]; update(time: number): void}

/** `extra`: lamps standing on masonry at height y (no foot, a shorter post), e.g. the harbour parapet's piers. */
export function dawnLamps(height: (x: number, z: number) => number, extra: readonly {x: number; y: number; z: number; yaw: number}[] = []): DawnLamps {
  const group = new THREE.Group(); group.name = 'dawnharbor-road-lamps';
  const all = [...dawnLampPosts().map(p => ({...p, y: null as number | null})), ...extra.map(p => ({...p, y: p.y as number | null}))];
  const {stone, iron, panes, flames} = lampParts(height, all);
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow: boolean) => {
    const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose());
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
  };
  add(stone, dawnSandstone('dawnharbor-lamp-foot'), 'dawnharbor-lamp-feet', true);
  add(iron, dawnBrass('goldsand-lamp-brass'), 'dawnharbor-lamp-iron', true);
  add(panes, dawnLanternGlass(), 'dawnharbor-lamp-glass', false);
  const halo = dawnGlows(flames.map(pos => ({pos, size: 1.5})), '#ffb763', 'dawnharbor-lamp-halos');
  group.add(halo);
  group.userData.lamps = flames.length;
  // The solid posts (the ones on the ground; lamps on masonry stand past the walk limit).
  group.userData.posts = dawnLampPosts().map(p => [p.x, p.z]);
  return {group, flames, update(time) { (halo.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }};
}

/**
 * The lamps' geometry, world space, merged per material by the caller: stone feet, iron (post, arm, scrolls, lantern
 * frame), glass panes (uv kept: the glow is hottest low in the pane), and where each flame burns. `y` set: the lamp
 * stands on masonry at that height, no foot and a shorter post.
 */
export function lampParts(height: (x: number, z: number) => number, all: readonly {x: number; z: number; yaw: number; y: number | null}[]) {
  const foot = lathe([[0, 0], [.33, 0], [.33, .1], [.29, .14], [.25, .16], [.21, .22], [.2, .44], [.24, .5], [.29, .53], [.29, .6], [.2, .64], [0, .64]], 20);
  // A turned sandstone column with a moulded neck and a capital the brass arm springs from.
  const post = lathe([[0, .6], [.16, .6], [.15, .7], [.13, .78], [.12, 2.3], [.15, 2.36], [.15, 2.42], [.12, 2.48], [.11, ARM_Y - .12], [.17, ARM_Y - .04], [.19, ARM_Y + .06], [.15, ARM_Y + .12], [.06, ARM_Y + .16], [.07, ARM_Y + .28], [.02, ARM_Y + .36], [0, ARM_Y + .38]], 16);
  // The arm: straight out, ending in a small down-turned curl for the hook; a scrolled brace under it.
  const arm = tube([new THREE.Vector3(0, ARM_Y, 0), new THREE.Vector3(REACH * .5, ARM_Y + .02, 0), new THREE.Vector3(REACH, ARM_Y, 0), new THREE.Vector3(REACH + .05, ARM_Y - .04, 0)], () => .026, 8);
  const braceCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(.04, ARM_Y - .55, 0), new THREE.Vector3(.12, ARM_Y - .2, 0), new THREE.Vector3(.35, ARM_Y - .05, 0), new THREE.Vector3(.6, ARM_Y - .01, 0));
  const brace = tube(braceCurve.getPoints(14), (t) => .02 - .006 * t, 7);
  const scrollPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 1.7, r = .11 * (1 - i / 30); scrollPts.push(new THREE.Vector3(.2 + Math.sin(a) * r, ARM_Y - .16 - (1 - Math.cos(a)) * r * .9, 0)); }
  const scroll = tube(scrollPts, () => .014, 6);
  const hook = new THREE.TorusGeometry(.04, .009, 6, 12);
  // The lantern in its own frame: hook at y=0, a domed cap, six amber panes flaring up, a tray and a drop.
  const cap = lathe([[0, -.2], [.15, -.2], [.19, -.19], [.17, -.17], [.03, -.06], [.03, -.03], [0, -.02]], 6);
  const glass = new THREE.LatheGeometry([new THREE.Vector2(.11, -.6), new THREE.Vector2(.15, -.2)], 6);
  const tray = lathe([[0, -.7], [.03, -.7], [.04, -.66], [.13, -.63], [.14, -.6], [.12, -.59], [0, -.59]], 6);
  const mullion = new THREE.CylinderGeometry(.008, .008, .42, 4);
  const stone: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], panes: THREE.BufferGeometry[] = [], flames: THREE.Vector3[] = [];
  const m = new THREE.Matrix4(), l = new THREE.Matrix4();
  for (const p of all) {
    // The foot sits a little into the ground on the downhill side; a lamp on masonry stands on it, shorter.
    let low = Infinity;
    for (let a = 0; a < 8; a++) low = Math.min(low, height(p.x + Math.cos(a * .785) * .33, p.z + Math.sin(a * .785) * .33));
    const onWall = p.y !== null, y = onWall ? p.y! - .6 * .7 : low - .06;
    // Local +x is the arm's direction.
    const ys = onWall ? .7 : 1;
    m.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw - Math.PI / 2), new THREE.Vector3(1, 1, 1));
    const mp = m.clone().multiply(new THREE.Matrix4().makeScale(1, ys, 1));
    if (!onWall) stone.push(solidPart(foot, m));
    stone.push(solidPart(post, mp));
    for (const g of [brace, scroll]) iron.push(solidPart(g, mp));
    // The arm and the lantern keep their shape; only the post is shorter.
    iron.push(solidPart(arm, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, ARM_Y * (ys - 1), 0))));
    iron.push(solidPart(hook, l.multiplyMatrices(m, new THREE.Matrix4().makeTranslation(REACH + .05, ARM_Y * ys - .07, 0))));
    const lm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(REACH + .05, ARM_Y * ys - .1, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 6)));
    iron.push(solidPart(cap, lm), solidPart(tray, lm));
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, r = .13;
      const mm = new THREE.Matrix4().makeTranslation(Math.sin(a) * r, -.4, Math.cos(a) * r).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), .1));
      iron.push(solidPart(mullion, new THREE.Matrix4().multiplyMatrices(lm, mm)));
    }
    panes.push(solidPart(glass, lm, true));
    flames.push(new THREE.Vector3(0, -LANTERN_DROP, 0).applyMatrix4(lm));
  }
  for (const g of [foot, post, arm, brace, scroll, hook, cap, glass, tray, mullion]) g.dispose();
  return {stone, iron, panes, flames};
}

/** Oil braziers: a brass bowl on three curved legs, glowing coals and a flickering flame, with a halo. */
export function dawnBraziers(height: (x: number, z: number) => number, spots: readonly {x: number; z: number}[]): {group: THREE.Group; update(time: number): void} {
  const group = new THREE.Group(); group.name = 'goldsand-braziers';
  const brass: THREE.BufferGeometry[] = [], coals: THREE.BufferGeometry[] = [], flames: THREE.BufferGeometry[] = [], glow: {pos: THREE.Vector3; size: number}[] = [];
  const bowl = lathe([[0, .82], [.12, .82], [.3, .9], [.42, 1.04], [.46, 1.12], [.43, 1.13], [.38, 1.06], [.26, .97], [0, .95]], 20);
  const ring = new THREE.TorusGeometry(.2, .025, 6, 16).rotateX(Math.PI / 2);
  for (const s of spots) {
    const y = height(s.x, s.z), m = new THREE.Matrix4().makeTranslation(s.x, y, s.z);
    brass.push(solidPart(bowl, m), solidPart(ring, new THREE.Matrix4().makeTranslation(s.x, y + .45, s.z)));
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const leg = tube([new THREE.Vector3(c * .38, 0, sn * .38), new THREE.Vector3(c * .3, .3, sn * .3), new THREE.Vector3(c * .2, .6, sn * .2), new THREE.Vector3(c * .3, .92, sn * .3)], () => .025, 6);
      brass.push(solidPart(leg, m)); leg.dispose();
    }
    const coal = new THREE.CircleGeometry(.37, 16).rotateX(-Math.PI / 2);
    coals.push(solidPart(coal, new THREE.Matrix4().makeTranslation(s.x, y + 1.0, s.z))); coal.dispose();
    for (const a of [0, Math.PI / 2]) {
      const q = new THREE.PlaneGeometry(.7, 1.1).translate(0, .55, 0).rotateY(a);
      flames.push(solidPart(q, new THREE.Matrix4().makeTranslation(s.x, y + .98, s.z), true)); q.dispose();
    }
    glow.push({pos: new THREE.Vector3(s.x, y + 1.35, s.z), size: 2.6});
  }
  bowl.dispose(); ring.dispose();
  const time = {value: 0};
  const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow: boolean) => { if (!geos.length) return; const g = mergeGeometries(geos, false)!; geos.forEach(x => x.dispose()); g.computeBoundingSphere(); const me = new THREE.Mesh(g, mat); me.name = name; me.castShadow = shadow; group.add(me); return me; };
  mk(brass, dawnBrass('goldsand-brazier-brass'), 'goldsand-brazier-brass', true);
  mk(coals, new THREE.MeshStandardMaterial({name: 'goldsand-coals', color: '#2a1206', emissive: '#ff5a14', emissiveIntensity: 2.2, roughness: .9}), 'goldsand-brazier-coals', false);
  const flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: {uTime: time},
    vertexShader: 'varying vec2 vU;varying vec3 vW;void main(){vU=uv;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: /* glsl */ `uniform float uTime;varying vec2 vU;varying vec3 vW;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
      void main(){vec2 p=vU;float seed=vW.x*1.7+vW.z;
        float t=uTime*2.2;float nn=n(vec2(p.x*4.+seed,p.y*3.-t))*.6+n(vec2(p.x*9.-seed,p.y*7.-t*1.7))*.4;
        float w=(1.-p.y)*.42+.04;float d=abs(p.x-.5+ (nn-.5)*.25*p.y)/w;
        float body=(1.-smoothstep(.55,1.,d+p.y*.35+nn*.35))*smoothstep(0.,.08,p.y);
        if(body<.01)discard;
        vec3 c=mix(vec3(1.,.85,.45),vec3(1.,.35,.06),smoothstep(.15,.8,p.y+d*.3));
        gl_FragColor=vec4(c*body*1.6,1.);}`,
  });
  mk(flames, flameMat, 'goldsand-brazier-flames', false);
  const halo = dawnGlows(glow, '#ff9a3c', 'goldsand-brazier-glows'); group.add(halo);
  group.userData.braziers = spots.length;
  return {group, update(t) { time.value = t; (halo.material as THREE.ShaderMaterial).uniforms.uTime.value = t; }};
}
