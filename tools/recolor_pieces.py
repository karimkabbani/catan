# Makes a new player colour's piece art (settlement, city, 3 road angles) by recolouring the red set.
# Usage, from the repo root: python3 tools/recolor_pieces.py . '#8e4cc9' purple   (needs Pillow)
# Only the red pixels change; outlines and shading stay. Used for purple and black (5-6 player seats).
import sys, glob, colorsys
from PIL import Image
W, hexc = sys.argv[1], sys.argv[2]
t = tuple(int(hexc[i:i+2],16)/255 for i in (1,3,5)); th, tl, ts = colorsys.rgb_to_hls(*t)
rh, rl, rs = colorsys.rgb_to_hls(0xcf/255, 0x3b/255, 0x34/255)
for f in glob.glob(W+'/prototype/assets/pieces/*-red.png'):
    im = Image.open(f).convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            if not a: continue
            h,l,s = colorsys.rgb_to_hls(r/255,g/255,b/255)
            # only recolour reddish pixels; keep neutral outlines/shadows
            red = s > 0.25 and (h < 0.08 or h > 0.92)
            if red:
                l2 = max(0, min(1, l + (tl - rl) * (0.6 + 0.4*l))); s2 = min(1, s * (ts / rs if rs else 1))
                rr,gg,bb = colorsys.hls_to_rgb(th, l2, s2)
            else:
                rr,gg,bb = r/255,g/255,b/255
            px[x,y] = (int(rr*255),int(gg*255),int(bb*255),a)
    im.save(f.replace('-red','-'+sys.argv[3]))
