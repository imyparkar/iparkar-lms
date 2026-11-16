"""Drawing helpers for redrawn CSP figures (SVG in iParkar design tokens).

Every figure is drawn on a 720-unit-wide canvas (the lesson reading width) unless stated. Text uses
Inter inherited from the page. Output must pass src/lib/study/svg.ts (allow-list): only svg, g, path,
rect, circle, ellipse, line, polyline, polygon, text, tspan, title, desc and presentation attributes.
"""
import math

T = dict(ink='#000000', charcoal='#111111', graphite='#615d59', slate='#696969', stone='#757575',
         action='#0075de', sky='#e6f3fe', skywash='#62aef0', coral='#f64932', vermillion='#e32d14',
         peach='#f6d5b8', paper='#f6f5f4', marigold='#ffb110', saffron='#e89d01', midnight='#02093a',
         mocha='#b18164', forest='#2e6f40', olive='#636b2f', moss='#8a9a5b',
         line='rgba(0,0,0,0.2)', grid='rgba(0,0,0,0.08)', soft='rgba(0,0,0,0.35)', white='#ffffff')
FONT = "font-family=\"Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\""
HALO = 'stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def svg(w, h, body, label):
    if isinstance(body, list):
        body = '\n'.join(body)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img" aria-label="{esc(label)}" {FONT} '
            f'style="width:100%;height:auto;display:block">\n{body}\n</svg>\n')


def text(x, y, s, size=13, fill=None, weight=400, anchor='start', halo=False, italic=False, extra=''):
    fill = fill or T['charcoal']
    it = ' font-style="italic"' if italic else ''
    hl = ' ' + HALO if halo else ''
    ex = ' ' + extra if extra else ''
    return f'<text x="{x:g}" y="{y:g}" font-size="{size:g}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{it}{hl}{ex}>{esc(s)}</text>'


def lines(x, y, rows, size=13, lh=None, **kw):
    lh = lh or size * 1.32
    return '\n'.join(text(x, y + i * lh, r, size, **kw) for i, r in enumerate(rows))


def heading(title, sub=None, w=720):
    """Figure title (kept inside the figure) and optional subtitle; returns (list of markup, next_y)."""
    tl = title if isinstance(title, list) else [title]
    out = [lines(0, 20, tl, 16, 21, weight=700)]
    off = 21 * (len(tl) - 1)
    y = 26 + off
    if sub:
        rows = sub if isinstance(sub, list) else [sub]
        out.append(lines(0, 42 + off, rows, 12.5, 17, fill=T['graphite']))
        y = 42 + off + 17 * (len(rows) - 1)
    return out, y + 18


