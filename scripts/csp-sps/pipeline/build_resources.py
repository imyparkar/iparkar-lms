"""Course-wide resources for the CSP study course -> imports/csp-sps/resources.json (git-ignored).

  python3 build_resources.py

* glossary      — the guide's global glossary (PDF pp. 1117-1177): term, definition, chapter.
* bibliography  — the guide's bibliography (pp. 1178-1203), one entry per item.
* formulas-1…7  — per-domain formula sheets. The Reader edition has no standalone formula
                  sheets, so these are an editorial compilation of each chapter's display
                  equations (core teaching only, not worked examples) and its "Key formulas"
                  list, labelled as such, linking back to the chapter.

Run after convert.py (formula sheets read the converted chapters).
"""
import json, os, re

ROOT = os.environ.get('LMS_ROOT', '.')
MAN = json.load(open(f'{ROOT}/content/csp-sps/manifest.json'))
CH = os.environ.get('CSP_OUT', f'{ROOT}/imports/csp-sps/chapters')
CACHE = os.environ.get('CSP_CACHE')
OUT = f'{ROOT}/imports/csp-sps/resources.json'


def lines_for(p0, p1, name):
    if CACHE and os.path.exists(f'{CACHE}/{name}.json'):
        return json.load(open(f'{CACHE}/{name}.json'))
    from extract import chapter_lines
    it = chapter_lines(p0, p1)
    for x in it:
        x.pop('words', None)
    return it


def clean(s):
    s = re.sub(r'\s+', ' ', s.replace('\x02', '')).strip()
    s = re.sub(r'\*\* \*\*', ' ', s)
    s = re.sub(r'(?<!\*)\* \*(?!\*)', ' ', s)
    return s


def glossary():
    g0, g1 = MAN['source']['back_matter']['glossary']
    items = lines_for(g0, g1, '_glossary')
    rows = [r for t in items if t['kind'] == 'table' for r in t['rows']]
    terms, seen = [], set()
    for r in rows:
        if len(r) < 2 or not r[0].strip() or r[0].strip() == 'Term':
            continue
        term = re.sub(r'\*+', '', clean(r[0]))
        chap = clean(r[2]) if len(r) > 2 else ''
        definition = clean(r[1]) + (f' *(Ch {chap})*' if chap else '')
        key = (term.lower(), definition.lower())
        if key in seen:
            continue
        seen.add(key)
        terms.append({'term': term, 'definition': definition, '_chapter': chap})
    blocks = [{'type': 'text', 'origin': 'editorial', 'md': f'The guide\'s glossary: {len(terms)} terms, each with the chapter that teaches it. Use your browser\'s find (Ctrl/Cmd + F) to jump to a term.'}]
    by = {}
    for t in terms:
        L = t['term'][:1].upper()
        by.setdefault(L if L.isalpha() else '#', []).append(t)
    for L in sorted(by):
        blocks.append({'type': 'heading', 'text': L, 'level': 2})
        blocks.append({'type': 'glossary', 'origin': 'source', 'pages': [g0, g1],
                       'terms': [{'term': t['term'], 'definition': t['definition']} for t in by[L]]})
    return {'code': 'glossary', 'kind': 'glossary', 'domain': None, 'title': 'Glossary', 'pages': [g0, g1], 'blocks': blocks,
            'review_status': 'draft', '_count': len(terms)}


def bibliography():
    b0, b1 = MAN['source']['back_matter']['bibliography']
    items = [x for x in lines_for(b0, b1, '_bib') if x['kind'] == 'line' and x['size'] < 12]
    entries, cur, prev = [], [], None
    for x in items:
        if x['text'].startswith('This list covers every work cited'):
            continue
        new = prev is None or x['page'] != prev['page'] and x['top'] < 80 and re.match(r'^[A-Z][^ ]*', x['text']) and \
            re.search(r'[.)]\s*$|Accessed .*\.$', cur[-1] if cur else '') or (x['page'] == prev['page'] and x['top'] - prev['top'] > 19)
        if new and cur:
            entries.append(cur); cur = []
        cur.append(x['text'])
        prev = x
    if cur:
        entries.append(cur)
    out = []
    for e in entries:
        s = ''
        for t in e:
            t = t.strip()
            if not s:
                s = t
            elif re.search(r'(https?://|doi\.org/|www\.)\S*$', s) and not s.endswith(('.', ',')) or s.endswith('-') and re.search(r'https?://\S*-$', s):
                s += t  # a URL broken across lines
            else:
                s += ' ' + t
        out.append(clean(s))
    blocks = [{'type': 'text', 'origin': 'editorial', 'md': f'Every work cited in the guide ({len(out)} entries), in alphabetical order. Cited works remain the property of their publishers; links do not grant permission to copy them.'},
              {'type': 'references', 'origin': 'source', 'pages': [b0, b1], 'items': out}]
    return {'code': 'bibliography', 'kind': 'bibliography', 'domain': None, 'title': 'Bibliography', 'pages': [b0, b1], 'blocks': blocks,
            'review_status': 'draft', '_count': len(out)}


def formula_sheets():
    res = []
    for d in MAN['domains']:
        n = d['domain']
        blocks = [{'type': 'callout', 'variant': 'editorial', 'origin': 'editorial', 'title': 'Compiled for this course',
                   'md': 'The Reader edition has no separate formula sheet for this domain. This page collects, chapter by chapter, the display equations from the core teaching and each chapter\'s own *Key formulas* list, so you can revise them in one place. Worked-example arithmetic is left in the chapters. Check every equation against its chapter.'}]
        count = 0
        for m in [c for c in MAN['chapters'] if c['domain'] == n]:
            f = f'{CH}/{m["id"]}.json'
            if not os.path.exists(f):
                continue
            p = json.load(open(f))
            eqs, keyf = [], None
            for s in p['sections']:
                if s['title'] in ('Worked application', 'Exam practice'):
                    continue
                for b in s['blocks']:
                    if b['type'] == 'equation':
                        eqs.append(b)
                    if b['type'] == 'callout' and b.get('title') == 'Key formulas':
                        keyf = b
            if not eqs and not keyf:
                continue
            blocks.append({'type': 'heading', 'text': f'Chapter {m["id"]} — {m["title"]}', 'level': 2})
            for e in eqs:
                blocks.append({k: v for k, v in e.items()})
                count += 1
            if keyf:
                blocks.append({k: v for k, v in keyf.items()})
            blocks.append({'type': 'related', 'origin': 'editorial', 'chapters': [{'code': m['id'], 'title': m['title']}]})
        if count or len(blocks) > 1:
            res.append({'code': f'formulas-{n}', 'kind': 'formula_sheet', 'domain': n, 'title': f'Domain {n} formula sheet',
                        'pages': list(d['pages']['chapters']), 'blocks': blocks, 'review_status': 'draft', '_count': count})
    return res


if __name__ == '__main__':
    rs = [glossary(), bibliography()] + formula_sheets()
    summary = {r['code']: r.pop('_count') for r in rs}
    for r in rs:
        for b in r['blocks']:
            if b['type'] == 'glossary':
                for t in b['terms']:
                    t.pop('_chapter', None)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'resources': rs}, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print(summary)
