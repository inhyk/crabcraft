// Runtime-only numeric data decoded from the shipped-asset bake. No asset/network fallback.
import raw from './pose-data.json' with { type: 'json' };
export interface NumericClip {
 id:string; fps:number; frameCount:number; loop:boolean; length:number; hold:boolean; holdAt?:number;
 q:readonly number[]; base:readonly number[]; local:readonly number[]|null; velocity:[number,number];
 yawRate:number; cycles:number; events:Record<string,number[]>; drift:{x:number;z:number;yaw:number};
}
export interface SocketTransform {name:string;position:number[];rotation:number[];scale:number[];joint:number;axis:number[]|null;bias:number}
export interface NumericArchetype {height:number;radius:number;metersToUnits:number;rootScale:number[];bodySocket:boolean;chain:SocketTransform[]}
export interface NumericWindow {from:number;to:number;loopFrom?:number;speed:number}
interface Bake {version:string;sourceHashes:Record<string,string>;joints:string[];clips:Record<string,NumericClip>;archetypes:Record<string,NumericArchetype>;windows:Record<string,Record<string,NumericWindow>>;routine:{id:string;label:string;from:number;to:number;fade:number}[]}
function unpack(s:string):number[]{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const bytes=new Uint8Array(s.length/4*3-(s.endsWith('==')?2:s.endsWith('=')?1:0));
 let out=0;for(let i=0;i<s.length;i+=4){const a=alphabet.indexOf(s[i]),b=alphabet.indexOf(s[i+1]),c=alphabet.indexOf(s[i+2]),d=alphabet.indexOf(s[i+3]);const n=(a<<18)|(b<<12)|((c<0?0:c)<<6)|(d<0?0:d);for(const shift of [16,8,0])if(out<bytes.length)bytes[out++]=(n>>shift)&255;}
 const view=new DataView(bytes.buffer);return Array.from({length:bytes.length/4},(_,i)=>view.getFloat32(i*4,true));
}
export function freezeNumeric<T>(v:T):T{if(v&&typeof v==='object'){for(const item of Object.values(v))freezeNumeric(item);Object.freeze(v);}return v;}
const decoded=structuredClone(raw) as unknown as Bake;
for(const c of Object.values(decoded.clips))for(const key of ['q','base','local'] as const)if(c[key])c[key]=unpack(c[key] as unknown as string);
export const motionData:Readonly<Bake>=freezeNumeric(decoded);
export function numericClip(id:string):NumericClip{const c=motionData.clips[id];if(!c)throw new Error(`Unknown shipped motion ${id}`);return c;}