def box(x, y, w, h, title=None, subs=(), hot=False, fill=None, stroke=None, tsize=13.5, ssize=12, rx=8, sw=None,
        title_fill=None, sub_fill=None, align='middle', pad=12, dash=None):
    """Rounded box with a bold title and graphite sub-lines, vertically centred."""
    fill = fill or (T['sky'] if hot else T['white'])
    stroke = stroke or (T['action'] if hot else T['line'])
    sw = sw or (1.75 if hot else 1.25)
    da = f' stroke-dasharray="{dash}"' if dash else ''
    out = [f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{da}/>']
    rows = ([(title, tsize, 700 if True else 400, title_fill or T['charcoal'])] if title else []) + \
           [(s, ssize, 400, sub_fill or T['graphite']) for s in subs]
    if rows:
        lh = [r[1] * 1.3 for r in rows]
        total = sum(lh)
        cy = y + h / 2 - total / 2
        ax = x + w / 2 if align == 'middle' else x + pad
        for (s, sz, wt, col), l in zip(rows, lh):
            cy += l
            out.append(text(ax, cy - l * 0.28, s, sz, col, wt, align if align == 'middle' else 'start'))
    return '\n'.join(out)


def diamond(cx, cy, w, h, label, size=13.5):
    pts = f'{cx:g},{cy - h / 2:g} {cx + w / 2:g},{cy:g} {cx:g},{cy + h / 2:g} {cx - w / 2:g},{cy:g}'
    return (f'<polygon points="{pts}" fill="{T["white"]}" stroke="{T["line"]}" stroke-width="1.25"/>' +
            text(cx, cy + size * 0.35, label, size, weight=700, anchor='middle'))


def arrow(points, color=None, width=1.25, dash=None, head=True, label=None, lx=None, ly=None, lsize=12, lanchor='start'):
    """Polyline connector with an arrowhead at the last point and an optional label."""
    color = color or T['soft']
    d = 'M' + ' L'.join(f'{x:g} {y:g}' for x, y in points)
    da = f' stroke-dasharray="{dash}"' if dash else ''
    out = [f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{da}/>']
    if head and len(points) >= 2:
        (x1, y1), (x2, y2) = points[-2], points[-1]
        a = math.atan2(y2 - y1, x2 - x1)
        s = 7
        p1 = (x2 - s * math.cos(a) + s * 0.5 * math.sin(a), y2 - s * math.sin(a) - s * 0.5 * math.cos(a))
        p2 = (x2 - s * math.cos(a) - s * 0.5 * math.sin(a), y2 - s * math.sin(a) + s * 0.5 * math.cos(a))
        out.append(f'<polygon points="{x2:g},{y2:g} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{color}"/>')
    if label:
        out.append(text(lx, ly, label, lsize, T['graphite'], anchor=lanchor))
    return '\n'.join(out)


def num(x, y, n, r=9.5, fill=None):
    fill = fill or T['charcoal']
    return f'<circle cx="{x:g}" cy="{y:g}" r="{r}" fill="{fill}"/>' + text(x, y + r * 0.44, str(n), r * 1.2, '#fff', 700, 'middle')


def pill(x, y, w, h, s, fill, color=None, size=12, weight=600):
    color = color or T['charcoal']
    return (f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{h / 2:g}" fill="{fill}"/>' +
            text(x + w / 2, y + h / 2 + size * 0.36, s, size, color, weight, 'middle'))


def legend(x, y, items, gap=26, size=12):
    """items: (kind, colour, label) where kind is 'line', 'dash', 'dot', 'box', 'circle'."""
    out, cx = [], x
    for kind, col, lab in items:
        if kind == 'line':
            out.append(f'<path d="M{cx:g} {y - 4:g} h22" stroke="{col}" stroke-width="3"/>'); w = 28
        elif kind == 'dash':
            out.append(f'<path d="M{cx:g} {y - 4:g} h22" stroke="{col}" stroke-width="2" stroke-dasharray="5 4"/>'); w = 28
        elif kind == 'circle':
            out.append(f'<circle cx="{cx + 6:g}" cy="{y - 4:g}" r="5" fill="{col}"/>'); w = 16
        else:
            out.append(f'<rect x="{cx:g}" y="{y - 10:g}" width="12" height="12" rx="3" fill="{col}"/>'); w = 18
        out.append(text(cx + w, y, lab, size, T['graphite']))
        cx += w + len(lab) * size * 0.55 + gap
    return '\n'.join(out)


class Axes:
    """Linear chart axes. x/y ranges in data units; plot rectangle in canvas units."""

    def __init__(self, x0, y0, w, h, xr, yr, ylog=False, xlog=False):
        self.x0, self.y0, self.w, self.h, self.xr, self.yr, self.ylog, self.xlog = x0, y0, w, h, xr, yr, ylog, xlog

    def X(self, v):
        a, b = self.xr
        if self.xlog:
            return self.x0 + (math.log10(v) - math.log10(a)) / (math.log10(b) - math.log10(a)) * self.w
        return self.x0 + (v - a) / (b - a) * self.w

    def Y(self, v):
        a, b = self.yr
        if self.ylog:
            return self.y0 + self.h - (math.log10(v) - math.log10(a)) / (math.log10(b) - math.log10(a)) * self.h
        return self.y0 + self.h - (v - a) / (b - a) * self.h

    def grid(self, yticks, fmt=lambda v: f'{v:,g}', xticks=(), xfmt=lambda v: f'{v:g}', size=11, xlabel=None, ylabel=None,
             vgrid=False):
        out = []
        for t in yticks:
            out.append(f'<path d="M{self.x0:g} {self.Y(t):.1f} H{self.x0 + self.w:g}" stroke="{T["grid"]}" stroke-width="1"/>')
            out.append(text(self.x0 - 6, self.Y(t) + 4, fmt(t), size, T['graphite'], anchor='end'))
        for t in xticks:
            if vgrid:
                out.append(f'<path d="M{self.X(t):.1f} {self.y0:g} V{self.y0 + self.h:g}" stroke="{T["grid"]}" stroke-width="1"/>')
            out.append(text(self.X(t), self.y0 + self.h + 17, xfmt(t), size, T['graphite'], anchor='middle'))
        out.append(f'<path d="M{self.x0:g} {self.y0 + self.h:g} H{self.x0 + self.w:g}" stroke="{T["line"]}" stroke-width="1"/>')
        if xlabel:
            out.append(text(self.x0 + self.w / 2, self.y0 + self.h + 38, xlabel, 12, T['graphite'], anchor='middle'))
        if ylabel:
            yc = self.y0 + self.h / 2
            out.append(text(11, yc, ylabel, 12, T['graphite'], anchor='middle', extra=f'transform="rotate(-90 11 {yc:g})"'))
        return '\n'.join(out)

    def curve(self, pts, color, width=2.25, dash=None):
        da = f' stroke-dasharray="{dash}"' if dash else ''
        p = ' '.join(f'{self.X(x):.1f},{self.Y(y):.1f}' for x, y in pts)
        return f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{da}/>'

    def dot(self, x, y, color, r=5, ring=True):
        st = ' stroke="#fff" stroke-width="1.5"' if ring else ''
        return f'<circle cx="{self.X(x):.1f}" cy="{self.Y(y):.1f}" r="{r}" fill="{color}"{st}/>'

    def hline(self, v, color, dash='6 4', width=1.5, label=None, size=11.5, right=True, below=False, weight=600):
        out = [f'<path d="M{self.x0:g} {self.Y(v):.1f} H{self.x0 + self.w:g}" stroke="{color}" stroke-width="{width}" stroke-dasharray="{dash}"/>']
        if label:
            yy = self.Y(v) + (15 if below else -6)
            out.append(text(self.x0 + self.w - 2 if right else self.x0 + 4, yy, label, size, T['charcoal'], weight,
                            'end' if right else 'start', halo=True))
        return '\n'.join(out)

    def bar(self, x, v, bw, color, base=0):
        y1, y0 = self.Y(v), self.Y(base)
        return f'<rect x="{self.X(x) - bw / 2:.1f}" y="{min(y0, y1):.1f}" width="{bw:g}" height="{abs(y0 - y1):.1f}" rx="2" fill="{color}"/>'
