import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { docFileName, docTitle, money, renderInvoicePdf, type InvoiceDoc } from "@/lib/invoices/pdf";

const base: InvoiceDoc = {
  kind: "invoice", number: "INV/2026-27/0001", issued_at: "2026-11-26T08:00:00Z", buyer_name: "Ann Buyer", buyer_email: "ann@example.com",
  buyer_country: "IN", description: "ASP practice exams – 180 days access", currency: "INR", amount_minor: 1299900,
  provider_payment_id: "pay_TEST123", provider_refund_id: null,
  tax_regime: "intra_state", supplier_gstin: "27ATAPP7789A1ZF", sac: "999293", place_of_supply: "Maharashtra (27)", buyer_state_code: "27",
  gst_rate_bp: 1800, taxable_minor: 1101610, cgst_minor: 99145, sgst_minor: 99145, igst_minor: 0,
};
const samples: Record<string, InvoiceDoc> = {
  "india-maharashtra": base,
  "india-business-karnataka": { ...base, number: "INV/2026-27/0002", tax_regime: "inter_state", place_of_supply: "Karnataka (29)", buyer_state_code: "29",
    buyer_gstin: "29AAACB1234C1Z5", buyer_business_name: "Acme Safety Pvt Ltd", cgst_minor: 0, sgst_minor: 0, igst_minor: 198290 },
  "export-igst-kuwait": { ...base, number: "INV/2026-27/0003", buyer_country: "KW", currency: "KWD", amount_minor: 45000, tax_regime: "export_igst",
    place_of_supply: "Outside India (KW)", buyer_state_code: null, taxable_minor: 38136, cgst_minor: 0, sgst_minor: 0, igst_minor: 6864 },
  "export-lut-usa": { ...base, number: "INV/2026-27/0004", buyer_country: "US", currency: "USD", amount_minor: 14900, tax_regime: "export_lut",
    place_of_supply: "Outside India (US)", buyer_state_code: null, taxable_minor: 14900, cgst_minor: 0, sgst_minor: 0, igst_minor: 0, lut_arn: "AD271126028060L" },
  "credit-note-maharashtra": { ...base, kind: "credit_note", number: "CN/2026-27/0001", description: "Refund: ASP practice exams – 180 days access",
    provider_refund_id: "rfnd_TEST9", original: { number: "INV/2026-27/0001", issued_at: "2026-11-26T08:00:00Z" } },
};

describe("invoice PDF", () => {
  it("formats amounts with each currency's decimals", () => {
    expect(money(45000, "KWD")).toBe("KWD 45.000");
    expect(money(799900, "INR")).toBe("INR 7,999.00");
  });
  it("titles GST invoices as tax invoices", () => {
    expect(docTitle({ kind: "invoice", tax_regime: "intra_state" })).toBe("Tax invoice");
    expect(docTitle({ kind: "invoice", tax_regime: "none" })).toBe("Invoice");
    expect(docTitle({ kind: "credit_note", tax_regime: "intra_state" })).toBe("Credit note");
  });
  it("renders every tax treatment", async () => {
    for (const [name, d] of Object.entries(samples)) {
      const pdf = await renderInvoicePdf(d);
      expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
      if (process.env.INVOICE_PREVIEW_DIR) writeFileSync(`${process.env.INVOICE_PREVIEW_DIR}/${name}.pdf`, pdf);
    }
    expect(docFileName({ kind: "credit_note", number: "CN/2026-27/0001" })).toBe("iParkar-Credit-Note-CN-2026-27-0001.pdf");
  });
});
