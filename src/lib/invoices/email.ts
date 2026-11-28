import { SELLER, docDate, docTitle, money, type InvoiceDoc } from "@/lib/invoices/pdf";

/**
 * Branded invoice / credit-note email in the iParkar design system (owner-approved layout, Nov 2026):
 * midnight header with the iP™ mark, marigold rule, white card with the amount and one action, footer with
 * business details and the trademark notice. Table layout and inline styles so Gmail, Outlook and Apple Mail
 * render it the same; the logo is a PNG because most mail clients block SVG.
 */

export const EMAIL_LOGO_URL = "https://app.iparkar.com/brand/iparkar-mark-reversed-tm-email.png";
const APP = "https://app.iparkar.com";
const SITE = "https://iparkar.com";

const C = {
  midnight: "#02093a", marigold: "#ffb110", blue: "#0075de", paper: "#f6f5f4",
  white: "#ffffff", ink: "#111111", graphite: "#615d59", stone: "#757575", hair: "#e4e2df",
};
const FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TM = `<sup style="font-size:60%;line-height:0;vertical-align:super;font-weight:400">&trade;</sup>`;

export type InvoiceEmail = { subject: string; text: string; html: string };

export function renderInvoiceEmail(doc: InvoiceDoc): InvoiceEmail {
  const invoice = doc.kind === "invoice";
  const title = docTitle(doc);
  const amount = money(doc.amount_minor, doc.currency);
  const product = invoice ? doc.description : doc.description.replace(/^Refund: /, "");
  const hello = doc.buyer_name ? `Hello ${doc.buyer_name},` : "Hello,";
  const subject = invoice
    ? `Your iParkar Learning™ invoice ${doc.number}`
    : `Your iParkar Learning™ refund – credit note ${doc.number}`;

  const headline = invoice ? "Thank you for your purchase" : "Your refund has been processed";
  const body = invoice
    ? [`Your invoice ${doc.number} for ${product} is attached. Your access is open now.`]
    : [`We have processed your refund for ${product}.`,
       `Credit note ${doc.number}${doc.original ? ` (against invoice ${doc.original.number})` : ""} is attached. `
       + "The money goes back to your original payment method; depending on your bank this usually takes 5–10 business days."];
  const amountLabel = invoice ? "Amount paid" : "Amount refunded";
  const cta = invoice
    ? { label: "Open your dashboard", href: `${APP}/dashboard` }
    : { label: "View your invoices", href: `${APP}/account` };
  const after = invoice
    ? "You can download your invoices any time from Account in the app."
    : "Your invoices and credit notes are always available from Account in the app.";
  const preheader = invoice ? `Invoice ${doc.number} · ${amount} · your access is open now.` : `Credit note ${doc.number} · ${amount} refunded.`;

  const text = [
    `iParkar Learning™`, "", hello, "", headline + ".", ...body, "", `${amountLabel}: ${amount}`, "",
    `${cta.label}: ${cta.href}`, after, "",
    `If you have any questions, reply to this email or write to ${SELLER.email}.`, "",
    `iParkar Learning™ · ${SELLER.address.join(", ")}`, SITE,
    "The iP logo and the iParkar Learning name are trademarks of iParkar Learning.",
  ].join("\n");

  const p = (s: string, extra = "") => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};${extra}">${s}</p>`;
  const link = (href: string, label: string, color: string = C.graphite) =>
    `<a href="${href}" style="color:${color};text-decoration:underline">${label}</a>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.paper}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate">
  <tr><td style="background:${C.midnight};border-radius:12px 12px 0 0;padding:22px 28px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle"><a href="${SITE}" style="text-decoration:none"><img src="${EMAIL_LOGO_URL}" width="51" height="40" alt="iP" style="display:block;border:0;width:51px;height:40px"></a></td>
      <td style="vertical-align:middle;padding-left:12px;font-family:${FONT};font-size:19px;line-height:1.2;color:${C.white};font-weight:600;letter-spacing:-0.3px">iParkar <span style="font-weight:400;color:#c9cbe0">Learning</span>${TM}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${C.marigold};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td style="background:${C.white};border-radius:0 0 12px 12px;padding:28px 28px 24px">
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.graphite}">${esc(title)} ${esc(doc.number)} · ${esc(docDate(doc.issued_at))}</p>
    <h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;color:${C.midnight}">${esc(headline)}</h1>
    ${p(esc(hello))}
    ${body.map((b) => p(esc(b))).join("\n    ")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;background:${C.paper};border-radius:8px">
      <tr><td style="padding:14px 16px;font-family:${FONT};font-size:15px;color:${C.graphite}">${amountLabel}</td>
          <td align="right" style="padding:14px 16px;font-family:${FONT};font-size:16px;font-weight:600;color:${C.midnight};white-space:nowrap">${esc(amount)}</td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.blue};border-radius:8px">
      <a href="${cta.href}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:${C.white};text-decoration:none;border-radius:8px">${cta.label}</a>
    </td></tr></table>
    <p style="margin:22px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.graphite}">${esc(after)} Questions? Reply to this email or write to ${link(`mailto:${SELLER.email}`, SELLER.email, C.blue)}.</p>
  </td></tr>
  <tr><td align="center" style="padding:20px 28px 8px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.stone}">
    iParkar Learning${TM} · ${esc(SELLER.address.join(", "))}<br>
    ${link(SITE, "iparkar.com")} · ${link(`${SITE}/terms`, "Terms")} · ${link(`${SITE}/privacy`, "Privacy")} · ${link(`${SITE}/refunds`, "Refunds")}<br>
    <span style="font-size:11px">The iP logo and the iParkar Learning name are trademarks of iParkar Learning.</span>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
