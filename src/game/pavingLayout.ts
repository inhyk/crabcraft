export type PavingPoint=readonly [number,number];
export type PavingPolygon=PavingPoint[];
const EPS=1e-8;
const cross=(a:PavingPoint,b:PavingPoint,p:PavingPoint)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
export function pavingArea(p:readonly PavingPoint[]):number {
  return p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
}
function halfPlane(p:PavingPolygon,a:PavingPoint,b:PavingPoint,inside:boolean,margin=0):PavingPolygon {
  const out:PavingPolygon=[],offset=margin*Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(let i=0;i<p.length;i++){
    const u=p[i],v=p[(i+1)%p.length],du=cross(a,b,u)-offset,dv=cross(a,b,v)-offset;
    const keepU=inside?du>=-EPS:du<=EPS,keepV=inside?dv>=-EPS:dv<=EPS;
    if(keepU)out.push(u);
    if(keepU!==keepV){const t=du/(du-dv);out.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t]);}
  }
  return out;
}
/** Convex difference yields disjoint convex fragments, including rotated junctions. */
export function subtractPaving(subject:PavingPolygon,clip:PavingPolygon):PavingPolygon[] {
  let intersection=subject;
  for(let i=0;i<clip.length&&intersection.length>=3;i++)intersection=halfPlane(intersection,clip[i],clip[(i+1)%clip.length],true);
  if(intersection.length<3||pavingArea(intersection)<EPS)return [subject];
  const result:PavingPolygon[]=[];let remaining=subject;
  for(let i=0;i<clip.length&&remaining.length>=3;i++){
    const a=clip[i],b=clip[(i+1)%clip.length],outside=halfPlane(remaining,a,b,false);
    if(pavingArea(outside)>EPS)result.push(outside);
    remaining=halfPlane(remaining,a,b,true);
  }
  return result;
}
export function insetPaving(p:PavingPolygon,margin:number):PavingPolygon {
  let result=p;
  for(let i=0;i<p.length&&result.length>=3;i++)result=halfPlane(result,p[i],p[(i+1)%p.length],true,margin);
  return result;
}
const bounds=(p:PavingPolygon)=>({minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[1])),maxZ:Math.max(...p.map(v=>v[1]))});
/** Reserve each stone once. A spatial index keeps long village paths inexpensive. */
export class PavingLayout {
  readonly polygons:PavingPolygon[]=[];
  private cells=new Map<string,number[]>();
  private keys(p:PavingPolygon){const b=bounds(p),keys:string[]=[];for(let x=Math.floor(b.minX/3);x<=Math.floor(b.maxX/3);x++)for(let z=Math.floor(b.minZ/3);z<=Math.floor(b.maxZ/3);z++)keys.push(`${x}:${z}`);return keys;}
  reserve(p:PavingPolygon):PavingPolygon[] {
    const keys=this.keys(p),near=new Set(keys.flatMap(k=>this.cells.get(k)??[]));let pieces=[p];
    for(const i of near){pieces=pieces.flatMap(part=>subtractPaving(part,this.polygons[i]));if(!pieces.length)break;}
    // Keep the unsplit footprint reserved: cuts must not admit a later overlapping stone.
    const id=this.polygons.length;this.polygons.push(p);for(const key of keys){const cell=this.cells.get(key)??[];cell.push(id);this.cells.set(key,cell);}
    return pieces.map(part=>insetPaving(part,.04)).filter(part=>part.length>=3&&pavingArea(part)>.018);
  }
}

/** Match the rendered terrain triangles so a hill cannot poke through a flagstone. */
export function pavingGround(height:(x:number,z:number)=>number,x:number,z:number,realm:2|3|4|5|6):number {
  const step=realm===2?2:2.5,minX=realm===2?-140:-150,minZ=realm===2?-160:-175;
  const ax=minX+Math.floor((x-minX)/step)*step,az=minZ+Math.floor((z-minZ)/step)*step,u=(x-ax)/step,v=(z-az)/step;
  const a=height(ax,az),b=height(ax+step,az),c=height(ax,az+step),d=height(ax+step,az+step);
  // PlaneGeometry's diagonal joins the southwest and northeast corners after rotation.
  const rendered=u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  return Math.max(height(x,z),rendered);
}
