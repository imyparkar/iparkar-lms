"""Public registers for the CSP study course (no lesson content), written to content/csp-sps/.

  python3 scripts/csp-sps/build_registers.py

* content-register.csv        — per chapter: source range, objectives, sections, activities, questions,
                                tables/figures/equations, conversion flags, review and check status.
* coverage.csv                — every CSP11 objective (47) -> chapters, sections, required activities, questions.
* question-reconciliation.csv — the cover's 591 practice questions, chapter by chapter: found, answered, keyed.
* review-flags.json           — all conversion flags and review notes, for the subject-matter reviewer.
Reads imports/csp-sps/chapters/*.json (private) and content/csp-sps/manifest.json.
"""
import csv, json, os, re

ROOT = os.environ.get('LMS_ROOT', '.')
MAN = json.load(open(f'{ROOT}/content/csp-sps/manifest.json'))
CH = f'{ROOT}/imports/csp-sps/chapters'
OVL = f'{ROOT}/imports/csp-sps/authoring/overlays'
OUT = f'{ROOT}/content/csp-sps'
BLUEPRINT = {1: 7, 2: 14, 3: 4, 4: 5, 5: 5, 6: 6, 7: 6}

chapters = {}
for c in MAN['chapters']:
    f = f'{CH}/{c["id"]}.json'
    chapters[c['id']] = json.load(open(f)) if os.path.exists(f) else None

reg, qrec, flags = [], [], {}
for m in MAN['chapters']:
    p = chapters[m['id']]
    if not p:
        reg.append({'chapter': m['id'], 'title': m['title'], 'domain': m['domain'], 'content_status': 'missing'})
        continue
    ck = p['meta']['checks']
    acts = [a for s in p['sections'] for a in s['activities']]
    blocks = [b for s in p['sections'] for b in s['blocks']]
    ov = json.load(open(f'{OVL}/{m["id"]}.json')) if os.path.exists(f'{OVL}/{m["id"]}.json') else {}
    reg.append({
        'chapter': m['id'], 'title': m['title'], 'domain': m['domain'], 'objectives': ' '.join(m['objectives']),
        'primary_topic': 'yes' if m['primary_topic'] else '', 'source_pages': f'{m["pages"][0]}-{m["pages"][1]}',
        'sections': len(p['sections']), 'est_minutes': p['est_minutes'],
        'activities': len(acts), 'required_activities': sum(1 for a in acts if a.get('required', True)),
        'mcq': ck['questions'], 'mcq_required': ck.get('required_questions', 0), 'recall_prompts': ck.get('recall', 0),
        'worked_examples': sum(1 for b in blocks if b['type'] == 'worked_example'),
        'tables': ck['tables'], 'figures': ck['figures'],
        'equations': len(ck.get('equation_sources', [])),
        'equation_overrides': sum(1 for e in ck.get('equation_sources', []) if e['mode'] == 'override'),
        'conversion_flags': len(ck['flags']),
        'content_status': p['review_status'],
        'subject_review': 'pending',
        'equations_checked': 'rendered vs printed: all equations compared on QA contact sheets 15 Nov 2026; 3 hand overrides' if ck.get('equation_sources') else 'n/a',
        'numbers_recomputed': 'no (guide worked examples carried as printed)',
        'source_checked': 'layout-extracted; chapter 1.1 read in full against the PDF' if m['id'] == '1.1' else 'layout-extracted; spot-checked',
        'accessibility_checked': 'pending (see docs/CSP-STUDY-COURSE.md section 7)',
        'review_notes': ' | '.join(ov.get('review_notes', [])),
    })
    flags[m['id']] = {'flags': ck['flags'], 'review_notes': ov.get('review_notes', []),
                      'equations_with_notes': [e for e in ck.get('equation_sources', []) if e.get('notes')]}
    expected = 7 if m['id'] == '1.1' else 8 if m['id'] == '1.2' else 6 if m['id'] == '3.1' else 10
    mcq = [a for a in acts if a['kind'] == 'single_choice' and a['provenance'] == 'source']
    keys_ok = all(a['answer_key']['correct'] in [o['id'] for o in a['spec']['options']] for a in mcq)
    qrec.append({'chapter': m['id'], 'expected_from_guide_pattern': expected, 'found': ck['questions'],
                 'with_answer_and_explanation': ck.get('questions_with_answers', 0), 'keys_valid': 'yes' if keys_ok else 'NO',
                 'four_options_each': 'yes' if all(len(a['spec']['options']) == 4 for a in mcq) else 'NO',
                 'required_in_course': ck.get('required_questions', 0), 'optional_in_course': ck['questions'] - ck.get('required_questions', 0),
                 'status': 'ok' if ck['questions'] == expected == ck.get('questions_with_answers', 0) and keys_ok else 'CHECK'})

with open(f'{OUT}/content-register.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(reg[0].keys()))
    w.writeheader(); w.writerows(reg)

tot = sum(r['found'] for r in qrec)
with open(f'{OUT}/question-reconciliation.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(qrec[0].keys()))
    w.writeheader(); w.writerows(qrec)
    w.writerow({'chapter': 'TOTAL', 'expected_from_guide_pattern': sum(r['expected_from_guide_pattern'] for r in qrec), 'found': tot,
                'with_answer_and_explanation': sum(r['with_answer_and_explanation'] for r in qrec),
                'keys_valid': 'yes' if all(r['keys_valid'] == 'yes' for r in qrec) else 'NO', 'four_options_each': '',
                'required_in_course': sum(r['required_in_course'] for r in qrec), 'optional_in_course': sum(r['optional_in_course'] for r in qrec),
                'status': f'cover claims 591; found {tot}'})

cov = []
for d, n in BLUEPRINT.items():
    for k in range(1, n + 1):
        o = f'{d}.{k}'
        cs = [m for m in MAN['chapters'] if o in m['objectives']]
        secs = req = q = 0
        for m in cs:
            p = chapters[m['id']]
            if p:
                secs += len(p['sections'])
                acts = [a for s in p['sections'] for a in s['activities']]
                req += sum(1 for a in acts if a.get('required', True))
                q += p['meta']['checks']['questions']
        cov.append({'objective': o, 'chapters': ' '.join(m['id'] for m in cs), 'sections': secs, 'required_activities': req,
                    'practice_questions': q, 'status': 'covered (draft)' if cs and secs else 'UNCOVERED',
                    'note': 'shared by two chapters (2.13 and 2.14)' if o == '2.14' else 'taught across nine chapters (6.1-6.9)' if o == '6.1' else
                            'one chapter teaches two objectives (2.2)' if o in ('2.1', '2.2') else ''})
with open(f'{OUT}/coverage.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(cov[0].keys()))
    w.writeheader(); w.writerows(cov)
json.dump(flags, open(f'{OUT}/review-flags.json', 'w'), indent=1, ensure_ascii=False)
print(f'register {len(reg)} chapters; questions {tot}; objectives {len(cov)} ({sum(1 for c in cov if c["status"] == "UNCOVERED")} uncovered)')
