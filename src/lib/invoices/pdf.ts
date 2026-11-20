import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { INTER_WOFF } from "@/lib/invoices/fonts";
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

// iParkar design system (styles.css on iparkar.com)
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  midnight: hex("#02093a"), marigold: hex("#ffb110"), paper: hex("#f6f5f4"), white: hex("#ffffff"),
  ink: hex("#111111"), graphite: hex("#615d59"), hair: hex("#e4e2df"),
};
const W = 595.28, H = 841.89;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function roundRect(p: PDFPage, x: number, y: number, w: number, h: number, r: number, color: RGB) {
  p.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
    { x, y: y + h, color, borderWidth: 0 });
}

/** The iP monogram (same geometry as iparkar-mark-primary.svg, drawn in a 100×100 box). */
function monogram(p: PDFPage, x: number, y: number, size: number) {
  const s = size / 100, top = y + size;
  roundRect(p, x, y, size, size, 14 * s, C.midnight);
  p.drawCircle({ x: x + 26 * s, y: top - 27 * s, size: 7 * s, color: C.marigold });
  roundRect(p, x + 19.5 * s, top - 78 * s, 13 * s, 38 * s, 2 * s, C.white);
  roundRect(p, x + 41 * s, top - 78 * s, 13 * s, 56 * s, 2 * s, C.white);
  p.drawSvgPath("M 47 28.5 H 59 C 68 28.5 74 34.5 74 42.5 C 74 50.5 68 56.5 59 56.5 H 47",
    { x, y: top, scale: s, borderColor: C.white, borderWidth: 13 });
}

