# iParkar LMS — Architecture (Phase 1: discovery and design)

## 1. What exists today

| Property | Finding |
|---|---|
| `iparkar.com` / `www` | Static site, repo `imyparkar/iparkar-site`, deployed on Cloudflare Pages (no build step). Five tabs driven by `site-config.js`; free 10-question sample in `questions-free.js` (public by design). Nav "Sign in" already points to `https://app.iparkar.com/login`. |
| `quiz.iparkar.com` | Live HSE quiz (separate repo), behind Cloudflare Access. Untouched. |
| Design system | iParkar Design System artifact: paper canvas, Inter + Source Serif 4, midnight / marigold / action-blue / coral, 12px card radius, hairline borders, one filled blue action per screen. Mirrored here in `tailwind.config.ts` and `src/app/globals.css`. |
| Question content | `ASP11_item_bank.md` in the Claude project: 1,000 items in Markdown tables (`ID · Domain-Task · Level · Stem · A–D · Key · Rationale · Reference · Est. Diff.`), domains D1–D9, task codes such as `D2-T8a`. Marked "needs SME review before use". |

**Decision:** keep the marketing site static and add the LMS as a separate app at **`app.iparkar.com`**. The Practice tab links into it. Nothing in the existing site or quiz is removed.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 15.5 (App Router), React 19, TypeScript | Server Components for pages, server actions for writes |
| Styling | Tailwind 3 with iParkar tokens | Lucide icons used sparingly (calculator, flag, nav) |
| Auth | Supabase Auth (email + password) | Username sign-in resolved server-side |
| Data | Supabase Postgres | All business rules in SQL functions + RLS |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Verified: `opennextjs-cloudflare build` + `wrangler dev` run the app |
| Payments | Paddle Billing (merchant of record) via webhook | Provider-independent entitlements |

Why Workers and not Pages: Next.js server actions, middleware and route handlers need a server runtime. OpenNext's Cloudflare adapter runs them on Workers with `nodejs_compat`. No edge-only APIs are assumed; `next/font` is not used (fonts load from Google Fonts like the main site).

## 3. Module map

```
supabase/migrations/      ← the backend: schema, RLS, RPCs (authoritative)
  0001 schema             courses, domains, tasks, blueprints, questions, keys, versions,
                          attempts, answers, performance, entitlements, payments, audit
  0002 core functions     allocation, start/get/save/flag/submit, scoring, results, analytics
  0003 admin functions    import/upsert/publish, blueprints, entitlements, guards, service RPCs
  0004 RLS + grants       least privilege; students never read the bank directly
  0005 course config      ASP / CSP / CIH courses, domains, CIH tasks, blueprints, exam settings
  0006 cron               pg_cron sweeper for expired attempts (optional)
  0007 admin users        admin user search
src/lib/auth              sign-in/up/reset actions, session guards
src/lib/exam              start-exam action, clock maths, allocation mirror
src/lib/calculator        safe expression parser (no eval)
src/lib/import            Markdown/CSV item-bank parsers
src/lib/analytics         study indicators, recommendations
src/lib/payments          Paddle signature verification
src/app/(app)             dashboard, course, results, account, admin/*
src/app/exam/[id]         full-viewport exam workspace
src/app/api/webhooks      Paddle webhook
```

## 4. Data model (key tables)

```
courses ─┬─ course_domains ─── course_tasks
         ├─ blueprints ─┬─ blueprint_domains (weight, name per version)
         │              └─ blueprint_tasks
         ├─ exams (per course × mode: count, minutes, feedback policy)
         ├─ questions ─┬─ question_options
         │             ├─ question_keys        (admin-only)
         │             └─ question_versions    (immutable snapshots, admin-only)
         ├─ course_entitlements ── payments
         └─ exam_attempts ─┬─ attempt_questions (question_id + version + option order)
                           ├─ attempt_answers
                           ├─ domain_performance
                           └─ task_performance
audit_logs · app_settings · rate_limits · course_products (Paddle price → course)
```

