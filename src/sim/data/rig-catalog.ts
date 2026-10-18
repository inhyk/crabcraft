/** Small factory metadata for presentation. Deliberately does not import motion clips or pose state. */
import raw from './rig-catalog.json' with { type: 'json' };
import { canonicalRigId } from './rig-aliases.ts';
import type { ClassId } from '../types.ts';
export interface RigSpec {readonly race:'human'|'orc'|'dwarf'|'undead'|'nightelf'|'tauren';readonly sex:'male'|'female';readonly classId:ClassId;readonly shell:number;readonly crest:number;readonly led:number;readonly name:string}
interface RigScale {
 /** Multiply the root returned by the production factory by this value exactly once. */
 readonly rootMultiplier:number;
 /** Measured total root scale, including race posture and the multiplier. */
 readonly rootScale:readonly [number,number,number];
 readonly metersToUnits:number;
}
export type RigCatalogEntry=RigScale&(
 {readonly factory:'createCrab';readonly spec:RigSpec;readonly extras?:readonly string[];readonly seed?:number;readonly drawOffset?:number}|
 {readonly factory:'createEnemyCrab';readonly kind:'scrapling'|'scavenger'|'corrodius'}|
 {readonly factory:'createJellyfishRig'}
);
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
const entries=freeze(raw.rigs) as unknown as Readonly<Record<string,RigCatalogEntry>>;
export const rigCatalogVersion=raw.version;
export const rigCatalogMotionVersion=raw.motionVersion;
export const rigCatalogIds:readonly string[]=Object.freeze(Object.keys(entries));
export function rigCatalog(id:string):RigCatalogEntry{const entry=entries[canonicalRigId(id)];if(!entry)throw new Error(`Unknown shipped rig ${id}`);return entry;}
