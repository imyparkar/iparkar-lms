# Free SCORM courses (app.iparkar.com/free/&lt;course&gt;)

Status on 17 Nov 2026: built and tested locally; first course **Systematic Approach to Training (SAT)**, six SCORM 1.2 modules (overview + one per ADDIE phase), free for every active signed-in learner. Linked from the Resources page on iparkar.com.

## What was built

| Area | Where |
|---|---|
| Catalogue, per-learner run-time data, RPCs, RLS, SAT seed | `supabase/migrations/20261117000100_scorm_courses.sql` |
| Course page (progress, modules, start/continue/review) | `/free/[course]` — `src/app/(app)/free/[course]/page.tsx` |
| Full-viewport player + SCORM 1.2 `window.API` | `/scorm/[course]/[module]` — `src/components/scorm/ScormPlayer.tsx` |
| Package files (signed-in only, private R2) | `GET /api/scorm/content/<course>/<module>/<path>` |
| Saving run-time data | `POST /api/scorm/commit` → `scorm_commit` |
| My learning | "Free courses" section (`scorm_my_courses`) |
| Upload | `scripts/upload-scorm.sh` |
| Tests | `tests/db/scorm.test.ts` (11) |

## How it works

- **Access.** `scorm_courses.access = 'signed_in'`: any active learner may open a **published** course; admins can open drafts. Suspended and anonymous users are refused by the database (`scorm_open_course`, `scorm_can_view`). Nothing is sold, so there is no enrolment or entitlement row.
- **Run-time data.** `scorm_attempts` keeps, per learner per module: `lesson_status`, `lesson_location` (≤ 255), `suspend_data` (≤ 4096, SCORM 1.2 limit), `score_raw`, `best_score`, `total_time`, session count, first/last launch and `completed_at`. Learners never touch the table; `scorm_launch` returns the `cmi` values and `scorm_commit` validates and saves them.
- **Rules in SQL.** Status never moves backwards from passed/completed (passed › completed › failed › incomplete › browsed); best score is kept; `session_time` is only added on finish and capped at 12 h; the first pass/completion writes one `scorm.module_completed` audit row.
- **Player.** Implements the SCORM 1.2 API (`LMSInitialize`, `LMSGetValue`, `LMSSetValue`, `LMSCommit`, `LMSFinish`, error functions; `cmi.core.*`, `cmi.suspend_data`, `cmi.student_data.mastery_score`, `_children`, `_version`). Writes are batched: a commit is sent at most every 3 s, every 30 s while dirty, on finish, and by `sendBeacon` when the tab is hidden or closed. Activity inside the package frame is relayed to the 10-minute idle sign-out, which otherwise can't see it.
- **Framing.** `X-Frame-Options: DENY` everywhere except `/api/scorm/*`, which is `SAMEORIGIN` + `frame-ancestors 'self'` so only the app's own player can frame a package (`next.config.ts`).
- **Files.** Packages live in the private `iparkar-study-guides` bucket under `lms-assets/scorm/<course>/<module>/`; there is no public URL. Lesson content is not committed here (public repo). Path segments are whitelisted and `..` is refused.
- **Package behaviour.** The iParkar SAT packages read their state from the LMS (`cmi.suspend_data`) and ignore the browser's local copy when an LMS is present, so learners sharing a computer never see each other's progress. Mastery score 80.

## Go-live (owner)

1. **Database:** apply `20261117000100_scorm_courses.sql` (Supabase SQL editor or `supabase db push`). Additive and re-runnable; it seeds the published SAT course.
2. **Files:** on a machine logged in to Wrangler, from this repo:
   ```bash
   D="$HOME/Downloads/iparkar Video - Promo/SAT demo/SCORM"
   scripts/upload-scorm.sh sat overview="$D/iParkar-SAT-00-Overview-SCORM12.zip" analysis="$D/iParkar-SAT-01-Analysis-SCORM12.zip" \
     design="$D/iParkar-SAT-02-Design-SCORM12.zip" development="$D/iParkar-SAT-03-Development-SCORM12.zip" \
     implementation="$D/iParkar-SAT-04-Implementation-SCORM12.zip" evaluation="$D/iParkar-SAT-05-Evaluation-SCORM12.zip"
   ```
