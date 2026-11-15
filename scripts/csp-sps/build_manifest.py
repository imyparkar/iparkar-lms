"""Build content/csp-sps/manifest.json from the iParkar CSP Exam Study Guide (Reader edition).

  python3 scripts/csp-sps/build_manifest.py <guide.txt> <out.json>

guide.txt is `pdftotext guide.pdf guide.txt` (form feed per PDF page). Chapter titles and
objective mappings come from the Guide outline (PDF pp. 4-6); page ranges from the chapter
headings found in the body ("Chapter X.Y — ..." near the top of a page).
"""
import json, re, sys

TXT, OUT = sys.argv[1], sys.argv[2]
pages = open(TXT, encoding='utf-8').read().split('\f')
if not pages[-1].strip():
    pages = pages[:-1]
P = lambda n: pages[n - 1]

DOMAINS = [
    (1, 'Advanced Application of Safety Principles', 25),
    (2, 'Program Management', 25),
    (3, 'Risk Management', 15),
    (4, 'Emergency Management', 9),
    (5, 'Environmental Management', 6),
    (6, 'Occupational Health and Applied Science', 10),
    (7, 'Training', 10),
]
EXPECTED = {1: 11, 2: 14, 3: 5, 4: 5, 5: 5, 6: 14, 7: 6}

# ---------------------------------------------------------------- outline (pp. 4-6)
outline = '\n'.join(P(n) for n in (4, 5, 6))
outline = re.sub(r'Imran Parkar, CSP.*?\n\n?\d+\n', '\n', outline)
outline = re.sub(r'iParkar Learning · CSP® exam study guide\n\nreader edition\n', '\n', outline)
flat = re.sub(r'\s+', ' ', outline)
entries = re.findall(r'Ch (\d+\.\d+) (.+?) \(Obj ([\d., and]+)\)( — pilot chapter, drafted below)?(?= \d+\. Ch | Part \d| Back matter)', flat)
outline_ch = {}
for cid, title, objs, pilot in entries:
    star = title.endswith('★')
    title = title.rstrip(' ★').strip()
    objectives = [o for o in re.findall(r'\d+\.\d+', objs)]
    outline_ch[cid] = {'title': title, 'objectives': objectives, 'primary_topic': star,
                       'outline_note': 'pilot chapter, drafted below' if pilot else None}

# ---------------------------------------------------------------- body headings
starts = []
for i, p in enumerate(pages):
    m = re.search(r'^Chapter (\d+\.\d+) — (.+)$', p, re.M)
    if m and p.find(m.group(0)) < 200:
        # heading may wrap onto the next line
        rest = p[m.end():].split('\n')
        head = m.group(2)
        for ln in rest[1:6]:
            if ln.strip() and not ln.startswith('Part '):
                head += ' ' + ln.strip()
            else:
                break
        sub = re.search(r'(Part \d · .+?)(?=\n\n|\nOpening scenario|\Z)', p[m.end():], re.S)
        starts.append((m.group(1), i + 1, head.replace('★', '').strip(), re.sub(r'\s+', ' ', sub.group(1)).strip() if sub else ''))

# Part front matter: from each Part divider ("P" page) up to the page before the Part's first chapter.
# The back-matter divider ("B / Reference") ends the last chapter.
NONCH = set()
first_start = {}
for cid, s, _, _ in starts:
    first_start.setdefault(int(cid.split('.')[0]), s)
for i, p in enumerate(pages):
    body = [l for l in p.split('\n') if l.strip()]
    if len(body) > 3 and body[2] == 'P' and re.match(r'Part (\d) · Domain', body[3]):
        d = int(re.match(r'Part (\d)', body[3]).group(1))
        NONCH.update(range(i + 1, first_start[d]))
    if len(body) > 3 and body[2] == 'B' and body[3] == 'Reference':
        NONCH.add(i + 1); BACK = i + 1

