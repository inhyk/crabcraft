export type Language='ko'|'en';
let current:Language='ko';
try{current=localStorage.getItem('cc.language')==='en'?'en':'ko';}catch{ /* Test environments have no storage. */ }
export const language=()=>current;
export const t=(ko:string,en:string)=>current==='ko'?ko:en;
export function setLanguage(value:Language){current=value;try{localStorage.setItem('cc.language',value);}catch{ /* Keep the live preference if storage is unavailable. */ }if(typeof document!=='undefined')document.documentElement.lang=value;}
