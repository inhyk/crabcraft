import * as THREE from 'three';

/*
 * Starhaven's one night: every colour the island is lit by comes from here, so the sky, the sea's reflection, the
 * moonlight, the shade, the fog and the crystals agree. The moon hangs low in the west-north-west, so the northward
 * views are side lit (shadows rake across the roads) and the west views look into it with a rim on every silhouette;
 * the aurora hangs over the northern sea, behind the arena.
 */

/** Unit direction to the moon (and so the moonlight's direction of travel reversed). About 25 degrees up. */
export const STAR_MOON_DIR = new THREE.Vector3(-0.8, 0.42, -0.43).normalize();
/** Linear colours. Zenith and horizon of the clear sky; the horizon is also the fog. */
export const STAR_ZENITH = new THREE.Color().setRGB(0.0045, 0.0075, 0.026);
export const STAR_HORIZON = new THREE.Color().setRGB(0.032, 0.04, 0.085);
/** Moonlight: cool silver, strong enough to cast crisp shadows and read the ground against the sky. */
export const STAR_MOONLIGHT = new THREE.Color().setRGB(0.62, 0.74, 1.0);
export const STAR_MOON_INTENSITY = 3.4;
/** Shade: the sky dome's light from above, the dark heather's bounce from below. */
export const STAR_SHADE_SKY = new THREE.Color().setRGB(0.1, 0.14, 0.34);
export const STAR_SHADE_GROUND = new THREE.Color().setRGB(0.018, 0.012, 0.03);
export const STAR_SHADE_INTENSITY = 0.85;
export const STAR_FOG_DENSITY = 0.0042;

const v3 = (v: THREE.Vector3 | THREE.Color) => v instanceof THREE.Color ? `vec3(${v.r.toFixed(4)},${v.g.toFixed(4)},${v.b.toFixed(4)})` : `vec3(${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)})`;

/**
 * GLSL: `starAtmosphere(dir, time)` for reflections (sea, crystals: gradient, moon glow and a four-layer aurora),
 * `starSkyRadiance(dir, time)` for the dome (the same plus a sixteen-layer aurora with vertical rays, the milky
 * band and the moon's halo). The aurora is two curtains hung over the northern sea at altitude: each layer is the
 * curtain sheet seen at one height, so its rays line up vertically on screen and move with parallax.
 */
export const STAR_SKY_GLSL = /* glsl */ `
  const vec3 STAR_MOON=${v3(STAR_MOON_DIR)};
  float nsH1(float n){return fract(sin(n*12.9898)*43758.5453);}
  float nsN1(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(nsH1(i),nsH1(i+1.),f);}
  float nsH2(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  float nsN2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(nsH2(i),nsH2(i+vec2(1.,0.)),f.x),mix(nsH2(i+vec2(0.,1.)),nsH2(i+1.),f.x),f.y);}
  vec3 starGradient(vec3 d){
    float y=max(d.y,0.);
    vec3 c=mix(${v3(STAR_HORIZON)},${v3(STAR_ZENITH)},pow(smoothstep(0.,.62,y),.65));
    // A paler band just over the sea line and a soft lift in the moon's quarter.
    c+=vec3(.012,.016,.03)*exp(-y*14.);
    float m=max(dot(d,STAR_MOON),0.);
    c+=vec3(.05,.065,.11)*pow(m,6.)+vec3(.12,.15,.24)*pow(m,60.);
    if(d.y<0.)c=mix(c,${v3(STAR_HORIZON)}*.55,smoothstep(0.,-.2,d.y));
    return c;
  }
  // The curtains' foot line in plan (north is -z), in units of the lowest layer's altitude.
  float starCurtain(float x,float t){return -11.5+2.2*sin(x*.13+t*.045)+1.*sin(x*.37-t*.08+1.3)+.45*sin(x*1.1+t*.19);}
  vec3 starAurora(vec3 d,float t,int layers){
    if(d.y<.004)return vec3(0.);
    vec3 acc=vec3(0.);float n=float(layers);
    for(int i=0;i<16;i++){
      if(i>=layers)break;
      float f=(float(i)+.5)/n,h=1.+f*3.2;
      vec2 p=d.xz*(h/d.y);
      // Two folded sheets: the near one bright, a fainter one behind and offset.
      float a=p.y-starCurtain(p.x,t),b=p.y-(starCurtain(p.x*.8+9.,t*1.3)-5.);
      float sheet=exp(-a*a*1.6)+.6*exp(-b*b*1.2);
      if(sheet<.002)continue;
      // Rays: brightness varies along the curtain only, so it streaks straight up the layers.
      float along=p.x+.35*sin(p.y*.7);
      float rays=.5*nsN1(along*1.4+t*.22)+.32*nsN1(along*4.3-t*.5)+.18*nsN1(along*11.-t*.9);
      rays=pow(rays,2.)*2.6+.12;
      float pulse=.75+.25*sin(along*.9-t*.6);
      // A sharp lit foot that fades upward; green low, violet and rose in the tops.
      float prof=smoothstep(0.,.07,f)*exp(-f*2.3);
      vec3 col=mix(vec3(.08,1.,.5),vec3(.5,.22,1.),smoothstep(.12,.75,f));
      col=mix(col,vec3(.9,.25,.6),smoothstep(.7,1.,f)*.5);
      acc+=col*sheet*rays*pulse*prof;
    }
    return acc*smoothstep(.004,.05,d.y)*(2.2/n);
  }
  vec3 starAtmosphere(vec3 direction,float time){
    vec3 d=normalize(direction);
    return starGradient(d)+starAurora(d,time,4)*.35;
  }
  vec3 starSkyRadiance(vec3 direction,float time){
    vec3 d=normalize(direction);
    vec3 c=starGradient(d);
    // The milky band: a great circle across the zenith, clumped and cut by dust lanes.
    vec3 mwN=normalize(vec3(.55,.32,.77));
    float b=dot(d,mwN);
    vec3 mwU=normalize(cross(mwN,vec3(0.,1.,0.))),mwV=cross(mwN,mwU);
    vec2 q=vec2(atan(dot(d,mwV),dot(d,mwU))*3.,b*9.);
    float clump=nsN2(q*2.1)*.6+nsN2(q*5.3)*.4;
    float dust=smoothstep(.35,.75,nsN2(q*1.7+vec2(4.,1.))*.65+nsN2(q*4.4)*.35);
    float band=exp(-b*b*28.)*(.45+.75*clump)*(1.-.7*dust*exp(-b*b*80.));
    c+=vec3(.024,.026,.04)*band*smoothstep(.02,.3,d.y);
    c+=starAurora(d,time,16)*.5;
    return c;
  }
`;

/** The sky's light on the ground and in the shade, as THREE lights' inputs (for monitor scenes and tools). */
export function starFogColor(out = new THREE.Color()) { return out.copy(STAR_HORIZON); }
