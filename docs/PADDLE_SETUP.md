# Paddle setup — iParkar Learning exam packages

This change prepares one-time paid access for ASP, CSP and CIH. It does not activate payments. Start with Paddle sandbox; production requires a separately approved Paddle account and live configuration.

## Student journey

Practice exam card on iparkar.com → sign in at app.iparkar.com → course page → secure checkout → Paddle confirms payment by signed webhook → that student's course access activates.

Only the server chooses the user, course, Paddle price and access duration. Checkout accepts a course code, not a price, account ID or duration. A transaction is saved against the student's account before the browser can open payment. A completed browser checkout does not grant access.

## 1. Create your sandbox account and products

Create three sandbox products: ASP Exam Package, CSP Exam Package and CIH Exam Package. Add a **one-time** price to each (no subscription or trial). The marketing site currently advertises USD 99 / 90 days; use those terms unless you change the offer consistently across the site and Paddle. Access duration is controlled by your database product mapping, not the price description.

Do not enable CSP sales until its published question bank and exam settings are ready. The checkout endpoint enforces the existing `exams_enabled` setting for every course.

## 2. Configure the LMS in Cloudflare

On the **LMS Worker for app.iparkar.com**, not the marketing-site Worker, configure:

| Variable | Sandbox value |
|---|---|
| `PADDLE_ENVIRONMENT` | `sandbox` |
| `PADDLE_CHECKOUT_ENABLED` | `false` during initial setup; `true` for sandbox testing |
| `PADDLE_CLIENT_TOKEN` | Sandbox client-side token beginning `test_` |
| `PADDLE_PRICE_ID_ASP` | ASP sandbox price ID, `pri_…` |
| `PADDLE_PRICE_ID_CSP` | CSP sandbox price ID, `pri_…` |
| `PADDLE_PRICE_ID_CIH` | CIH sandbox price ID, `pri_…` |
| `NEXT_PUBLIC_SITE_URL` | The exact HTTPS origin where the LMS runs |

Use Cloudflare **Secrets** for `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` and the existing `SUPABASE_SERVICE_ROLE_KEY`. Never put these in GitHub, frontend variables, or chat. This integration uses the API key only from server code; the client token is intentionally public.

The API key requires transaction-create permission. Configure your sandbox-approved default payment URL / checkout domain for `/checkout/ASP` on the LMS host; verify Paddle permits the other course checkout URLs on that domain. `Paddle.Checkout.open` receives the transaction ID created by the server.

## 3. Apply the database migration and price mappings

Apply `supabase/migrations/20261028000100_paddle_checkout.sql` after all existing migrations, using the normal Supabase migration workflow. It adds the private checkout mapping and atomic fulfilment function. Do this before enabling checkout or pointing notifications at the new handler.

Create active price mappings (replace the placeholder IDs; repeat for each environment in its own database):

```sql
insert into public.course_products(course_id,provider,provider_price_id,access_days,kind,is_active)
select id,'paddle','REPLACE_WITH_ASP_SANDBOX_PRICE_ID',90,'one_time',true
from public.courses where code='ASP';
-- Repeat with the CSP and CIH course codes and their corresponding price IDs.
```

The environment price IDs and the database mappings must match exactly. Use a separate staging Supabase project for sandbox purchases; do not grant test access in the production student database.

## 4. Add Paddle notifications

Create a sandbox notification destination:

`https://YOUR_LMS_HOST/api/webhooks/paddle`

Subscribe to `transaction.completed`, `adjustment.created` and `adjustment.updated`. Copy that destination's signing secret into the LMS `PADDLE_WEBHOOK_SECRET`. Transactions, webhook secrets and price IDs must all belong to the same Paddle environment.

The endpoint verifies the raw-body signature before processing and fulfils the event in one database transaction. A failed grant rolls back the event receipt so delivery retries can recover. Duplicate events and different completion events for the same transaction do not add extra access. Full approved refunds and chargebacks revoke only the matching purchase. Partial refunds, warnings and reversals are recorded for manual review in Audit log; review and adjust access with Admin → Students & access when appropriate. This implementation does not sell subscriptions or automatically restore reversed chargebacks.

An event without a server-created checkout mapping returns an error for reconciliation/retry. A generic webhook simulator event is therefore not sufficient: run an actual sandbox checkout or construct a simulator payload matching a staging checkout transaction.

## 5. Required sandbox acceptance checks

- Sign in as a test student with no access; buy ASP using Paddle's sandbox test payment method.
- Confirm only ASP unlocks, for 90 days; CIH/CSP stay locked.
- Repeat for CIH and, once enabled, CSP.
- Cancel a checkout and confirm no access is granted.
- Replay the same webhook, then a separate event for the same transaction: access must not extend twice.
- Test a temporary processing failure, then retry: access must be granted once.
- Test a full refund: only that purchase is revoked. Partial refunds require manual review.
- Confirm expired and revoked students cannot start exams or read premium questions.
- Confirm the final price, currency, taxes and one-time purchase terms at checkout.

Automated checks cover signature verification and core database fulfilment; the signed-in browser/payment-provider flow still requires this sandbox testing. No live credentials, account, checkout domain or real payment has been configured or tested in this change.

## 6. Go live only after the sandbox passes

Complete Paddle's account/domain approval and configure the relevant product descriptions, terms, privacy and refund pages. Create live products and prices separately. Replace all Paddle credentials and mappings together, set `PADDLE_ENVIRONMENT=production`, use a `live_` client token, and configure the live webhook destination/secret. Turn checkout on only after verifying the correct live offer. Keep sandbox and production databases separate.

Until required configuration exists, the course page displays an access enquiry link. Existing manual access grants remain available through Admin → Students & access.

Official implementation references:
- https://developer.paddle.com/api-reference/transactions/create-transaction/
- https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/
- https://developer.paddle.com/webhooks/about/signature-verification/
- https://developer.paddle.com/webhooks/transactions/transaction-completed/
- https://developer.paddle.com/webhooks/adjustments/adjustment-updated/
