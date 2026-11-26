import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { INTER_WOFF } from "@/lib/invoices/fonts";
import { exponent } from "@/lib/payments/catalogue";

/** Seller details printed on every invoice and credit note (GST REG-06 and Udyam certificates, Nov 2026). */
export const SELLER = {
  name: "iParkar Learning",
  legalName: "Imran Iqbal Parkar",
  constitution: "Proprietor",
  address: ["542, Furus, Near Falsonda Qabristan, Taluka Khed", "District Ratnagiri, Maharashtra 415709", "India"],
  gstin: "27ATAPP7789A1ZF",
  state: "Maharashtra (27)",
  udyam: "UDYAM-MH-28-0101316",
  email: "support@iparkar.com",
  web: "iparkar.com",
  /** Only for documents issued before GST registration took effect (24 Nov 2026). */
  taxNote: "iParkar Learning was not registered for GST when this document was issued. No GST has been charged.",
};

export type TaxRegime = "none" | "intra_state" | "inter_state" | "export_lut" | "export_igst";

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
  // GST particulars (frozen when the document was issued)
  tax_regime?: TaxRegime | null;
  supplier_gstin?: string | null;
  sac?: string | null;
  place_of_supply?: string | null;
  buyer_state_code?: string | null;
  buyer_gstin?: string | null;
  buyer_business_name?: string | null;
  gst_rate_bp?: number | null;
  taxable_minor?: number | null;
  cgst_minor?: number | null;
  sgst_minor?: number | null;
  igst_minor?: number | null;
  lut_arn?: string | null;
};

/** Columns needed to render a document. */
export const DOC_COLUMNS = "kind, number, issued_at, buyer_name, buyer_email, buyer_country, description, currency, amount_minor, provider_payment_id, provider_refund_id, "
  + "tax_regime, supplier_gstin, sac, place_of_supply, buyer_state_code, buyer_gstin, buyer_business_name, gst_rate_bp, taxable_minor, cgst_minor, sgst_minor, igst_minor, lut_arn";

const gst = (d: InvoiceDoc) => !!d.tax_regime && d.tax_regime !== "none";

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

export const docTitle = (d: Pick<InvoiceDoc, "kind" | "tax_regime">) =>
  d.kind === "credit_note" ? "Credit note" : d.tax_regime && d.tax_regime !== "none" ? "Tax invoice" : "Invoice";
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

