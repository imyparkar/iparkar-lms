# Live instructor-led courses (app.iparkar.com/live/&lt;course&gt;)

Status on 25 Nov 2026: built and tested locally on branch `feat/ohbp-course`; first course **Basic Principles in Occupational Hygiene** (`OHBP`). Not yet applied to production.

## What was built

| Area | Where |
|---|---|
| Schema, rules, RPCs, RLS, OHBP seed | `supabase/migrations/20261125000100_live_courses.sql` |
| Learner course page: schedule and Teams links, attendance and make-ups, practicals, independent study, exam, certificate | `/live/[course]` |
| Exam rules and permitted aids → start | `/live/[course]/exam` |
| Server-timed exam workspace (autosave, reconnect, submit on expiry) | `/live/[course]/exam/[attemptId]`, `src/components/live/LiveExam.tsx` |
| Result: score, pass/fail, revision guidance by unit (no answer keys shown) | `/live/[course]/exam/[attemptId]/result` |
| Practical uploads (private R2, PDF/DOCX/XLSX/PNG/JPG ≤ 10 MB, signature-checked) | `POST /api/live/submissions`, `GET /api/live/submissions/[id]` |
| Learner briefs for practicals (private R2) | `GET /api/live/briefs/[course]/[P1…]` |
| Admin: cohorts, waiting learners, offline payments, exam forms | `/admin/live` |
| Admin: one cohort — schedule and Teams links, attendance, make-up review and extensions, marking, extra time, progress | `/admin/live/[cohort]` |
| Exam bank import (service role) | `npm run import:live-exam -- --file imports/ohbp/ohbp-exam-forms.json` |
| Razorpay dispute (chargeback) events | `/api/webhooks/razorpay` → `service_record_payment_dispute` |
| Certificate template without PMI artwork | `course-a4-landscape-v1` in `src/lib/certificates/pdf.ts` |
| Tests | `tests/db/live-course.test.ts` (19) |

## The rules (all enforced in the database)

- **Enrolment.** A purchase (Razorpay at KD 60 or the local equivalent, or an offline payment recorded by an admin) or an admin grant. No free trial. Learners are placed in a cohort by an admin; the cohort gets the course's 12 sessions.
- **Joining links.** Shown only to an enrolled learner whose purchase is verified (or with admin/pilot access) while access is open, and only until an hour after each session ends. Links must be Microsoft Teams URLs.
- **Attendance and make-up.** Instructor records present/missed from the Teams attendance report. A missed session is satisfied by watching the captioned recording and submitting the make-up task within 14 days, then instructor approval. Admins can extend a deadline (1–30 days, with a reason).
- **Practicals.** Marked out of 10, pass 6, written feedback required. One resubmission within 14 days of marking (individually or in the make-up clinic).
- **Independent study.** Six SCORM modules in `ohbp-study`; complete = SCORM `completed`/`passed`. Session slides (`ohbp-slides`) are for review and not required. Both open only to learners with access.
- **Exam.** Unlocks when every session, practical and module is complete. 40 single-best-answer items, 1 mark each, 60 minutes (75 with the approved +25%), pass 24/40. Server deadline; answers saved with a sequence number (stale writes ignored); reloading or reconnecting resumes the same attempt and deadline; answers arriving within 5 s of the deadline count; an attempt still open 30 s after the deadline is closed as *expired* with its saved answers (on every read, and every minute by pg_cron where installed). Submitting again returns the same result. Three attempts in all, 7 days after a failed attempt; each retake uses the form the learner has not seen. Keys and rationales never leave the database.
- **Certificate.** Issued only when the same enrolment has (1) a verified purchase — a captured payment, not refunded in full or in part, no open or lost dispute, purchase not revoked; pilot, trial, pending and admin-grant-only access never qualify; (2) every session (or approved make-up), practical and independent module complete; and (3) an exam result ≥ 24/40. One certificate per enrolment (course version); repeat requests return the same one. The purchase is re-checked on every generate **and download** request; after a refund or chargeback the learner's download is refused (administrators keep access for audit). Issue, claim and eligibility events are in the audit log.

## Go-live (owner)

1. **Decided (25 Nov 2026):** fee **KD 60** per place (365 days' access), with local prices US$195, £145, €175, AED 710, SAR 725, QAR 700, BHD 75, OMR 75, ₹18,500 (`src/lib/payments/catalogue.ts`); certificate signatory **Imran Parkar, CIH, CIT — Course Instructor**. **Still needed:** the occupational hygiene reviewer's sign-off of exam Forms A and B; written permission for the course title. If the course is listed on iparkar.com, show the same prices there.
2. **Database:** apply `20261125000100_live_courses.sql`. Additive; it also replaces `scorm_open_course`, `scorm_can_view`, `scorm_my_courses`, `study_certificate_status`, `study_claim_certificate` and `study_certificate_file` with versions that keep the existing behaviour for other courses (all existing tests pass).
3. **Exam bank:** copy `ohbp-exam-forms.json` (assessor only) into `imports/ohbp/` (git-ignored) and run `npm run import:live-exam -- --file imports/ohbp/ohbp-exam-forms.json`. After the technical review, tick *Technical review complete* and *Open to learners* for each form in Admin → Live courses.
4. **Files:** from this repo, logged in to Wrangler: `bash "<course folder>/lms/upload-ohbp.sh" "<course folder>/lms"` uploads the 6 independent-study and 12 slide packages and the 5 learner briefs. Then publish the two SCORM courses: `update scorm_courses set status = 'published' where code in ('ohbp-study', 'ohbp-slides');`
5. **Razorpay:** add the `payment.dispute.*` events to the existing webhook subscription.
6. **Cohort:** Admin → Live courses → create the cohort, then in the cohort set each session's date, Teams link and instructor.
7. **App:** deploy as usual.

**Rollback:** the learner pages are new routes; reverting the app removes them. The schema additions can stay (nothing else depends on them).

## Verified

- `vitest run`: all suites pass, including 19 new live-course tests: 23/40 fails and 24/40 passes; repeat submission returns the same result; closed attempts refuse saves; reconnect keeps the deadline and saved answers; stale writes ignored; expiry submits saved answers; the background job closes abandoned attempts; cooldown and unseen retake form; +25% time; attempt limit; exam locked until activities complete; make-up window, recording confirmation and approval; practical resubmission limits and file-key ownership; Teams-only links; links hidden without a verified purchase; SCORM modules locked to entitled learners; certificate refused without purchase (admin/pilot), for pending orders, after a full or partial refund, during an open dispute, and before the exam is passed; one certificate per enrolment; download refused to other learners and after refund; offline payment and refund; forms already sat cannot be changed; PMP rule unchanged. A local-only test loads the real Forms A and B and checks the 2/6/8/8/8/8 split.
- Not verified yet: the production database, R2 objects, Razorpay dispute webhooks and a live Teams pilot session.
