"""Convert one guide chapter (PDF pages) into an LMS chapter package.

  python3 convert.py <chapter-id> [--show]

Reads the manifest for the page range, runs the layout extractor, assembles
blocks, sections and activities, merges the hand-written overlay
(overlays/<id>.json: equation TeX, knowledge check, fixes) and writes
imports/asp-sps/chapters/<id>.json (relative to LMS_ROOT).
"""
import json, re, sys, os, math
from extract import chapter_lines, PDF

ROOT = os.environ.get('LMS_ROOT', '.')
MAN = json.load(open(f'{ROOT}/content/asp-sps/manifest.json'))
OVL = os.environ.get('ASP_OVERLAYS', 'imports/asp-sps/authoring/overlays')

BODY = 10.5
END_HEADS = {'summary', 'common errors', 'related chapters', 'key terms', 'chapter sources'}
CALLOUT_VARIANT = {'Source note': 'source_note', 'Source disagreement': 'source_note', 'Common error': 'common_error',
                   'Exam tip': 'exam_tip'}


def clean(s):
    s = s.replace('\x02', '').replace('­', '')
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\\\((.*?)\\\)', lambda m: '\\(' + m.group(1).replace('½', '\\tfrac{1}{2}') + '\\)', s)
    return s


def join_lines(lines):
    """Join wrapped lines; hyphen at line end is resolved by the extractor vocabulary."""
    from extract import dehyphen
    out = ''
    for t in lines:
        t = t.strip()
        if not out:
            out = t
        elif out.endswith('-') and t[:1].islower():
            out = dehyphen(out + ' ' + t)
        else:
            out += ' ' + t
    return clean(out)


def is_body(it):
    return it['kind'] == 'line' and abs(it['size'] - BODY) < 0.3 and it['x0'] < 75 and not it['bar']


def cap(s):
    return s[:1].upper() + s[1:]


