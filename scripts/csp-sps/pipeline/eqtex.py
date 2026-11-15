"""Rebuild TeX for KaTeX-typeset display equations from their glyph layout.

The guide's equations were typeset with KaTeX and printed to PDF, so the TeX source is
gone but the glyphs keep their KaTeX font names, sizes and positions:

* fraction bars are thin filled rectangles (height < 1.2 pt); numerator glyphs sit above,
  denominator glyphs below, within the bar's x-span;
* sub/superscripts are smaller glyphs below/above the row baseline;
* KaTeX_Math-Italic letters are math variables; KaTeX_Main-Regular letters are upright text
  (units, function names, \\text{} runs, which also carry real space glyphs);
* KaTeX_Size* fonts are stretched delimiters.

`rebuild(page, bbox)` returns (tex, alt, notes). Every result must still be compared with the
printed page by a reviewer; the converter records that as a check flag.
"""
import re

GREEK = {'α': r'\alpha', 'β': r'\beta', 'γ': r'\gamma', 'δ': r'\delta', 'ε': r'\varepsilon', 'ϵ': r'\epsilon',
         'θ': r'\theta', 'λ': r'\lambda', 'μ': r'\mu', 'ν': r'\nu', 'π': r'\pi', 'ρ': r'\rho', 'σ': r'\sigma',
         'τ': r'\tau', 'φ': r'\phi', 'ϕ': r'\phi', 'ω': r'\omega', 'η': r'\eta', 'κ': r'\kappa', 'χ': r'\chi', 'ψ': r'\psi',
         'Δ': r'\Delta', 'Σ': r'\Sigma', 'Ω': r'\Omega', 'Φ': r'\Phi', 'Θ': r'\Theta', 'Λ': r'\Lambda', 'Π': r'\Pi', 'Γ': r'\Gamma'}
SYM = {'×': r'\times ', '÷': r'\div ', '−': '-', '·': r'\cdot ', '⋅': r'\cdot ', '≤': r'\le ', '≥': r'\ge ', '≈': r'\approx ',
       '≠': r'\ne ', '⇒': r'\Rightarrow ', '→': r'\to ', '←': r'\leftarrow ', '±': r'\pm ', '∞': r'\infty ', '∝': r'\propto ',
       '⌈': r'\lceil ', '⌉': r'\rceil ', '⌊': r'\lfloor ', '⌋': r'\rfloor ', '∑': r'\sum ', '∏': r'\prod ', '√': r'\surd ',
       '%': r'\%', '&': r'\&', '#': r'\#', '$': r'\$', '_': r'\_', '{': r'\{', '}': r'\}', '°': r'^\circ ', '′': "'",
       '∆': r'\Delta ', '…': r'\ldots ', '⋯': r'\cdots ', '∣': r'\mid ', '|': r'\vert ', '∈': r'\in ', '≡': r'\equiv ',
       '∠': r'\angle ', '△': r'\triangle ', '⟹': r'\Longrightarrow ', '∴': r'\therefore ', '−': '-', '∕': '/', '‰': r'\text{‰}',
       '½': r'\tfrac{1}{2}', '¼': r'\tfrac{1}{4}', '¾': r'\tfrac{3}{4}', '⅓': r'\tfrac{1}{3}',
       '⎧': '', '⎨': '', '⎩': '', '⎪': '', '⎫': '', '⎬': '', '⎭': '', '⎛': '(', '⎝': '(', '⎞': ')', '⎠': ')', '⎜': '', '⎟': '',
       '“': '``', '”': "''", '’': "'", '‘': '`', '–': '-', '—': '-', ' ': ' ', ' ': ' '}
ALT = {'×': ' × ', '÷': ' ÷ ', '−': ' − ', '=': ' = ', '≤': ' ≤ ', '≥': ' ≥ ', '≈': ' ≈ ', '⇒': ' ⇒ ', '+': ' + '}

BAR_MAX_H = 1.2


def _font(c):
    return c['fontname'].split('+')[-1]


