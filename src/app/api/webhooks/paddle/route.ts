import { NextResponse, type NextRequest } from "next/server";
import { verifyPaddleSignature } from "@/lib/payments/paddle";
import { getServiceClient } from "@/lib/supabase/admin";

/**
 * Paddle → entitlements. Access is granted ONLY from verified webhook events,
 * never from a browser redirect. Entitlement logic lives in the database
 * (service_apply_purchase), independent of the provider.
 *
 * Checkout must pass custom_data: { user_id: "<supabase user id>" }.
 * Map Paddle price IDs to courses in the course_products table.
 */
type PaddleEvent = {
  event_id: string;
  event_type: string;
  data: {
    id: string;
    status?: string;
    action?: string;
    transaction_id?: string;
    subscription_id?: string | null;
    custom_data?: { user_id?: string } | null;
    currency_code?: string;
    details?: { totals?: { grand_total?: string } };
    items?: { price?: { id: string } }[];
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET ?? "";
  const raw = await request.text();
  if (!(await verifyPaddleSignature(raw, request.headers.get("paddle-signature"), secret))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: PaddleEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const db = getServiceClient();
  const userId = evt.data.custom_data?.user_id && UUID.test(evt.data.custom_data.user_id) ? evt.data.custom_data.user_id : null;

  // idempotency: one row per provider event id
  const { data: payment, error: insErr } = await db.from("payments").insert({
    user_id: userId,
    provider: "paddle",
    provider_event_id: evt.event_id,
    provider_txn_id: evt.data.transaction_id ?? evt.data.id,
    event_type: evt.event_type,
    status: evt.data.status ?? "unknown",
    amount_minor: evt.data.details?.totals?.grand_total ? Number(evt.data.details.totals.grand_total) : null,
    currency: evt.data.currency_code ?? null,
    payload: evt,
  }).select("id").single();
  if (insErr) {
    if (insErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: "store failed" }, { status: 500 }); // Paddle retries
  }

  const priceIds = (evt.data.items ?? []).map((i) => i.price?.id).filter(Boolean) as string[];
  const { data: products } = priceIds.length
    ? await db.from("course_products").select("course_id, access_days, kind").eq("provider", "paddle").in("provider_price_id", priceIds).eq("is_active", true)
    : { data: [] as { course_id: string; access_days: number | null; kind: string }[] };

  if (evt.event_type === "transaction.completed") {
    if (!userId || !products?.length) {
      await db.from("audit_logs").insert({ action: "payment.unmatched", entity: "payment", entity_id: payment.id, details: { event_id: evt.event_id, priceIds, userId } });
      return NextResponse.json({ ok: true, matched: false });
    }
    for (const p of products) {
      await db.from("payments").update({ course_id: p.course_id }).eq("id", payment.id);
      const { error } = await db.rpc("service_apply_purchase", {
        p_user: userId, p_course: p.course_id, p_access_days: p.access_days, p_payment: payment.id,
        p_source: p.kind === "subscription" ? "subscription" : "purchase", p_subscription: evt.data.subscription_id ?? null,
      });
      if (error) return NextResponse.json({ error: "grant failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const isRefund = evt.event_type.startsWith("adjustment.") && evt.data.action === "refund" && evt.data.status === "approved";
  if (isRefund || evt.event_type === "subscription.canceled") {
    // find the original purchase to know which user/course to revoke
    const ref = isRefund ? evt.data.transaction_id : evt.data.id;
    const col = isRefund ? "provider_txn_id" : "payload->data->>subscription_id";
    const { data: original } = await db.from("payments").select("user_id, course_id").eq("provider", "paddle")
      .eq("event_type", "transaction.completed").filter(col, "eq", ref).not("course_id", "is", null).limit(5);
    for (const o of original ?? []) {
      if (o.user_id && o.course_id) {
        await db.rpc("service_revoke_for_payment", { p_user: o.user_id, p_course: o.course_id, p_reason: isRefund ? "Refunded" : "Subscription canceled" });
      }
    }
    return NextResponse.json({ ok: true, revoked: original?.length ?? 0 });
  }

  return NextResponse.json({ ok: true, ignored: evt.event_type });
}
