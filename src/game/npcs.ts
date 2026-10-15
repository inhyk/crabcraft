// Named NPCs (stand at their POI, greet the player, gesture now and then, talk) and ambient
// townsfolk (stroll between the town's spawn points with real locomotion).
import * as THREE from 'three';
import {t} from '../i18n';
import type { Poi } from '../world/types';
import type { Game } from './game';
import type { Unit } from './unit';
import type { NavHints } from './nav';
import type { NpcDef } from './quests';
import { TOWNSFOLK_BARKS } from './quests';
import {starNpcProgressLine,STAR_VICTORY_BARKS} from './starDialogue';
import { damp, pick, rand, TAU, turnToward, yawTo } from './util';

export class Npc {
  private helloCd = 0;
  private gestureAt: number;
  talking = false;
  /** While talking: a point to face instead of the player (the dialogue camera cheats the look). */
  lookAt: THREE.Vector3 | null = null;
  private lineIndex = 0;

  constructor(private readonly game: Game, readonly unit: Unit, readonly def: NpcDef, readonly poi: Poi) {
    unit.ctrl = this;
    unit.npcId = def.id;
    unit.title = def.title;
    this.gestureAt = game.time + rand(6, 16);
  }

  nextLine(): string {
    if(this.game.world2.chapter===2){
      const progress=starNpcProgressLine(this.def.id,this.game.quests.status,!!this.game.journey?.trueCleared);
      if(progress)return progress;
      const lines:Record<NpcDef['id'],[string,string][]>= {
        brinebeard:[['별빛 항구가 제법 마을다워졌군! 저 바다를 건너서도 우린 한 마을이지.','Starhaven is starting to feel like home! Across the sea, we are still one village.'],['서쪽 수정 숲을 순찰해 주게. 이삿짐을 나르는 주민들이 안심할 거야.','Keep an eye on the western crystal wood. The settlers will feel safer.']],
        silvermoon:[['북쪽의 기억의 성소에서 별들의 노래를 들어 보세요.','Listen for the stars at the sanctuary of memory in the north.'],['달빛 연못은 멀리 있지만, 이 섬의 별들도 우리를 지켜봐요.','The Moonpool is far away, but these stars watch over us too.']],
        coralline:[['바다를 건너온 모두에게 성소의 문은 열려 있어요.','The sanctuary is open to everyone who crossed the sea.'],['지쳤다면 여기서 쉬어요. 새 집을 만드는 일에도 휴식은 필요하죠.','Rest here if you are tired. Building a new home takes time.']],
        grukk:[['그룩 새 문 지킨다. 저 동쪽 폐허, 이상한 소리 난다.','Grukk guards new gate. Strange noises in eastern ruins.'],['그룩 짐 열 상자 옮겼다. 간식 상자만 열한 개였다.','Grukk moved ten boxes. Eleven were snacks.']],
        hoofclaw:[['별빛 항구에서도 수프는 따뜻하단다. 친구 몫도 가져가렴!','The soup is warm in Starhaven too. Take some for your friends!'],['이삿짐에서 주전자를 제일 먼저 꺼냈지. 집이란 맛있는 냄새가 나는 곳이란다.','The kettle was the first thing I unpacked. Home begins with a good smell.']],
        rattlebolt:[['유적길 등불 세 개를 밝히면 밤길이 한결 든든할 게야.','Three waystones will make the road through the ruins much safer.'],['옛 등대는 포탈 건너 그대로 있지. 불을 끄면 해안에 아침이 온다네.','The old lighthouse is still across the portal. Turn it off to bring morning to the shore.']],
        pip:[['수정은 서쪽 숲과 동쪽 유적에 있어. 밝게 빛나는 작은 원석을 찾아봐!','Crystals grow in the western wood and eastern ruins. Look for the small bright gems!'],['모루도 여기까지 이사 왔어. 새 마을에 걸맞은 도구를 만들어야지!','Even my anvil made the move. This new village deserves good tools!']],
      };
      const options=lines[this.def.id],line=options[this.lineIndex++%options.length];return t(...line);
    }
    const l = this.def.lines[this.lineIndex % this.def.lines.length];
    this.lineIndex++;
    return l;
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const p = g.player.unit;
    const now = g.time;
    // Guests receive ambient poses/actions from the host. A personal conversation may
    // turn toward its speaker, but interpolation feeds locomotion exactly once below.
    if (g.multiplayer?.battle.authority === false) {
      if (this.talking && !g.ending.active) {
        const look = this.lookAt ?? p.pos;
        u.setYaw(turnToward(u.yaw, yawTo(u.pos.x, u.pos.z, look.x, look.z), 2.6, dt));
      }
      return;
    }
    if (g.ending.active) {
      u.feedLocomotion(dt);
      return;
    }
    const d = u.distTo(p);
    const near = p.alive && d < 9;
    const look = this.talking && this.lookAt ? this.lookAt : p.pos;
    const want = near || this.talking ? yawTo(u.pos.x, u.pos.z, look.x, look.z) : this.poi.yaw;
    u.setYaw(turnToward(u.yaw, want, 2.6, dt));
    if (p.alive && d < 7 && now > this.helloCd && !this.talking && !u.motion.action) {
      this.helloCd = now + 40;
      u.act('gesture_hello');
      u.express('happy', 1.5);
    } else if (now > this.gestureAt && !this.talking && !u.motion.action) {
      this.gestureAt = now + rand(14, 26);
      if (u.culled) return;
      u.act(pick(this.def.gestures));
    }
    if (d > 12) this.helloCd = Math.min(this.helloCd, now + 3);
    u.feedLocomotion(dt);
  }
}

