"""Per-domain formula sheets, compiled from the chapters' transcribed equations.

The guide closes each part with a formula sheet listing every numbered equation
(Eq. d.c-n) with its symbols. Every one of those equations is already transcribed
and checked in its chapter (as an equation block, or a row of an "Eq." table), so
the sheet is assembled from those blocks, in chapter order, rather than re-extracted
from the sheet pages (whose stacked fractions do not survive text extraction).

Writes imports/<course>/resources.json for `npm run import:study`.
"""
import json, os, re, glob

ROOT = os.environ.get('LMS_ROOT', '.')
man = json.load(open(f'{ROOT}/content/asp-sps/manifest.json'))
CH = f'{ROOT}/imports/asp-sps/chapters'
EQ = re.compile(r'Eq\. (\d\.\d+-\d+[a-z]?)')

resources = []
for d in man['domains']:
    n = d['domain']; a, b = d['pages']['formula_sheet']
    blocks = [{'type': 'text', 'origin': 'editorial',
               'md': f"Every numbered equation from Part {n}, grouped by chapter, with its symbols and units. "
                     f"This sheet follows the guide's Part {n} formula sheet (guide pp. {a}–{b}); open a chapter to see each equation worked through."}]
    related = []; count = 0
    for c in [c for c in man['chapters'] if c['domain'] == n]:
        f = f"{CH}/{c['id']}.json"
        if not os.path.exists(f):
            continue
        found = []
        for s in json.load(open(f))['sections']:
            for blk in s['blocks']:
                if blk['type'] == 'equation' and EQ.search(blk.get('label', '')):
                    found.append({k: v for k, v in blk.items() if k not in ('pages',)})
                    count += len(EQ.findall(blk['label']))
                elif blk['type'] == 'table' and blk['columns'] and blk['columns'][0].strip().lower().rstrip('.') in ('eq', 'equation no', 'eq no'):
                    found.append({k: v for k, v in blk.items() if k not in ('pages',)})
                    count += len(blk['rows'])
        if found:
            blocks.append({'type': 'heading', 'text': f"Chapter {c['id']} · {c['title']}"})
            blocks += found
            related.append({'code': c['id'], 'title': c['title']})
    if related:
        blocks.append({'type': 'related', 'chapters': related})
    resources.append({'code': f'formulas-{n}', 'kind': 'formula_sheet', 'domain': n,
                      'title': f"Domain {n} formula sheet · {d['title']}", 'pages': [a, b], 'blocks': blocks,
                      'review_status': 'draft'})
    print(n, 'equations', count, 'blocks', len(blocks))

json.dump({'course': 'ASP-SPS', 'resources': resources}, open(f'{ROOT}/imports/asp-sps/resources.json', 'w'), ensure_ascii=False, indent=1)
