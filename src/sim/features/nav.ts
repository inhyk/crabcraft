/** Numeric extraction of game/nav.ts. Nodes must include Area POIs and spawn points. */
import type { Vec3, WorldQuery } from '../types.ts';
import { copyValue } from '../events.ts';
const distanceSquared=(a:Readonly<Vec3>,b:Readonly<Vec3>)=>(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2;
const distance=(a:Readonly<Vec3>,b:Readonly<Vec3>)=>Math.sqrt(distanceSquared(a,b));
const STEP = 1.0;
const RADIUS = 0.45;
const MAX_EDGE = 75;
const MAX_RISE = 1.1;



interface NavOptions {
  points?: readonly Vec3[];
  radius?: number;
  step?: number;
}

export class FeatureNavigation {
  private nodes: Vec3[] = [];
  private adj: { to: number; cost: number }[][] = [];
  private path: Vec3[] = [];
  private goal: Vec3 = {x:Infinity,y:0,z:0};
  private replanAt = 0;
  private checkAt = 0;
  private readonly tmp = {x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};

  private readonly radius: number;
  private readonly step: number;

  private readonly world: WorldQuery;
  constructor(world: WorldQuery, options: NavOptions = {}) {
    this.world = world;
    this.radius = options.radius ?? RADIUS;
    this.step = options.step ?? STEP;
    const pts = (options.points ?? []).map(p => ({...p}));
    // Drop near-duplicates.
    for (const p of pts) if (!this.nodes.some((n) => distance(n,p) < 2)) this.nodes.push(p);
    this.adj = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > MAX_EDGE || !this.walkable(a, b)) continue;
        this.adj[i].push({ to: j, cost: d });
        this.adj[j].push({ to: i, cost: d });
      }
    }
  }

  debug() {
    return copyValue({nodes:this.nodes,adj:this.adj,path:this.path,goal:Number.isFinite(this.goal.x)?this.goal:null,
      replanAt:this.replanAt,checkAt:this.checkAt,radius:this.radius,step:this.step});
  }

  /** Can a crab walk the straight segment a to b? */
  walkable(a: Vec3, b: Vec3): boolean {
    const w = this.world;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / this.step));
    let prevY = w.heightAt(a.x, a.z);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const r = w.resolveCollision(x, z, this.radius, this.tmp);
      // The end points themselves may sit against a wall (an NPC at a counter); be lenient there.
      if (i < n && Math.hypot(r.x - x, r.y - z) > 0.08) return false;
      const y = w.heightAt(x, z);
      if (Math.abs(y - prevY) > MAX_RISE * (d / n)) return false;
      prevY = y;
    }
    return true;
  }

  /**
   * Where the hint should point this frame for a player at `from` going to `goal`: the furthest
   * waypoint on the route that is directly walkable, or the goal itself.
   */
  waypoint(from: Vec3, goal: Vec3, now: number): Vec3 {
    if (distanceSquared(goal,this.goal) > 1 || now >= this.replanAt) {
      this.goal = {...goal};
      this.replanAt = now + 1.5;
      this.path = this.plan(from, goal);
    }
    // Skip waypoints we have reached or can already walk past.
    while (this.path.length > 1 && Math.hypot(this.path[0].x - from.x, this.path[0].z - from.z) < 3 && this.walkable(from, this.path[1])) this.path.shift();
    if (now >= this.checkAt) {
      this.checkAt = now + 0.3;
      for (let i = Math.min(this.path.length - 1, 3); i > 0; i--) {
        if (this.walkable(from, this.path[i])) {
          this.path.splice(0, i);
          break;
        }
      }
    }
    return {...(this.path[0] ?? goal)};
  }

  private plan(from: Vec3, goal: Vec3): Vec3[] {
    if (this.walkable(from, goal)) return [({...goal})];
    const N = this.nodes.length;
    const S = N;
    const G = N + 1;
    const edgesFrom = (i: number): { to: number; cost: number }[] => {
      if (i === S) {
        const out: { to: number; cost: number }[] = [];
        for (let j = 0; j < N; j++) {
          const d = Math.hypot(this.nodes[j].x - from.x, this.nodes[j].z - from.z);
          if (d < MAX_EDGE && this.walkable(from, this.nodes[j])) out.push({ to: j, cost: d });
        }
        return out;
      }
      const out = i < N ? [...this.adj[i]] : [];
      if (i < N) {
        const n = this.nodes[i];
        const d = Math.hypot(goal.x - n.x, goal.z - n.z);
        if (d < MAX_EDGE && (d < 2 || this.walkable(n, goal))) out.push({ to: G, cost: d });
      }
      return out;
    };
    // Dijkstra over a few dozen nodes.
    const dist = new Array<number>(N + 2).fill(Infinity);
    const prev = new Array<number>(N + 2).fill(-1);
    const done = new Array<boolean>(N + 2).fill(false);
    dist[S] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N + 2; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === G) break;
      done[u] = true;
      for (const e of edgesFrom(u)) {
        const nd = dist[u] + e.cost;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
        }
      }
    }
    if (dist[G] === Infinity) return [({...goal})];
    const out: Vec3[] = [];
    for (let v = prev[G]; v >= 0 && v !== S; v = prev[v]) out.unshift(({...this.nodes[v]}));
    out.push(({...goal}));
    return out;
  }
}
