/**
 * Razorpay helpers (Web Crypto + fetch — runs on Node and Cloudflare Workers).
 *
 * - Checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, key_secret), hex.
 * - Webhook signature:  HMAC-SHA256(raw request body, webhook secret), hex,
 *   in the X-Razorpay-Signature header.
 */
const enc = new TextEncoder();
const API = "https://api.razorpay.com/v1";

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacVerify(message: string, signatureHex: string | null | undefined, secret: string): Promise<boolean> {
  if (!signatureHex || !secret) return false;
  const bytes = hexToBytes(signatureHex.trim());
  if (!bytes) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // crypto.subtle.verify compares in constant time
  return crypto.subtle.verify("HMAC", key, bytes as BufferSource, enc.encode(message));
}

export async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | null | undefined, keySecret: string) {
  return hmacVerify(`${orderId}|${paymentId}`, signature, keySecret);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, webhookSecret: string) {
  return hmacVerify(rawBody, signature, webhookSecret);
}

export type RazorpayConfig = { keyId: string; keySecret: string };

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return keyId && keySecret ? { keyId, keySecret } : null;
}

async function call<T>(cfg: RazorpayConfig, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(`Razorpay ${path} ${res.status}: ${json.error?.description ?? "request failed"}`);
  return json;
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string; receipt?: string };
export type RazorpayPayment = { id: string; order_id: string | null; amount: number; currency: string; status: string; email?: string };

export function createOrder(cfg: RazorpayConfig, body: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) {
  return call<RazorpayOrder>(cfg, "/orders", { method: "POST", body });
}

export function fetchPayment(cfg: RazorpayConfig, paymentId: string) {
  return call<RazorpayPayment>(cfg, `/payments/${encodeURIComponent(paymentId)}`);
}
