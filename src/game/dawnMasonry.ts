import * as THREE from 'three';
import {Masonry,type BlockOpts,type V3,type Warp} from './frostMasonry';
import {FROST_NOISE} from './frostPaving';

/*
 * Solarkan's citadel stone: the sun temple was raised in courses of black vesicular basalt banded with honey
 * limestone (ablaq), its string courses, merlon caps and emblems gilded. The mason (frostMasonry.ts Masonry, every
 * block its own chamfered prism over a mortar core) lays the same walls; this one picks a basalt or a limestone tint
 * by the height of each block, so the bands run round the whole citadel at the same level, and marks gilded pieces
 * through the mason's per-vertex `snow` channel (here: gilt). dawnMasonryMaterial() weathers it for a hot coast:
 * sun-bleached tops, sand blown into the foot of every wall, soot run down from the fire platforms and the
 * braziers, orange lichen on the pale stone, and gold leaf worn back to bronze on the edges.
 */

/** Height bands of limestone in the basalt: pale where (y - y0) mod period < pale. The shader uses the same rule. */
export const DAWN_BANDS = {y0: 15.6, period: 3.4, pale: 1.15} as const;
export const isPale = (y: number) => { const k = (((y - DAWN_BANDS.y0) % DAWN_BANDS.period) + DAWN_BANDS.period) % DAWN_BANDS.period; return k < DAWN_BANDS.pale; };

