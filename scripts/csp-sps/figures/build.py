"""Write every redrawn figure to imports/csp-sps/authoring/figures (private) and check it against the allow-list rules.

  LMS_ROOT=. python3 scripts/csp-sps/figures/build.py [fig-1-2-1 …]
"""
import importlib, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Figure sources contain guide wording, so they live with the private content, not in this public repo.
SRC = os.environ.get('CSP_FIGURE_SRC', os.path.join(os.environ.get('LMS_ROOT', '.'), 'imports/csp-sps/authoring/figures-src'))
sys.path.insert(0, SRC)
OUT = os.environ.get('CSP_FIGURES', os.path.join(os.environ.get('LMS_ROOT', '.'), 'imports/csp-sps/authoring/figures'))
os.makedirs(OUT, exist_ok=True)
ALLOWED = {'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc'}
figs = {}
for mod in ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']:
    try:
        figs.update(importlib.import_module(mod).FIGS)
    except ModuleNotFoundError:
        pass
want = sys.argv[1:] or list(figs)
for k in want:
    out = figs[k]()
    pairs = out if isinstance(out, dict) else {'': out}
    for suffix, s in pairs.items():
        tags = set(re.findall(r'<\s*([a-zA-Z]+)', s))
        assert tags <= ALLOWED, (k, tags - ALLOWED)
        name = f'{k}{suffix}.svg'
        open(os.path.join(OUT, name), 'w', encoding='utf-8').write(s.strip() + '\n')
        print(name, len(s))
