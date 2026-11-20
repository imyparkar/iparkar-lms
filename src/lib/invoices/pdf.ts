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
  ink: hex("#111111"), graphite: hex("#615d59"), hair: hex("#e4e2df"), sky: hex("#e6f3fe"),
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

/** Builds the A4 PDF in the iParkar design system (layout "C": white card on paper, centred title). */
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
  const label = (s: string, x: number, y: number, align?: "left" | "center" | "right") =>
    text(s.toUpperCase(), x, y, { font: f.s, size: 7.5, color: C.graphite, align });

  const isInv = d.kind === "invoice";
  const L = 56, R = W - 56, CX = W / 2;

  // Page and header
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper });
  monogram(p, L, H - 84, 32);
  const wm = f.b.widthOfTextAtSize("iParkar", 15);
  text("iParkar", L + 42, H - 72, { font: f.b, size: 15, color: C.midnight });
  text("Learning", L + 42 + wm + 4.5, H - 72, { size: 15, color: C.graphite });
  const pill = isInv ? "PAID" : "REFUNDED";
  const pw = Math.max(80, f.b.widthOfTextAtSize(pill, 10) + 36);
  roundRect(p, R - pw, H - 81, pw, 26, 13, isInv ? C.marigold : C.sky);
  text(pill, R - pw / 2, H - 71.5, { font: f.b, size: 10, color: C.midnight, align: "center" });

  // Card
  roundRect(p, 40, 70, W - 80, H - 180, 12, C.white);

  // Centred title and document details
  let y = H - 160;
  text(docTitle(d), CX, y, { font: f.b, size: 30, color: C.midnight, align: "center" });
  p.drawRectangle({ x: CX - 18, y: y - 16, width: 36, height: 3, color: C.marigold });
  const meta: [string, string][] = [[isInv ? "Invoice no." : "Credit note no.", d.number], ["Date", docDate(d.issued_at)]];
  if (d.original) meta.push(["Against invoice", d.original.number], ["Invoice date", docDate(d.original.issued_at)]);
  const colW = Math.min(150, (R - L) / meta.length);
  const x0 = CX - (colW * meta.length) / 2;
  y -= 48;
  meta.forEach(([k, v], i) => {
    const cx = x0 + colW * i + colW / 2;
    label(k, cx, y, "center");
    text(v, cx, y - 15, { font: f.s, size: 10, align: "center" });
  });
  y -= 36;
  p.drawLine({ start: { x: L + 8, y }, end: { x: R - 8, y }, thickness: 0.8, color: C.hair });

  // From / Billed to
  y -= 28;
  label("From", L + 8, y);
  label(isInv ? "Billed to" : "Issued to", CX + 20, y);
  const from = [SELLER.name, ...SELLER.address, SELLER.email];
  const name = d.buyer_name && !safe(d.buyer_name).includes("?") ? d.buyer_name : null;
  const to = [name, d.buyer_email, countryName(d.buyer_country)].filter(Boolean) as string[];
  from.forEach((v, i) => text(v, L + 8, y - 16 - i * 13, { size: 9.5, font: i === 0 ? f.s : f.r }));
  to.forEach((v, i) => text(v, CX + 20, y - 16 - i * 13, { size: 9.5, font: i === 0 && name ? f.s : f.r }));
  y -= 16 + Math.max(from.length, to.length) * 13 + 22;

  // Line item table
  roundRect(p, L, y - 8, R - L, 26, 6, C.paper);
  text("Description", L + 12, y, { font: f.s, size: 9, color: C.graphite });
  text("Qty", R - 150, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  text("Amount", R - 12, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  const amount = money(d.amount_minor, d.currency);
  y -= 32;
  const desc = wrap(d.description, f.r, 11, R - 200 - L);
  text("1", R - 150, y, { size: 11, align: "right" });
  text(amount, R - 12, y, { size: 11, align: "right" });
  desc.forEach((ln, i) => text(ln, L + 12, y - i * 15, { size: 11 }));
  y -= (desc.length - 1) * 15 + 14;
  p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: C.hair });
  y -= 26;
  text("Total", R - 150, y, { font: f.s, size: 12, align: "right" });
  text(amount, R - 12, y, { font: f.b, size: 14, color: C.midnight, align: "right" });
  y -= 16;
  text(isInv ? "Amount paid" : "Amount refunded", R - 150, y, { size: 8.5, color: C.graphite, align: "right" });
  text(amount, R - 12, y, { size: 8.5, color: C.graphite, align: "right" });

  // Payment / refund details
  y -= 44;
  label(isInv ? "Payment" : "Refund", L + 8, y);
  const pay = isInv
    ? [`Paid online via Razorpay on ${docDate(d.issued_at)}`, d.provider_payment_id ? `Payment ID: ${d.provider_payment_id}` : null]
    : ["Refunded via Razorpay to the original payment method", d.provider_payment_id ? `Original payment ID: ${d.provider_payment_id}` : null,
       d.provider_refund_id ? `Refund ID: ${d.provider_refund_id}` : null];
  (pay.filter(Boolean) as string[]).forEach((v, i) => text(v, L + 8, y - 16 - i * 14, { size: 10 }));
  y -= 16 + pay.filter(Boolean).length * 14 + 26;

  // Notes
  label("Notes", L + 8, y);
  y -= 16;
  const notes = [SELLER.taxNote, isInv
    ? "One-time payment for online access for the period shown; no automatic renewal. Refunds follow our refund policy at iparkar.com/refunds."
    : "This credit note records a refund against the invoice shown above."];
  for (const n of notes) for (const ln of wrap(n, f.r, 8.5, R - L - 24)) { text(ln, L + 8, y, { size: 8.5, color: C.graphite }); y -= 12; }

  // Footer
  text("This is a computer-generated document and does not require a signature.", L, 44, { size: 8, color: C.graphite });
  text(`${SELLER.name} · ${SELLER.web}`, R, 44, { size: 8, color: C.graphite, align: "right" });
  return pdf.save();
}
