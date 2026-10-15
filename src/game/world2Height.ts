import {MathUtils} from 'three';
import {STAR_OBJECTIVES} from './world2Settlement';

const NX=141,NZ=161,STEP=2,MIN_X=-140,MIN_Z=-160;

function naturalHeight(x:number,z:number){
  const r=Math.hypot(x/115,(z-10)/140),coast=MathUtils.smoothstep(r,.83,1.04);
  return 3+Math.sin(x*.08)*Math.cos(z*.06)*1.8+Math.max(0,r-.65)*12-coast*21;
}

function shapedHeight(x:number,z:number){
  let y=naturalHeight(x,z);
  for(const kind of ['explore-west','explore-east'] as const){
    const p=STAR_OBJECTIVES[kind]!,d=Math.hypot(x-p[0],z-p[1]);
    if(d<13)y=MathUtils.lerp(naturalHeight(...p),y,MathUtils.smoothstep(d,8,13));
  }
  const rect=(ax:number,bx:number,az:number,bz:number)=>Math.hypot(Math.max(ax-x,0,x-bx),Math.max(az-z,0,z-bz));
  // Keep the existing town, avenue and boss floor level; blend their outer edges into hills.
  const distance=Math.min(Math.max(0,Math.hypot(x,z+75)-24),rect(-9,9,-100,105),rect(-54,54,3,100));
  return MathUtils.lerp(3,y,MathUtils.smoothstep(distance,0,6));
}

export function buildStarHeights(){
  const heights=new Float32Array(NX*NZ);
  for(let z=0;z<NZ;z++)for(let x=0;x<NX;x++)heights[z*NX+x]=shapedHeight(MIN_X+x*STEP,MIN_Z+z*STEP);
  return heights;
}

/** PlaneGeometry uses a–b–d / b–c–d triangles. Follow their planes, including off-grid points. */
export function starSurfaceHeight(heights:Float32Array,x:number,z:number){
  const gx=MathUtils.clamp((x-MIN_X)/STEP,0,NX-1),gz=MathUtils.clamp((z-MIN_Z)/STEP,0,NZ-1);
  const ix=Math.min(NX-2,Math.floor(gx)),iz=Math.min(NZ-2,Math.floor(gz)),u=gx-ix,v=gz-iz;
  const a=heights[iz*NX+ix],b=heights[(iz+1)*NX+ix],d=heights[iz*NX+ix+1],c=heights[(iz+1)*NX+ix+1];
  return u+v<=1?a+(d-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d-c)*(1-v);
}