chapters = []
for k, (cid, s, head, sub) in enumerate(starts):
    e = (starts[k + 1][1] - 1) if k + 1 < len(starts) else None
    if e is None:
        e = BACK - 1
    while e in NONCH:
        e -= 1
    o = outline_ch[cid]
    body = '\n'.join(P(n) for n in range(s, e + 1))
    rel = re.search(r'Related chapters?[.:]?\s*(.+?)(?:\n\n|Works cited|Key formulas|$)', body, re.S)
    related = sorted(set(re.findall(r'Ch (\d+\.\d+)', rel.group(1))) - {cid}, key=lambda x: [int(v) for v in x.split('.')]) if rel else []
    verbs = re.findall(r'Obj (\d+\.\d+) \(([A-Za-z ,/]+)\)', sub)
    prim = re.search(r'Primary teaching location for (.+?)(?: · |$)', sub)
    builds = re.search(r'Builds on (.+?)(?:; leads into|$)', sub)
    leads = re.search(r'leads into (.+)$', sub)
    chs = lambda m: [x for x in re.findall(r'Ch (\d+\.\d+)(?:–(\d+\.\d+))?', m.group(1))] if m else []
    def expand(pairs):
        out = []
        for a, b in pairs:
            if b:
                d = a.split('.')[0]; out += [f'{d}.{n}' for n in range(int(a.split('.')[1]), int(b.split('.')[1]) + 1)]
            else:
                out.append(a)
        return out
    chapters.append({
        'id': cid, 'domain': int(cid.split('.')[0]), 'title': o['title'], 'heading_title': head,
        'objectives': o['objectives'], 'objective_verbs': {a: b for a, b in verbs},
        'primary_topic': o['primary_topic'],
        'primary_teaching_location': prim.group(1).strip() if prim else None,
        'outline_note': o['outline_note'],
        'cross_links': related, 'builds_on': expand(chs(builds)), 'leads_into': expand(chs(leads)),
        'subtitle': sub,
        'prerequisite': False, 'pages': [s, e],
    })

# ---------------------------------------------------------------- domain pages
def find(pat, lo=1, hi=len(pages)):
    return [n for n in range(lo, hi + 1) if re.search(pat, P(n), re.M)]

doms = []
for d, title, w in DOMAINS:
    chs = [c for c in chapters if c['domain'] == d]
    lo = chs[0]['pages'][0]
    pre = sorted(n for n in NONCH if n < lo and (not doms or n > doms[-1]['pages']['chapters'][1]))
    op = next(n for n in pre if re.search(r'^Domain opener$', P(n), re.M))
    divider = [n for n in pre if n < op]
    opener = [n for n in pre if n >= op]  # opener text and the Part's chapter-map figure
    doms.append({'domain': d, 'title': title, 'weight': w, 'chapter_count': len(chs),
                 'study_hours_150': w * 1.5, 'approx_items_of_200': w * 2,
                 'pages': {'divider': divider, 'opener_and_map': opener,
                           'chapters': [lo, chs[-1]['pages'][1]]}})

gloss = find(r'^Glossary\nTerm', BACK)[0]
bib = find(r'^Bibliography$', gloss)[0]

manifest = {
    'schema': 'iparkar.course-manifest/1',
    'course': {'code': 'CSP-SPS', 'title': 'CSP Self Paced Study Course', 'product': 'iParkar Learning',
               'version': '1.0.0-draft', 'completion_policy': 'all_required_chapters'},
    'source': {
        'title': 'iParkar CSP® Exam Study Guide — Reader edition',
        'file': 'iParkar CSP Exam Study Guide - Reader edition.pdf', 'author': 'Imran Parkar',
        'edition': 'Reader edition', 'edition_date': '2026-11-09', 'pdf_pages': len(pages),
        'outline_pages': [4, 6],
        'stated_blueprint': 'CSP11 V.2024.04.24',
        'blueprint_note': "The guide's stated alignment, matched against the supplied BCSP CSP11 Examination Blueprint V.2024.04.24 (47 objectives). Whether this is BCSP's current blueprint has not been verified for this course version.",
        'cover_claims': {'objectives': 47, 'chapters': 60, 'domains': 7, 'practice_questions': 591},
        'study_plan_note': "The guide's 150-hour plan weighted by exam share is an optional planning estimate, not a course requirement.",
        'back_matter': {'glossary': [gloss, bib - 1], 'bibliography': [bib, len(pages)]},
        'extraction': 'pdftotext + pdfplumber layout on the single 1,203-page Reader edition PDF. Page numbers are PDF page indices (they equal the printed folios).',
    },
    'domains': doms,
    'chapters': chapters,
}

# ---------------------------------------------------------------- validation
errs = []
ids = [c['id'] for c in chapters]
if len(ids) != 60 or len(set(ids)) != 60: errs.append(f'expected 60 unique chapters, got {len(ids)} / {len(set(ids))}')
for d, n in EXPECTED.items():
    got = sum(1 for c in chapters if c['domain'] == d)
    if got != n: errs.append(f'domain {d}: {got} chapters, expected {n}')
if set(outline_ch) != set(ids): errs.append(f'outline vs body mismatch: {set(outline_ch) ^ set(ids)}')
if sum(d['weight'] for d in doms) != 100: errs.append('weights do not sum to 100')
for a, b in zip(chapters, chapters[1:]):
    if a['pages'][1] >= b['pages'][0]: errs.append(f'overlap {a["id"]}/{b["id"]}')
manifest['validation'] = {'ok': not errs, 'errors': errs}
json.dump(manifest, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('OK' if not errs else errs, len(chapters), 'chapters')
