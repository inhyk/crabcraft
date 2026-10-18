// Pose sampling and blending without allocation: a Pose is 22 joint angles plus the body's
// offset (root-local, game axes, robot metres) and orientation relative to the root.
import { motionData, numericClip, type NumericClip as LoadedClip } from './data/pose.ts';
import { numericArchetype } from './data/archetypes.ts';
import type { NumericPoseState, SimUnit, Vec3 } from './types.ts';
const JOINT_NAMES = motionData.joints;

export const NJ = JOINT_NAMES.length;

/** Joints the upper-body layer owns: both claws (LF_*, RF_*). */
export const CLAW_JOINTS: number[] = JOINT_NAMES.flatMap((n, i) => (n.startsWith('LF_') || n.startsWith('RF_') ? [i] : []));

/** The calibrated standing pose (bundle contracts' default_joint_pos), MuJoCo qpos convention. */
export const HOME_Q: Float32Array = Float32Array.from([
  -0.5507, -1.0658, -0.4408, -1.374, 0.0,
  0.5524, -1.066, 0.4414, 1.4173, 0.0,
  0.0012, 0.5356, -1.8271,
  -0.0012, -0.5376, 1.8313,
  0.6313, 0.5534, -1.8648,
  -0.6326, -0.5548, 1.8678,
]);
/** Base height of the standing robot, metres (upstream STAND_Z). */
export const STAND_HEIGHT = 0.10647;

export class Pose {
  readonly q = new Float32Array(NJ);
  /** Body offset from the root, game axes, metres; y is the height above the ground. */
  readonly pos = new Float32Array(3);
  /** Body orientation relative to the root, (x, y, z, w). */
  readonly rot = new Float32Array(4);

  constructor() {
    this.setHome();
  }

  setHome(): this {
    this.q.set(HOME_Q);
    this.pos[0] = 0;
    this.pos[1] = STAND_HEIGHT;
    this.pos[2] = 0;
    this.rot[0] = this.rot[1] = this.rot[2] = 0;
    this.rot[3] = 1;
    return this;
  }

  copy(o: Pose): this {
    this.q.set(o.q);
    this.pos.set(o.pos);
    this.rot.set(o.rot);
    return this;
  }

  /** this = lerp(this, o, w); joints restricted to `joints` when given (body untouched then). */
  blend(o: Pose, w: number, joints?: number[]): this {
    if (w <= 0) return this;
    if (w >= 1 && !joints) return this.copy(o);
    const q = this.q;
    if (joints) {
      for (const i of joints) q[i] += (o.q[i] - q[i]) * w;
      return this;
    }
    for (let i = 0; i < NJ; i++) q[i] += (o.q[i] - q[i]) * w;
    for (let i = 0; i < 3; i++) this.pos[i] += (o.pos[i] - this.pos[i]) * w;
    nlerp(this.rot, o.rot, w);
    return this;
  }
}

/** a = normalize(lerp(a, b, w)) along the short arc. */
export function nlerp(a: Float32Array, b: Float32Array, w: number): void {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  let l = 0;
  for (let i = 0; i < 4; i++) {
    a[i] += (s * b[i] - a[i]) * w;
    l += a[i] * a[i];
  }
  l = 1 / Math.sqrt(l || 1);
  for (let i = 0; i < 4; i++) a[i] *= l;
}

/** Weighted sum accumulator: add poses with weights, then resolve() divides by the total. */
export class PoseSum {
  readonly q = new Float64Array(NJ);
  readonly pos = new Float64Array(3);
  readonly rot = new Float64Array(4);
  total = 0;
  private refSet = false;
  private ref = new Float64Array(4);

  reset(): void {
    this.q.fill(0);
    this.pos.fill(0);
    this.rot.fill(0);
    this.total = 0;
    this.refSet = false;
  }

  add(p: Pose, w: number): void {
    if (w <= 0) return;
    for (let i = 0; i < NJ; i++) this.q[i] += p.q[i] * w;
    for (let i = 0; i < 3; i++) this.pos[i] += p.pos[i] * w;
    if (!this.refSet) {
      for (let i = 0; i < 4; i++) this.ref[i] = p.rot[i];
      this.refSet = true;
    }
    const s = this.ref[0] * p.rot[0] + this.ref[1] * p.rot[1] + this.ref[2] * p.rot[2] + this.ref[3] * p.rot[3] < 0 ? -w : w;
    for (let i = 0; i < 4; i++) this.rot[i] += p.rot[i] * s;
    this.total += w;
  }

