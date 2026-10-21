import * as THREE from 'three';
import type {Game} from './game';
import type {BoatState, BoatCommand} from '../../server/combatProtocol';
import {t} from '../i18n';
import type {EntityRef} from '../sim/types.ts';

const home=()=>({x:151,z:18.5,yaw:Math.PI/2,speed:0,seats:[null,null] as [string|null,string|null]});
/** The host owns reservations and navigation. Guests only submit controls. */
export class ShoreBoat {
  readonly root=new THREE.Group();
  state:BoatState=home();
  private throttle=0;private steer=0;private inputAt=-10;private sentAt=-10;
  private wasSeated=false;private observedSelf='';
  private resources:(THREE.BufferGeometry|THREE.Material)[]=[];
  constructor(private g:Game,private observed=false){
    this.root.name='Two-seat shore skiff';
    const mat=(color:string,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.65,metalness});this.resources.push(m);return m;};
    const wood=mat('#754731'),trim=mat('#e5bc76',.35),paint=mat('#236a75'),dark=mat('#30251e'),light=mat('#a7f8e4');
    const box=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,16,10);this.resources.push(box,sphere);
    const part=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;this.root.add(mesh);return mesh;};
    // Open plank hull, raised gunwales, two cross benches and brass ribs.
    for(let i=-4;i<=4;i++){const z=i*.85,w=1.65*(1-Math.pow(Math.abs(i)/5,2)*.8);part(box,i%2?wood:dark,0,.12,z,w*2,.18,.82);for(const side of [-1,1]){const wall=part(box,paint,side*w,.42,z,.16,.72,.88);wall.rotation.z=-side*.13;part(box,trim,side*w,.81,z,.2,.1,.88);}}
    for(const z of [-1.65,1.65]){part(box,wood,0,.55,z,2.9,.18,.65);part(box,trim,0,.66,z,2.9,.05,.1);}
    for(const side of [-1,1]){const oar=part(box,wood,side*2.05,.9,-.2,.12,.12,4.5);oar.rotation.y=side*.4;part(box,trim,side*1.7,.9,.2,.3,.25,.3);}
    part(box,dark,0,.95,3.3,.12,1.5,.12);part(sphere,light,0,1.75,3.3,.18,.25,.18);
    const glow=new THREE.MeshStandardMaterial({color:'#85ffe7',emissive:'#85ffe7',emissiveIntensity:1.2});this.resources.push(glow);part(sphere,glow,0,1.75,3.3,.13,.18,.13);
    g.world.root.getObjectByName('shore-rideable-rowboat')?.removeFromParent();
    g.world.root.add(this.root);
  }
  private get id(){if(this.observed)return this.observedSelf;const b=this.g.multiplayer?.battle;return b?.active?b.ownId:'solo';}
  get seated(){return this.state.seats.includes(this.id);}
  nearby(){const p=this.g.player.unit.pos;return this.g.world2.chapter===1&&(this.seated||this.canSummon()||this.canBoard(p.x,p.y,p.z));}
  private atDock(){const p=this.g.player.unit.pos;return Math.hypot(p.x-144,p.z-19)<4.5;}
  private canSummon(){return !this.state.seats.some(Boolean)&&Math.hypot(this.state.x-151,this.state.z-18.5)>12&&this.atDock();}
  private canBoard(x:number,y:number,z:number){return Math.hypot(x-this.state.x,z-this.state.z)<12&&Math.abs(this.state.speed)<.5&&y>.15&&Math.abs(y-this.g.world.heightAt(x,z))<2;}
  /** Forward first, then the flanks: never land on cliffs, water or inside a wall. */
  landing(radius=this.g.player.unit.radius??1.2){
    const g=this.g,s=this.state,out=new THREE.Vector2(),r=Math.max(.8,radius);
    for(const angle of [0,-.35,.35,-.7,.7,-1.2,1.2,Math.PI])for(let d=5;d<=11;d+=.75){
      const a=s.yaw+angle,x=s.x+Math.sin(a)*d,z=s.z+Math.cos(a)*d,y=g.world.heightAt(x,z);
      if(y<.25||y>2.8)continue;
      if(![[0,0],[-r,0],[r,0],[0,-r],[0,r]].every(([dx,dz])=>{const h=g.world.heightAt(x+dx,z+dz);return h>.15&&Math.abs(h-y)<1.05;}))continue;
      if(g.units?.some(u=>u.alive&&!u.hidden&&(u.kind==='player'||u.kind==='remote')&&!s.seats.some(id=>id&&this.unit(id)===u)&&Math.hypot(u.pos.x-x,u.pos.z-z)<r+u.radius+.2))continue;
      g.world.resolveCollision(x,z,r,out);if(Math.hypot(out.x-x,out.y-z)>.4)continue;
      return {x,z};
    }return null;
  }
  label(){
    if(this.canSummon())return t('빈 배를 부두로 부르기','Call the empty skiff to the dock');
    const count=this.state.seats.filter(Boolean).length;
    if(this.seated){const land=this.landing(),pilot=this.state.seats[0]===this.id;return land?t(pilot?'가까운 해안에 내리기 · W/S 이동 · A/D 조종':'동승 중 · 가까운 해안에 내리기',pilot?'Land on shore · W/S move · A/D steer':'Passenger · Land on shore'):t(pilot?'부두로 귀환 · W/S 이동 · A/D 조종':'동승 중 · 부두로 귀환',pilot?'Return to dock · W/S move · A/D steer':'Passenger · Return to dock');}
    return count===2?t('배 정원 2/2명 · 친구가 내리면 탈 수 있어요','Skiff full · 2/2 riders'):t(`배 타기 · ${count}/2명`,`Board skiff · ${count}/2 seats`);
  }
  interact(){const b=this.g.multiplayer?.battle;const command:BoatCommand={action:this.seated?'leave':this.canSummon()?'call':'board',throttle:0,steer:0};if(this.observed){this.g.server?.command({kind:'boat',command});return;}if(b)b.boat(command);else this.request('solo',command);}
  private unit(id:string){if(this.observed)return this.g.units.find(u=>u.ref&&JSON.stringify([u.ref.area,u.ref.id,u.ref.life])===id);return id==='solo'?this.g.player.unit:this.g.multiplayer?.battle.boatUnit(id);}
  request(id:string,c:BoatCommand){
    if(this.observed)throw new Error('Server owns boat rules');
    const g=this.g,u=this.unit(id);if(g.villageGames?.playing)return;if(!u?.alive||g.world2.chapter!==1)return;
    if(c.action==='call'){if(!this.state.seats.some(Boolean)&&Math.hypot(u.pos.x-144,u.pos.z-19)<4.5)this.resetHome();return;}
    const seat=this.state.seats.indexOf(id);
    if(c.action==='leave'){if(seat>=0){
      const land=this.landing(u.radius??1.2),exit=land??{x:143,z:23};this.state.exits={...(this.state.exits??{}),[id]:{...exit,shore:!!land}};
      const entries=Object.entries(this.state.exits);this.state.exits=Object.fromEntries(entries.slice(-8));
      this.state.seats[seat]=null;u.teleport(g.world,exit.x,exit.z);this.compact();if((!land||this.nearBerth())&&!this.state.seats.some(Boolean))this.resetHome();
    }return;}
    if(c.action==='board'){
      if(seat>=0||g.encounter.engaged||!this.canBoard(u.pos.x,u.pos.y,u.pos.z))return;
      const free=this.state.seats.indexOf(null);if(free<0){if(id===this.id)g.hud.messages.info(t('배가 꽉 찼어요! 최대 2명이에요.','The skiff is full! Two riders maximum.'));return;}
      this.state.seats[free]=id;if(this.state.exits)delete this.state.exits[id];return;
    }
    if(seat===0){this.throttle=c.throttle;this.steer=c.steer;this.inputAt=g.time;}
  }
  private compact(){this.state.seats=this.state.seats.filter(Boolean).concat([null,null]).slice(0,2) as BoatState['seats'];this.throttle=this.steer=0;this.state.speed=0;}
  /** Left empty within reach of its berth, the skiff goes back to it; left at a farther shore, it waits there. */
  private nearBerth(){return Math.hypot(this.state.x-151,this.state.z-18.5)<=12;}
  private resetHome(){this.state={...home(),exits:this.state.exits};}
  networkState():BoatState{return {...this.state,seats:[...this.state.seats],exits:this.state.exits?structuredClone(this.state.exits):undefined};}
  applyNetwork(s:BoatState|undefined){if(this.observed)throw new Error('Observed boat rejects legacy state');if(s)this.state={...s,seats:[...s.seats]};}
  disconnect(){if(this.observed){this.root.visible=false;return;}if(this.seated&&this.g.world2.chapter===1)this.dock();this.wasSeated=false;this.state=home();this.throttle=this.steer=0;}
  private dock(){const p=this.g.player;p.unit.teleport(this.g.world,143,23,-Math.PI/2);p.unit.motion.stop(undefined,0);}
  private clearPose(){const p=this.g.player;p.setTarget(null);p.interruptCast('');p.cancelChannel();p.unit.cancelPendingHit();p.unit.pushTime=0;p.unit.motion.stop(undefined,0);}
  observe(state:{x:number;z:number;yaw:number;speed:number;seats:readonly (EntityRef|null)[]}|null,self:EntityRef):void {if(!this.observed)throw new Error('Not an observed boat');this.observedSelf=JSON.stringify([self.area,self.id,self.life]);if(!state){this.root.visible=false;return;}this.state={x:state.x,z:state.z,yaw:state.yaw,speed:state.speed,seats:state.seats.map(ref=>ref?JSON.stringify([ref.area,ref.id,ref.life]):null) as [string|null,string|null]};}
  renderObserved(time:number,chapter:number):void {if(!this.observed)throw new Error('Not an observed boat');this.root.visible=chapter===1;const s=this.state;this.root.position.set(s.x,.2+Math.sin(time*1.8)*.055,s.z);this.root.rotation.set(0,s.yaw,Math.sin(time*1.2)*.012);}
  update(dt:number){
    if(this.observed)throw new Error('Server owns boat progression');
    const g=this.g,b=g.multiplayer?.battle,authority=b?.authority!==false;
    this.root.visible=g.world2.chapter===1;
    if(!this.root.visible){this.state=home();this.wasSeated=false;return;}
    if(authority){let removed=false;for(let i=0;i<2;i++){const id=this.state.seats[i];if(id&&((id!=='solo'&&!b?.hasBoatMember(id))||this.unit(id)?.alive===false)){this.state.seats[i]=null;removed=true;}}if(removed){this.compact();if(!this.state.seats.some(Boolean)&&(!this.landing()||this.nearBerth()))this.resetHome();}if(!this.state.seats[0]&&this.state.seats[1])this.compact();if(!this.state.seats.some(Boolean)&&this.state.speed!==0)this.compact();}
    if(this.seated&&!this.wasSeated){this.clearPose();g.hud.messages.info(t('바다에 섬 3개가 있어요! G 지도에서 섬과 배를 찾아보세요.','Three islands await! Press G to locate the islands and your skiff.'));}
    if(!this.seated&&this.wasSeated&&g.player.unit.alive){const exit=this.state.exits?.[this.id];if(exit){g.player.unit.teleport(g.world,exit.x,exit.z);if(exit.shore)g.achievements?.unlock('landfall');}else this.dock();}
    this.wasSeated=this.seated;
    if(this.state.seats[0]===this.id&&g.time-this.sentAt>.09){this.sentAt=g.time;const allowed=!g.app.account.open&&!g.hud.menu.open&&!g.hud.minimap.expanded&&!g.cinematic&&!g.ending.active;const inp=g.input,c:BoatCommand={action:'drive',throttle:allowed?Number(inp.isDown('KeyW'))-Number(inp.isDown('KeyS')):0,steer:allowed?Number(inp.isDown('KeyA'))-Number(inp.isDown('KeyD')):0};if(b)b.boat(c);else this.request('solo',c);}
    if(authority){
      const active=g.time-this.inputAt<.4&&!!this.state.seats[0];const target=active?this.throttle*6:0;
      this.state.speed+=(target-this.state.speed)*Math.min(1,dt*2.5);
      this.state.yaw+= (active?this.steer:0)*dt*.9*Math.min(1,Math.abs(this.state.speed)+.2);
      const x=this.state.x+Math.sin(this.state.yaw)*this.state.speed*dt,z=this.state.z+Math.cos(this.state.yaw)*this.state.speed*dt;
      const clear=x>105&&x<265&&z>-78&&z<96&&[-3.8,0,3.8].every(d=>[-1.6,0,1.6].every(w=>g.world.heightAt(x+Math.sin(this.state.yaw)*d+Math.cos(this.state.yaw)*w,z+Math.cos(this.state.yaw)*d-Math.sin(this.state.yaw)*w)<.2));
      if(clear){this.state.x=x;this.state.z=z;}else this.state.speed=0;
      this.state.yaw=Math.atan2(Math.sin(this.state.yaw),Math.cos(this.state.yaw));
    }
    const s=this.state,y=.2+Math.sin(g.time*1.8)*.055;
    this.root.position.set(s.x,y,s.z);this.root.rotation.set(0,s.yaw,Math.sin(g.time*1.2)*.012);
    s.seats.forEach((id,i)=>{if(!id)return;const u=this.unit(id);if(!u?.alive)return;const offset=i===0?1.65:-1.65;u.pos.set(s.x+Math.sin(s.yaw)*offset,y+.68,s.z+Math.cos(s.yaw)*offset);u.setYaw(s.yaw);u.pushTime=0;u.motion.stop(undefined,0);u.motion.setLocomotion(0,0,0);});
  }
  dispose(){this.root.removeFromParent();for(const r of this.resources)r.dispose();}
}
