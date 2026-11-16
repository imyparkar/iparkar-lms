"""Redrawn CSP figures (pilot: 1.1-1, 1.10-1, 4.3-1) as SVG in iParkar design tokens.

  LMS_ROOT=. python3 scripts/csp-sps/figures/pilot.py   # writes imports/csp-sps/authoring/figures/*.svg (private)

Charts are computed from their formulas, not traced. Diagrams follow the guide's figure and alt text.
"""
import math, os
OUT = os.environ.get('CSP_FIGURES', os.path.join(os.environ.get('LMS_ROOT', '.'), 'imports/csp-sps/authoring/figures'))
T = dict(ink='#000000', charcoal='#111111', graphite='#615d59', slate='#696969', action='#0075de', sky='#e6f3fe',
         coral='#f64932', peach='#f6d5b8', paper='#f6f5f4', line='rgba(0,0,0,0.2)', grid='rgba(0,0,0,0.08)',
         midnight='#02093a', marigold='#ffb110', vermillion='#e32d14')
FONT = "font-family=\"Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\""

def svg(w, h, body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{label}" {FONT} '
            f'style="width:100%;height:auto;display:block">\n{body}\n</svg>\n')

def text(x, y, s, size=13, fill=None, weight=400, anchor='start', extra=''):
    fill = fill or T['charcoal']
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{s}</text>'

def lines(x, y, rows, size=13, lh=None, **kw):
    lh = lh or size * 1.3
    return '\n'.join(text(x, y + i * lh, r, size, **kw) for i, r in enumerate(rows))

# ------------------------------------------------------------------ 1.1-1 life cycle (wide)
def fig_1_1_wide():
    W, H = 720, 262
    st = [('Design', 'concept'), ('Preliminary', 'design'), ('Detailed', 'design'), ('Build or', 'purchase'),
          ('Commission', '(install)'), ('Production &amp;', 'maintenance'), ('Decom-', 'mission')]
    b = [text(0, 20, 'The cheapest point to design out a hazard is before anything is built', 16, weight=700),
         text(0, 40, 'ANSI Z590.3 life-cycle stages, grouped into Yates’s three timeframes', 12.5, T['graphite'])]
    bw, gap, x0, y0, bh = 92, 12, 0, 62, 52
    for i, (a, c) in enumerate(st):
        x = x0 + i * (bw + gap)
        hot = i < 3
        b.append(f'<rect x="{x+0.75}" y="{y0}" width="{bw-1.5}" height="{bh}" rx="8" fill="{T["sky"] if hot else "#fff"}" '
                 f'stroke="{T["action"] if hot else T["line"]}" stroke-width="{1.75 if hot else 1}"/>')
        b.append(lines(x + bw / 2, y0 + 22, [a, c], 12, 15, weight=600, anchor='middle'))
        if i < len(st) - 1:
            ax = x + bw + 1.5
            b.append(f'<path d="M{ax} {y0+bh/2} h{gap-5}" stroke="{T["line"]}" stroke-width="1.25"/>'
                     f'<path d="M{ax+gap-5} {y0+bh/2-3.5} l4 3.5 l-4 3.5z" fill="{T["line"]}"/>')
    # avoidance zone
    zw = 3 * bw + 2 * gap
    b.append(f'<rect x="0.75" y="{y0+bh+12}" width="{zw-1.5}" height="28" rx="8" fill="{T["sky"]}" stroke="{T["action"]}" stroke-width="1.25"/>')
    b.append(text(zw / 2, y0 + bh + 31, 'Avoidance: hazards kept off the drawings', 12, weight=600, anchor='middle'))
    # brackets
    yb = 182
    def bracket(xa, xb, col, w=1.5):
        return f'<path d="M{xa+1} {yb-7} V{yb} H{xb-1} V{yb-7}" fill="none" stroke="{col}" stroke-width="{w}"/>'
    pre_end = 5 * bw + 4 * gap
    b.append(bracket(0, pre_end, T['action'], 1.75))
    b.append(text(pre_end / 2, yb + 24, 'Pre-operational', 14, weight=700, anchor='middle'))
    b.append(text(pre_end / 2, yb + 43, 'Widest choice of controls, lowest cost of change', 12, T['graphite'], anchor='middle'))
    for k, (t1, sub) in [(5, ('Operational', ['Retrofit or', 'redesign'])), (6, ('End of life', ['Plan removal', 'and disposal']))]:
        x = k * (bw + gap)
        b.append(bracket(x, x + bw, T['line']))
        b.append(text(x + bw / 2, yb + 24, t1, 14, weight=700, anchor='middle'))
        b.append(lines(x + bw / 2, yb + 43, sub, 12, 16, fill=T['graphite'], anchor='middle'))
    return svg(W, H, '\n'.join(b), 'Design life cycle: seven stages, the first three form the avoidance zone')