/** Builds the A4 PDF in the iParkar design system (layout "B": clean letterhead). */
export async function renderInvoicePdf(d: InvoiceDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${docTitle(d)} ${d.number}`);
  pdf.setAuthor(SELLER.name);
  pdf.setCreator(SELLER.name);
  const f = {
    r: await pdf.embedFont(b64(INTER_WOFF.regular), { subset: true }),
    s: await pdf.embedFont(b64(INTER_WOFF.semibold), { subset: true }),
    b: await pdf.embedFont(b64(INTER_WOFF.bold), { subset: true }),
  };
  const covered = new Set(f.r.getCharacterSet());
  // Characters outside the font (e.g. non-Latin scripts) become "?" so the PDF always builds.
  const safe = (s: string) => Array.from(s).map((ch) => (covered.has(ch.codePointAt(0)!) || ch === " " ? ch : "?")).join("");
  const p = pdf.addPage([W, H]);
  const text = (s: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: RGB; align?: "left" | "right" | "center" } = {}) => {
    const font = o.font ?? f.r, size = o.size ?? 10, t = safe(s), w = font.widthOfTextAtSize(t, size);
    p.drawText(t, { x: o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x, y, size, font, color: o.color ?? C.ink });
  };
  const wrap = (s: string, font: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    let cur = "";
    for (const w of safe(s).split(" ")) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && font.widthOfTextAtSize(next, size) > width) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const label = (s: string, x: number, y: number) => text(s.toUpperCase(), x, y, { font: f.s, size: 7.5, color: C.graphite });

  const isInv = d.kind === "invoice";
  const L = 56, R = W - 56;

  // Letterhead: monogram, wordmark, seller details
  monogram(p, L, H - 96, 44);
  const wm = f.b.widthOfTextAtSize("iParkar", 20);
  text("iParkar", L + 56, H - 80, { font: f.b, size: 20, color: C.midnight });
  text("Learning", L + 56 + wm + 6, H - 80, { size: 20, color: C.graphite });
  [SELLER.address[0], `${SELLER.address[1]}, ${SELLER.address[2]}`, `${SELLER.email}  ·  ${SELLER.web}`]
    .forEach((v, i) => text(v, L + 56, H - 98 - i * 12, { size: 8.5, color: C.graphite }));

  // Marigold rule, title (left) and document details (right)
  p.drawRectangle({ x: L, y: H - 150, width: 64, height: 4, color: C.marigold });
  text(docTitle(d), L, H - 190, { font: f.b, size: 30, color: C.midnight });
  const meta: [string, string][] = [[isInv ? "Invoice no." : "Credit note no.", d.number], ["Date", docDate(d.issued_at)]];
  if (d.original) meta.push(["Against invoice", d.original.number], ["Invoice date", docDate(d.original.issued_at)]);
  meta.forEach(([k, v], i) => {
    text(k, R - 185, H - 164 - i * 15, { size: 9, color: C.graphite });
    text(v, R, H - 164 - i * 15, { font: f.s, size: 9, align: "right" });
  });

  // Billed to
  let y = H - 240;
  label(isInv ? "Billed to" : "Issued to", L, y);
  const name = d.buyer_name && !safe(d.buyer_name).includes("?") ? d.buyer_name : null;
  const to = [name, d.buyer_email, countryName(d.buyer_country)].filter(Boolean) as string[];
  to.forEach((v, i) => text(v, L, y - 18 - i * 15, { size: 11, font: i === 0 && name ? f.s : f.r }));
  y -= 18 + to.length * 15 + 40;

  // Line item table (hairlines)
  p.drawLine({ start: { x: L, y: y + 18 }, end: { x: R, y: y + 18 }, thickness: 0.8, color: C.hair });
  text("Description", L, y, { font: f.s, size: 9, color: C.graphite });
  text("Qty", R - 150, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  text("Amount", R, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  p.drawLine({ start: { x: L, y: y - 8 }, end: { x: R, y: y - 8 }, thickness: 0.8, color: C.hair });
  const amount = money(d.amount_minor, d.currency);
  y -= 32;
  const desc = wrap(d.description, f.r, 11, R - 190 - L);
  text("1", R - 150, y, { size: 11, align: "right" });
  text(amount, R, y, { size: 11, align: "right" });
  desc.forEach((ln, i) => text(ln, L, y - i * 15, { size: 11 }));
  y -= (desc.length - 1) * 15 + 14;
  p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: C.hair });

  // Total box
  const boxW = 230, boxH = 54;
  roundRect(p, R - boxW, y - 12 - boxH, boxW, boxH, 12, C.paper);
  text("Total", R - boxW + 16, y - 33, { font: f.s, size: 11, color: C.graphite });
  text(amount, R - 16, y - 36, { font: f.b, size: 16, color: C.midnight, align: "right" });
  text(isInv ? "Amount paid in full" : "Amount refunded", R - boxW + 16, y - 50, { size: 8, color: C.graphite });
  y -= 12 + boxH + 40;

  // Payment / refund details
  label(isInv ? "Payment" : "Refund", L, y);
  const pay = (isInv
    ? [`Paid online via Razorpay on ${docDate(d.issued_at)}`, d.provider_payment_id ? `Payment ID: ${d.provider_payment_id}` : null]
    : ["Refunded via Razorpay to the original payment method", d.provider_payment_id ? `Original payment ID: ${d.provider_payment_id}` : null,
       d.provider_refund_id ? `Refund ID: ${d.provider_refund_id}` : null]).filter(Boolean) as string[];
  pay.forEach((v, i) => text(v, L, y - 16 - i * 14, { size: 10 }));
  y -= 16 + pay.length * 14 + 28;

  // Notes
  label("Notes", L, y);
  y -= 16;
  const notes = [SELLER.taxNote, isInv
    ? "One-time payment for online access for the period shown; no automatic renewal. Refunds follow our refund policy at iparkar.com/refunds."
    : "This credit note records a refund against the invoice shown above."];
  for (const n of notes) for (const ln of wrap(n, f.r, 8.5, R - L)) { text(ln, L, y, { size: 8.5, color: C.graphite }); y -= 12; }

  // Footer and Midnight base strip
  text("This is a computer-generated document and does not require a signature.", L, 40, { size: 8, color: C.graphite });
  text(`${SELLER.name} · ${SELLER.web}`, R, 40, { size: 8, color: C.graphite, align: "right" });
  p.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: C.midnight });
  return pdf.save();
}
