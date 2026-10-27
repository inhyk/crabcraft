import * as THREE from 'three';
import {Masonry,type BlockOpts,type V3,type Warp} from './frostMasonry';
import {FROST_NOISE} from './frostPaving';

/*
 * Solarkan's citadel stone: the desert sun temple was raised in courses of warm sandstone banded with cream
 * limestone, black basalt kept for accents (obelisks, pillar drums, voussoirs), its string courses and emblems
 * gilded. The mason (frostMasonry.ts Masonry, every block its own chamfered prism over a mortar core) lays the same
 * walls; this one picks a sandstone or a limestone tint by the height of each block, so the bands run round the whole
 * citadel at the same level, and marks gilded pieces through the mason's per-vertex `snow` channel (here: gilt).
 * dawnMasonryMaterial() weathers it for the desert: sun-bleached tops, sand blown into the foot of every wall and
 * lodged on the ledges, dark desert varnish run down the faces, and gold leaf worn back to bronze on the edges.
 */

/** Height bands of limestone in the basalt: pale where (y - y0) mod period < pale. The shader uses the same rule. */
export const DAWN_BANDS = {y0: 15.6, period: 3.4, pale: 1.15} as const;
export const isPale = (y: number) => { const k = (((y - DAWN_BANDS.y0) % DAWN_BANDS.period) + DAWN_BANDS.period) % DAWN_BANDS.period; return k < DAWN_BANDS.pale; };

