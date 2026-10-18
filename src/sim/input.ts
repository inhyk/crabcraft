import type { PlayerCommand, PlayerIntent } from './types.ts';
import { immutable } from './events.ts';
export type HeldInput = Omit<PlayerIntent,'seq'|'commands'>;
const NEUTRAL:HeldInput={forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null};
function validHeld(value:HeldInput):boolean {return !!value&&[value.forward,value.strafe,value.turn].every(n=>Number.isFinite(n)&&n>=-1&&n<=1)&&typeof value.sprint==='boolean'&&(value.steeringYaw===null||Number.isFinite(value.steeringYaw))&&[null,'recall','beacon','waystone','lighthouse-secret'].includes(value.heldChannel);}
export function validCommand(command:unknown):boolean {
  if(!command||typeof command!=='object')return false;
  const c=command as Record<string,unknown>,text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128;
  switch(c.kind){
    case 'ability':return [1,2,3,4,5].includes(c.slot as number);
    case 'talk':case 'target':{if(c.target===null)return c.kind==='target';if(!c.target||typeof c.target!=='object')return false;const r=c.target as Record<string,unknown>;return text(r.area)&&Number.isSafeInteger(r.id)&&Number(r.id)>0&&Number(r.id)<=0xffffffff&&Number.isSafeInteger(r.life)&&Number(r.life)>0&&Number(r.life)<=0xffffffff;}
    case 'jump':case 'dance':case 'cancel':case 'endingReplay':case 'talkEnd':return true;
    case 'endingControl':return Object.keys(c).length===3&&Object.keys(c).every(k=>['kind','id','action'].includes(k))&&text(c.id)&&new TextEncoder().encode(c.id as string).byteLength<=128&&['skip','continue'].includes(c.action as string);
    case 'village':return ['hide','tag','stop'].includes(c.mode as string);
    case 'boat':{const b=c.command as Record<string,unknown>;return !!b&&['call','board','leave','drive'].includes(b.action as string)&&[b.throttle,b.steer].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-1&&n<=1);}
    case 'channelStart':return ['recall','beacon','waystone','lighthouse-secret'].includes(c.channel as string)&&(c.targetId===undefined||text(c.targetId));
    case 'interact':return text(c.targetId);
    case 'questTrack':return text(c.questId);
    case 'questAccept':case 'questTurnIn':return text(c.questId)&&text(c.npcId);
    case 'forgeBuy':case 'forgeUpgrade':return text(c.npcId)&&(c.slot===undefined||c.slot==='weapon'||c.slot==='armor')&&(c.request===undefined||Number.isSafeInteger(c.request)&&Number(c.request)>0);
    case 'travel':return text(c.gateId);
    case 'bossChallenge':return ['rust','abyss','eclipse','dawn','frost','ember','sky'].includes(c.profile as string);
    default:return false;
  }
}

/** Boundary-owned accumulator: capture render input edges even when this frame has no sim tick. */
export class InputAccumulator {
  private held:HeldInput={...NEUTRAL};
  private commands:PlayerCommand[]=[];
  private sequence=1;
  private frameLimit:number;
  private pendingLimit:number;
  constructor(frameLimit=32,pendingLimit=128){if(!Number.isSafeInteger(frameLimit)||frameLimit<1||!Number.isSafeInteger(pendingLimit)||pendingLimit<frameLimit)throw new RangeError('Invalid input queue limits');this.frameLimit=frameLimit;this.pendingLimit=pendingLimit;}
  sampleHeld(held:HeldInput):void {if(!validHeld(held))throw new TypeError('Invalid held input');this.held=immutable(held);}
  push(...commands:PlayerCommand[]):void {if(this.commands.length+commands.length>this.pendingLimit)throw new RangeError('Pending command capacity exceeded');if(!commands.every(validCommand))throw new TypeError('Invalid player command');const owned=immutable(commands);this.commands.push(...owned);}
  next():PlayerIntent {if(!Number.isSafeInteger(this.sequence))throw new RangeError('Input sequence exhausted');const count=Math.min(this.frameLimit,this.commands.length);const frame=immutable({...this.held,seq:this.sequence,commands:this.commands.slice(0,count)});this.sequence++;this.commands.splice(0,count);return frame;}
  neutralize():void {this.held={...NEUTRAL};}
  clear():void {this.commands=[];this.neutralize();}
  debugState(){return immutable({held:this.held,commands:this.commands,nextSequence:this.sequence});}
}