class Chapter:
    def __init__(self, cid):
        self.cid = cid
        self.m = next(c for c in MAN['chapters'] if c['id'] == cid)
        self.p0, self.p1 = self.m['pages']
        self.items = [i for i in chapter_lines(self.p0 + 1, self.p1)]  # skip cover page
        self.blocks = []  # (page, block)
        self.flags = []
        self.tryits = []
        self.scenario = None
        self.equations = []

    # ------------------------------------------------------------------
    def emit(self, page, block):
        block.setdefault('origin', 'source') if block['type'] not in ('heading', 'activity') else None
        if block.get('origin') == 'source':
            block['pages'] = [page, page]
        self.blocks.append(block)

    def run(self):
        it = self.items
        i = 0
        para, para_page, para_prev = [], None, None
        lst, lst_ordered, lst_page = [], False, None
        visual = []
        pending_caption = None

        def flush_para():
            nonlocal para, para_page
            if para:
                self.emit(para_page, {'type': 'text', 'md': join_lines(para)})
            para, para_page = [], None

        def flush_list():
            nonlocal lst, lst_page
            if lst:
                self.emit(lst_page, {'type': 'list', 'ordered': lst_ordered, 'items': [join_lines(x) for x in lst]})
            lst, lst_page = [], None

        def flush_all():
            flush_para(); flush_list()

        def flush_visual():
            nonlocal visual
            if not visual:
                return
            texts = [v['text'] for v in visual]
            # a figure whose caption sat beside the drawing
            fi = next((k for k, t in enumerate(texts) if re.match(r'^Figure \d+\.\d+-\d+ ', t)), None)
            ai = next((k for k, t in enumerate(texts) if t.startswith('Alt text:')), None)
            if fi is not None or ai is not None:
                capl = texts[fi:ai] if fi is not None else []
                alt = []
                rest_lines = []
                if ai is not None:
                    a0 = visual[ai]
                    alt = [a0['text'][len('Alt text:'):]]
                    prev_v = a0
                    for v in visual[ai + 1:]:
                        if abs(v['size'] - a0['size']) < 0.3 and v['page'] == prev_v['page'] and v['top'] - prev_v['top'] < 18 and not rest_lines:
                            alt.append(v['text']); prev_v = v
                        else:
                            rest_lines.append(v)
                caption = join_lines(capl) if capl else ''
                m = re.match(r'^(Figure \d+\.\d+-\d+)(?: ·)? (.*)$', caption)
                if m or alt:
                    lab = m.group(1) if m else 'Figure'
                    cap_tops = [v['top'] for v in visual if v['x0'] < 60 and (re.match(r'^Figure \d', v['text']) or v['text'].startswith('Alt text:'))]
                    bottom = (min(cap_tops) if cap_tops else max(v.get('bottom', v['top'] + 10) for v in visual))
                    first = self.items.index(visual[0]) if visual[0] in self.items else None
                    self.emit(visual[0]['page'], {'type': 'figure', 'label': lab, 'caption': (m.group(2) if m else 'Original drawing.'),
                                                  'description': join_lines(alt) or (m.group(2) if m else ''),
                                                  '_crop': self.region(first, visual[0]['page'], bottom, set(id(v) for v in visual))})
                    visual = [v for v in rest_lines]
                    if visual:
                        flush_visual()
                    return
            readable = [v for v in visual if 8.9 <= v['size'] <= 11.6 and len(v['text']) > 25]
            prev = next((b for b in reversed(self.blocks) if b['type'] != 'activity'), None)
            small_notes = [v for v in visual if 7.9 <= v['size'] <= 9.6 and len(v['text']) > 12]
            if prev is not None and prev['type'] == 'equation' and small_notes and len(small_notes) >= len(visual) * 0.5:
                prev['note'] = clean((prev.get('note', '') + ' ' + join_lines([v['text'] for v in small_notes])))
            elif readable:
                self.emit(visual[0]['page'], {'type': 'text', 'md': join_lines([v['text'] for v in readable])})
                if len(readable) < len(visual):
                    self.flags.append(f"p{visual[0]['page']}: kept {len(readable)} readable lines of a visual, dropped {len(visual) - len(readable)} labels")
            else:
                txt = ' / '.join(texts)
                if len(txt) > 3:
                    self.flags.append(f"p{visual[0]['page']}: uncaptioned visual dropped: {txt[:160]}")
            visual = []

        while i < len(it):
            x = it[i]
            # ---------------- tables
            if x['kind'] == 'table':
                flush_all()
                if not x['rows'] and len([h for h in x['header'] if h]) == 1:
                    # a titled box ("Going deeper · ..."): its body is indented text below
                    j = i + 1; body = []
                    while j < len(it) and it[j]['kind'] == 'line' and 60 <= it[j]['x0'] <= 72 and abs(it[j]['size'] - BODY) < 0.3:
                        body.append(it[j]); j += 1
                    if body:
                        paras, cur = [], []
                        for k, b in enumerate(body):
                            if cur and b['top'] - body[k-1]['top'] > 20 and b['page'] == body[k-1]['page']:
                                paras.append(cur); cur = []
                            cur.append(b['text'])
                        paras.append(cur)
                        self.emit(x['page'], {'type': 'callout', 'variant': 'source_note', 'title': [h for h in x['header'] if h][0],
                                              'md': '\n\n'.join(join_lines(p) for p in paras)})
                        i = j
                        continue
                if not x['rows'] or not any(x['header']):
                    self.flags.append(f"p{x['page']}: table fragment with no rows dropped: {x['header']}")
                    i += 1
                    continue
                prev = self.blocks[-1] if self.blocks else None
                if pending_caption is None and prev and prev['type'] == 'table' and prev['columns'] == x['header']:
                    prev['rows'] += x['rows']; prev['pages'][1] = x['page']
                else:
                    cap_text = pending_caption or ('Table: ' + ', '.join(h for h in x['header'] if h)[:80])
                    if not pending_caption:
                        self.flags.append(f"p{x['page']}: table without caption (named from its header)")
                    self.emit(x['page'], {'type': 'table', 'caption': cap_text, 'columns': x['header'], 'rows': x['rows']})
                pending_caption = None
                # notes directly under the table (s9.0 at x51)
                j = i + 1; note = []
                while j < len(it) and it[j]['kind'] == 'line' and abs(it[j]['size'] - 9.0) < 0.3 and it[j]['x0'] < 60 and not re.match(r'(Table|Figure) \d', it[j]['text']):
                    note.append(it[j]['text']); j += 1
                if note:
                    tb = self.blocks[-1]
                    tb['note'] = clean((tb.get('note', '') + ' ' + join_lines(note)))
                i = j
                continue

            t = x['text']
            # ---------------- worked examples
            if re.match(r'^Worked (example|application) \d+\.\d+-\d+', t):
                flush_all(); flush_visual()
                i = self.worked(i)
                continue
            # ---------------- callouts: a small title line at x≈75, body indented at x≈65 (some also have an orange bar)
            TITLES = ('Try it', 'Exam tip', 'Source note', 'Common error', 'Illustrative scenario', 'Source disagreement')
            nxt = it[i + 1] if i + 1 < len(it) else None
            generic = (abs(x['size'] - 8.5) < 0.4 and 72 <= x['x0'] <= 80 and nxt is not None and nxt['kind'] == 'line'
                       and 60 <= nxt.get('x0', 0) <= 70 and not re.match(r'^(Worked|Table|Figure|Answer)', t))
            if (t in TITLES and abs(x['size'] - 8.5) < 0.4) or x['bar'] is not None or generic:
                flush_all(); flush_visual()
                grp = [x]; i += 1
                while i < len(it) and it[i]['kind'] == 'line':
                    y = it[i]
                    if abs(y['size'] - 8.5) < 0.4 and 72 <= y['x0'] <= 80:
                        break
                    if not (60 <= y['x0'] <= 80 or (y['bar'] is not None and y['x0'] > 55)) or y['size'] >= 12:
                        break
                    if re.match(r'^Worked (example|application) \d', y['text']):
                        break
                    grp.append(y); i += 1
                self.callout(grp)
                continue
            # ---------------- headings
            if x['size'] >= 19:
                flush_all(); flush_visual()
                if any(clean(t).lower().startswith(h) for h in END_HEADS):
                    i = self.endmatter(i)
                    continue
                self.blocks.append({'type': 'heading', 'text': cap(clean(t)), 'level': 2, '_page': x['page']})
                i += 1; continue
            if 12.5 <= x['size'] <= 14 and x['x0'] < 60 and not visual and re.match(r'^[a-z]', t):
                flush_all(); flush_visual()
                low = clean(t).lower()
                if any(low.startswith(h) for h in END_HEADS):
                    i = self.endmatter(i)
                    continue
                self.blocks.append({'type': 'heading', 'text': cap(clean(t)), 'level': 3, '_page': x['page']})
                i += 1; continue
            # ---------------- captions
            if re.match(r'^Table \d+\.\d+-\d+ ·', t):
                flush_all(); flush_visual()
                capl = [t]; j = i + 1
                while j < len(it) and it[j]['kind'] == 'line' and abs(it[j]['size'] - x['size']) < 0.2 and it[j]['x0'] < 60 and abs(it[j]['top'] - it[j-1]['top']) < 16 and it[j]['page'] == x['page']:
                    capl.append(it[j]['text']); j += 1
                pending_caption = join_lines(capl)
                i = j; continue
            if re.match(r'^Figure \d+\.\d+-\d+ ·', t):
                flush_all()
                capl, alt = [t], []
                j = i + 1
                while j < len(it) and it[j]['kind'] == 'line' and not it[j]['text'].startswith('Alt text:') and abs(it[j]['size'] - x['size']) < 0.3 and it[j]['x0'] < 60:
                    capl.append(it[j]['text']); j += 1
                if j < len(it) and it[j]['kind'] == 'line' and it[j]['text'].startswith('Alt text:'):
                    sz = it[j]['size']
                    alt.append(it[j]['text'][len('Alt text:'):]); j += 1
                    while j < len(it) and it[j]['kind'] == 'line' and abs(it[j]['size'] - sz) < 0.3 and it[j]['x0'] < 60:
                        alt.append(it[j]['text']); j += 1
                caption = join_lines(capl)
                m = re.match(r'^(Figure \d+\.\d+-\d+) · (.*)$', caption)
                eq_here = [v for v in visual if re.search(r'Eq\. \d+\.\d+-\d+', v['text'])]
                self.emit(x['page'], {'type': 'figure', 'label': m.group(1), 'caption': m.group(2),
                                      'description': join_lines(alt) or caption,
                                      '_raw': ' / '.join(v['text'] for v in visual)[:600],
                                      '_crop': self.region(i, x['page'], x['top'], set(id(v) for v in visual))})
                visual = []
                i = j; continue
            # ---------------- equation label inside a visual band
            mEq = re.search(r'Eq\. (\d+\.\d+-\d+)\s*$', t)
            boxed_eq = mEq and 60 <= x['x0'] <= 72 and abs(x['size'] - BODY) < 0.3
            if not boxed_eq:
                mEq = re.search(r'Eq\. (\d+\.\d+-\d+)\s*$', t) if (not is_body(x) and x['size'] != 9.0 and (x['x0'] > 400 or re.search(r'Eq\. \d+\.\d+-\d+\s*$', t))) else None
            if mEq:
                flush_all()
                band = [v for v in visual if v['page'] == x['page'] and x['top'] - v['top'] < 70]
                j = i + 1
                while j < len(it) and it[j]['kind'] == 'line' and it[j]['page'] == x['page'] and not is_body(it[j]) and it[j]['top'] - x['top'] < 40 \
                        and it[j]['size'] not in (9.5, 9.0) and not re.match(r'^(Worked|Table|Figure)', it[j]['text']):
                    band.append(it[j]); j += 1
                raw = ' / '.join(v['text'] for v in band + [x])
                note = []
                while j < len(it) and it[j]['kind'] == 'line' and abs(it[j]['size'] - 9.5) < 0.3 and 60 <= it[j]['x0'] <= 70:
                    note.append(it[j]['text']); j += 1
                blk = {'type': 'equation', 'label': f"Eq. {mEq.group(1)}", 'tex': None, 'alt': None, '_raw': raw}
                self.equations.append({'label': blk['label'], 'page': x['page'], 'top': x['top'], 'raw': raw})
                if note:
                    blk['note'] = join_lines(note)
                self.emit(x['page'], blk)
                visual = []
                i = j; continue
            # ---------------- body text, lists
            indented = 60 <= x['x0'] <= 72 and abs(x['size'] - BODY) < 0.3 and not x['bullet'] and not (lst and 66 <= x['x0'] <= 72) \
                and not re.match(r'^\d+\. ', t)
            if indented:
                flush_all()
                visual.append(x)
                i += 1
                continue
            if is_body(x) or (abs(x['size'] - BODY) < 0.3 and x['x0'] < 75):
                if visual:
                    flush_visual()
                mnum = re.match(r'^(\d+)\. (.*)', t)
                if x['bullet']:
                    flush_para()
                    if lst and lst_ordered: flush_list()
                    lst_ordered = False; lst.append([t]); lst_page = lst_page or x['page']
                elif mnum and 55 <= x['x0'] <= 62:
                    flush_para()
                    if lst and not lst_ordered: flush_list()
                    lst_ordered = True; lst.append([mnum.group(2)]); lst_page = lst_page or x['page']
                elif lst and 66 <= x['x0'] <= 72:
                    lst[-1].append(t)
                else:
                    flush_list()
                    # paragraph break: previous line ended a sentence and was short, or vertical gap
                    if para and (para_prev is not None and ((x['page'] == para_prev['page'] and x['top'] - para_prev['top'] > 22)
                                 or (re.search(r'[.:?!)"”]$', para_prev['text']) and para_prev['x1'] < 505))):
                        flush_para()
                    para.append(t); para_page = para_page or x['page']
                    para_prev = x
                i += 1; continue
            # small notes in normal flow (e.g. s9.0/9.5 lines not under a table): treat as text
            if x['size'] in (9.0, 9.5) and x['x0'] < 70 and not visual:
                flush_all()
                j = i; note = []
                while j < len(it) and it[j]['kind'] == 'line' and it[j]['size'] == x['size'] and it[j]['x0'] < 70 and not it[j]['bar']:
                    note.append(it[j]['text']); j += 1
                self.emit(x['page'], {'type': 'text', 'md': join_lines(note)})
                i = j; continue
            # otherwise: part of a drawing
            flush_all()
            visual.append(x)
            i += 1
        flush_all(); flush_visual()
        if pending_caption:
            self.flags.append(f"caption without table: {pending_caption}")

    # ------------------------------------------------------------------
    def region(self, idx, page, bottom, visual_ids):
        """Drawing area above a figure caption: from the last flowing item on the page down to the caption."""
        top = 52
        if idx is not None:
            for j in range(idx - 1, -1, -1):
                y = self.items[j]
                if y['page'] != page:
                    break
                if id(y) in visual_ids:
                    continue
                if y['kind'] == 'table' or (y['kind'] == 'line' and y.get('bottom', 0) < bottom - 5):
                    top = (y.get('bottom') or y['top'] + 12) + 3
                    break
        return {'page': page, 'top': round(top, 1), 'bottom': round(bottom - 2, 1)}

    def worked(self, i):
        it = self.items
        x = it[i]
        m = re.match(r'^(Worked (?:example|application) \d+\.\d+-\d+) ?(.*)$', x['text'])
        label, title = m.group(1), m.group(2)
        i += 1
        while i < len(it) and it[i]['kind'] == 'line' and it[i]['size'] == x['size'] and it[i]['x0'] > 70 and it[i]['top'] - x['top'] < 30 and it[i]['page'] == x['page']:
            title += ' ' + it[i]['text']; i += 1
        given_lines, given_label = [], 'Given'
        steps, answer = [], []
        pending_cap = None
        answer_inline = False
        mode = 'given'
        prev = None
        while i < len(it):
            y = it[i]
            if y['kind'] == 'table':
                if mode == 'answer':
                    break
                if steps and 'table' in steps[-1] and steps[-1]['table']['columns'] == y['header'] and not pending_cap:
                    steps[-1]['table']['rows'] += y['rows']
                else:
                    steps.append({'label': pending_cap or 'Table', 'table': {'columns': y['header'], 'rows': y['rows']}})
                pending_cap = None
                mode = 'rows'; i += 1; prev = None; continue
            t = y['text']
            if mode != 'answer' and re.match(r'^Table \d+\.\d+-\d+ ·', t) and i + 1 < len(it) and (it[i + 1]['kind'] == 'table' or it[i + 1].get('text', '').startswith('Table')):
                pending_cap = t; i += 1; continue
            if mode != 'answer' and abs(y['size'] - 9.0) < 0.3 and 60 <= y['x0'] < 72:
                note = [t]; i += 1
                while i < len(it) and it[i]['kind'] == 'line' and abs(it[i]['size'] - 9.0) < 0.3 and 60 <= it[i]['x0'] < 72:
                    note.append(it[i]['text']); i += 1
                steps.append({'label': 'Note', 'lines': [join_lines(note)]})
                mode = 'rows'; prev = None
                continue
            if re.match(r'^Worked (example|application) \d', t) or y['size'] >= 12.5 \
                    or re.match(r'^(Table|Figure) \d', t) or y['x0'] < 60:
                break
            if abs(y['size'] - 8.5) < 0.4 and 72 <= y['x0'] <= 80 and not t.startswith('Answer'):
                break  # a callout title
            if 72 <= y['x0'] < 95 and t.startswith('Answer'):
                mode = 'answer'; answer.append(t[len('Answer'):].strip()); i += 1; continue
            if mode == 'answer':
                if 115 <= y['x0'] < 150 or (answer_inline and abs(y['size'] - 10.5) < 0.3 and 60 <= y['x0'] < 72):
                    answer.append(t); i += 1; continue
                break
            if abs(y['size'] - 10.5) < 0.3 and 60 <= y['x0'] < 72 and re.match(r'^Answer\.\s', t):
                mode = 'answer'; answer_inline = True; answer.append(t[len('Answer.'):].strip()); i += 1; continue
            if abs(y['size'] - 10.5) < 0.3 and 60 <= y['x0'] < 72:
                mg = re.match(r'^(Given|Situation|Problem|Data|Scenario)\.\s*(.*)$', t)
                ms = re.match(r'^(Step(?: \d+)?)\s*[—–-]\s*(.*)$', t)
                if mode == 'given' and mg:
                    given_label = mg.group(1); given_lines.append(mg.group(2))
                elif ms:
                    mode = 'rows'; steps.append({'label': ms.group(1), 'lines': [ms.group(2)]})
                elif mode == 'given':
                    given_lines.append(t)
                elif steps and 'lines' in steps[-1]:
                    gap = prev is not None and y['page'] == prev['page'] and y['top'] - prev['top'] > 20
                    steps[-1]['lines'].append(('\n' if gap else '') + t)
                else:
                    steps.append({'label': '·', 'lines': [t]})
                prev = y; i += 1; continue
            mode = 'rows'
            if 60 <= y['x0'] < 72:
                lab = [w for w in y['words'] if w[0] < 128]
                con = [w for w in y['words'] if w[0] >= 128]
                labtxt = y.get('left_text') or ' '.join(w[1] for w in lab)
                contxt = y.get('right_text') if con else ''
                if not con and y['size'] < 9.5 and steps:
                    steps[-1]['label'] += ' ' + labtxt
                else:
                    steps.append({'label': labtxt, 'lines': [contxt] if contxt else []})
            elif y['x0'] >= 115 and steps and 'lines' in steps[-1]:
                steps[-1]['lines'].append(t)
            else:
                break
            prev = y; i += 1
        g = join_lines(given_lines)
        mf = re.match(r'^(.*?)(?:\s+Find\.\s*(.*))?$', g)
        given, find = (mf.group(1), mf.group(2) or '') if mf else (g, '')
        out = []
        for st in steps:
            if 'table' in st:
                out.append({'label': st['label'], 'table': st['table']})
                continue
            parts = []
            for ln in st['lines']:
                if ln.startswith('\n'):
                    parts.append('\n' + ln[1:])
                else:
                    parts.append(ln)
            md = '\n'.join(join_lines([p for p in chunk.split('\x00') if p]) for chunk in '\x00'.join(parts).split('\x00\n'))
            md = md.strip()
            if md:
                out.append({'label': clean(st['label']) or '·', 'md': md})
        blk = {'type': 'worked_example', 'label': label, 'title': clean(title), 'given_label': given_label, 'given': given or '—',
               'steps': out or [{'label': 'Work', 'md': 'See the answer.'}]}
        if answer and join_lines(answer):
            blk['answer'] = join_lines(answer)
        if find:
            blk['find'] = find
        if not answer:
            self.flags.append(f"{label}: no separate Answer row (source ends with its last step)")
        self.emit(x['page'], blk)
        return i

    # ------------------------------------------------------------------
    def callout(self, grp):
        title = grp[0]['text'] if abs(grp[0]['size'] - 8.5) < 0.3 else None
        body = grp[1:] if title else grp
        page = grp[0]['page']
        if title == 'Illustrative scenario':
            txt = join_lines([g['text'] for g in body])
            m = re.match(r'^(.*?)\s*Decision to make:\s*(.*)$', txt)
            sc = {'type': 'scenario', 'title': 'Opening scenario', 'body': m.group(1) if m else txt,
                  'decision': ('Decision to make: ' + m.group(2)) if m else 'Decide what you would do, then read on.'}
            self.scenario = sc
            self.emit(page, sc)
            self.blocks.append({'type': 'activity', 'code': 'first-call'})
            return
        if title == 'Try it':
            qa, cur = [], None
            for g in body:
                t = g['text']
                mq = re.match(r'^(\d+)\. (.*)', t)
                if mq and abs(g['size'] - 10.5) < 0.4:
                    cur = {'q': [mq.group(2)], 'a': [], 'page': g['page']}; qa.append(cur)
                elif t.startswith('Solution:') and cur:
                    cur['a'].append(t[len('Solution:'):].strip())
                elif cur and cur['a']:
                    cur['a'].append(t)
                elif cur:
                    cur['q'].append(t)
            for n, q in enumerate(qa, 1):
                code = f'try-{n}'
                self.tryits.append({'code': code, 'q': join_lines(q['q']), 'a': join_lines(q['a']), 'page': q['page']})
                self.blocks.append({'type': 'activity', 'code': code})
            if not qa:
                self.flags.append(f"p{page}: Try it with no questions parsed")
            return
        variant = CALLOUT_VARIANT.get(title) or 'source_note'
        # bullets inside a callout
        items, paras, cur = [], [], []
        for g in body:
            if g['bullet']:
                items.append([g['text']])
            elif items and g['x0'] > 70:
                items[-1].append(g['text'])
            else:
                paras.append(g['text'])
        blk = {'type': 'callout', 'variant': variant, 'title': title or 'Note'}
        if paras:
            blk['md'] = join_lines(paras)
        if items:
            blk['items'] = [join_lines(x) for x in items]
        self.emit(page, blk)

    # ------------------------------------------------------------------
    def endmatter(self, i):
        """Two-column summary / common errors / related chapters / key terms / sources."""
        it = self.items
        cols = {0: [], 1: []}
        heads = {0: None, 1: None}
        first_page = it[i]['page']
        while i < len(it):
            y = it[i]
            if y['kind'] != 'line':
                break
            if y['size'] >= 19 and not any(clean(y['text']).lower().startswith(h) for h in END_HEADS):
                break
            if (12.5 <= y['size'] <= 14 or y['size'] >= 19) and y['x0'] < 60 and (cols[0] or cols[1]):
                # new end-matter heading row: flush current
                self.flush_end(cols, heads)
                cols, heads = {0: [], 1: []}, {0: None, 1: None}
            c = 1 if y['x0'] > 290 else 0
            if 12.5 <= y['size'] <= 14 or y['size'] >= 19:
                heads[c] = clean(y['text']).lower()
                if heads[c] not in END_HEADS and c == 0 and ' ' in heads[c]:
                    # "common errors related chapters" not split: try to separate
                    for h in END_HEADS:
                        if heads[c].startswith(h) and heads[c] != h:
                            heads[0], heads[1] = h, heads[c][len(h):].strip()
            else:
                cols[c].append(y)
            i += 1
        self.flush_end(cols, heads)
        return i

    def flush_end(self, cols, heads):
        for c in (0, 1):
            h, ls = heads[c], cols[c]
            if not h or not ls:
                continue
            page = ls[0]['page']
            if h == 'summary' or h == 'common errors':
                items = []
                for l in ls:
                    if l['bullet'] or not items:
                        items.append([l['text']])
                    else:
                        items[-1].append(l['text'])
                items = [join_lines(x) for x in items]
                if h == 'summary':
                    self.emit(page, {'type': 'summary', 'items': items})
                else:
                    self.emit(page, {'type': 'callout', 'variant': 'common_error', 'title': 'Common errors', 'items': items})
            elif h == 'related chapters':
                txt = ' · '.join(l['text'] for l in ls)
                chs = []
                for m in re.finditer(r'(\d+\.\d+)\s+([^·]+?)(?=\s*·|\s*$|\s+\d+\.\d+\s)', txt):
                    chs.append({'code': m.group(1), 'title': clean(m.group(2))})
                if chs:
                    self.emit(page, {'type': 'related', 'chapters': chs})
            elif h == 'key terms':
                entries = []
                prev = None
                for l in ls:
                    if prev is None or l['top'] - prev['top'] > 17 or l['page'] != prev['page']:
                        entries.append([l['text']])
                    else:
                        entries[-1].append(l['text'])
                    prev = l
                terms = []
                for e in entries:
                    s = join_lines(e)
                    m = re.match(r'^(.+?\.)\s+(.*)$', s)
                    if m and len(m.group(1)) < 80:
                        terms.append({'term': m.group(1).rstrip('.'), 'definition': m.group(2)})
                    elif terms:
                        terms[-1]['definition'] += ' ' + s
                if terms:
                    self.emit(page, {'type': 'glossary', 'terms': terms})
            elif h == 'chapter sources':
                refs = []
                for l in ls:
                    if l['x0'] < 60 or not refs:
                        refs.append([l['text']])
                    else:
                        refs[-1].append(l['text'])
                self.emit(page, {'type': 'references', 'items': [join_lines(r) for r in refs]})
            else:
                self.flags.append(f"unknown end heading {h}")


