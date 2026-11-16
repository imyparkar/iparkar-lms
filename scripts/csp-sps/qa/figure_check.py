"""Redrawn figures in the player: renders, phone layout, no fallback image, axe (dev QA against the mock)."""
import re, os, sys
from playwright.sync_api import sync_playwright
B = os.environ.get("APP_URL", "http://localhost:3000"); OUT = os.environ.get("SHOTS", "/home/claude/work/qa/shots")
axe = open("node_modules/axe-core/axe.min.js").read()
PAGES = [a.split("=") for a in (sys.argv[1:] or ["1.1=design-safety-reviews", "1.10=visual-explanation", "4.3=inspection-testing-maintenance-and"])]
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    for w, h in [(1440, 900), (390, 844)]:
        pg = br.new_page(viewport={"width": w, "height": h})
        pg.goto(B + "/login"); pg.fill("input[name=identifier]", "learner@example.test"); pg.fill("input[name=password]", "password123")
        pg.click("button[type=submit]"); pg.wait_for_url(re.compile("dashboard"))
        for ch, sec in PAGES:
            pg.goto(f"{B}/study/csp-sps/{ch}?s={sec}"); pg.wait_for_selector("#section-title")
            fig = pg.locator("figure").first; fig.scroll_into_view_if_needed()
            svgs = [s for s in fig.locator("svg[role=img]").all() if s.is_visible()]
            box = svgs[0].bounding_box() if svgs else None
            print(w, ch, "visible svg:", len(svgs), "width:", round(box["width"]) if box else None, "| fallback img:", fig.locator("img").count())
            fig.screenshot(path=f"{OUT}/fig-{ch}-{w}.png")
            pg.add_script_tag(content=axe)
            r = pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})")
            print("   axe", [(v['id'], len(v['nodes'])) for v in r['violations']])
        pg.close()
    br.close()
