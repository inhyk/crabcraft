"""Original deterministic 16-bar world themes. Needs numpy and ffmpeg; no downloaded samples.
Run: python3 tools/art/world_music.py
The compositions and synthesized recordings are provided under Apache-2.0.
"""
from pathlib import Path
import json, subprocess
import numpy as np

OUT=Path(__file__).resolve().parents[2]/'public/audio'
SR=32000

def compose(world,mood):
    rng=np.random.default_rng(world*100+['explore','combat','boss'].index(mood))
    bpm=({'explore':76,'combat':112,'boss':124} if world==2 else {'explore':92,'combat':118,'boss':132})[mood]
    beat=60/bpm; length=64*beat; n=round(SR*length); mix=np.zeros((n,2),np.float64)
    root=57 if world==2 else 62
    minor=world==2 or mood=='boss'
    scale=[0,2,3,5,7,8,10] if minor else [0,2,4,5,7,9,11]
    chords=[0,5,3,4] if world==2 else [0,4,5,3]
    motif=([0,4,2,1,4,6,5,2] if world==2 else [0,2,4,6,5,4,2,1])
    def degree(d):return root+scale[d%7]+12*(d//7)
    def add(signal,start,amp,pan=0):
        signal=np.asarray(signal)*amp
        stereo=signal[:,None]*np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)])
        pos=round(start*SR)%n; take=min(len(signal),n-pos);mix[pos:pos+take]+=stereo[:take]
        if take<len(signal):mix[:len(signal)-take]+=stereo[take:]
    def note(midi,start,dur,amp,kind='bell',pan=0):
        t=np.arange(round((dur+.6)*SR))/SR;f=440*2**((midi-69)/12)
        env=np.minimum(1,t/.035)*np.exp(-np.maximum(0,t-dur)/.18)
        if kind=='pad':
            sound=(np.sin(2*np.pi*f*t)+.35*np.sin(2*np.pi*(f*1.002)*t)+.15*np.sin(4*np.pi*f*t))*env*np.minimum(1,t/.3)
        elif kind=='bass':sound=(np.sin(2*np.pi*f*t)+.22*np.sin(4*np.pi*f*t))*env*np.exp(-t*1.8)
        elif kind=='horn':sound=(np.sin(2*np.pi*f*t)+.32*np.sin(4*np.pi*f*t)+.12*np.sin(6*np.pi*f*t))*env
        else:sound=(np.sin(2*np.pi*f*t+np.sin(2*np.pi*f*2*t)*np.exp(-t*5)*1.7)+.22*np.sin(2*np.pi*f*3*t))*env*np.exp(-t*2.8)
        add(sound,start,amp,pan)
    for bar in range(16):
        chord=chords[bar%4];start=bar*4*beat
        for j in [0,2,4]:note(degree(chord+j),start,beat*3.7,.045,'pad',-.3+j*.15)
        for b in range(4):note(degree(chord)-24,start+b*beat,beat*.7,.12,'bass')
        for k in range(8):
            d=chord+[0,2,4,2,0,4,2,4][k]
            note(degree(d)+12,start+k*beat/2,beat*.48,.048 if mood=='explore' else .065,'bell',(-1 if k%2 else 1)*.45)
        for k in range(4):
            if mood=='explore' and (bar+k)%5==0:continue
            d=motif[(bar*2+k)%8]+(0 if bar%8<4 else 1)
            note(degree(d)+12,start+k*beat,beat*.77,.072 if mood=='explore' else .07,'bell' if world==2 else 'horn',.12)
        if mood!='explore':
            for b in range(4):
                t=np.arange(round(.35*SR))/SR
                kick=np.sin(2*np.pi*(48*t+26*.04*(1-np.exp(-t/.04))))*np.exp(-t*15)
                add(kick,start+b*beat,.17 if mood=='boss' else .13)
                if b%2:
                    noise=rng.normal(0,1,len(t));noise=np.r_[0,np.diff(noise)]*.25
                    add(noise*np.exp(-t*28),start+b*beat,.07,-.12)
            for b in range(8):
                t=np.arange(round(.09*SR))/SR;noise=rng.normal(0,1,len(t));add(noise*np.exp(-t*65),start+b*beat/2,.022,.5)
    # Circular stereo echoes preserve tails across the loop boundary.
    mix+=np.roll(mix,round(beat*.75*SR),axis=0)[:,::-1]*.18
    mix+=np.roll(mix,round(beat*1.5*SR),axis=0)*.08
    mix=np.tanh(mix*1.2);mix*=.72/max(.001,np.max(np.abs(mix)))
    raw=mix.astype('<f4').tobytes();name=f'music-world{world}-{mood}'
    for ext,codec in [('ogg',['-c:a','libvorbis','-q:a','4']),('mp3',['-c:a','libmp3lame','-b:a','128k'])]:
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-af','loudnorm=I=-20:TP=-2:LRA=8',*codec,str(OUT/f'{name}.{ext}')],input=raw,check=True)
    print(name,round(length,2),'seconds')
    return {'id':name,'files':[name+'.ogg',name+'.mp3'],'loop':True,'volume':.85,'credit':'Original composition and synthesis for Crabcraft','license':'Apache-2.0','source':'tools/art/world_music.py'}

if __name__=='__main__':
    index=json.loads((OUT/'index.json').read_text());new=[compose(w,m) for w in [2,3] for m in ['explore','combat','boss']]
    ids={e['id'] for e in new};index=[e for e in index if e['id'] not in ids]+new
    (OUT/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