# ======================================================================
def words(blocks):
    n = 0
    for b in blocks:
        for k in ('md', 'body', 'decision', 'given', 'find', 'answer', 'description', 'caption'):
            if isinstance(b.get(k), str):
                n += len(b[k].split())
        for k in ('items',):
            for s in b.get(k, []) or []:
                n += len(s.split())
        if b['type'] == 'table':
            n += sum(len(' '.join(r).split()) for r in b['rows'])
        if b['type'] == 'worked_example':
            n += sum(len(s.get('md', '').split()) for s in b['steps'])
    return n


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s[:40].strip('-') or 'section'


def build_sections(ch):
    """Split blocks at level-2 headings; merge the intro; end matter becomes the review section."""
    secs, cur = [], None
    end_types = {'summary', 'glossary', 'related', 'references'}
    review = []
    for b in ch.blocks:
        if b['type'] in end_types or (b['type'] == 'callout' and b.get('title') == 'Common errors'):
            review.append(b); continue
        if b['type'] == 'heading' and b.get('level') == 2:
            cur = {'title': b['text'], 'blocks': []}
            secs.append(cur)
            continue
        if cur is None:
            cur = {'title': 'Introduction', 'blocks': []}; secs.append(cur)
        if b['type'] == 'heading':
            b = {'type': 'heading', 'text': b['text']}
        cur['blocks'].append(b)
    # intro: opening scenario + learning objectives (+ a following short section)
    out = []
    for s in secs:
        t = s['title'].lower()
        if out and t == 'learning objectives' and out[-1]['title'].lower() == 'opening scenario':
            out[-1]['blocks'] += [{'type': 'heading', 'text': 'What this chapter teaches'}] + s['blocks']
            out[-1]['title'] = 'Start here'
            continue
        out.append(s)
    # merge very short sections into the previous one (keeping the heading)
    merged = []
    for s in out:
        if merged and words(s['blocks']) < 170 and not any(b['type'] in ('worked_example', 'activity') for b in s['blocks']) and merged[-1]['title'] != 'Start here':
            merged[-1]['blocks'] += [{'type': 'heading', 'text': s['title']}] + s['blocks']
        else:
            merged.append(s)
    # split very long sections at level-3 headings
    final = []
    for s in merged:
        if words(s['blocks']) > 1700:
            parts, curp = [], {'title': s['title'], 'blocks': []}
            for b in s['blocks']:
                if b['type'] == 'heading' and words(curp['blocks']) > 600:
                    parts.append(curp); curp = {'title': b['text'], 'blocks': []}; continue
                curp['blocks'].append(b)
            parts.append(curp)
            final += parts
        else:
            final.append(s)
    final.append({'title': 'Knowledge check and chapter review', 'blocks': review, 'review': True})
    return final


