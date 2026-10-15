import type {AudioManager} from '../core/audio';

/** Quiet, original synthesis: no additional downloads, global timers or shared music ownership. */
export class StarAmbience {
  private buffer:AudioBuffer|null=null;
  private nodes:AudioNode[]=[];
  private sources:AudioScheduledSourceNode[]=[];
  private voices=new Set<{source:OscillatorNode;gain:GainNode}>();
  private output:GainNode|null=null;
  private wind:GainNode|null=null;
  private water:GainNode|null=null;
  private windFilter:BiquadFilterNode|null=null;
  private waterPan:StereoPannerNode|null=null;
  private beat=0;
  private updateAt=0;

  constructor(private readonly audio:AudioManager){}

  start(time:number){
    if(this.output)return;
    const ctx=this.audio.ctx;
    if(!this.buffer){
      this.buffer=ctx.createBuffer(1,ctx.sampleRate*8,ctx.sampleRate);
      const data=this.buffer.getChannelData(0);let seed=53197;
      for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
    }
    this.output=this.audio.createEffectsGain();this.output.gain.value=0;this.nodes.push(this.output);
    this.wind=ctx.createGain();this.wind.gain.value=.045;
    this.water=ctx.createGain();this.water.gain.value=0;
    this.windFilter=ctx.createBiquadFilter();this.windFilter.type='bandpass';this.windFilter.frequency.value=480;this.windFilter.Q.value=.5;
    const waterFilter=ctx.createBiquadFilter();waterFilter.type='bandpass';waterFilter.frequency.value=1600;waterFilter.Q.value=.65;
    this.waterPan=ctx.createStereoPanner();
    this.nodes.push(this.wind,this.water,this.windFilter,waterFilter,this.waterPan);
    for(const [filter,gain,offset] of [[this.windFilter,this.wind,0],[waterFilter,this.water,3.1]] as const){
      const source=ctx.createBufferSource();source.buffer=this.buffer;source.loop=true;
      source.connect(filter).connect(gain);
      if(gain===this.water)gain.connect(this.waterPan).connect(this.output);else gain.connect(this.output);
      source.start(ctx.currentTime,offset);this.sources.push(source);this.nodes.push(source);
    }
    this.beat=Math.floor(time/8);
    this.updateAt=0;
  }

  update(time:number,region:string,x:number,z:number,cameraRightX:number,cameraRightZ:number,quiet:boolean){
    if(!this.output||!this.wind||!this.water||!this.windFilter||!this.waterPan)return;
    const ctx=this.audio.ctx,now=ctx.currentTime;
    if(now<this.updateAt)return;
    this.updateAt=now+.1;
    this.output.gain.setTargetAtTime(quiet?.12:.55,now,.35);
    this.wind.gain.setTargetAtTime(.035+(Math.sin(time*.19)+1)*.012,now,.8);
    this.windFilter.frequency.setTargetAtTime(region==='Moonshade Crystalwood'?720:region==='The Fallen Star Ruins'?380:480,now,1);
    const distance=Math.hypot(x,z-55),water=Math.max(0,1-distance/18);
    this.water.gain.setTargetAtTime(water*water*.11,now,.4);
    this.waterPan.pan.setTargetAtTime(Math.max(-.8,Math.min(.8,(-x*cameraRightX+(55-z)*cameraRightZ)/12)),now,.25);
    const beat=Math.floor(time/8);
    if(beat!==this.beat){
      this.beat=beat;
      const notes=region==='Moonshade Crystalwood'?[659.25,987.77,1318.51]:region==='The Fallen Star Ruins'?[523.25,783.99,1046.5]:region==='The Pilgrim’s Starroad'?[587.33,880,1174.66]:null;
      if(!quiet&&notes)this.chime(notes[((beat%3)+3)%3]);
    }
  }

  private chime(frequency:number){
    const ctx=this.audio.ctx,now=ctx.currentTime;
    for(const [multiple,volume] of [[1,.018],[2.003,.003]] as const){
      const source=ctx.createOscillator(),gain=ctx.createGain();source.type='sine';source.frequency.value=frequency*multiple;
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume,now+.035);gain.gain.exponentialRampToValueAtTime(.00001,now+3.2);
      source.connect(gain).connect(this.output!);
      const voice={source,gain};this.voices.add(voice);
      source.onended=()=>{source.disconnect();gain.disconnect();this.voices.delete(voice);};
      source.start(now);source.stop(now+3.25);
    }
  }

  stop(){
    if(this.output)this.output.gain.value=0;
    for(const voice of this.voices){voice.source.onended=null;voice.source.stop();voice.source.disconnect();voice.gain.disconnect();}
    this.voices.clear();
    for(const source of this.sources)source.stop();
    for(const node of this.nodes)node.disconnect();
    this.sources=[];this.nodes=[];this.output=this.wind=this.water=null;this.windFilter=null;this.waterPan=null;
  }

  dispose(){this.stop();this.buffer=null;}
}