def fig_1_1_phone():
    W = 360
    st = [('Design concept', 0), ('Preliminary design', 0), ('Detailed design', 0), ('Build or purchase', 1),
          ('Commission (install)', 1), ('Production &amp; maintenance', 2), ('Decommission', 3)]
    b = [lines(0, 20, ['The cheapest point to design out a', 'hazard is before anything is built'], 16, 21, weight=700),
         lines(0, 66, ['ANSI Z590.3 life-cycle stages, grouped into', 'Yates’s three timeframes'], 12.5, 17, fill=T['graphite'])]
    y, bh, gap, bx, bw = 96, 40, 10, 0, 196
    ys = []
    for i, (name, _) in enumerate(st):
        hot = i < 3
        b.append(f'<rect x="{bx+0.75}" y="{y}" width="{bw-1.5}" height="{bh}" rx="8" fill="{T["sky"] if hot else "#fff"}" '
                 f'stroke="{T["action"] if hot else T["line"]}" stroke-width="{1.75 if hot else 1}"/>')
        b.append(text(bx + 14, y + 25, name, 13, weight=600))
        ys.append(y)
        if i < len(st) - 1:
            b.append(f'<path d="M{bw/2} {y+bh+1.5} v{gap-5}" stroke="{T["line"]}" stroke-width="1.25"/>'
                     f'<path d="M{bw/2-3.5} {y+bh+gap-4} l3.5 4 l3.5 -4z" fill="{T["line"]}"/>')
        y += bh + gap
    xb = bw + 14
    def vb(ya, yb_, col, w=1.5):
        return f'<path d="M{xb-7} {ya+1} H{xb} V{yb_-1} H{xb-7}" fill="none" stroke="{col}" stroke-width="{w}"/>'
    # avoidance marker inside first three
    b.append(f'<rect x="{bw-0.5+0}" y="0" width="0" height="0"/>')
    b.append(vb(ys[0], ys[4] + bh, T['action'], 1.75))
    b.append(text(xb + 10, (ys[0] + ys[4] + bh) / 2 - 18, 'Pre-operational', 13.5, weight=700))
    b.append(lines(xb + 10, (ys[0] + ys[4] + bh) / 2, ['Widest choice of', 'controls, lowest', 'cost of change'], 12, 15, fill=T['graphite']))
    b.append(vb(ys[5], ys[5] + bh, T['line']))
    b.append(text(xb + 10, ys[5] + 17, 'Operational', 13.5, weight=700))
    b.append(text(xb + 10, ys[5] + 33, 'Retrofit or redesign', 12, T['graphite']))
    b.append(vb(ys[6], ys[6] + bh, T['line']))
    b.append(text(xb + 10, ys[6] + 17, 'End of life', 13.5, weight=700))
    b.append(text(xb + 10, ys[6] + 33, 'Plan removal, disposal', 12, T['graphite']))
    ya = y + 2
    b.append(f'<rect x="0.75" y="{ya}" width="{W-1.5}" height="30" rx="8" fill="{T["sky"]}" stroke="{T["action"]}" stroke-width="1.25"/>')
    b.append(text(W / 2, ya + 20, 'Shaded stages: avoidance, hazards kept off the drawings', 12, weight=600, anchor='middle'))
    return svg(W, ya + 34, '\n'.join(b), 'Design life cycle: seven stages, the first three form the avoidance zone')

