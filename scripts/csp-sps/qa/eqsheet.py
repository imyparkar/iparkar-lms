"""Contact sheets: each equation's printed crop beside its KaTeX rendering (dev QA only)."""
import json, glob, os, sys, base64, io, logging
logging.disable(logging.WARNING)
import pdfplumber
from playwright.sync_api import sync_playwright
LMS = '/home/claude/iparkar-lms'; OUT = '/home/claude/work/qa/eq'
pdf = pdfplumber.open('/home/claude/work/guide.pdf')
ids = sys.argv[1:]
rows = []
for f in sorted(glob.glob(f'{LMS}/imports/csp-sps/chapters/*.json'), key=lambda p: [int(x) for x in os.path.basename(p)[:-5].split('.')]):
    p = json.load(open(f))
    if ids and p['id'] not in ids: continue
    tex = {b['label']: b['tex'] for s in p['sections'] for b in s['blocks'] if b['type'] == 'equation'}
    tex.update({st['_label']: st['tex'] for s in p['sections'] for b in s['blocks'] if b['type'] == 'worked_example' for st in b['steps'] if st.get('_label')})
    for s in p['sections']:
        for b in s['blocks']:
            if b['type'] == 'callout' and b.get('md'): pass
    for e in p['meta']['checks'].get('equation_sources', []):
        pg = pdf.pages[e['page'] - 1]
        im = pg.crop((45, max(40, e['top'] - 2), 560, min(800, e['bottom'] + 2))).to_image(resolution=110).original
        buf = io.BytesIO(); im.save(buf, 'PNG')
        rows.append((p['id'], e['label'], e['page'], e['mode'], base64.b64encode(buf.getvalue()).decode(), tex.get(e['label'], '')))
css = open(f'{LMS}/node_modules/katex/dist/katex.min.css').read()
fontdir = f'file://{LMS}/node_modules/katex/dist/'
css = css.replace('url(fonts/', f'url({fontdir}fonts/')
kjs = open(f'{LMS}/node_modules/katex/dist/katex.min.js').read()
per = int(os.environ.get('PER', 14))
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    for k in range(0, len(rows), per):
        chunk = rows[k:k + per]
        html = f"<!DOCTYPE html><html><head><meta charset=utf-8><style>{css} body{{font:12px sans-serif;margin:6px}} .r{{display:grid;grid-template-columns:110px 520px 640px;gap:8px;border-bottom:1px solid #ccc;padding:4px 0;align-items:center}} img{{max-width:520px}}</style></head><body>"
        for cid, lab, page, mode, img, t in chunk:
            html += f"<div class=r><div>{lab}<br>p{page} {mode}</div><img src='data:image/png;base64,{img}'><div class=k data-t='{base64.b64encode(t.encode()).decode()}'></div></div>"
        html += f"<script>{kjs}</script><script>document.querySelectorAll('.k').forEach(d=>{{try{{katex.render(new TextDecoder().decode(Uint8Array.from(atob(d.dataset.t),c=>c.charCodeAt(0))),d,{{displayMode:true,throwOnError:true,strict:'ignore'}})}}catch(e){{d.textContent='ERR '+e.message}}}})</script></body></html>"
        open('/tmp/eq.html', 'w').write(html)
        pg.goto('file:///tmp/eq.html'); pg.wait_for_timeout(250)
        pg.screenshot(path=f'{OUT}/sheet-{k // per:03d}.png', full_page=True)
    b.close()
print(len(rows), 'equations,', (len(rows) + per - 1) // per, 'sheets')
