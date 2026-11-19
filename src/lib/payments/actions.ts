"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/admin";
import { formatMoney, periodLabel, priceFor } from "@/lib/payments/catalogue";
import { createOrder, razorpayConfig } from "@/lib/payments/razorpay";

export type CheckoutOrder = {
  error?: string;
  keyId?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  description?: string;
  prefill?: { name?: string; email?: string };
};

const schema = z.object({ code: z.string().regex(/^[A-Z]{2,6}(-SPS)?$/), days: z.number().int() });

/**
 * Creates (or reuses) a Razorpay order for a practice-exam package (e.g. "ASP")
 * or a Self Paced Study Course (e.g. "ASP-SPS").
 * The price comes from the server catalogue for the visitor's country
 * (Cloudflare's cf-ipcountry header), never from the browser.
 */
export async function startCheckout(code: string, days: number): Promise<CheckoutOrder> {
  const parsed = schema.safeParse({ code: String(code).toUpperCase(), days: Number(days) });
  if (!parsed.success) return { error: "That package isn’t available." };
  const session = await getSession();
  if (!session || session.profile.status !== "active") return { error: "Please sign in again to continue." };
  const cfg = razorpayConfig();
  if (!cfg) return { error: "Online payment isn’t available yet. Email support@iparkar.com to buy access." };

  const country = ((await headers()).get("cf-ipcountry") ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const price = priceFor(parsed.data.code, parsed.data.days, country);
  if (!price) return { error: "That access period isn’t sold online. Email support@iparkar.com and we’ll help." };

  const db = getServiceClient();
  const study = parsed.data.code.endsWith("-SPS");
  const { data: course } = await db.from(study ? "study_courses" : "courses").select("id, code").eq("code", parsed.data.code).maybeSingle();
  if (!course) return { error: "That course wasn’t found." };
  const target = study ? { study_course_id: course.id } : { course_id: course.id };

  const what = study ? `${course.code.replace("-SPS", "")} Self Paced Study Course` : `${course.code} practice exams`;
  const description = `${what} · ${periodLabel(parsed.data.days)} · ${formatMoney(price)}`;
  const base = {
    keyId: cfg.keyId, amount: price.minor, currency: price.currency, description,
    prefill: { name: session.profile.full_name ?? undefined, email: session.user.email ?? undefined },
  };

  // Reuse an unpaid order for the same thing from the last hour, so repeated clicks don't pile up orders.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: existing } = await db.from("checkout_orders").select("provider_order_id")
    .eq("user_id", session.user.id).eq(study ? "study_course_id" : "course_id", course.id).eq("access_days", parsed.data.days)
    .eq("amount_minor", price.minor).eq("currency", price.currency).eq("status", "created").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return { ...base, orderId: existing.provider_order_id };

  try {
    const order = await createOrder(cfg, {
      amount: price.minor,
      currency: price.currency,
      receipt: `ipk-${Date.now().toString(36)}`,
      notes: { user_id: session.user.id, course: course.code, days: String(parsed.data.days), country },
    });
    const { error } = await db.from("checkout_orders").insert({
      provider_order_id: order.id, user_id: session.user.id, ...target, access_days: parsed.data.days,
      amount_minor: price.minor, currency: price.currency, country: country || null,
    });
    if (error) throw new Error(error.message);
    return { ...base, orderId: order.id };
  } catch (e) {
    console.error("startCheckout", e);
    return { error: "We couldn’t start the payment. Please try again in a minute." };
  }
}
