import * as THREE from 'three';
import {SNOW_WIND} from '../sim/world/snowGround';
import {FROST_NOISE} from './frostPaving';

/*
 * Dressed granite for Frostlight's story architecture (Boreas's throne, the glacial citadel, the standing stones).
 * Every block is its own prism with a chamfered face, a tint, a set and a lean of its own, laid in courses over a
 * dark mortar core so the joints read, and shaded by the arena rim's granite (frostPaving.ts graniteMaterial:
 * vertex colour, a frost line over `aGround`, snow on the tops by `aSnow`). masonryMaterial() adds what a winter
 * on the north cliff leaves: snow lodged on every ledge and upper chamfer, so the courses read; rime feathered on
 * the windward faces, heavier up high; and glazed meltwater runs down from the joints.
 */

export type V3 = [number, number, number];
/** Maps block-local (u along the face, v up, t into the wall from the face) to world space. */
export type Warp = (u: number, v: number, t: number) => V3;

export interface BlockOpts {
  /** Chamfer on the four face edges, metres. */
  bevel?: number;
  /** Face subdivisions along u, for curved warps. */
  seg?: number;
  tint?: V3;
  /** Also close the back and bottom (free-standing pieces). */
  closed?: boolean;
}

/** Straight face: origin, unit direction along it, and the outward normal (horizontal). */
export function planeWarp(ox: number, oz: number, ax: number, az: number): Warp {
  // Outward normal is the along-direction turned a quarter to the right (looking down, +x east, +z south).
  const nx = az, nz = -ax;
  return (u, v, t) => [ox + ax * u - nx * t, v, oz + az * u - nz * t];
}

/** Round face: centre, outer radius; u runs clockwise seen from above starting at angle a0 (0 = +z). */
export function ringWarp(cx: number, cz: number, r: number, a0 = 0): Warp {
  return (u, v, t) => { const a = a0 + u / r, rr = r - t; return [cx + Math.sin(a) * rr, v, cz + Math.cos(a) * rr]; };
}

export class Masonry {
  private pos: number[] = [];
  private col: number[] = [];
  private gnd: number[] = [];
  private snw: number[] = [];
  blocks = 0;
  /** Ground height for the frost line and how much snow the tops hold, for what is laid next. */
  ground = 0;
  snow = .3;
  constructor(readonly rand: () => number) {}

  /** Blue-grey granite, every stone its own; `k` darkens (mortar, recesses) or lightens. */
  tint(k = 1): V3 {
    // Blue in albedo: the low amber sun brings it back to a cold grey, the shade keeps it slate.
    const r = this.rand, warm = r() < .1 ? .008 : 0, pale = r() < .12 ? .022 : 0;
    const g = .036 + r() * .026 + pale;
    return [(g + warm - .005) * k, (g + .006) * k, (g + .03 - warm) * k];
  }

  tri(a: V3, b: V3, c: V3, tint: V3, centre: V3): void {
    // Wind outward from the block's centre (the warps can mirror).
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - centre[0], my = (a[1] + b[1] + c[1]) / 3 - centre[1], mz = (a[2] + b[2] + c[2]) / 3 - centre[2];
    const order = nx * mx + ny * my + nz * mz < 0 ? [a, c, b] : [a, b, c];
    for (const p of order) { this.pos.push(p[0], p[1], p[2]); this.col.push(tint[0], tint[1], tint[2]); this.gnd.push(this.ground); this.snw.push(this.snow); }
  }

  quad(a: V3, b: V3, c: V3, d: V3, tint: V3, centre: V3): void { this.tri(a, b, c, tint, centre); this.tri(a, c, d, tint, centre); }

