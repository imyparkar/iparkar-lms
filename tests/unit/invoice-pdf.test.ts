import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { docFileName, money, renderInvoicePdf } from "@/lib/invoices/pdf";

const base = {
  number: "INV/2026-27/0001", issued_at: "2026-11-20T08:00:00Z", buyer_name: "Ann Buyer", buyer_email: "ann@example.com",
  buyer_country: "KW", description: "ASP practice exams – 180 days access", currency: "KWD", amount_minor: 45000,
  provider_payment_id: "pay_TEST123", provider_refund_id: null,
};

describe("invoice PDF", () => {
  it("formats amounts with each currency's decimals", () => {
    expect(money(45000, "KWD")).toBe("KWD 45.000");
    expect(money(799900, "INR")).toBe("INR 7,999.00");
    expect(money(9900, "USD")).toBe("USD 99.00");
  });
  it("renders an invoice and a credit note, even with non-Latin names", async () => {
    const inv = await renderInvoicePdf({ kind: "invoice", ...base });
    const cn = await renderInvoicePdf({ kind: "credit_note", ...base, number: "CN/2026-27/0001", buyer_name: "عمران Parkar",
      description: "Refund: ASP practice exams – 180 days access", provider_refund_id: "rfnd_TEST9", original: { number: base.number, issued_at: base.issued_at } });
    expect(Buffer.from(inv).subarray(0, 5).toString()).toBe("%PDF-");
    expect(cn.length).toBeGreaterThan(1000);
    expect(docFileName({ kind: "credit_note", number: "CN/2026-27/0001" })).toBe("iParkar-Credit-Note-CN-2026-27-0001.pdf");
    if (process.env.INVOICE_PREVIEW_DIR) {
      writeFileSync(`${process.env.INVOICE_PREVIEW_DIR}/invoice.pdf`, inv);
      writeFileSync(`${process.env.INVOICE_PREVIEW_DIR}/credit-note.pdf`, cn);
    }
  });
});
