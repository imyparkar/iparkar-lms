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

## 2. Import an item bank
1. Put the bank file in `imports/` (the whole folder is git-ignored — never commit premium items to the public repo).
2. Dry run, which parses the file and needs no credentials:
   `npm run import:bank -- --file imports/ASP11_item_bank.md --course ASP --dry-run`
3. Import:
   `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run import:bank -- --file imports/ASP11_item_bank.md --course ASP --status draft`
   (or use **Admin → Import** in the browser).
   The Supabase URL and anon key come from `.env.local`, the same file `next dev` reads, so the
   script and the app always target the same project; only the admin credentials are passed in.
   The script prints which project it is importing into before it signs in — check that line.
   **Re-importing an existing bank:** rows are matched on `external_ref` and updated in place, but
   `--status` is applied to every row, so use `--status published` for a bank that is already live.
   `--status draft` would withdraw it from circulation.
4. Review, then publish in **Admin → Questions** (bulk publish checks key + explanation).
5. **Admin → Overview** shows readiness per domain. When every ASP domain is "Ready", tick **Exams enabled**.
6. Before public release: verify the ASP weightings against the official BCSP blueprint, then mark the blueprint *Verified* in **Admin → Blueprints**.

## 3. Cloudflare (app.iparkar.com)
```bash
npm ci
cp .env.example .env.production   # fill NEXT_PUBLIC_* values
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RAZORPAY_KEY_ID; npx wrangler secret put RAZORPAY_KEY_SECRET; npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npm run cf:deploy                  # opennextjs-cloudflare build && deploy
```
`wrangler.jsonc` binds the custom domain `app.iparkar.com` (the zone is already on Cloudflare).
Or connect the GitHub repo in **Workers & Pages → Workers Builds** with build command `npx opennextjs-cloudflare build` and deploy command `npx opennextjs-cloudflare deploy`, and set the same variables/secrets there.

Recommended Cloudflare extras: a WAF rate-limit rule on `POST /login` and `/signup` (defence in depth on top of the app limiter), and Bot Fight Mode.

## 4. Payments (Razorpay)
iParkar Learning is the seller; Razorpay is the payment gateway. Prices are set by the server in
`src/lib/payments/catalogue.ts` (US$ prices, periods on sale, and country prices mirrored from
`regional-prices.js` on iparkar.com — **change both together**). The visitor's country comes from
Cloudflare's `cf-ipcountry` header. Sold: practice-exam packages (`/courses/<CODE>`) and the ASP and CSP Self Paced
Study Courses, 365 days (`/learn/<asp|csp>-sps/buy`, linked from iparkar.com/resources). Without keys both fall back to the request-access email.

1. **Account**: complete Razorpay KYC and activation. To charge non-INR prices (US$, KWD, AED, SAR, QAR, BHD,
   OMR, GBP, EUR) ask Razorpay to **enable international payments**; until then only INR (India) can be paid.
2. **Payment capture**: Dashboard → Account & Settings → Capture and refund settings → **auto-capture** on.
   **Default refund speed: Normal** (instant refunds carry a fee).
3. **API keys** (Test mode first, then Live): Dashboard → Account & Settings → API keys.
   ```bash
   npx wrangler secret put RAZORPAY_KEY_ID        # rzp_test_… / rzp_live_…
   npx wrangler secret put RAZORPAY_KEY_SECRET
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
   ```
   With no keys set, the course page falls back to the "Ask about access" email button.
4. **Webhook**: Dashboard → Account & Settings → Webhooks → Add: URL `https://app.iparkar.com/api/webhooks/razorpay`,
   your own secret (same as `RAZORPAY_WEBHOOK_SECRET`), events **order.paid**, **payment.captured**, **refund.processed**.
   Test and Live mode each need their own webhook.
5. **Database**: apply `supabase/migrations/20261119000100_razorpay_checkout.sql` (table `checkout_orders`,
   functions `service_fulfil_checkout_order`, `service_refund_checkout_payment`; study courses go through the existing
   `service_apply_study_purchase` / `service_revoke_study_purchase`).
6. **Test (Test mode keys)**: open `/courses/ASP`, pay with a Razorpay test card/UPI → access opens and a
   `checkout_orders` row turns `paid`; close the tab mid-payment → the webhook still grants access; refund the
   full amount in the Dashboard → access is revoked. Repeat with `/learn/asp-sps/buy`: 365 days of study access; a full
   refund takes those days back (progress is kept). Partial refunds keep access and log `refund.partial`.

How it works: `startCheckout` (server action) creates a Razorpay order for the server price and stores it in
`checkout_orders`. After payment, the browser posts the signed IDs to `/api/payments/razorpay/verify`; the server
checks the signature, re-reads the payment from Razorpay and grants access. The webhook does the same independently.
The database grants once per order and only if amount and currency match the order. Failed/uncaptured payments
are refunded automatically by Razorpay; nothing is granted for them.

