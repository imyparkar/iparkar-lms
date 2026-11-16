"""Convert one CSP guide chapter (PDF pages) into an LMS chapter package.

  python3 convert.py <chapter-id> [<chapter-id> ...] [--all] [--show]

Reads content/csp-sps/manifest.json for page ranges, runs the layout extractor (or its cache),
assembles sections, blocks and activities, applies the optional hand-written overlay
(imports/csp-sps/authoring/overlays/<id>.json: equation TeX overrides, text fixes, extra
activities, review notes) and writes imports/csp-sps/chapters/<id>.json (git-ignored).

Chapter anatomy in the Reader edition (consistent across all 60 chapters):
  Chapter heading + subtitle · Opening scenario (filled card, "Decision to revisit") ·
  Learning objectives · Core teaching (h3 topics, tables, callouts, figure card) ·
  [Visual explanation] · Worked application · Exam practice (active recall, CSP-style
  questions, Answers and explanations) · Review (summary, common mistakes, key terms,
  related chapters, key formulas, works cited).
"""
import hashlib, json, math, os, re, sys

ROOT = os.environ.get('LMS_ROOT', '.')
MAN = json.load(open(f'{ROOT}/content/csp-sps/manifest.json'))
OUT = os.environ.get('CSP_OUT', f'{ROOT}/imports/csp-sps/chapters')
OVL = os.environ.get('CSP_OVERLAYS', f'{ROOT}/imports/csp-sps/authoring/overlays')
ASSETS = os.environ.get('CSP_ASSETS', f'{ROOT}/imports/csp-sps/assets')
CACHE = os.environ.get('CSP_CACHE')  # optional directory of cached chapter_lines() output
EDITION = 'Reader edition, 9 November 2026'

BODY = 10.5
WPM = 130  # editorial reading pace for time estimates


# ---------------------------------------------------------------------------- helpers
def clean(s):
    s = s.replace('\x02', '').replace('­', '')
    s = re.sub(r'\s+', ' ', s).strip()
    # emphasis that wrapped across lines: "**a** **b**" -> "**a b**"
    s = re.sub(r'\*\* \*\*', ' ', s)
    s = re.sub(r'(?<!\*)\* \*(?!\*)', ' ', s)
    s = s.replace('****', '')
    return s


def join_lines(lines):
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


def plain(s):
    return re.sub(r'\*+', '', s).strip()


def words(s):
    return len(re.findall(r'\w+', plain(s)))


def slug(s, n=34):
    s = re.sub(r'[^a-z0-9]+', '-', plain(s).lower()).strip('-')
    return s[:n].rstrip('-') or 'section'


def is_line(x):
    return x['kind'] == 'line'


def is_h2(x):
    return is_line(x) and x['size'] >= 13.5 and x['x0'] < 60


def is_h3(x):
    return is_line(x) and 11.3 <= x['size'] < 13.5 and x['x0'] < 60 and x['text'] not in ('the figure',)


STOP = set('this that with from which what when where there their they them than then have been were will would should could about into only also other each more most some such these those your does under over must using used make made after before between through because while answer correct option options question chapter guide yates lyon popov brauer'.split())

DECOR = {'read this first', "let's work it through", 'before you move on', 'the figure', 'try it yourself', 'check yourself'}


def is_decor(x):
    return is_line(x) and plain(x['text']).lower() in DECOR and 11.0 <= x['size'] <= 12.6


def is_eq(x):
    return is_line(x) and x.get('katex', 0) >= 0.5


def is_texteq(x):
    """Formula typed as an 11 pt text line in an indented equation box (mainly Domain 1)."""
    return is_line(x) and 10.8 <= x['size'] <= 11.3 and x['x0'] >= 80 and x.get('katex', 0) < 0.5 and \
        re.search(r'[=≤≥≈]', x['text']) and words(x['text']) <= 40


