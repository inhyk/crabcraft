import type {App} from './app';
import {h} from './ui/dom';
import {t} from './i18n';
import {applyBundle,readBundle,setSaveProfile} from './accountStorage';
import './account.css';

type Session={username:string;revision:number;save?:Record<string,string>;updated:number};
class AccountError extends Error{constructor(readonly code:string){super(code);}}
// Set just before leaving for Google, so the return trip knows it is a fresh sign-in.
const PENDING='cc.account.pending';
const GOOGLE_MARK='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const errorText=(code:string)=>({
 saving:t('저장이 끝나면 다시 눌러 주세요.','Please wait until saving finishes.'),
 google:t('로그인 준비 중이에요.','Sign-in is not ready yet.'),
 error:t('Google 로그인을 마치지 못했어요. 다시 해 주세요.','Google sign-in did not finish. Please try again.'),
 rate:t('시도가 너무 많아요. 잠시 뒤 다시 해주세요.','Too many attempts. Please try again later.'),
 conflict:t('다른 창에서 저장했어요. 계정 저장을 불러온 뒤 계속해 주세요. 이 기기의 진행은 보관했어요.','Another window saved first. Load the account save to continue. Your local progress is kept.'),
 session:t('로그인이 만료됐어요. 다시 로그인해 주세요.','Your login expired. Please sign in again.'),
}[code]??t('연결하지 못했어요. 이 기기의 진행은 저장되어 있어요. 다시 시도해 주세요.','Could not connect. Your local progress is safe. Please try again.'));
export class Account {
 username='';revision=0;open=false;
 private modal:HTMLDialogElement|null=null;
 private state='';private conflict=false;private clash=false;private busy=false;private timer=0;private ready=false;private saved='';
 constructor(private app:App){
  window.addEventListener('cc-progress-saved',()=>this.schedule());
  window.addEventListener('online',()=>this.schedule());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void this.flush();});
 }
 private async api(action:string,body?:unknown):Promise<Session>{
  const r=await fetch('/api/account/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Crabcraft-Account':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const data=await r.json();if(!r.ok)throw new AccountError(data.error??'network');return data;
 }
 async init(){
  // The Google callback lands here with ?account=error on failure; keep the address clean either way.
  const params=new URLSearchParams(location.search),result=params.get('account');
  if(result!==null){params.delete('account');const query=params.toString();history.replaceState(history.state,'',location.pathname+(query?'?'+query:'')+location.hash);}
  let pending=false,fresh=false;
  try{const at=Number(localStorage.getItem(PENDING));localStorage.removeItem(PENDING);pending=Date.now()-at<15*60000;}catch{ /* No storage. */ }
  try{
   const session=await this.api('session');
   // Back from Google: a new account starts empty and takes this device's guest adventure, as signup did;
   // an existing one loads its cloud save over this device's copy, as login did.
   fresh=pending&&session.revision===0&&!Object.keys(session.save??{}).length;
   this.accept(session,!pending);
   if(fresh){const guest=readBundle('');if(Object.keys(guest).length)applyBundle(session.username,guest);else fresh=false;}
  }
  catch(e){if(e instanceof AccountError&&e.code==='session')setSaveProfile('');else{try{const previous=localStorage.getItem('cc.lastAccount');if(previous&&/^g[a-f0-9]{23}$/.test(previous)){this.username=previous;setSaveProfile(previous);this.state=errorText('network');}}catch{setSaveProfile('');}}}
  if(result==='error')this.state=errorText('error');
  this.ready=true;this.app.reloadSpec();
  if(fresh)void this.flush();else this.schedule();
  if(pending||result==='error')this.show();
 }
 private accept(session:Session,restoreLocal=false){
  const local=readBundle(session.username),cloud=JSON.stringify(session.save??{}),metaKey='cc.account.meta:'+session.username;
  let meta:{revision:number;snapshot:string}|null=null;try{meta=JSON.parse(localStorage.getItem(metaKey)??'null');}catch{ /* No previous sync. */ }
  const keepLocal=restoreLocal&&meta?.revision===session.revision&&Object.keys(local).length>0&&JSON.stringify(local)!==meta.snapshot;
  if(session.save&&!keepLocal){
   if(Object.keys(local).length&&JSON.stringify(local)!==cloud)localStorage.setItem('cc.account.backup:'+session.username,JSON.stringify(local));
   applyBundle(session.username,session.save);
  }
  localStorage.setItem(metaKey,JSON.stringify({revision:session.revision,snapshot:cloud}));
  this.username=session.username;this.revision=session.revision;setSaveProfile(session.username);localStorage.setItem('cc.lastAccount',session.username);
  this.saved=cloud;this.conflict=false;this.clash=false;this.state=t('계정에 저장됐어요.','Saved to your account.');this.app.reloadSpec();
 }
 private schedule(){
  if(!this.ready||!this.username||this.conflict)return;
  clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.flush(),1800);
 }
 async flush():Promise<boolean>{
  clearTimeout(this.timer);if(!this.username)return true;if(this.conflict)return false;
  if(this.busy)return false;
  let snapshot:string;try{snapshot=JSON.stringify(readBundle());}catch{return false;}
  if(snapshot===this.saved)return true;
  this.busy=true;this.state=t('계정에 저장 중…','Saving to your account…');this.updateStatus();
  try{const session=await this.api('save',{revision:this.revision,save:JSON.parse(snapshot)});this.revision=session.revision;this.saved=snapshot;localStorage.setItem('cc.account.meta:'+this.username,JSON.stringify({revision:this.revision,snapshot}));this.state=t('계정에 저장됐어요.','Saved to your account.');return true;}
  catch(e){const code=e instanceof AccountError?e.code:'network',clash=code==='conflict';this.conflict=clash||code==='session';this.state=errorText(code);if(!this.conflict)this.timer=window.setTimeout(()=>void this.flush(),15000);if(clash!==this.clash){this.clash=clash;this.render();}return false;}
  finally{this.busy=false;this.updateStatus();if(!this.conflict&&JSON.stringify(readBundle())!==snapshot)this.schedule();}
 }
 private updateStatus(){const el=this.modal?.querySelector('.account-status');if(el)el.textContent=this.state;}
 private async leaveGame(){if(this.busy)throw new AccountError('saving');await this.app.go('title');}
 /** Full-page redirect to Google and back: popups and Google's script do not work on this cross-origin isolated page. */
 private async google(button:HTMLButtonElement){
  button.disabled=true;this.state=t('Google로 가는 중…','Opening Google…');this.updateStatus();
  try{
   await this.leaveGame();
   const target='/api/account/google/start?return='+encodeURIComponent(location.pathname+location.search);
   // Ask first, so a server without Google set up answers here instead of on a blank page.
   const r=await fetch(target,{redirect:'manual',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(r.type!=='opaqueredirect'){let code='network';try{code=(await r.json()).error??code;}catch{ /* Not JSON. */ }throw new AccountError(code);}
   try{localStorage.setItem(PENDING,String(Date.now()));}catch{ /* Without storage the sign-in still works, without the guest import. */ }
   location.href=target;
  }catch(e){this.state=errorText(e instanceof AccountError?e.code:'network');this.updateStatus();button.disabled=false;}
 }
 show(){
  if(this.open)return;this.open=true;window.dispatchEvent(new Event('blur'));
  const dialog=h('dialog',{class:'account-dialog',onclose:()=>{this.open=false;this.modal=null;dialog.remove();},onkeydown:(e:Event)=>e.stopPropagation()});this.modal=dialog;
  document.body.append(dialog);this.render();dialog.showModal();
 }
 private render(){
  const d=this.modal;if(!d)return;
  const close=h('button',{type:'button',class:'account-close','aria-label':t('닫기','Close'),onclick:()=>d.close()},'×');
  const status=h('p',{class:'account-status',role:'status','aria-live':'polite'},this.state);
  const title=h('h2',null,t('모험가의 항해 기록','Your adventure log'));
  if(this.username){
   const reload=h('button',{type:'button',class:'cc-btn ghost',onclick:()=>{void (async()=>{reload.disabled=true;try{await this.leaveGame();const session=await this.api('session');this.accept(session);this.render();}catch(e){this.state=errorText(e instanceof AccountError?e.code:'network');this.updateStatus();}finally{reload.disabled=false;}})();}},t('계정 저장 불러오기','Load account save'));
   const logout=h('button',{type:'button',class:'cc-btn ghost',onclick:()=>{void (async()=>{logout.disabled=true;try{await this.leaveGame();if(!await this.flush()){this.state+=' '+t('진행을 보관한 채 나가려면 아래 버튼을 눌러 주세요.','Use the button below to sign out and keep a local copy.');this.updateStatus();const force=h('button',{class:'cc-btn ghost',onclick:()=>void this.logout()},t('이 기기에 보관하고 로그아웃','Keep local copy and sign out'));d.append(force);return;}await this.logout();}catch{this.state=errorText('network');this.updateStatus();}finally{logout.disabled=false;}})();}},t('로그아웃','Sign out'));
   // Saving is automatic; loading the account save only resolves a conflict with another window.
   d.replaceChildren(close,title,h('p',{class:'account-name'},t('Google 계정으로 로그인됨','Signed in with Google')),h('p',null,t('캐릭터·레벨·퀘스트·월드 진행을 계정에 자동 저장해요.','Your character, level, quests and worlds save automatically.')),status,...(this.clash?[reload]:[]),logout);return;
  }
  const mark=h('span',{class:'account-google-mark'});mark.innerHTML=GOOGLE_MARK;
  const google=h('button',{type:'button',class:'account-google',onclick:()=>void this.google(google)},mark,h('span',null,t('Google로 로그인','Sign in with Google')));
  d.replaceChildren(close,title,h('p',null,t('Google 계정으로 로그인하면 다른 컴퓨터에서도 같은 모험을 이어 가요. 처음 로그인하면 이 기기의 게스트 모험이 계정에 저장돼요.','Sign in with Google to continue the same adventure on another computer. The first time, this device’s guest adventure is saved to your account.')),google,status,h('p',{class:'account-note'},t('Google 이름, 이메일, 사진은 저장하지 않아요.','Your Google name, email and photo are not stored.')),h('button',{type:'button',class:'account-guest',onclick:()=>d.close()},t('로그인 없이 계속하기','Continue without signing in')));
 }
 private async logout(){
  if(this.busy){this.state=t('저장이 끝나면 다시 눌러 주세요.','Please wait until saving finishes.');this.updateStatus();return;}
  try{await this.api('logout',{});setSaveProfile('');localStorage.removeItem('cc.lastAccount');this.username='';this.saved='';this.conflict=false;this.state=t('로그아웃했어요. 게스트 모험으로 돌아왔어요.','Signed out. Your guest adventure is ready.');this.app.reloadSpec();this.render();await this.app.go('title');}
  catch{this.state=errorText('network');this.updateStatus();}
 }
 get label(){return this.username?t('계정 · Google','Account · Google'):t('로그인','Sign in');}
}
