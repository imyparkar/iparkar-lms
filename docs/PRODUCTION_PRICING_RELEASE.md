# Production pricing release - awaiting Paddle approval

Observed 30 October 2026: both iparkar.com and app.iparkar.com are In review in the live Paddle account. Account verification is shown as Not started. The production database has no Paddle price mappings or atomic checkout migration. No live API key is available in this session.

This release ports the tested server-created checkout and atomic webhook fulfilment onto current main without copying staging configuration, sandbox IDs, test accounts or staging credentials. Checkout stays disabled unless explicitly configured. Prices are USD 99 / 90 days, USD 149 / 180 days and USD 199 / 365 days, one-time for each exam.

Before enabling:
1. Complete live account verification and confirm both domains approved. This requires the account holder's business/identity details.
2. Create/reuse three live products and nine one-time live prices matching the published terms. Use the existing agreed SaaS tax category and location tax mode; verify availability in live.
3. Apply the existing checkout migration `supabase/migrations/20261028000100_paddle_checkout.sql` to production through the normal migration process after backup and review. Existing exam history and manual entitlements are preserved.
4. Insert nine live price-to-course mappings into production course_products, with kind one_time and exact access_days 90/180/365. Do not use sandbox IDs.
5. Configure the production Worker with PADDLE_ENVIRONMENT=production, live client token and API key, nine matching price variables, production Supabase URL/keys, and NEXT_PUBLIC_SITE_URL=https://app.iparkar.com. Keep checkout disabled until verification.
6. Configure a live notification destination at https://app.iparkar.com/api/webhooks/paddle for transaction.completed, adjustment.created and adjustment.updated. Save its signing secret securely to production. Set the live default payment link to https://app.iparkar.com/checkout/ASP after domain approval.
7. Deploy the app changes, verify checkout with live prices without submitting a real payment, then enable checkout. Any real-money acceptance purchase must be performed by the account holder or separately authorized.
8. Publish the paired marketing-site change only after all nine production options are verified. Its links preserve the selected duration through sign-in. Until then, keep the current Request access links.

Runtime price keys: PADDLE_PRICE_ID_ASP/CSP/CIH for 90 days; append _180 or _365 for longer access. The API resolves all prices server-side and checks returned amount, currency, quantity, billing model and database access duration. Browser events never grant access.

Sandbox evidence: 31 focused automated checks; six signed hosted simulations; browser ASP 180-day test payment completed, exact 180-day entitlement; declined card and canceled 365-day checkout grant nothing. Product descriptions include all durations.
