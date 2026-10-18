import './dungeons.css';
import {renderDungeonMenu} from './dungeonMenu';
import * as THREE from 'three';
import type {Game} from './game';
import type {Enemy} from './enemies';
import type {Unit} from './unit';
import {DUNGEONS,dungeonFor,dungeonDanger,dungeonHazards,type DungeonState,type DungeonConfig} from './dungeonData';
import {t} from '../i18n';
import {localStorageGet,localStorageSet} from '../app';

const X=0,Z=125,Y=80,R=18;
const label=(d:DungeonConfig)=>t(d.name[0],d.name[1]);
const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;};

/** A bounded private expedition, with one authoritative wave and hazard clock. */
export class DungeonExpeditions {
  state:DungeonState|null=null;
  panelOpen=false;
  private pending:number|null=null;
  private offlineHeld=false;
  private readonly root=new THREE.Group();
  private readonly warning=new THREE.Group();
  private readonly ui=document.createElement('div');
  private readonly panel=document.createElement('div');
  private readonly status=document.createElement('div');
  private readonly backdrop=document.createElement('div');
  private readonly menu:HTMLButtonElement;
  private readonly pool:Enemy[];
  private saved:{height:Game['world']['heightAt'];collision:Game['world']['resolveCollision'];ray:Game['world']['raycastSolid'];spawn:THREE.Vector3;back:THREE.Vector3;yaw:number}|null=null;
  private hit=-1;
  private warningKey='';
  private uiKey='';
  private eligible=false;
  private runs:string[]=[];
  private cleared:number[]=[];
  private readonly key:string;
  private readonly scales:THREE.Vector3[];
  constructor(private readonly g:Game){
    this.pool=g.enemies.filter(e=>e.isDungeonOnly);this.scales=this.pool.map(e=>e.unit.rig.root.scale.clone());
    const s=g.player.unit.rig.spec;this.key=`cc.dungeons.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`;
    try{const saved=JSON.parse(localStorageGet(this.key)??'{}');this.runs=Array.isArray(saved.runs)?saved.runs.filter((r:unknown)=>typeof r==='string').slice(-64):[];this.cleared=Array.isArray(saved.cleared)?saved.cleared.filter((l:number)=>!!dungeonFor(l)):[];}catch{/* An invalid optional ledger starts empty. */}
    this.root.name='dungeon-chamber';this.root.visible=false;g.scene.add(this.root);this.root.add(this.warning);
    this.ui.className='dungeon-ui';this.panel.className='dungeon-panel';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.hidden=true;
    this.status.className='dungeon-status';this.status.hidden=true;
    this.menu=button(t('⚔ 던전','⚔ Dungeons'),()=>this.open());this.menu.className='dungeon-menu';
    this.backdrop.className='dg-backdrop';this.backdrop.hidden=true;this.backdrop.onclick=()=>this.close();
    this.panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();this.close();}if(e.key==='Tab'){const buttons=[...this.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(b=>b.getClientRects().length>0),first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
    this.ui.append(this.menu,this.status,this.backdrop,this.panel);g.app.ui.append(this.ui);
  }
  get active(){return this.state!==null;}
  contains(u:Unit){return !this.state||(u.level>=this.state.level&&Math.abs(u.pos.y-Y)<4&&Math.hypot(u.pos.x-X,u.pos.z-Z)<R+6);}
  networkState():DungeonState|null{return this.state?{...this.state,members:[...this.state.members]}:null;}
  private info(ko:string,en:string){this.g.hud.messages.info(t(ko,en));}
  open(){
    if(this.active)return;
    this.panelOpen=true;this.panel.hidden=false;this.panel.replaceChildren();
    this.backdrop.hidden=false;
    renderDungeonMenu(this.panel,{chapter:this.g.world2.chapter,level:this.g.player.level,cleared:this.cleared,start:level=>this.start(level),close:()=>this.close()});
  }
  close(){this.panelOpen=false;this.panel.hidden=true;this.backdrop.hidden=true;this.menu.focus({preventScroll:true});}
  start(level:number){
    const g=this.g,d=dungeonFor(level),b=g.multiplayer?.battle;
    if(!d||this.active)return false;
    if(g.player.level<level){this.info(`${level}레벨부터 들어갈 수 있어요.`,`Reach level ${level} to enter.`);return false;}
    if(g.world2.chapter!==d.chapter){this.info(`${d.chapter===3?'3월드':d.chapter===4?'눈 월드':d.chapter===5?'잿불 군도':'하늘숲'}에서 던전 메뉴를 열어 주세요.`,`Open the dungeon menu in ${d.chapter===3?'World III':d.chapter===4?'Frostlight':d.chapter===5?'Emberreach':'Skybloom'}.`);return false;}
    if(g.player.inCombat||g.encounter.engaged||g.ending.active||g.boats?.seated||g.villageGames?.playing){this.info('전투와 다른 활동을 마친 뒤 입장해 주세요.','Finish combat and other activities before entering.');return false;}
    if(b?.active&&!b.sharedArea&&!b.authority){this.info('방장이 던전을 골라요.','The host chooses the dungeon.');return false;}
    if(!b?.sharedArea&&g.combatPlayers().some(p=>p.level<level)){this.info(`친구들도 ${level}레벨 이상이어야 해요.`,`All friends must be level ${level} or higher.`);return false;}
    this.close();
    if(b?.active&&b.sharedArea){this.pending=level;g.multiplayer!.createDungeonRoom();this.info('던전 전용 방을 만드는 중이에요. 방 코드로 친구를 초대할 수 있어요.','Creating a private expedition room. Invite friends with its room code.');return true;}
    if(b?.active)b.setMode('coop');
    else if(g.multiplayer){this.offlineHeld=true;g.multiplayer.pauseDungeonConnection();}
    const state:DungeonState={level,run:crypto.randomUUID(),stage:1,phase:'rest',left:2,clock:0,hazard:0,members:g.combatPlayers().map(p=>p.name)};
    this.enter(state);return true;
  }
  private enter(state:DungeonState){
    const g=this.g,w=g.world;
    this.state=structuredClone(state);this.eligible=state.members.includes(g.player.unit.name)&&g.player.level>=state.level;
    this.saved={height:w.heightAt,collision:w.resolveCollision,ray:w.raycastSolid,spawn:w.pois.spawn.position.clone(),back:g.player.unit.pos.clone(),yaw:g.player.unit.yaw};
    const saved=this.saved;
    // Restrict overrides to the chamber footprint; the outside world keeps its own terrain.
    w.heightAt=(x,z)=>Math.hypot(x-X,z-Z)<R+8?Y:saved.height(x,z);
    w.resolveCollision=(x,z,r,out)=>{const dx=x-X,dz=z-Z,d=Math.hypot(dx,dz);if(d<R+8){const k=Math.min(1,(R-r-.25)/Math.max(.001,d));return out.set(X+dx*k,Z+dz*k);}return saved.collision(x,z,r,out);};
    w.raycastSolid=(a,b)=>a.y>Y-2&&Math.hypot(a.x-X,a.z-Z)<R+8?null:saved.ray(a,b);
    w.pois.spawn.position.set(X,Y,Z+11);this.hit=-1;this.warningKey='';this.build(dungeonFor(state.level)!);
    for(const u of g.units)u.cancelPendingHit();
    g.hud.dialogue.close();g.hud.minimap.toggle(false);
    g.player.setTarget(null);g.player.unit.teleport(w,X,Z+11,Math.PI);g.follow.cut();
    this.root.visible=true;this.configure();this.renderStatus();
    this.info(`${label(dungeonFor(state.level)!)} · 세 번의 전투를 이겨 내세요!`,`${label(dungeonFor(state.level)!)} · Survive three waves!`);
  }
  private configure(){
    const d=dungeonFor(this.state!.level)!;
    this.pool.forEach((e,i)=>{e.dungeonLevel=d.level;e.dungeonCaptain=this.state!.stage===3&&i===0;e.home.set(X,Y,Z);e.unit.rig.root.scale.copy(this.scales[i]).multiplyScalar(e.dungeonCaptain?1.65:1);e.resumeAuthority();e.unit.name=e.dungeonCaptain?t('심연의 수문장','Depth Warden'):t('원정 파수병','Expedition Sentinel');});
  }
  apply(state:DungeonState|null){
    if(!state){if(this.active)this.leave(false);return;}
    const d=dungeonFor(state.level);if(!d||d.chapter!==this.g.world2.chapter)return;
    if(this.g.player.level<state.level){this.info(`${state.level}레벨 던전이 진행 중이에요. 레벨을 올린 뒤 다시 참가해 주세요.`,`A level ${state.level} expedition is running. Level up before rejoining.`);queueMicrotask(()=>this.g.multiplayer?.leaveDungeonRoom());return;}
    if(!this.state||this.state.run!==state.run){if(this.active)this.leave(false);this.enter(state);}
    const stage=this.state!.stage;this.state=structuredClone(state);
    if(stage!==state.stage)this.configure();
    if(state.phase==='clear')this.reward();
  }
  private wave(){
    const s=this.state!;s.phase='wave';s.clock=0;s.hazard=0;this.hit=-1;this.configure();
    const count=s.stage===1?3:s.stage===2?5:3;
    for(const e of this.pool)e.despawn();
    this.pool.forEach((e,i)=>{if(i>=count)return;const a=(i/count)*Math.PI*2;e.respawnAt(X+Math.cos(a)*11,Z+Math.sin(a)*11);e.pack=this.pool.slice(0,count);e.aggro(false);});
    this.g.hud.messages.info(t(`${s.stage}/3 전투 시작!`, `Wave ${s.stage}/3 begins!`));
  }
  update(dt:number){
    const g=this.g,b=g.multiplayer?.battle;
    if(this.pending!==null&&b?.active&&!b.sharedArea&&b.authority){const level=this.pending;this.pending=null;this.start(level);}
    const title=t('⚔ 던전','⚔ Dungeons');if(this.menu.textContent!==title)this.menu.textContent=title;
    const s=this.state;this.menu.hidden=!!s;if(!s)return;
    if(s.phase==='wave'&&g.player.level>=s.level)this.eligible=true;
    if(b?.authority!==false&&dt>0){
      for(const p of g.combatPlayers())if(p.level>=s.level&&Math.abs(p.pos.y-Y)<3&&!s.members.includes(p.name)&&s.members.length<8)s.members.push(p.name);
      if(s.phase==='rest'){s.left=Math.max(0,s.left-dt);if(s.left===0)this.wave();}
      else if(s.phase==='wave'){
        const before=s.clock;s.clock=Math.min(9999999,s.clock+dt);s.hazard=Math.floor(s.clock/7);
        if(Math.floor(before/7)===s.hazard&&before%7<2.5&&s.clock%7>=2.5&&this.hit!==s.hazard){this.hit=s.hazard;this.strike();}
        if(this.pool.every(e=>!e.unit.alive)){if(s.stage===3){s.phase='clear';this.reward();}else{s.stage++;s.phase='rest';s.left=3;}}
        else if(!g.combatPlayers().some(p=>p.alive)){s.phase='failed';for(const e of this.pool)e.despawn();}
      }
    }
    this.drawWarning();this.renderStatus();
  }
  private strike(){
    const s=this.state!,index=DUNGEONS.findIndex(d=>d.level===s.level),src=this.pool.find(e=>e.unit.alive)?.unit;
    if(!src)return;
    for(const p of this.g.combatPlayers())if(p.alive&&dungeonDanger(index,s.hazard,p.pos.x-X,p.pos.z-Z))this.g.combat.damage(src,p,Math.round((18+s.level*.42)*1.25));
    this.g.vfx.ring(new THREE.Vector3(X,Y+.18,Z),new THREE.Color(0xffb978),1,17,.5,.8,0);
  }
  private reward(){
    const s=this.state!,d=dungeonFor(s.level)!;if(!this.eligible||this.runs.includes(s.run))return;
    // Persist the receipt before granting; snapshots and reconnects cannot repeat this reward.
    this.runs.push(s.run);this.runs=this.runs.slice(-64);if(!this.cleared.includes(d.level))this.cleared.push(d.level);
    localStorageSet(this.key,JSON.stringify({runs:this.runs,cleared:this.cleared}));
    this.g.player.coins=Math.min(Number.MAX_SAFE_INTEGER,this.g.player.coins+d.coins);this.g.player.gainXp(d.xp);this.g.journey?.save();
    this.info(`원정 성공! +${d.coins.toLocaleString()} 코인 · +${d.xp.toLocaleString()} XP`,`Expedition complete! +${d.coins.toLocaleString()} coins · +${d.xp.toLocaleString()} XP`);
  }
  leave(disconnect=true){
    // Returning from an expedition keeps the private room and its party intact.
    if(disconnect&&this.state&&this.g.multiplayer?.battle.requestDungeonReturn())return;
    this.close();this.pending=null;if(!this.state)return;
    const held=this.offlineHeld;this.offlineHeld=false;
    const g=this.g,saved=this.saved;this.state=null;this.saved=null;this.eligible=false;this.root.visible=false;this.menu.hidden=false;this.status.hidden=true;this.uiKey='';this.warningKey='';
    for(const e of this.pool)e.despawn();
    if(saved){g.world.heightAt=saved.height;g.world.resolveCollision=saved.collision;g.world.raycastSolid=saved.ray;g.world.pois.spawn.position.copy(saved.spawn);g.player.setTarget(null);g.player.unit.teleport(g.world,saved.back.x,saved.back.z,saved.yaw);g.follow?.cut();}
    if(disconnect&&held)g.multiplayer?.leaveDungeonRoom();
  }
  private renderStatus(){
    const s=this.state!,d=dungeonFor(s.level)!,alive=this.pool.filter(e=>e.unit.alive).length;
    const key=JSON.stringify([s.level,s.stage,s.phase,Math.ceil(s.left),alive,t('ko','en')]);if(key===this.uiKey)return;this.uiKey=key;
    this.status.hidden=false;const title=document.createElement('strong');title.textContent=`Lv.${s.level} ${label(d)}`;
    const text=document.createElement('span');text.textContent=s.phase==='clear'?t('원정 성공 · 보상 획득','Expedition complete · Rewards earned'):s.phase==='failed'?t('원정 실패 · 다시 도전해 보세요','Expedition failed · Try again'):s.phase==='rest'?t(`${s.stage}/3 전투 · ${Math.ceil(s.left)}초 뒤 시작`,`Wave ${s.stage}/3 · Starts in ${Math.ceil(s.left)}s`):t(`${s.stage}/3 전투 · 적 ${alive}마리 · 붉은 바닥을 피하세요`, `Wave ${s.stage}/3 · ${alive} enemies · Avoid the red floor`);
    const exit=button(t('밖으로 나가기','Leave'),()=>this.leave());const stages=document.createElement('div');stages.className='dg-stages';stages.setAttribute('aria-label',t(`${s.stage}/3 전투 진행`,`Wave ${s.stage} of 3`));for(let i=1;i<=3;i++){const step=document.createElement('i');step.className=s.phase==='clear'||i<s.stage?'done':i===s.stage?'current':'';step.textContent=s.phase==='clear'||i<s.stage?'✓':String(i);stages.append(step);}this.status.dataset.phase=s.phase;this.status.replaceChildren(stages,title,text,exit);
  }
  private disposeTree(group:THREE.Group){group.traverse(o=>{if(o instanceof THREE.Mesh){if(o instanceof THREE.InstancedMesh)o.dispose();o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});group.clear();}
  private build(d:DungeonConfig){
    this.root.remove(this.warning);this.disposeTree(this.root);this.root.add(this.warning);
    const stone=new THREE.MeshStandardMaterial({color:d.chapter===6?0x234b42:d.chapter===5?0x49312c:d.chapter===4?0x253f56:0x343044,roughness:.82,metalness:.25});
    const trim=new THREE.MeshStandardMaterial({color:d.color,emissive:d.color,emissiveIntensity:.5,metalness:.65,roughness:.3});
    const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat.clone());m.position.set(X+x,Y+y,Z+z);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;};
    const shellMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(d.color).multiplyScalar(.075),side:THREE.BackSide});
    const shell=add(new THREE.SphereGeometry(55,32,16),shellMaterial,0,4,0);shellMaterial.dispose();shell.castShadow=false;shell.receiveShadow=false;
    const floor=add(new THREE.CylinderGeometry(R+1,R+1,1,64),stone,0,-.52,0);floor.name='dungeon-floor';
    for(let i=0;i<4;i++){const r=4+i*4;const m=add(new THREE.TorusGeometry(r,.035,4,80),trim,0,.06,0);m.rotation.x=Math.PI/2;}
    const cells:[number,number][]=[];
    for(let x=-7;x<=7;x++)for(let z=-7;z<=7;z++)if(Math.hypot(x*2.35,z*2.35)<R-1.7)cells.push([x,z]);
    const paving=new THREE.InstancedMesh(new THREE.BoxGeometry(2.28,.05,2.28),stone.clone(),cells.length),matrix=new THREE.Matrix4();
    for(const [i,[x,z]]of cells.entries()){matrix.makeTranslation(X+x*2.35,Y,Z+z*2.35);paving.setMatrixAt(i,matrix);paving.setColorAt(i,new THREE.Color().setHSL(d.chapter===6?.42:d.chapter===5?.06:d.chapter===4?.57:.7,.12,.65+((x*17+z*13+1234)%7)*.025));}
    paving.receiveShadow=true;this.root.add(paving);
    // Luminous radial inlays stay above the paving, with intentional grout between slabs.
    for(let i=0;i<12;i++){const a=i*Math.PI/6;const m=add(new THREE.BoxGeometry(.08,.035,R-1),trim,Math.sin(a)*(R-1)/2,.04,Math.cos(a)*(R-1)/2);m.rotation.y=a;}
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,x=Math.sin(a)*(R+1),z=Math.cos(a)*(R+1);
      add(new THREE.CylinderGeometry(.65,.9,.7,6),stone,x,.35,z);
      add(new THREE.CylinderGeometry(.38,.5,5.5,6),stone,x,3.3,z);
      const crystal=add(new THREE.OctahedronGeometry(.65),trim,x,6.5,z);crystal.rotation.y=a;
      const wall=add(new THREE.BoxGeometry(9.6,2.5,.6),stone,Math.sin(a+Math.PI/12)*(R+.7),1.25,Math.cos(a+Math.PI/12)*(R+.7));wall.rotation.y=a+Math.PI/12;
      const rail=add(new THREE.BoxGeometry(9.6,.1,.7),trim,wall.position.x-X,2.55,wall.position.z-Z);rail.rotation.y=wall.rotation.y;
    }
    for(const x of [-10,10]){const light=new THREE.PointLight(d.color,50,30,2);light.position.set(X+x,Y+6,Z);this.root.add(light);}
    const center=add(new THREE.TorusGeometry(2.3,.12,5,32),trim,0,.08,0);center.rotation.x=Math.PI/2;
    stone.dispose();trim.dispose();
  }
  private drawWarning(){
    const s=this.state!,visible=s.phase==='wave'&&s.clock%7<2.5,index=DUNGEONS.findIndex(d=>d.level===s.level);
    this.warning.visible=visible;if(!visible)return;
    const key=`${s.run}:${s.hazard}`;
    if(key!==this.warningKey){
      this.warningKey=key;this.disposeTree(this.warning);
      const material=new THREE.MeshBasicMaterial({color:0xff4d59,transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide});
      const add=(geo:THREE.BufferGeometry,x=0,z=0,yaw=0)=>{const m=new THREE.Mesh(geo,material.clone());m.rotation.set(-Math.PI/2,0,-yaw);m.position.set(X+x,Y+.16,Z+z);m.renderOrder=8;this.warning.add(m);};
      for(const h of dungeonHazards(index,s.hazard))add(h.shape==='rect'?new THREE.PlaneGeometry(h.width,h.depth):h.shape==='ring'?new THREE.RingGeometry(h.inner??0,h.radius,80):new THREE.CircleGeometry(h.radius,64),h.x,h.z,h.shape==='rect'?h.yaw:0);
      material.dispose();
    }
    for(const o of this.warning.children)if(o instanceof THREE.Mesh)(o.material as THREE.MeshBasicMaterial).opacity=.32+.16*Math.sin(s.clock*9)**2;
  }
  dispose(){this.leave(false);this.disposeTree(this.warning);this.disposeTree(this.root);this.g.scene.remove(this.root);this.ui.remove();}
}
