import { describe, expect, it } from "vitest";
import { hmacHex, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { formatMoney, isOnSale, priceFor } from "@/lib/payments/catalogue";

describe("Razorpay signatures", () => {
  const secret = "test_secret";
  it("accepts a correct checkout signature and rejects tampering", async () => {
    const sig = await hmacHex("order_ABC|pay_XYZ", secret);
    expect(await verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, secret)).toBe(true);
    expect(await verifyCheckoutSignature("order_ABC", "pay_OTHER", sig, secret)).toBe(false);
    expect(await verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, "wrong")).toBe(false);
    expect(await verifyCheckoutSignature("order_ABC", "pay_XYZ", "zz", secret)).toBe(false);
    expect(await verifyCheckoutSignature("order_ABC", "pay_XYZ", null, secret)).toBe(false);
  });
  it("verifies webhooks over the exact raw body", async () => {
    const body = '{"event":"order.paid","payload":{}}';
    const sig = await hmacHex(body, secret);
    expect(await verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(await verifyWebhookSignature(body + " ", sig, secret)).toBe(false);
    expect(await verifyWebhookSignature(body, sig, "")).toBe(false);
  });
});

describe("price catalogue (mirrors iparkar.com)", () => {
  it("charges US$ outside listed countries", () => {
    expect(priceFor("ASP", 90, "US")).toEqual({ amount: 99, currency: "USD", minor: 9900 });
    expect(priceFor("CIT", 365, "")).toEqual({ amount: 99, currency: "USD", minor: 9900 });
  });
  it("uses country prices and correct minor units", () => {
    expect(priceFor("ASP", 90, "IN")).toEqual({ amount: 7999, currency: "INR", minor: 799900 });
    expect(priceFor("CIH", 90, "kw")).toEqual({ amount: 30, currency: "KWD", minor: 30000 });
    expect(priceFor("CIT", 180, "BH")).toEqual({ amount: 30, currency: "BHD", minor: 30000 });
    expect(priceFor("QEP", 90, "DE")).toEqual({ amount: 85, currency: "EUR", minor: 8500 });
  });
  it("sells only the periods the site sells", () => {
    expect(isOnSale("ASP", 90)).toBe(true);
    expect(priceFor("ASP", 180, "US")).toEqual({ amount: 149, currency: "USD", minor: 14900 });
    expect(priceFor("CSP", 365, "IN")).toEqual({ amount: 16999, currency: "INR", minor: 1699900 });
    expect(priceFor("ASP", 30, "US")).toBeNull();
    expect(priceFor("CIT", 180, "US")).toEqual({ amount: 79, currency: "USD", minor: 7900 });
    expect(priceFor("ASP-SPS", 365, "US")).toEqual({ amount: 120, currency: "USD", minor: 12000 });
    expect(priceFor("CSP-SPS", 365, "IN")).toEqual({ amount: 9999, currency: "INR", minor: 999900 });
    expect(priceFor("CSP-SPS", 365, "FR")).toEqual({ amount: 105, currency: "EUR", minor: 10500 });
    expect(priceFor("ASP-SPS", 90, "US")).toBeNull();
    expect(priceFor("XYZ", 90, "US")).toBeNull();
  });
  it("formats like the website", () => {
    expect(formatMoney({ amount: 7999, currency: "INR" })).toBe("₹7,999");
    expect(formatMoney({ amount: 30, currency: "KWD" })).toBe("KWD 30");
    expect(formatMoney({ amount: 99, currency: "USD" })).toBe("US$99");
  });
});
