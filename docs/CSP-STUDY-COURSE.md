# CSP Self Paced Study Course — build, policy and handoff

Status on 15 Nov 2026: **all 60 chapters converted and validated as draft content (version `1.0.0-draft`), not imported, not published, 0 subject-reviewed.** The course runs on the same study engine as ASP-SPS (`docs/STUDY-COURSE.md`); this file covers what is specific to CSP.

## 1. Sources

| Input | Used | Notes |
|---|---|---|
| iParkar CSP Exam Study Guide — Reader edition, 9 Nov 2026, 1,203 pp. | Primary teaching source | Single PDF from the owner's `CSP LMS` folder. PDF page numbers equal the printed folios. |
| BCSP CSP11 Examination Blueprint V.2024.04.24 (supplied `CSP-Blueprint.pdf`) | Objective list (47) | Matches the guide's stated alignment. bcsp.org was still serving V.2024.04.24 for CSP11 when checked by web search on 15 Nov 2026; secondary sources give 1 Aug 2025 as the effective date. **Confirm on bcsp.org before publishing.** Exam-format claims in the guide's front matter (200 items, 5.5 h) are not shown in the course. |
| iParkar design system | Existing LMS tokens/components only | No new tokens or colours. Section 6 of `docs/STUDY-COURSE.md` is the design inventory and applies unchanged; the CSP additions are listed in section 6 below. |
| Existing LMS | Extended | Same tables, RPCs, completion rules, access/trial model, player, protected drawings. |

## 2. Curriculum (public, in git)

