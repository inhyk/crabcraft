#!/usr/bin/env python3
"""Edit the actual game takes with restrained titles and an original synthesized score.

Requires numpy, Pillow, ffmpeg and ffprobe. No downloaded music or generated world imagery.
"""
import argparse
import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FPS = 24
RATE = 48000


def run(*args):
    subprocess.run([str(x) for x in args], check=True)


def score(path, duration):
    """A quiet D-minor / B-flat / F / C city theme, composed for this film."""
    audio = np.zeros((int(RATE * duration), 2), dtype=np.float64)

    def note(at, length, midi, amp, voice='pad', pan=0):
        start = int(at * RATE)
        count = min(int(length * RATE), len(audio) - start)
        if count <= 0:
            return
        t = np.arange(count) / RATE
        freq = 440 * 2 ** ((midi - 69) / 12)
        if voice == 'pad':
            attack = np.minimum(t / 1.8, 1)
            release = np.minimum((length - t) / 2.8, 1).clip(0, 1)
            env = np.sin(attack * np.pi / 2) ** 2 * np.sin(release * np.pi / 2) ** 2
            sound = sum(np.sin(2 * np.pi * freq * k * t + .004 * k * np.sin(t * 2.1)) / k ** 2 for k in range(1, 6))
            sound += .22 * np.sin(2 * np.pi * freq * 1.002 * t)
        elif voice == 'bell':
            env = (1 - np.exp(-t * 70)) * np.exp(-t * 1.15) * np.minimum((length - t) / .5, 1).clip(0, 1)
            sound = np.sin(2 * np.pi * freq * t) + .27 * np.sin(2 * np.pi * freq * 2.002 * t) * np.exp(-t * 3)
            sound += .08 * np.sin(2 * np.pi * freq * 3.99 * t) * np.exp(-t * 6)
        else:
            env = np.exp(-t * 8) * (1 - np.exp(-t * 100))
            sound = np.sin(2 * np.pi * (48 * t + 4 * (1 - np.exp(-t * 16))))
        sound *= env * amp
        audio[start:start + count, 0] += sound * math.sqrt((1 - pan) / 2)
        audio[start:start + count, 1] += sound * math.sqrt((1 + pan) / 2)

    chords = [[50, 57, 60, 64], [46, 53, 57, 60], [41, 53, 57, 60], [48, 55, 62, 64]]
    beat = .75  # 80 BPM; 128 beats = 96 s.
    for bar in range(16):
        at = bar * 6
        ch = chords[bar % 4] if bar < 15 else [50, 57, 62, 65]
        strength = .065 if at < 18 else .085 if at < 72 else .055
        for i, n in enumerate(ch):
            note(at, min(9, duration-at), n, strength, 'pad', (i-1.5)*.32)
        note(at, min(7, duration-at), ch[0]-12, strength*.65, 'pad')
        for k in range(8):
            if at < 18 and k % 2:
                continue
            if at >= 72 and k % 3:
                continue
            n = ch[[0, 2, 1, 3, 2, 1, 3, 2][k]] + 24
            note(at+k*beat, 3.6, n, .075 if at<72 else .055, 'bell', math.sin(k*1.7)*.6)
        if 18 <= at < 72:
            for k in [0, 4]:
                note(at+k*beat, 1, 36, .095, 'drum')
    # Original five-note theme; wide spaces let the scenery breathe.
    for at, n in [(4,74),(7,77),(10,81),(13,79),(16,77),(25,74),(28,77),(31,81),
                  (34,84),(37,81),(43,79),(46,77),(49,76),(52,74),(61,77),(64,81),
                  (67,86),(70,84),(77,81),(81,77),(85,74),(90,74)]:
        note(at, min(6,duration-at), n, .1, 'bell', -.13)
    # Soft diffuse reverb, no external samples. The delayed taps cross stereo channels.
    dry = audio.copy()
    for delay, gain in [(.19,.16),(.31,.13),(.47,.11),(.71,.09),(1.13,.07),(1.71,.045)]:
        n = int(delay * RATE)
        audio[n:] += dry[:-n, ::-1] * gain
    t = np.arange(len(audio)) / RATE
    audio *= np.minimum(t/2.5,1)[:,None] * np.minimum((duration-t)/5,1).clip(0,1)[:,None]
    audio *= .8 / max(np.max(np.abs(audio)), .001)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(2); out.setsampwidth(2); out.setframerate(RATE)
        out.writeframes((audio * 32767).astype('<i2').tobytes())


def stamp(seconds):
    cs = round(seconds * 100)
    return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'


def titles(path, shots, duration):
    header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Georgia,78,&H00F4F1E8,&H00FFFFFF,&H700C1420,&H70000000,0,0,0,0,100,100,8,0,1,1,2,1,70,70,150,1
