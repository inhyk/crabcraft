import * as THREE from 'three';

/** A six-sided crystal with a shoulder, long prism faces and a pointed crown.
 * The local axis bounds match the old unit crystal; its rotated footprint is measured below.
 * Non-indexed faces retain crisp normals and a restrained baked facet tint under moonlight.
 */
export function facetedStarCrystal():THREE.BufferGeometry {
  const positions:number[]=[],colours:number[]=[];
  const ring=(i:number,r:number,y:number,twist=0)=>{const a=i*Math.PI/3+twist;return [Math.cos(a)*r,y,Math.sin(a)*r];};
  const triangle=(a:number[],b:number[],c:number[],shade:number)=>{
    positions.push(...a,...c,...b);for(let i=0;i<3;i++)colours.push(shade,shade,shade);
  };
  const quad=(a:number[],b:number[],c:number[],d:number[],shade:number)=>{triangle(a,b,c,shade);triangle(a,c,d,shade);};
  const facet=[.82,.96,1,.86,.94,.9];
  for(let i=0;i<6;i++){
    const next=(i+1)%6,lo=ring(i,.58,-.78),ln=ring(next,.58,-.78),body=ring(i,.92,-.45),bn=ring(next,.92,-.45),top=ring(i,.82,.43,.07),tn=ring(next,.82,.43,.07),shade=facet[i];
    triangle([0,-.95,0],ln,lo,shade*.8);
    quad(lo,ln,bn,body,shade*.9);
    quad(body,bn,tn,top,shade);
    triangle(top,tn,[.05,1,-.03],Math.min(1,shade*1.06));
  }
  const geometry=new THREE.BufferGeometry();geometry.name='star-faceted-crystal';
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

/** Include every rotated facet in the analytic camera/player collider, with a small clearance. */
export function starCrystalRadius(geometry:THREE.BufferGeometry,scale:THREE.Vector3,orientation:THREE.Quaternion):number {
  const positions=geometry.attributes.position,point=new THREE.Vector3();let radius=0;
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).multiply(scale).applyQuaternion(orientation);
    radius=Math.max(radius,Math.hypot(point.x,point.z));
  }
  return radius+.08;
}
