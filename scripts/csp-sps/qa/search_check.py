"""Course search: results, navigation to the section, protection, axe (dev QA against the mock)."""
import re, os
from playwright.sync_api import sync_playwright
B = os.environ.get("APP_URL", "http://localhost:3000"); axe = open("node_modules/axe-core/axe.min.js").read()
OUT = os.environ.get("SHOTS", "/home/claude/work/qa/shots")
def login(pg, u):
    pg.goto(B + "/login"); pg.fill("input[name=identifier]", u); pg.fill("input[name=password]", "password123")
    pg.click("button[type=submit]"); pg.wait_for_url(re.compile("dashboard"))
def audit(pg, label):
    pg.add_script_tag(content=axe)
    r = pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})")
    print(label, [(v['id'], len(v['nodes'])) for v in r['violations']])
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    for w, h in [(1440, 900), (390, 844)]:
        pg = br.new_page(viewport={"width": w, "height": h}); login(pg, "learner@example.test")
        pg.goto(B + "/learn/csp-sps"); pg.click("text=Search the course"); pg.wait_for_selector("#q")
        pg.fill("#q", "permit-required confined space"); pg.press("#q", "Enter"); pg.wait_for_selector("#results-title")
        print(w, "status:", pg.locator("#results-title").inner_text(), "| marks:", pg.locator("mark").count())
        pg.screenshot(path=f"{OUT}/search-{w}.png", full_page=False)
        audit(pg, f"{w} axe search results")
        first = pg.locator("ol li a").first; t = first.inner_text(); first.click(); pg.wait_for_selector("#section-title")
        print(w, "clicked:", t, "-> player section:", pg.locator("#section-title").inner_text(), pg.url.split("/study/")[1])
        pg.goto(B + "/learn/csp-sps/search?q=zzqxv"); print(w, "empty:", pg.locator("#results-title").inner_text())
        pg.goto(B + "/learn/csp-sps/search?q=LD50"); print(w, "LD50+glossary:", pg.locator("#results-title").inner_text())
        pg.close()
    pg = br.new_page(); login(pg, "expired@example.test"); pg.goto(B + "/learn/csp-sps/search?q=noise")
    print("expired:", pg.locator("text=search is unavailable").count() == 1, "| results shown:", pg.locator("ol li").count())
    pg.close(); br.close()
