/**
 * Paddle Billing webhook verification (Web Crypto — runs on Node and Workers).
 * Header format: "Paddle-Signature: ts=<unix>;h1=<hex hmac>"
 * Signed payload: `${ts}:${rawBody}`, HMAC-SHA256 with the notification secret.
 * Confirm the scheme against Paddle's current documentation before launch.
 */
const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function parseSignatureHeader(header: string | null): { ts: number; h1: string[] } | null {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim().split("="));
  const ts = Number(parts.find(([k]) => k === "ts")?.[1]);
  const h1 = parts.filter(([k]) => k === "h1").map(([, v]) => v);
  if (!Number.isFinite(ts) || !h1.length) return null;
  return { ts, h1 };
}

export async function verifyPaddleSignature(rawBody: string, header: string | null, secret: string,
                                            nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
  const sig = parseSignatureHeader(header);
  if (!sig || !secret) return false;
  if (Math.abs(nowSeconds - sig.ts) > toleranceSeconds) return false; // replay protection
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const h of sig.h1) {
    const bytes = hexToBytes(h);
    // crypto.subtle.verify compares in constant time
    if (bytes && (await crypto.subtle.verify("HMAC", key, bytes as BufferSource, enc.encode(`${sig.ts}:${rawBody}`)))) return true;
  }
  return false;
}

/** Test helper / documentation: how Paddle builds the header. */
export async function signPaddle(rawBody: string, secret: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}:${rawBody}`)));
  return `ts=${ts};h1=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
