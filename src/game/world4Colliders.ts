// Frostlight registrations used by the rendered island and the offline collision bake.
import { snowHeight } from '../sim/world/ground';
import { Collision } from '../world/collision';

export function snowTrees() {
  const trees: {x:number;z:number;s:number}[] = [];
  for(let i=0;i<280;i++){
    const a=i*2.399963,r=55+i%7*6,x=Math.sin(a)*r,z=10+Math.cos(a)*108;
    if(Math.hypot(x/128,(z-2)/155)>.78||Math.abs(x)<19||Math.abs(x)<42&&z>23&&z<91||Math.hypot(x,z+78)<30)continue;
    trees.push({x,z,s:.8+i%5*.13});
  }
  return trees;
}

export function layoutFrostlight(): Collision {
  const h = snowHeight;
  const col = new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:h});
  for(const side of [-1,1])for(let i=0;i<3;i++){
    const x=side*29,z=38+i*18,y=h(x,z);
    col.addBox(x,z,5.3,5.8,0,y,y+11);
  }
  const fy=h(-10,56);col.addCircle(-10,56,3.1,fy,fy+5);
  for(const {x,z,s} of snowTrees()){const y=h(x,z);col.addCircle(x,z,.6*s,y,y+10*s);}
  for(let i=0;i<42;i++){
    const a=i/42*Math.PI*2,x=Math.sin(a)*78,z=-42+Math.cos(a)*70;
    if(Math.abs(x)<16&&z>-70)continue;
    const y=h(x,z),height=6+i%5*3;col.addCircle(x,z,3.5,y,y+height);
  }
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2;if(Math.cos(a)>.7)continue;
    const x=Math.sin(a)*25,z=-78+Math.cos(a)*25,y=h(x,z);col.addCircle(x,z,1.5,y,y+10);
  }
  return col;
}