  /** One dressed block: u0..u0+w along, v0..v0+h up, t0..t0+d deep; the face at t0 is chamfered. */
  block(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, o: BlockOpts = {}): void {
    const b = Math.min(o.bevel ?? .07, w * .3, h * .3, d * .3), seg = o.seg ?? 1, tint = o.tint ?? this.tint();
    const u1 = u0 + w, v1 = v0 + h, t1 = t0 + d;
    const c = warp(u0 + w / 2, v0 + h / 2, t0 + d / 2);
    const P = (u: number, v: number, t: number) => warp(u, v, t);
    for (let i = 0; i < seg; i++) {
      const a = u0 + w * i / seg, e = u0 + w * (i + 1) / seg;
      // The chamfer pulls in at both ends only on the end columns.
      const fa = i === 0 ? a + b : a, fe = i === seg - 1 ? e - b : e;
      this.quad(P(fa, v0 + b, t0), P(fe, v0 + b, t0), P(fe, v1 - b, t0), P(fa, v1 - b, t0), tint, c);
      this.quad(P(fa, v1 - b, t0), P(fe, v1 - b, t0), P(e, v1, t0 + b), P(a, v1, t0 + b), tint, c);
      this.quad(P(fa, v0 + b, t0), P(fe, v0 + b, t0), P(e, v0, t0 + b), P(a, v0, t0 + b), tint, c);
      this.quad(P(a, v1, t0 + b), P(e, v1, t0 + b), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (o.closed) { this.quad(P(a, v0, t0 + b), P(e, v0, t0 + b), P(e, v0, t1), P(a, v0, t1), tint, c); this.quad(P(a, v0, t1), P(e, v0, t1), P(e, v1, t1), P(a, v1, t1), tint, c); }
    }
    this.quad(P(u0 + b, v0 + b, t0), P(u0 + b, v1 - b, t0), P(u0, v1, t0 + b), P(u0, v0, t0 + b), tint, c);
    this.quad(P(u1 - b, v0 + b, t0), P(u1 - b, v1 - b, t0), P(u1, v1, t0 + b), P(u1, v0, t0 + b), tint, c);
    this.quad(P(u0, v0, t0 + b), P(u0, v1, t0 + b), P(u0, v1, t1), P(u0, v0, t1), tint, c);
    this.quad(P(u1, v0, t0 + b), P(u1, v1, t0 + b), P(u1, v1, t1), P(u1, v0, t1), tint, c);
    this.blocks++;
  }

  /** Plain box in warp space (a core, a slab), every face, no chamfer. */
  slab(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, tint: V3, seg = 1, faces = 63): void {
    const u1 = u0 + w, v1 = v0 + h, t1 = t0 + d, c = warp(u0 + w / 2, v0 + h / 2, t0 + d / 2), P = warp;
    for (let i = 0; i < seg; i++) {
      const a = u0 + w * i / seg, e = u0 + w * (i + 1) / seg;
      if (faces & 1) this.quad(P(a, v0, t0), P(e, v0, t0), P(e, v1, t0), P(a, v1, t0), tint, c);
      if (faces & 2) this.quad(P(a, v0, t1), P(e, v0, t1), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (faces & 4) this.quad(P(a, v1, t0), P(e, v1, t0), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (faces & 8) this.quad(P(a, v0, t0), P(e, v0, t0), P(e, v0, t1), P(a, v0, t1), tint, c);
    }
    if (faces & 16) this.quad(P(u0, v0, t0), P(u0, v1, t0), P(u0, v1, t1), P(u0, v0, t1), tint, c);
    if (faces & 32) this.quad(P(u1, v0, t0), P(u1, v1, t0), P(u1, v1, t1), P(u1, v0, t1), tint, c);
  }

  /**
   * Courses of blocks over a mortar core on the face u0..u1, v0..v1 (running bond). `len` is the mean block length,
   * `course` the mean course height; `skip(u, v)` leaves a block out (an opening). Returns the course tops.
   */
  face(warp: Warp, u0: number, u1: number, v0: number, v1: number, o: {len?: number; course?: number; depth?: number; core?: number; curve?: number; skip?: (u: number, v: number) => boolean} = {}): number[] {
    const r = this.rand, len = o.len ?? 1.7, course = o.course ?? .95, depth = o.depth ?? .55, gap = .055;
    const tops: number[] = [];
    // The mortar a few centimetres behind the faces, seen only in the joints.
    const core = (o.core ?? 1) > 0, mortar = this.tint(.32);
    if (core && !o.skip) this.slab(warp, u0, v0, .14, u1 - u0, v1 - v0, depth, mortar, Math.max(1, Math.ceil((u1 - u0) / (o.curve ?? 1e9))), 1);
    let v = v0;
    while (v < v1 - .05) {
      let h = course * (.82 + r() * .36);
      if (v1 - (v + h) < course * .5) h = v1 - v;
      let u = u0 - r() * len * .6;
      while (u < u1 - .02) {
        let w = len * (.6 + r() * .8);
        const a = Math.max(u, u0), e = Math.min(u + w, u1);
        if (u1 - e < len * .3) w = u1 - u;
        const ee = Math.min(u + w, u1);
        if (!o.skip?.(a + (ee - a) / 2, v + h / 2) && ee - a > .25) {
          const set = (r() - .5) * .05;
          const seg = o.curve ? Math.max(1, Math.ceil((ee - a) / o.curve)) : 1;
          this.block(warp, a + gap / 2, v + gap / 2, set, ee - a - gap, h - gap, depth, {bevel: .05 + r() * .05, seg});
          // With openings the mortar goes behind each block alone, so the openings stay open.
          if (core && o.skip) this.slab(warp, a, v, .14, ee - a, h, depth, mortar, seg, 1);
        }
        u += w;
      }
      v += h; tops.push(v);
    }
    return tops;
  }

  /** A flat round cap facing up (tower floors, collar tops). */
  disc(x: number, y: number, z: number, r: number, n = 20, tint = this.tint(.9)): void {
    const c: V3 = [x, y - 1, z];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      this.tri([x, y, z], [x + Math.sin(a0) * r, y, z + Math.cos(a0) * r], [x + Math.sin(a1) * r, y, z + Math.cos(a1) * r], tint, c);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGround', new THREE.Float32BufferAttribute(this.gnd, 1));
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(this.snw, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** The granite of the arena rim (graniteMaterial) weathered for the citadel: lodged snow, windward rime, glaze. */
export function masonryMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .86});
  material.name = name;
  // The scene's environment map belongs to another world (as snowSurface.ts): the hemisphere light is the sky here.
  material.envMapIntensity = 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMWind = {value: new THREE.Vector2(SNOW_WIND[0], SNOW_WIND[1])};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aSnow;\nvarying float vMG;\nvarying float vMS;\nvarying vec3 vMW;\nvarying vec3 vMN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMG=aGround;vMS=aSnow;vMW=(modelMatrix*vec4(transformed,1.)).xyz;vMN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nuniform vec2 uMWind;\nvarying float vMG;\nvarying float vMS;\nvarying vec3 vMW;\nvarying vec3 vMN;\nfloat mWhite;\nfloat mGlaze;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 mNW=normalize(vMN),mA=abs(mNW)/(abs(mNW.x)+abs(mNW.y)+abs(mNW.z));
        #define M3(f,o) (fpNoise(vMW.zy*(f)+(o))*mA.x+fpNoise(vMW.xz*(f)+(o))*mA.y+fpNoise(vMW.xy*(f)+(o))*mA.z)
        float mN=M3(3.1,0.);
        // Broad mottling, dark and light grains up close.
        diffuseColor.rgb*=.68+.42*(M3(.7,2.)*.5+.5);
        float mG1=M3(38.,5.)*.5+.5,mG2=M3(91.,9.)*.5+.5,mNear=1.-smoothstep(.004,.02,length(fwidth(vMW)));
        diffuseColor.rgb*=mix(1.,mix(1.,.55,smoothstep(.62,.8,mG1))*mix(1.,1.35,smoothstep(.66,.84,mG2)),mNear);
        // Snow lodged on the tops and the upper chamfers, so every course carries a white line.
        float mUp=mNW.y+mN*.1;
        float mSnow=smoothstep(.45,.62,mUp)*smoothstep(.1,.4,fpNoise(vMW.xz*1.7+vMW.y*.9+7.)*.9+vMS-.52+mN*.25)*.85;
        mSnow=max(mSnow,smoothstep(.86,.95,mUp)*smoothstep(-.25,.25,vMS-.3+(M3(.45,4.)*.6+mN*.12)));
        // Rime feathered on the faces the wind meets, heavier up high; the lee stays dark.
        float mWind=dot(mNW.xz,-uMWind);
        float mFeather=fpNoise(vec2(dot(vMW.xz,vec2(-uMWind.y,uMWind.x))*1.7,vMW.y*5.))*.5+.5;
        float mRime=smoothstep(.1,.75,mWind)*smoothstep(.5,.8,M3(.22,13.)*.5+.5+(mFeather-.5)*.25+(vMW.y-vMG)*.01-.08);
        float mFrost=(1.-smoothstep(0.,.03+mN*.012,vMW.y-vMG))*.8;
        // Meltwater glazed down the faces from the joints: darker, cooler, glossy.
        mGlaze=smoothstep(.62,.9,fpNoise(vec2((vMW.x+vMW.z)*1.9,vMW.y*.16+3.))*.6+fpNoise(vec2((vMW.x+vMW.z)*7.,vMW.y*.4))*.4)*(1.-abs(mNW.y));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.72,.82,.95),mGlaze);
        mWhite=max(max(mSnow,mFrost),mRime*.6);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.92,1.),mWhite);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.88,.55,mGlaze),.92,mWhite);')
      // Weathered stone is dull: the low sun's sheen across a whole wall reads as tan plaster, not granite.
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(.3,.7,max(mGlaze,mWhite));')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Chisel marks: a small world-space bump, softened under snow and rime.
          #define MF(q) (fpNoise((q).zy*14.+1.)*mA.x+fpNoise((q).xz*14.+1.)*mA.y+fpNoise((q).xy*14.+1.)*mA.z)
          float e=.012,f0=MF(vMW);
          vec3 g=vec3(MF(vMW+vec3(e,0.,0.))-f0,MF(vMW+vec3(0.,e,0.))-f0,MF(vMW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.006*(1.-mWhite*.7);
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'frostlight-masonry';
  return material;
}
