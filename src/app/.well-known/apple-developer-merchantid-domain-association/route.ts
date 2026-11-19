import { APPLE_PAY_DOMAIN_ASSOCIATION } from "@/lib/payments/applePayDomain";

/**
 * Apple Pay domain verification for Razorpay Standard Checkout on app.iparkar.com.
 * Must answer 200 with text/plain and no redirect (middleware skips /.well-known/).
 * The content is Razorpay's verification file: Dashboard → Account & Settings → Apple Pay → Verification file.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(APPLE_PAY_DOMAIN_ASSOCIATION, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
