import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServiceClient } from "@/lib/supabase/admin";
import { DOC_COLUMNS, SELLER, docDate, docFileName, docTitle, money, renderInvoicePdf, type InvoiceDoc } from "@/lib/invoices/pdf";

const COLS = `id, ${DOC_COLUMNS}, original_invoice_id, emailed_at`;

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

type EmailAddress = { email: string; name: string };
type SendEmail = {
  send(msg: {
    to: string | EmailAddress; from: string | EmailAddress; replyTo?: string | EmailAddress; bcc?: string | EmailAddress;
    subject: string; html?: string; text?: string;
    attachments?: { content: string; filename: string; type: string; disposition: "attachment" | "inline" }[];
  }): Promise<{ messageId: string }>;
};

/** Cloudflare Email Service binding (wrangler.jsonc "send_email": [{ "name": "EMAIL" }]). */
async function emailBinding(): Promise<SendEmail | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as { EMAIL?: SendEmail }).EMAIL ?? null;
  } catch {
    return null; // not running on Cloudflare (local dev / tests)
  }
}

/**
 * Emails an invoice or credit note (PDF attached) through Cloudflare Email Service.
 * Sends at most once: a claim on the row stops the browser callback and the webhook
 * from both sending. Never throws — failures are stored in email_error and logged.
 */
export async function sendInvoiceEmail(invoiceId: string | null | undefined): Promise<void> {
  if (!invoiceId) return;
  const email = await emailBinding();
  if (!email) { console.warn("invoice email skipped: EMAIL binding not available"); return; }
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
    const result = await email.send({
      from: { email: from, name: SELLER.name },
      to: doc.buyer_name ? { email: doc.buyer_email!, name: doc.buyer_name } : doc.buyer_email!,
      ...(bcc ? { bcc } : {}),
      replyTo: { email: SELLER.email, name: SELLER.name },
      subject: doc.kind === "invoice" ? `Your iParkar Learning invoice ${doc.number}` : `Your iParkar Learning refund – credit note ${doc.number}`,
      text,
      html,
      attachments: [{ content: Buffer.from(pdf).toString("base64"), filename: docFileName(doc), type: "application/pdf", disposition: "attachment" }],
    });
    console.log("invoice emailed", doc.number, result.messageId);
    await db.from("invoices").update({ emailed_at: new Date().toISOString(), email_error: null }).eq("id", row.id);
  } catch (e) {
    console.error("invoice email", invoiceId, e);
    // Release the claim so a later webhook retry can try again.
    await db.from("invoices").update({ email_error: String(e).slice(0, 500), email_claimed_at: null }).eq("id", row.id);
  }
}
