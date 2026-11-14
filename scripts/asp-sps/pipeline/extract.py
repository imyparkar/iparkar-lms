"""Layout-aware extractor for the iParkar ASP Exam Study Guide PDF.

Turns a chapter's pages into a list of raw blocks using the PDF's drawing:
table header fills + row rules, worked-example rows, orange callout bars,
heading sizes, bullet glyphs and two-column end matter. Output feeds convert.py.
"""
import os
import json, logging, re, sys, collections
import pdfplumber

logging.disable(logging.WARNING)
PDF = pdfplumber.open(os.environ.get('ASP_GUIDE_PDF', 'guide.pdf'))

HEAD_FILL = (0.969, 0.937, 0.914)
RULE = (0.09, 0.09, 0.09)
BAR = (1.0, 0.435, 0.118)


def col(r):
    c = r.get('non_stroking_color')
    return tuple(round(v, 3) for v in c) if isinstance(c, (list, tuple)) and len(c) == 3 else None


def close(a, b, t=0.02):
    return a is not None and all(abs(x - y) <= t for x, y in zip(a, b))


class Line:
    def __init__(self, words):
        self.words = sorted(words, key=lambda w: w['x0'])
        self.top = min(w['top'] for w in words)
        self.bottom = max(w['bottom'] for w in words)
        self.x0 = self.words[0]['x0']
        self.x1 = max(w['x1'] for w in words)
        sizes = collections.Counter()
        fonts = collections.Counter()
        for w in words:
            sizes[round(w['size'], 1)] += len(w['text'])
            fonts[w['fontname'].split('+')[-1]] += len(w['text'])
        self.size = sizes.most_common(1)[0][0]
        self.font = fonts.most_common(1)[0][0]
        main = [w for w in words if round(w['size'], 1) == self.size]
        base = sorted(w['bottom'] for w in main)[len(main) // 2] if main else self.bottom
        self.base = base
        self.text = join_words(self.words, self.size, base, self.font)

    def __repr__(self):
        return f"<{self.top:.0f} x{self.x0:.0f} s{self.size} {self.text[:60]}>"


def join_words(ws, size=None, base=None, font=None):
    """Join words; runs of smaller raised/lowered words become inline TeX super/subscripts."""
    def kind(w):
        if size and base is not None and w['size'] < size * 0.87 and len(w['text']) < 30 \
                and (font is None or w['fontname'].split('+')[-1].split('-')[0] == font.split('-')[0]):
            if w['bottom'] < base - 1.5:
                return 'sup'
            if w['bottom'] > base + 1.0:
                return 'sub'
        return None
    out, prev, run, runkind = '', None, [], None

    def close_run():
        nonlocal out, run, runkind
        if run:
            body = ' '.join(run).replace('−', '-')
            out += ('\\(^{' if runkind == 'sup' else '\\(_{') + body + '}\\)'
        run, runkind = [], None

    for w in ws:
        k = kind(w)
        gap = prev is not None and w['x0'] - prev['x1'] > 0.8
        if k:
            if runkind != k:
                close_run()
                if gap:
                    out += ' '
                runkind = k
            run.append(w['text'])
        else:
            close_run()
            if gap:
                out += ' '
            out += w['text']
        prev = w
    close_run()
    return out


def group_lines(words, tol=4.0):
    words = sorted(words, key=lambda w: (round(w['top']), w['x0']))
    lines = []
    mids = []
    for w in words:
        mid = (w['top'] + w['bottom']) / 2
        best = None
        for k, ln in enumerate(lines):
            d = abs(mids[k] - mid)
            if d <= tol and (best is None or d < best[0]):
                best = (d, k)
        if best:
            k = best[1]
            lines[k].append(w)
            big = [x for x in lines[k] if x['size'] >= 8.6] or lines[k]
            mids[k] = sorted((x['top'] + x['bottom']) / 2 for x in big)[len(big) // 2]
        else:
            lines.append([w]); mids.append(mid)
    # merge stray sub/superscript-only lines into the main line they belong to
    def small(ws):
        return all(w['size'] < 8.6 and len(w['text']) <= 6 for w in ws)
    merged = []
    raw = sorted(lines, key=lambda l: min(w['top'] for w in l))
    for ln in raw:
        if small(ln) and len(ln) <= 12:
            mid = sum((w['top'] + w['bottom']) / 2 for w in ln) / len(ln)
            host = None
            for other in raw:
                if other is ln or small(other):
                    continue
                omid = sum((w['top'] + w['bottom']) / 2 for w in other) / len(other)
                ox0 = min(w['x0'] for w in other); ox1 = max(w['x1'] for w in other)
                if abs(omid - mid) <= 7.5 and ox0 - 5 <= min(w['x0'] for w in ln) <= ox1 + 5:
                    if host is None or abs(omid - mid) < host[0]:
                        host = (abs(omid - mid), other)
            if host:
                host[1].extend(ln)
                continue
        merged.append(ln)
    lines = [l for l in merged]
    return sorted([Line(l) for l in lines], key=lambda l: l.top)


def page_parts(pn):
    """Return page geometry: words (minus header/footer), tables, callout bars, bullets."""
    p = PDF.pages[pn - 1]
    words = p.extract_words(extra_attrs=['size', 'fontname'], keep_blank_chars=False, x_tolerance=1.2)
    words = [w for w in words if 45 < w['top'] < 795]
    rects = [r for r in p.rects if r['width'] < 580]
    fills = [r for r in rects if close(col(r), HEAD_FILL) and r['height'] > 8]
    rules = [r for r in rects if close(col(r), RULE) and r['height'] < 2.5]
    bars = [r for r in rects if close(col(r), BAR, 0.05) and r['width'] < 4 and r['height'] > 10]
    bullets = [c for c in p.curves if (c['x1'] - c['x0']) < 6 and (c['bottom'] - c['top']) < 6]
    # tables: header fills grouped by top
    heads = collections.defaultdict(list)
    for f in fills:
        heads[round(f['top'])].append(f)
    tables = []
    for top, cells in sorted(heads.items()):
        cells = sorted(cells, key=lambda r: r['x0'])
        x0, x1 = cells[0]['x0'], cells[-1]['x1']
        hb = max(c['bottom'] for c in cells)
        c0 = cells[0]
        nexttop = min([f['top'] for f in fills if f['top'] > top + 3] + [9999])
        ys = sorted({round(r['top'], 1) for r in rules
                     if abs(r['x0'] - c0['x0']) < 3 and abs(r['x1'] - c0['x1']) < 3 and hb - 2 <= r['top'] < nexttop - 1})
        kept = []
        for y in ys:
            if kept and y - kept[-1] > 200:
                break
            kept.append(y)
        if not kept:
            kept = [hb]
        tables.append({'top': top, 'hbottom': hb, 'bottom': kept[-1], 'x0': x0, 'x1': x1,
                       'cols': [(c['x0'], c['x1']) for c in cells], 'rows': kept})
    return p, words, tables, bars, bullets, rules


def cell_text(ws):
    if not ws:
        return ''
    lines = group_lines(ws)
    return dehyphen(' '.join(l.text for l in lines))


VOCAB = None


def vocab():
    global VOCAB
    if VOCAB is None:
        txt = open(os.environ.get('ASP_GUIDE_TEXT', 'guide.txt'), encoding='utf-8').read().lower()
        VOCAB = set(re.findall(r"[a-z]+", txt))
    return VOCAB


def dehyphen(s):
    def fix(m):
        a, b = m.group(1), m.group(2)
        return a + b if (a + b).lower() in vocab() and not re.search(r'\d', a) else a + '-' + b
    s = re.sub(r'([A-Za-z]+)- ([a-z][A-Za-z]*)', fix, s)
    return s.replace('\x02', '')


def extract_table(t, words):
    cols = t['cols']
    # the last row may have no rule under it: extend while table-sized words continue
    body_sizes = collections.Counter(round(w['size'], 1) for w in words
                                     if t['x0'] - 2 <= w['x0'] <= t['x1'] and t['hbottom'] < w['top'] < t['bottom'])
    bsize = body_sizes.most_common(1)[0][0] if body_sizes else 9.5
    below = sorted([w for w in words if t['x0'] - 2 <= w['x0'] <= t['x1'] and w['top'] > t['bottom'] + 1 and abs(w['size'] - bsize) < 0.2],
                   key=lambda w: w['top'])
    end = t['bottom']
    for w in below:
        if w['top'] - end > 14:
            break
        end = max(end, w['bottom'])
    if end > t['bottom'] + 1:
        t = dict(t, rows=t['rows'] + [end + 2], bottom=end + 2)
    bands = [t['top'] - 1] + [t['hbottom']] + [y for y in t['rows'] if y > t['hbottom'] + 2]
    inside = [w for w in words if t['x0'] - 2 <= (w['x0'] + w['x1']) / 2 <= t['x1'] + 2 and t['top'] - 2 <= w['top'] <= t['bottom'] + 1]
    grid = []
    for i in range(len(bands) - 1):
        ya, yb = bands[i], bands[i + 1]
        row = []
        for (cx0, cx1) in cols:
            ws = [w for w in inside if cx0 - 2 <= w['x0'] < cx1 - 1 and ya - 1 <= (w['top'] + w['bottom']) / 2 < yb]
            row.append(cell_text(ws))
        if any(row):
            grid.append(row)
    used = {id(w) for w in inside}
    return grid, used


def chapter_lines(p0, p1):
    """All logical items of the chapter in reading order, with tables pre-extracted."""
    items = []
    carry = None
    for pn in range(p0, p1 + 1):
        p, words, tables, bars, bullets, rules = page_parts(pn)
        used = set()
        if carry is not None:
            # a table whose header row ended the previous page: its rows start at the top of this page
            c0 = carry['cols'][0]
            first_fill = min([t['top'] for t in tables] + [9999])
            ys = sorted({round(r['top'], 1) for r in rules if abs(r['x0'] - c0[0]) < 3 and abs(r['x1'] - c0[1]) < 3 and r['top'] < first_fill - 1})
            if ys:
                t = {'top': 50, 'hbottom': 50, 'bottom': ys[-1], 'x0': carry['x0'], 'x1': carry['x1'], 'cols': carry['cols'],
                     'rows': [y for y in ys]}
                grid, u = extract_table(t, words)
                used |= u
                rows = [r for r in grid if any(r)]
                items.append({'kind': 'table', 'page': pn, 'top': 50, 'header': carry['header'], 'rows': rows, 'continued': True})
            carry = None
        for t in tables:
            grid, u = extract_table(t, words)
            used |= u
            header, rows = (grid[0] if grid else []), grid[1:]
            if not rows and t['hbottom'] > 700:
                carry = dict(t, header=header)   # header only at the foot of the page
                continue
            items.append({'kind': 'table', 'page': pn, 'top': t['top'], 'header': header, 'rows': rows})
        rest = [w for w in words if id(w) not in used]
        try:
            p.flush_cache()
            p.get_textmap.cache_clear()
        except Exception:
            pass
        lines = group_lines(rest)
        for ln in lines:
            # split two-column lines (gap across the page middle)
            parts = split_columns(ln)
            for k, part in enumerate(parts):
                bar = next((b for b in bars if b['top'] - 3 <= part.top <= b['bottom'] + 3 and part.x0 > b['x0']), None)
                bul = any(abs(((b['top'] + b['bottom']) / 2) - ((part.top + part.bottom) / 2)) < 7 and 0 < part.x0 - b['x1'] < 18 for b in bullets)
                items.append({'kind': 'line', 'page': pn, 'top': part.top, 'x0': round(part.x0), 'x1': round(part.x1),
                              'size': part.size, 'font': part.font, 'text': dehyphen(part.text),
                              'bar': round(bar['top']) if bar is not None else None, 'bullet': bul,
                              'column': (len(parts) > 1 and k) or (0 if part.x0 < 290 else (1 if part.x0 > 300 and part.size < 10 else 0)),
                              'words': [(round(w['x0']), w['text'], round(w['size'], 1)) for w in part.words],
                              'left_text': dehyphen(join_words([w for w in part.words if w['x0'] < 128], part.size, part.base, part.font)),
                              'right_text': dehyphen(join_words([w for w in part.words if w['x0'] >= 128], part.size, part.base, part.font))})
    # order: page, then top; tables sit by their top
    items.sort(key=lambda i: (i['page'], i['top']))
    return items


def split_columns(ln):
    if ln.size >= 10.4 or ln.x1 - ln.x0 < 200:
        return [ln]
    left = [w for w in ln.words if w['x1'] <= 300]
    right = [w for w in ln.words if w['x0'] >= 300]
    if left and right and len(left) + len(right) == len(ln.words):
        gap = min(w['x0'] for w in right) - max(w['x1'] for w in left)
        if gap > 6:
            return [Line(left), Line(right)]
    return [ln]


if __name__ == '__main__':
    p0, p1 = int(sys.argv[1]), int(sys.argv[2])
    for it in chapter_lines(p0, p1):
        if it['kind'] == 'table':
            print(f"[{it['page']}] TABLE {it['header']}")
            for r in it['rows']:
                print('     ', r)
        else:
            print(f"[{it['page']} {it['top']:.0f}] x{it['x0']} s{it['size']} {'B' if it['bar'] else ' '}{'•' if it['bullet'] else ' '}c{it['column']} {it['text'][:120]}")
