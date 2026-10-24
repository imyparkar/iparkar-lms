import { describe, expect, it } from "vitest";
import { parseSignatureHeader, signPaddle, verifyPaddleSignature } from "@/lib/payments/paddle";

describe("Paddle webhook signature", () => {
  const body = JSON.stringify({ event_id: "evt_1", event_type: "transaction.completed" });
  const secret = "pdl_ntfset_test_secret";
  const ts = 1_800_000_000;

  it("accepts a correctly signed, fresh payload", async () => {
    expect(await verifyPaddleSignature(body, await signPaddle(body, secret, ts), secret, ts + 10)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, stale timestamps and junk headers", async () => {
    const h = await signPaddle(body, secret, ts);
    expect(await verifyPaddleSignature(body + " ", h, secret, ts)).toBe(false);
    expect(await verifyPaddleSignature(body, h, "other", ts)).toBe(false);
    expect(await verifyPaddleSignature(body, h, secret, ts + 3600)).toBe(false);
    expect(await verifyPaddleSignature(body, "nonsense", secret, ts)).toBe(false);
    expect(await verifyPaddleSignature(body, null, secret, ts)).toBe(false);
    expect(await verifyPaddleSignature(body, h, "", ts)).toBe(false);
  });
  it("parses multiple h1 values (secret rotation)", () => {
    expect(parseSignatureHeader("ts=1;h1=aa;h1=bb")).toEqual({ ts: 1, h1: ["aa", "bb"] });
  });
});