export class Townsfolk {
  private dest = new THREE.Vector3();
  private walking = false;
  private pauseUntil = 0;
  private speed = rand(1.3, 2.1);
  private sideways = false;
  private velX = 0;
  private velZ = 0;
  private barkCd = 0;
  private stuckFor = 0;
  private route: NavHints | null = null;
  private readonly clearDest = new THREE.Vector2();
  /** Set by the ending: stand still and dance. */
  frozen = false;

  constructor(
    private readonly game: Game,
    readonly unit: Unit,
    private points: THREE.Vector3[],
    private radius: number,
  ) {
    unit.ctrl = this;
    this.pauseUntil = game.time + rand(0, 4);
  }

  relocate(points:THREE.Vector3[],radius:number,route:NavHints|null=null) {this.points=points;this.radius=radius;this.route=route;this.walking=false;this.velX=this.velZ=0;this.stuckFor=0;this.pauseUntil=this.game.time+1;this.frozen=false;}

  bark(): void {
    const g = this.game;
    if (g.time < this.barkCd) return;
    this.barkCd = g.time + 4;
    const starLines:[string,string][]=[['별빛 항구에 오신 걸 환영해요!','Welcome to Starhaven!'],['바닷가 마을에서 다 같이 이사 왔어요.','We moved here together from the seaside town.'],['새 집 앞에 꽃을 심었어요!','I planted flowers outside my new home!'],['핍이 수정으로 새 도구를 만든대요.','Pip is making new tools from crystals.'],['북쪽 유적의 일식은 조심하세요.','Be careful of the eclipse in the northern ruins.'],['여기서도 친구들과 함께라서 든든해요.','I am glad our friends are here too.']];
    const shoreKo=['옆걸음하기 좋은 저녁이네요.','앞으로 걸어 본 적 있어요? 저도 없어요.','오늘 LED가 어둡네요. 녹 때문인가?','그룩이 집게 씨름 세 판을 빚졌어요.','등대가 방금 깜빡였나요?','껍질을 닦았는데 아무도 몰라봐요!','다리가 여섯인데도 돌길에서 넘어져요.','주점 수프에서 승리의 향기가 나네요. 해초 향기도요.','역시 옆걸음이 최고예요.','선장님 수염이 지붕을 받칠 만큼 튼튼하대요.'];
    const index=Math.floor(Math.random()*TOWNSFOLK_BARKS.length);
    g.say(this.unit,g.world2.chapter===2?t(...pick(g.journey?.trueCleared?STAR_VICTORY_BARKS:starLines)):t(shoreKo[index],TOWNSFOLK_BARKS[index]));
    this.walking = false;
    this.pauseUntil = g.time + 4;
    this.unit.act('gesture_hello');
  }

  update(dt: number): void {
    const g = this.game;
    const u = this.unit;
    const now = g.time;
    if (this.frozen || g.ending.active) {
      u.feedLocomotion(dt);
      return;
    }
    let tx = 0;
    let tz = 0;
    if (!this.walking && now > this.pauseUntil) {
      const base = pick(this.points);
      const a = rand(0, TAU);
      const r = rand(0, this.radius);
      this.dest.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
      if (this.route) {
        g.world.resolveCollision(this.dest.x, this.dest.z, u.radius + .15, this.clearDest);
        this.dest.set(this.clearDest.x, 0, this.clearDest.y);
      }
      this.stuckFor = 0;
      this.walking = true;
      this.sideways = Math.random() < 0.55;
      this.speed = rand(1.3, 2.1);
    }
    if (this.walking) {
      const dx = this.dest.x - u.pos.x;
      const dz = this.dest.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) {
        this.walking = false;
        this.pauseUntil = now + rand(3, 9);
        if (Math.random() < 0.35 && !u.culled) u.act(pick(['gesture_paw', 'gesture_hello', 'claw_left', 'gesture_salute'] as const));
      } else {
        const next = this.route?.waypoint(u.pos, this.dest, now) ?? this.dest;
        const nx = next.x - u.pos.x, nz = next.z - u.pos.z;
        const nd = Math.hypot(nx, nz);
        if (nd > .001) { tx = nx / nd; tz = nz / nd; }
        const travel = Math.atan2(tx, tz);
        u.setYaw(turnToward(u.yaw, this.sideways ? travel + Math.PI / 2 : travel, 3, dt));
      }
    }
    // Step around the player instead of walking through them.
    const p = g.player.unit;
    const pd = u.distTo(p);
    if (pd < u.radius + p.radius + 0.4 && pd > 0.01) {
      tx += ((u.pos.x - p.pos.x) / pd) * 1.5;
      tz += ((u.pos.z - p.pos.z) / pd) * 1.5;
    }
    this.velX = damp(this.velX, tx * this.speed, 6, dt);
    this.velZ = damp(this.velZ, tz * this.speed, 6, dt);
    const ox = u.pos.x;
    const oz = u.pos.z;
    u.moveTo(g.world, u.pos.x + this.velX * dt, u.pos.z + this.velZ * dt, dt);
    // Allow the initial acceleration before treating sustained lack of movement as a wall.
    this.stuckFor = this.walking && Math.hypot(u.pos.x - ox, u.pos.z - oz) < this.speed * dt * 0.2 ? this.stuckFor + dt : 0;
    if (this.stuckFor > .5) {
      this.walking = false;
      this.pauseUntil = now + rand(0.5, 2);
    }
    u.feedLocomotion(dt);
  }

  faceToward(target: Unit): void {
    this.unit.setYaw(yawTo(this.unit.pos.x, this.unit.pos.z, target.pos.x, target.pos.z));
  }
}
