import "server-only";
import { getServiceClient } from "@/lib/supabase/admin";
import { fetchPayment, type RazorpayConfig } from "@/lib/payments/razorpay";
import { sendInvoiceEmail } from "@/lib/invoices/send";

export type FulfilResult = { ok: boolean; granted?: boolean; duplicate?: boolean; pending?: boolean; reason?: string; invoice_id?: string | null };

/**
 * Grants access for a Razorpay payment after re-reading it from Razorpay's API
 * (never trusting amounts sent by the browser or carried in notes).
 * Safe to call more than once: the database grants only on the first call.
 */
export async function fulfilPayment(cfg: RazorpayConfig, paymentId: string, event: string): Promise<FulfilResult> {
  const payment = await fetchPayment(cfg, paymentId);
  if (!payment.order_id) return { ok: false, reason: "payment has no order" };
  if (payment.status === "authorized") return { ok: true, pending: true }; // auto-capture finishes it; webhook grants then
  if (payment.status !== "captured") return { ok: false, reason: `payment ${payment.status}` };
  return applyCaptured(payment.order_id, payment.id, payment.amount, payment.currency, event, payment);
}

export async function applyCaptured(orderId: string, paymentId: string, amount: number, currency: string, event: string, payload: unknown): Promise<FulfilResult> {
  const db = getServiceClient();
  const { data, error } = await db.rpc("service_fulfil_checkout_order", {
    p_order: orderId, p_payment: paymentId, p_amount: amount, p_currency: currency, p_event: event, p_payload: payload ?? {},
  });
  if (error) throw new Error(`fulfil failed: ${error.message}`);
  const result = data as FulfilResult;
  // Email the invoice (once; a later duplicate call retries if an earlier send failed).
  if (result.ok) await sendInvoiceEmail(result.invoice_id);
  return result;
}

export async function applyRefund(paymentId: string, refundId: string, amount: number, payload: unknown) {
  const db = getServiceClient();
  const { data, error } = await db.rpc("service_refund_checkout_payment", {
    p_payment: paymentId, p_refund: refundId, p_amount: amount, p_payload: payload ?? {},
  });
  if (error) throw new Error(`refund failed: ${error.message}`);
  const result = data as { ok: boolean; revoked?: boolean; duplicate?: boolean; reason?: string; credit_note_id?: string | null };
  if (result.ok) await sendInvoiceEmail(result.credit_note_id);
  return result;
}