### Course isolation (mandatory requirement)
Isolation is structural, not just a `WHERE` clause:
- Every child row carries `course_id`, and foreign keys are **composite** — `(question_id, course_id) → questions(id, course_id)`, `(domain_id, course_id) → course_domains(id, course_id)`, `(attempt_id, course_id) → exam_attempts(id, course_id)`. A CIH question physically cannot be inserted into an ASP attempt; a test proves the database rejects it.
- `start_attempt(course_id, blueprint_id, mode, domain_id)` takes all four explicitly, checks the blueprint is the course's **current** version, the domain belongs to that blueprint, and selects only `published` questions of that course and domain. Shortfalls block the exam (and are audited) — never back-filled from another domain or course.
- Analytics RPCs take one course and one blueprint version; the dashboard renders one course at a time.

### Blueprint versioning
- Domain identities (`course_domains`) are stable; weights and printed names live per version in `blueprint_domains`.
- Exactly one current version per course (partial unique index). Weights must total 100 to become current.
- Triggers lock a version's domains/tasks once any attempt references it. Changes → new version.
- Attempts store `blueprint_id`; results and history always show the version used.

### Question versioning
Every content change writes a `question_versions` snapshot (stem, options, key, explanation). Attempts store `(question_id, question_version)`; the exam, scoring and review all read the snapshot, so editing a question never changes a past result.

## 5. Exam engine

| Concern | Implementation |
|---|---|
| Allocation | Largest-remainder method in SQL (`allocate_question_counts`); ties → higher weight → lower domain number. ASP 10/25/8/12/10/12/7/11/5, CSP 25/25/15/9/6/10/10, CIH 50/35/15. |
| Selection | Server-side `random()`; round-robin across task tags within each domain for balanced coverage (internal balancing, not an official weighting); no duplicates; order fixed per attempt. |
| Options | Shown in stored order unless the exam enables shuffling **and** the item allows it (the ASP rationales cite letters, so shuffle is off by default). |
| Timing | Server stores `started_at` / `expires_at`. Browser countdown = server time + `performance.now()` elapsed (monotonic), re-synced every 60 s and on tab focus via `get_attempt_clock`. Changing the device clock has no effect (unit-tested). |
| Saving | Queue → `save_answer` / `set_flag` RPCs with retry/back-off; mirrored to `localStorage`; `client_seq` discards stale out-of-order writes; status shown ("All answers saved", "Offline · 3 waiting"). 2-second grace after expiry for in-flight saves. |
| Resume | One active attempt per student per course (partial unique index). Refresh/return resumes; time keeps running server-side. |
| Finalization | `finalize_attempt_internal` locks the row `FOR UPDATE`, grades from snapshots, writes counts, domain and task performance, audit. Idempotent: concurrent submits → exactly one finalization (tested). Expired attempts finalize lazily on any read and via pg_cron every minute. |
| Scoring | Score = correct ÷ total questions × 100. **Unanswered = incorrect.** |
| Feedback policies | `after_submit` (default), `immediate` (check + lock per question), `delayed` (review after N hours), `restricted` (score + domains only). |

## 6. Security model

- **RLS on every table.** Students can read only their own profile, attempts, answers, performance, entitlements and payments, plus catalogue metadata. `questions`, `question_options`, `question_keys`, `question_versions` are admin-only; students receive question text solely through `get_attempt`, which checks attempt ownership and never includes keys.
- **No direct writes.** Table privileges for `anon`/`authenticated` are read-only; every mutation is a `SECURITY DEFINER` RPC with `search_path` pinned, ownership/role checks, and audit logging. EXECUTE is revoked from `public`/`anon` and granted explicitly.
- **Service-role key** is used server-side only, for: username→email lookup at sign-in, rate limiting, and the verified payment webhook. A build scan confirms it is not in client bundles.
- **Auth:** generic sign-in errors (no username enumeration), rate limits (IP and identifier), 10-character minimum passwords, reset links via Supabase (PKCE / token-hash), session refresh in middleware, suspended accounts blocked.
- **Payments:** access only from HMAC-verified webhook events with 5-minute replay window; idempotent by provider event id; refunds/cancellations revoke.
- **Headers:** HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies.
- **Content:** premium items are never shipped in public JavaScript; `imports/` is git-ignored.