3. **App:** deploy as usual (`npm run cf:deploy`, or Workers Builds on push).
4. **Site:** merge the `iparkar-site` change that adds the Free course card to `/resources/`.

Order matters only for the learner experience: if the site goes live before steps 1–3, the link reaches a missing page.

**Rollback:** remove the site card; then `drop table public.scorm_attempts, public.scorm_modules, public.scorm_courses cascade;` and drop the `scorm_*` functions. Nothing else in the schema changed.

## Adding another free course

Insert a `scorm_courses` row (`status 'draft'`) and its `scorm_modules` rows (codes match the upload), upload the zips with the script, open `/free/<code>` as an admin to check, then set `status = 'published'`.

## Local preview

Unzip each package to `imports/scorm/<course>/<module>/` (git-ignored), run the mock backend and `npm run dev` as described in `docs/STUDY-COURSE.md` §8, and sign in as `learner@example.test`.

## Verified

- `vitest run`: all suites pass, including 11 new SCORM tests (catalogue, anonymous/suspended/draft refusal, launch ab-initio/resume, validation of status, score, lengths and timespan, pass recorded once, best score kept, status never regresses, per-learner privacy, no direct table access).
- Browser (dev server + mock backend): anonymous `/free/sat` → sign-in → back to the course; files refused without a session (redirect) and for path traversal (404); `SAMEORIGIN` on package files, `DENY` elsewhere; start → partial → "In progress" → resume at the same page → finish → "Passed", best score, completed date, Next module button; My learning lists the free course; a second learner starts fresh.
- Not verified yet: the production Supabase project and live R2 objects (owner steps above).

## Certificates of completion (added 27 Nov 2026)

SAT issues a certificate of completion: **2 contact hours, 0.2 CEU (provider-issued), self-paced online**, signed by Imran Parkar, Course director.

- **Rule (database):** every module `passed` (the SAT packages report `passed` only at ≥ 80 % in the knowledge checks); `completed` counts only for modules without a mastery score. `scorm_course_completed_at`, `scorm_certificate_status`, `scorm_claim_certificate` in `supabase/migrations/20261127000100_scorm_certificates.sql`.
- **Same pipeline as study courses:** rows in `study_certificates` (with `scorm_course_id`, no enrolment), issued by `/api/certificates/generate` (course `SAT`), stored privately in R2, downloaded from `/api/certificates/<code>`, listed under Certificates, verified at iparkar.com/verify. Verification reports SCORM certificates as valid once issued.
- **Template:** `nordic-a4-landscape-v1`, `src/lib/certificates/nordic-pdf.ts` (owner-approved split-panel design, Fraunces Light + Inter, QR to the verify page, flowing contour lines top right). Course wording lives in `src/lib/certificates/courseText.ts`. The signature is read from private R2 (`certificate-assets/signature.png`, replaced by the owner on 27 Nov 2026).
- **Study courses use the same design (owner, 27 Nov 2026):** PMP-SPS (35 contact hours, 3.5 CEU, Talent Triangle hours on one line under the course subtitle, "|"-separated, signed Imran Parkar, PMP, CIT), ASP-SPS (63 h, 6.3 CEU) and CSP-SPS (50 h, 5.0 CEU), both signed Imran Parkar, CSP, CIT; all as Course director. Study-course certificates still need completion plus purchased access. Already-issued certificates keep their stored PDF.
- **Learner journey:** `/free/sat` shows a "Certificate of completion" card: locked with progress until all six modules are passed, then the name + confirm form and the download.
- **Tests:** `tests/db/scorm-certificates.test.ts` (9).
- **Go-live:** apply the migration, deploy the app. No site change is needed.