  resolve(out: Pose): boolean {
    if (this.total <= 1e-6) return false;
    const k = 1 / this.total;
    for (let i = 0; i < NJ; i++) out.q[i] = this.q[i] * k;
    for (let i = 0; i < 3; i++) out.pos[i] = this.pos[i] * k;
    const r = this.rot;
    const l = 1 / Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3] || 1);
    for (let i = 0; i < 4; i++) out.rot[i] = r[i] * l;
    return true;
  }
}

/** Frame pair and fraction for clip time t (seconds); loops wrap from the last frame to frame 0. */
function frameAt(c: LoadedClip, t: number, loop: boolean, out: { i0: number; i1: number; f: number }): void {
  const n = c.frameCount;
  if (n <= 1) {
    out.i0 = out.i1 = 0;
    out.f = 0;
    return;
  }
  let x = t * c.fps;
  if (loop) {
    const span = c.loop ? n : n - 1;
    x = ((x % span) + span) % span;
    const i0 = Math.floor(x);
    out.i0 = i0;
    out.i1 = i0 + 1 >= n ? 0 : i0 + 1;
    out.f = x - i0;
  } else {
    x = Math.min(Math.max(x, 0), n - 1);
    const i0 = Math.min(Math.floor(x), n - 2);
    out.i0 = i0;
    out.i1 = i0 + 1;
    out.f = x - i0;
  }
}


/**
 * Sample a clip into `out`. In-place clips give the body relative to the clip's ideal root path;
 * full-root clips give it relative to frame 0, with the clip's net drift and heading change
 * removed progressively so the crab ends where it started (gameplay owns the root), unless
 * `keepRoot` (MotionPlayOptions.carryRoot) leaves them in for the caller to carry over.
 */
export function sampleClip(c: LoadedClip, t: number, loop: boolean, out: Pose, keepRoot = false): void {
  const fr = { i0: 0, i1: 0, f: 0 }, qa = new Float32Array(4), qb = new Float32Array(4);
  frameAt(c, t, loop, fr);
  const { i0, i1, f } = fr;
  const q = c.q;
  const a = i0 * NJ;
  const b = i1 * NJ;
  for (let k = 0; k < NJ; k++) out.q[k] = q[a + k] + (q[b + k] - q[a + k]) * f;
  const src = c.local ?? c.base;
  const p0 = i0 * 7;
  const p1 = i1 * 7;
  for (let k = 0; k < 3; k++) out.pos[k] = src[p0 + k] + (src[p1 + k] - src[p0 + k]) * f;
  for (let k = 0; k < 4; k++) {
    qa[k] = src[p0 + 3 + k];
    qb[k] = src[p1 + 3 + k];
  }
  nlerp(qa, qb, f);
  out.rot.set(qa);
  if (!c.local && c.length > 0 && !keepRoot) {
    // full root: take out the drift linearly over the clip
    const u = Math.min(1, Math.max(0, (i0 + f) / Math.max(1, c.frameCount - 1)));
    out.pos[0] -= c.drift.x * u;
    out.pos[2] -= c.drift.z * u;
    const h = -c.drift.yaw * u * 0.5;
    // out.rot = yaw(h) * out.rot, yaw about +Y
    const s = Math.sin(h), w = Math.cos(h);
    const x = out.rot[0], y = out.rot[1], z = out.rot[2], r = out.rot[3];
    out.rot[0] = w * x + s * z;
    out.rot[1] = w * y + s * r;
    out.rot[2] = w * z - s * x;
    out.rot[3] = w * r - s * y;
    // and the offset rotates with the heading correction
    const cx = out.pos[0], cz = out.pos[2];
    const c2 = Math.cos(2 * h), s2 = Math.sin(2 * h);
    out.pos[0] = c2 * cx + s2 * cz;
    out.pos[2] = -s2 * cx + c2 * cz;
  }
}

/** Heading of a body rotation (x, y, z, w; game axes, Y up) about +Y, radians. */
export function headingOf(r: ArrayLike<number>): number {
  const x = r[0], y = r[1], z = r[2], w = r[3];
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}

