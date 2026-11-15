import json, sys, os
os.environ.setdefault('CSP_GUIDE_PDF','/home/claude/work/guide.pdf'); os.environ.setdefault('CSP_GUIDE_TEXT','/home/claude/work/guide.txt')
from extract import chapter_lines
R={c['id']:c['pages'] for c in json.load(open(os.environ.get('CSP_MANIFEST','content/csp-sps/manifest.json')))['chapters']}
ids=sys.argv[1:] or list(R)
for cid in ids:
    out=f'/home/claude/work/cache2/{cid}.json'
    if os.path.exists(out): continue
    s,e=R[cid]
    items=chapter_lines(s,e)
    for it in items: it.pop('words',None)
    json.dump(items,open(out,'w'))
    print(cid,len(items),flush=True)
