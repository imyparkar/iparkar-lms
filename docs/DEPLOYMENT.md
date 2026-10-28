# Deployment and operations runbook

## 1. Supabase project
1. Create a project (region close to your students, e.g. Frankfurt or Mumbai).
2. **Auth → Providers → Email**: enable email/password, require email confirmation.
   **Auth → URL configuration**: Site URL `https://app.iparkar.com`; redirect URLs `https://app.iparkar.com/auth/callback`, `https://app.iparkar.com/auth/confirm`.
3. **Auth → Email templates** (optional, recommended): point the confirmation link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and recovery to `...&type=recovery`.
4. **Database → Extensions**: enable `pg_cron` (for the expiry sweeper).
5. Apply migrations in order (`supabase/migrations/*.sql`):
   `supabase link --project-ref <ref>` then `supabase db push` — or paste each file into the SQL editor in filename order.
6. Make yourself admin (after signing up in the app):
   ```sql
   update public.profiles set role = 'admin' where username = 'your-username';
   ```

## 2. Import the ASP bank
1. Download `ASP11_item_bank.md` from the Claude project into `imports/` (git-ignored — never commit premium items to the public repo).
2. Dry run: `npm run import:bank -- --file imports/ASP11_item_bank.md --course ASP --dry-run`
3. Import as drafts: `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run import:bank -- --file imports/ASP11_item_bank.md --course ASP --status draft`
   (or use **Admin → Import** in the browser).
4. Review, then publish in **Admin → Questions** (bulk publish checks key + explanation).
5. **Admin → Overview** shows readiness per domain. When every ASP domain is "Ready", tick **Exams enabled**.
6. Before public release: verify the ASP weightings against the official BCSP blueprint, then mark the blueprint *Verified* in **Admin → Blueprints**.

## 3. Cloudflare (app.iparkar.com)
```bash
npm ci
cp .env.example .env.production   # fill NEXT_PUBLIC_* values
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put PADDLE_WEBHOOK_SECRET
npm run cf:deploy                  # opennextjs-cloudflare build && deploy
```
`wrangler.jsonc` binds the custom domain `app.iparkar.com` (the zone is already on Cloudflare).
Or connect the GitHub repo in **Workers & Pages → Workers Builds** with build command `npx opennextjs-cloudflare build` and deploy command `npx opennextjs-cloudflare deploy`, and set the same variables/secrets there.

Recommended Cloudflare extras: a WAF rate-limit rule on `POST /login` and `/signup` (defence in depth on top of the app limiter), and Bot Fight Mode.

## 4. Payments (Paddle)

Follow [PADDLE_SETUP.md](PADDLE_SETUP.md) for the server-created checkout, private transaction mappings, migration, sandbox variables, three course prices, notification destination and required acceptance tests. This replaces the older public checkout URL placeholders. Payment completion and access grants are atomic in the database; signed redirects/browser events never grant access. Keep online checkout disabled until sandbox setup is complete.

## 5. Marketing site
Merge the `iparkar-site` change (Practice tab → `https://app.iparkar.com/courses/ASP`, "Sign in to your dashboard" link). It deploys on push as before.

## 6. Backups and recovery
- Supabase Pro includes daily backups; enable **Point-in-Time Recovery** for a paid platform.
- Weekly logical backup of content: `supabase db dump --data-only -t questions -t question_options -t question_keys -t question_versions -t blueprints -t blueprint_domains > backup.sql` stored off-platform.
- Recovery drill (quarterly): restore the latest backup into a staging project and run `npm run test:db` plus a manual exam.
- Keep the item-bank Markdown (source of truth for content) in private storage.

## 7. Privacy and retention (fill in before launch)
- Data held: name, username, email, exam answers/scores, entitlement and payment metadata (no card data — Paddle holds it).
- Deletion requests to imran@iparkar.com: delete the auth user (cascades to profile, attempts, entitlements); payments keep `user_id = null` for accounting.
- Suggested retention: attempts kept while the account is active + 2 years; audit logs 2 years; rate-limit rows 1 day (automatic).
- Update `privacy.html`, `terms.html`, `refunds.html` on the marketing site to describe the LMS and Paddle as merchant of record; have them legally reviewed.

## 8. Routine operations
| Task | Where |
|---|---|
| Grant complimentary access / revoke | Admin → Students & access |
| Exam length, timer, feedback policy | Admin → Exam settings |
| Study indicator thresholds | Admin → Exam settings |
| New blueprint version | Admin → Blueprints → Create, then Make current |
| Stuck or abandoned exams | Admin → Attempts (auto-finalized at expiry; "Finalize now" for exceptions) |
| Who changed what | Admin → Audit log |