/**
 * Re-express a root-relative pose against a root moved by (x, z) and turned by `yaw` about +Y:
 * pos = Ry(-yaw) (pos - (x, 0, z)), rot = yaw(-yaw) * rot.
 */
export function rebaseRoot(p: Pose, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = p.pos[0] - x, dz = p.pos[2] - z;
  p.pos[0] = c * dx - s * dz;
  p.pos[2] = s * dx + c * dz;
  const hs = Math.sin(-yaw / 2), hw = Math.cos(-yaw / 2);
  const qx = p.rot[0], qy = p.rot[1], qz = p.rot[2], qw = p.rot[3];
  p.rot[0] = hw * qx + hs * qz;
  p.rot[1] = hw * qy + hs * qw;
  p.rot[2] = hw * qz - hs * qx;
  p.rot[3] = hw * qw - hs * qy;
}

/** Events with times in (from, to], wrapping for loops. Calls fn(name) for each. */
export function crossedEvents(c: LoadedClip, from: number, to: number, loop: boolean, fn: (name: string) => void): void {
  if (to <= from) return;
  const len = c.length;
  for (const name in c.events) {
    const times = c.events[name];
    for (const t of times) {
      if (!loop) {
        if (t > from && t <= to) fn(name);
        continue;
      }
      if (len <= 0) continue;
      // count occurrences of t + k*len inside (from, to]
      const k0 = Math.ceil((from - t) / len + 1e-9);
      for (let k = k0; t + k * len <= to; k++) fn(name);
    }
  }
}

interface Direction {
  slow: string;
  fast?: string;
  arcs?: { slow: [string, string]; fast: [string, string] };
}
const DIRECTIONS: Direction[] = [
  { slow: 'walk_fwd', fast: 'walk_fast',
    arcs: { slow: ['walk_arc_left', 'walk_arc_right'], fast: ['walk_fast_arc_left', 'walk_fast_arc_right'] } },
  { slow: 'walk_fl', fast: 'walk_fast_fl' },
  { slow: 'strafe_left', fast: 'strafe_left_fast' },
  { slow: 'walk_bl' },
  { slow: 'walk_back' },
  { slow: 'walk_br' },
  { slow: 'strafe_right', fast: 'strafe_right_fast' },
  { slow: 'walk_fr', fast: 'walk_fast_fr' },
];
const SECTOR = (Math.PI * 2) / DIRECTIONS.length;


