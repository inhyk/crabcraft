import * as THREE from 'three';
import type {Game} from './game';
import {localStorageGet,localStorageSet} from '../app';
import {t} from '../i18n';
import {LIGHTHOUSE} from '../world/layout';

const SAVE_KEY='cc.lighthouseSecret.v1';
/** A small, optional discovery at the foot of the lighthouse, separate from its gallery beacon. */
export class LighthouseSecret {
  readonly root=new THREE.Group();
  readonly position:THREE.Vector3;
  found=localStorageGet(SAVE_KEY)==='found';
  private until=0;
  private nextFirework=0;
  private dancers:THREE.Group[]=[];
  private materials:THREE.MeshStandardMaterial[]=[];
  private geometries:THREE.BufferGeometry[]=[];
  private ring:THREE.Mesh;
  constructor(private game:Game){
    const x=LIGHTHOUSE.x,z=LIGHTHOUSE.z+12;
    this.position=new THREE.Vector3(x,game.world.heightAt(x,z),z);
    this.root.name='Lighthouse keeper’s secret dance';this.root.position.copy(this.position);
    const material=(color:string,glow=0)=>{const m=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:glow,metalness:.45,roughness:.4});this.materials.push(m);return m;};
    const stone=material('#303b48'),gold=material('#e9bb67',.55),teal=material('#62ead8',1.4),blue=material('#a4b4ff',1.2);
    const sphere=new THREE.SphereGeometry(1,12,8),cylinder=new THREE.CylinderGeometry(.9,1,.3,24),torus=new THREE.TorusGeometry(.63,.045,6,48);
    this.geometries.push(sphere,cylinder,torus);
    const mesh=(geo:THREE.BufferGeometry,mat:THREE.Material,parent:THREE.Object3D,x:number,y:number,z:number,sx=1,sy=sx,sz=sx)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m;};
    mesh(cylinder,stone,this.root,0,.15,0);
    this.ring=mesh(torus,gold,this.root,0,1.1,0);
    const crab=(mat:THREE.Material)=>{const g=new THREE.Group();mesh(sphere,mat,g,0,0,0,.34,.17,.23);for(const side of [-1,1]){mesh(sphere,gold,g,side*.13,.22,.13,.045);mesh(sphere,mat,g,side*.43,.14,.06,.13,.17,.1);for(let i=0;i<3;i++){const leg=mesh(sphere,mat,g,side*(.3+i*.045),-.14,.15-i*.15,.04,.2,.04);leg.rotation.z=side*.65;}}return g;};
    const emblem=crab(teal);emblem.position.set(0,1.1,.04);this.root.add(emblem);
    for(let i=0;i<3;i++){const g=crab(i===1?blue:teal);g.position.set((i-1)*1.6,1.2,.7);g.visible=false;this.root.add(g);this.dancers.push(g);}
    game.world.root.add(this.root);
  }
  nearby():boolean {
    const g=this.game,p=g.player.unit.pos;
    return g.world2.chapter===1&&Math.hypot(p.x-this.position.x,p.z-this.position.z)<3.3&&Math.abs(p.y-this.position.y)<2.5;
  }
  interact():void {
    const g=this.game;
    if(!this.nearby()||g.player.channel||g.controlsLocked||this.until>g.time)return;
    g.player.setTarget(null);
    g.player.startChannel(t('바위 속 비밀을 깨우는 중','Waking the secret in the stone'),1.5,'KeyF',this.position.clone().add(new THREE.Vector3(0,1.1,0)),()=>{
      if(!this.nearby()||g.controlsLocked)return;
      const first=!this.found;this.found=true;localStorageSet(SAVE_KEY,'found');
      if(first){g.player.coins=Math.min(Number.MAX_SAFE_INTEGER,g.player.coins+50);g.journey?.save();}
      this.until=g.time+12;this.nextFirework=g.time;
      g.player.unit.express('happy',5);
      g.audio.sfx('sfx-quest-complete');
      g.hud.messages.banner(()=>t('등대지기의 비밀 무대','The keeper’s secret stage'),()=>t(first?'이스터에그 발견! · 비밀의 게 댄스 · 50 코인':'돌아온 관객을 위한 작은 게들의 춤!',first?'Easter egg found! · Secret crab dance · 50 coins':'A little crab dance for a returning guest!'),'zone');
      g.hud.chat.system(t('낡은 바위에 적혀 있어요: “등대지기도 퇴근하면 춤을 춘다.”','The old stone reads: “Even lighthouse keepers dance after work.”'));
    });
  }
  update():void {
    const g=this.game,active=this.until>g.time&&g.world2.chapter===1;
    this.root.visible=g.world2.chapter===1&&g.player.unit.pos.distanceTo(this.position)<55;
    this.ring.rotation.z=Math.sin(g.time*.7)*.08;
    this.ring.scale.setScalar((this.found?1.05:1)+Math.sin(g.time*2)*.025);
    this.dancers.forEach((crab,i)=>{crab.visible=active;crab.position.y=1.4+Math.abs(Math.sin(g.time*4+i))* .55;crab.rotation.set(Math.sin(g.time*4+i)*.16,Math.sin(g.time*2+i)*.7,Math.sin(g.time*4+i)*.2);});
    if(active&&this.root.visible&&g.time>=this.nextFirework){this.nextFirework=g.time+2;g.vfx.firework(this.position.clone(),new THREE.Color(g.time%4<2?'#71f4de':'#f5cb75'),5);}
  }
  dispose():void {this.root.removeFromParent();for(const geo of this.geometries)geo.dispose();for(const mat of this.materials)mat.dispose();}
}
