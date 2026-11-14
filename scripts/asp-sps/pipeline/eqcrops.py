import os
import json, sys, logging
logging.disable(30)
import pdfplumber
from PIL import Image, ImageDraw
pdf = pdfplumber.open(os.environ.get('ASP_GUIDE_PDF', 'guide.pdf'))
s = json.load(open('summary.json'))
items = []
for cid, v in s.items():
    for e in v['equations']:
        items.append((cid, e))
dom = sys.argv[1]
items = [x for x in items if x[0].split('.')[0] == dom]
seen = set()
crops = []
for cid, e in items:
    key = (e['label'], e['page'], round(e['top']))
    if key in seen: continue
    seen.add(key)
    p = pdf.pages[e['page'] - 1]
    top = max(50, e['top'] - 75); bot = min(800, e['top'] + 45)
    im = p.crop((45, top, 550, bot)).to_image(resolution=100).original.convert('RGB')
    crops.append((e['label'], im))
    p.flush_cache()
for k in range(0, len(crops), 6):
    group = crops[k:k + 6]
    W = max(im.width for _, im in group); H = sum(im.height + 22 for _, im in group)
    sheet = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(sheet); y = 0
    for lab, im in group:
        d.text((4, y + 4), lab, fill=(200, 0, 0)); y += 22; sheet.paste(im, (0, y)); y += im.height
    sheet.save(f'eqimg/d{dom}-{k // 6:02d}.png')
print(dom, len(crops))
