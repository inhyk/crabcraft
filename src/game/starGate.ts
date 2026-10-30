import * as THREE from 'three';
import {moonstoneMaterial,silverMaterial,StoneBuilder} from './starMasonry';
import {starCrystalCluster,starCrystalMaterial} from './starCrystals';

/*
 * Starhaven's own gateway (World II only; StarPortal stays as it is for the other worlds): a moonstone arch on a
 * stepped round dais, voussoirs with sunk joints and a silver band set into both faces, a violet crystal in a silver
 * cradle on the keystone and the night itself in the opening, stars streaming toward its heart through a veil of
 * aurora. Same footprint, travel point (the root) and update(time) as StarPortal.
 */

const DAIS = .42, RX = 3.2, SPRING = 3.35, RING = .8, DEPTH = 1.05;
const INNER = RX - RING / 2;

const OPENING_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uTime;
float gh(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gh(i),gh(i+vec2(1.,0.)),f.x),mix(gh(i+vec2(0.,1.)),gh(i+1.),f.x),f.y);}
void main(){
  // Distance to the opening's edge (a stilted semicircle) and polar coordinates round its heart.
  vec2 c=vec2(0.,${SPRING.toFixed(2)});
  float edge=vP.y>c.y?${INNER.toFixed(3)}-length(vP-c):min(${INNER.toFixed(3)}-abs(vP.x),vP.y-${DAIS.toFixed(2)});
  vec2 q=vP-vec2(0.,${(SPRING - .2).toFixed(2)});
  float r=length(q),a=atan(q.y,q.x);
  float t=uTime;
  vec3 col=mix(vec3(.004,.006,.03),vec3(.02,.03,.09),smoothstep(3.,0.,r));
  // Streams of stars falling inward along a slow spiral.
  float lr=log(r+.05);
  vec2 g=vec2((a+lr*1.6)*7./6.2831853*6.,lr*7.+t*.9);
  vec2 cell=floor(g),f=fract(g)-.5;
  float h=gh(cell),star=0.;
  if(h>.55){vec2 o=(vec2(gh(cell+3.1),gh(cell+7.7))-.5)*.6;star=smoothstep(.16,0.,length(f-o))*(.4+.6*gh(cell+1.3));}
  col+=vec3(.75,.85,1.)*star*1.6*smoothstep(.05,.6,r);
  // A veil of aurora wound round the heart, green to violet.
  float veil=gn(vec2(a*2.+lr*3.-t*.25,lr*2.+t*.15))*.7+gn(vec2(a*5.-t*.4,lr*5.))*.3;
  veil=smoothstep(.45,.9,veil);
  col+=mix(vec3(.05,.55,.38),vec3(.38,.16,.85),.5+.5*sin(a*2.+t*.3))*veil*.55*smoothstep(3.2,.6,r);
  // The heart: a pale moon-white glow.
  col+=vec3(.6,.68,1.)*exp(-r*r*2.2)*.9;
  // A bright rim where the night meets the stone.
  float rim=exp(-max(edge,0.)*7.);
  col+=vec3(.4,.55,1.)*rim*.9;
  gl_FragColor=vec4(col,smoothstep(0.,.05,edge)*.97);
}
`;

export class StarGate {
  readonly root = new THREE.Group();
  private opening: THREE.ShaderMaterial;
  private motes: THREE.Points;
  constructor(position: THREE.Vector3, label: string) {
    this.root.position.copy(position);this.root.name = label;
    const stone = moonstoneMaterial({color: '#a9a8b8', block: [.9, .55]}), silver = silverMaterial();
    const body = new StoneBuilder(), trim = new StoneBuilder(), one = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), m = new THREE.Matrix4();
    // Dais: three stepped rings, each a 48-sided band with a chamfered lip (joints radiate from the centre).
    const ringBand = (r0: number, r1: number, y0: number, y1: number, sides = 48) => {
      for (let k = 0; k < sides; k++) {
        const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2;
        const p = (a: number, r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
        const out = new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2));
        if (r0 === r1) {
          body.tri(p(a0, r0, y0), p(a1, r0, y0), p(a1, r0, y1), [a0 * r0, y0], [a1 * r0, y0], [a1 * r0, y1], out);
          body.tri(p(a0, r0, y0), p(a1, r0, y1), p(a0, r0, y1), [a0 * r0, y0], [a1 * r0, y1], [a0 * r0, y1], out);
        } else {
          const up = new THREE.Vector3(0, 1, 0);
          body.tri(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), [a0 * 3, r0], [a1 * 3, r0], [a1 * 3, r1], up);
          body.tri(p(a0, r0, y0), p(a1, r1, y1), p(a0, r1, y1), [a0 * 3, r0], [a1 * 3, r1], [a0 * 3, r1], up);
        }
      }
    };
    ringBand(4.05, 4.05, -.3, .1);ringBand(4.05, 3.9, .1, .14);ringBand(3.9, 3.62, .14, .14);
    ringBand(3.62, 3.62, .14, .28);ringBand(3.62, 3.5, .28, .31);ringBand(3.5, 3.2, .31, .31);
    ringBand(3.2, 3.2, .31, DAIS);ringBand(3.2, 0.001, DAIS, DAIS, 48);
    // Silver ring set into the top step round the travel point.
    for (let k = 0; k < 64; k++) {
      const a0 = k / 64 * Math.PI * 2, a1 = (k + 1) / 64 * Math.PI * 2, up = new THREE.Vector3(0, 1, 0);
      const p = (a: number, r: number) => new THREE.Vector3(Math.cos(a) * r, DAIS + .004, Math.sin(a) * r);
      trim.tri(p(a0, 2.55), p(a1, 2.55), p(a1, 2.68), [0, 0], [0, 0], [0, 0], up);trim.tri(p(a0, 2.55), p(a1, 2.68), p(a0, 2.68), [0, 0], [0, 0], [0, 0], up);
    }
    // Piers: plinth, shaft and an impost stepping out under the springing.
    for (const s of [-1, 1]) {
      m.compose(new THREE.Vector3(s * RX, DAIS, 0), q.identity(), one);
      body.stack([{y: -.05, hw: .64, ch: .16}, {y: .42, hw: .64, ch: .16}, {y: .42, hw: .5, ch: .12}, {y: SPRING - DAIS - .34, hw: .47, ch: .11},
        {y: SPRING - DAIS - .34, hw: .6, ch: .15}, {y: SPRING - DAIS - .02, hw: .62, ch: .16}, {y: SPRING - DAIS - .02, hw: .5, ch: .12}, {y: SPRING - DAIS, hw: .5, ch: .12}], m);
      trim.stack([{y: .44, hw: .53, ch: .13}, {y: .52, hw: .53, ch: .13}], m);
    }
    // Voussoirs: a semicircle of eleven, each its own block with open joints; the keystone stands proud.
    const N = 11, hd = DEPTH / 2;
    const P = (a: number, r: number, z: number) => new THREE.Vector3(Math.cos(a) * r, SPRING + Math.sin(a) * r, z);
    for (let i = 0; i < N; i++) {
      const key = i === (N - 1) / 2, a0 = i / N * Math.PI + .012, a1 = (i + 1) / N * Math.PI - .012, ri = INNER - (key ? .06 : 0), ro = RX + RING / 2 + (key ? .22 : 0), d = hd + (key ? .1 : 0);
      const steps = 3;
      for (let k = 0; k < steps; k++) {
        const b0 = a0 + (a1 - a0) * k / steps, b1 = a0 + (a1 - a0) * (k + 1) / steps, u0 = b0 * 3, u1 = b1 * 3;
        for (const z of [-d, d]) {
          const out = new THREE.Vector3(0, 0, z);
          body.tri(P(b0, ri, z), P(b1, ri, z), P(b1, ro, z), [u0, .3], [u1, .3], [u1, .3], out);body.tri(P(b0, ri, z), P(b1, ro, z), P(b0, ro, z), [u0, .3], [u1, .3], [u0, .3], out);
        }
        const mid = (b0 + b1) / 2, outN = new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0);
        body.tri(P(b0, ro, -d), P(b1, ro, -d), P(b1, ro, d), [u0, .3], [u1, .3], [u1, .3], outN);body.tri(P(b0, ro, -d), P(b1, ro, d), P(b0, ro, d), [u0, .3], [u1, .3], [u0, .3], outN);
        const inN = outN.clone().negate();
        body.tri(P(b0, ri, -d), P(b1, ri, -d), P(b1, ri, d), [u0, .3], [u1, .3], [u1, .3], inN);body.tri(P(b0, ri, -d), P(b1, ri, d), P(b0, ri, d), [u0, .3], [u1, .3], [u0, .3], inN);
      }
      // Joint faces at both ends of the block.
      for (const [a, sgn] of [[a0, -1], [a1, 1]] as const) {
        const n = new THREE.Vector3(-Math.sin(a) * sgn, Math.cos(a) * sgn, 0);
        body.tri(P(a, ri, -d), P(a, ro, -d), P(a, ro, d), [0, .3], [0, .3], [0, .3], n);body.tri(P(a, ri, -d), P(a, ro, d), P(a, ri, d), [0, .3], [0, .3], [0, .3], n);
      }
      // A silver band across both faces, set a little proud.
      const rb0 = RX - .06, rb1 = RX + .06;
      for (const z of [-d - .012, d + .012]) {
        const out = new THREE.Vector3(0, 0, z);
        trim.tri(P(a0, rb0, z), P(a1, rb0, z), P(a1, rb1, z), [0, 0], [0, 0], [0, 0], out);trim.tri(P(a0, rb0, z), P(a1, rb1, z), P(a0, rb1, z), [0, 0], [0, 0], [0, 0], out);
      }
    }
    // Cradle on the keystone.
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, pm = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * .26, SPRING + RX + RING / 2 + .2, Math.sin(a) * .26), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * .4, 0, -Math.cos(a) * .4)), one);
      trim.stack([{y: 0, hw: .055, ch: .015}, {y: .45, hw: .028, ch: .008}], pm);
    }
    const bodyMesh = new THREE.Mesh(body.geometry('star-gate-stone'), stone);bodyMesh.name = 'star-gate-stone';bodyMesh.castShadow = bodyMesh.receiveShadow = true;
    const trimMesh = new THREE.Mesh(trim.geometry('star-gate-silver'), silver);trimMesh.name = 'star-gate-silver';
    this.root.add(bodyMesh, trimMesh);
    const crown = new THREE.Mesh(starCrystalCluster(), starCrystalMaterial('violet', {glow: 1.8, frost: .1}));crown.name = 'star-gate-crystal';
    crown.scale.set(.62, 1.15, .62);crown.position.set(0, SPRING + RX + RING / 2 + .2 + .5 * 1.15, 0);crown.castShadow = true;this.root.add(crown);
    // Crystals grown at the piers' feet, off the travel line.
    const feet = new THREE.InstancedMesh(starCrystalCluster(), starCrystalMaterial('amethyst', {glow: 1.2}), 4);feet.name = 'star-gate-foot-crystals';
    [[-4.05, -.9, .5, 1.1], [-3.9, .95, .4, .8], [4.0, -.8, .45, .95], [4.1, 1.0, .36, .7]].forEach(([x, z, w, h], i) => feet.setMatrixAt(i, m.compose(new THREE.Vector3(x, .15 + .5 * h, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.9), new THREE.Vector3(w, h, w))));
    feet.castShadow = true;this.root.add(feet);
    // The night in the opening.
    const shape = new THREE.Shape();shape.moveTo(-INNER, DAIS);shape.lineTo(INNER, DAIS);shape.lineTo(INNER, SPRING);
    for (let k = 1; k <= 40; k++) { const a = k / 40 * Math.PI;shape.lineTo(Math.cos(a) * INNER, SPRING + Math.sin(a) * INNER); }
    this.opening = new THREE.ShaderMaterial({name: 'star-gate-night', transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: {uTime: {value: 0}},
      vertexShader: 'varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: OPENING_FRAG});
    const opening = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1), this.opening);opening.name = 'star-gate-night';opening.renderOrder = 2;this.root.add(opening);
    // Star dust drawn toward the opening.
    const dust = new Float32Array(70 * 3);
    for (let i = 0; i < 70; i++) { const a = i * 2.39996, r = 1.2 + (i * 37 % 100) / 100 * 2.2; dust.set([Math.cos(a) * r * .9, SPRING - .2 + Math.sin(a) * r, Math.sin(i * 3.7) * .9], i * 3); }
    const dg = new THREE.BufferGeometry();dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    this.motes = new THREE.Points(dg, new THREE.PointsMaterial({color: '#cfe0ff', size: .06, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending}));this.motes.name = 'star-gate-dust';this.root.add(this.motes);
    const light = new THREE.PointLight('#8fa6ff', 10, 14, 1.4);light.position.set(0, 3, 1.2);this.root.add(light);
  }
  update(time: number) { this.opening.uniforms.uTime.value = time;this.motes.rotation.z = Math.sin(time * .2) * .08;this.motes.position.y = Math.sin(time * .5) * .05; }
}
