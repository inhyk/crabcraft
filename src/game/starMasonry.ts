import * as THREE from 'three';

/*
 * Starhaven's carved stone: octagonal (chamfered-square) stacks for obelisks, piers and lantern posts, with a
 * `aJoint` attribute (u along the surface, v up it, in metres) the stone shader turns into coursed blocks with
 * sunk joints, plus a moonstone material shared by the sanctum, the gate and the arrival arch.
 */

export interface Course { y: number; hw: number; ch: number }

const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

/** Accumulates flat triangles with joint coordinates, in world or local space. */
export class StoneBuilder {
  readonly pos: number[] = [];
  readonly joint: number[] = [];
  /** Adds a triangle a-b-c, flipped if needed so it faces `out` (a direction, or a point it faces away from). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ja: [number, number], jb: [number, number], jc: [number, number], outward?: THREE.Vector3) {
    e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e1, e2);
    if (outward && nrm.dot(outward) < 0) { this.pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z); this.joint.push(...ja, ...jc, ...jb); return; }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.joint.push(...ja, ...jb, ...jc);
  }
  /**
   * A stack of chamfered squares (octagons) round local +Y, placed by `m`. Each pair of consecutive courses makes
   * one band of eight faces (a horizontal ledge when they share a height); the last course is capped.
   */
  stack(courses: Course[], m: THREE.Matrix4, cap = true) {
    const ring = (c: Course) => {
      const a = c.hw, b = c.hw - c.ch;
      return [[a, -b], [a, b], [b, a], [-b, a], [-a, b], [-a, -b], [-b, -a], [b, -a]].map(([x, z]) => new THREE.Vector3(x, c.y, z));
    };
    const center = new THREE.Vector3().setFromMatrixPosition(m);
    const out = new THREE.Vector3();
    for (let i = 0; i + 1 < courses.length; i++) {
      const lo = ring(courses[i]).map(p => p.applyMatrix4(m)), up = ring(courses[i + 1]).map(p => p.applyMatrix4(m));
      let s = 0;
      for (let k = 0; k < 8; k++) {
        const k1 = (k + 1) % 8, len = lo[k].distanceTo(lo[k1]);
        const mid = tmp.copy(lo[k]).add(lo[k1]).add(up[k]).add(up[k1]).multiplyScalar(.25);
        const yl = courses[i].y, yu = courses[i + 1].y, ledge = Math.abs(yu - yl) < 1e-6;
        if (ledge) out.set(0, courses[i].hw > courses[i + 1].hw ? 1 : -1, 0); else { out.subVectors(mid, center); out.y = 0; }
        const vl = yl, vu = ledge ? yl + Math.abs(courses[i].hw - courses[i + 1].hw) : yu;
        this.tri(lo[k], lo[k1], up[k1], [s, vl], [s + len, vl], [s + len, vu], out);
        this.tri(lo[k], up[k1], up[k], [s, vl], [s + len, vu], [s, vu], out);
        s += len;
      }
    }
    if (cap) {
      const top = ring(courses[courses.length - 1]).map(p => p.applyMatrix4(m)), c = new THREE.Vector3().setFromMatrixPosition(m);
      c.y = top[0].y; const up = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < 8; k++) this.tri(c, top[k], top[(k + 1) % 8], [c.x, c.z], [top[k].x, top[k].z], [top[(k + 1) % 8].x, top[(k + 1) % 8].z], up);
    }
  }
  geometry(name: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry(); g.name = name;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aJoint', new THREE.Float32BufferAttribute(this.joint, 2));
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/**
 * Moonstone: pale blue-grey limestone in courses (block size `block`, metres), joints sunk and darkened, the
 * faces mottled with lichen and weather, the foot stained by the ground. Lit by the scene like any standard surface.
 */
export function moonstoneMaterial(opts: {color?: THREE.ColorRepresentation; block?: [number, number]; name?: string} = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: opts.color ?? '#9aa0bd', roughness: .82, metalness: 0, flatShading: true});
  m.name = opts.name ?? 'star-moonstone';
  const [bw, bh] = opts.block ?? [1.15, .72];
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aJoint;varying vec2 vMsJoint;varying vec3 vMsWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
vMsJoint=aJoint;vec4 msW=vec4(transformed,1.);
#ifdef USE_INSTANCING
msW=instanceMatrix*msW;
#endif
vMsWorld=(modelMatrix*msW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vMsJoint;varying vec3 vMsWorld;
float msH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float msN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(msH(i),msH(i+vec2(1.,0.)),f.x),mix(msH(i+vec2(0.,1.)),msH(i+1.),f.x),f.y);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float msGroove;
{
  vec2 j=vMsJoint/vec2(${bw.toFixed(3)},${bh.toFixed(3)});
  float row=floor(j.y);j.x+=msH(vec2(row,3.1))*.9+row*.5;
  vec2 f=fract(j),cell=floor(j);
  vec2 w=max(fwidth(j)*1.2,vec2(.012/${bw.toFixed(3)},.012/${bh.toFixed(3)}));
  vec2 edge=min(f,1.-f)*vec2(${bw.toFixed(3)},${bh.toFixed(3)});
  float d=min(edge.x,edge.y);
  msGroove=1.-smoothstep(.018,.05,d);
  float blockTone=.84+.3*msH(cell+7.);
  float mottle=msN(vMsWorld.xz*1.3+vMsWorld.y*.7)*.6+msN(vMsWorld.xy*4.1+vMsWorld.z)*.4;
  float lichen=smoothstep(.62,.85,msN(vMsWorld.xz*.6+vMsWorld.y*1.6+11.));
  diffuseColor.rgb*=blockTone*(.8+.35*mottle)*(1.-.55*msGroove);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.72,.86,.78),lichen*.5);
  // Worn arrises: a block's own edges are paler where weather took the corners.
  diffuseColor.rgb*=1.+.18*(1.-smoothstep(.0,.09,d))*(1.-msGroove);
}`)
      .replace('#include <lights_physical_fragment>', `roughnessFactor=mix(roughnessFactor,1.,msGroove);
#include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => `moonstone-${bw}-${bh}`;
  return m;
}

/** Brushed silver for inlays, bands and cradles: it glints in the moonlight and holds a faint moon-blue sheen. */
export function silverMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#d8dcef', metalness: 1, roughness: .3, emissive: '#1d2236', emissiveIntensity: 1, flatShading: true, envMapIntensity: 2.2});
  m.name = 'star-silver';
  return m;
}
