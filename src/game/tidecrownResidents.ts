import * as THREE from 'three';
import {createCrab} from '../crab/provider';
import type {CrabSpec} from '../crab/types';
import {RACE_ORDER} from '../data/races';
import {createMotionController} from '../motion/provider';
import {t} from '../i18n';
import type {Game} from './game';
import {Unit} from './unit';
import {turnToward,yawTo} from './util';
import {TC_CITY_STREETS,TC_DISTRICTS,type DistrictId} from './tidecrown/cityPlan';
import type {TidecrownIsland} from './tidecrown/island';
import {CAPITAL_RESIDENTS,type CapitalResident,type ResidentText} from './tidecrownResidentsData';

const DISTRICT_STORIES:Record<DistrictId,ResidentText>={
 market:['여기는 탈피 시장이에요. 상인들이 모이는 광장에서 서쪽은 공방, 동쪽은 항구로 이어져요.','This is Moult Market. From the square, the western road leads to the workshops and the eastern road to the harbour.'],
 works:['따개비 공방에서는 배와 도구를 손질해요. 망치 소리와 물레방아 소리가 함께 들리는 곳이죠.','Barnacle Works repairs ships and tools. Hammers and the waterwheel keep time together.'],
 harbour:['왕관 항구는 수도의 바닷길이에요. 배가 돌아올 때마다 시장도 새로운 물건으로 가득해져요.','Crown Harbour connects the capital to the sea. Every returning ship brings new goods to the market.'],
 canal:['운하 구역의 다리들은 시장과 항구를 이어 줘요. 다리 위에서 바라보는 물빛이 참 예뻐요.','The Canal Quarter bridges link the market and harbour. Stop on a bridge to enjoy the reflections.'],
 cathedral:['조수 대성당은 여행자와 주민들이 쉬어 가는 곳이에요. 종소리는 바다까지 닿는답니다.','The Cathedral of the Tide welcomes residents and travellers. Its bells can be heard out at sea.'],
 seaglass:['바다유리 구역에는 유리를 다듬는 장인과 빛을 연구하는 사람들이 살아요. 높은 탑들이 이 구역의 길잡이예요.','Seaglass Quarter is home to glass artisans and scholars of light. The tall towers help you find your way.'],
 upper:['윗마을의 큰 계단을 오르면 크라운셸 성으로 이어져요. 잠깐 멈춰 수도의 지붕과 바다를 돌아보세요.','The grand stair from Upper Town leads to Crownshell Keep. Pause and look back over the rooftops and sea.'],
};
interface Person {unit:Unit;def:CapitalResident;home:THREE.Vector3;end:THREE.Vector3;district:DistrictId;portrait:string;index:number;nextGesture:number;lastHello:number;seed:number;}
/** Independent, lazy population layer. Never edits the island, its geometry or its collision. */
export class TidecrownResidents {
 readonly people:Person[]=[];
 private disposed=false;
 private shown=false;
 private readonly out=new THREE.Vector2();
 constructor(private readonly g:Game,private readonly island:TidecrownIsland){}
 async load(){
  try{
   for(const [index,def]of CAPITAL_RESIDENTS.entries()){
    if(this.disposed)return;
    const race=RACE_ORDER[index%RACE_ORDER.length],sex=Math.floor(index/6)%2?'female':'male';
    const spec:CrabSpec={race,sex,classId:(['warrior','mage','priest'] as const)[index%3],shell:Math.floor(index/6)%3,crest:index%4,led:index%3,name:t(...def.name)};
    const rig=await createCrab(spec);
    if(this.disposed){rig.dispose();return;}
    (rig as typeof rig&{useShadowProxy?:(on:boolean)=>void}).useShadowProxy?.(true);
    const unit=new Unit(t(...def.name),'npc','friendly',rig,createMotionController(rig));
    unit.npcId=`tidecrown-resident-${index}`;unit.ctrl=this;unit.hidden=true;unit.title=t(...def.role);
    const street=TC_CITY_STREETS.find(s=>s.id===def.street)!;
    const lengths=street.points.slice(1).map((b,i)=>Math.hypot(b[0]-street.points[i][0],b[1]-street.points[i][1]));
    let along=lengths.reduce((a,b)=>a+b,0)*def.at,segment=0;
    while(segment<lengths.length-1&&along>lengths[segment])along-=lengths[segment++];
    const a=street.points[segment],b=street.points[segment+1],length=lengths[segment],dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
    const x=a[0]+dx*along-dz*def.side,z=a[1]+dz*along+dx*def.side;
    this.island.resolve(x,z,unit.radius+.2,this.out);
    const home=new THREE.Vector3(this.out.x,this.island.height(this.out.x,this.out.y),this.out.y);
    this.island.resolve(home.x+dx*2,home.z+dz*2,unit.radius+.2,this.out);
    const end=new THREE.Vector3(this.out.x,this.island.height(this.out.x,this.out.y),this.out.y);
    // Stay on this short street section, never across a terrace or through a wall.
    if(Math.abs(end.y-home.y)>.6||end.distanceTo(home)>3)end.copy(home);
    unit.pos.copy(home);unit.setYaw(Math.atan2(dx,dz));
    this.g.units.push(unit);this.g.scene.add(rig.root);
    this.people.push({unit,def,home,end,district:street.district,portrait:`art/portraits/${race}-${sex}.webp`,index:0,nextGesture:index*1.7,lastHello:-100,seed:index});
   }
  }catch(error){
   for(const p of this.people){this.g.scene.remove(p.unit.rig.root);p.unit.dispose();const at=this.g.units.indexOf(p.unit);if(at>=0)this.g.units.splice(at,1);}
   this.people.length=0;throw error;
  }
 }
 show(){this.shown=true;for(const p of this.people){p.unit.hidden=false;p.unit.teleport(this.g.world,p.home.x,p.home.z,p.unit.yaw);}}
 hide(){
  this.shown=false;
  if(this.people.some(p=>p.unit===this.g.hud.dialogue.unit))this.g.hud.dialogue.close();
  for(const p of this.people)p.unit.hidden=true;
 }
 update(dt:number){
  if(!this.shown)return;
  const g=this.g,player=g.player.unit,now=g.time;
  for(const p of this.people){
   const u=p.unit;u.name=t(...p.def.name);u.title=t(...p.def.role);
   const d=u.distTo(player);if(d>75)continue;
   const talking=g.hud.dialogue.unit===u;
   if(talking||d<6){
    u.setYaw(turnToward(u.yaw,yawTo(u.pos.x,u.pos.z,player.pos.x,player.pos.z),2.4,dt));
    if(!talking&&d<5&&now-p.lastHello>35&&!u.motion.action){u.act('gesture_hello');u.express('happy',1.2);p.lastHello=now;}
   }else{
    const phase=(now*.18+p.seed*.23)%2;
    const target=phase<1?p.end:p.home,dist=Math.hypot(target.x-u.pos.x,target.z-u.pos.z);
    if(dist>.2){const step=Math.min(dist,dt*1.05);u.setYaw(turnToward(u.yaw,yawTo(u.pos.x,u.pos.z,target.x,target.z),2.2,dt));u.moveTo(g.world,u.pos.x+(target.x-u.pos.x)/dist*step,u.pos.z+(target.z-u.pos.z)/dist*step,dt);}
    else if(now>p.nextGesture&&!u.motion.action&&!u.culled){u.act(p.district==='harbour'?'gesture_salute':'gesture_paw');p.nextGesture=now+16+p.seed%11;}
   }
   u.feedLocomotion(dt);
  }
 }
 talkTo(unit:Unit):boolean{
  const p=this.people.find(p=>p.unit===unit);
  if(!p||!this.shown||unit.hidden||!this.g.player.unit.alive||this.g.player.unit.distTo(unit)>8)return false;
  unit.setYaw(yawTo(unit.pos.x,unit.pos.z,this.g.player.unit.pos.x,this.g.player.unit.pos.z));unit.express('happy',1.2);unit.act('gesture_hello');
  const show=(district=false):void=>this.g.hud.dialogue.open({unit,portraitArt:p.portrait,questTitle:t(...p.def.role),paragraphs:[district?t(...DISTRICT_STORIES[p.district]):p.index++%2===0?t(...p.def.line):t(`저는 ${p.def.name[0]}예요. ${TC_DISTRICTS[p.district].ko}에서 하루를 보내고 있죠. 오늘 수도에서 좋은 추억을 만드세요!`,`I am ${p.def.name[1]}. I spend my days in ${TC_DISTRICTS[p.district].en}. I hope you make happy memories in the capital!`)],buttons:[{label:t('다른 이야기 듣기','Another story'),primary:true,onClick:()=>show()},{label:t('이곳에 대해 알려 주세요','Tell me about this district'),onClick:()=>show(true)},{label:t('다음에 만나요','Goodbye'),onClick:()=>this.g.hud.dialogue.close()}]});
  show();return true;
 }
 dispose(){this.disposed=true;this.shown=false;for(const p of this.people)p.unit.hidden=true;}
}