# ---------------------------------------------------------------------------- chapter
class Chapter:
    def __init__(self, cid):
        self.cid = cid
        self.m = next(c for c in MAN['chapters'] if c['id'] == cid)
        self.p0, self.p1 = self.m['pages']
        if CACHE and os.path.exists(f'{CACHE}/{cid}.json'):
            self.items = json.load(open(f'{CACHE}/{cid}.json'))
        else:
            from extract import chapter_lines
            self.items = chapter_lines(self.p0, self.p1)
            for it in self.items:
                it.pop('words', None)
        self.flags = []
        self.checks = {'equations_auto': 0, 'figures': 0, 'tables': 0, 'questions': 0, 'recall': 0}
        self.ovl = {}
        if os.path.exists(f'{OVL}/{cid}.json'):
            self.ovl = json.load(open(f'{OVL}/{cid}.json'))
        self.eq_n = 0
        self.eqmap = []
        self._pdf = None

    @property
    def pdf(self):
        if self._pdf is None:
            from extract import PDF
            self._pdf = PDF
        return self._pdf

    # ------------------------------------------------------------------ split by H2
    def parts(self):
        it = self.items
        k = next(i for i, x in enumerate(it) if is_h2(x) and plain(x['text']).startswith('Opening scenario'))
        head = it[:k]
        parts, cur, name = [], [], None
        for x in it[k:]:
            if is_h2(x):
                if name is not None:
                    parts.append((name, cur))
                name, cur = plain(x['text']), []
                continue
            cur.append(x)
        parts.append((name, cur))
        return head, parts

    # ------------------------------------------------------------------ generic block builder
    def blocks(self, xs, origin='source', flat=False):
        """Turn a run of layout items into schema blocks (text, list, table, callout, equation, figure, heading)."""
        out = []
        i = 0
        para, para_page = [], None
        lst, lst_ordered, lst_page = [], False, None
        call, call_page = [], None
        last_line = None

        def emit(page, b, pages=None):
            if b['type'] not in ('heading', 'activity'):
                b.setdefault('origin', origin)
                if b['origin'] == 'source':
                    b['pages'] = pages or [page, page]
            out.append(b)

        def flush_para():
            nonlocal para, para_page
            if para:
                t = join_lines(para)
                if t:
                    emit(para_page, {'type': 'text', 'md': t})
            para, para_page = [], None

        def flush_list():
            nonlocal lst, lst_page
            if lst:
                items = [join_lines(x) for x in lst if x]
                items = [re.sub(r'^\d+\.\s+', '', t) if lst_ordered else t for t in items]
                emit(lst_page, {'type': 'list', 'ordered': lst_ordered, 'items': [t for t in items if t]})
            lst, lst_page = [], None

        def flush_call():
            nonlocal call, call_page
            if call:
                paras = [join_lines(p) for p in call if p]
                first = paras[0] if paras else ''
                m = re.match(r'^\*\*([^*]{2,60}?)[.:]\*\*\s*(.*)$', first)
                title = m.group(1).strip() if m else 'Note'
                rest = [m.group(2)] + paras[1:] if m else paras
                low = title.lower()
                variant = ('exam_tip' if re.search(r'exam|tip|pitfall|trap', low) else
                           'common_error' if re.search(r'error|mistake|watch|caution|warning', low) else
                           'regional' if re.search(r'kuwait|gulf|oil and gas|regional|koc', low) else 'source_note')
                body = '\n\n'.join(r for r in rest if r)
                emit(call_page, {'type': 'callout', 'variant': variant, 'title': title, 'md': body or title})
            call, call_page = [], None

        def flush_all():
            flush_para(); flush_list(); flush_call()

        while i < len(xs):
            x = xs[i]
            if x['kind'] == 'card':
                i += 1; continue
            if x['kind'] == 'table':
                flush_all()
                if not x['rows'] or not any(x['header']):
                    self.flags.append(f"p{x['page']}: table fragment with no rows dropped: {x['header']}")
                    i += 1; continue
                prev = out[-1] if out else None
                header = [plain(h) for h in x['header']]
                rows = [[clean(c) for c in r] for r in x['rows']]
                if prev and prev['type'] == 'table' and (prev['columns'] == header or x.get('continued')):
                    prev['rows'] += rows; prev['pages'][1] = x['page']
                else:
                    cap = None
                    lp = out[-1] if out else None
                    if lp and lp['type'] == 'text' and lp['md'].rstrip().endswith(':') and words(lp['md']) <= 40:
                        cap = plain(lp['md']).rstrip(':').strip()
                    if not cap:
                        cap = 'Table: ' + ', '.join(h for h in header if h)[:90]
                        self.flags.append(f"p{x['page']}: table caption taken from its header row")
                    emit(x['page'], {'type': 'table', 'caption': cap, 'columns': header, 'rows': rows})
                    self.checks['tables'] += 1
                i += 1; last_line = None
                continue
            if is_decor(x) and plain(x['text']).lower() != 'the figure':
                i += 1; continue
            # ---------------- figure card
            if is_line(x) and plain(x['text']).lower() == 'the figure':
                flush_all()
                i = self.figure(xs, i, emit, out)
                last_line = None
                continue
            # ---------------- display equations (KaTeX)
            if is_eq(x):
                flush_all()
                j = i; cl = [x]
                while j + 1 < len(xs) and is_line(xs[j + 1]) and xs[j + 1]['page'] == x['page'] and \
                        (is_eq(xs[j + 1]) or (xs[j + 1]['size'] < 9.6 and xs[j + 1]['x0'] > 70)) and xs[j + 1]['top'] - cl[-1]['top'] < 13:
                    j += 1; cl.append(xs[j])
                emit(x['page'], self.equation(cl))
                i = j + 1; last_line = None
                continue
            if is_texteq(x):
                flush_all()
                from eqtex import text_tex
                src = x['text']
                while i + 1 < len(xs) and is_line(xs[i + 1]) and xs[i + 1]['page'] == x['page'] and abs(xs[i + 1]['size'] - x['size']) < 0.2 \
                        and abs(xs[i + 1]['x0'] - x['x0']) < 3 and xs[i + 1]['top'] - x['top'] < 22 and not re.search(r'[=≤≥≈]', xs[i + 1]['text']):
                    i += 1; src += ' ' + xs[i]['text']  # a formula that wraps onto a second line
                tex, alt = text_tex(src)
                self.eq_n += 1
                ov = self.ovl.get('equations', {}).get(f'eq-p{x["page"]}-{round(x["top"])}')
                if ov:
                    tex, alt = ov['tex'], ov.get('alt', alt)
                self.eqmap.append({'label': f'Equation {self.cid}.{self.eq_n}', 'key': f'eq-p{x["page"]}-{round(x["top"])}', 'page': x['page'],
                                   'top': round(x['top'] - 3, 1), 'bottom': round(x['bottom'] + 3, 1), 'mode': 'override' if ov else 'text-line', 'notes': []})
                emit(x['page'], {'type': 'equation', 'label': f'Equation {self.cid}.{self.eq_n}', 'tex': tex, 'alt': alt[:1000],
                                 '_key': f'eq-p{x["page"]}-{round(x["top"])}'})
                self.checks['equations_text'] = self.checks.get('equations_text', 0) + 1
                i += 1; last_line = None
                continue
            if is_h3(x):
                flush_all()
                emit(x['page'], {'type': 'heading', 'text': plain(re.sub(r'^\d+\.\s+', '', x['text'])), 'level': 3})
                i += 1; last_line = None
                continue
            if not is_line(x):
                i += 1; continue
            t = x['text']
            # ---------------- callout (orange bar, indented body)
            if not flat and (x.get('bar') is not None or (x['x0'] >= 88 and abs(x['size'] - BODY) < 0.4 and not x.get('bullet'))):
                flush_para(); flush_list()
                gap = last_line is not None and (x['page'] != last_line['page'] or x['top'] - last_line['top'] > 19)
                if not call or gap and (last_line is None or last_line.get('bar') != x.get('bar')):
                    flush_call()
                    call, call_page = [[t]], x['page']
                elif gap:
                    call.append([t])
                else:
                    call[-1].append(t)
                last_line = x; i += 1
                continue
            else:
                flush_call()
            # ---------------- lists
            numbered = re.match(r'^\d{1,2}\.\s', plain(t)) and (54 <= x['x0'] <= 62 or (flat and 54 <= x['x0'] <= 125))
            if x.get('bullet') or numbered:
                flush_para()
                ordered = bool(numbered)
                if lst and lst_ordered != ordered:
                    flush_list()
                if not lst:
                    lst_page, lst_ordered = x['page'], ordered
                lst.append([t])
                last_line = x; i += 1
                continue
            if lst and last_line is not None and x['x0'] >= last_line['x0'] + 4 and (x['page'] != last_line['page'] or x['top'] - last_line['top'] < 19):
                lst[-1].append(t); last_line = x; i += 1
                continue
            if lst and x['x0'] >= 64 and last_line is not None and x['x0'] == last_line['x0'] and x['top'] - last_line['top'] < 19:
                lst[-1].append(t); last_line = x; i += 1
                continue
            flush_list()
            # ---------------- paragraphs
            newpara = (not para or last_line is None or
                       (x['page'] == last_line['page'] and x['top'] - last_line['top'] > 19) or
                       (x['page'] != last_line['page'] and re.search(r'[.:?!)”"]\**$', para[-1].strip())) or
                       abs(x['size'] - last_line['size']) > 0.6)
            if newpara:
                flush_para()
                para_page = x['page']
            para.append(t)
            last_line = x; i += 1
        flush_all()
        return out

    # ------------------------------------------------------------------ figures
    def figure(self, xs, i, emit, out):
        lab = xs[i]
        j = i + 1
        cap = []
        while j < len(xs) and is_line(xs[j]) and xs[j]['size'] < 9.6 and xs[j]['page'] == lab['page']:
            cap.append(xs[j]['text']); j += 1
        caption = join_lines(cap)
        m = re.match(r'^\**(Figure [\d.]+-\d+)\**\s*[·.]?\s*(.*)$', plain(caption))
        label = m.group(1) if m else 'Figure'
        captext = (m.group(2) if m else plain(caption)) or 'Original drawing.'
        # the explanation (paragraphs, lists) and the "Alt text:" paragraph that follow the figure
        k = j
        alt_at = None
        while k < len(xs) and k - j < 70 and xs[k]['kind'] == 'line' and not is_h3(xs[k]) and not is_h2(xs[k]) and \
                plain(xs[k]['text']).lower() != 'the figure':
            if re.match(r'^Alt text', plain(xs[k]['text'])) or 'Alt text:' in plain(xs[k]['text']):
                alt_at = k; break
            k += 1
        alt, pre_blocks = '', []
        if alt_at is not None:
            end = alt_at + 1
            while end < len(xs) and is_line(xs[end]) and abs(xs[end]['size'] - BODY) < 0.4 and \
                    (xs[end]['page'] != xs[end - 1]['page'] or xs[end]['top'] - xs[end - 1]['top'] < 19) and xs[end]['x0'] < 60:
                end += 1
            atext = join_lines([y['text'] for y in xs[alt_at:end]])
            mm = re.search(r'\**Alt text:?\**:?\s*(.*)$', atext)
            pre = atext[:mm.start()].strip() if mm else ''
            alt = plain(mm.group(1)).strip() if mm else ''
            pre_blocks = self.blocks(xs[j:alt_at]) if alt_at > j else []
            if pre:
                pre_blocks.append({'type': 'text', 'md': pre, 'origin': 'source', 'pages': [xs[alt_at]['page']] * 2})
            k = end
        else:
            k = j
        # crop: drawing area above the label, from the previous flowing item on the page
        page = lab['page']
        top = 52.0
        pos = next((n for n, y in enumerate(self.items) if y is lab), None)
        before = self.items[:pos] if pos is not None else xs[:i]
        for y in reversed(before):
            if y['page'] != page:
                break
            if y['kind'] == 'card':
                continue
            if y['kind'] in ('line', 'table') and y.get('bottom', y['top'] + 12) < lab['top'] - 8:
                top = (y.get('bottom') or y['top'] + 12) + 4
                break
        image = self.crop(label, page, top, lab['top'] - 4)
        desc = alt or captext
        b = {'type': 'figure', 'label': label, 'caption': captext, 'description': desc}
        if image:
            b['image'] = image
        # redrawn vector figure (imports/csp-sps/authoring/figures/fig-<n>.svg, optional .phone.svg)
        stem = 'fig-' + re.sub(r'[^0-9a-z-]+', '-', label.lower().replace('figure ', ''))
        fdir = os.environ.get('CSP_FIGURES', f'{ROOT}/imports/csp-sps/authoring/figures')
        if os.path.exists(f'{fdir}/{stem}.svg'):
            b['svg'] = open(f'{fdir}/{stem}.svg', encoding='utf-8').read().strip()
            if os.path.exists(f'{fdir}/{stem}.phone.svg'):
                b['svg_phone'] = open(f'{fdir}/{stem}.phone.svg', encoding='utf-8').read().strip()
            self.checks['figures_redrawn'] = self.checks.get('figures_redrawn', 0) + 1
            self.flags.append(f'{label}: redrawn as SVG; compare with the original drawing (p{page}) before approval')
        if not alt:
            self.flags.append(f'p{page}: {label} has no alt text in the guide; caption used as description')
        emit(page, b)
        self.checks['figures'] += 1
        out.extend(pre_blocks)
        return k

    def crop(self, label, page, top, bottom):
        if os.environ.get('CSP_NO_IMAGES'):
            return None
        try:
            from PIL import Image
            p = self.pdf.pages[page - 1]
            if bottom - top < 30:
                self.flags.append(f'p{page}: {label} drawing area too small to crop ({bottom - top:.0f} pt)')
                return None
            im = p.crop((40, top, p.width - 40, bottom)).to_image(resolution=150).original.convert('RGB')
            # trim white margins
            from PIL import ImageChops
            bg = Image.new('RGB', im.size, (255, 255, 255))
            diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 12 else 0)
            bb = diff.getbbox()
            if bb:
                im = im.crop((max(0, bb[0] - 6), max(0, bb[1] - 6), min(im.width, bb[2] + 6), min(im.height, bb[3] + 6)))
            os.makedirs(f'{ASSETS}/csp-sps', exist_ok=True)
            import io
            buf = io.BytesIO(); im.save(buf, 'WEBP', quality=82, method=6)
            h = hashlib.sha256(buf.getvalue()).hexdigest()[:10]
            name = f"fig-{re.sub(r'[^0-9a-z-]+', '-', label.lower().replace('figure ', ''))}-{h}.webp"
            open(f'{ASSETS}/csp-sps/{name}', 'wb').write(buf.getvalue())
            return {'key': f'csp-sps/{name}', 'width': im.width, 'height': im.height, 'page': page}
        except Exception as e:  # pragma: no cover
            self.flags.append(f'p{page}: {label} crop failed: {e}')
            return None

    # ------------------------------------------------------------------ equations
    def equation(self, cl):
        from eqtex import rebuild
        page = cl[0]['page']
        top = min(c['top'] for c in cl) - 3
        bottom = max(c.get('bottom', c['top'] + 12) for c in cl) + 3
        self.eq_n += 1
        key = f'eq-p{page}-{round(cl[0]["top"])}'
        ov = self.ovl.get('equations', {}).get(key)
        if ov:
            tex, alt, notes = ov['tex'], ov.get('alt'), []
        else:
            tex, alt, notes = rebuild(self.pdf.pages[page - 1], (45, top, 592, bottom))
            self.checks['equations_auto'] += 1
        if not tex:
            tex = r'\text{' + plain(' '.join(c['text'] for c in cl)).replace('\\', '') + '}'
            notes = notes + ['empty rebuild; text fallback']
        self.eqmap.append({'label': f'Equation {self.cid}.{self.eq_n}', 'key': key, 'page': page, 'top': round(top, 1), 'bottom': round(bottom, 1),
                           'mode': 'override' if ov else 'katex-rebuild', 'notes': notes})
        b = {'type': 'equation', 'label': f'Equation {self.cid}.{self.eq_n}', 'tex': tex,
             'alt': (alt or plain(' '.join(c['text'] for c in cl)))[:1000], '_key': key}
        if notes:
            self.flags.append(f'p{page} {key}: ' + '; '.join(notes))
        return b

    # ------------------------------------------------------------------ assembly
    def run(self):
        head, parts = self.parts()
        sections = []

        # ---- section 1: scenario + objectives
        scen = dict(parts).get('Opening scenario', [])
        objs = dict(parts).get('Learning objectives', [])
        sc_blocks = self.blocks(scen, flat=True)
        body, decision, pages = [], None, None
        # a decision written inline ("... **Decision to revisit:** is the proposal ...") starts its own paragraph
        split = []
        for b in sc_blocks:
            if b['type'] == 'text' and re.search(r'.\*\*Decisions? to (revisit|make):?\*\*', b['md']):
                mm = re.search(r'\*\*Decisions? to (revisit|make):?\*\*', b['md'])
                split.append(dict(b, md=b['md'][:mm.start()].strip()))
                split.append(dict(b, md=b['md'][mm.start():].strip()))
            else:
                split.append(b)
        sc_blocks = [b for b in split if b['type'] != 'text' or b['md']]
        for b in sc_blocks:
            if b['type'] == 'text' and re.match(r'^\*\*Decision(s)? to (revisit|make)', b['md']):
                decision = re.sub(r'^\*\*Decision(s)? to (revisit|make):?\*\*:?\s*', '', b['md'])
            elif b['type'] == 'text':
                body.append(b['md'])
            elif b['type'] == 'list':
                body.append('\n'.join('• ' + t for t in b['items']))
            else:
                body.append(None)  # tables etc. kept after the scenario block
        lead = re.match(r'^\*\*(Illustrative(?: scenario)?\.?)\*\*\s*', body[0] or '') if body else None
        first = [b for b in body if b]
        if lead:
            first[0] = first[0][lead.end():]
        if not decision:
            # some chapters close the scenario with a question instead of a labelled decision
            q = next((t for t in reversed(first) if t.strip().endswith('?')), None)
            if q:
                decision = q; first = [t for t in first if t is not q]
                self.flags.append('scenario decision taken from its closing question')
            else:
                decision = 'Before you read on, write down what you would decide and why.'
                self.flags.append('scenario has no stated decision; editorial prompt used')
        s1 = [{'type': 'scenario', 'title': 'Opening scenario' + (' (illustrative)' if lead or 'Illustrative' in ' '.join(first[:1]) else ''),
               'body': '\n\n'.join(first), 'decision': decision, 'origin': 'source', 'pages': [self.p0, self.p0 + 1]}]
        s1 += [b for b in sc_blocks if b['type'] not in ('text', 'list')]
        ob = self.blocks(objs)
        s1 += [{'type': 'heading', 'text': 'What this chapter teaches', 'level': 3}] + ob
        s1 += [{'type': 'activity', 'code': 'first-call'}]
        act_first = {'code': 'first-call', 'kind': 'self_check', 'required': True, 'provenance': 'original',
                     'spec': {'prompt': f'**Your first call.** {plain(decision)} Write your decision and one reason before you study the chapter.'},
                     'answer_key': {}, 'sample_response': {'text': 'My first decision and the reason for it.'},
                     'feedback': {'explanation': 'There is no single right answer yet. Keep this first call: the worked application and the review at the end of the chapter return to this decision, so you can compare your reasoning with the chapter\'s.'}}
        sections.append({'title': 'Opening scenario and objectives', 'blocks': s1, 'activities': [act_first]})

        # ---- core teaching: one section per h3 topic, merged to 5-10 minute sections
        core_names = [n for n, _ in parts if n not in ('Opening scenario', 'Learning objectives', 'Worked application', 'Exam practice', 'Review')]
        topics = []
        for n, xs in parts:
            if n not in core_names:
                continue
            bl = self.blocks(xs)
            if n.startswith('Visual explanation') or n != 'Core teaching':
                title = n if n != 'Core teaching' else 'Core teaching'
                topics.append([title, bl, True])
                continue
            cur = None
            for b in bl:
                if b['type'] == 'heading' and b.get('level') == 3:
                    cur = [b['text'], [], False]
                    topics.append(cur)
                    continue
                if cur is None:
                    cur = ['Introduction', [], False]; topics.append(cur)
                cur[1].append(b)
        merged = []
        for t in topics:
            wc = sum(self.block_words(b) for b in t[1])
            if merged and (merged[-1][2] < 260 or wc < 160) and merged[-1][2] + wc < 1300 and not t[0].startswith('Visual'):
                merged[-1][1].append({'type': 'heading', 'text': t[0], 'level': 3})
                merged[-1][1].extend(t[1])
                merged[-1][2] += wc
                merged[-1][3].append(t[0])
            else:
                merged.append([t[0], list(t[1]), wc, [t[0]]])
        for title, bl, wc, names in merged:
            if not bl:
                continue
            ttl = title if len(names) == 1 else f'{names[0]}; {names[1]}' + (' and more' if len(names) > 2 else '')
            sections.append({'title': ttl[:200], 'blocks': bl, 'activities': []})

        # ---- worked application
        wa = dict(parts).get('Worked application')
        if wa:
            sections.append({'title': 'Worked application', 'blocks': self.worked(wa), 'activities': []})
        else:
            self.flags.append('no Worked application part found')

        # ---- exam practice
        ep = dict(parts).get('Exam practice', [])
        bl, acts = self.practice(ep)
        sections.append({'title': 'Exam practice', 'blocks': bl, 'activities': acts})

        # ---- review
        rv = dict(parts).get('Review', [])
        sections.append({'title': 'Review and close the scenario', 'blocks': self.review(rv, decision), 'activities': []})

        # ---- codes, sort, estimates
        used = set()
        for k, s in enumerate(sections, 1):
            code = slug(s['title'])
            while code in used:
                code = (code[:30] + f'-{k}')
            used.add(code)
            s['code'] = code
            s['sort_order'] = k
            s['required'] = True
            wc = sum(self.block_words(b) for b in s['blocks']) + 40 * len(s['activities'])
            s['est_minutes'] = max(3, min(30, math.ceil(wc / WPM)))
        # point each practice item at the teaching section that shares the most distinctive words
        core = [s for s in sections[1:] if s['title'] not in ('Exam practice', 'Review and close the scenario')]
        def bag(t):
            return {w for w in re.findall(r'[a-z][a-z0-9-]{3,}', plain(t).lower())} - STOP
        docs = [(s['code'], bag(json.dumps(s['blocks'], ensure_ascii=False))) for s in core]
        df = {}
        for _, d in docs:
            for w in d:
                df[w] = df.get(w, 0) + 1
        for s in sections:
            for a in s['activities']:
                fb = a['feedback']
                if fb.get('review_section') == '__core__':
                    q = bag(a['spec']['prompt'] + ' ' + fb['explanation'] + ' ' + ' '.join(o['text'] for o in a['spec'].get('options', [])))
                    best = max(docs, key=lambda d: sum(1 / df[w] for w in q & d[1])) if docs else None
                    fb['review_section'] = best[0] if best else sections[0]['code']
        self.strip_private(sections)
        return sections

    def block_words(self, b):
        t = b['type']
        if t == 'text':
            return words(b['md'])
        if t == 'list':
            return sum(words(i) for i in b['items'])
        if t == 'table':
            return sum(words(c) for r in b['rows'] for c in r) + 20
        if t == 'callout':
            return words(b.get('md', ''))
        if t == 'worked_example':
            return words(b['given']) + sum(words(s.get('md', '')) + (30 if s.get('tex') or s.get('table') else 0) for s in b['steps'])
        if t == 'scenario':
            return words(b['body']) + words(b['decision'])
        if t == 'figure':
            return 60
        if t == 'equation':
            return 25
        return 10

    def strip_private(self, sections):
        for s in sections:
            for b in s['blocks']:
                b.pop('_key', None)

    # ------------------------------------------------------------------ worked application
    def worked(self, xs):
        bl = self.blocks(xs, flat=True)
        out, cur = [], None
        def close():
            nonlocal cur
            if cur:
                if not cur['steps']:
                    cur['steps'] = [{'label': 'Working', 'md': cur['given']}]
                    cur['given'] = 'See the working below.'
                out.append(cur)
            cur = None
        for b in bl:
            if b['type'] == 'text':
                m = re.match(r'^\*\*(Worked [Ee]xample [\dA-Z.\-–]+)(?:\s*\(([^)]*)\))?[.:]?\*\*\s*(.*)$', b['md']) or \
                    re.match(r'^(Worked [Ee]xample [\d.]+-[A-Z0-9]+)(?:\s*\(([^)]*)\))?[.:]\s*(.*)$', plain(b['md']))
                if m:
                    close()
                    rest = m.group(3)
                    cur = {'type': 'worked_example', 'label': m.group(1), 'title': (plain(rest).split('. ')[0][:140] or m.group(1)),
                           'context': m.group(2) or None, 'given_label': 'Setting', 'given': rest or m.group(1), 'steps': [],
                           'origin': 'source', 'pages': b['pages']}
                    if not cur['context']:
                        cur.pop('context')
                    continue
            if b['type'] == 'heading':
                hm = re.match(r'^(Worked [Ee]xample [\d.]+-[A-Z0-9]+):?\s*(.*)$', b['text'])
                if hm:
                    close()
                    cur = {'type': 'worked_example', 'label': hm.group(1), 'title': hm.group(2) or hm.group(1), 'given_label': 'Setting',
                           'given': '', 'steps': [], 'origin': 'source', 'pages': None}
                    continue
            if cur is None:
                out.append(b)
                continue
            pg = b.get('pages')
            if pg:
                cur['pages'] = [min(cur['pages'][0], pg[0]), max(cur['pages'][1], pg[1])] if cur['pages'] else list(pg)
            if b['type'] == 'text':
                sm = re.match(r'^\*\*((?:Step \d+|Given|Find|Known|Solution|Solve|Check|Result|Answer|Interpretation|Decision|Reasonableness check|Conclusion|Data|Method|Approach|Assumptions?)[^*]{0,80}?)[.:]?\*\*\s*(.*)$', b['md'])
                if sm:
                    label = plain(sm.group(1)).rstrip('.:')
                    body = sm.group(2) or label
                    if re.match(r'^(Interpretation|Conclusion|Answer|Result|Decision)\b', label) and not cur.get('answer'):
                        cur['answer'] = f'**{label}.** {body}' if not label.startswith('Answer') else body
                    else:
                        cur['steps'].append({'label': label[:60], 'md': body})
                    continue
                if not cur['given']:
                    cur['given'] = b['md']; continue
                if cur.get('answer'):
                    cur['answer'] += '\n\n' + b['md']; continue
                cur['steps'].append({'label': '·', 'md': b['md']}) if cur['steps'] else cur.__setitem__('given', cur['given'] + '\n\n' + b['md'])
            elif b['type'] == 'list':
                txt = '\n'.join(('• ' if not b['ordered'] else f'{k}. ') + t for k, t in enumerate(b['items'], 1))
                if cur.get('answer'):
                    cur['answer'] += '\n' + txt
                elif cur['steps']:
                    cur['steps'][-1]['md'] = (cur['steps'][-1].get('md', '') + '\n' + txt).strip() if 'md' in cur['steps'][-1] else txt
                    if 'md' not in cur['steps'][-1]:
                        cur['steps'].append({'label': '·', 'md': txt})
                else:
                    cur['given'] = (cur['given'] + '\n' + txt).strip()
            elif b['type'] == 'table':
                cur['steps'].append({'label': '·' if cur['steps'] else 'Data', 'table': {'columns': b['columns'], 'rows': b['rows']}})
            elif b['type'] == 'equation':
                cur['steps'].append({'label': '·', 'tex': b['tex'], '_label': b['label']})
            elif b['type'] in ('callout', 'figure', 'heading'):
                close()
                out.append(b)
        close()
        for b in out:
            if b['type'] == 'worked_example':
                if not b.get('pages'):
                    b['pages'] = [self.p0, self.p1]
                if not b['given']:
                    b['given'] = b['title']
                if not b['steps']:
                    b['steps'] = [{'label': 'Working', 'md': b['given']}]
        return out

    # ------------------------------------------------------------------ exam practice
    def practice(self, xs):
        lines = [x for x in xs if x['kind'] != 'card' and not is_decor(x)]
        ans_i = next((k for k, x in enumerate(lines) if is_line(x) and re.match(r'^\**Answers?\b', plain(x['text'])) and x['size'] >= 11), None)
        qpart = lines[:ans_i] if ans_i is not None else lines
        apart = lines[ans_i + 1:] if ans_i is not None else []
        if ans_i is None:
            self.flags.append('no "Answers and explanations" heading found')

        # questions: number line, stem continuation, then A-D option lines (size 9.8)
        def is_opt(x):
            return is_line(x) and 9.5 <= x['size'] <= 10.1 and re.match(r'^[A-D]\s', plain(x['text']))
        qnum = lambda x: re.match(r'^\**Q?(\d{1,2})[.)]\**\s+(?:\(Obj [\d., and]+\)\s*)?(.*)$', plain(x['text'])) if is_line(x) else None
        entries = []  # [num, stem_lines, options{letter: [lines]}, page, has_opts, extras]
        intro, cur, cur_opt = [], None, None
        for x in qpart:
            if x['kind'] == 'table':
                if cur:
                    cur['extras'].append(x)
                else:
                    intro.append(x)
                continue
            m = qnum(x)
            if m and x['x0'] < 64 and abs(x['size'] - BODY) < 0.4:
                cur = {'num': int(m.group(1)), 'stem': [m.group(2)], 'opts': {}, 'page': x['page'], 'extras': []}
                entries.append(cur); cur_opt = None
                continue
            if cur is None:
                intro.append(x); continue
            if is_opt(x):
                L = plain(x['text'])[0]
                cur['opts'][L] = [re.sub(r'^\**[A-D]\**\s+', '', x['text'])]; cur_opt = L
                continue
            if cur_opt and is_line(x) and 9.5 <= x['size'] <= 10.1:
                cur['opts'][cur_opt].append(x['text']); continue
            if is_line(x) and abs(x['size'] - BODY) < 0.4 and x['x0'] < 60 and not cur['opts'] and re.match(r'^\**(CSP-style|Multiple choice|Try all|Choose)', plain(x['text'])):
                intro.append(x); cur = None; continue
            if is_line(x) and abs(x['size'] - BODY) < 0.4 and x['x0'] < 60 and cur['opts']:
                # text after a completed question: section intro for the next block
                intro.append(x); cur = None; continue
            if is_eq(x):
                cur['extras'].append(x); continue
            cur['stem'].append(x['text'])
        mcq = [e for e in entries if len(e['opts']) >= 2]
        recall = [e for e in entries if len(e['opts']) < 2]

        # answers: "1. B. text" or "Q1 — B. text"
        answers, cur = {}, None
        for x in apart:
            if not is_line(x):
                continue
            m = re.match(r'^\**Q?(\d{1,2})(?:\.|\s*[—–-])\s*\**([A-D])\b\.?\**\s*(.*)$', plain(x['text']))
            if m and x['x0'] < 64:
                n = int(m.group(1))
                cur = n if n not in answers else None
                if cur is not None:
                    answers[n] = {'key': m.group(2), 'lines': [m.group(3)]}
                continue
            if cur is not None:
                answers[cur]['lines'].append(x['text'])

        blocks, acts = [], []
        intro_blocks = self.blocks([x for x in intro if not (is_line(x) and re.match(r'^\**(CSP-style|Multiple choice|Try all)', plain(x['text'])))])
        # active recall
        ar = [b for b in intro_blocks if b['type'] == 'text' and re.match(r'^\**Active recall', b['md'])]
        recall_items = [join_lines(e['stem']) for e in recall]
        if ar and not recall_items:
            m = re.match(r'^\**Active recall\.?\**\s*(.*)$', ar[0]['md'])
            recall_items = [m.group(1)] if m and m.group(1) else []
        if recall_items or ar:
            lead = re.sub(r'^\**Active recall\.?\**\s*', '', ar[0]['md']) if ar else ''
            prompt = '**Active recall.** ' + (lead if recall_items != [lead] else '') + ('\n' + '\n'.join(f'{k}. {t}' for k, t in enumerate(recall_items, 1)) if recall_items != [lead] or not lead else '')
            if recall_items == [lead]:
                prompt = '**Active recall.** ' + lead
            blocks.append({'type': 'activity', 'code': 'active-recall'})
            acts.append({'code': 'active-recall', 'kind': 'self_check', 'required': False, 'provenance': 'source',
                         'spec': {'prompt': prompt.strip(), 'source_ref': f'active recall, p. {(recall[0]["page"] if recall else ar[0]["pages"][0])}'},
                         'answer_key': {}, 'sample_response': {'text': 'My answers from memory.'},
                         'feedback': {'explanation': 'Check each answer against the chapter sections, then note any you could not recall and revisit them before the questions below.',
                                      'review_section': '__core__'}})
            self.checks['recall'] = len(recall_items)
        other = [b for b in intro_blocks if not (b['type'] == 'text' and re.match(r'^\**Active recall', b['md']))]
        blocks.extend(other)

        n = len(mcq)
        req = sorted({round(k * (n - 1) / 4) for k in range(5)}) if n >= 5 else list(range(n))
        if n:
            blocks.append({'type': 'text', 'origin': 'editorial',
                           'md': f'**CSP-style questions ({n}).** Answer each one before you open its explanation. The {len(req)} marked *Required* form this chapter\'s knowledge check; the others are optional extra practice. Right or wrong both count toward completion: there is no pass mark.'})
        for k, e in enumerate(mcq):
            num = e['num']
            code = f'q{num:02d}'
            a = answers.get(num)
            opts = [{'id': L.lower(), 'text': join_lines(e['opts'][L])} for L in 'ABCD' if L in e['opts']]
            stem = join_lines(e['stem'])
            if e['extras']:
                for ex in e['extras']:
                    if ex['kind'] == 'table':
                        stem += '\n' + ' | '.join(plain(h) for h in ex['header']) + '\n' + '\n'.join(' | '.join(clean(c) for c in r) for r in ex['rows'])
                        self.flags.append(f'p{e["page"]}: question {num} stem contains a table (flattened into the prompt)')
                    else:
                        eq = self.equation([ex])
                        stem += f'\n\\({eq["tex"]}\\)'
                        self.flags.append(f'p{e["page"]}: question {num} stem contains a display equation (inline TeX)')
            if not a:
                self.flags.append(f'question {num}: no answer found; question kept as optional self-check')
                acts.append({'code': code, 'kind': 'self_check', 'required': False, 'provenance': 'source',
                             'spec': {'prompt': stem + '\n' + '\n'.join(f'{o["id"].upper()}. {o["text"]}' for o in opts), 'source_ref': f'question {num}, p. {e["page"]}'},
                             'answer_key': {}, 'sample_response': {'text': 'My choice.'}, 'feedback': {'explanation': 'Compare your choice with the chapter.'}})
                blocks.append({'type': 'activity', 'code': code})
                continue
            expl = join_lines(a['lines'])
            key = a['key'].lower()
            if key not in [o['id'] for o in opts]:
                self.flags.append(f'question {num}: answer key {a["key"]} not among options')
                continue
            acts.append({'code': code, 'kind': 'single_choice', 'required': k in req, 'provenance': 'source',
                         'spec': {'prompt': stem, 'options': opts, 'source_ref': f'question {num}, p. {e["page"]}'},
                         'answer_key': {'correct': key}, 'sample_response': {'choice': key},
                         'feedback': {'explanation': f'**{a["key"]}.** {expl}', 'review_section': '__core__'}})
            blocks.append({'type': 'activity', 'code': code})
        self.checks['questions'] = n
        self.checks['questions_with_answers'] = sum(1 for e in mcq if e['num'] in answers)
        self.checks['required_questions'] = len(req)
        if not n:
            self.flags.append('no multiple-choice questions found')
        if not blocks:
            blocks = [{'type': 'text', 'origin': 'editorial', 'md': 'Practice for this chapter.'}]
        return blocks, acts

    # ------------------------------------------------------------------ review
    def review(self, xs, decision):
        bl = self.blocks([x for x in xs if not is_decor(x)])
        out = []
        related_ids = self.m['cross_links']
        titles = {c['id']: c['title'] for c in MAN['chapters']}
        mode = None
        mistakes = []
        for b in bl:
            if b['type'] == 'text':
                md = b['md']
                if re.match(r'^\**Summary\.?\**', md):
                    out.append({'type': 'heading', 'text': 'Summary', 'level': 3})
                    body = re.sub(r'^\**Summary\.?\**\s*', '', md)
                    sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+(?=[A-Z“(])', body) if s.strip()]
                    out.append({'type': 'summary', 'items': sents, 'origin': 'source', 'pages': b['pages']})
                    mode = 'summary'; continue
                if re.match(r'^\**Common (mistakes|errors|traps)', md):
                    mode = 'mistakes'
                    rest = re.sub(r'^\**Common (mistakes|errors|traps)\.?\**:?\s*', '', md)
                    if rest:
                        mistakes.append(rest)
                    continue
                if re.match(r'^\**Key terms?', md):
                    terms = re.sub(r'^\**Key terms?:?\.?\**:?\s*', '', md)
                    out.append({'type': 'text', 'md': '**Key terms.** ' + terms, 'origin': 'source', 'pages': b['pages']})
                    mode = None; continue
                if re.match(r'^\**Related chapters?', md):
                    if related_ids:
                        out.append({'type': 'related', 'origin': 'source', 'pages': b['pages'],
                                    'chapters': [{'code': c, 'title': titles[c]} for c in related_ids if c in titles]})
                    mode = None; continue
                if re.match(r'^\**(Works cited|Chapter sources|Sources)', md):
                    refs = re.sub(r'^\**(Works cited in this chapter|Works cited|Chapter sources|Sources):?\.?\**:?\s*', '', md)
                    refs = re.sub(r'\s*Full entries are in the Bibliography[^.]*\.', '', refs)
                    items = [r.strip(' .') for r in re.split(r'\s+·\s+|;\s+(?=[A-Z][a-z]+ [&(\d])', refs) if r.strip(' .')]
                    out.append({'type': 'references', 'items': items or [refs], 'origin': 'source', 'pages': b['pages']})
                    mode = None; continue
                if re.match(r'^\**Key formulas?', md):
                    out.append({'type': 'callout', 'variant': 'source_note', 'title': 'Key formulas',
                                'md': re.sub(r'^\**Key formulas?\.?:?\**:?\s*', '', md) or 'See the chapter sections.', 'origin': 'source', 'pages': b['pages']})
                    mode = None; continue
                if mode == 'summary' and out and out[-1]['type'] == 'summary':
                    out[-1]['items'].append(md); continue
            if b['type'] == 'list' and mode == 'mistakes':
                mistakes.extend(b['items']); continue
            if b['type'] == 'list' and mode == 'summary' and out and out[-1]['type'] == 'summary':
                out[-1]['items'].extend(b['items']); continue
            out.append(b)
            if mistakes:
                pass
        out = [b for b in out if not (b['type'] == 'summary' and not b['items'])] if not any(b['type'] == 'summary' and b['items'] for b in out) else \
            [b for b in out if not (b['type'] == 'summary' and not b['items'])]
        if mistakes:
            k = next((i for i, b in enumerate(out) if b['type'] == 'summary'), -1) + 1
            out.insert(k, {'type': 'callout', 'variant': 'common_error', 'title': 'Common mistakes', 'items': mistakes, 'origin': 'source',
                           'pages': [self.p1, self.p1]})
        out.append({'type': 'callout', 'variant': 'editorial', 'origin': 'editorial', 'title': 'Revisit your first call',
                    'md': f'Look back at the decision you wrote at the start: *{plain(decision)}* Would you decide differently now? The worked application shows the guide\'s reasoning.'})
        if not any(b['type'] == 'summary' for b in out):
            self.flags.append('review has no Summary paragraph')
        return out


# ---------------------------------------------------------------------------- package
def convert(cid):
    ch = Chapter(cid)
    sections = ch.run()
    # pages: clamp to chapter range; Opening scenario block spans first pages
    for s in sections:
        for b in s['blocks']:
            if 'pages' in b and b['pages']:
                b['pages'] = [max(ch.p0, min(ch.p1, b['pages'][0])), max(ch.p0, min(ch.p1, b['pages'][1]))]
        for a in s['activities']:
            pass
    # overlay text fixes: {"fixes": [{"find": "...", "replace": "..."}]}
    blob = json.dumps(sections, ensure_ascii=False)
    for fx in ch.ovl.get('fixes', []):
        if fx['find'] not in blob:
            ch.flags.append(f'overlay fix not applied (text not found): {fx["find"][:60]}')
        blob = blob.replace(json.dumps(fx['find'], ensure_ascii=False)[1:-1], json.dumps(fx['replace'], ensure_ascii=False)[1:-1])
    sections = json.loads(blob)
    # obsolete editorial notes from the drafting process never reach students
    for s in sections:
        for b in s['blocks']:
            for k in ('md', 'body'):
                if k in b and isinstance(b[k], str):
                    b[k] = re.sub(r'\s*\((?:pilot chapter|drafted below|drafted in this tab)[^)]*\)', '', b[k])
    est = sum(s['est_minutes'] for s in sections)
    acts = [a for s in sections for a in s['activities']]
    m = ch.m
    pkg = {
        'id': cid,
        'est_minutes': est,
        'review_status': ch.ovl.get('review_status', 'draft'),
        'meta': {
            'summary': None,
            'outcomes': [],
            'source': {'edition': EDITION, 'pages': [ch.p0, ch.p1], 'heading_title': m['heading_title'],
                       'subtitle': plain(m.get('subtitle', '')), 'objectives': m['objectives']},
            'checks': {
                **ch.checks,
                'sections': len(sections),
                'activities': len(acts),
                'required_activities': sum(1 for a in acts if a.get('required', True)),
                'flags': ch.flags,
                'numbers_recomputed': ch.ovl.get('numbers_recomputed', False),
                'equations_verified': ch.ovl.get('equations_verified', False),
                'pipeline': 'scripts/csp-sps/pipeline/convert.py',
                'equation_sources': ch.eqmap,
            },
        },
        'sections': sections,
    }
    # outcomes = learning objectives list from section 1
    for b in sections[0]['blocks']:
        if b['type'] == 'list' and b.get('ordered'):
            pkg['meta']['outcomes'] = [plain(t) for t in b['items']]
            break
    summ = next((b for s in sections for b in s['blocks'] if b['type'] == 'summary'), None)
    pkg['meta']['summary'] = re.sub(r'^[A-Z][\w ,/-]{0,40}\.\s+(?=[A-Z])', '', plain(summ['items'][0])) if summ and re.match(r'^\*\*', summ['items'][0]) else (plain(summ['items'][0]) if summ else None)
    if not pkg['meta']['summary']:
        pkg['meta'].pop('summary')
    os.makedirs(OUT, exist_ok=True)
    json.dump(pkg, open(f'{OUT}/{cid}.json', 'w'), ensure_ascii=False, indent=1)
    return pkg


if __name__ == '__main__':
    ids = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--all' in sys.argv:
        ids = [c['id'] for c in MAN['chapters']]
    for cid in ids:
        p = convert(cid)
        c = p['meta']['checks']
        print(f"{cid}: {c['sections']} sections, {c['activities']} activities ({c['questions']} MCQ, {c['required_activities']} required), "
              f"{c['tables']} tables, {c['figures']} figures, {c['equations_auto']}+{c.get('equations_text', 0)} equations, {len(c['flags'])} flags, ~{p['est_minutes']} min")
        if '--show' in sys.argv:
            for f in c['flags']:
                print('   ', f)