### Invoices and credit notes (own, not Razorpay Invoices)
Every paid order gets an invoice and every processed refund a credit note, created in the same database
transaction (`invoices`, migration `20261120000100_invoices.sql`). Numbers run per Indian financial year:
`INV/2026-27/0001`, `CN/2026-27/0001`. The PDF (`src/lib/invoices/pdf.ts`, iParkar letterhead, seller details in
`SELLER`) is emailed through **Cloudflare Email Service** (binding `EMAIL` in `wrangler.jsonc`, no API key) and listed
under Account → Invoices (download via `/api/invoices/<id>`).
**GST** (registered 24 Nov 2026, GSTIN 27ATAPP7789A1ZF, Maharashtra 27; migration `20261126000100_gst.sql`):
prices are GST-inclusive. Each invoice is issued as a **Tax invoice** with SAC 999293 at 18%, and a treatment fixed at issue:
Indian buyer in Maharashtra → CGST 9% + SGST 9%; other state/UT → IGST 18%; buyer outside India → export of services,
zero-rated: under LUT (no IGST, endorsement with LUT ARN) when `gst_config.lut_arn` is set and in date, otherwise on
payment of IGST 18%. Indian (INR) checkouts ask for the state (place of supply, Rule 46 proviso) and optionally a GSTIN +
business name (checksum-validated). Credit notes copy the treatment of their invoice. Settings live in `public.gst_config`
(single row). LUT for FY 2026-27: ARN AD271126028060L, filed 26 Nov 2026, recorded until 31 Mar 2027. **Each new LUT** (renew before 1 April), record it:
`update gst_config set lut_arn = '<ARN>', lut_valid_from = '2026-04-01', lut_valid_to = '2027-03-31', updated_at = now();`
(renew every financial year).

Setup: the account must be on **Workers Paid** (sending to customers is not available on Workers Free), and
iparkar.com must be onboarded under Compute → Email Service → Email Sending (adds MX/SPF/DKIM on `cf-bounce.iparkar.com`
only; root iCloud MX/SPF and the existing EasyDMARC `p=none` record are untouched). Sender: `support@iparkar.com`
(override with `INVOICE_FROM_EMAIL`; must be in `allowed_sender_addresses`). Optional `INVOICE_BCC_EMAIL` sends a copy.
Without the binding or onboarding, invoices are still created and downloadable; failed sends are stored in
`invoices.email_error` and retried on the next webhook delivery. Sending logs: Email Service dashboard.

## 5. Marketing site
Merge the `iparkar-site` change (Practice tab → `https://app.iparkar.com/courses/ASP`, "Sign in to your dashboard" link). It deploys on push as before.

## 6. Backups and recovery
- Supabase Pro includes daily backups; enable **Point-in-Time Recovery** for a paid platform.
- Weekly logical backup of content: `supabase db dump --data-only -t questions -t question_options -t question_keys -t question_versions -t blueprints -t blueprint_domains > backup.sql` stored off-platform.
- Recovery drill (quarterly): restore the latest backup into a staging project and run `npm run test:db` plus a manual exam.
- Keep the item-bank Markdown (source of truth for content) in private storage.

## 7. Privacy and retention (fill in before launch)
- Data held: name, username, email, exam answers/scores, entitlement and payment metadata (no card data — Razorpay holds it).
- Deletion requests to support@iparkar.com: delete the auth user (cascades to profile, attempts, entitlements); payments keep `user_id = null` for accounting.
- Suggested retention: attempts kept while the account is active + 2 years; audit logs 2 years; rate-limit rows 1 day (automatic).
- Update `privacy.html`, `terms.html`, `refunds.html` on the marketing site to describe the LMS and Razorpay as payment processor (done Nov 2026); have them legally reviewed.

## 8. Routine operations
| Task | Where |
|---|---|
| Grant complimentary access / revoke | Admin → Students & access |
| Exam length, timer, feedback policy | Admin → Exam settings |
| Study indicator thresholds | Admin → Exam settings |
| New blueprint version | Admin → Blueprints → Create, then Make current |
| Stuck or abandoned exams | Admin → Attempts (auto-finalized at expiry; "Finalize now" for exceptions) |
| Who changed what | Admin → Audit log |

## Study guides (free, sign-in only)

PDFs live in the private R2 bucket `iparkar-study-guides` (binding `STUDY_GUIDES` in `wrangler.jsonc`; no public access or r2.dev URL). To publish or revise a guide, upload the PDF in Cloudflare → R2 → `iparkar-study-guides`. Any filename works as long as it contains the guide code as a word (e.g. `iParkar_CSP_Exam_Study_Guide.pdf`); the newest matching upload is served as `iParkar-<CODE>-Exam-Study-Guide.pdf`. Downloads go through `/api/study-guides/<code>`, which requires sign-in and logs each download in `study_guide_downloads`. Add new guides to `src/lib/studyGuides.ts`.