const MIN_RATE = 0.55, MAX_RATE = 2;
class Locomotion {
 private lib = { get: numericClip };
 private vel: {x:number;z:number;yaw:number};
 private want: {x:number;z:number;yaw:number};
 phase:number; idleT:number;
 weights = new Map<string,number>();
 loco = new Pose();
 private tmp = new Pose();
 private sum = new PoseSum();
 constructor(unit:Readonly<SimUnit>){
  const p=unit.pose,m=numericArchetype(unit.archetype).metersToUnits;
  this.vel={x:p.controllerVx,z:p.controllerVz,yaw:p.controllerYaw};
  this.want={x:p.localVx/m,z:p.localVz/m,yaw:p.yawRate};
  this.phase=p.gaitPhase;this.idleT=p.locomotionTime;
  this.loco.q.set(p.locomotionQ);this.loco.pos.set(p.locomotionPosition);this.loco.rot.set(p.locomotionRotation);
 }
 save(p:NumericPoseState):void{
  p.controllerVx=this.vel.x;p.controllerVz=this.vel.z;p.controllerYaw=this.vel.yaw;
  p.gaitPhase=this.phase;p.locomotionTime=this.idleT;p.locomotionWeights=Object.fromEntries(this.weights);
  p.locomotionQ=Array.from(this.loco.q);p.locomotionPosition=Array.from(this.loco.pos) as [number,number,number];p.locomotionRotation=Array.from(this.loco.rot) as [number,number,number,number];
 }
  locomotion(dt: number, needed: boolean): void {
    const lib = this.lib;
    // smooth the request: gameplay's input is a step, a gait change is not
    const k = 1 - Math.exp(-dt / 0.12);
    this.vel.x += (this.want.x - this.vel.x) * k;
    this.vel.z += (this.want.z - this.vel.z) * k;
    this.vel.yaw += (this.want.yaw - this.vel.yaw) * k;
    this.weights.clear();
    this.idleT += dt;
    if (!needed) return;

    const sum = this.sum;
    sum.reset();
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const ang = Math.atan2(this.vel.x, this.vel.z); // 0 forward, +pi/2 left

    // 1. directional gaits, bilinear in angle, then slow/fast by speed
    const gaits: { clip: LoadedClip; w: number }[] = [];
    if (speed > 1e-3) {
      const sector = (ang + 2 * Math.PI) % (2 * Math.PI);
      const i0 = Math.floor(sector / SECTOR) % DIRECTIONS.length;
      const i1 = (i0 + 1) % DIRECTIONS.length;
      const u = (sector - i0 * SECTOR) / SECTOR;
      for (const [d, w] of [[DIRECTIONS[i0], 1 - u], [DIRECTIONS[i1], u]] as const) {
        if (w <= 1e-4) continue;
        const slow = lib.get(d.slow);
        const fast = d.fast ? lib.get(d.fast) : null;
        if (!slow) continue;
        let f = 0;
        if (fast) {
          const s0 = Math.hypot(slow.velocity[0], slow.velocity[1]);
          const s1 = Math.hypot(fast.velocity[0], fast.velocity[1]);
          f = Math.min(1, Math.max(0, (speed - s0) / Math.max(1e-3, s1 - s0)));
        }
        this.addGait(gaits, slow, w * (1 - f), d.arcs?.slow);
        if (fast) this.addGait(gaits, fast, w * f, d.arcs?.fast);
      }
    }
    let gw = 0;
    let natSpeed = 0;
    let natFreq = 0;
    for (const g of gaits) {
      gw += g.w;
      natSpeed += g.w * Math.hypot(g.clip.velocity[0], g.clip.velocity[1]);
      natFreq += g.w * (g.clip.cycles / g.clip.length);
    }
    if (gw > 0) {
      natSpeed /= gw;
      natFreq /= gw;
    }
    // below ~40% of the slowest gait, fade into idle rather than shuffle in slow motion
    const moving = gw > 0 ? Math.min(1, speed / (0.4 * Math.max(0.05, natSpeed))) : 0;
    const rate = gw > 0 ? Math.min(MAX_RATE, Math.max(MIN_RATE, speed / Math.max(1e-3, natSpeed))) : 1;

    // 2. turning in place
    const turnId: string = this.vel.yaw >= 0 ? 'turn_left' : 'turn_right';
    const turn = Math.abs(this.vel.yaw) > 0.03 ? lib.get(turnId) : null;
    const turnAmount = turn ? Math.min(1, Math.abs(this.vel.yaw) / 0.6) * (1 - moving) : 0;
    const turnRate = turn ? Math.min(MAX_RATE, Math.max(MIN_RATE, Math.abs(this.vel.yaw) / Math.max(0.1, Math.abs(turn.yawRate)))) : 1;
    const turnFreq = turn ? turn.cycles / turn.length : 0;

    // 3. one shared gait phase for everything that steps
    const stepW = moving + turnAmount;
    if (stepW > 0) {
      const f = (moving * natFreq * rate + turnAmount * turnFreq * turnRate) / stepW;
      this.phase += f * dt;
    }
    const idle = lib.get('idle');
    const idleW = Math.max(0, 1 - moving - turnAmount);

    if (idle && idleW > 1e-4) {
      sampleClip(idle, this.idleT, true, this.tmp);
      sum.add(this.tmp, idleW);
      this.weights.set('idle', idleW);
    } else if (idleW > 1e-4) {
      sum.add(this.tmp.setHome(), idleW);
    }
    for (const g of gaits) {
      const w = (g.w / gw) * moving;
      if (w <= 1e-4) continue;
      const t = this.gaitTime(g.clip);
      sampleClip(g.clip, t, true, this.tmp);
      sum.add(this.tmp, w);
      this.weights.set(g.clip.id, w);
    }
    if (turn && turnAmount > 1e-4) {
      sampleClip(turn, this.gaitTime(turn), true, this.tmp);
      sum.add(this.tmp, turnAmount);
      this.weights.set(turn.id, turnAmount);
    }
    if (!sum.resolve(this.loco)) this.loco.setHome();

  }