/** Builds the A4 PDF in the iParkar design system (layout "B": clean letterhead), with GST particulars (CGST Rules 46 and 53). */
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
  const taxed = gst(d);
  const regime = d.tax_regime ?? "none";
  const L = 56, R = W - 56;
  const m = (v: number | null | undefined) => money(Number(v ?? 0), d.currency);
  const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;
  const rate = d.gst_rate_bp ?? 0;

  // Letterhead: monogram, wordmark, seller details incl. GSTIN
  monogram(p, L, H - 96, 44);
  const wm = f.b.widthOfTextAtSize("iParkar", 20);
  text("iParkar", L + 56, H - 80, { font: f.b, size: 20, color: C.midnight });
  text("Learning", L + 56 + wm + 6, H - 80, { size: 20, color: C.graphite });
  const sellerLines = [
    `${SELLER.legalName} (${SELLER.constitution}), trading as ${SELLER.name}`,
    SELLER.address[0], `${SELLER.address[1]}, ${SELLER.address[2]}`,
    ...(taxed ? [`GSTIN ${d.supplier_gstin ?? SELLER.gstin}  ·  State: ${SELLER.state}`] : []),
    `${SELLER.email}  ·  ${SELLER.web}`,
  ];
  sellerLines.forEach((v, i) => text(v, L + 56, H - 98 - i * 11.5, { size: 8.5, color: C.graphite }));

  // Marigold rule, title (left) and document details (right)
  const top = H - 98 - sellerLines.length * 11.5 - 14;
  p.drawRectangle({ x: L, y: top, width: 64, height: 4, color: C.marigold });
  text(docTitle(d), L, top - 38, { font: f.b, size: 28, color: C.midnight });
  const meta: [string, string][] = [[isInv ? "Invoice no." : "Credit note no.", d.number], ["Date", docDate(d.issued_at)]];
  if (d.original) meta.push(["Against invoice", d.original.number], ["Invoice date", docDate(d.original.issued_at)]);
  if (taxed) meta.push(["Place of supply", d.place_of_supply ?? "—"], ["Reverse charge", "No"]);
  meta.forEach(([k, v], i) => {
    text(k, R - 200, top - 12 - i * 14, { size: 9, color: C.graphite });
    text(v, R, top - 12 - i * 14, { font: f.s, size: 9, align: "right" });
  });

  // Billed to
  let y = Math.min(top - 78, top - 12 - meta.length * 14 - 18);
  label(isInv ? "Billed to" : "Issued to", L, y);
  const name = d.buyer_name && !safe(d.buyer_name).includes("?") ? d.buyer_name : null;
  const india = regime === "intra_state" || regime === "inter_state";
  const to = [
    d.buyer_business_name ? { v: d.buyer_business_name, b: true } : null,
    name ? { v: name, b: !d.buyer_business_name } : null,
    d.buyer_email ? { v: d.buyer_email, b: false } : null,
    d.buyer_gstin ? { v: `GSTIN ${d.buyer_gstin}`, b: false } : null,
    india ? { v: `State: ${d.place_of_supply ?? ""}`, b: false } : { v: countryName(d.buyer_country) ?? "", b: false },
  ].filter((x): x is { v: string; b: boolean } => !!x && !!x.v);
  to.forEach((t, i) => text(t.v, L, y - 17 - i * 14, { size: 10.5, font: t.b ? f.s : f.r }));
  y -= 17 + to.length * 14 + 26;

  // Line item table (hairlines): description, SAC, qty, taxable value
  const colSac = R - 210, colQty = R - 140;
  p.drawLine({ start: { x: L, y: y + 18 }, end: { x: R, y: y + 18 }, thickness: 0.8, color: C.hair });
  text("Description", L, y, { font: f.s, size: 9, color: C.graphite });
  if (taxed) text("SAC", colSac, y, { font: f.s, size: 9, color: C.graphite });
  text("Qty", colQty, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  text(taxed ? "Taxable value" : "Amount", R, y, { font: f.s, size: 9, color: C.graphite, align: "right" });
  p.drawLine({ start: { x: L, y: y - 8 }, end: { x: R, y: y - 8 }, thickness: 0.8, color: C.hair });
  y -= 30;
  const desc = wrap(d.description, f.r, 10.5, (taxed ? colSac : colQty - 40) - L - 12);
  if (taxed) text(d.sac ?? "", colSac, y, { size: 10.5 });
  text("1", colQty, y, { size: 10.5, align: "right" });
  text(m(taxed ? d.taxable_minor : d.amount_minor), R, y, { size: 10.5, align: "right" });
  desc.forEach((ln, i) => text(ln, L, y - i * 14, { size: 10.5 }));
  y -= (desc.length - 1) * 14 + 14;
  p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: C.hair });

  // Totals box: taxable value, tax lines, total
  const rows: [string, string][] = [];
  if (taxed) {
    rows.push(["Taxable value", m(d.taxable_minor)]);
    if (regime === "intra_state") rows.push([`CGST @ ${pct(rate / 2)}`, m(d.cgst_minor)], [`SGST @ ${pct(rate / 2)}`, m(d.sgst_minor)]);
    else if (regime === "export_lut") rows.push(["IGST @ 0% (zero-rated)", m(0)]);
    else rows.push([`IGST @ ${pct(rate)}`, m(d.igst_minor)]);
  }
  const boxW = 250, boxH = 22 + rows.length * 15 + 40;
  const boxTop = y - 12;
  roundRect(p, R - boxW, boxTop - boxH, boxW, boxH, 12, C.paper);
  let by = boxTop - 22;
  for (const [k, v] of rows) {
    text(k, R - boxW + 16, by, { size: 9.5, color: C.graphite });
    text(v, R - 16, by, { size: 9.5, align: "right" });
    by -= 15;
  }
  if (rows.length) { p.drawLine({ start: { x: R - boxW + 16, y: by + 6 }, end: { x: R - 16, y: by + 6 }, thickness: 0.6, color: C.hair }); by -= 8; }
  text(isInv ? "Total" : "Total credited", R - boxW + 16, by - 6, { font: f.s, size: 11, color: C.graphite });
  text(m(d.amount_minor), R - 16, by - 8, { font: f.b, size: 16, color: C.midnight, align: "right" });
  text(isInv ? (taxed && regime !== "export_lut" ? "Amount paid in full (GST included)" : "Amount paid in full") : "Amount refunded",
    R - boxW + 16, by - 22, { size: 8, color: C.graphite });
  y = boxTop - boxH - 26;

  // Export endorsement (Rule 46 / Rule 96A)
  if (regime === "export_lut" || regime === "export_igst") {
    const endorse = regime === "export_lut"
      ? `SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX${d.lut_arn ? ` (LUT ARN ${d.lut_arn})` : ""}`
      : "SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX";
    for (const ln of wrap(endorse, f.s, 8.5, R - L)) { text(ln, L, y, { font: f.s, size: 8.5, color: C.midnight }); y -= 12; }
    y -= 14;
  }

  // Payment / refund details
  label(isInv ? "Payment" : "Refund", L, y);
  const pay = (isInv
    ? [`Paid online via Razorpay on ${docDate(d.issued_at)}`, d.provider_payment_id ? `Payment ID: ${d.provider_payment_id}` : null]
    : ["Refunded via Razorpay to the original payment method", d.provider_payment_id ? `Original payment ID: ${d.provider_payment_id}` : null,
       d.provider_refund_id ? `Refund ID: ${d.provider_refund_id}` : null]).filter(Boolean) as string[];
  pay.forEach((v, i) => text(v, L, y - 15 - i * 13, { size: 9.5 }));
  y -= 15 + pay.length * 13 + 22;

  // Notes
  label("Notes", L, y);
  y -= 15;
  const notes = [
    taxed
      ? (regime === "export_lut" ? "Zero-rated export of services; no GST charged."
        : regime === "export_igst" ? "Zero-rated export of services on payment of IGST; the price shown includes IGST, stated in the invoice currency."
        : isInv ? "The price shown includes GST." : "The refunded amount includes GST.")
      : SELLER.taxNote,
    isInv
      ? "One-time payment for online access for the period shown; no automatic renewal. Refunds follow our refund policy at iparkar.com/refunds."
      : "This credit note records a refund against the invoice shown above; the tax shown is the tax credited.",
    `MSME (Udyam) registration ${SELLER.udyam}.`,
  ];
  for (const n of notes) for (const ln of wrap(n, f.r, 8.5, R - L - 200)) { text(ln, L, y, { size: 8.5, color: C.graphite }); y -= 12; }

  // Signatory block (bottom right)
  const sy = 110;
  text(`For ${SELLER.name}`, R, sy, { font: f.s, size: 9, align: "right" });
  text(`${SELLER.legalName}, ${SELLER.constitution}`, R, sy - 30, { size: 9, align: "right" });
  text("Authorised signatory", R, sy - 43, { size: 8, color: C.graphite, align: "right" });

  // Footer and Midnight base strip
  text("This is a computer-generated document.", L, 40, { size: 8, color: C.graphite });
  text(`${SELLER.name} · ${SELLER.web}`, R, 40, { size: 8, color: C.graphite, align: "right" });
  p.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: C.midnight });
  return pdf.save();
}
