#!/usr/bin/env python3
"""
PMP® Exam Prep Course (PMP-SPS) — authoring YAML → study-engine package.

  python3 scripts/pmp-sps/build_package.py

Reads the private authoring files (git-ignored, this repo is public):
  imports/pmp-sps/authoring/course.yaml
  imports/pmp-sps/authoring/modules/m01.yaml … m09.yaml
Validates the curriculum rules from the course brief (2,100 minutes; 480/1,140/480 by
Business Acumen / Ways of Working / Power Skills; a knowledge check in every section; every
July 2026 ECO task covered; predictive/adaptive/hybrid coverage) and writes:
  content/pmp-sps/manifest.json          public structure (titles, ECO tasks, module hours)
  content/pmp-sps/content-register.csv   public register (minutes, category, references, review status)
  content/pmp-sps/coverage.csv           public ECO task → chapter coverage
  imports/pmp-sps/chapters/<id>.json     private lesson content + activities (answer keys)
Then `npm run import:study -- --course pmp-sps --dry-run` validates the chapters against the
engine schema (block types, safe SVG, activity keys) before anything reaches the database.

Mapping: course module → study domain; course section → study chapter ("1.1" … "9.4");
lesson / worked example / practice / recap / knowledge check → study sections; the practice
activity → self_check (model answer shown as feedback); check questions → single/multi choice.
"""
import csv, glob, json, os, re, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUTH = os.path.join(ROOT, "imports", "pmp-sps", "authoring")
OUT_CH = os.path.join(ROOT, "imports", "pmp-sps", "chapters")
OUT_PUB = os.path.join(ROOT, "content", "pmp-sps")

CATS = {"business_acumen": "Business Acumen", "ways_of_working": "Ways of Working", "power_skills": "Power Skills"}
BUDGET = {1: (60, 60, 0), 2: (120, 0, 120), 3: (180, 60, 0), 4: (0, 240, 0), 5: (0, 240, 0),
          6: (0, 0, 300), 7: (60, 240, 60), 8: (60, 180, 0), 9: (0, 120, 0)}
ECO = {
    "PE": ("People", ["Develop a common vision", "Manage conflicts", "Lead the project team", "Engage stakeholders",
                      "Align stakeholder expectations", "Manage stakeholder expectations", "Help ensure knowledge transfer",
                      "Plan and manage communication"]),
    "PR": ("Process", ["Develop an integrated project management plan and plan delivery", "Develop and manage project scope",
                       "Help ensure value-based delivery", "Plan and manage resources", "Plan and manage procurement",
                       "Plan and manage finance", "Plan and optimize quality of products/deliverables", "Plan and manage schedule",
                       "Evaluate project status", "Manage project closure"]),
    "BE": ("Business Environment", ["Define and establish project governance", "Plan and manage project compliance",
                                    "Manage and control changes", "Remove impediments and manage issues", "Plan and manage risk",
                                    "Continuous improvement", "Support organizational change",
                                    "Evaluate external business environment changes"]),
}
errors = []
def err(m): errors.append(m)

# ---------------------------------------------------------------- loading
KEYQ = re.compile(r'^(\s+(?:- )?(?:rationale|ref|title|caption|author_notes|text|feedback|label|industry|summary)): (?!["\'|>{\[])(.*: .*)$')
def load_yaml(path):
    """Authoring convenience: plain scalars may contain ': '."""
    out = []
    for line in open(path, encoding="utf-8"):
        m = KEYQ.match(line.rstrip("\n"))
        if m:
            v = m.group(2).replace("\\", "\\\\").replace('"', '\\"')
            line = f'{m.group(1)}: "{v}"\n'
        out.append(line)
    return yaml.safe_load("".join(out))

def S(x):
    if isinstance(x, dict) and len(x) == 1:
        k, v = next(iter(x.items()))
        return f"{k}: {S(v)}"
    return x

# ---------------------------------------------------------------- markdown → blocks
INLINE_FIX = [(re.compile(r"`([^`]+)`"), r"\1")]  # the engine renders **bold**, *italic*, TeX and line breaks only
def md_inline(s):
    s = S(s).strip()
    for r, rep in INLINE_FIX: s = r.sub(rep, s)
    return s