export class DawnMason extends Masonry {
  /** Lay the limestone bands (walls, towers); off for plain basalt pieces. */
  bands = true;
  /** Force every block laid next to limestone (quoins, dressings) or basalt; null follows the bands. */
  stone: 'pale' | 'basalt' | null = null;
  private p: () => number;
  constructor(rand: () => number, salt = 0) {
    super(rand, salt);
    let s = (91019 + salt * 613) >>> 0;
    this.p = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  /** Gilded pieces: the shader reads the mason's snow channel as gilt. */
  set gilt(on: boolean) { this.snow = on ? 1 : 0; }
  get gilt() { return this.snow > .5; }

  /** Black basalt, every stone its own: brown-black, blue-black, a rusty one now and then. */
  override tint(k = 1, rng: () => number = this.rand): V3 {
    const a = rng(), b = rng(), c = rng();
    const v = (b < .12 ? 1.45 : b > .9 ? .7 : .85 + (b - .12) * .4) * (.052 + c * .02);
    const rust = a < .1 ? .012 : 0, blue = a > .88 ? .006 : 0;
    return [(v + rust * 1.5 - blue) * k, (v * .94 + rust * .4) * k, (v * .9 + blue * 1.2) * k];
  }
  /** Honey limestone: cream, ochre and a pinkish one, each stone its own. */
  paleTint(k = 1): V3 {
    const r = this.p, a = r(), b = r();
    const v = (.82 + b * .36) * (b > .93 ? .78 : 1);
    const hue: V3 = a < .18 ? [1.06, .86, .62] : a > .85 ? [1.04, .8, .66] : [1, .82, .58];
    return [.4 * v * hue[0] * k, .4 * v * hue[1] * k, .4 * v * hue[2] * k];
  }
  override block(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, o: BlockOpts = {}): void {
    if (!this.gilt && this.course !== 2) {
      const pale = this.stone ? this.stone === 'pale' : this.bands && isPale(v0 + h / 2);
      if (pale) o = {...o, tint: this.paleTint()};
    }
    super.block(warp, u0, v0, t0, w, h, d, o);
  }
}

/** The citadel's basalt and limestone, mortar, far slabs and gilt, all one material. */
export function dawnMasonryMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .86});
  material.name = name;
  material.envMapIntensity = .55;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aSnow;\nattribute float aCourse;\nvarying float vMG;\nvarying float vMS;\nvarying float vMC;\nvarying vec3 vMW;\nvarying vec3 vMN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMG=aGround;vMS=aSnow;vMC=aCourse;vMW=(modelMatrix*vec4(transformed,1.)).xyz;vMN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying float vMG;\nvarying float vMS;\nvarying float vMC;\nvarying vec3 vMW;\nvarying vec3 vMN;\nfloat mGilt;\nfloat mWorn;\nfloat mDust;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 mNW=normalize(vMN),mA=abs(mNW)/(abs(mNW.x)+abs(mNW.y)+abs(mNW.z));
        #define M3(f,o) (fpNoise(vMW.zy*(f)+(o))*mA.x+fpNoise(vMW.xz*(f)+(o))*mA.y+fpNoise(vMW.xy*(f)+(o))*mA.z)
        float mN=M3(3.1,0.),mSide=1.-abs(mNW.y),mAbove=vMW.y-vMG;
        float mNear=1.-smoothstep(.004,.02,length(fwidth(vMW)));
        mGilt=step(.5,vMS);
        // Far slabs: the courses drawn (uneven heights, stones of uneven length), the limestone bands at the same
        // levels the near mason lays them, each stone its own value.
        if(vMC>.5&&vMC<1.5){
          vec2 mT=normalize(vec2(-mNW.z,mNW.x)+1e-4);
          #define MEDGE(k) ((k)+(fpHash12(vec2(k,4.1))-.5)*.5)
          float mY=(vMW.y-.37)/1.05,mCi=floor(mY),e0=MEDGE(mCi),e1=MEDGE(mCi+1.);
          if(mY<e0){mCi-=1.;e1=e0;e0=MEDGE(mCi);}else if(mY>=e1){mCi+=1.;e0=e1;e1=MEDGE(mCi+1.);}
          float mFy=(mY-e0)/(e1-e0),mBl=mix(1.4,2.9,fpHash12(vec2(mCi,8.3)));
          float mBx=(dot(vMW.xz,mT)+fpHash12(vec2(mCi,2.7))*mBl)/mBl,mBi=floor(mBx),mFx=fract(mBx);
          float mJ=(1.-smoothstep(0.,fwidth(mBx)*1.2+.03,min(mFx,1.-mFx))*smoothstep(0.,fwidth(mY)/(e1-e0)*1.2+.05,min(mFy,1.-mFy)))*(1.-abs(mNW.y));
          float mH1=fpHash12(vec2(mCi*1.7+3.,mBi));
          float mK=mod(vMW.y-${DAWN_BANDS.y0.toFixed(2)},${DAWN_BANDS.period.toFixed(2)});
          vec3 mPale=vec3(.4,.328,.232)*(.82+.36*fpHash12(vec2(mBi*.37+5.,mCi)));
          vec3 mBas=vec3(.06,.056,.053)*(mH1<.14?1.4:mH1>.9?.7:.85+(mH1-.14)*.4);
          diffuseColor.rgb=(mK<${DAWN_BANDS.pale.toFixed(2)}&&mGilt<.5?mPale:mBas)*mix(1.,.45,mJ);
        }
        float mL=dot(diffuseColor.rgb,vec3(.3,.59,.11)),mBasalt=1.-smoothstep(.07,.16,mL);
        // Broad mottling and grain up close; basalt is pitted with vesicles, the limestone fine-grained.
        diffuseColor.rgb*=.82+.26*(M3(.7,2.)*.5+.5);
        float mG1=M3(38.,5.)*.5+.5,mG2=M3(91.,9.)*.5+.5;
        diffuseColor.rgb*=mix(1.,mix(1.,.6,smoothstep(.62,.8,mG1))*mix(1.,1.3,smoothstep(.66,.84,mG2)),mNear*(1.-mGilt));
        float mVes=smoothstep(.72,.86,M3(23.,11.)*.5+.5)*mBasalt*mNear;
        diffuseColor.rgb*=1.-mVes*.6;
        // The joints: lime mortar, pale and sandy, receding to the stone's value with distance.
        float mJFar=smoothstep(.008,.035,length(fwidth(vMW)));
        if(vMC>1.5)diffuseColor.rgb=mix(vec3(.2,.17,.13)*(.75+.5*(M3(1.3,7.)*.5+.5)),vec3(.05,.045,.04),mJFar*.8);
        // Weather bigger than a stone: bleached and darkened patches, soot run down from the tops in long streaks.
        diffuseColor.rgb*=.8+.36*smoothstep(.15,.85,M3(.13,41.)*.5+.5);
        vec2 mTw=normalize(vec2(-mNW.z,mNW.x)+1e-4);float mAlong=dot(vMW.xz,mTw);
        float mSoot=smoothstep(.45,.8,fpNoise(vec2(mAlong*.55,vMW.y*.035+fpNoise(vec2(mAlong*.25,3.))*.5))*.5+.5)*smoothstep(.0,.6,fpNoise(vec2(mAlong*.9+9.,vMW.y*.08))*.5+.5);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.42,.38,.36),mSoot*mSide*(1.-mGilt)*(.35+.65*(1.-mBasalt)));
        // Orange lichen on the limestone, sparse, on the shaded faces.
        float mLich=smoothstep(.78,.92,M3(.9,31.)*.5+.5+mN*.06)*mSide*(1.-mBasalt)*(1.-mGilt);
        diffuseColor.rgb*=mix(vec3(1.),vec3(1.35,.95,.45),mLich*.7);
        // Sun-bleached tops and upper chamfers; sand blown against the foot and lodged on the ledges.
        float mUp=mNW.y+mN*.1;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.25+vec3(.03,.025,.015),smoothstep(.6,.95,mUp)*(1.-mGilt)*.7);
        mDust=(1.-smoothstep(.0,1.4+M3(.6,23.)*.8,mAbove))*.75*mSide;
        mDust=max(mDust,smoothstep(.75,.95,mUp)*smoothstep(.2,.6,fpNoise(vMW.xz*1.3+7.)*.6+.35)*.65);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.33,.22)*(.85+.3*mG1),mDust*(1.-mGilt*.5));
        // Gilt: gold leaf over bronze, worn back on the edges and in patches; the bronze darkened by soot.
        mWorn=smoothstep(.35,.75,M3(2.3,51.)*.5+.5+mN*.2)*.7+mSoot*.3;
        vec3 mGold=mix(vec3(1.,.66,.26),vec3(.2,.12,.055),mWorn);
        diffuseColor.rgb=mix(diffuseColor.rgb,mGold,mGilt);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.9,.97,mDust),mix(.3,.62,mWorn),mGilt);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=mGilt*mix(.88,.55,mWorn);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.16,.09,.03)*mGilt*(1.-mWorn)*.35;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(.35,1.,mGilt);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Chisel marks and vesicles: a small world-space bump, smoother on the gilt.
          #define MF(q) (fpNoise((q).zy*14.+1.)*mA.x+fpNoise((q).xz*14.+1.)*mA.y+fpNoise((q).xy*14.+1.)*mA.z)
          float e=.012,f0=MF(vMW);
          vec3 g=vec3(MF(vMW+vec3(e,0.,0.))-f0,MF(vMW+vec3(0.,e,0.))-f0,MF(vMW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.007*(1.-mGilt*.7);
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'dawn-citadel-masonry';
  return material;
}
