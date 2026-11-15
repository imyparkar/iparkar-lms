import re
from playwright.sync_api import sync_playwright
import os
B=os.environ.get("APP_URL", "http://localhost:3000"); axe=open("node_modules/axe-core/axe.min.js").read()
runs={"trial@example.test":["/learn","/learn/csp-sps","/learn/csp-sps/domain/6","/learn/csp-sps/formulas/6","/learn/csp-sps/resources/glossary","/study/csp-sps/1.1","/study/csp-sps/1.1?s=exam-practice","/study/csp-sps/6.3?s=worked-application","/study/csp-sps/7.2?s=review-and-close-the-scenario"],
      "expired@example.test":["/learn","/learn/csp-sps","/study/csp-sps/1.4"],"new@example.test":["/learn","/learn/csp-sps"]}
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    for vp in [(1440,900),(390,844)]:
        for u,paths in runs.items():
            pg=br.new_page(viewport={"width":vp[0],"height":vp[1]})
            pg.goto(B+"/login"); pg.fill("input[name=identifier]",u); pg.fill("input[name=password]","password123"); pg.click("button[type=submit]"); pg.wait_for_url(re.compile("dashboard"))
            for path in paths:
                pg.goto(B+path); pg.wait_for_timeout(1200)
                if vp[0]==1440 and "/study/" in path and pg.locator("button:has-text('Calculator')").count():
                    pg.click("button:has-text('Calculator')"); pg.wait_for_timeout(400)
                pg.add_script_tag(content=axe)
                r=pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})")
                print(vp[0], u.split('@')[0], path, [(v['id'], v['impact'], len(v['nodes']), v['nodes'][0]['target']) for v in r['violations']])
            pg.close()
    br.close()