def num_answer(a):
    """Last '= number unit' in a solution → (value, unit)."""
    m = list(re.finditer(r'(?:=|≈)\s*(-?[\d,]*\.?\d+)\s*(×\s*10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?\s*([^\s.,;]*(?:\s(?:per|of)\s\S+)?)', a))
    if not m:
        return None
    last = m[-1]
    if last.group(2):
        return None
    try:
        v = float(last.group(1).replace(',', ''))
    except ValueError:
        return None
    unit = last.group(3).strip().rstrip('.;,') or ''
    return v, unit


def tryit_activity(t, overlay):
    o = (overlay.get('tryit') or {}).get(t['code'], {})
    if o.get('kind') == 'numeric' or (not o.get('kind') and o.get('value') is not None):
        v, unit = o['value'], o['unit']
    else:
        na = None if o.get('kind') == 'self_check' else num_answer(t['a'])
        v, unit = (na if na else (None, None))
    if v is not None and unit and not o.get('kind') == 'self_check':
        tol = o.get('rel_tol', 0.02)
        return {'code': t['code'], 'kind': 'numeric', 'required': True, 'provenance': 'source',
                'spec': {'prompt': f"Try it (from the guide): {t['q']}", 'unit': unit, 'hint': None,
                         'tolerance_note': f"Answers within ±{tol*100:g}% are accepted."},
                'answer_key': {'value': v, 'rel_tol': tol}, 'sample_response': {'value': v},
                'feedback': {'explanation': f"Guide solution: {t['a']}"}}
    return {'code': t['code'], 'kind': 'self_check', 'required': True, 'provenance': 'source',
            'spec': {'prompt': f"Try it (from the guide): {t['q']}"},
            'answer_key': {}, 'sample_response': {'text': 'My answer.'},
            'feedback': {'explanation': f"Model answer from the guide: {t['a']}"}}