def _is_space(c):
    return c['text'].strip() == '' or c['size'] < 2


def _upright_letter(c):
    if c.get('accent'):
        return False
    f = _font(c)
    return c['text'].isalpha() and len(c['text']) == 1 and ('Main' in f or 'SansSerif' in f or 'Typewriter' in f) and c['text'] not in GREEK


DELIM_SIZE = {'Size1': r'\big', 'Size2': r'\Big', 'Size3': r'\bigg', 'Size4': r'\Bigg'}


def _tex_char(c):
    if c.get('_tex'):
        return c['_tex']
    t = c['text']
    f = _font(c)
    for k, cmd in DELIM_SIZE.items():
        if k in f and t in '()[]|':
            return cmd + t + ' '
        if k in f and t in '{}':
            return cmd + '\\' + t + ' '
        if k in f and t in '⌈⌉⌊⌋':
            return cmd + SYM[t]
    if c.get('accent'):
        inner = GREEK.get(t, t)
        return c['accent'] + '{' + inner.strip() + '}'
    if t in GREEK:
        return GREEK[t] + ' '
    if t in SYM:
        return SYM[t]
    return t


ACCENTS = {'ˉ': r'\bar', '¯': r'\bar', '˙': r'\dot', '^': r'\hat', 'ˆ': r'\hat', '˜': r'\tilde', '→': r'\vec'}


def _accents(chars):
    """Accent glyphs (x̄, Ḋ) sit above a base glyph: fold them into the base as a TeX accent."""
    out = []
    accs = [c for c in chars if c['text'] in ACCENTS and (c['x1'] - c['x0']) < 8]
    for c in chars:
        if c in accs:
            continue
        out.append(c)
    for a in accs:
        mid = (a['x0'] + a['x1']) / 2
        base = min((c for c in out if c['top'] > a['top'] and c['x0'] - 2 <= mid <= c['x1'] + 2), key=lambda c: abs((c['x0'] + c['x1']) / 2 - mid), default=None)
        if base is None:
            out.append(a); continue
        base['accent'] = ACCENTS[a['text']]
    return out