  /** Add a straight gait, or a share of its arc (walking while turning) when steering. */
  private addGait(gaits: { clip: LoadedClip; w: number }[], clip: LoadedClip, w: number, arcs?: [string, string]) {
    if (w <= 1e-4) return;
    const yaw = this.vel.yaw;
    const arc = arcs && Math.abs(yaw) > 0.03 ? this.lib.get(arcs[yaw > 0 ? 0 : 1]) : null;
    if (!arc) {
      gaits.push({ clip, w });
      return;
    }
    const a = Math.min(1, Math.abs(yaw) / Math.max(0.1, Math.abs(arc.yawRate)));
    if (1 - a > 1e-4) gaits.push({ clip, w: w * (1 - a) });
    gaits.push({ clip: arc, w: w * a });
  }

  /** A gait clip's time for the shared phase: whole cycles map onto the clip's own cycles. */
  private gaitTime(c: LoadedClip): number {
    const cycles = Math.max(1, c.cycles);
    const p = ((this.phase % cycles) + cycles) % cycles;
    return (p / cycles) * c.length;
  }

}

/** Fresh authoritative pose clocks, independent for each unit. */
export function initializeNumericPose():NumericPoseState {
 const p=new Pose();
 return {locomotionTime:0,localVx:0,localVz:0,yawRate:0,gaitPhase:0,controllerVx:0,controllerVz:0,controllerYaw:0,locomotionWeights:{},
 locomotionQ:Array.from(p.q),locomotionPosition:Array.from(p.pos) as [number,number,number],locomotionRotation:Array.from(p.rot) as [number,number,number,number],
 appliedQ:Array.from(p.q),appliedPosition:Array.from(p.pos) as [number,number,number],appliedRotation:Array.from(p.rot) as [number,number,number,number]};
}

/** At the former motion-update stage, AFTER core action clocks and projectile launches. */
export function advanceNumericPose(unit:SimUnit,dt:number):void {
 if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid numeric pose dt');
 const loco=new Locomotion(unit);
 let cover=0;for(const a of unit.actions)if(!a.upper)cover=Math.min(1,cover+a.weight);
 loco.locomotion(Math.min(dt,.1),cover<.999);loco.save(unit.pose);
 const out=new Pose().copy(loco.loco),tmp=new Pose();
 for(const a of unit.actions){
  if(a.weight<=0)continue;
  sampleClip(numericClip(a.id),a.clipTime,a.loop&&a.to===null,tmp,a.carryRoot);
  const r=a.root?.rebase;if(r)rebaseRoot(tmp,r.x,r.z,r.yaw);
  out.blend(tmp,a.weight,a.upper?CLAW_JOINTS:undefined);
 }
 unit.pose.appliedQ=Array.from(out.q);unit.pose.appliedPosition=Array.from(out.pos) as [number,number,number];unit.pose.appliedRotation=Array.from(out.rot) as [number,number,number,number];
}

function rotate(v:number[],q:ArrayLike<number>):number[]{
 const x=v[0],y=v[1],z=v[2],qx=q[0],qy=q[1],qz=q[2],qw=q[3];
 const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
 return [x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx];
}
/** FK from actual socket/link/bias transforms. Reads last-applied pose and current world root. */
export function launchAnchor(unit:Readonly<SimUnit>,p:Readonly<NumericPoseState>):Readonly<Vec3>{
 const a=numericArchetype(unit.archetype);
 if(p.appliedQ.length!==NJ)throw new Error('Numeric pose was not initialized');
 let v=[0,0,0];
 for(let i=a.chain.length-1;i>=0;i--){
  const t=a.chain[i];let q=t.rotation;
  if(t.joint>=0){const angle=p.appliedQ[t.joint]+t.bias,s=Math.sin(angle/2),axis=t.axis!;q=[axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(angle/2)];}
  v=rotate(v.map((x,k)=>x*t.scale[k]),q).map((x,k)=>x+t.position[k]);
 }
 if(a.bodySocket)v=rotate(v,p.appliedRotation).map((x,k)=>x+p.appliedPosition[k]*a.metersToUnits);
 v=v.map((x,k)=>x*a.rootScale[k]);
 const s=Math.sin(unit.yaw),c=Math.cos(unit.yaw);
 return {x:unit.x+v[0]*c+v[2]*s,y:unit.y+v[1],z:unit.z-v[0]*s+v[2]*c};
}
