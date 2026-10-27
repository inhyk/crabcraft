import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {lathe} from '../world/geom';
import {dawnSandstone, solidPart} from './dawnMaterials';

/*
 * Dawnharbor's gates: a sun gate of dressed sandstone. A three-step round dais, two jambs of coursed blocks with
 * moulded imposts, a round arch of bevelled voussoirs closed by a keystone that carries a gilded sun, and a crown of
 * gilded rays fanning out behind the arch. Inside the arch a dawn rises: a gradient from gold at the horizon to
 * rose and violet, a sun disc on the horizon line and slow rays turning, with motes drifting up through it.
 * `tone` 'frost' cools the same gate for the road to Frostlight. Same interface as StarPortal (root, update).
 */

const SPRING = 2.15, RI = 2.7, RO = 3.5, DEPTH = .86, DAIS = .62;

export class DawnPortal {
  readonly root = new THREE.Group();
  private veil: THREE.ShaderMaterial;
  private motes: THREE.ShaderMaterial;
  constructor(position: THREE.Vector3, label: string, tone: 'dawn' | 'frost' = 'dawn') {
    this.root.position.copy(position); this.root.name = label;
    const frost = tone === 'frost';
    const stone = dawnSandstone(frost ? 'dawnharbor-gate-stone-frost' : 'dawnharbor-gate-stone');
    if (frost) stone.color.set('#dfe6ee');
    const gold = new THREE.MeshStandardMaterial({name: 'dawnharbor-gate-gilt', color: frost ? '#d8e6f2' : '#d6a54a', metalness: .9, roughness: .34, emissive: frost ? '#3a6c9a' : '#6a4316', emissiveIntensity: .22});
    const parts: THREE.BufferGeometry[] = [], gilt: THREE.BufferGeometry[] = [];
    const M = (x: number, y: number, z: number, rz = 0, s: THREE.Vector3 = new THREE.Vector3(1, 1, 1)) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), s);
    // Dais: three round steps, the top one a little worn in the middle.
    parts.push(solidPart(lathe([[0, -.6], [4.05, -.6], [4.05, .14], [3.95, .2], [3.55, .2], [3.55, .38], [3.47, .42], [3.05, .42], [3.05, DAIS - .03], [2.95, DAIS], [0, DAIS - .02]], 48), new THREE.Matrix4()));
    // A bevelled block (w x h x d) whose faces are slightly chamfered, centred at (x, y, z).
    const block = (w: number, h: number, d: number, x: number, y: number, z = 0) => {
      const s = new THREE.Shape(), b = .05;
      s.moveTo(-w / 2 + b, -h / 2); s.lineTo(w / 2 - b, -h / 2); s.lineTo(w / 2, -h / 2 + b); s.lineTo(w / 2, h / 2 - b); s.lineTo(w / 2 - b, h / 2); s.lineTo(-w / 2 + b, h / 2); s.lineTo(-w / 2, h / 2 - b); s.lineTo(-w / 2, -h / 2 + b); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {depth: d - .08, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 1, steps: 1});
      g.translate(0, 0, -(d - .08) / 2);
      parts.push(solidPart(g, M(x, y, z))); g.dispose();
    };
    for (const side of [-1, 1]) {
      const cx = side * (RI + (RO - RI) / 2);
      block(1.05, .3, DEPTH + .2, cx, DAIS + .15);
      // Jamb courses, alternately long and short so the joints break.
      let y = DAIS + .3;
      for (const [k, h] of [.62, .5, .58].entries()) { block(k % 2 ? .78 : .86, h - .02, DEPTH - (k % 2 ? .06 : 0), cx, y + h / 2); y += h; }
      // Impost: a projecting moulded course where the arch springs.
      block(1.02, .16, DEPTH + .16, cx, SPRING - .08);
    }
    // Voussoirs: 13 wedges, the middle one the keystone, standing proud and taller.
    const n = 13;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI - i / n * Math.PI, a1 = Math.PI - (i + 1) / n * Math.PI, gap = .012, key = i === 6;
      const ro = key ? RO + .32 : RO + (i % 2 ? .05 : 0), s = new THREE.Shape();
      const p = (r: number, a: number) => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
      const A = p(RI, a0 - gap), B = p(ro, a0 - gap), C = p(ro, a1 + gap), D = p(RI, a1 + gap);
      s.moveTo(A.x, A.y); s.lineTo(B.x, B.y);
      for (let k = 1; k <= 4; k++) { const q = p(ro, a0 - gap + (a1 - a0 + 2 * gap) * k / 5); s.lineTo(q.x, q.y); }
      s.lineTo(C.x, C.y); s.lineTo(D.x, D.y);
      for (let k = 4; k >= 1; k--) { const q = p(RI, a0 - gap + (a1 - a0 + 2 * gap) * k / 5); s.lineTo(q.x, q.y); }
      s.closePath();
      const d = key ? DEPTH + .12 : DEPTH;
      const g = new THREE.ExtrudeGeometry(s, {depth: d - .08, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 1, steps: 1, curveSegments: 4});
      g.translate(0, SPRING, -(d - .08) / 2);
      parts.push(solidPart(g, new THREE.Matrix4())); g.dispose();
    }
    // The gilded sun on both faces of the keystone: a domed disc and twelve short rays.
    for (const face of [-1, 1]) {
      const z = face * (DEPTH / 2 + .1), cy = SPRING + RO - .05;
      const disc = new THREE.SphereGeometry(.26, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(face * Math.PI / 2);
      gilt.push(solidPart(disc, M(0, cy, z - face * .03, 0, new THREE.Vector3(1, 1, .45)))); disc.dispose();
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, len = k % 2 ? .16 : .26, ray = new THREE.ConeGeometry(.055, len, 4).rotateY(Math.PI / 4);
        gilt.push(solidPart(ray, M(Math.cos(a) * (.3 + len / 2), cy + Math.sin(a) * (.3 + len / 2), z - face * .04, a - Math.PI / 2, new THREE.Vector3(1, 1, .35)))); ray.dispose();
      }
    }
    // A carved sandstone sunburst behind the arch: nine tapering rays, long and short, cut in relief from a fan of
    // stone, each long ray inlaid with a thin bronze-gilt line (the old gilded spikes clashed with the palette).
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * (k / 8), len = k % 2 ? .62 : 1.05, w0 = .2, w1 = .05, s = new THREE.Shape();
      s.moveTo(-w0, 0); s.lineTo(w0, 0); s.lineTo(w1, len - .04); s.quadraticCurveTo(0, len + .03, -w1, len - .04); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {depth: .2, bevelEnabled: true, bevelThickness: .03, bevelSize: .025, bevelSegments: 1, curveSegments: 3});
      parts.push(solidPart(g, M(Math.cos(a) * (RO - .05), SPRING + Math.sin(a) * (RO - .05), -DEPTH / 2 - .02, a - Math.PI / 2))); g.dispose();
      if (k % 2 === 0) for (const face of [0, 1]) {
        const line = new THREE.BoxGeometry(.035, len * .62, .02);
        blades.push(solidPart(line, M(Math.cos(a) * (RO + len * .36), SPRING + Math.sin(a) * (RO + len * .36), face ? -DEPTH / 2 + .22 : -DEPTH / 2 - .06, a - Math.PI / 2))); line.dispose();
      }
    }
    const stoneGeo = mergeGeometries(parts, false)!, giltGeo = mergeGeometries([...gilt, ...blades], false)!;
    [...parts, ...gilt, ...blades].forEach(g => g.dispose());
    const stoneMesh = new THREE.Mesh(stoneGeo, stone); stoneMesh.castShadow = stoneMesh.receiveShadow = true; stoneMesh.name = 'dawn-gate-stone';
    const giltMesh = new THREE.Mesh(giltGeo, gold); giltMesh.castShadow = true; giltMesh.name = 'dawn-gate-gilt';
    this.root.add(stoneMesh, giltMesh);
    // The veil: the arch's opening, a sunrise seen through it.
    const open = new THREE.Shape();
    open.moveTo(-RI, DAIS); open.lineTo(-RI, SPRING); open.absarc(0, SPRING, RI, Math.PI, 0, true); open.lineTo(RI, DAIS); open.closePath();
    const veilGeo = new THREE.ShapeGeometry(open, 24);
    const cols = frost ? ['vec3(.55,.8,1.)', 'vec3(.35,.45,.95)', 'vec3(.12,.15,.45)', 'vec3(.85,.95,1.)'] : ['vec3(1.,.72,.3)', 'vec3(.95,.38,.42)', 'vec3(.35,.18,.55)', 'vec3(1.,.9,.6)'];
    this.veil = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: {uTime: {value: 0}},
      vertexShader: 'varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: /* glsl */ `varying vec2 vP;uniform float uTime;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
        void main(){
          float hor=${(DAIS + 1.05).toFixed(2)},y=vP.y-hor;
          vec3 c=mix(${cols[0]},${cols[1]},smoothstep(0.,1.6,y));c=mix(c,${cols[2]},smoothstep(1.4,3.6,y));c=mix(c,${cols[0]}*.6,smoothstep(0.,-.8,y));
          vec2 sp=vP-vec2(0.,hor+.15);float r=length(sp);
          float disc=1.-smoothstep(.55,.62,r),halo=exp(-r*1.4);
          float ang=atan(sp.y,sp.x),rays=pow(max(0.,sin(ang*9.+uTime*.25)),6.)*exp(-r*.55)*step(-.15,sp.y);
          float shim=n(vec2(vP.x*2.,vP.y*3.-uTime*.6))*.5+.5;
          float edge=smoothstep(0.,.35,${RI.toFixed(2)}-length(vec2(vP.x,max(vP.y-${SPRING.toFixed(2)},0.))))*smoothstep(${DAIS.toFixed(2)},${(DAIS + .3).toFixed(2)},vP.y);
          vec3 col=c*(.32+.12*shim)+${cols[3]}*(disc*1.4+halo*.55+rays*.5);
          gl_FragColor=vec4(col*edge,1.);
        }`,
    });
    const veil = new THREE.Mesh(veilGeo, this.veil); veil.name = 'dawn-gate-veil'; veil.renderOrder = 2;
    this.root.add(veil);
    // Motes rising through the arch.
    const N = 90, mp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const a = i * 2.39996, r = Math.sqrt((i + .5) / N); mp.set([Math.cos(a) * r * RI * .95, (i * .618) % 1, Math.sin(i * 3.7) * .35], i * 3); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {uTime: {value: 0}},
      vertexShader: /* glsl */ `uniform float uTime;varying float vA;void main(){vec3 p=position;float t=fract(p.y+uTime*.06);
        p.y=${DAIS.toFixed(2)}+t*${(SPRING + RI - DAIS).toFixed(2)};p.x+=sin(uTime*.7+position.z*9.)*.12;
        vA=sin(t*3.14159);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=55./max(-mv.z,.5);}`,
      fragmentShader: `varying float vA;void main(){float d=length(gl_PointCoord-.5)*2.;float a=(1.-d*d)*vA;if(a<.01)discard;gl_FragColor=vec4(${frost ? 'vec3(.7,.88,1.)' : 'vec3(1.,.82,.5)'}*a,1.);}`,
    });
    const motes = new THREE.Points(mg, this.motes); motes.frustumCulled = false; motes.name = 'dawn-gate-motes';
    this.root.add(motes);
    const light = new THREE.PointLight(frost ? '#9cc8ff' : '#ffb466', 10, 13, 1.4); light.position.set(0, SPRING, 1.2);
    this.root.add(light);
    this.root.userData.dawnGate = tone;
    this.root.userData.sunburst = {rays: 9, spikes: 0};
  }
  update(time: number) { this.veil.uniforms.uTime.value = time; this.motes.uniforms.uTime.value = time; }
}
