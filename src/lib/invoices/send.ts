import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServiceClient } from "@/lib/supabase/admin";
import { DOC_COLUMNS, SELLER, docFileName, renderInvoicePdf, type InvoiceDoc } from "@/lib/invoices/pdf";
import { renderInvoiceEmail } from "@/lib/invoices/email";

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
 * Emails an invoice or credit note (PDF attached) through Cloudflare Email Service, in the branded layout from email.ts.
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
    const { subject, text, html } = renderInvoiceEmail(doc);

    const from = process.env.INVOICE_FROM_EMAIL || SELLER.email;
    const bcc = process.env.INVOICE_BCC_EMAIL || "";
    const result = await email.send({
      from: { email: from, name: SELLER.name },
      to: doc.buyer_name ? { email: doc.buyer_email!, name: doc.buyer_name } : doc.buyer_email!,
      ...(bcc ? { bcc } : {}),
      replyTo: { email: SELLER.email, name: SELLER.name },
      subject,
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