# ------------------------------------------------------------------ 1.10-1 sling tension chart
def fig_1_10(phone=False):
    W, H = (360, 470) if phone else (720, 430)
    ml, mr, mt, mb = (50 if phone else 66, 10, 92 if phone else 70, 78 if phone else 80)
    pw, ph = W - ml - mr, H - mt - mb
    X = lambda a: ml + (a - 20) / 70 * pw
    Y = lambda t: mt + ph - t / 10000 * ph
    Tn = lambda a: 3000 / math.sin(math.radians(a))
    b = []
    if phone:
        b.append(lines(0, 20, ['Flatter sling legs carry more tension:', '7.5 ft legs overload 4,400 lb slings'], 15.5, 20, weight=700))
        b.append(lines(0, 62, ['Tension per leg, two-leg bridle, 6,000 lb skid', '(Worked Example 1.10-A)'], 12, 16, fill=T['graphite']))
    else:
        b.append(text(0, 20, 'Flatter sling legs carry more tension: 7.5 ft legs overload the 4,400 lb slings', 16, weight=700))
        b.append(text(0, 40, 'Tension in each leg of a two-leg bridle lifting a 6,000 lb skid, by sling angle from horizontal (Worked Example 1.10-A)', 12, T['graphite']))
    # avoid zone
    b.append(f'<rect x="{X(20)}" y="{mt}" width="{X(30)-X(20)}" height="{ph}" fill="{T["coral"]}" fill-opacity="0.08"/>')
    b.append(text(X(20) + 5, mt + 15, 'Avoid' if phone else 'Avoid below 30°', 11.5, T['vermillion'], 600))
    if phone:
        b.append(text(X(20) + 5, mt + 29, 'below 30°', 11.5, T['vermillion'], 600))
    for t in range(0, 10001, 2000):
        b.append(f'<path d="M{ml} {Y(t)} H{ml+pw}" stroke="{T["grid"]}" stroke-width="1"/>')
        b.append(text(ml - 6, Y(t) + 4, f'{t:,}' if not phone else (f'{t//1000}k' if t else '0'), 11, T['graphite'], anchor='end'))
    for a in range(20, 91, 10 if not phone else 10):
        b.append(text(X(a), mt + ph + 18, f'{a}°', 11, T['graphite'], anchor='middle'))
    b.append(f'<path d="M{ml} {mt+ph} H{ml+pw}" stroke="{T["line"]}" stroke-width="1"/>')
    b.append(text(ml + pw / 2, mt + ph + 40, 'Sling angle from horizontal', 12, T['graphite'], anchor='middle'))
    b.append(text(11, mt + ph / 2, 'Tension per leg (lb)', 12, T['graphite'], anchor='middle',
                  extra=f'transform="rotate(-90 11 {mt+ph/2})"'))
    # reference lines
    b.append(f'<path d="M{ml} {Y(4400)} H{ml+pw}" stroke="{T["slate"]}" stroke-width="1.5" stroke-dasharray="6 4"/>')
    b.append(text(ml + pw - 2, Y(4400) - 7, 'Leg rating 4,400 lb', 11.5, T['charcoal'], 600, 'end'))
    b.append(f'<path d="M{ml} {Y(3000)} H{ml+pw}" stroke="{T["slate"]}" stroke-width="1" stroke-dasharray="2 3"/>')
    b.append(text(ml + 4, Y(3000) + 16, 'Vertical share 3,000 lb', 11.5, T['graphite']) if phone else text(ml + pw - 2, Y(3000) + 16, 'Vertical share 3,000 lb', 11.5, T['graphite'], anchor='end'))
    # curve
    pts = ' '.join(f'{X(a):.1f},{Y(Tn(a)):.1f}' for a in [20 + i * 0.5 for i in range(141)])
    b.append(f'<polyline points="{pts}" fill="none" stroke="{T["midnight"]}" stroke-width="2.25" stroke-linejoin="round"/>')
    for a, f in [(30, '×2.00'), (45, '×1.41'), (60, '×1.15')]:
        b.append(f'<circle cx="{X(a)}" cy="{Y(Tn(a))}" r="3.5" fill="#fff" stroke="{T["midnight"]}" stroke-width="1.75"/>')
        b.append(text(X(a) + 7, Y(Tn(a)) - 8, f, 11, T['graphite'], extra='stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'))
    a75, a10 = math.degrees(math.asin(0.6)), math.degrees(math.asin(0.8))
    b.append(f'<circle cx="{X(a75)}" cy="{Y(5000)}" r="6" fill="{T["coral"]}" stroke="#fff" stroke-width="1.5"/>')
    b.append(f'<circle cx="{X(a10)}" cy="{Y(3750)}" r="6" fill="{T["action"]}" stroke="#fff" stroke-width="1.5"/>')
    if phone:
        b.append(lines(X(a75) + 10, Y(5000) - 26, ['7.5 ft legs', '36.9°, 5,000 lb'], 11.5, 14, weight=700, fill=T['vermillion'], extra='stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'))
        b.append(lines(X(a10) + 9, Y(3750) + 20, ['10 ft legs', '53.1°, 3,750 lb'], 11.5, 14, weight=700, fill=T['action'], extra='stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'))
    else:
        b.append(text(X(a75) + 12, Y(5000) - 10, '7.5 ft legs: 36.9°, 5,000 lb (over)', 12, T['vermillion'], 700, extra='stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'))
        b.append(text(X(a10) - 10, Y(3750) + 22, '10 ft legs: 53.1°, 3,750 lb (under)', 12, T['action'], 700, 'end', extra='stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'))
    note = 'T = W ÷ (n × sin θ). Labels on the curve are the load angle factor (1 ÷ sin θ).'
    if phone:
        b.append(lines(0, H - 14, ['T = W ÷ (n × sin θ); ×-labels are 1 ÷ sin θ'], 11.5, fill=T['graphite']))
    else:
        b.append(text(0, H - 6, note, 12, T['graphite']))
    return svg(W, H, '\n'.join(b), 'Sling leg tension against sling angle for a 6,000 lb two-leg lift')

