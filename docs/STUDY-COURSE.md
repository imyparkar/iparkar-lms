# ASP Self Paced Study Course — engine, policy and handoff

Status on 14 Nov 2026: **engine complete and tested; 99 of 99 chapters authored as drafts (647 sections, 789 activities, 1,268-page source); 0 subject-reviewed; 0 published.** Chapter 1.1 was written by hand; chapters 1.2–9.7 were converted from the guide PDF by a layout-aware pipeline, with every equation transcribed to TeX by hand and original knowledge checks added. The course version `1.0.0-draft` cannot be published until every chapter has an approved review status: the database refuses it.

## 1. What was built

| Area | Where |
|---|---|
| Curriculum manifest: 9 domains, 99 chapters, exact titles, objective mapping (84 top-level / 109 incl. lettered), PDF page ranges for every chapter, part contents, formula sheet and glossary | `content/asp-sps/manifest.json` (built by `scripts/asp-sps/*.py` from the guide text) |
| Content register (per chapter: source range, sections, activities, KC, worked examples, tables, equations, figures, conversion flags, review and check status) | `content/asp-sps/content-register.csv` |
| Objective coverage matrix (109 objective codes, 84 top-level → chapters, sections, required activities, KC items; none uncovered) | `content/asp-sps/coverage.csv` |
| Content pipeline (PDF → chapters) | `scripts/asp-sps/pipeline/` (see its README) |
| Database: study courses, versions, domains, chapters, sections, activities, enrollments, section/chapter progress, attempts, resume, bookmarks, notes, completions; RLS; RPCs | `supabase/migrations/20261113000100_study_course.sql` |
| Content schema (validated blocks + activities) and package builder | `src/lib/study/schema.ts`, `src/lib/study/package.ts` |
| Import CLI | `npm run import:study -- --course asp-sps [--dry-run]` |
| Learner UI | `/learn` (My learning), `/learn/asp-sps` (overview), `/learn/asp-sps/domain/[n]`, `/study/asp-sps/[chapter]` (player), `/learn/asp-sps/completion` |
| Admin UI | `/admin/study` (versions, status, pilot/normal enrolment, revoke) |
| Tests | `tests/db/study-course.test.ts` (21 tests incl. 98/99 vs 99/99, concurrency, privacy, versioning) |
| Local end-to-end harness (dev only) | `tests/e2e/mock-supabase.ts` |

**Lesson content is not in git.** This repo is public, so chapter files live in `imports/asp-sps/chapters/*.json` (git-ignored, like the item banks) and reach learners only through `get_study_chapter`, which checks enrolment. Keep the authored JSON in a private location (the Claude project holds a copy of 1.1). Practical limit: anyone enrolled can read and copy what is shown to them; nothing can prevent that.

## 2. Completion policy (completion-based, no score gate)

A required chapter completes only when the **server** verifies, inside `study_finish_chapter`:
1. every required section was opened (`study_open_section`) and then explicitly marked as studied (`study_ack_section` refuses unopened sections);
2. every required activity has at least one attempt whose feedback the learner acknowledged (`study_ack_feedback`); right or wrong both count;
3. the learner pressed Finish chapter.

Opening, scrolling and time on page never complete anything. Active time (`study_record_time`, capped 120 s per call, visible tab + recent input only) is an estimate and never a gate.

Progress = completed required chapters ÷ required chapters, from canonical rows; displayed percentages are floored so 98/99 shows 98 %, never 100 %. A domain completes when all its chapters do. The course completes when all required chapters of the **pinned version** are complete: `study_finish_chapter` locks the enrolment row (`FOR UPDATE`) and inserts the completion with `ON CONFLICT DO NOTHING` (unique per enrolment and per learner+version), so refreshes, replays and parallel tabs produce exactly one record and one audit entry (tested with three concurrent finishes). A chapter with no lesson content is "in preparation" and cannot be completed, so the course cannot reach 100 % while any chapter is missing.

Activities are graded in SQL; keys never leave the database before an attempt. Submissions carry a client UUID, so a replayed submission returns the original result instead of a second attempt.

## 3. Versioning

Enrolments are pinned to a course version. Imports upsert by stable codes (chapter `1.1`, section `unit-factor`, activity `kc-psi`), so ids and learner progress survive wording fixes. On a version that has enrolments, the import compares the set of chapters, required sections and required activities before/after and **rejects material changes** — create a new version (`--version 1.1.0`) and decide how to move learners (not automated; needs an admin decision). Completion records snapshot learner name, course title and version label. `admin_study_reset_chapter` is the only reset path: admin-only, reason required, audited, completion history kept.