export class DawnMason extends Masonry {
  /** Lay the limestone bands (walls, towers); off for plain basalt pieces. */
  bands = true;
  /** Force every block laid next to limestone (quoins, dressings), sandstone or basalt (accents); null follows the bands. */
  stone: 'pale' | 'sand' | 'basalt' | null = null;
  private p: () => number;
  constructor(rand: () => number, salt = 0) {
    super(rand, salt);
    let s = (91019 + salt * 613) >>> 0;
    this.p = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  /** Gilded pieces: the shader reads the mason's snow channel as gilt. */
  set gilt(on: boolean) { this.snow = on ? 1 : 0; }
  get gilt() { return this.snow > .5; }

  /** Warm sandstone, every stone its own: ochre, a redder one, a paler one now and then, some darkened. */
  override tint(k = 1, rng: () => number = this.rand): V3 {
    const a = rng(), b = rng(), c = rng();
    const v = (b < .08 ? 1.1 : b > .94 ? .86 : .94 + (b - .08) * .14) * (.3 + c * .03);
    const hue: V3 = a < .12 ? [1.04, .7, .44] : a > .9 ? [1, .76, .52] : [1, .72, .46];
    return [v * hue[0] * k, v * hue[1] * k, v * hue[2] * k];
  }
  /** Black basalt for accents: brown-black, blue-black. */
  basaltTint(k = 1): V3 {
    const r = this.p, b = r(), c = r();
    const v = (b > .85 ? 1.3 : .9 + b * .2) * (.05 + c * .018);
    return [v * k, v * .95 * k, v * .92 * k];
  }
  /** Cream limestone: ivory, a warmer one, a greyer one, each stone its own. */
  paleTint(k = 1): V3 {
    const r = this.p, a = r(), b = r();
    const v = (.84 + b * .3) * (b > .94 ? .82 : 1);
    const hue: V3 = a < .18 ? [1.04, .92, .74] : a > .85 ? [.98, .93, .84] : [1, .9, .72];
    return [.46 * v * hue[0] * k, .46 * v * hue[1] * k, .46 * v * hue[2] * k];
  }
  override block(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, o: BlockOpts = {}): void {
    if (!this.gilt && this.course !== 2) {
      if (this.stone === 'basalt') o = {...o, tint: this.basaltTint()};
      else if (this.stone ? this.stone === 'pale' : this.bands && isPale(v0 + h / 2)) o = {...o, tint: this.paleTint()};
    }
    super.block(warp, u0, v0, t0, w, h, d, o);
  }
}

/** Value of the mason's snow channel (aSnow) that marks polished red granite (obelisks): under the gilt threshold. */
export const GRANITE = .25;

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
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying float vMG;\nvarying float vMS;\nvarying float vMC;\nvarying vec3 vMW;\nvarying vec3 vMN;\nfloat mGilt;\nfloat mGran;\nfloat mWorn;\nfloat mDust;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // One projection per fragment, on the plane the face mostly lies in: walls and towers read the same, at a
        // third of the noise of a triplanar blend.
        vec3 mNW=normalize(vMN);
        vec2 mUV=abs(mNW.y)>.7?vMW.xz:(abs(mNW.x)>abs(mNW.z)?vMW.zy:vMW.xy);
        #define MN(f,o) fpNoise(mUV*(f)+(o))
        float mSide=1.-abs(mNW.y),mAbove=vMW.y-vMG;
        float mFoot=length(fwidth(vMW)),mNear=1.-smoothstep(.004,.02,mFoot);
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
          vec3 mPale=vec3(.46,.41,.33)*(.84+.3*fpHash12(vec2(mBi*.37+5.,mCi)));
          vec3 mBas=vec3(.3,.215,.138)*(mH1<.14?1.18:mH1>.9?.78:.9+(mH1-.14)*.22);
          diffuseColor.rgb=(mK<${DAWN_BANDS.pale.toFixed(2)}&&mGilt<.5?mPale:mBas)*mix(1.,.45,mJ);
        }
        float mL=dot(diffuseColor.rgb,vec3(.3,.59,.11)),mBasalt=1.-smoothstep(.07,.16,mL);
        // Red granite: rose feldspar flecked with black mica and a few pale grains, polished.
        mGran=step(.15,vMS)*(1.-step(.45,vMS));
        if(mGran>0.){mBasalt=0.;float gf=fpNoise(mUV*57.+7.)*.5+.5,gp=fpNoise(mUV*31.+19.)*.5+.5;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03,.026,.026),smoothstep(.66,.76,gf)*.85);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.3,.25),smoothstep(.72,.82,gp)*.55);}
        float mN=MN(.7,2.),mW=MN(.13,41.);
        // Broad mottling and weather bigger than a stone.
        diffuseColor.rgb*=(.82+.26*(mN*.5+.5))*(.8+.36*smoothstep(.15,.85,mW*.5+.5));
        // Up close: grain, and the basalt pitted with vesicles.
        mDust=0.;
        if(mNear>0.){
          float mG1=MN(38.,5.)*.5+.5,mG2=MN(23.,11.)*.5+.5;
          diffuseColor.rgb*=mix(1.,mix(1.,.62,smoothstep(.62,.8,mG1))*mix(1.,1.25,smoothstep(.7,.86,1.-mG1))*(1.-smoothstep(.72,.86,mG2)*mBasalt*.6),mNear*(1.-mGilt));
        }
        // The joints: lime mortar, pale and sandy, receding to the stone's value with distance.
        if(vMC>1.5)diffuseColor.rgb=mix(vec3(.3,.25,.19)*(.75+.5*(mN*.5+.5)),vec3(.14,.1,.07),smoothstep(.008,.035,mFoot)*.8);
        // Desert varnish run down from the tops in long dark streaks, stronger on the limestone.
        vec2 mTw=normalize(vec2(-mNW.z,mNW.x)+1e-4);float mAlong=dot(vMW.xz,mTw);
        float mSoot=smoothstep(.4,.8,fpNoise(vec2(mAlong*.55,vMW.y*.035+mW*.4))*.5+.5)*mSide*(1.-mGilt);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.5,.4,.32),mSoot*.6*(1.-mBasalt));
        // Iron-red stain blooms here and there on the sandstone.
        float mLich=smoothstep(.8,.94,mW*.5+.5+mN*.12)*mSide*(1.-mBasalt)*(1.-mGilt);
        diffuseColor.rgb*=mix(vec3(1.),vec3(1.12,.82,.66),mLich*.6);
        // Sun-bleached tops; sand blown against the foot and lodged on the ledges.
        float mUp=mNW.y+mN*.1;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.25+vec3(.03,.025,.015),smoothstep(.6,.95,mUp)*(1.-mGilt)*.7);
        mDust=(1.-smoothstep(.0,1.4+mN*.8,mAbove))*.75*mSide;
        mDust=max(mDust,smoothstep(.75,.95,mUp)*smoothstep(.2,.6,mW*.6+.35)*.65);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.5,.38,.24)*(.85+.3*(mN*.5+.5)),mDust*(1.-mGilt*.5));
        // Gilt: gold leaf over bronze, worn back in patches; bronze (doors, grilles) is .7 in the same channel.
        float mBronze=mGilt*(1.-step(.85,vMS));
        mWorn=mix(smoothstep(.35,.75,(mGilt>.5?MN(2.3,51.):0.)*.5+.5+mN*.2)*.7+mSoot*.3,.2,mBronze);
        vec3 mGold=mix(mix(vec3(.95,.58,.19),vec3(.2,.12,.05),mWorn),vec3(.15,.085,.04)*(.8+.4*(mN*.5+.5)),mBronze);
        diffuseColor.rgb=mix(diffuseColor.rgb,mGold,mGilt);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(mix(.9,.97,mDust),.42+mDust*.4,mGran),mix(.3,.62,mWorn),mGilt);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=mGilt*mix(.88,.55,mWorn);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.16,.09,.03)*mGilt*(1.-mWorn)*.35;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(.35,1.,mGilt);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        if(mNear>0.){
          // Chisel marks and vesicles up close: a small bump in the face's plane, smoother on the gilt.
          float e=.015,f0=MN(14.,1.),fu=fpNoise((mUV+vec2(e,0.))*14.+1.)-f0,fv=fpNoise((mUV+vec2(0.,e))*14.+1.)-f0;
          vec3 pu=abs(mNW.y)>.7?vec3(1.,0.,0.):(abs(mNW.x)>abs(mNW.z)?vec3(0.,0.,1.):vec3(1.,0.,0.));
          vec3 pv=abs(mNW.y)>.7?vec3(0.,0.,1.):vec3(0.,1.,0.);
          vec3 g=(pu*fu+pv*fv)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.007*(1.-mGilt*.7)*mNear;
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'dawn-citadel-masonry';
  return material;
}
