import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/admin";
import { razorpayConfig, verifyCheckoutSignature } from "@/lib/payments/razorpay";
import { fulfilPayment } from "@/lib/payments/checkout";

const body = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
});

/**
 * Called by the browser right after Razorpay Checkout succeeds, so access
 * opens immediately. The signature proves the IDs came from Razorpay; the
 * payment is then re-read from Razorpay's API before anything is granted.
 * The order.paid webhook does the same independently (if the tab closes).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const cfg = razorpayConfig();
  if (!cfg) return NextResponse.json({ error: "payments not configured" }, { status: 503 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = parsed.data;
  if (!(await verifyCheckoutSignature(orderId, paymentId, sig, cfg.keySecret))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const { data: order } = await getServiceClient().from("checkout_orders").select("user_id")
    .eq("provider", "razorpay").eq("provider_order_id", orderId).maybeSingle();
  if (!order || order.user_id !== session.user.id) return NextResponse.json({ error: "order not found" }, { status: 404 });

  try {
    const result = await fulfilPayment(cfg, paymentId, "checkout.callback");
    if (!result.ok) return NextResponse.json({ error: result.reason ?? "not granted" }, { status: 409 });
    return NextResponse.json({ ok: true, pending: !!result.pending });
  } catch (e) {
    console.error("razorpay verify", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