| File | Contents |
|---|---|
| `content/csp-sps/manifest.json` | 7 domains, 60 chapters: outline titles from pp. 4–6 (exact), the body heading title, objectives, objective verbs, ★ primary-topic flag, `cross_links` (from each chapter's Related chapters), `builds_on` / `leads_into` (source-supported recommendations, **not enforced**), PDF page ranges discovered from the body, domain divider/opener pages, glossary and bibliography ranges, self-validation |
| `content/csp-sps/coverage.csv` | 47 objectives → chapters, sections, required activities, practice questions. 0 uncovered |
| `content/csp-sps/question-reconciliation.csv` | The cover's 591 questions: 57 chapters × 10 + 1.1 (7) + 1.2 (8) + 3.1 (6) = **591 found, 591 with answer and explanation, every key among four options**. No missing or duplicate items |
| `content/csp-sps/content-register.csv` | Per chapter: source range, sections, activities, questions, tables, figures, equations, overrides, flags, status, review/check columns |
| `content/csp-sps/review-flags.json` | Every conversion flag and review note, per chapter |
| `content/csp-sps/access.json` | 7-day trial, US$120 / 365 days (mirrors the Resources card decision) |

Order and mappings preserved as the brief requires: 2.1→2.8; 2.2→2.1+2.2; 2.13 and 2.14→2.14; 6.1–6.9→6.1; 6.10→6.3; 6.11→6.2; training order 7.1, 7.6, 7.2, 7.5, 7.3, 7.4. ★ chapters: 1.1, 2.1, 2.7, 2.13, 3.1, 3.3, 4.3, 6.1. Domain weights are shown as the guide's exam distribution; every chapter counts equally toward completion.

Outline vs body titles: 22 chapters have a shorter or reworded body heading (e.g. 1.1 "Prevention through Design"). The outline title is the course title (manifest `title`); the body heading is kept in `heading_title`.

## 3. Lesson content (private, git-ignored)

This repository is public, so lesson content lives in `imports/csp-sps/` (ignored) and reaches learners only through the access-checked RPCs. A copy was delivered to the owner's `CSP LMS` folder as `csp-sps-content-2026-11-15.zip`; keep it private. To restore: unzip into the repo root so that `imports/csp-sps/` exists.

| Path | Contents |
|---|---|
| `imports/csp-sps/chapters/<id>.json` | 60 chapter packages |
| `imports/csp-sps/resources.json` | glossary (1,098 terms), bibliography (343 entries), formula sheets for domains 1–7 |
| `imports/csp-sps/assets/csp-sps/*.webp` | 61 original drawings (2.4 MB), served only via `/api/study/asset` |
| `imports/csp-sps/authoring/overlays/<id>.json` | Hand-written TeX overrides and review notes (4 equations so far) |

### Chapter pattern (from the guide's own anatomy)

1. **Opening scenario and objectives** — the guide's scenario and "Decision to revisit", learning objectives, and a required "Your first call" write-then-compare activity.
2. **Core teaching** — one section per guide topic, small topics merged to about 5–10 minutes (editorial estimates). Tables, callouts (exam pitfalls etc.), equations (KaTeX + MathML + "Equation in words"), the guide's figure with its own alt text.
3. **Worked application** — the guide's worked examples, step by step.
4. **Exam practice** — optional active-recall prompt; every CSP-style question as an interactive single-choice item, answers hidden until submitted, then the guide's explanation (including distractors), retry and a "Review the lesson" link to the best-matching section. **5 questions per chapter are required** (spread across the set, 360 required activities in all); the rest are optional practice.
5. **Review and close the scenario** — summary, common mistakes, key terms, related chapters (linked), key formulas, works cited, and an editorial prompt to revisit the first call.

Totals: 646 sections, 711 activities (360 required), 71 worked examples, 365 tables, 61 figures, 421 equations, about 50 hours of editorial reading estimate.

## 4. Pipeline (in git: `scripts/csp-sps/`)

| Step | Script |
|---|---|
| Manifest | `build_manifest.py <guide.txt> content/csp-sps/manifest.json` (`pdftotext guide.pdf guide.txt`) |
| Layout | `pipeline/extract.py` — ASP extractor plus bold/italic from the PDF structure tree, KaTeX line detection, full-width cards, CSP table body size, long subscripts |
| Equations | `pipeline/eqtex.py` — rebuilds TeX from KaTeX glyph geometry (fraction bars, scripts, radicals, accents, stacked rows, sized delimiters) and from text-set formulas |
| Chapters | `pipeline/convert.py <id>… / --all` (env: `LMS_ROOT`, `CSP_GUIDE_PDF`, `CSP_GUIDE_TEXT`, `PYTHONPATH=scripts/csp-sps/pipeline`; optional `CSP_CACHE` from `pipeline/cache_all.py`) |
| Resources | `pipeline/build_resources.py` |
| Registers | `build_registers.py` |
| QA | `qa/eqsheet.py` (printed crop beside KaTeX render), `qa/csp_journey.py`, `qa/axe_access.py` |

To fix a chapter: add an overlay (`equations` keyed by the `key` in `meta.checks.equation_sources`, or `fixes: [{find, replace}]`), rerun `convert.py <id>`, `build_registers.py`, then the dry-run import. Re-imports keep learner progress unless sections/required activities change on a version with learners.

## 5. Completion policy

Identical to ASP-SPS and enforced by the same SQL (`study_finish_chapter`): every required section opened then marked studied, every required activity attempted with feedback acknowledged (right or wrong), then Finish chapter. No score gate, no dwell time, opening or scrolling never completes. Course completes at 60/60 of the pinned version, once (tested with concurrent finishes). Progress is participation, not a predicted score; the completion record says "Completed the iParkar Learning CSP Self Paced Study Course" with the independence statement and never "CSP certified". The guide's 150-hour plan is not used as a requirement.

## 6. Engine changes made for CSP (shared code)

- `src/lib/study/courseProfile.ts`: per-course wording (exam mark, blueprint label, guide name, overview, start hint, "separate from" product). Replaces ASP text that was hard-coded on My learning, the overview, domain page, player, beta notice, paywall, completion record.
- Manifest schema accepts 1–12 domains (was exactly 9). Activity specs may carry `source_ref` ("question 3, p. 18"), shown as "Practice from the guide".
- `NEXT_PUBLIC_CHECKOUT_URL_CSP_SPS` added to the checkout map.
- Migration `20261115000100_study_resource_kinds.sql`: resources may be `glossary` or `bibliography`; new page `/learn/[course]/resources/[code]`, linked from the overview. Formula-sheet page says "Compiled from this domain's chapters" when the sheet is an editorial compilation (CSP has no printed formula sheets).
- Overview heading counts domains ("Seven domains").
- TI-30XS calculator arrow keys resized (up/down 26×24, left/right 30×30) so they no longer overlap: fixes a WCAG 2.5.8 target-size failure in both the study player and practice exams.
- `tests/e2e/mock-supabase.ts`: `MOCK_COURSE=csp-sps`.
- Design: reused existing tokens/components only. Reference links on the overview use `ink` + underline (action-blue on paper fails contrast, as already noted in the design inventory).

## 7. Verification done (15 Nov 2026)

- `vitest run`: 145 passed (13 new CSP tests: manifest counts and mappings, all 47 objectives covered, ★ chapters, page ranges, not the ASP curriculum; import of a 60-chapter course; no completion on open; 59/60 incomplete, 60/60 completes once under three concurrent finishes; ASP and CSP progress separate; glossary/bibliography resources protected; **all 60 real chapters import, render through the RPC with no answer keys exposed, and complete using only required activities**).
- `tsc` clean; ESLint clean for `src`; `next build` succeeds; `import:study --course csp-sps --dry-run` validates all 60 chapters and 9 resources (schema, page ranges, TeX compiles).
- Equations: all 421 rendered beside their printed crops on contact sheets and compared by eye; 4 hand overrides (6.2 nested script, 6.3 stacked rows, 6.3 clipped source, 4.4 cases). Figures: all 61 crops inspected.
- Browser (Chrome, production build, mock backend): sign in → overview (7 domains) → 1.1; forced early Finish refused; first call; autosave "All changes saved"; note + bookmark; sign out clears local study keys; second device at 390 px resumes at the same section with the note; wrong answers still complete; "1 of 60 chapters done"; another learner sees no note; glossary, formula sheet 6 (113 equations) and 6.3 render with 0 KaTeX errors.
- axe WCAG 2.0/2.1/2.2 A/AA: **0 violations** on My learning, overview, domain, formula sheet, glossary, four player screens, paywall and not-started states, at 1440 and 390 px.

Not verified: a manual screen-reader and keyboard-only pass; a live Supabase import; numbers in the guide's worked examples (carried as printed; chapter 1.1 has no calculations).

## 8. Before publication (owner / reviewer)

1. **Subject-matter review of all 60 chapters** (`content-register.csv` → `subject_review`), then set `review_status` to `approved` in each chapter (or an overlay). Publication refuses unreviewed chapters.
2. Review flags (`review-flags.json`): 246 tables captioned from their header row; about 50 equations with stretched delimiters, 17 with rebuilt radicals, 8 stacked — all already compared, but a reviewer should confirm; 3 scenarios whose decision was taken from the closing question or given an editorial prompt.
3. Source issues to fix in the guide: p. 734 F-6.3d is clipped in the PDF (course completes it from p. 737); Ch 2.10 subtitle says prevention through design is in "Part 3" (it is Ch 1.1, Part 1).
4. Recompute the guide's worked-example numbers (71 worked examples) — not done.
5. Confirm the current BCSP blueprint on bcsp.org and record the date.
6. Chapters 7.2/7.3: the guide already separates stated learning preferences from the unsupported meshing hypothesis (Pashler et al. 2008; Noe 2023); titles kept exactly. Reviewer to confirm.
7. Not built yet: course-wide search (also outstanding for ASP), domain introduction pages beyond the existing domain view.

## 9. Setup, release and rollback

1. Apply `supabase/migrations/20261115000100_study_resource_kinds.sql` (additive). The two ASP study migrations must already be applied.
2. Restore `imports/csp-sps/` from the private zip, then `npm run import:study -- --course csp-sps --dry-run` and, with `ADMIN_EMAIL`/`ADMIN_PASSWORD` (CAPTCHA briefly off, as for ASP), without `--dry-run`. This imports version `1.0.0-draft`, the 9 resources and the access settings.
3. `scripts/upload-study-assets.sh csp-sps` uploads the 61 drawings to the private R2 bucket.
4. Pilot-enrol reviewers in `/admin/study`. Learners see nothing until a version is published and marked the enrolment default.
5. To open sales: Paddle price + `study_products` row for `CSP-SPS` + `NEXT_PUBLIC_CHECKOUT_URL_CSP_SPS`; on iparkar.com set `open:true` for CSP in `studyCourses` (`build.mjs`). Not done.

Rollback: `delete from study_courses where code = 'CSP-SPS'` (cascades to its versions, chapters and progress — only before learners exist), and revert the migration's check constraint as noted in its header.

Local preview: `MOCK_COURSE=csp-sps npx tsx tests/e2e/mock-supabase.ts`, `.env.local` as in `docs/STUDY-COURSE.md` §8, `npm run dev`.
