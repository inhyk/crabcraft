import {DurableObject} from 'cloudflare:workers';
import {specOf} from '../protocol';

const enc=new TextEncoder();
const hex=(b:ArrayBuffer|Uint8Array)=>Array.from(b instanceof Uint8Array?b:new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const passwordHash=async(password:string,salt:string)=>{
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
};
export const accountName=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_]{3,24}$/.test(v)?v.toLowerCase():null;
type Bundle=Record<string,string>;
// The Royal Vault, as server/node/accounts.ts: optional `{"coins": n}`, kept when an older page saves without it.
const VAULT_KEY='cc.vault.v1';
const vaultOf=(v:string)=>{if(v.length>200)return false;try{const data=JSON.parse(v);return !!data&&typeof data==='object'&&!Array.isArray(data)&&Number.isSafeInteger(data.coins)&&data.coins>=0;}catch{return false;}};
function bundleOf(value:unknown):Bundle|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const entries=Object.entries(value);if(entries.length>18||JSON.stringify(value).length>48000)return null;
 for(const [k,v] of entries){
  if(!(k==='cc.spec'||k==='cc.lighthouseSecret.v1'||k===VAULT_KEY||k.startsWith('cc.journey.v1:'))||k.length>180||typeof v!=='string'||v.length>16000)return null;
  if(k==='cc.lighthouseSecret.v1'){if(v!=='found')return null;continue;}
  if(k===VAULT_KEY){if(!vaultOf(v))return null;continue;}
  try{const data=JSON.parse(v);if(k==='cc.spec'?!specOf(data):(!data||!Number.isSafeInteger(data.xp)||data.xp<0))return null;}catch{return null;}
 }
 return Object.fromEntries(entries);
}
type Result={status:number;body:{error?:string;ok?:boolean;username?:string;revision?:number;save?:Bundle;updated?:number};token?:string;clear?:boolean};
type AccountRow={username:string;salt:string;hash:string;revision:number;save:string;updated:number};
export class CrabAccount extends DurableObject<Env>{
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec(`
 CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,save TEXT NOT NULL DEFAULT '{}',updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS limits (id TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
 `);}
 limit(key:string,max:number,seconds:number):boolean{
  const sql=this.ctx.storage.sql,now=Date.now();const row=sql.exec<{count:number;until:number}>('SELECT count,until FROM limits WHERE id=?',key).toArray()[0];
  if(row&&row.until>now&&row.count>=max)return false;
  sql.exec('INSERT OR REPLACE INTO limits VALUES (?,?,?)',key,row&&row.until>now?row.count+1:1,row&&row.until>now?row.until:now+seconds*1000);return true;
 }
 async handle(action:string,username:string,token:string,body:Record<string,unknown>):Promise<Result>{
  const sql=this.ctx.storage.sql,now=Date.now();
  const fail=(status:number,error:string):Result=>({status,body:{error}});
  if(action==='signup'||action==='login'){
   if(!this.limit('login',20,900))return fail(429,'rate');
   if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)return fail(400,'password');
   const existing=sql.exec<AccountRow>('SELECT * FROM account WHERE id=1').toArray()[0];
   const salt=existing?.salt??random(),hash=await passwordHash(body.password,salt);
   if(action==='signup'){
    // Recheck after asynchronous hashing: concurrent signups must never replace an account.
    if(sql.exec('SELECT id FROM account WHERE id=1').toArray().length)return fail(409,'taken');
    const initial=bundleOf(body.save??{});if(!initial)return fail(400,'save');
    sql.exec('INSERT INTO account (id,username,salt,hash,save,updated) VALUES (1,?,?,?,?,?)',username,salt,hash,JSON.stringify(initial),now);
   }else if(!existing||!crypto.subtle.timingSafeEqual(enc.encode(hash),enc.encode(existing.hash)))return fail(401,'credentials');
   sql.exec('DELETE FROM sessions WHERE expires<?',now);
   // Bound storage to the ten most recent devices; signed-in sessions expire after seven days.
   sql.exec('DELETE FROM sessions WHERE token IN (SELECT token FROM sessions ORDER BY expires DESC LIMIT -1 OFFSET 9)');
   const fresh=random();sql.exec('INSERT INTO sessions VALUES (?,?)',await digest(fresh),now+7*86400000);
   const row=sql.exec<AccountRow>('SELECT * FROM account WHERE id=1').one();
   return {status:200,token:fresh,body:{username,revision:row.revision,save:JSON.parse(row.save),updated:row.updated}};
  }
  if(!/^[a-f0-9]{64}$/.test(token))return fail(401,'session');
  const key=await digest(token),session=sql.exec<{expires:number}>('SELECT expires FROM sessions WHERE token=?',key).toArray()[0];
  if(!session||session.expires<=now)return fail(401,'session');
  if(action==='logout'){sql.exec('DELETE FROM sessions WHERE token=?',key);return {status:200,clear:true,body:{ok:true}};}
  if(action==='save'){
   if(!this.limit('save',60,60))return fail(429,'rate');
   const save=bundleOf(body.save);if(!save||!Number.isSafeInteger(body.revision))return fail(400,'save');
   const row=sql.exec<AccountRow>('SELECT * FROM account WHERE id=1').one();
   if(body.revision!==row.revision)return fail(409,'conflict');
   const vault=(JSON.parse(row.save) as Bundle)[VAULT_KEY];if(!(VAULT_KEY in save)&&typeof vault==='string')save[VAULT_KEY]=vault;
   sql.exec('UPDATE account SET save=?,revision=revision+1,updated=? WHERE id=1',JSON.stringify(save),now);
  }else if(action!=='session')return fail(404,'route');
  const row=sql.exec<AccountRow>('SELECT * FROM account WHERE id=1').one();
  return {status:200,body:{username,revision:row.revision,...(action==='session'?{save:JSON.parse(row.save)}:{}),updated:row.updated}};
 }
}
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new Error('large');}chunks.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 const value=JSON.parse(new TextDecoder().decode(all));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('body');return value as Record<string,unknown>;
}
export async function accountRequest(request:Request,env:Env):Promise<Response>{
 const headers:Record<string,string>={'Cache-Control':'no-store, private','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
 const respond=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const local=url.hostname==='127.0.0.1'||url.hostname==='localhost';
 if(request.headers.get('X-Crabcraft-Account')!=='1'||(origin&&!['https://inh-crabcraft-multiplayer.vercel.app','https://seonn.dev'].includes(origin)&&!(local&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))))return respond(403,{error:'origin'});
 const action=url.pathname.split('/').pop()!;
 if(!['signup','login','session','save','logout'].includes(action)||(action==='session'?request.method!=='GET':request.method!=='POST'))return respond(405,{error:'method'});
 try{
  const body=request.method==='POST'?await boundedBody(request):{};
  const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)cc_account=([a-z0-9_]{3,24})\.([a-f0-9]{64})(?:;|$)/);
  const username=action==='signup'||action==='login'?accountName(body.username):cookie?.[1];
  if(!username)return respond(action==='signup'||action==='login'?400:401,{error:action==='signup'||action==='login'?'username':'session'});
  if(action==='signup'||action==='login'){
   const ip=request.headers.get('CF-Connecting-IP')??'local';
   if(!await env.ACCOUNTS.getByName('limit:'+await digest(ip)).limit('requests',100,900))return respond(429,{error:'rate'});
  }
  const result=await env.ACCOUNTS.getByName('user:'+username).handle(action,username,cookie?.[2]??'',body);
  if(result.token||result.clear)headers['Set-Cookie']=`cc_account=${result.clear?'':username+'.'+result.token}; Path=/api/account; HttpOnly; SameSite=Strict; ${local?'':'Secure; '}Max-Age=${result.clear?0:604800}`;
  return respond(result.status,result.body);
 }catch{return respond(400,{error:'request'});}
}
