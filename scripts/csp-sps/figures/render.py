"""Render redrawn SVGs to PNG beside the original for side-by-side review.
  python3 scripts/csp-sps/figures/render.py <figdir> <origdir> <outdir> fig-1-2-1 ..."""
import sys, os, base64
from playwright.sync_api import sync_playwright
fdir, odir, out, *names = sys.argv[1:]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg = b.new_page(viewport={'width': 1560, 'height': 900}, device_scale_factor=1)
    for n in names:
        svg = open(f'{fdir}/{n}.svg').read()
        o = base64.b64encode(open(f'{odir}/{n}.png', 'rb').read()).decode()
        phone = f'{fdir}/{n}.phone.svg'
        ph = f'<div style="width:360px">{open(phone).read()}</div>' if os.path.exists(phone) else ''
        pg.set_content(f'<!doctype html><body style="margin:16px;font-family:Inter,sans-serif;display:flex;gap:24px;align-items:flex-start">'
                       f'<img src="data:image/png;base64,{o}" style="width:720px;border:1px solid #ddd"><div style="width:720px">{svg}</div>{ph}</body>')
        pg.screenshot(path=f'{out}/{n}.png', full_page=True)
        print(n)
    b.close()
