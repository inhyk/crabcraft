import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {rng} from '../world/noise';
import {addPatch} from '../world/materials';
import {FROST_NOISE} from './frostPaving';
import {boulderGeometry,cragGeometry} from './snowRocks';
import {dawnGlows} from './dawnMaterials';
import {dawnRocks} from './world3Colliders';

/*
 * The rock groups ringing the citadel, World III's sculpted boulders. Each collider site (dawnRocks(), radius r + 1)
 * holds a main boulder and two or three companions, cut from snowRocks.ts's boulderGeometry (fracture planes with
 * rounded edges, a tilted bedding) and painted here: warm cross-bedded sandstone on the southern, seaward arc; dark
 * vesicular basalt towards the volcano, with sun-baked tops, ochre and grey-green lichen and blown sand banked at
 * the foot. Every third basalt group is split by a lava fissure that glows and breathes. All of it is one mesh and
 * one draw (plus one draw of vent glows).
 */

/** Sites whose z lies south of this are sandstone; the rest basalt. */
const SANDSTONE_Z = -32;
const fractH = (v: number) => v - Math.floor(v);

export interface DawnBoulderSite {i: number; x: number; z: number; r: number; basalt: boolean; vent: boolean}
export function dawnBoulderSites(): DawnBoulderSite[] {
  return dawnRocks().map(({i, x, z, r}) => {
    const basalt = z < SANDSTONE_Z;
    return {i, x, z, r, basalt, vent: basalt && i % 3 === 0};
  });
}

const HEAD = /* glsl */ `
uniform float dbTime;
uniform vec3 dbSand;
varying vec3 vDbW;
varying vec3 vDbN;
varying vec3 vDbK;
${FROST_NOISE}
float dbN3(vec3 p,vec3 w){return fpNoise(p.zy)*w.x+fpNoise(p.xz+3.1)*w.y+fpNoise(p.xy-7.7)*w.z;}
`;

