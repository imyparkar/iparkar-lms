# Usage: python3 scripts/asp-sps/build_manifest.py guide.txt pagemap.json content/asp-sps/manifest.json
import re, json, bisect, sys
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
pm = json.load(open(sys.argv[2]))
starts, pgs = pm['starts'], pm['pg']
def page_of(i):
    k = bisect.bisect_right(starts, i) - 1
    return pgs[k]

# ---- index (pages 2-6)
a = next(i for i,l in enumerate(lines) if l.startswith('Objective Chapter Title Part'))
b = next(i for i,l in enumerate(lines) if i > a and l == '1' and lines[i-1].startswith('iParkar Learning'))
buf = []
for l in lines[a:b-1]:
    if l.startswith(('iParkar Learning', 'Edition 1.0', 'Objective Chapter Title Part')) or not l.strip(): continue
    buf.append(l.strip())
text = ' '.join(buf)
rx = re.compile(r'((?:\d\.\d+[a-z]?)(?:, \d\.\d+[a-z]?)*|prerequisite) Ch (\d)\.(\d+) (.+?) Part (\d)(?= |$)')
rows = rx.findall(text)
DOMAINS = [(1,'Mathematical calculations',10,17),(2,'Safety programs and concepts',25,24),(3,'Ergonomics',8,7),
 (4,'Fire prevention and protection',12,12),(5,'Emergency preparedness and response',10,6),
 (6,'Industrial hygiene and occupational health',12,11),(7,'Environmental management',7,8),
 (8,'Training, education, and communication',11,7),(9,'Legal',5,7)]
chapters = []
for objs, d, n, title, part in rows:
    assert d == part, (d, part, title)
    prereq = title.endswith(' (prerequisite)')
    title = title.replace(' (prerequisite)', '')
    chapters.append({'id': f'{d}.{n}', 'domain': int(d), 'number': int(n), 'title': title,
                     'objectives': [] if objs == 'prerequisite' else [o.strip() for o in objs.split(',')],
                     'prerequisite': prereq})
# ---- cover lines -> start pages
cov = {}
for i,l in enumerate(lines):
    m = re.search(r'(?:^|· )chapter (\d\.\d+)$', l)
    if m: cov[m.group(1)] = i
# part markers
part_div = {}; closing = {}; formula = {}; gloss = {}
for i,l in enumerate(lines):
    m = re.match(r'^part (\d) · \d+% of the ASP11 exam$', l)
    if m: part_div[int(m.group(1))] = i
    m = re.match(r'^part (\d) formula sheet$', l)
    if m: formula[int(m.group(1))] = page_of(i)
    m = re.match(r'^part (\d) glossary$', l)
    if m: gloss[int(m.group(1))] = page_of(i)
gaps = [150-1, 425, 520, 672, 755, 888, 1016, 1145, 1262]  # closing divider pages (no running header), verified
gaps = [149] + gaps[1:]
for c in chapters:
    c['_line'] = cov[c['id']]
    c['pages'] = [page_of(cov[c['id']])]
order = {c['id']: k for k,c in enumerate(chapters)}
for k,c in enumerate(chapters):
    nxt = chapters[k+1] if k+1 < len(chapters) and chapters[k+1]['domain'] == c['domain'] else None
    if nxt: end = nxt['pages'][0] - 1
    else: end = gaps[c['domain']-1] - 1
    c['pages'].append(end)
    # cover metadata + objective statement
    seg = lines[c['_line']-60:c['_line']]
    seg2 = '\n'.join(lines[c['_line']:c['_line']+80])
    flat = re.sub(r'\x02\s*', '\u00ad', seg2.replace('\n', ' ')).replace('\u00ad', '')
    m = re.search(r'This chapter teaches (ASP11 .+?\(BCSP 2024\))', flat)
    c['objective_statement'] = re.sub(r'\s+', ' ', m.group(1)) if m else None
    lo = re.search(r'After this chapter you will be able to:(.*?)(?:\n[a-z][a-z ,&-]+\n|\niParkar Learning)', seg2, re.S)
    outs = []
    if lo:
        cur = None
        for l in lo.group(1).strip().split('\n'):
            mm = re.match(r'^(\d+)\. (.*)', l)
            if mm: outs.append(mm.group(2)); 
            elif outs: outs[-1] += ' ' + l.strip()
    del c['_line']
# Parts
parts = []
for d,title,w,n in DOMAINS:
    chs = [c for c in chapters if c['domain']==d]
    nextdiv = page_of(part_div[d+1]) if d < 9 else 1269
    parts.append({'domain': d, 'title': title, 'weight': w, 'chapter_count': n,
      'pages': {'divider': page_of(part_div[d]), 'contents': [page_of(part_div[d])+1, chs[0]['pages'][0]-1],
                'chapters': [chs[0]['pages'][0], chs[-1]['pages'][1]],
                'closing_divider': gaps[d-1], 'formula_sheet': [formula[d], gloss[d]-1], 'glossary': [gloss[d], nextdiv-1]}})
# objectives coverage
allobj = {}
for c in chapters:
    for o in c['objectives']: allobj.setdefault(o, []).append(c['id'])
manifest = {
  'schema': 'iparkar.course-manifest/1',
  'course': {'code': 'ASP-SPS', 'title': 'ASP Self Paced Study Course', 'product': 'iParkar Learning',
             'version': '1.0.0-draft', 'completion_policy': 'all_required_chapters'},
  'source': {'title': 'iParkar ASP® Exam Study Guide', 'file': 'iParkar-ASP-Exam-Study-Guide.pdf', 'edition': '1.0',
             'edition_date': '2026-11', 'pdf_pages': 1268, 'index_pages': [2, 6],
             'stated_blueprint': 'ASP11 V.2024.04.24',
             'blueprint_note': "The guide's stated alignment. Current BCSP blueprint not yet verified for this course version.",
             'extraction': 'Text extracted from the project PDF (two halves: pp. 1-634 and 635-1268). Page numbers read from running footers; covers and closing dividers inferred from neighbours.'},
  'domains': parts,
  'chapters': chapters,
  'objective_counts': {'mapped_codes_including_lettered': len(allobj), 'top_level_objectives': len({re.sub(r'[a-z]$','',o) for o in allobj})},
  'review_flags': [
    {'chapter': '1.2', 'note': 'Prerequisite chapter; no blueprint objective by design (retained as required).'},
    {'objective': '2.3', 'note': 'Mapped to two chapters (2.3 and 2.4) in the guide index; intentional split.'},
    {'objective': '6.4a', 'note': 'Mapped to three chapters (6.4, 6.5, 6.6) in the guide index; intentional split by agent type.'},
  ],
  'objective_index': [{'objective': o, 'chapters': v} for o,v in sorted(allobj.items(), key=lambda kv: [int(x) if x.isdigit() else x for x in re.findall(r'\d+|[a-z]', kv[0])])],
}
json.dump(manifest, open(sys.argv[3],'w'), ensure_ascii=False, indent=1)
print(len(chapters), [sum(1 for c in chapters if c['domain']==d) for d in range(1,10)], len(allobj))
print([o for o,v in allobj.items() if len(v)>1])
print([c['id'] for c in chapters if not c['objective_statement']])
for c in chapters[:3]+chapters[40:42]: print(c)
for p in parts[:2]: print(p)
