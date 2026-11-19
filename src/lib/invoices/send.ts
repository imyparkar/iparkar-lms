import "server-only";
import { getServiceClient } from "@/lib/supabase/admin";
import { SELLER, docDate, docFileName, docTitle, money, renderInvoicePdf, type InvoiceDoc } from "@/lib/invoices/pdf";

const COLS = "id, kind, number, issued_at, buyer_name, buyer_email, buyer_country, description, currency, amount_minor, provider_payment_id, provider_refund_id, original_invoice_id, emailed_at";

type Row = InvoiceDoc & { id: string; original_invoice_id: string | null; emailed_at: string | null };

export async function loadInvoiceDoc(row: Row, db = getServiceClient()): Promise<InvoiceDoc> {
  let original: InvoiceDoc["original"] = null;
  if (row.original_invoice_id) {
    const { data } = await db.from("invoices").select("number, issued_at").eq("id", row.original_invoice_id).maybeSingle();
    original = data ?? null;
  }
  return { ...row, original };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Emails an invoice or credit note (PDF attached) through Brevo's transactional API.
 * Sends at most once: a claim on the row stops the browser callback and the webhook
 * from both sending. Never throws — failures are stored in email_error and logged.
 */
export async function sendInvoiceEmail(invoiceId: string | null | undefined): Promise<void> {
  if (!invoiceId) return;
  const key = process.env.BREVO_API_KEY;
  if (!key) { console.warn("invoice email skipped: BREVO_API_KEY not set"); return; }
  const db = getServiceClient();
  const staleClaim = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: row } = await db.from("invoices").update({ email_claimed_at: new Date().toISOString() })
    .eq("id", invoiceId).is("emailed_at", null).or(`email_claimed_at.is.null,email_claimed_at.lt.${staleClaim}`)
    .select(COLS).maybeSingle<Row>();
  if (!row) return; // already sent, being sent, or unknown
  try {
    if (!row.buyer_email) throw new Error("no buyer email");
    const doc = await loadInvoiceDoc(row, db);
    const pdf = await renderInvoicePdf(doc);
    const title = docTitle(doc);
    const amount = money(doc.amount_minor, doc.currency);
    const hello = doc.buyer_name ? `Hello ${doc.buyer_name},` : "Hello,";
    const body = doc.kind === "invoice"
      ? [`Thank you for your purchase from iParkar Learning.`, `Your invoice ${doc.number} for ${amount} (${doc.description}) is attached.`,
         `Your access is open now at https://app.iparkar.com/dashboard. You can download your invoices any time from Account in the app.`]
      : [`We have processed your refund of ${amount} for ${doc.description.replace(/^Refund: /, "")}.`,
         `Credit note ${doc.number}${doc.original ? ` (against invoice ${doc.original.number})` : ""} is attached.`,
         `The money goes back to your original payment method; depending on your bank this usually takes 5–10 business days.`];
    const text = [hello, "", ...body, "", "If you have any questions, reply to this email or write to support@iparkar.com.", "", "iParkar Learning", "https://iparkar.com"].join("\n");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#10122a">`
      + `<p>${esc(hello)}</p>${body.map((p) => `<p>${esc(p)}</p>`).join("")}`
      + `<p>If you have any questions, reply to this email or write to <a href="mailto:support@iparkar.com">support@iparkar.com</a>.</p>`
      + `<p>iParkar Learning<br><a href="https://iparkar.com">iparkar.com</a></p>`
      + `<p style="font-size:12px;color:#606573">${esc(title)} ${esc(doc.number)} · ${esc(docDate(doc.issued_at))}</p></div>`;

    const from = process.env.INVOICE_FROM_EMAIL || SELLER.email;
    const bcc = process.env.INVOICE_BCC_EMAIL || "";
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: SELLER.name, email: from },
        to: [{ email: doc.buyer_email, ...(doc.buyer_name ? { name: doc.buyer_name } : {}) }],
        ...(bcc ? { bcc: [{ email: bcc }] } : {}),
        replyTo: { email: SELLER.email, name: SELLER.name },
        subject: doc.kind === "invoice" ? `Your iParkar Learning invoice ${doc.number}` : `Your iParkar Learning refund – credit note ${doc.number}`,
        textContent: text,
        htmlContent: html,
        attachment: [{ name: docFileName(doc), content: Buffer.from(pdf).toString("base64") }],
        tags: [doc.kind],
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await db.from("invoices").update({ emailed_at: new Date().toISOString(), email_error: null }).eq("id", row.id);
  } catch (e) {
    console.error("invoice email", invoiceId, e);
    // Release the claim so a later webhook retry can try again.
    await db.from("invoices").update({ email_error: String(e).slice(0, 500), email_claimed_at: null }).eq("id", row.id);
  }
}
