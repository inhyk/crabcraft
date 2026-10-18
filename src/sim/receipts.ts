import type {CharacterId, DurableLedgerBinding, EntityRef, GrantReadToken} from './types.ts';
import {immutable, sameRef} from './events.ts';

export function durableRevision(value:unknown):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Invalid durable revision');
  return value;
}
function matches(a:DurableLedgerBinding,b:DurableLedgerBinding):boolean {
  return sameRef(a.actor,b.actor)&&a.character===b.character&&a.ownerGeneration===b.ownerGeneration&&a.ledgerGeneration===b.ledgerGeneration&&a.durableRevision===b.durableRevision;
}
/** Active owners and one pending read each. Persisted receipt history stays in the host ledger. */
export class DurableReceipts {
  private owners=new Map<CharacterId,DurableLedgerBinding>();
  private reads=new Map<CharacterId,GrantReadToken>();
  private serial=0;
  private next():number {if(this.serial===Number.MAX_SAFE_INTEGER)throw new Error('Ledger generation exhausted');return ++this.serial;}
  prepare(actor:EntityRef,character:CharacterId,revision:unknown):DurableLedgerBinding {
    const r=durableRevision(revision),generation=this.next();
    return immutable({actor,character,ownerGeneration:generation,ledgerGeneration:generation,durableRevision:r});
  }
  activate(binding:DurableLedgerBinding):void {this.owners.set(binding.character,binding);this.reads.delete(binding.character);}
  current(ref:EntityRef,character:CharacterId):DurableLedgerBinding {
    const current=this.owners.get(character);if(!current||!sameRef(current.actor,ref))throw new Error('Stale ledger owner');return current;
  }
  bind(ref:EntityRef,character:CharacterId,revision:number):void {
    durableRevision(revision);const old=this.owners.get(character);
    if(old){if(!sameRef(old.actor,ref)||old.durableRevision!==revision)throw new Error('Ledger already bound');return;}
    this.activate(this.prepare(ref,character,revision));
  }
  begin(ref:EntityRef,character:CharacterId,revision:number):GrantReadToken {
    const current=this.current(ref,character);if(durableRevision(revision)!==current.durableRevision)throw new Error('Stale ledger revision');
    const token=immutable({...current,area:ref.area,nonce:this.next()});this.reads.set(character,token);return token;
  }
  consume(token:GrantReadToken):DurableLedgerBinding {
    const pending=this.reads.get(token.character);
    if(!pending||pending.nonce!==token.nonce||pending.area!==token.area||!matches(pending,token))throw new Error('Stale grant read');
    this.reads.delete(token.character);
    const current=this.current(token.actor,token.character);if(!matches(current,token))throw new Error('Stale grant read');return current;
  }
  cancel(token:GrantReadToken):void {
    const pending=this.reads.get(token.character);if(pending&&pending.nonce===token.nonce&&pending.area===token.area&&matches(pending,token))this.reads.delete(token.character);
  }
  invalidate(ref:EntityRef,character:CharacterId):void {
    const old=this.current(ref,character),generation=this.next();
    this.activate(immutable({...old,ownerGeneration:generation,ledgerGeneration:generation}));
  }
  prepareMark(capture:DurableLedgerBinding,revision:number):DurableLedgerBinding {
    const current=this.current(capture.actor,capture.character);if(!matches(current,capture))throw new Error('Stale checkpoint ledger capture');
    if(durableRevision(revision)<current.durableRevision)throw new Error('Stale ledger revision');
    return immutable({...current,ledgerGeneration:this.next(),durableRevision:revision});
  }
  hasRead(character:CharacterId):boolean {return this.reads.has(character);}
  remove(character:CharacterId):void {this.owners.delete(character);this.reads.delete(character);}
  clear():void {this.owners.clear();this.reads.clear();}
  usage(){return{ledgerOwners:this.owners.size,replayTokens:this.reads.size};}
  debug(){return immutable({owners:[...this.owners.values()],reads:[...this.reads.values()],nextGeneration:this.serial+1});}
}
