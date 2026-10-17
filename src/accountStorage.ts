/** Guest saves remain untouched. Each account gets its own local progress cache. */
let profile='';
export const progressKey=(key:string)=>key==='cc.spec'||key==='cc.lighthouseSecret.v1'||key.startsWith('cc.journey.v1:');
export function setSaveProfile(username:string){profile=username;}
export function saveProfile(){return profile;}
export function storageKey(key:string){return profile&&progressKey(key)?`cc.account.v1:${profile}:${key}`:key;}
export function readBundle(username=profile):Record<string,string>{
 const prefix=username?`cc.account.v1:${username}:`:'',out:Record<string,string>={};
 for(let i=0;i<localStorage.length;i++){const raw=localStorage.key(i)!;if(prefix&&!raw.startsWith(prefix))continue;const key=prefix?raw.slice(prefix.length):raw;if(progressKey(key)){const v=localStorage.getItem(raw);if(v!==null)out[key]=v;}}
 // The active character plus its own journey are enough to continue on another computer.
 const spec=out['cc.spec'];if(!spec)return {};
 const s=JSON.parse(spec),journey=`cc.journey.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`;
 return Object.fromEntries(Object.entries(out).filter(([k])=>k==='cc.spec'||k==='cc.lighthouseSecret.v1'||k===journey));
}
export function applyBundle(username:string,bundle:Record<string,string>){
 const prefix=`cc.account.v1:${username}:`,remove:string[]=[];
 for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)!;if(k.startsWith(prefix)&&progressKey(k.slice(prefix.length)))remove.push(k);}
 for(const key of remove)localStorage.removeItem(key);
 for(const [key,value] of Object.entries(bundle))if(progressKey(key)&&typeof value==='string')localStorage.setItem(prefix+key,value);
}
