import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { EMAIL_LOGO_URL, renderInvoiceEmail } from "@/lib/invoices/email";
import type { InvoiceDoc } from "@/lib/invoices/pdf";

const invoice: InvoiceDoc = {
  kind: "invoice", number: "INV/2026-27/0042", issued_at: "2026-11-28T05:00:00Z", buyer_name: "Priya <Shah>", buyer_email: "priya@example.com",
  buyer_country: "US", description: "CSP practice exams – 90 days access", currency: "USD", amount_minor: 9900,
  provider_payment_id: "pay_TEST", provider_refund_id: null, tax_regime: "export_lut",
};
const credit: InvoiceDoc = {
  ...invoice, kind: "credit_note", number: "CN/2026-27/0003", description: "Refund: CSP practice exams – 90 days access",
  provider_refund_id: "rfnd_TEST", original: { number: "INV/2026-27/0042", issued_at: "2026-11-20T05:00:00Z" },
};

describe("invoice emails", () => {
  it("renders the branded invoice email", () => {
    const m = renderInvoiceEmail(invoice);
    expect(m.subject).toBe("Your iParkar Learning™ invoice INV/2026-27/0042");
    expect(m.html).toContain(EMAIL_LOGO_URL);
    expect(m.html).toContain("Thank you for your purchase");
    expect(m.html).toContain("USD 99.00");
    expect(m.html).toContain("https://app.iparkar.com/dashboard");
    expect(m.html).toContain("&trade;");
    expect(m.html).toContain("Priya &lt;Shah&gt;"); // names are escaped
    expect(m.html).not.toContain("<Shah>");
    expect(m.text).toContain("Amount paid: USD 99.00");
  });

  it("renders the branded credit note email", () => {
    const m = renderInvoiceEmail(credit);
    expect(m.subject).toBe("Your iParkar Learning™ refund – credit note CN/2026-27/0003");
    expect(m.html).toContain("Your refund has been processed");
    expect(m.html).toContain("(against invoice INV/2026-27/0042)");
    expect(m.html).toContain("Amount refunded");
    expect(m.html).toContain("https://app.iparkar.com/account");
    expect(m.html).not.toContain("Refund: CSP");
  });

  it("writes previews when asked", () => {
    if (!process.env.WRITE_EMAIL_PREVIEWS) return;
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/invoice-email.html", renderInvoiceEmail(invoice).html);
    writeFileSync("tmp/credit-note-email.html", renderInvoiceEmail(credit).html);
  });
});
