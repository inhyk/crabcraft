/** Hash, gradient noise, fbm and a cellular split shared by Emberreach's ground, paving, court and rock shaders. */
export const EMBER_NOISE = /* glsl */ `
vec2 egHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float egHash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float egNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(egHash22(i)*2.-1.,f),b=dot(egHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(egHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(egHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float egFbm(vec2 p){return egNoise(p)*.55+egNoise(p*2.03+7.1)*.3+egNoise(p*4.11-3.7)*.15;}
// Cellular split: x = distance to the cell edge (approximate), y = cell id, z = distance to the cell point.
vec3 egCells(vec2 p){
  vec2 i=floor(p),f=fract(p);float f1=8.,f2=8.;vec2 c1=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y)),d=g+.1+.8*egHash22(i+g)-f;float l=dot(d,d);
    if(l<f1){f2=f1;f1=l;c1=i+g;}else if(l<f2)f2=l;}
  return vec3((sqrt(f2)-sqrt(f1))*.5,egHash12(c1),sqrt(f1));
}
vec3 egSrgb(vec3 c){return pow(c,vec3(2.2));}
// Height-to-normal from screen derivatives (world-space bump), as the Starhaven paving does it.
vec3 egBump(vec3 normalV,float h,vec2 dpx,vec2 dpy){
  float dhx=dFdx(h),dhy=dFdy(h),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 g=abs(det)>1e-12?clamp(vec2(dhx*dpy.y-dhy*dpx.y,dpx.x*dhy-dpy.x*dhx)/det,-1.5,1.5):vec2(0.);
  vec3 nW=inverseTransformDirection(normalV,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  return normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

/** Detail tier shared by every Emberreach ground shader: 1 high, 0 low (cheaper: no pebbles, no relief). */
export const EMBER_DETAIL = {value: 1};
let checkedAt = -1e9;
/** Follow the stored quality (as emberLava.ts does), at most once a second. */
export function refreshEmberDetail(time: number) {
  if (time - checkedAt < 1 && time >= checkedAt) return;
  checkedAt = time;
  let low = false;
  try { low = localStorage.getItem('cc.quality') === 'low'; } catch { /* private mode */ }
  EMBER_DETAIL.value = low ? 0 : 1;
}
