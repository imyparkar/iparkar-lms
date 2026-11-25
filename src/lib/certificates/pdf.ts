/**
 * iParkar Learning certificate of course completion: single-page A4 landscape PDF (297 × 210 mm).
 * Re-implements the design reference "PMP certificate — A4 landscape-html/Main.dc.html" (1123 × 794 px
 * artboard) with pdf-lib. Every coordinate is in the template's CSS pixels and converted with S (pt per px).
 * Layout, typography, colours, branding, spacing and proportions follow the template; the Talent Triangle
 * artwork is the supplied image, unchanged. Wording defaults to "hours" (see docs/PMP-STUDY-COURSE.md).
 */
import { PDFDocument, rgb, setCharacterSpacing, pushGraphicsState, popGraphicsState, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type CertificateData = {
  name: string; certificateNo: string; completionDateISO: string; issuedAtISO?: string; courseTitle: string; courseShortTitle?: string;
  totalHours: number | string; categories: { businessAcumen: number; waysOfWorking: number; powerSkills: number };
  mode?: "hours" | "pdu"; timeZone?: string; issuer?: string; instructorName?: string; instructorTitle?: string; siteLabel?: string;
  trademarkLine?: string; _nameLayout?: { size: number; lines: number };
  /** "pmp-a4-landscape-v1" (default) or "course-a4-landscape-v1": no Talent Triangle or PMI categories; the statement replaces them. */
  template?: string; statement?: string;
};
type Bytes = Uint8Array | ArrayBuffer;
export type CertificateAssets = {
  fonts: { interRegular: Bytes; interMedium: Bytes; interSemiBold: Bytes; interBold: Bytes; serifSemiBold: Bytes };
  images: { talentTriangle: Bytes; iconBA: Bytes; iconWoW: Bytes; iconPS: Bytes; signature?: Bytes | null };
};
type TextOpts = { x: number; top: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; lh?: number; ls?: number; opacity?: number; kind?: "inter" | "serif"; align?: "left" | "right" };

const A4_W = 841.89, A4_H = 595.28;          // points
const ART_W = 1123, ART_H = 794;              // template px
const S = A4_W / ART_W;                       // 0.7497 pt/px (vertical uses the same scale; 794 px → 595.2 pt)

const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C = {
  midnight: hex("#02093a"), marigold: hex("#ffb110"), white: hex("#ffffff"), ink: hex("#000000"),
  charcoal: hex("#111111"), graphite: hex("#615d59"), slate: hex("#696969"),
};
// Inter / Source Serif 4 vertical metrics (hhea, units/em normalized) — used to emulate CSS line boxes.
const METRICS = { inter: { a: 0.96875, d: 0.2421875 }, serif: { a: 1.036, d: 0.335 } };

export const DEFAULT_LABELS = {
  // Template wording is "Total PDUs earned" / "earning {n} professional development units (PDUs)".
  // Default mode is "hours" until PMI provider status is verified (see docs/flags-and-gaps.md).
  hours: {
    leftCaption: "Contact hours completed",
    bodyLine: (n: string) => `and completing ${n} hours of project management training across the PMI Talent Triangle®.`,
  },
  pdu: {
    leftCaption: "Total PDUs earned",
    bodyLine: (n: string) => `and earning ${n} professional development units (PDUs) across the PMI Talent Triangle®.`,
  },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function formatCertificateDate(iso: string, timeZone = "UTC") {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${parseInt(get("day"), 10)} ${MONTHS[parseInt(get("month"), 10) - 1]} ${get("year")}`;
}

/** Glyph-coverage check so a name never renders with missing glyphs. */
export function unsupportedCharacters(text: string, serifFontBytes: Bytes): string[] {
  const f = fontkit.create(serifFontBytes instanceof Uint8Array ? serifFontBytes : new Uint8Array(serifFontBytes)) as unknown as { hasGlyphForCodePoint(c: number): boolean };
  const bad = new Set<string>();
  for (const ch of text.normalize("NFC")) {
    if (ch === " ") continue;
    if (!f.hasGlyphForCodePoint(ch.codePointAt(0)!)) bad.add(ch);
  }
  return [...bad];
}

export async function renderCertificatePdf(data: CertificateData, assets: CertificateAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${data.issuer || "iParkar Learning"} certificate of course completion — ${data.certificateNo}`);
  doc.setAuthor(data.issuer || "iParkar Learning");
  doc.setSubject(`Certificate of course completion: ${data.courseTitle}`);
  doc.setCreator("iParkar Learning LMS");
  doc.setProducer("iParkar Learning certificate renderer");
  doc.setKeywords(["iParkar Learning", "certificate of course completion", data.certificateNo]);
  doc.setCreationDate(new Date(data.issuedAtISO || Date.now()));
  doc.setModificationDate(new Date(data.issuedAtISO || Date.now()));

  const F = {
    r: await doc.embedFont(assets.fonts.interRegular, { subset: true }),
    m: await doc.embedFont(assets.fonts.interMedium, { subset: true }),
    sb: await doc.embedFont(assets.fonts.interSemiBold, { subset: true }),
    b: await doc.embedFont(assets.fonts.interBold, { subset: true }),
    serif: await doc.embedFont(assets.fonts.serifSemiBold, { subset: true }),
  };
  const I = {
    tri: await doc.embedPng(assets.images.talentTriangle),
    ba: await doc.embedPng(assets.images.iconBA),
    wow: await doc.embedPng(assets.images.iconWoW),
    ps: await doc.embedPng(assets.images.iconPS),
    sig: assets.images.signature && (assets.images.signature as Uint8Array).byteLength ? await doc.embedPng(assets.images.signature) : null,
  };
  const page: PDFPage = doc.addPage([A4_W, A4_H]);

  // ---------- helpers (px in, pt out) ----------
  const X = (px: number) => px * S;
  const Y = (pxTop: number) => A4_H - pxTop * S;
  const width = (font: PDFFont, text: string, sizePx: number, lsPx = 0) => font.widthOfTextAtSize(text, sizePx) + lsPx * Math.max(0, [...text].length - 1);
  const baseline = (topPx: number, lineHeightPx: number, sizePx: number, kind: "inter" | "serif" = "inter") => {
    const m = METRICS[kind];
    return topPx + (lineHeightPx - (m.a + m.d) * sizePx) / 2 + m.a * sizePx;
  };
  const text = (str: string, { x, top, size, font, color, lh, ls = 0, opacity = 1, kind = "inter", align = "left" }: TextOpts) => {
    const lineH = lh ?? size * 1.2109;
    let xPx = x;
    if (align === "right") xPx = x - width(font, str, size, ls);
    const by = baseline(top, lineH, size, kind);
    if (ls) page.pushOperators(pushGraphicsState(), setCharacterSpacing(ls * S));
    page.drawText(str, { x: X(xPx), y: Y(by), size: size * S, font, color, opacity });
    if (ls) page.pushOperators(setCharacterSpacing(0), popGraphicsState());
    return lineH;
  };
  const rrect = (x: number, top: number, w: number, h: number, r: number, opts: Record<string, unknown>) => {
    const p = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    page.drawSvgPath(p, { x: X(x), y: Y(top), scale: S, ...opts });
  };
  const wrap = (str: string, font: PDFFont, size: number, maxW: number, ls = 0) => {
    const words = str.split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (width(font, t, size, ls) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const general = data.template === "course-a4-landscape-v1";
  const labels = general
    ? { leftCaption: "Designed study hours",
        bodyLine: (n: string) => `and completing ${n} hours of designed study: live instructor-led sessions, practical assessments, independent study and a final course examination.` }
    : DEFAULT_LABELS[data.mode === "pdu" ? "pdu" : "hours"];
  const total = String(data.totalHours);

  // ---------- left panel (340 px, midnight) ----------
  page.drawRectangle({ x: 0, y: 0, width: X(340), height: A4_H, color: C.midnight });
  // logo mark (SVG reproduced as vector) 40×40 at (44, 52)
  const mk = 0.4; // 100-unit viewBox → 40 px
  const ox = 44, oy = 52;
  const svg = (d: string, opts: Record<string, unknown>) => page.drawSvgPath(d, { x: X(ox), y: Y(oy), scale: S * mk, ...opts });
  svg("M14 0H86A14 14 0 0 1 100 14V86A14 14 0 0 1 86 100H14A14 14 0 0 1 0 86V14A14 14 0 0 1 14 0Z", { color: C.white });
  svg("M33 27A7 7 0 1 1 19 27A7 7 0 1 1 33 27Z", { color: C.marigold });
  svg("M21.5 40H30.5A2 2 0 0 1 32.5 42V76A2 2 0 0 1 30.5 78H21.5A2 2 0 0 1 19.5 76V42A2 2 0 0 1 21.5 40Z", { color: C.midnight });
  svg("M43 22H52A2 2 0 0 1 54 24V76A2 2 0 0 1 52 78H43A2 2 0 0 1 41 76V24A2 2 0 0 1 43 22Z", { color: C.midnight });
  svg("M47 28.5 H59 C68 28.5 74 34.5 74 42.5 C74 50.5 68 56.5 59 56.5 H47", { borderColor: C.midnight, borderWidth: 13 }); // viewBox units: drawSvgPath scales the stroke with the path
  text(data.issuer || "iParkar Learning", { x: 96, top: 72 - (18 * 1.2109) / 2, size: 18, font: F.sb, color: C.white, ls: -0.2 });

  // middle block — space-between positions computed from the template's flex column
  const triH = general ? 0 : 220 * (I.tri.height / I.tri.width);
  const midH = triH + 28 + 96 + 6 + 16 * 1.2109;
  const botH = 18 + 4 + 18;
  const colTop = 52, colBottom = ART_H - 52;
  const gap = (colBottom - colTop - 40 - midH - botH) / 2;
  const midTop = colTop + 40 + gap;
  if (!general) page.drawImage(I.tri, { x: X(44), y: Y(midTop + triH), width: X(220), height: triH * S });
  const numTop = midTop + triH + 28;
  // The hours figure and its caption are centred on the Talent Triangle by their visible ink (glyph outlines,
  // letter-spacing included), not by advance widths, so they sit exactly under the triangle's apex.
  const triCenter = 44 + 220 / 2;
  const inkLeft = (bytes: Bytes, str: string, size: number, ls: number) => {
    const f = fontkit.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) as unknown as {
      unitsPerEm: number; layout(t: string): { glyphs: { bbox: { minX: number; maxX: number } }[]; positions: { xAdvance: number }[] } };
    const run = f.layout(str); const k = size / f.unitsPerEm;
    let pen = 0, minX = Infinity, maxX = -Infinity;
    run.glyphs.forEach((g, i) => {
      if (g.bbox.maxX > g.bbox.minX) { minX = Math.min(minX, pen + g.bbox.minX * k); maxX = Math.max(maxX, pen + g.bbox.maxX * k); }
      pen += run.positions[i].xAdvance * k + ls;
    });
    return triCenter - (minX + maxX) / 2; // x of the pen start that centres the ink on the triangle
  };
  text(total, { x: inkLeft(assets.fonts.interBold, total, 96, -3.84), top: numTop, size: 96, font: F.b, color: C.white, lh: 96, ls: -3.84 });
  text(labels.leftCaption, { x: inkLeft(assets.fonts.interSemiBold, labels.leftCaption, 16, 0.24), top: numTop + 96 + 6, size: 16, font: F.sb, color: C.marigold, ls: 0.24 });
  const botTop = colBottom - botH;
  text(data.courseShortTitle || "PMP® Exam Prep Course", { x: 44, top: botTop, size: 12, font: F.sb, color: C.white, lh: 18 });
  text(data.siteLabel || "iparkar.com", { x: 44, top: botTop + 22, size: 12, font: F.r, color: C.white, lh: 18, opacity: 0.78 });

  // ---------- right column ----------
  const RX = 340 + 64, RR = ART_W - 60, RW = RR - RX; // 404 … 1063 (659 px)
  let top = 52;
  // pill
  const pillTxt = "Course completion";
  const pillW = width(F.sb, pillTxt, 12, 0.24) + 28, pillH = 12 * 1.2109 + 10;
  rrect(RX, top, pillW, pillH, pillH / 2, { color: C.marigold });
  text(pillTxt, { x: RX + 14, top: top + 5, size: 12, font: F.sb, color: C.ink, ls: 0.24 });
  // certificate number (right aligned, centred on the pill row)
  const noW = width(F.sb, data.certificateNo, 12);
  const rowTxtTop = top + (pillH - 12 * 1.2109) / 2;
  text(data.certificateNo, { x: RR, top: rowTxtTop, size: 12, font: F.sb, color: C.charcoal, align: "right" });
  text("Certificate no. ", { x: RR - noW, top: rowTxtTop, size: 12, font: F.r, color: C.graphite, align: "right" });
  top += pillH + 30;

  text(general ? "Certificate of completion" : "Certificate of course completion", { x: RX, top, size: 38, font: F.b, color: C.midnight, lh: 38 * 1.1, ls: -1.04 });
  top += 38 * 1.1 + 26;
  text("This certificate is presented to", { x: RX, top, size: 14.667, font: F.r, color: C.graphite });
  top += 14.667 * 1.2109 + 6;

  // learner name — fit to column: shrink, then balance over two lines
  const name = data.name;
  let nSize = 52, nLines: string[] = [name];
  const ls = (sz: number) => -0.8 * (sz / 52);
  while (nSize > 34 && width(F.serif, name, nSize, ls(nSize)) > RW) nSize -= 1;
  if (width(F.serif, name, nSize, ls(nSize)) > RW) {
    nSize = 40;
    const balance = (sz: number) => {
      const words = name.split(" ");
      let best: { m: number; lines: string[] } | null = null;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
        const m = Math.max(width(F.serif, a, sz, ls(sz)), width(F.serif, b, sz, ls(sz)));
        if (!best || m < best.m) best = { m, lines: [a, b] };
      }
      return best;
    };
    let bl = balance(nSize);
    while (nSize > 26 && (!bl || bl.m > RW)) { nSize -= 1; bl = balance(nSize); }
    nLines = bl ? bl.lines : wrap(name, F.serif, nSize, RW, ls(nSize));
  }
  for (const line of nLines) {
    text(line, { x: RX, top, size: nSize, font: F.serif, color: C.ink, lh: nSize * 1.15, ls: ls(nSize), kind: "serif" });
    top += nSize * 1.15;
  }
  data._nameLayout = { size: nSize, lines: nLines.length };
  top += 14;
  rrect(RX, top, 72, 4, 2, { color: C.marigold });
  top += 4 + 20;
  text("for successfully completing the", { x: RX, top, size: 14.667, font: F.r, color: C.charcoal, lh: 14.667 * 1.55 });
  top += 14.667 * 1.55 + 2;
  for (const line of wrap(data.courseTitle, F.b, 22, RW, -0.3)) {
    text(line, { x: RX, top, size: 22, font: F.b, color: C.midnight, lh: 22 * 1.3, ls: -0.3 });
    top += 22 * 1.3;
  }
  top += 6;
  for (const line of wrap(labels.bodyLine(total), F.r, 14.667, 640)) {
    text(line, { x: RX, top, size: 14.667, font: F.r, color: C.charcoal, lh: 14.667 * 1.55 });
    top += 14.667 * 1.55;
  }
  top += 26;

  // three category tiles
  if (general) {
    // Statement panel in place of the PMI category tiles.
    const lines = wrap(data.statement || "Evidence of completion of an independent course by iParkar Learning.", F.r, 12.667, RW - 36);
    const h = lines.length * 12.667 * 1.5 + 28;
    rrect(RX + 0.5, top + 0.5, RW - 1, h - 1, 8, { borderColor: C.ink, borderOpacity: 0.2, borderWidth: 1 * S });
    lines.forEach((l, k) => text(l, { x: RX + 18, top: top + 14 + k * 12.667 * 1.5, size: 12.667, font: F.r, color: C.graphite, lh: 12.667 * 1.5 }));
  }
  const tiles: [typeof I.ba, number, string][] = general ? [] : [
    [I.ba, data.categories.businessAcumen, "Business acumen"],
    [I.wow, data.categories.waysOfWorking, "Ways of working"],
    [I.ps, data.categories.powerSkills, "Power skills"],
  ];
  const tW = (RW - 32) / 3;
  const contentH = Math.max(46 * (I.ba.height / I.ba.width), 30 + 2 + 12.667 * 1.2109);
  const tH = contentH + 28 + 2;
  tiles.forEach(([img, val, lbl], i) => {
    const tx = RX + i * (tW + 16);
    rrect(tx + 0.5, top + 0.5, tW - 1, tH - 1, 8, { borderColor: C.ink, borderOpacity: 0.2, borderWidth: 1 * S });
    const iH = 46 * (img.height / img.width);
    page.drawImage(img, { x: X(tx + 17), y: Y(top + (tH - iH) / 2 + iH), width: X(46), height: iH * S });
    const blockTop = top + (tH - (30 + 2 + 12.667 * 1.2109)) / 2;
    text(String(val), { x: tx + 17 + 46 + 14, top: blockTop, size: 30, font: F.b, color: C.midnight, lh: 30, ls: -0.9 });
    text(lbl, { x: tx + 17 + 46 + 14, top: blockTop + 32, size: 12.667, font: F.r, color: C.graphite });
  });

  // footer — fine print anchored to the bottom padding (40 px), signature row above it
  const fine = data.trademarkLine || (general
    ? `Verify this certificate by quoting its number to iParkar Learning (support@iparkar.com).`
    : "PMI, PMP and the PMI Talent Triangle are registered marks of the Project Management Institute, Inc. Talent Triangle artwork shown per PMI branding guidelines.");
  const fineLines = wrap(fine, F.r, 10.667, RW, 0.21);
  const fineTop = ART_H - 40 - fineLines.length * 10.667 * 1.4;
  fineLines.forEach((l, i) => text(l, { x: RX, top: fineTop + i * 10.667 * 1.4, size: 10.667, font: F.r, color: C.slate, lh: 10.667 * 1.4, ls: 0.21 }));
  const rowBottom = fineTop - 22;
  // Signature row: the date block (left, 220 px) and the signatory block (right, 260 px) share one baseline grid —
  // the date and the signatory name on one line, the two rules at the same height, and "Date of completion" and
  // the signatory title on one line beneath them.
  const capTop = rowBottom - 12 * 1.2109;
  const ruleTop = capTop - 7;
  const valTop = ruleTop - 6 - 16 * 1.2109;
  const sx = RR - 260;
  text(formatCertificateDate(data.completionDateISO, data.timeZone), { x: RX, top: valTop, size: 16, font: F.sb, color: C.charcoal });
  page.drawRectangle({ x: X(RX), y: Y(ruleTop + 1), width: X(220), height: 1 * S, color: C.ink, opacity: 0.2 });
  text(general ? "Date of issue" : "Date of completion", { x: RX, top: capTop, size: 12, font: F.r, color: C.graphite });
  if (I.sig) {
    // Handwritten signature (transparent PNG) above the signatory name, fitted inside 220 × 72 px.
    const maxW = 220, maxH = 72;
    const k = Math.min(maxW / I.sig.width, maxH / I.sig.height);
    const w = I.sig.width * k, h = I.sig.height * k;
    page.drawImage(I.sig, { x: X(sx), y: Y(valTop - 2), width: X(w), height: h * S });
  }
  text(data.instructorName || "Imran Parkar, PMP, CIT", { x: sx, top: valTop, size: 16, font: F.sb, color: C.charcoal });
  page.drawRectangle({ x: X(sx), y: Y(ruleTop + 1), width: X(260), height: 1 * S, color: C.ink, opacity: 0.2 });
  text(data.instructorTitle || "Course instructor, iParkar Learning", { x: sx, top: capTop, size: 12, font: F.r, color: C.graphite });

  return doc.save({ useObjectStreams: true });
}
