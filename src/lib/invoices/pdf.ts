import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { exponent } from "@/lib/payments/catalogue";

/** Seller details printed on every invoice and credit note. */
export const SELLER = {
  name: "iParkar Learning",
  address: ["542, Furus, Falsonda, Taluka - Khed", "District - Ratnagiri, Maharashtra - 415710", "India"],
  email: "support@iparkar.com",
  web: "iparkar.com",
  taxNote: "iParkar Learning is not registered for GST in India. No GST has been charged.",
};

export type InvoiceDoc = {
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_country: string | null;
  description: string;
  currency: string;
  amount_minor: number;
  provider_payment_id: string | null;
  provider_refund_id: string | null;
  original?: { number: string; issued_at: string } | null;
};

export function money(minor: number, currency: string): string {
  const e = exponent(currency);
  const n = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { minimumFractionDigits: e, maximumFractionDigits: e })
    .format(minor / 10 ** e);
  return `${currency} ${n}`;
}

export function docDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try { return COUNTRY.of(code) ?? code; } catch { return code; }
}

export const docTitle = (d: Pick<InvoiceDoc, "kind">) => (d.kind === "invoice" ? "Invoice" : "Credit note");
export const docFileName = (d: Pick<InvoiceDoc, "kind" | "number">) =>
  `iParkar-${d.kind === "invoice" ? "Invoice" : "Credit-Note"}-${d.number.replaceAll("/", "-")}.pdf`;

const INK = rgb(0.06, 0.07, 0.16);
const GREY = rgb(0.38, 0.4, 0.45);
const LINE = rgb(0.85, 0.85, 0.85);
const MIDNIGHT = rgb(2 / 255, 9 / 255, 58 / 255);

/** Builds the A4 PDF. Standard fonts only (no font files), so text is limited to Latin characters. */
export async function renderInvoicePdf(d: InvoiceDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${docTitle(d)} ${d.number}`);
  pdf.setAuthor(SELLER.name);
  pdf.setCreator(SELLER.name);
  const page = pdf.addPage([595.28, 841.89]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 56, R = 595.28 - 56;

  // Characters Helvetica can't encode (e.g. non-Latin names) are replaced so the PDF always builds.
  const safe = (font: PDFFont, s: string) =>
    Array.from(s).map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  const text = (p: PDFPage, s: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = o.font ?? reg, size = o.size ?? 10, t = safe(font, s);
    p.drawText(t, { x: o.right ? x - font.widthOfTextAtSize(t, size) : x, y, size, font, color: o.color ?? INK });
  };
  const wrap = (font: PDFFont, s: string, size: number, width: number) => {
    const words = safe(font, s).split(" "), lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Header
  page.drawRectangle({ x: 0, y: 841.89 - 8, width: 595.28, height: 8, color: MIDNIGHT });
  let y = 780;
  text(page, SELLER.name, L, y, { font: bold, size: 18, color: MIDNIGHT });
  text(page, docTitle(d).toUpperCase(), R, y, { font: bold, size: 18, right: true });
  y -= 20;
  for (const a of SELLER.address) { text(page, a, L, y, { color: GREY }); y -= 13; }
  text(page, `${SELLER.email}  ·  ${SELLER.web}`, L, y, { color: GREY });

  let ry = 760;
  const meta: [string, string][] = [
    [d.kind === "invoice" ? "Invoice no." : "Credit note no.", d.number],
    ["Date", docDate(d.issued_at)],
  ];
  if (d.original) meta.push(["Against invoice", d.original.number], ["Invoice date", docDate(d.original.issued_at)]);
  for (const [k, v] of meta) {
    text(page, k, R - 170, ry, { color: GREY, size: 9 });
    text(page, v, R, ry, { font: bold, size: 9, right: true });
    ry -= 14;
  }

  // Bill to
  y = 660;
  text(page, d.kind === "invoice" ? "BILLED TO" : "ISSUED TO", L, y, { font: bold, size: 9, color: GREY });
  y -= 16;
  // A name in a script the standard fonts can't show is left out rather than printed as "???"; the email identifies the buyer.
  const name = d.buyer_name && !safe(reg, d.buyer_name).includes("?") ? d.buyer_name : null;
  for (const v of [name, d.buyer_email, countryName(d.buyer_country)].filter(Boolean) as string[]) {
    text(page, v, L, y, { size: 11 }); y -= 15;
  }

  // Line items
  y = 575;
  page.drawLine({ start: { x: L, y: y + 14 }, end: { x: R, y: y + 14 }, thickness: 0.8, color: LINE });
  text(page, "Description", L, y, { font: bold, size: 9, color: GREY });
  text(page, "Qty", R - 150, y, { font: bold, size: 9, color: GREY, right: true });
  text(page, "Amount", R, y, { font: bold, size: 9, color: GREY, right: true });
  y -= 8;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: LINE });
  y -= 18;
  const amount = money(d.amount_minor, d.currency);
  const lines = wrap(reg, d.description, 11, R - 190 - L);
  text(page, "1", R - 150, y, { size: 11, right: true });
  text(page, amount, R, y, { size: 11, right: true });
  for (const ln of lines) { text(page, ln, L, y, { size: 11 }); y -= 15; }
  y -= 6;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: LINE });
  y -= 22;
  text(page, "Total", R - 150, y, { font: bold, size: 12, right: true });
  text(page, amount, R, y, { font: bold, size: 12, right: true });
  y -= 18;
  text(page, d.kind === "invoice" ? "Amount paid" : "Amount refunded", R - 150, y, { size: 10, color: GREY, right: true });
  text(page, amount, R, y, { size: 10, right: true });

  // Payment details and notes
  y -= 50;
  text(page, d.kind === "invoice" ? "PAYMENT" : "REFUND", L, y, { font: bold, size: 9, color: GREY });
  y -= 16;
  const pay = d.kind === "invoice"
    ? [`Paid online via Razorpay on ${docDate(d.issued_at)}`, d.provider_payment_id ? `Payment ID: ${d.provider_payment_id}` : null]
    : [`Refunded via Razorpay to the original payment method`, d.provider_payment_id ? `Original payment ID: ${d.provider_payment_id}` : null,
       d.provider_refund_id ? `Refund ID: ${d.provider_refund_id}` : null];
  for (const v of pay.filter(Boolean) as string[]) { text(page, v, L, y, { size: 10 }); y -= 14; }

  y -= 20;
  text(page, "NOTES", L, y, { font: bold, size: 9, color: GREY });
  y -= 16;
  const notes = [
    SELLER.taxNote,
    d.kind === "invoice"
      ? "One-time payment for online access for the period shown; no automatic renewal. Refunds follow our refund policy at iparkar.com/refunds."
      : "This credit note records a refund against the invoice shown above.",
  ];
  for (const n of notes) for (const ln of wrap(reg, n, 9, R - L)) { text(page, ln, L, y, { size: 9, color: GREY }); y -= 12; }

  text(page, "This is a computer-generated document and does not require a signature.", L, 56, { size: 8, color: GREY });
  text(page, `${SELLER.name} · ${SELLER.email}`, R, 56, { size: 8, color: GREY, right: true });
  return pdf.save();
}
