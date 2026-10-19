# Tile JPG stills into a labelled grid: python3 tools/cinema/stills-sheet.py out.jpg <cols> <tile width> <glob>...
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
out, cols, W = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fs = []
for pat in sys.argv[4:]: fs += sorted(glob.glob(pat))
ims = [Image.open(f).convert('RGB') for f in fs]
H = int(W * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * H), 'black')
d = ImageDraw.Draw(sheet)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 18)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * W, (i // cols) * H
    sheet.paste(im.resize((W, H)), (x, y))
    lab = os.path.basename(f).rsplit('.', 1)[0]
    d.rectangle([x, y, x + 9 * len(lab) + 10, y + 22], fill='black')
    d.text((x + 4, y + 1), lab, fill='yellow', font=font)
sheet.save(out, quality=85)
print(out, sheet.size, len(ims))
