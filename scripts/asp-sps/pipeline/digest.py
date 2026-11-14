import os
import json, sys
man = json.load(open(os.environ.get('LMS_ROOT', '.') + '/content/asp-sps/manifest.json'))
for cid in sys.argv[1:]:
    ch = json.load(open(f'{os.environ.get("LMS_ROOT", ".")}/imports/asp-sps/chapters/{cid}.json'))
    m = next(c for c in man['chapters'] if c['id'] == cid)
    print(f"\n### {cid} {m['title']} | obj {m['objectives']}")
    secs = ch['sections']
    print('sections:', ' | '.join(s['code'] for s in secs))
    for s in secs:
        for b in s['blocks']:
            if b['type'] == 'summary': print('SUM:', ' • '.join(b['items'])[:900])
            if b['type'] == 'callout' and b.get('title') == 'Common errors': print('ERR:', ' • '.join(b['items'])[:500])
            if b['type'] == 'glossary': print('TERMS:', '; '.join(t['term'] for t in b['terms'])[:300])
            if b['type'] == 'worked_example': print('WE:', b['label'], b['title'], '→', b['answer'][:160])
