import type {CharacterCheckpointV1,LocationCheckpoint} from '../persistence.ts';
import {validateCheckpoint} from '../persistence.ts';
import type {EntityRef,PlaceId,WorldId,WorldQuery,DurableLedgerBinding} from '../types.ts';
import type {DungeonRunKey} from './dungeon.ts';
import {detachFeatureData} from './dungeon-awards.ts';
import {immutable} from '../events.ts';
export interface DungeonReturnBinding {readonly version:number;readonly world:WorldId;readonly location:Readonly<LocationCheckpoint>}
export interface DungeonCaptureBinding {readonly ref:EntityRef;readonly liveLocation:Readonly<LocationCheckpoint>;readonly returning:DungeonReturnBinding}
export interface StagedInstanceExit {readonly token:string;readonly character:string;readonly sourceRef:EntityRef;readonly run:DungeonRunKey;readonly checkpoint:CharacterCheckpointV1;readonly capture:DungeonCaptureBinding;readonly revision?:number;readonly sourceLedger?:DurableLedgerBinding;readonly combatMode:'retained'|'external-durable';readonly featureLedger:boolean;readonly retainedGrantIds:readonly string[];readonly durableGrantIds:readonly string[]}
export function validateDungeonReturn(value:DungeonReturnBinding,world:PlaceId,query:WorldQuery,radius:number):Readonly<DungeonReturnBinding>{
 const b=detachFeatureData(value,4096);if(Object.keys(b).sort().join()!=='location,version,world'||!Number.isSafeInteger(b.version)||b.version<1||b.world!==world||!b.location||Object.keys(b.location).sort().join()!=='x,y,yaw,z'||Object.values(b.location).some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER))throw new Error('Invalid dungeon return binding');
 const p=b.location,out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};const ground=query.heightAt(p.x,p.z);if(!Number.isFinite(ground)||Math.abs(ground-p.y)>1e-6)throw new Error('Dungeon return must be grounded');query.resolveCollision(p.x,p.z,radius,out);if(![out.x,out.y].every(Number.isFinite)||Math.hypot(out.x-p.x,out.y-p.z)>1e-6)throw new Error('Dungeon return collision');return immutable(b);
}
/** Instance exit cancels transient activity explicitly, preserving survival/status clocks and progression. */
export function prepareInstanceExitCheckpoint(checkpoint:CharacterCheckpointV1):CharacterCheckpointV1 {const c=validateCheckpoint(checkpoint);return validateCheckpoint({...c,activity:{seated:false,village:false,controlsLocked:false,cast:null,channel:null,dash:false,pendingHit:false,rootPending:false,motion:{velocityX:0,velocityZ:0,jumpRemaining:0,spinRemaining:0,pushX:0,pushZ:0,pushRemaining:0,lift:0,dashElapsed:null}}});}
