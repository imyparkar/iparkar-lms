# iParkar LMS — premium practice examinations (app.iparkar.com)

Course-isolated practice exams for **ASP**, **CSP** and **CIH**: sign-in, paid access, blueprint-weighted
randomized exams, a server-authoritative timer, on-screen scientific calculator, server-side scoring and
course-scoped analytics. Linked from the **Practice exam** tab on iparkar.com.

- Architecture and security model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Deploy, import the ASP bank, payments, backups: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

```bash
npm install
cp .env.example .env.local      # Supabase URL/keys
npm run dev                     # http://localhost:3000
npm test                        # 74 tests: SQL (in PGlite), parser, calculator, timer, analytics, webhook
npm run cf:preview              # build + run on the Cloudflare Workers runtime locally
```

## Phase status

| Phase | Status | Delivered | Not yet done |
|---|---|---|---|
| 1 Discovery & architecture | Done | Site/repo inspected; architecture, schema and security model documented | — |
| 2 Design system & auth | Built, tested offline | iParkar tokens in Tailwind; sign-in by username or email, sign-up, reset, sign-out, roles, suspension, rate limits; dashboard | Not yet run against a live Supabase project |
| 3 Courses & blueprints | Built and tested | ASP, CSP, CIH as separate courses; all weightings; 9 CIH tasks verbatim; versioned, lockable blueprints | ASP/CSP weightings still *unverified* against official blueprints; CIH: confirm no newer blueprint |
| 4 Question bank | Built and tested | Markdown/CSV import with row-level report, authoring/editing, versions, publish validation, secure selection | Full 1,000-item ASP bank not yet imported (needs the file in `imports/`); SME review/publish |
| 5 Exam engine | Built and tested | Mixed (100 q / 150 min) and domain (20 q / 30 min), navigation, flags, calculator, autosave/offline queue, auto-submit, idempotent scoring | End-to-end browser tests against a live backend |
| 6 Analytics | Built | Course-scoped stats, trend, domain bars, strongest/weakest, missed topics, task-level table, recommendations with sample-size flags | — |
| 7 Payments & admin | Built | Paddle webhook (signed, idempotent, refunds), admin for courses, blueprints, questions, students, attempts, settings, audit | Paddle account, price IDs and eligibility check; checkout page |
| 8 Production readiness | Partly | Workers build verified locally; security headers; runbook; backup plan | Deploy, DNS, live E2E/security tests, backup drill |

## Tests (all passing)

| Suite | Covers |
|---|---|
| `tests/db/exam-engine.test.ts` (32) | Real migrations in PGlite: allocation for all three courses, the seven mandatory course-isolation tests, RLS (students can't read bank/keys, can't write, can't call admin/service RPCs, anon denied), entitlements (expired/revoked), shortage blocking without substitution, scoring with unanswered = incorrect, idempotent concurrent submit, expiry/cron finalization, immediate/restricted feedback, question versioning, blueprint locking and versioning, purchase extension, admin search |
| `tests/unit/itemBank.test.ts` (8) | Parser on real ASP rows, error reporting, CSV, end-to-end import → publish, cross-course import rejected |
| `tests/unit/calculator-clock-analytics.test.ts` (31) | Calculator precedence/functions/errors/injection, fractions, clock immune to device-clock changes, indicators, recommendations, allocation mirror |
| `tests/unit/paddle.test.ts` (3) | Webhook signature, tampering, replay window |

## Key rules (enforced in the database)
- An exam receives an explicit `course_id`, `blueprint_id` and mode; questions come only from that course (and domain), and composite foreign keys make cross-course rows impossible.
- If a domain lacks published questions the exam is refused and the shortage audited — never filled from another domain or course.
- Score = correct ÷ total × 100; unanswered questions count as incorrect.
- Thresholds (80 / 60) are study indicators, configurable by admins, not passing standards.
- Practice items are original study material, not live exam questions.

## Paddle checkout integration

See [Paddle setup](docs/PADDLE_SETUP.md). One-time ASP/CSP/CIH purchases now have a signed-in checkout page and server-created Paddle transactions. Apply migration 20261028000100 before enabling the new handler. Payments remain disabled by default; Paddle account setup, secrets, price mapping and sandbox end-to-end acceptance tests are outstanding. The old public checkout URL templates are superseded.