# ------------------------------------------------------------------ 4.3-1 sprinkler + alarm schematic (wide)
def num(x, y, n):
    return (f'<circle cx="{x}" cy="{y}" r="9.5" fill="{T["charcoal"]}"/>' + text(x, y + 4.2, str(n), 11.5, '#fff', 700, 'middle'))

def fig_4_3():
    W, H = 720, 470
    b = [text(0, 20, 'A wet-pipe sprinkler system and the fire alarm system that watches it', 16, weight=700),
         text(0, 40, 'Schematic, not to scale. Solid blue lines carry water; dashed lines carry signals to the fire alarm control unit.', 12, T['graphite'])]
    water = T['action']; sig = T['coral']
    WP = f'stroke="{water}" stroke-width="5" fill="none" stroke-linejoin="round"'
    SG = f'stroke="{sig}" stroke-width="1.6" stroke-dasharray="5 4" fill="none"'
    rx = 122            # riser x
    top = 104           # cross main y
    grade = 374
    # building outline (roof/walls) dotted
    b.append(f'<path d="M72 82 H662 V{grade}" fill="none" stroke="{T["line"]}" stroke-width="1.25" stroke-dasharray="1.5 4"/>')
    # grade line
    b.append(f'<path d="M30 {grade} H690" stroke="{T["line"]}" stroke-width="1.5"/>')
    b.append(text(30, grade - 8, 'floor / grade', 11.5, T['graphite']))
    # supply and riser
    b.append(f'<path d="M30 410 H{rx} V{top} H600 V186" {WP}/>')
    b.append(lines(30, 432, ['from water supply (public main, or tank and fire pump)'], 11.5, fill=T['graphite']))
    # sprinklers
    for i in range(7):
        x = 182 + i * 66
        b.append(f'<path d="M{x} {top+2} v9" stroke="{water}" stroke-width="3"/><path d="M{x-7} {top+19} l7 -9 l7 9z" fill="{water}"/>')
    b.append(num(182, 92, 6) + text(196, 96.5, 'Closed sprinklers on branch lines (fusible link or bulb)', 12.5))
    # inspector's test
    b.append(f'<path d="M592 186 l14 8 l-14 8z" fill="#fff" stroke="{T["charcoal"]}" stroke-width="1.5"/>')
    b.append(num(626, 214, 7) + lines(640, 210, ['Inspector’s', 'test'], 12.5, 15))
    # FDC
    b.append(f'<path d="M48 248 H{rx}" {WP}/>')
    b.append(f'<path d="M34 236 l16 12 l-16 12z" fill="#fff" stroke="{T["charcoal"]}" stroke-width="1.5"/>')
    b.append(num(34, 192, 4) + lines(48, 186, ['Fire dept.', 'connection'], 12.5, 15))
    # waterflow switch
    b.append(f'<rect x="{rx-8}" y="218" width="16" height="16" fill="#fff" stroke="{T["charcoal"]}" stroke-width="1.5"/>')
    b.append(num(160, 202, 3) + text(174, 199, 'Waterflow switch', 12.5) + text(174, 213, 'alarm signal', 11.5, T['graphite']))
    # alarm check valve
    b.append(f'<circle cx="{rx}" cy="276" r="12" fill="#fff" stroke="{T["charcoal"]}" stroke-width="1.5"/>')
    b.append(num(160, 276, 2) + text(174, 280.5, 'Alarm check valve on riser', 12.5))
    # control valve OS&Y (bow tie)
    b.append(f'<path d="M{rx-12} 330 l24 -12 v24 z M{rx+12} 330 l-24 -12 v24 z" fill="#fff" stroke="{T["charcoal"]}" stroke-width="1.5" stroke-linejoin="round"/>')
    b.append(num(92, 330, 1))
    b.append(text(174, 352, 'Control valve (OS&amp;Y)', 12.5) + text(174, 367, 'tamper switch: supervisory signal', 11.5, T['graphite']))
    # main drain
    b.append(f'<path d="M{rx} 304 H148 V{grade}" stroke="{water}" stroke-width="3" fill="none"/>')
    b.append(num(160, 396, 5) + text(174, 400.5, 'Main drain', 12.5))
    # detector
    b.append(f'<circle cx="440" cy="142" r="9" fill="#fff" stroke="{sig}" stroke-width="2"/>')
    b.append(num(462, 142, 8) + text(476, 146.5, 'Smoke or heat detector', 12.5))
    # FACU
    fx, fy, fw, fh = 412, 268, 168, 62
    b.append(f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="8" fill="{T["peach"]}" fill-opacity="0.55" stroke="{sig}" stroke-width="1.75"/>')
    b.append(text(fx + fw / 2, fy + 21, 'Fire alarm control unit', 12.5, weight=700, anchor='middle'))
    b.append(lines(fx + fw / 2, fy + 38, ['primary and standby power', 'alarm, supervisory, trouble'], 11, 14, fill=T['graphite'], anchor='middle'))
    # pull station
    b.append(f'<rect x="284" y="284" width="16" height="22" rx="3" fill="#fff" stroke="{sig}" stroke-width="2"/>')
    b.append(text(254, 299.5, 'Manual pull station', 12.5, anchor='end') + num(266, 295, 9))
    # horn/strobe
    b.append(f'<path d="M642 299 l-14 -9 v20 z" fill="{sig}"/><rect x="642" y="291" width="4" height="16" fill="{sig}"/>')
    b.append(text(690, 268, 'Horn / strobe', 12.5, anchor='end') + num(668, 299, 10))
    # supervising station
    b.append(f'<rect x="606" y="402" width="76" height="28" rx="6" fill="#fff" stroke="{sig}" stroke-width="1.75"/>')
    b.append(text(644, 420.5, 'off site', 12, anchor='middle'))
    b.append(text(578, 420.5, 'Supervising station', 12.5, anchor='end') + num(592, 416, 11))
    # signal circuits
    b.append(f'<path d="M{rx+8} 226 H364 V{fy+12} H{fx}" {SG}/>')      # waterflow
    b.append(f'<path d="M440 151 V{fy}" {SG}/>')                     # detector
    b.append(f'<path d="M298 295 H{fx}" {SG}/>')                     # pull station
    b.append(f'<path d="M{rx+12} 330 H392 V{fy+fh-10} H{fx}" {SG}/>')  # tamper
    b.append(f'<path d="M{fx+fw} 299 H628" {SG}/>')                  # horn
    b.append(f'<path d="M{fx+fw} {fy+fh-8} H644 V402" {SG}/>')        # supervising
    # legend
    ly = 458
    b.append(f'<path d="M0 {ly-4} H26" stroke="{water}" stroke-width="5"/>' + text(34, ly, 'Water piping', 12, T['graphite']))
    b.append(f'<path d="M140 {ly-4} H166" {SG}/>' + text(174, ly, 'Signal circuit', 12, T['graphite']))
    b.append(text(290, ly, 'Numbers match the component list in the text', 12, T['graphite']))
    return svg(W, H, '\n'.join(b), 'Wet-pipe sprinkler system and its fire alarm supervision, components numbered 1 to 11')

files = {'fig-1-1-1.svg': fig_1_1_wide(), 'fig-1-1-1.phone.svg': fig_1_1_phone(),
         'fig-1-10-1.svg': fig_1_10(), 'fig-1-10-1.phone.svg': fig_1_10(True), 'fig-4-3-1.svg': fig_4_3()}
for k, v in files.items():
    open(os.path.join(OUT, k), 'w').write(v)
print({k: len(v) for k, v in files.items()})