## 4. Enrolment

Separate from practice-exam entitlements and payments (nothing in Paddle, products or exam access was touched). `study_courses.enrollment_policy` is `admin` by default; `self` allows `study_self_enroll` into the published default version. Pilot enrolment (`/admin/study`, tick "Pilot") lets named reviewers use an unpublished version and is labelled "Pilot (unpublished)" in the learner UI.

**Decision needed from the owner:** who gets the course once published — every signed-in user (like the free PDF guide → set policy `self`), ASP practice-exam buyers, or a separate product.

## 5. Security

All study tables have RLS on and no grants to `anon`/`authenticated` except admin-only reads of courses/versions/enrolments/completions. Every learner action is a `SECURITY DEFINER` RPC that derives the learner from `auth.uid()` and the enrolment from the chapter/section; no RPC accepts a user id, completion flag, score, count or percentage from the client. Tests prove direct reads of `study_activities.answer_key`, sections and notes are refused and that one learner cannot see or acknowledge another's notes, bookmarks, attempts or completion. Local unsynced writes (resume, notes) are stored under a key scoped to the learner id, buffers for other accounts are discarded on load, and sign-out clears them.

## 6. Design inventory (iParkar Design System artifact → LMS)

| UI element | Token / component used |
|---|---|
| Canvas, cards | `paper` canvas; `white` cards with 1 px `border-hairline`, `radius-card` 12 px, `card-padding` 24 px; no shadows on content |
| Top bars | `white`, `shadow-nav`, `nav-height` 64 px; nav links `ink-54` → `ink`, current `action-blue` (on white) |
| Primary action | `action-blue` filled button, one per screen: Continue learning / Finish chapter |
| Secondary actions | outlined button (`ink-90` border) and text buttons. The ghost button (`action-blue` on `sky-tint`, 4.05:1 — a known source pair) is **not** used in study screens so they pass WCAG AA |
| Status pills | Not started = `sky-tint` + ink; In progress = `marigold` + ink; Completed = `midnight` + white (the system's `ip-pill--todo/progress/done`); the word carries the status |
| Hero / scenario | `surface-dark` (`midnight`) island, `marigold` eyebrow, serif `lead` for the decision line |
| Domain cards | header panels rotate `marigold`, `sky-wash`, `coral`, `moss-green`, `saffron`, `mocha`, all with `ink` text |
| Callouts | source/course note `sky-tint`; exam tip `marigold`; watch-out `coral`; regional `moss-green`; ink text, label word in every callout (no left-border cards) |
| Type | Inter headings/UI; Source Serif 4 for leads only; lining numerals; body 16/24 in `charcoal` for long reading; reading column 720 px (extension `maxWidth.reading`) |
| Progress meter | `action-blue` fill on `ink-20` track (white/marigold on midnight); text "n of N · p%" is the accessible value |
| Equations | KaTeX HTML + MathML (screen-reader readable), plus "Equation in words" disclosure |
| Logo | `/brand/iparkar-mark-primary.svg`, reversed on midnight (completion record) |

Extensions (documented): Tailwind config gained the design system's brown-green tokens (`forest-green`, `olive-green`, `moss-green`), which existed in the artifact but not in the app config, and `maxWidth.reading` (720 px). Breadcrumbs on `paper` use `graphite` because `ink-54` on paper is 4.49:1. On phones narrower than 480 px the header shows the mark without the wordmark (the link keeps its accessible name) so the nav fits.

## 7. Verification done (13 Nov 2026)

- `vitest run`: 120/120 tests pass (21 new study tests + existing suites; the upgrade test confirms the migration is re-runnable).
- `tsc --noEmit` clean; `next build` succeeds; ESLint clean for new code.
- Chapter 1.1 package validates (schema, page ranges inside pp. 9–17, all TeX compiles, every activity accepts its own sample answer) and completes end to end in the DB test.
- Every number in chapter 1.1's worked examples and activities was recomputed independently (e.g. 5,000 cfm = 2.3597 m³/s; 2.5 m³/s = 5,297 cfm; 96 in² = 0.0619 m²; 115 °F = 46.1 °C = 319.3 K; the flagged 9(°C+32)/5 error gives 140.6 °F; 80 kg = 784.8 N = 176.4 lbf; 2,500 gal = 9.46 m³; 40 km/h = 36.5 ft/s; practice: 140 in² = 0.972 ft², 52 °C = 125.6 °F, 50 psi = 344.75 kPa, 70 kg = 686.7 N).
- Browser run (Chrome, production build, against the mock backend): sign in → open 1.1 → forced early Finish refused with the to-do list → wrong answer gets feedback, retry and lesson link → bookmark + note → sign out (study buffers cleared) → sign in on a 390 px "second device" → resumes at the same section with the note → finish all sections → chapter complete, 1 of 99 (1 %) → second learner sees no notes and their own status.
- axe-core WCAG 2.0/2.1/2.2 A/AA: 0 violations on My learning, overview, domain, player (two sections) and completion pages at 1440 px and 390 px. A manual screen-reader and keyboard-only pass is still to do.
- Not verified against a real Supabase project yet; apply the migration to staging first.

## 8. Setup and rollback

1. Apply `supabase/migrations/20261113000100_study_course.sql` to the staging project (`supabase db push` or SQL editor). It is additive and re-runnable.
2. `npm run import:study -- --course asp-sps --dry-run`, then without `--dry-run` (needs `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
3. In `/admin/study`, pilot-enrol reviewers by username.
4. Deploy as usual (`npm run cf:deploy`). Nothing is public until learners are enrolled.

Rollback: the feature is isolated in `study_*` objects. To remove it, drop the study functions and tables (`drop table public.study_course_completions, public.study_notes, public.study_bookmarks, public.study_resume, public.study_activity_attempts, public.study_chapter_progress, public.study_section_progress, public.study_enrollments, public.study_activities, public.study_sections, public.study_chapters, public.study_domains, public.study_course_versions, public.study_courses cascade;` then the three `study_*` types). No existing table was altered.

## 9. Content produced, and what review must still cover

| Item | Count |
|---|---:|
| Chapters with lesson content | 99 / 99 |
| Sections (5–15 min each, editorial estimates) | 647 |
| Required activities | 789: 294 original knowledge-check questions (3 per converted chapter, 5 in 1.1; 166 numeric), the guide's own Try-it items (numeric where the answer is a single value, otherwise write-then-compare), and a "first call" on each opening scenario |
| Worked examples / tables / equations / figures | 333 / 123 / 173 / 180 |
| Estimated study time (editorial) | about 63 hours |

How the converted chapters were made: tables come from the PDF's header fills and row rules (cell by cell, including tables that continue across pages); worked-example rows, callouts, two-column end matter, sub/superscripts and figure alt text come from the layout; all 173 equations were transcribed to TeX from rendered page crops and compile; figures are presented as the guide's own description (alt text) because the drawings themselves are not shipped. Every block keeps its source page.

Verified: every chapter validates against the schema; every chapter imports into the database and can be completed with its answer keys; 647 sections render in the browser with no errors and no TeX fallbacks; axe WCAG 2.2 AA shows 0 violations on converted chapter pages (worked-example tables, figures, equations) at desktop and mobile widths; every number in the knowledge checks was recomputed.

Not yet verified, and required before publication:
- **Subject-matter review of every chapter** by an authorised reviewer, then `review_status: approved` per chapter (`content-register.csv` tracks it).
- **Numbers in the guide's own worked examples** (333) are carried as printed. Chapter 1.1's were recomputed; the rest need the same check.
- **Conversion flags** (63 across all chapters, listed in each chapter's `meta.checks.flags`): tables named from their headers, drawing labels dropped, worked examples whose source has no separate Answer row. Each is a prompt to compare with the PDF page.
- **Figures**: diagrams are described, not drawn. Decide whether to add the original drawings as protected images.
- Domain introductions, the part formula sheets and glossaries as course resources, course-wide search, and BCSP calculator/blueprint policy checks (section 7 of the brief) remain to build.
- Manual screen-reader and keyboard pass; run against the real Supabase staging project.

To rebuild a chapter after a fix: edit its overlay in `imports/asp-sps/authoring/overlays/<id>.json` (or `kc_*.py` / `eq_*.py` and re-save), run `python3 scripts/asp-sps/pipeline/convert.py <id>`, then `npm run import:study -- --dry-run` and the import. Re-imports keep learner progress unless the set of sections or activities changes on a version that already has learners (then publish a new version).
