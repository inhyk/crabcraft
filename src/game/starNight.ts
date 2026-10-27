import * as THREE from 'three';

/*
 * Starhaven's one night: every colour the island is lit by comes from here, so the sky, the sea's reflection, the
 * moonlight, the shade, the fog and the crystals agree. The moon hangs low in the west-north-west, so the northward
 * views are side lit (shadows rake across the roads) and the west views look into it with a rim on every silhouette;
 * the aurora hangs over the northern sea, behind the arena.
 */

/** Unit direction to the moon (and so the moonlight's direction of travel reversed). About 31 degrees up. */
export const STAR_MOON_DIR = new THREE.Vector3(-0.8, 0.55, -0.43).normalize();
/**
 * The Eclipse Queen's eclipse: a black disc hung low in the north over her sanctum (so the street, the approach and
 * the arrival look straight at it), its corona, prominences and a diamond-ring glint on the limb. It is not a light:
 * the moon keeps the island's light and shadows; the eclipse is the sky's landmark and the sanctum's sign.
 */
export const STAR_ECLIPSE_DIR = new THREE.Vector3(-0.045, Math.tan(7.5 * Math.PI / 180), -1).normalize();
/** Angular radius of the black disc (radians). */
export const STAR_ECLIPSE_R = 3.4 * Math.PI / 180;
/** Linear colours. Zenith and horizon of the clear sky; the horizon is also the fog. */
export const STAR_ZENITH = new THREE.Color().setRGB(0.0045, 0.0075, 0.026);
export const STAR_HORIZON = new THREE.Color().setRGB(0.032, 0.04, 0.085);
/**
 * Moonlight: cool silver. The moon (west-north-west, visible in the sky) is the key; the eclipse in the north is a
 * landmark, not a light. Under a half-dark sky the key is moonlight, not sunlight: about half the old strength, its
 * shadows soft and only partly dark (StarNightRig), the shade's sky light carrying the rest.
 */
export const STAR_MOONLIGHT = new THREE.Color().setRGB(0.64, 0.75, 1.0);
export const STAR_MOON_INTENSITY = 2.0;
/** How dark a moon shadow is (1 = black) and how soft its edge (PCF radius in texels). */
export const STAR_MOON_SHADOW = {intensity: 0.62, radius: 5};
/** Shade: the sky dome's light from above, the dark heather's bounce from below. */
export const STAR_SHADE_SKY = new THREE.Color().setRGB(0.1, 0.14, 0.34);
export const STAR_SHADE_GROUND = new THREE.Color().setRGB(0.018, 0.012, 0.03);
export const STAR_SHADE_INTENSITY = 1.3;
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
  const vec3 STAR_ECL=${v3(STAR_ECLIPSE_DIR)};
  const float STAR_ECL_R=${STAR_ECLIPSE_R.toFixed(5)};
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
    // A per-pixel offset of the layers turns their steps into fine grain instead of bands.
    float jit=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    for(int i=0;i<16;i++){
      if(i>=layers)break;
      float f=(float(i)+jit)/n,h=1.+f*3.2;
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
  // The aurora as a reflection sees it: no layers, a smooth glow over the northern sea with its rays.
  vec3 starAuroraGlow(vec3 d,float t){
    if(d.y<.002)return vec3(0.);
    float north=smoothstep(.1,.8,-d.z*inversesqrt(max(dot(d.xz,d.xz),1e-4)));
    float az=atan(d.x,-d.z),e=d.y;
    float foot=smoothstep(.02,.08,e)*exp(-max(e-.08,0.)*7.);
    float rays=.5*nsN1(az*9.+t*.05)+.5*nsN1(az*23.-t*.09);
    vec3 col=mix(vec3(.08,1.,.5),vec3(.5,.22,1.),smoothstep(.08,.3,e));
    return col*north*foot*(.35+.9*rays*rays);
  }
  // The eclipse in angular terms: x the angle from its centre in disc radii, y the position angle round it.
  vec2 starEclipseAt(vec3 d){
    vec3 u=normalize(cross(vec3(0.,1.,0.),STAR_ECL)),v=cross(STAR_ECL,u);
    float c=dot(d,STAR_ECL);
    return vec2(acos(clamp(c,-1.,1.))/STAR_ECL_R,atan(dot(d,v),dot(d,u)));
  }
  // Light round the disc: the inner corona's bright ring, streamers of uneven length along curved field lines, a thin
  // rose chromosphere with a few prominences, and the diamond ring where the last bead of sun shows on the limb.
  vec3 starEclipseLight(vec2 e,float t,bool streamers){
    float r=e.x,a=e.y;
    if(r>7.)return vec3(0.);
    float out1=max(r-1.,0.);
    vec3 col=vec3(0.);
    float inner=exp(-out1*6.)*1.15+exp(-out1*1.8)*.32;
    if(streamers){
      // Streamers: angular noise with a slow twist outward, longer near the eclipse's 'equator' (left and right).
      float tw=a+out1*.18*sin(a*2.+1.3);
      float s=.55*nsN1(tw*4.77+3.1)+.3*nsN1(tw*11.3-1.7)+.15*nsN1(tw*27.+t*.02);
      float eq=.55+.45*abs(cos(a));
      float len=(.3+1.5*s*s*s)*eq;
      inner+=exp(-out1/max(len,.05))*(.12+.8*s*s*s)*smoothstep(0.,.08,out1);
      inner*=.85+.15*sin(t*.3+a*3.);
    }
    col+=vec3(.92,.87,.74)*inner*smoothstep(.985,1.,r);
    // Chromosphere and prominences: rose, hugging the limb.
    float limb=exp(-pow(out1/.035,2.))*smoothstep(.99,1.,r);
    float prom=0.;
    for(int i=0;i<4;i++){float pa=-2.4+float(i)*1.37+.3*sin(float(i)*7.1),da=atan(sin(a-pa),cos(a-pa));prom+=exp(-da*da*900.)*exp(-out1/.11)*smoothstep(.99,1.,r)*(.6+.4*nsH1(float(i)+3.));}
    col+=vec3(1.,.36,.56)*(limb*.9+prom*2.4);
    // The diamond ring: one bead of the sun's limb at the lower right, flaring.
    vec2 bead=vec2(cos(-.72),sin(-.72));vec2 here=vec2(cos(a),sin(a))*r;float db=length(here-bead);
    col+=vec3(1.,.97,.9)*(exp(-db*db*260.)*9.+exp(-db*3.2)*.55);
    return col;
  }
  vec3 starAtmosphere(vec3 direction,float time){
    vec3 d=normalize(direction);
    vec2 e=starEclipseAt(d);
    // Reflections carry the corona's light, not the disc: a black blot broken up by the waves reads as a fault.
    return starGradient(d)+starAuroraGlow(d,time)*.09+starEclipseLight(e,time,false)*.35;
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
    // The eclipse: the disc blacker than the sky round it, its light round it; the aurora hangs in front but thins
    // over the disc so the black reads.
    vec2 e=starEclipseAt(d);
    float disc=1.-smoothstep(.985,1.005,e.x);
    c*=mix(1.,.02,disc);
    c+=starEclipseLight(e,time,true);
    c+=starAurora(d,time,12)*.5*(1.-.85*disc);
    return c;
  }
`;

/** The sky's light on the ground and in the shade, as THREE lights' inputs (for monitor scenes and tools). */
export function starFogColor(out = new THREE.Color()) { return out.copy(STAR_HORIZON); }