def main(cid, show=False):
    ch = Chapter(cid)
    ch.run()
    ovp = f'{OVL}/{cid}.json'
    overlay = json.load(open(ovp)) if os.path.exists(ovp) else {}
    # equations from overlay
    for b in ch.blocks:
        if b['type'] == 'equation':
            e = (overlay.get('equations') or {}).get(b['label'])
            if e:
                b['tex'], b['alt'] = e['tex'], e['alt']
                if e.get('label'):
                    b['label'] = e['label']
                if e.get('note'):
                    b['note'] = e['note']
        if b['type'] == 'figure' and (overlay.get('figures') or {}).get(b['label']):
            b.update(overlay['figures'][b['label']])
    # text fixes: list of [old, new]
    fixes = overlay.get('fixes', [])
    def apply(o):
        if isinstance(o, str):
            for a, z in fixes:
                o = o.replace(a, z)
            return o
        if isinstance(o, list):
            return [apply(v) for v in o]
        if isinstance(o, dict):
            return {k: apply(v) for k, v in o.items()}
        return o
    ch.blocks = apply(ch.blocks)
    secs = build_sections(ch)
    acts_by_code = {}
    if ch.scenario:
        dec = ch.scenario['decision']
        ref = re.findall(r'Worked (?:example|application)s? [\d.\-–to ]+\d', dec)
        acts_by_code['first-call'] = {
            'code': 'first-call', 'kind': 'self_check', 'required': True, 'provenance': 'original',
            'spec': {'prompt': "Your first call: before you study the chapter, write a sentence or two on what you would decide in the opening scenario and why."},
            'answer_key': {}, 'sample_response': {'text': 'My first call.'},
            'feedback': {'explanation': overlay.get('first_call_feedback') or (
                f"Keep your answer. The chapter settles this decision in {ref[0]}; compare your reasoning when you reach it." if ref
                else "Keep your answer. Compare it with the worked applications later in the chapter.")}}
    for t in ch.tryits:
        acts_by_code[t['code']] = tryit_activity(t, overlay)
    kc = overlay.get('kc', [])
    review = secs[-1]
    review['blocks'] = ([{'type': 'heading', 'text': 'Knowledge check'},
                         {'type': 'text', 'origin': 'original', 'md': f"{len(kc)} formative questions written for this course. Answer each, read the feedback, and retry if you like. They are practice, not a score."}]
                        + [{'type': 'activity', 'code': q['code']} for q in kc] + review['blocks'])
    for q in kc:
        q.setdefault('provenance', 'original'); q.setdefault('required', True)
        acts_by_code[q['code']] = q
    # assemble sections
    out_secs, used_codes = [], set()
    for n, s in enumerate(secs, 1):
        code = 'review' if s.get('review') else ('start' if s['title'] == 'Start here' else slug(s['title']))
        while code in used_codes:
            code = code[:36] + f'-{n}'
        used_codes.add(code)
        acts = []
        for b in s['blocks']:
            if b['type'] == 'activity':
                a = acts_by_code.get(b['code'])
                if not a:
                    ch.flags.append(f"activity {b['code']} has no definition"); continue
                if a.get('feedback', {}).get('review_section') is None and b['code'].startswith('kc'):
                    pass
                acts.append(a)
        s['blocks'] = [b for b in s['blocks'] if b['type'] != 'activity' or b['code'] in acts_by_code]
        est = max(3, min(30, round(words(s['blocks']) / 140 + 1.5 * len(acts))))
        out_secs.append({'code': code, 'sort_order': n, 'title': s['title'], 'est_minutes': est,
                         'blocks': s['blocks'], 'activities': acts})
    # side-by-side captions wrap into a second, label-less figure: fold it into the first
    for s_ in out_secs:
        keep = []
        for b in s_['blocks']:
            if b['type'] == 'figure' and b['label'] == 'Figure' and keep and keep[-1]['type'] == 'figure':
                prev = keep[-1]
                prev['description'] = b['description']
                cap = prev['caption'].rstrip()
                if not cap.endswith('.') and '. ' in cap:
                    prev['caption'] = cap[:cap.rfind('. ') + 1]
                continue
            keep.append(b)
        s_['blocks'] = keep
    # render figure drawings to protected images
    for s_ in out_secs:
        for b in s_['blocks']:
            if b['type'] == 'figure' and b.get('_crop'):
                img = render_crop(b['_crop'], f"fig-{b['label'].split(' ')[-1]}")
                if img:
                    b['image'] = img
                else:
                    ch.flags.append(f"{b['label']}: drawing region too small to crop")
    # strip private keys
    for s in out_secs:
        for b in s['blocks']:
            for k in [k for k in b if k.startswith('_')]:
                del b[k]
    missing_eq = [b['label'] for s in out_secs for b in s['blocks'] if b['type'] == 'equation' and not b.get('tex')]
    if missing_eq:
        ch.flags.append(f"equations without TeX: {missing_eq}")
    # review_section on KC: overlay may name a section title; map to code
    titles = {s['title'].lower(): s['code'] for s in out_secs}
    for s in out_secs:
        for a in s['activities']:
            r = a.get('feedback', {}).get('review_section')
            if r and r not in [x['code'] for x in out_secs]:
                a['feedback']['review_section'] = titles.get(r.lower()) or next((x['code'] for x in out_secs if r.lower() in x['title'].lower()), None)
                if not a['feedback']['review_section']:
                    del a['feedback']['review_section']
    chapter = {'id': cid, 'est_minutes': sum(s['est_minutes'] for s in out_secs), 'review_status': 'draft',
               'meta': {'summary': overlay.get('summary') or MAN_SUMMARY(cid),
                        'source': {'edition': '1.0', 'pages': ch.m['pages'],
                                   'conversion': 'Layout-aware extraction from the guide PDF (tables, worked examples, callouts, end matter) with hand-transcribed equations and original knowledge-check questions.'},
                        'checks': {'flags': ch.flags, 'pending': ['Subject-matter review by an authorised reviewer', 'Spot-check against rendered PDF pages', 'Accessibility review of rendered chapter']}},
               'sections': out_secs}
    chapter['_equations'] = ch.equations
    path = f'{ROOT}/imports/asp-sps/chapters/{cid}.json'
    eqs = chapter.pop('_equations')
    json.dump(chapter, open(path, 'w'), ensure_ascii=False, indent=1)
    chapter['_equations'] = eqs
    if show:
        for s in out_secs:
            print(f"## {s['code']} · {s['title']} · {s['est_minutes']}min · {words(s['blocks'])}w · acts {[a['code'] for a in s['activities']]}")
            for b in s['blocks']:
                d = b.get('md') or b.get('caption') or b.get('title') or b.get('text') or b.get('label') or b.get('code') or ''
                print('   ', b['type'], '|', str(d)[:100])
    print(cid, 'sections', len(out_secs), 'acts', sum(len(s['activities']) for s in out_secs), 'flags', len(ch.flags))
    for f in ch.flags:
        print('  !', f)
    return chapter


