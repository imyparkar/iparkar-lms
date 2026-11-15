"""CSP study course: learner journey against the local mock (dev QA)."""
import re, os, json
from playwright.sync_api import sync_playwright
B = "http://localhost:3000"; out = "/home/claude/work/qa/shots"
def log(*a): print(*a, flush=True)
def login(page, email):
    page.goto(B + "/login"); page.fill("input[name=identifier]", email); page.fill("input[name=password]", "password123")
    page.click("button[type=submit]"); page.wait_for_url(re.compile(r"/dashboard|/learn"), timeout=60000)
def answer_section(page, wrong_first=False):
    """Do every activity in the open section, then mark it studied."""
    cards = page.locator("section[aria-labelledby$='-q']")
    for k in range(cards.count()):
        card = cards.nth(k)
        if card.locator("text=Feedback read").count(): continue
        ack = card.locator("button", has_text=re.compile("I've (read the feedback|compared my answer)"))
        if ack.count():
            ack.first.click(); page.wait_for_timeout(600); continue
        ta = card.locator("textarea")
        if ta.count():
            ta.first.fill("My first call: substitute the gas and move the valves.")
            card.locator("button", has_text=re.compile("Show the model answer|Check answer|Compare")).first.click()
        else:
            radios = card.locator("input[type=radio]")
            radios.nth(0 if wrong_first else 1).check(force=True)
            card.locator("button:has-text('Check answer')").click()
        card.locator("text=Read the feedback").first.wait_for(timeout=15000) if card.locator("text=Read the feedback").count() else page.wait_for_timeout(800)
        btn = card.locator("button", has_text=re.compile("I've (read the feedback|compared my answer)"))
        if btn.count(): btn.first.click()
        page.wait_for_timeout(500)
    if page.locator("button:has-text('Mark section as studied')").count():
        page.click("button:has-text('Mark section as studied')"); page.wait_for_selector("text=Section studied.", timeout=15000)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); page = ctx.new_page()
    errs = []; page.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    login(page, "learner@example.test")
    page.goto(B + "/learn"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{out}/01-my-learning.png", full_page=True)
    page.goto(B + "/learn/csp-sps"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{out}/02-overview.png", full_page=True)
    log("overview h2:", page.locator("#domains").inner_text(), "| domain cards:", page.locator("ul >> li a[href*='/domain/']").count())
    page.goto(B + "/learn/csp-sps/domain/1"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{out}/03-domain1.png", full_page=True)
    page.goto(B + "/study/csp-sps/1.1"); page.wait_for_selector("#section-title")
    page.screenshot(path=f"{out}/04-player-scenario.png", full_page=True)
    page.locator("button:has-text('Finish chapter')").last.click(force=True); page.wait_for_timeout(1500)
    log("early finish refused:", page.locator("text=Not yet.").count() > 0)
    answer_section(page)
    log("section 1 studied")
    titles = []
    # go to Exam practice and answer the first question wrongly
    page.click("text=Next section"); page.wait_for_timeout(1500)
    log("now at:", page.locator("#section-title").inner_text())
    page.fill("#chapter-note", "PtD: avoidance before elimination."); page.wait_for_timeout(2000)
    page.click("button:has-text('Bookmark')"); page.wait_for_timeout(1500)
    log("save status:", page.locator("[role=status]").first.inner_text())
    # sign out
    page.goto(B + "/learn"); page.click("text=Sign out"); page.wait_for_url(re.compile("login|/$"))
    log("study keys after sign-out:", page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('iparkar:study:'))"))
    ctx.close()
    # second device (phone)
    ctx2 = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); m = ctx2.new_page()
    login(m, "learner@example.test"); m.goto(B + "/learn/csp-sps"); m.wait_for_load_state("networkidle")
    cont = m.locator("a:has-text('Continue')").first; log("continue link:", cont.inner_text()); cont.click()
    m.wait_for_selector("#section-title"); log("resumed at:", m.locator("#section-title").inner_text(), "| note:", m.locator("#chapter-note").input_value())
    m.screenshot(path=f"{out}/05-phone-resume.png", full_page=False)
    # finish the chapter on the phone: every section, questions answered wrong first
    for _ in range(12):
        answer_section(m, wrong_first=True)
        nxt = m.locator("button:has-text('Next section')")
        if not nxt.count(): break
        nxt.first.click(); m.wait_for_timeout(1200)
    # also go back over section 1 if needed via outline: the player lists missing items beside Finish
    log("missing:", m.locator("#finish-missing").all_inner_texts()[:1])
    m.screenshot(path=f"{out}/05b-phone-missing.png", full_page=True)
    m.locator("button:has-text('Finish chapter')").last.click(timeout=5000); m.wait_for_timeout(2500)
    log("finish message:", m.locator("[role=status], [role=alert]").all_inner_texts()[-3:])
    m.goto(B + "/learn/csp-sps"); m.wait_for_load_state("networkidle")
    log("progress:", m.locator("text=/\\d+ of 60/").first.inner_text())
    m.screenshot(path=f"{out}/06-phone-overview.png", full_page=True)
    ctx2.close()
    # another learner cannot see the note
    ctx3 = br.new_context(viewport={"width": 1440, "height": 900}); o = ctx3.new_page()
    login(o, "other@example.test"); o.goto(B + "/study/csp-sps/1.1"); o.wait_for_selector("#section-title")
    log("other learner note empty:", o.locator("#chapter-note").input_value() == "")
    # resources and an equation-heavy chapter
    for path, name in [("/learn/csp-sps/resources/glossary", "07-glossary"), ("/learn/csp-sps/formulas/6", "08-formulas6"), ("/study/csp-sps/6.3?s=worked-application", "09-ch63-worked")]:
        o.goto(B + path); o.wait_for_load_state("networkidle"); o.screenshot(path=f"{out}/{name}.png", full_page=False)
        log(path, "katex errors:", o.locator(".katex-error").count(), "| katex:", o.locator(".katex").count())
    ctx3.close(); br.close()
    log("console errors:", errs[:5])
