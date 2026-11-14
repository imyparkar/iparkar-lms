import re
from playwright.sync_api import sync_playwright
import os
B=os.environ.get("APP_URL", "http://localhost:3000"); out=os.environ.get("SHOTS", "shots")
def login(page, email):
    page.goto(B+"/login"); page.fill("input[name=identifier]", email); page.fill("input[name=password]","password123")
    page.click("button[type=submit]"); page.wait_for_url(re.compile(r"/dashboard"), timeout=60000)
def log(*a): print(*a, flush=True)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    # new learner: offer -> start trial
    ctx=br.new_context(viewport={"width":1440,"height":900}); page=ctx.new_page()
    errs=[]; page.on("console", lambda m: errs.append(m.text[:200]) if m.type=="error" else None)
    login(page,"new@example.test"); page.goto(B+"/learn"); page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{out}/01-offer.png", full_page=True)
    page.click("text=Start 7-day free access"); page.wait_for_url(re.compile(r"/study/asp-sps/1.1"), timeout=60000)
    page.wait_for_selector("#section-title")
    log("trial chip:", page.locator("header >> text=Free access").count())
    page.goto(B+"/study/asp-sps/1.4"); page.wait_for_selector("#section-title")
    # navigate to a section with a figure
    for i in range(8):
        if page.locator("figure img").count(): break
        if page.locator("text=Next section").count()==0: break
        page.click("text=Next section"); page.wait_for_timeout(600)
    img=page.locator("figure img").first
    if img.count():
        img.scroll_into_view_if_needed(); page.wait_for_timeout(1500)
        log("img natural width:", img.evaluate("e=>e.naturalWidth"), "src:", img.get_attribute("src"))
        img.screenshot(path=f"{out}/02-figure.png")
        page.locator("figure").first.screenshot(path=f"{out}/02b-figure-card.png")
    # calculator
    page.click("button:has-text('Calculator')"); page.wait_for_timeout(800)
    page.screenshot(path=f"{out}/03-calculator.png")
    page.click("button:has-text('Hide calculator')"); page.wait_for_timeout(300)
    log("calc hidden:", page.locator("button:has-text('Hide calculator')").count()==0)
    page.goto(B+"/learn/asp-sps/formulas/1"); page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{out}/04-formulas.png", full_page=False)
    page.goto(B+"/learn/asp-sps"); page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{out}/05-overview-trial.png", full_page=False)
    log("console errors:", errs[:5]); ctx.close()

    # direct asset URL without session
    ctx=br.new_context(); pg=ctx.new_page()
    r=pg.request.get(B+"/api/study/asset?k=asp-sps/"+"fig-1.6-2-02a26df8c1.webp"); log("anon asset:", r.status); ctx.close()

    # expired learner: paywall, asset refused
    ctx=br.new_context(viewport={"width":1440,"height":900}); page=ctx.new_page()
    login(page,"expired@example.test"); page.goto(B+"/study/asp-sps/1.4"); page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{out}/06-paywall.png", full_page=False)
    r=page.request.get(B+"/api/study/asset?k=asp-sps/fig-1.6-2-02a26df8c1.webp"); log("expired asset:", r.status)
    page.goto(B+"/learn"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{out}/07-learn-expired.png", full_page=False)
    ctx.close()

    # mobile: no calculator
    ctx=br.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True); m=ctx.new_page()
    login(m,"trial@example.test"); m.goto(B+"/study/asp-sps/1.6"); m.wait_for_selector("#section-title")
    log("mobile calculator buttons:", m.locator("button:has-text('Calculator')").count())
    m.screenshot(path=f"{out}/08-mobile-player.png")
    ctx.close(); br.close()
