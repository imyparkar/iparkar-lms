import os
import json, sys, io, contextlib, collections
import convert
man = json.load(open(os.environ.get('LMS_ROOT', '.') + '/content/asp-sps/manifest.json'))
ids = [c['id'] for c in man['chapters'] if c['id'] != '1.1']
if len(sys.argv) > 1: ids = [i for i in ids if i.split('.')[0] in sys.argv[1].split(',')] if ',' in sys.argv[1] or len(sys.argv[1])==1 else sys.argv[1:]
summary = {}
for cid in ids:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            ch = convert.main(cid)
            summary[cid] = {'flags': ch['meta']['checks']['flags'], 'secs': len(ch['sections']),
                            'acts': sum(len(s['activities']) for s in ch['sections']),
                            'eqs': [b['label'] for s in ch['sections'] for b in s['blocks'] if b['type']=='equation'],
                            'minutes': ch['est_minutes'], 'equations': ch['_equations']}
        except Exception as e:
            summary[cid] = {'error': repr(e)}
import os
old = json.load(open(os.environ.get('ASP_SUMMARY', 'imports/asp-sps/authoring/summary.json'))) if os.path.exists(os.environ.get('ASP_SUMMARY', 'imports/asp-sps/authoring/summary.json')) else {}
old.update(summary)
json.dump(old, open(os.environ.get('ASP_SUMMARY', 'imports/asp-sps/authoring/summary.json'), 'w'), indent=1)
kinds = collections.Counter()
for cid, s in summary.items():
    if 'error' in s: print(cid, 'ERROR', s['error']); continue
    for f in s['flags']:
        k = f.split(':')[1].strip()[:30] if ':' in f else f[:30]
        kinds[k] += 1
print(kinds.most_common(20))
print('chapters', len(summary), 'errors', sum('error' in s for s in summary.values()))