def table_block(lines, caption):
    rows = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lines]
    rows = [r for r in rows if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
    cols, body = rows[0], rows[1:]
    return {"type": "table", "origin": "original", "caption": caption or "Summary table",
            "columns": [md_inline(c) for c in cols], "rows": [[md_inline(c) or "—" for c in r] for r in body]}

def md_blocks(md):
    """Lesson markdown (headings, paragraphs, lists, tables, block quotes) → engine blocks."""
    blocks, para, lst, ordered, tbl, quote = [], [], [], False, [], []
    last_heading = None
    def flush():
        nonlocal para, lst, tbl, quote
        if para: blocks.append({"type": "text", "origin": "original", "md": md_inline("\n".join(para))}); para = []
        if lst: blocks.append({"type": "list", "origin": "original", "ordered": ordered, "items": [md_inline(i) for i in lst]}); lst = []
        if tbl: blocks.append(table_block(tbl, last_heading)); tbl = []
        if quote:
            text = md_inline(" ".join(quote))
            m = re.match(r"\*\*([^*]+)\*\*\s*(.*)", text)
            title, body = (m.group(1).rstrip(".:"), m.group(2)) if m else ("Note", text)
            blocks.append({"type": "callout", "origin": "original", "variant": "editorial", "title": title, "md": body or title}); quote = []
    for raw in (md or "").split("\n"):
        line = raw.rstrip()
        if not line.strip(): flush(); continue
        if line.startswith("|"):
            if para or lst: flush()
            tbl.append(line); continue
        elif tbl: flush()
        h = re.match(r"^(#{2,4})\s+(.*)$", line)
        if h:
            flush(); last_heading = md_inline(h.group(2))
            blocks.append({"type": "heading", "text": last_heading.replace("**", ""), "level": min(4, len(h.group(1)))}); continue
        if line.startswith(">"):
            if para or lst: flush()
            quote.append(line.lstrip("> ").strip()); continue
        li = re.match(r"^\s*(?:[-*]|(\d+)\.)\s+(.*)$", line)
        if li:
            if para: flush()
            if lst and ordered != bool(li.group(1)): flush()
            ordered = bool(li.group(1)); lst.append(li.group(2)); continue
        if lst and raw.startswith("  "):
            lst[-1] += " " + line.strip(); continue
        if lst: flush()
        para.append(line.strip())
    flush()
    return blocks

# ---------------------------------------------------------------- safe SVG
def path_end_dir(d):
    """End point and direction of the last segment of a simple path (M/L/H/V, absolute or relative)."""
    toks = re.findall(r"[MmLlHhVvCcSsZz]|-?\d*\.?\d+", d)
    x = y = 0.0; px = py = 0.0; i = 0; cmd = None
    while i < len(toks):
        t = toks[i]
        if re.match(r"[A-Za-z]", t): cmd = t; i += 1; continue
        if cmd in "Mm":
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            x, y = (nx, ny) if cmd == "M" else (x + nx, y + ny); px, py = x, y
            cmd = "L" if cmd == "M" else "l"
        elif cmd in "Ll":
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            px, py = x, y; x, y = (nx, ny) if cmd == "L" else (x + nx, y + ny)
        elif cmd in "Hh":
            n = float(toks[i]); i += 1; px, py = x, y; x = n if cmd == "H" else x + n
        elif cmd in "Vv":
            n = float(toks[i]); i += 1; px, py = x, y; y = n if cmd == "V" else y + n
        else:
            raise ValueError(f"unsupported path command {cmd} in {d}")
    return (px, py), (x, y)

def arrow(p0, p1, color="#02093a", size=7.0):
    import math
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    a = (p1[0], p1[1])
    b = (p1[0] - size * math.cos(ang) + size * 0.55 * math.sin(ang), p1[1] - size * math.sin(ang) - size * 0.55 * math.cos(ang))
    c = (p1[0] - size * math.cos(ang) - size * 0.55 * math.sin(ang), p1[1] - size * math.sin(ang) + size * 0.55 * math.cos(ang))
    return f'<polygon points="{a[0]:.1f},{a[1]:.1f} {b[0]:.1f},{b[1]:.1f} {c[0]:.1f},{c[1]:.1f}" fill="{color}"/>'

def safe_svg(svg):
    """Rewrite authored SVG to the engine's allow-list: no defs, gradients, markers, ids or ARIA references."""
    s = svg.strip()
    title = re.search(r"<title[^>]*>(.*?)</title>", s, re.S)
    grad = re.search(r'<stop offset="1" stop-color="(#[0-9a-fA-F]{6})"', s)
    s = re.sub(r"<defs>.*?</defs>", "", s, flags=re.S)
    s = re.sub(r'fill="url\(#[^)]+\)"', f'fill="{grad.group(1) if grad else "#0075de"}"', s)
    s = re.sub(r'\s+aria-labelledby="[^"]*"', f' aria-label="{title.group(1) if title else "Diagram"}"' if title else "", s, count=1)
    s = re.sub(r'\s+aria-labelledby="[^"]*"', "", s)
    s = re.sub(r'\s+id="[^"]*"', "", s)
    # markers: <g ... marker-end="url(#x)"> applies to each child path
    def repl_group(m):
        head, inner = m.group(1), m.group(2)
        head = re.sub(r'\s+marker-end="[^"]*"', "", head)
        heads = []
        for d in re.findall(r'<path d="([^"]+)"', inner):
            heads.append(arrow(*path_end_dir(d)))
        return f"{head}{inner}</g>{''.join(heads)}"
    s = re.sub(r'(<g[^>]*marker-end="[^"]*"[^>]*>)(.*?)</g>', repl_group, s, flags=re.S)
    # self-closing tags with a space before "/>" are fine; normalise "/>" spacing for the allow-list regex
    s = re.sub(r'"\s*/>', '"/>', s)
    return s

def figure_block(f, label):
    return {"type": "figure", "origin": "original", "label": label, "caption": f.get("caption") or label,
            "description": md_inline(re.sub(r"^\s*Text equivalent:\s*", "", f["text"]).strip()),
            "svg": safe_svg(f["svg"])}

# ---------------------------------------------------------------- activities
def kc_activity(q, code, sort):
    t = q["type"]
    expl = md_inline(q["rationale"]) + f"\n*Reference: {md_inline(q['ref'])} · item {q['id']}*"
    if t in ("single", "multi"):
        ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
        opts = [{"id": o["id"], "text": md_inline(o["text"])} for o in q["options"]]
        fb = {o["id"]: md_inline(o["feedback"]) for o in q["options"] if (o.get("feedback") or "").strip()}
        for o in q["options"]:
            if o["id"] not in ans and not (o.get("feedback") or "").strip(): err(f"{q['id']}: wrong option lacks feedback")
        prompt = md_inline(q["stem"])
        if t == "multi": prompt += f"\n*Select {len(ans)}.*"
        a = {"code": code, "sort_order": sort, "required": True, "provenance": "original",
             "feedback": {"explanation": expl, "options": fb} if fb else {"explanation": expl}}
        if t == "single":
            a.update(kind="single_choice", spec={"prompt": prompt, "options": opts, "source_ref": q["id"]},
                     answer_key={"correct": ans[0]}, sample_response={"choice": ans[0]})
        else:
            a.update(kind="multi_choice", spec={"prompt": prompt, "options": opts},
                     answer_key={"correct": ans}, sample_response={"choices": ans})
        return [a]
    if t == "matching":   # one single-choice item per row (the engine has no drag-and-drop matching)
        out = []
        for i, r in enumerate(q["pairs"], 1):
            fb = {c["id"]: md_inline(r.get("feedback") or q["rationale"]) for c in q["choices"] if c["id"] != r["answer"]}
            out.append({"code": f"{code}-{i}", "sort_order": sort + i - 1, "required": True, "provenance": "original", "kind": "single_choice",
                        "spec": {"prompt": md_inline(q["stem"]).rstrip(".") + f" — item {i} of {len(q['pairs'])}:\n**{md_inline(r['text'])}**",
                                 "options": [{"id": c["id"], "text": md_inline(c["text"])} for c in q["choices"]], "source_ref": q["id"]},
                        "answer_key": {"correct": r["answer"]}, "sample_response": {"choice": r["answer"]},
                        "feedback": {"explanation": md_inline(r.get("feedback") or "") + "\n" + expl, "options": fb}})
        return out
    if t == "dropdown":   # completed statements as options; distractors swap one blank each
        tpl = md_inline(q["template"]); key = {b["id"]: b["answer"] for b in q["blanks"]}
        def fill(vals): return re.sub(r"\{(\w+)\}", lambda m: vals[m.group(1)], tpl)
        opts = [{"id": "a", "text": fill(key)}]
        for b in q["blanks"]:
            wrong = next(o for o in b["options"] if o != b["answer"])
            opts.append({"id": chr(ord("a") + len(opts)), "text": fill({**key, b["id"]: wrong})})
        # rotate so the correct option is not always first
        rot = len(q["id"]) % len(opts); opts = opts[rot:] + opts[:rot]
        ids = "abcdef"; correct = None
        for i, o in enumerate(opts):
            if o["text"] == fill(key): correct = ids[i]
            o["id"] = ids[i]
        fb = {o["id"]: "One of the values in this statement is wrong. " + " ".join(md_inline(b.get("feedback", "")) for b in q["blanks"])
              for o in opts if o["id"] != correct}
        return [{"code": code, "sort_order": sort, "required": True, "provenance": "original", "kind": "single_choice",
                 "spec": {"prompt": md_inline(q["stem"]) + "\nWhich statement is correct?", "options": opts, "source_ref": q["id"]},
                 "answer_key": {"correct": correct}, "sample_response": {"choice": correct},
                 "feedback": {"explanation": expl, "options": fb}}]
    if t == "hotspot":    # graphic-based question: the figure is shown above; regions become options
        opts = [{"id": r["id"], "text": r["label"]} for r in q["regions"]]
        fb = {r["id"]: md_inline(r["feedback"]) for r in q["regions"] if r["id"] != q["answer"] and r.get("feedback")}
        return [{"code": code, "sort_order": sort, "required": True, "provenance": "original", "kind": "single_choice",
                 "spec": {"prompt": md_inline(q["stem"]).replace("Click the sprint", "Choose the sprint"), "options": opts, "source_ref": q["id"]},
                 "answer_key": {"correct": q["answer"]}, "sample_response": {"choice": q["answer"]},
                 "feedback": {"explanation": expl, "options": fb}}]
    err(f"{q['id']}: unknown type {t}"); return []

# ---------------------------------------------------------------- build
course = yaml.safe_load(open(os.path.join(AUTH, "course.yaml")))["course"]
headings = json.load(open(os.path.join(AUTH, "pmbok-headings.json")))["headings"]
HEAD = {(h["part"], h["section"]) for h in headings} | {("standard", x) for x in "1234"} | {("guide", x) for x in ["1", "2", "3", "4", "5", "X2", "X3", "X4"]}

def ref_label(r):
    a, _, b = str(r["pages"]).partition("-")
    pages = f"p. {a}" if not b or a == b else f"pp. {a}–{b}"
    return f"PMBOK® Guide 8th ed., {'The Standard for Project Management' if r['part'] == 'standard' else 'Guide'} §{r['section']} ({pages})"

def eco_label(code):
    d, n = code.split("-T")
    return f"{ECO[d][0]} {n}"

manifest_domains, manifest_chapters, register, coverage = [], [], [], {}
chapters_out, totals = {}, {k: 0 for k in CATS}
approach_cov = {"predictive": 0, "adaptive": 0, "hybrid": 0}
for path in sorted(glob.glob(os.path.join(AUTH, "modules", "m*.yaml"))):
    data = load_yaml(path); m = data["module"]; n = m["number"]
    mcat = {k: 0 for k in CATS}
    for si, s in enumerate(data["sections"], 1):
        cid = f"{n}.{si}"
        t = s["time"]
        if sum(t.values()) != s["minutes"]: err(f"{s['id']}: time parts ≠ minutes")
        mcat[s["category"]] += s["minutes"]; totals[s["category"]] += s["minutes"]
        for a in s["approaches"]: approach_cov[a] += 1
        for r in s["pmbok"]:
            if (r["part"], str(r["section"])) not in HEAD: err(f"{s['id']}: unknown PMBOK section {r}")
        for e in s["eco"]: coverage.setdefault(e, []).append(cid)
        if not s.get("check"): err(f"{s['id']}: no knowledge check")
        figs = ([s["figure"]] if s.get("figure") else []) + s.get("figures", [])
        figmap = {f["id"]: f for f in figs}
        refs = [ref_label(r) for r in s["pmbok"]]

        lesson_blocks = md_blocks(s["lesson"])
        for i, f in enumerate(figs, 1):
            lesson_blocks.append(figure_block(f, f"Figure {cid}.{i}"))
        lesson_blocks.append({"type": "callout", "origin": "editorial", "variant": "source_note", "title": "Required reading",
                              "md": "Read these pages in your own copy of the PMBOK® Guide (8th edition), then continue.", "items": refs})
        ex = s["example"]
        ex_blocks = [{"type": "callout", "origin": "original", "variant": "editorial", "title": f"{ex['industry']} · {ex['approach'].capitalize()} delivery",
                      "md": "A worked example in a different industry, showing how the ideas in this chapter play out in practice."}] + md_blocks(ex["body"])
        practice = {"code": "practice", "sort_order": 1, "required": True, "provenance": "original", "kind": "self_check",
                    "spec": {"prompt": md_inline(s["activity"]["prompt"])},
                    "answer_key": {}, "sample_response": {"text": "My response."},
                    "feedback": {"explanation": "**Compare with a model answer.** " + md_inline(s["activity"]["model"])}}
        kc_blocks, kc_acts, k = [], [], 1
        for c in s.get("cases", []):
            kc_blocks.append({"type": "scenario", "origin": "original", "title": c["title"], "body": md_inline(c["body"]),
                              "decision": "Use this case for the questions marked **Case A**."})
        kc_blocks.append({"type": "text", "origin": "editorial", "md": "Answer every question, then read the feedback. Right or wrong, every answer counts towards completing the chapter, and you can try again."})
        shown = set()
        for q in s["check"]:
            if q.get("exhibit") and q["exhibit"] not in shown:
                kc_blocks.append(figure_block(figmap[q["exhibit"]], f"Exhibit for question {k}")); shown.add(q["exhibit"])
            if q["type"] == "hotspot":
                kc_blocks.append(figure_block({"caption": "Exhibit: release burnup chart", "svg": q["image"],
                                               "text": re.search(r"<desc[^>]*>(.*?)</desc>", q["image"], re.S).group(1)}, f"Exhibit for question {k}"))
            acts = kc_activity(q, f"kc-{k}", k)
            for a in acts: kc_blocks.append({"type": "activity", "code": a["code"]})
            kc_acts += acts; k += len(acts)

        lesson_min = max(1, t["lesson"] + t["reading"] - 1)
        sections = [
            {"code": "lesson", "sort_order": 1, "title": s["title"], "est_minutes": lesson_min, "blocks": lesson_blocks},
            {"code": "worked-example", "sort_order": 2, "title": f"Worked example: {ex['title']}", "est_minutes": t["example"], "blocks": ex_blocks},
            {"code": "practice", "sort_order": 3, "title": "Practice activity", "est_minutes": t["activity"],
             "blocks": [{"type": "text", "origin": "editorial", "md": "Write your response, submit it, then compare it with the model answer. Your response is saved to your account and is not graded."},
                        {"type": "activity", "code": "practice"}], "activities": [practice]},
            {"code": "recap", "sort_order": 4, "title": "Recap", "est_minutes": 1, "blocks": [{"type": "summary", "origin": "original", "items": [md_inline(x) for x in s["recap"]]}]},
            {"code": "knowledge-check", "sort_order": 5, "title": "Knowledge check" if not s.get("cases") else "End-of-course assessment",
             "est_minutes": t["check"], "blocks": kc_blocks, "activities": kc_acts},
        ]
        est = sum(x["est_minutes"] for x in sections)
        if est != s["minutes"]: err(f"{cid}: section minutes {est} ≠ {s['minutes']}")
        chapters_out[cid] = {
            "id": cid, "est_minutes": s["minutes"], "review_status": "draft",
            "meta": {"summary": md_inline(s["recap"][0]), "outcomes": [md_inline(o) for o in s["objectives"]],
                     "source": {"edition": "Original iParkar Learning content · references PMBOK® Guide 8th ed. (2025) and the PMP® ECO (July 2026)"},
                     "course_section_id": s["id"], "category": CATS[s["category"]], "approaches": s["approaches"],
                     "eco_tasks": [f"{eco_label(e)}: {ECO[e.split('-T')[0]][1][int(e.split('-T')[1]) - 1]}" for e in s["eco"]],
                     "references": refs, "time": t},
            "sections": sections,
        }
        manifest_chapters.append({"id": cid, "domain": n, "title": s["title"], "objectives": [eco_label(e) for e in s["eco"]],
                                  "prerequisite": False, "pages": None, "course_section_id": s["id"], "category": CATS[s["category"]],
                                  "minutes": s["minutes"], "approaches": s["approaches"]})
        register.append({"chapter": cid, "course_section_id": s["id"], "module": n, "title": s["title"], "category": CATS[s["category"]],
                         "minutes": s["minutes"], **{f"min_{k}": v for k, v in t.items()}, "eco_tasks": "; ".join(eco_label(e) for e in s["eco"]),
                         "pmbok_references": "; ".join(refs), "approaches": ", ".join(s["approaches"]),
                         "example_industry": ex["industry"], "check_items": len(kc_acts), "review_status": "draft"})
    for k in CATS:
        if mcat[k] != dict(zip(CATS, BUDGET[n]))[k]: err(f"module {n}: {CATS[k]} {mcat[k]} ≠ budget")
    manifest_domains.append({"domain": n, "title": m["title"], "weight": round(sum(mcat.values()) / 60, 2),
                             "chapter_count": len(data["sections"]), "summary": m["summary"],
                             "category_minutes": {CATS[k]: v for k, v in mcat.items()}})

if sum(totals.values()) != 2100: err(f"total {sum(totals.values())} ≠ 2100")
if totals != {"business_acumen": 480, "ways_of_working": 1140, "power_skills": 480}: err(f"category totals {totals}")
for d, (_, tasks) in ECO.items():
    for i in range(1, len(tasks) + 1):
        if f"{d}-T{i}" not in coverage: err(f"ECO {d}-T{i} not covered")
if min(approach_cov.values()) < 5: err(f"approach coverage {approach_cov}")

manifest = {
    "schema": "iparkar.course-manifest/1",
    "course": {"code": "PMP-SPS", "title": "PMP® Exam Prep Course", "product": "iParkar Learning", "version": course["version"].split("-")[0] if False else "1.0.0",
               "completion_policy": "all_required_chapters", "duration_hours": 35, "description": course["description"].strip()},
    "source": {"title": "iParkar Learning PMP® Exam Prep Course (original content)", "edition": "1.0",
               "stated_blueprint": "PMP® Examination Content Outline, July 2026",
               "blueprint_note": "Chapters map to the 26 tasks of the July 2026 PMP ECO (People 33%, Process 41%, Business Environment 26%). "
                                 "Module hours track PMI Talent Triangle® categories: Business Acumen 8 h, Ways of Working 19 h, Power Skills 8 h.",
               "references": ["PMI, The Standard for Project Management and A Guide to the Project Management Body of Knowledge (PMBOK® Guide), 8th ed., 2025",
                              "PMI, PMP® Examination Content Outline, July 2026", "PMI® Certification Handbook, revised June 2026"]},
    "domains": manifest_domains,
    "chapters": manifest_chapters,
}

for e in errors: print("✗", e)
if errors: print(f"{len(errors)} problem(s); nothing written."); sys.exit(1)
os.makedirs(OUT_CH, exist_ok=True); os.makedirs(OUT_PUB, exist_ok=True)
for f in glob.glob(os.path.join(OUT_CH, "*.json")): os.remove(f)
for cid, c in chapters_out.items():
    json.dump(c, open(os.path.join(OUT_CH, f"{cid}.json"), "w"), ensure_ascii=False, indent=1)
json.dump(manifest, open(os.path.join(OUT_PUB, "manifest.json"), "w"), ensure_ascii=False, indent=1)
with open(os.path.join(OUT_PUB, "content-register.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(register[0].keys())); w.writeheader(); w.writerows(register)
with open(os.path.join(OUT_PUB, "coverage.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["eco_code", "domain", "task", "chapters"])
    for d, (dn, tasks) in ECO.items():
        for i, tn in enumerate(tasks, 1):
            w.writerow([eco_label(f"{d}-T{i}"), dn, tn, " ".join(coverage[f"{d}-T{i}"])])
acts = sum(len(s.get("activities", [])) for c in chapters_out.values() for s in c["sections"])
print(f"OK: {len(manifest_domains)} modules, {len(chapters_out)} chapters, {sum(len(c['sections']) for c in chapters_out.values())} sections, "
      f"{acts} activities, {sum(totals.values())} minutes {totals}, approaches {approach_cov}")
