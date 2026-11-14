import re
from playwright.sync_api import sync_playwright, expect
import os
B=os.environ.get("APP_URL", "http://localhost:3000"); out=os.environ.get("SHOTS", "shots")
def login(page, email):
    page.goto(B+"/login"); page.fill("input[name=identifier]", email); page.fill("input[name=password]","password123")
    page.click("button[type=submit]"); page.wait_for_url(re.compile(r"/dashboard"), timeout=60000)
def log(*a): print(*a, flush=True)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    ctx=br.new_context(viewport={"width":1440,"height":900}); page=ctx.new_page()
    errs=[]; page.on("console", lambda m: errs.append(m.text[:200]) if m.type=="error" else None)
    login(page,"learner@example.test")
    page.goto(B+"/study/asp-sps/1.1?s=start"); page.wait_for_selector("#section-title")
    # server refuses an early finish even if the button is forced
    page.locator("button:has-text('Finish chapter')").click(force=True); page.wait_for_timeout(1200)
    log("early finish ->", page.locator("text=Not yet.").count()>0)
    # section 1: wrong prediction first
    page.click("text=Try again") if page.locator("text=Try again").count() else None
    page.check("text=Yes. 5,000 is far larger than 2.5.", force=True)
    page.click("text=Check answer"); page.wait_for_selector("text=Not quite.")
    page.screenshot(path=f"{out}/05-feedback-wrong.png", full_page=False, clip={"x":0,"y":0,"width":1440,"height":900})
    if page.locator("text=I've read the feedback").count(): page.click("text=I've read the feedback")
    page.wait_for_selector("text=Feedback read")
    if page.locator("text=Mark section as studied").count(): page.click("text=Mark section as studied")
    page.wait_for_selector("text=Section studied.")
    # stop mid-chapter: go to section 3, wait for resume save
    page.click("text=Next section"); page.wait_for_selector("text=Units you will meet", state="detached", timeout=3000) if False else None
    page.wait_for_timeout(500); page.click("text=Next section"); page.wait_for_timeout(2500)
    log("now at", page.locator("#section-title").inner_text(), "| save:", page.locator("header [role=status]").inner_text())
    page.fill("#chapter-note","Cube the length factor for volume."); page.wait_for_timeout(2000)
    page.click("button:has-text('Bookmark')"); page.wait_for_timeout(800)
    page.screenshot(path=f"{out}/06-player-unitfactor.png", full_page=True)
    # sign out
    page.goto(B+"/learn"); page.click("text=Sign out"); page.wait_for_url(re.compile("login|/$"))
    log("local study keys after signout:", page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('iparkar:study:'))"))
    ctx.close()
    # second device
    ctx2=br.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True); m=ctx2.new_page()
    login(m,"learner@example.test"); m.goto(B+"/learn"); m.wait_for_load_state("networkidle")
    m.screenshot(path=f"{out}/07-mobile-my-learning.png", full_page=True)
    m.click("text=Continue learning"); m.wait_for_selector("#section-title")
    log("device2 resumes at:", m.url.split('/')[-1], "|", m.locator("#section-title").inner_text(), "| note:", m.input_value("#chapter-note"))
    m.screenshot(path=f"{out}/08-mobile-player.png", full_page=False)
    # finish the rest on device 2
    answers={"prefix-area":"10000","duct-area":"11.7","tank-volume":"9.46","temp-convert":"125.6","kc-psi":"344.8","kc-weight":"686.7","wind-speed":"36.5"}
    for step in range(10):
        title=m.locator("#section-title").inner_text()
        n=m.locator("section:has(p:has-text('Required activity'))").count()
        for k in range(n):
            card=m.locator("section:has(p:has-text('Required activity'))").nth(k)
            if card.locator("text=Feedback read").count(): continue
            if card.locator("input[inputmode=decimal]").count():
                card.locator("input[inputmode=decimal]").fill(list(answers.values())[step % len(answers)])
            elif card.locator("input[type=radio]").count():
                card.locator("input[type=radio]").first.check(force=True)
            card.locator("button:has-text('Check answer')").click()
            card.locator("button:has-text(\"I've read the feedback\")").click()
            card.locator("text=Feedback read").wait_for()
        if m.locator("text=Mark section as studied").count():
            m.click("text=Mark section as studied"); m.wait_for_selector("text=Section studied.")
        if m.locator("button:has-text('Next section')").count(): m.click("button:has-text('Next section')"); m.wait_for_timeout(700)
        else: break
    # sections skipped before (2) - go via outline
    m.click("button:has-text('Outline')"); m.click("#outline >> text=The units you will meet"); m.wait_for_timeout(700)
    card=m.locator("section:has(p:has-text('Required activity'))").first
    if not card.locator("text=Feedback read").count():
        card.locator("input[inputmode=decimal]").fill("100"); card.locator("button:has-text('Check answer')").click()
        card.locator("button:has-text(\"I've read the feedback\")").click(); card.locator("text=Feedback read").wait_for()
    if m.locator("text=Mark section as studied").count(): m.click("text=Mark section as studied"); m.wait_for_selector("text=Section studied.")
    m.click("button:has-text('Finish chapter')"); m.wait_for_selector("text=Chapter 1.1 complete")
    log("finished:", m.locator("text=Chapter 1.1 complete").inner_text())
    m.goto(B+"/learn/asp-sps"); m.wait_for_load_state("networkidle")
    log("overview:", m.locator("text=of 99").first.inner_text())
    m.screenshot(path=f"{out}/09-mobile-overview.png", full_page=True)
    ctx2.close()
    # other learner: can't see learner's note
    ctx3=br.new_context(); o=ctx3.new_page(); login(o,"other@example.test"); o.goto(B+"/study/asp-sps/1.1"); o.wait_for_selector("#section-title")
    log("other sees note:", repr(o.input_value("#chapter-note")), "| status pill:", o.locator("main .pill").first.inner_text())
    log("errors:", errs[:3])
    br.close()