function boulderMaterial(uniforms: {dbTime: {value: number}; dbSand: {value: THREE.Color}}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnreach-boulders', color: '#ffffff', roughness: .9, vertexColors: true});
  addPatch(m, 'dawn-boulders', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aKind;\nvarying vec3 vDbW;\nvarying vec3 vDbN;\nvarying vec3 vDbK;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDbW=(modelMatrix*vec4(transformed,1.)).xyz;vDbN=normalize(mat3(modelMatrix)*objectNormal);vDbK=aKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // aKind: x basalt (0 sandstone), y lava in the partings, z height above the ground at this vertex.
        vec3 bN=normalize(vDbN),bA=abs(bN)/(abs(bN.x)+abs(bN.y)+abs(bN.z));
        float occ=vColor.r,bed=vColor.g,above=vDbK.z;
        float n1=dbN3(vDbW*.55,bA),n2=dbN3(vDbW*2.4,bA),n3=dbN3(vDbW*9.,bA);
        // Sandstone: cross-bedded laminae of honey, cream and rose, varnished darker on the steep faces.
        float lam=sin(vDbW.y*7.5+dot(vDbW.xz,vec2(.6,.35))*1.4+n1*2.2)*.5+.5,lam2=sin(vDbW.y*23.+n2*3.)*.5+.5;
        vec3 ss=mix(vec3(.46,.29,.16),vec3(.66,.52,.34),lam*.7+bed*.3-.15);
        ss=mix(ss,vec3(.55,.3,.2),smoothstep(.62,.9,n1*.5+.5)*.45);
        ss*=.9+.12*lam2;
        ss=mix(ss,ss*vec3(.72,.62,.55),(1.-bN.y*bN.y)*smoothstep(.2,.7,fpNoise(vec2(vDbW.x+vDbW.z,vDbW.y*.15)*2.))*.5);
        // Basalt: near-black, vesicles, rusty weathering; the tops bleached and warmed by the sun.
        float ves=smoothstep(.55,.8,fpNoise(vDbW.xz*17.+vDbW.y*9.)*.5+.5);
        vec3 bs=mix(vec3(.04,.038,.037),vec3(.11,.1,.095),clamp(.5+.6*n1+.3*n2,0.,1.))*(1.-ves*.4)*(.9+.2*n3);
        bs=mix(bs,vec3(.12,.07,.045),smoothstep(.75,.95,bed)*.25);
        float top=smoothstep(.45,.9,bN.y+n2*.12);
        bs=mix(bs,vec3(.17,.14,.115),top*.35);
        vec3 bC=mix(ss,bs,vDbK.x)*mix(1.,occ*occ,.8);
        // Lichen: ochre rosettes and grey-green crust on the upper faces, more on the basalt.
        float cell=fpNoise(vDbW.xz*5.3+vDbW.y*2.+11.)*.6+fpNoise(vDbW.xz*13.-vDbW.y*4.)*.4;
        float lich=smoothstep(.6,.72,cell*.5+.5)*smoothstep(.2,.6,bN.y+.3*n1)*smoothstep(.3,.8,dbN3(vDbW*.9+2.,bA)*.5+.5)*mix(.35,.9,vDbK.x);
        vec3 lc=mix(vec3(.42,.27,.05),vec3(.2,.22,.13),smoothstep(.4,.7,fpNoise(vDbW.xz*.8+3.)*.5+.5));
        bC=mix(bC,lc*(.85+.3*n3),lich*.8*(1.-vDbK.y));
        // Blown sand banked against the foot and lodged on the ledges.
        float skirt=1.-smoothstep(.03,mix(.32,.16,vDbK.x)+.2*(n2*.5+.5),above);
        float ledge=smoothstep(.84,.96,bN.y+n2*.08)*smoothstep(.6,.85,n1*.5+.5)*(1.-vDbK.x*.85);
        float sand=max(skirt,ledge*.8);
        // Heat: the rock around a fissure is reddened and the parting itself glows.
        // Fissures: branching zero-lines of a noise, wider low on the stone where the melt rose through.
        float fz=fpNoise(vDbW.xz*.9+vDbW.y*.6)+fpNoise(vDbW.zy*2.3+1.7)*.35;
        float fw=.035+.05*(1.-smoothstep(0.,2.5,above));
        float fiss=vDbK.y*(1.-smoothstep(fw*.4,fw,abs(fz)))*smoothstep(.2,.6,fpNoise(vDbW.xz*.5+vDbW.y*.3)*.5+.5+.3)*(1.-smoothstep(1.5,4.5,above));
        float heat=vDbK.y*(1.-smoothstep(fw,fw*5.,abs(fz)))*(1.-smoothstep(1.5,5.,above))*.7;
        bC=mix(bC,vec3(.16,.05,.02),heat);
        bC=mix(bC,dbSand*(.85+.2*n3),sand*(1.-fiss));
        diffuseColor.rgb=bC;
        float dbGlow=fiss*(.75+.25*sin(dbTime*1.7+vDbW.x*.7+vDbW.z*.4));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.9,.8,vDbK.x*top),.97,sand);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.38,.08)*dbGlow*4.+vec3(.6,.14,.02)*heat*.3;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float fade=(1.-smoothstep(14.,45.,length(vViewPosition)))*(1.-sand*.7);
          if(fade>.01){
            vec3 q=vDbW;float e=.03;
            #define DB_H(Q) (fpNoise((Q).xz*3.+(Q).y)*.35+fpNoise((Q).zy*11.)*.2+fpNoise((Q).xy*11.)*.2+vDbK.x*smoothstep(.55,.8,fpNoise((Q).xz*17.+(Q).y*9.)*.5+.5)*-.3+(1.-vDbK.x)*sin((Q).y*23.+fpNoise((Q).xz*2.4)*3.)*.12)
            float h0=DB_H(q);
            vec3 g=vec3(DB_H(q+vec3(e,0.,0.))-h0,DB_H(q+vec3(0.,e,0.))-h0,DB_H(q+vec3(0.,0.,e))-h0)/e;
            vec3 nw=inverseTransformDirection(normal,viewMatrix);
            nw=normalize(nw-(g-dot(g,nw)*nw)*.06*fade);
            normal=normalize((viewMatrix*vec4(nw,0.)).xyz);
          }
        }`);
  });
  m.customProgramCacheKey = () => 'dawn-boulders';
  return m;
}

export interface DawnBoulders {group: THREE.Group; update(time: number): void}

/** Every rock group as one merged mesh, placed on the gameplay surface. */
export function dawnBoulders(height: (x: number, z: number) => number, sand = new THREE.Color(.6, .49, .31)): DawnBoulders {
  const group = new THREE.Group(); group.name = 'dawnreach-boulders';
  const geos: THREE.BufferGeometry[] = [], vents: {pos: THREE.Vector3; size: number}[] = [];
  let count = 0;
  for (const site of dawnBoulderSites()) {
    const R = rng(site.i * 977 + 31);
    // The main stone fills most of the collider; companions lean against it, all inside radius r + 0.9.
    const stones: {dx: number; dz: number; r: number; h: number; yaw: number}[] = [{dx: 0, dz: 0, r: site.r * .8, h: site.r * 1.15, yaw: R() * Math.PI * 2}];
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2, rr = site.r * (.3 + R() * .22), d = Math.min(site.r * .82 + rr * .4, site.r + .9 - rr);
      stones.push({dx: Math.cos(a) * d, dz: Math.sin(a) * d, r: rr, h: rr * (.7 + R() * .4), yaw: R() * Math.PI * 2});
    }
    for (const [k, s] of stones.entries()) {
      const x = site.x + s.dx, z = site.z + s.dz;
      let low = Infinity;
      for (let a = 0; a < 12; a++) for (const f of [.4, .9]) low = Math.min(low, height(x + Math.cos(a * .52) * s.r * f, z + Math.sin(a * .52) * s.r * f));
      let g: THREE.BufferGeometry, m: THREE.Matrix4;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      if (k === 0 && site.basalt) {
        // A jointed basalt crag: fractured faces and columns, its foot buried in the slope.
        const h = site.r * 1.15;
        g = cragGeometry({x, z, r: s.r, h, yaw: s.yaw, seed: site.i * 13 + 5} as Parameters<typeof cragGeometry>[0], 11);
        const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
        const nr = g.getAttribute('normal') as THREE.BufferAttribute;
        for (let v = 0; v < n; v++) c.set([.75 + .25 * Math.max(0, nr.getY(v)), .6 + .4 * fractH(v * .618), 1], v * 3);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        m = new THREE.Matrix4().compose(new THREE.Vector3(x, low - .3 * h, z), q, new THREE.Vector3(s.r, s.r, s.r));
      } else {
        g = boulderGeometry({r: s.r, h: s.h, seed: site.i * 31 + k * 7 + 3}, k === 0 ? (site.r >= 3 ? 10 : 8) : 5, site.basalt ? 1.8 : 1);
        m = new THREE.Matrix4().compose(new THREE.Vector3(x, low - .12 * s.h, z), q, new THREE.Vector3(1, 1, 1));
      }
      g.applyMatrix4(m);
      const pos = g.getAttribute('position') as THREE.BufferAttribute, kind = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) kind.set([site.basalt ? 1 : 0, site.vent && k === 0 ? 1 : 0, pos.getY(v) - height(pos.getX(v), pos.getZ(v))], v * 3);
      g.setAttribute('aKind', new THREE.BufferAttribute(kind, 3));
      geos.push(g); count++;
      // The vent breathes heat over the split crown of the main stone.
      if (site.vent && k === 0) { g.computeBoundingBox(); vents.push({pos: new THREE.Vector3(x, g.boundingBox!.max.y + .2, z), size: 2.2 + site.r * .5}); }
    }
  }
  const geo = mergeGeometries(geos, false)!; geos.forEach(g => g.dispose());
  geo.computeBoundingSphere();
  const uniforms = {dbTime: {value: 0}, dbSand: {value: sand}};
  const mesh = new THREE.Mesh(geo, boulderMaterial(uniforms));
  mesh.name = 'dawnreach-boulder-groups'; mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  const glow = dawnGlows(vents, '#ff6a1c', 'dawnreach-vent-glows');
  group.add(glow);
  group.userData.stones = count; group.userData.sites = dawnBoulderSites().length; group.userData.vents = vents.length;
  return {group, update(time) { uniforms.dbTime.value = time; (glow.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }};
}
