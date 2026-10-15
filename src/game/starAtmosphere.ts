/** Shared sky radiance for the dome and its inexpensive water reflection. */
export const STAR_MOON_POSITION=[-150,65,-600] as const;
export const STAR_ATMOSPHERE=/* glsl */`
  vec3 starAtmosphere(vec3 direction,float time){
    vec3 d=normalize(direction);
    float a=atan(d.z,d.x),t=time*.025;
    float horizon=exp(-max(0.,d.y)*4.5);
    vec3 color=mix(vec3(.009,.012,.04),vec3(.058,.038,.105),horizon);
    float height=.115+.045*sin(a*3.+t)+.025*sin(a*7.-t*.7);
    float folds=.28+.72*pow(.5+.5*sin(a*29.+sin(a*7.-t)*2.),2.);
    float ribbon=exp(-pow((d.y-height)/.055,2.))*folds;
    float high=exp(-pow((d.y-height-.09-.03*sin(a*5.+t*.8))/.075,2.));
    float veil=smoothstep(.005,.065,d.y)*(1.-smoothstep(.35,.6,d.y));
    float hue=.5+.5*sin(a*4.+t*.4);
    color+=veil*(ribbon*mix(vec3(.045,.42,.29),vec3(.15,.12,.43),hue)*.7
      +high*vec3(.105,.055,.2)*.35);
    return color;
  }
`;