def _linear(chars):
    """One row (no fraction bars): handle sub/superscripts, upright text runs and spaces."""
    chars = _accents([c for c in chars if c['size'] >= 2 or c['text'].strip()])
    if not chars:
        return '', ''
    big = [c for c in chars if not _is_space(c)]
    if not big:
        return '', ''
    base_size = max(c['size'] for c in big)
    main = [c for c in big if c['size'] >= base_size * 0.86]
    base = sorted(c['bottom'] for c in main)[len(main) // 2] if main else big[0]['bottom']
    chars = sorted(chars, key=lambda c: c['x0'])

    def kind(c):
        if _is_space(c) or c['size'] >= base_size * 0.86:
            return None
        # KaTeX raises superscripts well above the baseline but lowers subscripts only slightly
        return 'sup' if c['bottom'] < base - 1.2 else 'sub'

    groups = []  # (kind, [chars])
    prev = None
    for c in chars:
        if prev is not None and not _is_space(c) and c['x0'] - prev['x1'] > 7 and c['size'] >= base_size * 0.86:
            groups.append(('gap', []))
        if not _is_space(c):
            prev = c
        k = kind(c)
        if groups and groups[-1][0] == k:
            groups[-1][1].append(c)
        else:
            groups.append((k, [c]))
    # consecutive script groups attached to one base (KaTeX stacks _ and ^ at the same x): merge
    merged = []
    for k, cs in groups:
        if k in ('sub', 'sup') and merged and merged[-1][0] == 'scripts':
            merged[-1][1].setdefault(k, []).extend(cs)
        elif k in ('sub', 'sup'):
            merged.append(('scripts', {k: list(cs)}))
        else:
            merged.append((k, cs))
    groups = []
    for k, cs in merged:
        if k == 'scripts':
            if 'sub' in cs:
                groups.append(('sub', sorted(cs['sub'], key=lambda c: c['x0'])))
            if 'sup' in cs:
                groups.append(('sup', sorted(cs['sup'], key=lambda c: c['x0'])))
        else:
            groups.append((k, cs))
    tex, alt = '', ''
    for k, cs in groups:
        if k == 'gap':
            tex += r' \qquad '; alt += ';  '
            continue
        t, a = (_linear(cs) if k else _run(cs))
        if not t.strip():
            if k is None:
                tex += ' '; alt += ' '
            continue
        if k == 'sup':
            tex += '^{' + t.strip() + '}'; alt += '^' + (a.strip() if len(a.strip()) <= 2 else '(' + a.strip() + ')')
        elif k == 'sub':
            tex += '_{' + t.strip() + '}'; alt += '_' + a.strip()
        else:
            tex += t; alt += a
    return tex, alt


def _run(cs):
    """Same-level glyphs: upright letter runs become \\text{...} (keeping spaces), the rest maps by symbol."""
    tex, alt = '', ''
    i = 0
    while i < len(cs):
        c = cs[i]
        if _upright_letter(c):
            j = i; txt = ''
            prev = None
            while j < len(cs) and (_upright_letter(cs[j]) or (_is_space(cs[j]) and cs[j]['size'] >= 2) or
                                   (cs[j]['text'] in "()-/.,'0123456789" and j + 1 < len(cs) and _upright_letter(cs[j + 1]) and txt)):
                if prev is not None and cs[j]['x0'] - prev['x1'] > 2.2 and not _is_space(cs[j]) and not txt.endswith(' '):
                    txt += ' '
                txt += ' ' if _is_space(cs[j]) else cs[j]['text']
                prev = cs[j]; j += 1
            stripped = txt.strip()
            if len(stripped) == 1 and not txt.startswith(' ') and not txt.endswith(' '):
                tex += r'\mathrm{' + stripped + '}'
            elif stripped in ('exp', 'ln', 'log', 'sin', 'cos', 'tan', 'max', 'min', 'lim'):
                tex += '\\' + stripped + ' '
            else:
                lead = r'\ ' if txt.startswith(' ') else ''
                tail = r'\ ' if txt.endswith(' ') and stripped else ''
                tex += lead + r'\text{' + stripped.replace('%', r'\%').replace('&', r'\&').replace('#', r'\#').replace('$', r'\$') + '}' + tail
            alt += txt
            i = j
            continue
        if _is_space(c):
            if c['size'] >= 2:
                tex += r'\ '; alt += ' '
            i += 1
            continue
        t = c['text']
        # thousands separator inside a number: 1,000 -> 1{,}000
        if t == ',' and i > 0 and i + 1 < len(cs) and cs[i - 1]['text'].isdigit() and cs[i + 1]['text'].isdigit() \
                and cs[i + 1]['x0'] - c['x1'] < 1.5:
            tex += '{,}'; alt += ','
        else:
            tex += _tex_char(c); alt += c.get('_alt') or ALT.get(t, t)
        i += 1
    return tex, alt


def _radicand(chars, r):
    """Glyphs under a radical: right of its hook, inside its height, up to the first wide gap."""
    cand = sorted([c for c in chars if c['x0'] >= r['x0'] + 5 and r['top'] - 1 <= (c['top'] + c['bottom']) / 2 <= r['bottom'] + 1],
                  key=lambda c: c['x0'])
    out, prev = [], None
    for c in cand:
        if _is_space(c):
            continue
        if prev is not None and c['x0'] - prev['x1'] > 9:
            break
        if out and c['text'] in '=≈<>≤≥⇒→' and c['size'] >= max(o['size'] for o in out) * 0.95:
            break  # a relation at full size ends the radicand
        if prev is None and c['x0'] - r['x0'] > 16:
            break
        out.append(c); prev = c
    return out


def _layout(chars, bars, rads=()):
    """Recursive: radicals and top-level fraction bars split chars into parts; the rest is a row."""
    if rads:
        r = min(rads, key=lambda r: r['x0'])
        inner = _radicand(chars, r)
        ids = {id(c) for c in inner}
        x1 = max([c['x1'] for c in inner] + [r['x0'] + 8])
        in_bars = [b for b in bars if b['x0'] >= r['x0'] + 4 and b['x1'] <= x1 + 4 and r['top'] - 1 <= b['top'] <= r['bottom'] + 1]
        rest_r = [o for o in rads if o is not r]
        in_rads = [o for o in rest_r if r['x0'] < o['x0'] <= x1]
        t, a = _layout(inner, in_bars, in_rads)
        token = {'x0': r['x0'], 'x1': x1, 'top': r['top'], 'bottom': r['bottom'], 'size': 11.1, 'fontname': 'KaTeX_Main-Regular',
                 'text': '\x00', '_tex': r'\sqrt{' + t.strip() + '}', '_alt': '√(' + a.strip() + ')'}
        others = [c for c in chars if id(c) not in ids] + [token]
        return _layout(others, [b for b in bars if b not in in_bars], [o for o in rest_r if o not in in_rads])
    if not bars:
        return _linear(chars)
    tops = [b for b in bars if not any(o is not b and o['x0'] - 0.5 <= b['x0'] and b['x1'] <= o['x1'] + 0.5 and (o['x1'] - o['x0']) > (b['x1'] - b['x0']) + 0.5 for o in bars)]
    tops.sort(key=lambda b: b['x0'])
    used = set()
    tokens = []  # (x, tex, alt)
    for b in tops:
        mid = (b['top'] + b['bottom']) / 2
        inside = [c for c in chars if b['x0'] - 0.8 <= (c['x0'] + c['x1']) / 2 <= b['x1'] + 0.8]
        num = [c for c in inside if (c['top'] + c['bottom']) / 2 < mid]
        den = [c for c in inside if (c['top'] + c['bottom']) / 2 > mid]
        for c in num + den:
            used.add(id(c))
        nb = [o for o in bars if o is not b and b['x0'] - 0.5 <= o['x0'] and o['x1'] <= b['x1'] + 0.5]
        n_t, n_a = _layout(num, [o for o in nb if (o['top'] + o['bottom']) / 2 < mid])
        d_t, d_a = _layout(den, [o for o in nb if (o['top'] + o['bottom']) / 2 > mid])
        def wrap(a):
            a = a.strip()
            return a if re.fullmatch(r'[\w.,]+', a) else '(' + a + ')'
        if not num and den:
            tokens.append((b['x0'], r'\overline{' + d_t.strip() + '}', 'mean of ' + wrap(d_a), b['x1']))
        elif num and not den:
            tokens.append((b['x0'], r'\underline{' + n_t.strip() + '}', n_a, b['x1']))
        else:
            tokens.append((b['x0'], r'\dfrac{' + n_t.strip() + '}{' + d_t.strip() + '}', wrap(n_a) + ' ÷ ' + wrap(d_a), b['x1']))
    rest = [c for c in chars if id(c) not in used]
    # split the rest into runs between fractions so sub/superscripts are judged per run
    edges = [b['x0'] for b in tops] + [1e9]
    runs = []
    prev_edge = -1e9
    for k, e in enumerate(edges):
        seg = [c for c in rest if prev_edge <= c['x0'] < e]
        if seg:
            t, a = _linear(seg)
            runs.append((min(c['x0'] for c in seg), t, a, max(c['x1'] for c in seg)))
        prev_edge = tops[k]['x1'] if k < len(tops) else e
    toks = sorted(runs + tokens, key=lambda x: x[0])
    tex, alt = '', ''
    prev_x1 = None
    for x, t, a, xe in toks:
        if prev_x1 is not None and x - prev_x1 > 7:
            tex += r' \qquad '; alt += ';  '
        tex += t; alt += ' ' + a.strip()
        prev_x1 = xe
    return tex, alt


def tidy(tex):
    tex = re.sub(r'(\\ )+', r'\\ ', tex)
    tex = re.sub(r'(\\ |\s)+$', '', tex)
    tex = re.sub(r'\s+', ' ', tex).strip()
    tex = re.sub(r'^(\\ )+|(\\ )+$', '', tex).strip()
    return tex


def rebuild(page, bbox):
    """page: pdfplumber page; bbox: (x0, top, x1, bottom). Returns (tex, alt, notes)."""
    x0, top, x1, bottom = bbox
    chars = [c for c in page.chars if 'KaTeX' in c['fontname'] and x0 - 1 <= c['x0'] and c['x1'] <= x1 + 1
             and top - 1 <= c['top'] and c['bottom'] <= bottom + 1]
    bars = [r for r in page.rects if r['height'] < BAR_MAX_H and r['width'] > 3 and x0 - 2 <= r['x0'] and r['x1'] <= x1 + 2
            and top - 1 <= r['top'] <= bottom + 1]
    notes = []
    # radicals: a filled path (its right edge is clipped in the PDF, so x1 is meaningless) with a vinculum
    rads = [c for c in page.curves if c.get('fill') and top - 3 <= c['top'] <= bottom and c['bottom'] - c['top'] >= 8
            and x0 - 2 <= c['x0'] <= x1 and (c['x1'] - c['x0']) > 40]
    rads = [dict(top=r['top'], bottom=min(r['bottom'], bottom + 2), x0=r['x0']) for r in rads]
    bars = [b for b in bars if not any(abs(b['top'] - r['top']) < 0.8 and b['x0'] - r['x0'] < 14 for r in rads)]
    if any('Size' in _font(c) for c in chars):
        notes.append('stretched delimiters')
    if any(c['text'] in '⎧⎨⎩⎪⎫⎬⎭' for c in chars):
        notes.append('brace (cases) layout: rebuilt without the brace; needs a hand-written TeX override')
    if rads:
        notes.append(f'{len(rads)} radical(s) rebuilt from drawn paths')
    # split into vertical bands that do not overlap (separate stacked equations)
    spans = sorted([(c['top'], c['bottom']) for c in chars if not _is_space(c)] + [(b['top'] - 1, b['bottom'] + 1) for b in bars]
                   + [(r['top'], r['bottom']) for r in rads])
    bands = []
    for a, b in spans:
        if bands and a < bands[-1][1] - 0.5:
            bands[-1][1] = max(bands[-1][1], b)
        else:
            bands.append([a, b])
    if len(bands) > 1:
        rows = []
        for a, b in bands:
            rc = [c for c in chars if a - 0.1 <= (c['top'] + c['bottom']) / 2 <= b + 0.1]
            rb = [r for r in bars if a - 1.5 <= r['top'] <= b + 1.5]
            rr = [r for r in rads if a - 2 <= r['top'] <= b + 2]
            if rc:
                rows.append(_layout(rc, rb, rr))
        tex = r'\begin{gathered}' + r' \\ '.join(tidy(t) for t, _ in rows) + r'\end{gathered}'
        alt = ';  '.join(re.sub(r'\s+', ' ', a).strip() for _, a in rows)
        notes.append(f'{len(rows)} stacked rows')
        return tex, alt, notes
    tex, alt = _layout(chars, bars, rads)
    alt = re.sub(r'\s+', ' ', alt).strip()
    return tidy(tex), alt, notes


# ---------------------------------------------------------------------------- text-set formulas
def _balanced(s, i):
    """s[i] == '(' -> index of matching ')' or -1."""
    depth = 0
    for k in range(i, len(s)):
        if s[k] == '(':
            depth += 1
        elif s[k] == ')':
            depth -= 1
            if depth == 0:
                return k
    return -1


SUPS = {'²': '2', '³': '3', '¹': '1', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', 'ⁿ': 'n'}
SUBS = {'₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ₐ': 'a', 'ₑ': 'e',
        'ₓ': 'x', 'ᵢ': 'i', 'ⱼ': 'j', 'ₙ': 'n', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', '₍': '(', '₎': ')', 'ₗ': 'l', 'ₘ': 'm', 'ₖ': 'k', 'ₕ': 'h'}


def text_tex(src):
    """Linear formula typed as text (e.g. 'C\\(_{req}\\) = FF + DD + HS + SM') -> (tex, alt)."""
    s = re.sub(r'\*+', '', src).strip()
    alt = re.sub(r'\\\(([_^])\{([^}]*)\}\\\)', lambda m: ('_' if m.group(1) == '_' else '^') + m.group(2), s)
    # protect inline script markers
    s = re.sub(r'\\\(([_^])\{([^}]*)\}\\\)', lambda m: '\x01' + m.group(1) + m.group(2) + '\x02', s)
    s = re.sub('[' + ''.join(SUPS) + ']+', lambda m: '\x01^' + ''.join(SUPS[c] for c in m.group(0)) + '\x02', s)
    s = re.sub('[' + ''.join(SUBS) + ']+', lambda m: '\x01_' + ''.join(SUBS[c] for c in m.group(0)) + '\x02', s)
    out, i = '', 0
    while i < len(s):
        c = s[i]
        if c == '\x01':
            j = s.index('\x02', i)
            body = s[i + 2:j]
            body_t = re.sub(r'([A-Za-z]{2,})', r'\\text{\1}', body) if s[i + 1] == '_' and len(body) > 1 and body.isalpha() else body
            out += s[i + 1] + '{' + body_t.replace('−', '-') + '}'
            i = j + 1; continue
        if c == '√':
            if i + 1 < len(s) and s[i + 1] == '(':
                j = _balanced(s, i + 1)
                if j > 0:
                    inner, _ = text_tex(s[i + 2:j].replace('\x01', '').replace('\x02', ''))
                    out += r'\sqrt{' + inner + '}'
                    i = j + 1; continue
            m = re.match(r'√([\d.,]+|[A-Za-z])', s[i:])
            if m:
                out += r'\sqrt{' + m.group(1) + '}'
                i += len(m.group(0)); continue
        m = re.match(r'[A-Za-z]+(?:-[A-Za-z]+)*', s[i:])
        if m:
            w = m.group(0)
            if '-' in w or (w.islower() and len(w) >= 2) or (w[0].isupper() and w[1:].islower() and len(w) >= 3) \
                    or (w.isupper() and len(w) >= 2 and re.match(r' [a-z]{2,}', s[i + len(w):])):
                # words, units and labels such as "AND gate" are upright text
                j = i + len(w)
                while True:
                    m2 = re.match(r' ([a-z]{2,}(?:-[a-z]+)*|[A-Z][a-z]{2,}|[A-Z]{2,}(?= [a-z]))', s[j:])
                    if not m2:
                        break
                    j += len(m2.group(0))
                out += r'\text{' + s[i:j] + '}'
                i = j; continue
            out += w; i += len(w); continue
        if c == ' ':
            nxt = s[i + 1:i + 2]
            # keep a visible space next to upright text, units and degree signs
            if out.endswith('}') and r'\text{' in out[-60:] or out.endswith('^\\circ ') or out.endswith('{:}') or \
                    (nxt and (nxt.isalpha() and re.match(r'[a-z]{2,}', s[i + 1:i + 3]))):
                out += r'\ '
            else:
                out += ' '
            i += 1; continue
        if c == ':' and i + 1 < len(s) and s[i + 1] == ' ':
            out += '{:}'; i += 1; continue
        if c in GREEK:
            out += GREEK[c] + ' '; i += 1; continue
        if c == ',' and i > 0 and i + 1 < len(s) and s[i - 1].isdigit() and s[i + 1].isdigit() and (i + 3 < len(s) and s[i + 1:i + 4].isdigit()):
            out += '{,}'; i += 1; continue
        out += SYM.get(c, c); i += 1
    tex = re.sub(r'\s+', ' ', out).strip()
    # a unit after a number: "17.5 ft" -> 17.5\ \text{ft}
    tex = re.sub(r'(\d) \\text\{', r'\1\\ \\text{', tex)
    return tex, alt
