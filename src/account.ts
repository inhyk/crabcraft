import type {App} from './app';
import {h} from './ui/dom';
import {t} from './i18n';
import {applyBundle,readBundle,setSaveProfile} from './accountStorage';
import './account.css';

type Session={username:string;revision:number;save?:Record<string,string>;updated:number};
class AccountError extends Error{constructor(readonly code:string){super(code);}}
const errorText=(code:string)=>({
 saving:t('저장이 끝나면 다시 눌러 주세요.','Please wait until saving finishes.'),
 credentials:t('아이디 또는 비밀번호를 확인해 주세요.','Check your username and password.'),
 taken:t('이미 사용 중인 아이디예요.','That username is already taken.'),
 username:t('아이디는 영문·숫자·밑줄로 3~24자예요.','Use 3–24 letters, numbers or underscores.'),
 password:t('비밀번호는 10~128자로 만들어 주세요.','Use a password with 10–128 characters.'),
 rate:t('시도가 너무 많아요. 잠시 뒤 다시 해주세요.','Too many attempts. Please try again later.'),
 conflict:t('다른 창에서 저장했어요. 계정 저장을 불러온 뒤 계속해 주세요. 이 기기의 진행은 보관했어요.','Another window saved first. Load the account save to continue. Your local progress is kept.'),
 session:t('로그인이 만료됐어요. 다시 로그인해 주세요.','Your login expired. Please sign in again.'),
}[code]??t('연결하지 못했어요. 이 기기의 진행은 저장되어 있어요. 다시 시도해 주세요.','Could not connect. Your local progress is safe. Please try again.'));
export class Account {
 username='';revision=0;open=false;
 private modal:HTMLDialogElement|null=null;
 private state='';private conflict=false;private busy=false;private timer=0;private ready=false;private saved='';
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
  try{const session=await this.api('session');this.accept(session,true);}
  catch(e){if(e instanceof AccountError&&e.code==='session')setSaveProfile('');else{try{const previous=localStorage.getItem('cc.lastAccount');if(previous&&/^[a-z0-9_]{3,24}$/.test(previous)){this.username=previous;setSaveProfile(previous);this.state=errorText('network');}}catch{setSaveProfile('');}}}
  this.ready=true;this.app.reloadSpec();this.schedule();
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
  this.saved=cloud;this.conflict=false;this.state=t('계정에 저장됐어요.','Saved to your account.');this.app.reloadSpec();
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
  catch(e){const code=e instanceof AccountError?e.code:'network';this.conflict=code==='conflict'||code==='session';this.state=errorText(code);if(!this.conflict)this.timer=window.setTimeout(()=>void this.flush(),15000);return false;}
  finally{this.busy=false;this.updateStatus();if(!this.conflict&&JSON.stringify(readBundle())!==snapshot)this.schedule();}
 }
 private updateStatus(){const el=this.modal?.querySelector('.account-status');if(el)el.textContent=this.state;}
 private async leaveGame(){if(this.busy)throw new AccountError('saving');await this.app.go('title');}
 show(){
  if(this.open)return;this.open=true;window.dispatchEvent(new Event('blur'));
  const dialog=h('dialog',{class:'account-dialog',onclose:()=>{this.open=false;this.modal=null;dialog.remove();},onkeydown:(e:Event)=>e.stopPropagation()});this.modal=dialog;
  document.body.append(dialog);this.render();dialog.showModal();
 }
 private render(signup=false){
  const d=this.modal;if(!d)return;
  const close=h('button',{type:'button',class:'account-close','aria-label':t('닫기','Close'),onclick:()=>d.close()},'×');
  const status=h('p',{class:'account-status',role:'status','aria-live':'polite'},this.state);
  const title=h('h2',null,t('모험가의 항해 기록','Your adventure log'));
  if(this.username){
   const save=h('button',{type:'button',class:'cc-btn',onclick:()=>{void this.flush();}},t('지금 저장','Save now'));
   const reload=h('button',{type:'button',class:'cc-btn ghost',onclick:()=>{void (async()=>{reload.disabled=true;try{await this.leaveGame();const session=await this.api('session');this.accept(session);this.render();}catch(e){this.state=errorText(e instanceof AccountError?e.code:'network');this.updateStatus();}finally{reload.disabled=false;}})();}},t('계정 저장 불러오기','Load account save'));
   const logout=h('button',{type:'button',class:'cc-btn ghost',onclick:()=>{void (async()=>{logout.disabled=true;try{await this.leaveGame();if(!await this.flush()){this.state+=' '+t('진행을 보관한 채 나가려면 아래 버튼을 눌러 주세요.','Use the button below to sign out and keep a local copy.');this.updateStatus();const force=h('button',{class:'cc-btn ghost',onclick:()=>void this.logout()},t('이 기기에 보관하고 로그아웃','Keep local copy and sign out'));d.append(force);return;}await this.logout();}catch{this.state=errorText('network');this.updateStatus();}finally{logout.disabled=false;}})();}},t('로그아웃','Sign out'));
   d.replaceChildren(close,title,h('p',{class:'account-name'},this.username),h('p',null,t('캐릭터·레벨·퀘스트·월드 진행을 계정에 자동 저장해요.','Your character, level, quests and worlds save automatically.')),status,save,reload,logout);return;
  }
  const username=h('input',{name:'username',autocomplete:'username',required:true,minlength:3,maxlength:24,pattern:'[A-Za-z0-9_]{3,24}',spellcheck:false,autocapitalize:'none'});
  const password=h('input',{name:'password',type:'password',autocomplete:signup?'new-password':'current-password',required:true,minlength:10,maxlength:128});
  const confirm=h('input',{name:'confirm',type:'password',autocomplete:'new-password',required:true,minlength:10,maxlength:128});
  const label=(text:string,input:HTMLInputElement)=>h('label',null,h('span',null,text),input);
  const submit=h('button',{type:'submit',class:'cc-btn'},signup?t('가입하고 현재 모험 저장','Sign up and save this adventure'):t('로그인','Sign in'));
  const form=h('form',{onsubmit:(event:Event)=>{event.preventDefault();void(async()=>{
   if(signup&&password.value!==confirm.value){this.state=t('비밀번호가 서로 달라요.','The passwords do not match.');this.updateStatus();return;}
   submit.disabled=true;this.state=t('연결 중…','Connecting…');this.updateStatus();
   try{await this.leaveGame();const initial=signup?readBundle(''):undefined;const session=await this.api(signup?'signup':'login',{username:username.value,password:password.value,...(signup?{save:initial}:{})});password.value=confirm.value='';this.accept(session);this.render();await this.app.go('title');}
   catch(e){this.state=errorText(e instanceof AccountError?e.code:'network');this.updateStatus();}finally{submit.disabled=false;}
  })();}},label(t('아이디 · 영문/숫자/밑줄 3~24자','Username · 3–24 letters/numbers/_'),username),label(t('비밀번호 · 10자 이상','Password · at least 10 characters'),password),signup?label(t('비밀번호 확인','Confirm password'),confirm):null,submit);
  d.replaceChildren(close,title,h('p',null,signup?t('이 기기의 게스트 모험으로 가입해요. 아이디와 비밀번호를 기억해 주세요.','Sign up with this device’s guest adventure. Remember your username and password.'):t('다른 컴퓨터에서도 같은 모험을 계속하세요.','Continue the same adventure on another computer.')),form,status,h('button',{type:'button',class:'cc-btn ghost',onclick:()=>{this.state='';this.render(!signup);}},signup?t('이미 계정이 있어요 · 로그인','Already registered? Sign in'):t('처음이에요 · 회원가입','New here? Create an account')),h('button',{type:'button',class:'account-guest',onclick:()=>d.close()},t('로그인 없이 계속하기','Continue without signing in')));
 }
 private async logout(){
  if(this.busy){this.state=t('저장이 끝나면 다시 눌러 주세요.','Please wait until saving finishes.');this.updateStatus();return;}
  try{await this.api('logout',{});setSaveProfile('');localStorage.removeItem('cc.lastAccount');this.username='';this.saved='';this.conflict=false;this.state=t('로그아웃했어요. 게스트 모험으로 돌아왔어요.','Signed out. Your guest adventure is ready.');this.app.reloadSpec();this.render();await this.app.go('title');}
  catch{this.state=errorText('network');this.updateStatus();}
 }
 get label(){return this.username?t(`계정 · ${this.username}`,`Account · ${this.username}`):t('로그인 / 회원가입','Sign in / Sign up');}
}