Style: Korean,Arial Unicode MS,30,&H00F1EBDC,&H00FFFFFF,&H800C1420,&H80000000,0,0,0,0,100,100,1,0,1,1,1,1,74,74,98,1
Style: Small,Arial,18,&H00D7CDB5,&H00FFFFFF,&H700C1420,&H70000000,0,0,0,0,100,100,4,0,1,1,1,1,76,76,63,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    lines = [header]
    events = []

    def event(start, end, style, text):
        lines.append(f'Dialogue: 0,{stamp(start)},{stamp(end)},{style},,0,0,0,,{{\\fad(700,700)}}{text}\n')
        events.append((start, end, style, text))

    event(1.2, 7.5, 'Title', 'T I D E C R O W N')
    event(1.6, 7.5, 'Korean', '새벽에서 밤까지, 타이드크라운')
    event(1.8, 7.5, 'Small', 'WORLD OF CRABCRAFT')
    for s in shots[1:-1]:
        event(s['at']+.6, s['at']+4.5, 'Korean', s['label'])
        event(s['at']+.8, s['at']+4.5, 'Small', f'{s["light"].upper()}  /  {s["mode"]}')
    event(duration-6.7, duration-1.2, 'Title', 'T I D E C R O W N')
    event(duration-6.4, duration-1.2, 'Korean', '바다가 품은 왕관의 도시')
    event(duration-6.1, duration-1.2, 'Small', 'WORLD OF CRABCRAFT')
    path.write_text(''.join(lines))
    return events


def title_movie(path, events, duration):
    """Portable alpha titles even with an ffmpeg build lacking libass/drawtext."""
    fonts = Path('/System/Library/Fonts/Supplemental')
    styles = {
        'Title': (ImageFont.truetype(str(fonts/'Georgia.ttf'), 78), (70, 840), '#f4f1e8'),
        'Korean': (ImageFont.truetype(str(fonts/'Arial Unicode.ttf'), 30), (74, 952), '#f1ebdc'),
        'Small': (ImageFont.truetype(str(fonts/'Arial.ttf'), 18), (76, 1000), '#d7cdb5'),
    }
    layers=[]
    for start,end,style,text in events:
        font,pos,color=styles[style]
        box=font.getbbox(text)
        layer=Image.new('RGBA',(box[2]+12,box[3]-box[1]+12))
        d=ImageDraw.Draw(layer)
        d.text((5,5-box[1]),text,font=font,fill=color,stroke_width=2,stroke_fill=(9,17,27,155))
        layers.append((start,end,pos,layer))
    proc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s','1920x1080',
        '-r',str(FPS),'-i','-','-an','-c:v','qtrle',str(path)],stdin=subprocess.PIPE)
    try:
        for f in range(round(duration*FPS)):
            t=f/FPS
            frame=Image.new('RGBA',(1920,1080))
            for start,end,pos,base in layers:
                if start<=t<end:
                    fade=min(1,(t-start)/.7,(end-t)/.7)
                    layer=base.copy()
                    layer.putalpha(base.getchannel('A').point([round(i*fade) for i in range(256)]))
                    frame.alpha_composite(layer,pos)
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait():
            raise RuntimeError('Alpha title render failed')
    except BaseException:
        proc.kill();proc.wait();raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    work = args.work.resolve()
    program = json.loads(subprocess.check_output(['node','--input-type=module','-e',
        f'import {{shots,duration}} from {json.dumps((HERE/"program.mjs").as_uri())}; console.log(JSON.stringify({{shots,duration}}));']))
    shots, duration = program['shots'], program['duration']
    for s in shots:
        meta = json.loads((work/'shots'/f'{s["id"]}.json').read_text())
        assert meta['frames'] == round(s['length']*FPS), s['id']
        assert not meta['errors'] and not meta['blanks'], s['id']
    score(work/'original-score.wav', duration)
    events=titles(work/'titles.ass', shots, duration)
    title_movie(work/'title-overlay.mov',events,duration)
    concat = work/'takes.ffconcat'
    concat.write_text('ffconcat version 1.0\n'+''.join(f"file 'shots/{s['id']}.mp4'\n" for s in shots))
    run('ffmpeg','-v','warning','-y','-safe','0','-f','concat','-i',concat,'-i',work/'original-score.wav','-i',work/'title-overlay.mov',
        '-filter_complex',f'[0:v]scale=1920:1080:flags=lanczos,setsar=1[base];[base][2:v]overlay=0:0,fade=t=in:st=0:d=1.2,fade=t=out:st={duration-1.6}:d=1.6[v]',
        '-map','[v]','-map','1:a',
        '-af','loudnorm=I=-18:TP=-1.5:LRA=9','-c:v','libx264','-preset','slow','-crf','18',
        '-c:a','aac','-b:a','192k','-ar','48000','-pix_fmt','yuv420p','-movflags','+faststart',
        '-t',duration, work/'tidecrown-1080p.mp4')
    run('ffmpeg','-v','error','-y','-i',work/'tidecrown-1080p.mp4','-vf','scale=1280:720',
        '-c:v','libx264','-preset','fast','-crf','23','-c:a','copy','-movflags','+faststart',work/'tidecrown-720p.mp4')
    print(f'Wrote {duration}s / {round(duration*FPS)} frames at {FPS} fps')


if __name__ == '__main__':
    main()
