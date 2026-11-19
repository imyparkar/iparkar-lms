import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { applyCaptured, applyRefund } from "@/lib/payments/checkout";

/**
 * Razorpay → entitlements. Subscribe this URL to: order.paid, payment.captured,
 * refund.processed. Access is granted only for a captured payment matching an
 * order we created (amount and currency checked in the database), once.
 * Any non-2xx response makes Razorpay retry, so failures return 500.
 */
type Entity<T> = { entity: T };
type Evt = {
  event: string;
  payload: {
    payment?: Entity<{ id: string; order_id: string | null; amount: number; currency: string; status: string }>;
    refund?: Entity<{ id: string; payment_id: string; amount: number; currency: string; status: string }>;
  };
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!(await verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"), secret))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: Evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    if (evt.event === "order.paid" || evt.event === "payment.captured") {
      const p = evt.payload.payment?.entity;
      if (!p?.order_id || p.status !== "captured") return NextResponse.json({ ok: true, ignored: "not captured" });
      const r = await applyCaptured(p.order_id, p.id, p.amount, p.currency, evt.event, evt);
      return NextResponse.json({ ok: true, result: r });
    }
    if (evt.event === "refund.processed") {
      const r = evt.payload.refund?.entity;
      if (!r) return NextResponse.json({ ok: true, ignored: "no refund" });
      const result = await applyRefund(r.payment_id, r.id, r.amount, evt);
      return NextResponse.json({ ok: true, result });
    }
    return NextResponse.json({ ok: true, ignored: evt.event });
  } catch (e) {
    console.error("razorpay webhook", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
