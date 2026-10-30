/** Guest saves remain untouched. Each account gets its own local progress cache. */
import {vaultCoins} from './game/tidecrown/vaultLedger.ts';
let profile='';
/** The Royal Vault of Tidecrown: coins shared by every character of the account (of the device, for a guest). */
export const VAULT_KEY='cc.vault.v1';
export const progressKey=(key:string)=>key==='cc.spec'||key==='cc.lighthouseSecret.v1'||key===VAULT_KEY||key.startsWith('cc.journey.v1:');
export function setSaveProfile(username:string){profile=username;}
export function saveProfile(){return profile;}
export function storageKey(key:string){return profile&&progressKey(key)?`cc.account.v1:${profile}:${key}`:key;}
/** A game window's shared Web Lock on its character (game/saveHold.ts), named by the journey's storage key. */
export const holdName=(key:string)=>'cc-player:'+key;
/** `{at, keys}`: the progress keys a load into this device's copy of the account is about to change (written before
 *  loadBundle waits) or has changed. Every game window of the account listens (game/saveHold.ts). */
export const loadKey=(username:string)=>'cc.account.load:'+username;
export function readBundle(username=profile):Record<string,string>{
 const prefix=username?`cc.account.v1:${username}:`:'',out:Record<string,string>={};
 for(let i=0;i<localStorage.length;i++){const raw=localStorage.key(i)!;if(prefix&&!raw.startsWith(prefix))continue;const key=prefix?raw.slice(prefix.length):raw;if(progressKey(key)){const v=localStorage.getItem(raw);if(v!==null)out[key]=v;}}
 // The active character plus its own journey are enough to continue on another computer; the vault goes in the same
 // bundle, so a deposit's two halves (vault up, journey down) always travel and load together. A vault the account
 // servers would refuse stays on this device (the vault refuses moves while it cannot read it) and out of the bundle,
 // so the rest still saves and the server keeps the stored vault.
 const spec=out['cc.spec'];if(!spec)return {};
 const s=JSON.parse(spec),journey=`cc.journey.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`;
 return Object.fromEntries(Object.entries(out).filter(([k,v])=>k==='cc.spec'||k==='cc.lighthouseSecret.v1'||k===VAULT_KEY&&vaultCoins(v)!==null||k===journey));
}
/** The account's progress keys on this device that the bundle changes: removed, added or rewritten. */
export function bundleChanges(username:string,bundle:Record<string,string>):string[]{
 const prefix=`cc.account.v1:${username}:`,keys=new Set<string>();
 for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)!;if(k.startsWith(prefix)&&progressKey(k.slice(prefix.length)))keys.add(k.slice(prefix.length));}
 for(const [k,v] of Object.entries(bundle))if(progressKey(k)&&typeof v==='string')keys.add(k);
 return [...keys].filter(k=>localStorage.getItem(prefix+k)!==(typeof bundle[k]==='string'?bundle[k]:null));
}
const tell=(username:string,keys:string[])=>{try{localStorage.setItem(loadKey(username),JSON.stringify({at:Date.now(),keys}));}catch{ /* Full storage: the windows still hear their keys change. */ }};
/** The account's progress becomes exactly the bundle's: the vault with the journey it was saved with (a bundle without
 *  a vault never had one, as the server keeps the stored vault when a page from before the vault saves). Only the keys
 *  that change are written, and then `loadKey` says which. */
export function applyBundle(username:string,bundle:Record<string,string>){
 const prefix=`cc.account.v1:${username}:`,keys=bundleChanges(username,bundle);
 if(!keys.length)return;
 for(const k of keys){const v=bundle[k];if(typeof v==='string')localStorage.setItem(prefix+k,v);else localStorage.removeItem(prefix+k);}
 tell(username,keys);
}
/** applyBundle, once the account's game windows on this device that it concerns (the vault, or their character's
 *  journey) have stopped saving: told by `loadKey`, they let go of their characters, and this waits for that (up to
 *  3 s), so none of them saves over the load with coins from before it. */
export async function loadBundle(username:string,bundle:Record<string,string>):Promise<void>{
 const keys=bundleChanges(username,bundle);
 if(!keys.length)return;
 tell(username,keys);
 const prefix=holdName(`cc.account.v1:${username}:`),all=keys.includes(VAULT_KEY),names=new Set(keys.map(k=>prefix+k));
 for(const until=Date.now()+3000;Date.now()<until;await new Promise(r=>setTimeout(r,50))){
  let locks:LockInfo[];
  try{const q=await navigator.locks?.query();locks=[...q?.held??[],...q?.pending??[]];}catch{break;}
  if(!locks.some(l=>all?l.name?.startsWith(prefix):names.has(l.name??'')))break;
 }
 applyBundle(username,bundle);
}
