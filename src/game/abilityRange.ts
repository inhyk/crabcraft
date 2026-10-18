// Local hover guide. World units are metres, matching ability collision checks.
import * as THREE from 'three';
import type {Game} from './game';
import type {AbilityDef} from '../data/classes';
import {isMeleeAbility} from './abilities';

export class AbilityRange {
  readonly root = new THREE.Group();
  private border = new THREE.BufferGeometry();
  private fill = new THREE.BufferGeometry();
  private lines = new Float32Array(1024*3);
  private faces = new Float32Array(512*3);
  private lineMaterial = new THREE.LineBasicMaterial({color:'#9af5ff',transparent:true,opacity:.95,depthTest:false,depthWrite:false});
  private fillMaterial = new THREE.MeshBasicMaterial({color:'#36d9ef',transparent:true,opacity:.09,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  private ability: AbilityDef | null = null;

  constructor(private readonly game: Game) {
    this.root.name='ability-range-preview';this.root.userData.mapHidden=true;
    this.border.setAttribute('position',new THREE.BufferAttribute(this.lines,3).setUsage(THREE.DynamicDrawUsage));
    this.fill.setAttribute('position',new THREE.BufferAttribute(this.faces,3).setUsage(THREE.DynamicDrawUsage));
    const outline=new THREE.LineSegments(this.border,this.lineMaterial),area=new THREE.Mesh(this.fill,this.fillMaterial);
    outline.frustumCulled=area.frustumCulled=false;
    area.renderOrder=40;outline.renderOrder=41;
    this.root.add(area,outline);this.root.visible=false;game.scene.add(this.root);
  }

  show(ability: AbilityDef | null): void { this.ability=ability;this.update(); }

  update(): void {
    const g=this.game,ab=this.ability;
    this.root.visible=!!ab&&!g.controlsLocked;
    if(!this.root.visible||!ab)return;
    const healing=ab.id==='mend-shell'||ab.id==='holy-tide';
    this.lineMaterial.color.set(healing?'#9affbd':'#9af5ff');this.fillMaterial.color.set(healing?'#4cf49c':'#36d9ef');
    const u=g.player.unit,r=isMeleeAbility(ab)?u.radius+1.8:ab.range;
    this.root.userData.radius=r;this.root.userData.ability=ab.id;
    if(r<=0){this.root.visible=false;return;}
    const cone=ab.id==='frost-spray',blink=ab.id==='steam-blink';
    const half=cone?0.55:Math.PI;
    const start=cone?u.yaw-half:0,span=cone?half*2:Math.PI*2;
    let n=0,f=0;
    const point=(a:number,d:number):[number,number,number]=>{
      const x=u.pos.x+Math.sin(a)*d,z=u.pos.z+Math.cos(a)*d;
      return [x,Math.max(g.world.heightAt(x,z),0)+.18,z];
    };
    const edge=(a:number[],b:number[])=>{this.lines.set(a,n);n+=3;this.lines.set(b,n);n+=3;};
    const centre=point(0,0);
    if(!blink){
      for(let i=0;i<96;i++){
        const a=point(start+span*i/96,r),b=point(start+span*(i+1)/96,r);
        edge(a,b);this.faces.set([...centre,...a,...b],f);f+=9;
      }
      if(cone){edge(centre,point(start,r));edge(centre,point(start+span,r));}
    }
    // One-metre ticks make distances legible without relying on camera zoom.
    for(let d=0;d<r;d+=.5)edge(point(u.yaw,d),point(u.yaw,Math.min(r,d+.25)));
    for(let d=1;d<=r;d++){
      const p=point(u.yaw,d),dx=Math.cos(u.yaw)*.18,dz=-Math.sin(u.yaw)*.18;
      edge([p[0]-dx,p[1],p[2]-dz],[p[0]+dx,p[1],p[2]+dz]);
    }
    this.border.setDrawRange(0,n/3);this.fill.setDrawRange(0,f/3);
    this.border.getAttribute('position').needsUpdate=true;this.fill.getAttribute('position').needsUpdate=true;
  }

  dispose(): void {
    this.root.removeFromParent();this.border.dispose();this.fill.dispose();this.lineMaterial.dispose();this.fillMaterial.dispose();
  }
}