ASSETS = os.environ.get('ASP_ASSETS', f'{ROOT}/imports/asp-sps/assets')


def render_crop(crop, name, resolution=150):
    """Crop a region of the guide page to WebP; key carries a content hash so caches never go stale."""
    import hashlib, io
    top, bottom = crop['top'], crop['bottom']
    p = PDF.pages[crop['page'] - 1]
    # prefer the drawing's own rounded card: the box that ends just above the caption
    cards = [o for o in p.curves + p.rects
             if 150 < o['x1'] - o['x0'] < 560 and 60 < o['bottom'] - o['top'] < 760
             and -4 <= bottom + 2 - o['bottom'] <= 45]
    if cards:
        c = max(cards, key=lambda o: o['bottom'])
        top, bottom = c['top'] - 1, c['bottom'] + 1
        x0, x1 = max(46, c['x0'] - 1), min(549, c['x1'] + 1)
    else:
        x0, x1 = 46, 549
    if bottom - top < 25:
        return None
    im = p.crop((x0, max(48, top), x1, min(790, bottom))).to_image(resolution=resolution).original.convert('RGB')
    try:
        p.flush_cache()
    except Exception:
        pass
    # trim uniform margins (page background) so the drawing sits tight
    from PIL import ImageChops, Image
    bg = Image.new('RGB', im.size, im.getpixel((2, 2)))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 12 else 0)
    box = diff.getbbox()
    if not box:
        return None
    pad = 8
    im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
    if im.height < 30:
        return None
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=86, method=6)
    data = buf.getvalue()
    key = f"asp-sps/{name}-{hashlib.sha256(data).hexdigest()[:10]}.webp"
    os.makedirs(os.path.dirname(f'{ASSETS}/{key}'), exist_ok=True)
    open(f'{ASSETS}/{key}', 'wb').write(data)
    return {'key': key, 'width': im.width, 'height': im.height, 'page': crop['page']}


def MAN_SUMMARY(cid):
    """The chapter-opener promise (cover page): the 13-pt lines under the title."""
    from extract import page_parts, group_lines
    m = next(c for c in MAN['chapters'] if c['id'] == cid)
    p, words, *_ = page_parts(m['pages'][0])
    lines = [l for l in group_lines(words) if 12.4 <= l.size <= 13.6 and l.x0 < 60]
    return join_lines([l.text for l in lines]) or None


if __name__ == '__main__':
    main(sys.argv[1], '--show' in sys.argv)
