import type { CoreEvent, EntityRef, HitPlan, ProjectileState, SimUnit } from './types.ts';
import { copyValue, immutable, sameRef } from './events.ts';
import { Ids } from './random.ts';
import { centre } from './unit.ts';
export class Projectiles {
  private entries = new Map<number,ProjectileState>();
  private ids=new Ids();
  private limit:number;
  private getUnit:(ref:EntityRef)=>SimUnit|null;
  private emit:(event:CoreEvent)=>void;
  private resolve:(plan:HitPlan)=>void;
  constructor(limit:number,getUnit:(ref:EntityRef)=>SimUnit|null,emit:(event:CoreEvent)=>void,resolve:(plan:HitPlan)=>void){this.limit=limit;this.getUnit=getUnit;this.emit=emit;this.resolve=resolve;}
  get states():ReadonlyMap<number,ProjectileState>{return this.entries;}
  get nextId():number{return this.ids.nextValue;}
  launch(input:Omit<ProjectileState,'id'|'elapsed'|'bornStep'>,step:number):number {if(this.entries.size>=this.limit)throw new RangeError('Projectile capacity exceeded');if(![input.x,input.y,input.z,input.speed].every(Number.isFinite)||input.speed<=0)throw new RangeError('Invalid projectile');if(!this.getUnit(input.source)||!this.getUnit(input.target))throw new RangeError('Stale projectile reference');const owned=copyValue(input);const id=this.ids.next();const p={...owned,id,elapsed:0,bornStep:step};this.entries.set(id,p);this.emit({type:'projectile',stage:'spawn',id,src:p.source,target:p.target,from:{x:p.x,y:p.y,z:p.z},style:p.style,speed:p.speed});return id;}
  update(dt:number):void {const batch=[...this.entries.values()].reverse();for(const p of batch){if(!this.entries.has(p.id))continue;const target=this.getUnit(p.target),source=this.getUnit(p.source);if(!target||!source){this.entries.delete(p.id);continue;}p.elapsed+=dt;const at=centre(target),dx=at.x-p.x,dy=at.y-p.y,dz=at.z-p.z,len=Math.hypot(dx,dy,dz),step=p.speed*dt;if(p.elapsed>=6||len<=step||!target.alive){this.entries.delete(p.id);this.emit({type:'projectile',stage:'hit',id:p.id,src:p.source,target:p.target,style:p.style,landed:target.alive});this.resolve(p.hit);}else{p.x+=dx/len*step;p.y+=dy/len*step;p.z+=dz/len*step;}}}
  purge(ref:EntityRef):void{for(const p of this.entries.values())if(sameRef(ref,p.source)||sameRef(ref,p.target))this.entries.delete(p.id);}
  snapshot():readonly ProjectileState[]{return immutable([...this.entries.values()]);}
  clear():void{this.entries.clear();}
}
