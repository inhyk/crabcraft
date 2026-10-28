# Flower area in a World VI field view: share of ground pixels (rows below the horizon band, 47%..100% of the
# frame) whose colour is one of the drift blossoms (pink, lilac, butter, white) rather than grass, soil or the crab.
# Usage: python3 tools/sky-flower-share.py <png>...   (prints one line per file: share %, and per colour)
import sys
import numpy as np
from PIL import Image
for path in sys.argv[1:]:
    a=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h=a.shape[0];g=a[int(h*.47):]
    r,gg,b=g[...,0],g[...,1],g[...,2];mx=g.max(-1);mn=g.min(-1);d=mx-mn+1e-6
    L=.2126*r+.7152*gg+.0722*b;sat=d/(mx+1e-6)
    hue=np.where(mx==r,((gg-b)/d)%6,np.where(mx==gg,(b-r)/d+2,(r-gg)/d+4))*60
    pink=((hue>=300)|(hue<20))&(sat>.12)&(L>105)
    lilac=(hue>=225)&(hue<300)&(sat>.09)&(L>105)
    butter=(hue>=35)&(hue<62)&(sat>.24)&(L>150)
    white=(sat<.13)&(L>188)
    n=g.shape[0]*g.shape[1];parts={k:float(v.sum())/n*100 for k,v in dict(pink=pink,lilac=lilac,butter=butter,white=white).items()}
    tot=float((pink|lilac|butter|white).sum())/n*100
    print(f"{path} flower {tot:.1f}% "+' '.join(f"{k} {v:.1f}" for k,v in parts.items()))
