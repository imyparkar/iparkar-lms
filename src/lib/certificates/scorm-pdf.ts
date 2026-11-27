/**
 * iParkar Learning certificate of completion for free self-paced SCORM courses (first: SAT).
 * Template id "scorm-a4-landscape-v1": single-page A4 landscape PDF (297 × 210 mm), owner-approved design
 * of 27 Nov 2026 ("Option B · Split panel"): pale side panel with the iP mark, course facts and the
 * verification QR code; white main area with the learner's name, the course, the signatory block and
 * flowing contour lines in the top-right corner. Coordinates are in millimetres from the top-left corner.
 */
import { PDFDocument, rgb, setCharacterSpacing, pushGraphicsState, popGraphicsState, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { qrMatrix } from "./qr";
import { formatCertificateDate } from "./pdf";

export type ScormCertificateData = {
  name: string; certificateNo: string; completionDateISO: string; issuedAtISO?: string; courseTitle: string;
  /** Contact hours; CEU is printed as hours ÷ 10 (provider-issued, see docs/SCORM-COURSES.md). */
  totalHours: number; issuer?: string; signatoryName: string; signatoryTitle: string; verifyUrl: string;
  /** Small line under the course title, e.g. the ADDIE phases. */
  subtitle?: string; timeZone?: string;
};
type Bytes = Uint8Array | ArrayBuffer;
export type ScormCertificateAssets = {
  fonts: { interRegular: Bytes; interMedium: Bytes; serifLight: Bytes };
  signature?: Bytes | null;
};

const PT = 72 / 25.4;                          // points per mm
const W = 841.89, H = 595.28;                  // A4 landscape, points
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C = {
  navy: hex("#02093a"), marigold: hex("#ffb110"), rose: hex("#d4537e"), white: hex("#ffffff"),
  panel: hex("#f3f4f9"), slate: hex("#6b7194"), body: hex("#3b4166"), rule: hex("#c9cde3"), sigRule: hex("#b8bdd8"), wave: hex("#c9cde3"),
};
const SUBTITLES: Record<string, string> = {
  "Systematic Approach to Training (SAT)": "Analysis · Design · Development · Implementation · Evaluation",
};

export async function renderScormCertificatePdf(d: ScormCertificateData, a: ScormCertificateAssets): Promise<Uint8Array> {
  const issuer = d.issuer || "iParkar Learning";
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${issuer} certificate of completion — ${d.certificateNo}`);
  doc.setAuthor(issuer);
  doc.setSubject(`Certificate of completion: ${d.courseTitle}`);
  doc.setCreator("iParkar Learning LMS");
  doc.setProducer("iParkar Learning certificate renderer");
  doc.setKeywords([issuer, "certificate of completion", d.certificateNo]);
  doc.setCreationDate(new Date(d.issuedAtISO || Date.now()));
  doc.setModificationDate(new Date(d.issuedAtISO || Date.now()));

  const F = {
    r: await doc.embedFont(a.fonts.interRegular, { subset: true }),
    m: await doc.embedFont(a.fonts.interMedium, { subset: true }),
    serif: await doc.embedFont(a.fonts.serifLight, { subset: true }),
  };
  const sig = a.signature && (a.signature as Uint8Array).byteLength ? await doc.embedPng(a.signature) : null;
  const page: PDFPage = doc.addPage([W, H]);

  // ---------- helpers (mm in, pt out) ----------
  const X = (mm: number) => mm * PT;
  const Y = (mm: number) => H - mm * PT;
  const tw = (font: PDFFont, s: string, size: number, ls = 0) => font.widthOfTextAtSize(s, size) + ls * Math.max(0, [...s].length - 1);
  /** Draw text whose visual middle (x-height/cap mix) sits at `mid` mm from the top. Size in pt, letter-spacing in pt. */
  const text = (s: string, o: { x: number; mid: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; ls?: number; align?: "left" | "center" | "right" }) => {
    const ls = o.ls ?? 0;
    const w = tw(o.font, s, o.size, ls);
    const x = o.align === "center" ? X(o.x) - w / 2 : o.align === "right" ? X(o.x) - w : X(o.x);
    const baseline = Y(o.mid) - o.size * 0.36;
    if (ls) page.pushOperators(pushGraphicsState(), setCharacterSpacing(ls));
    page.drawText(s, { x, y: baseline, size: o.size, font: o.font, color: o.color });
    if (ls) page.pushOperators(setCharacterSpacing(0), popGraphicsState());
    return w;
  };
  const rect = (x: number, top: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x: X(x), y: Y(top + h), width: X(w), height: h * PT, color });

  // ---------- side panel ----------
  rect(0, 0, 92, 210, C.panel);

  // iP mark (iparkar-mark-primary.svg, 100-unit viewBox) at 16 mm.
  const mark = (x: number, top: number, size: number) => {
    const s = (size / 100) * PT, o = { x: X(x), y: Y(top), scale: s };
    page.drawSvgPath("M14 0 H86 A14 14 0 0 1 100 14 V86 A14 14 0 0 1 86 100 H14 A14 14 0 0 1 0 86 V14 A14 14 0 0 1 14 0 Z", { ...o, color: C.navy });
    page.drawSvgPath("M19 27 A7 7 0 1 0 33 27 A7 7 0 1 0 19 27 Z", { ...o, color: C.marigold });
    page.drawSvgPath("M21.5 40 H30.5 A2 2 0 0 1 32.5 42 V76 A2 2 0 0 1 30.5 78 H21.5 A2 2 0 0 1 19.5 76 V42 A2 2 0 0 1 21.5 40 Z", { ...o, color: C.white });
    page.drawSvgPath("M43 22 H52 A2 2 0 0 1 54 24 V76 A2 2 0 0 1 52 78 H43 A2 2 0 0 1 41 76 V24 A2 2 0 0 1 43 22 Z", { ...o, color: C.white });
    page.drawSvgPath("M47 28.5 H59 C68 28.5 74 34.5 74 42.5 C74 50.5 68 56.5 59 56.5 H47", { ...o, borderColor: C.white, borderWidth: 13 });
  };
  mark(15, 20, 16);
  text(issuer, { x: 15, mid: 43.7, size: 12, font: F.m, color: C.navy });
  text("Make learning a habit", { x: 15, mid: 49.5, size: 9, font: F.r, color: C.slate });

  const facts: [string, string][] = [
    ["Format", "Self-paced online"],
    ["Duration", `${fmtNum(d.totalHours)} contact hour${d.totalHours === 1 ? "" : "s"}`],
    ["Continuing education", `${fmtNum(d.totalHours / 10)} CEU`],
    ["Date of completion", formatCertificateDate(d.completionDateISO, d.timeZone ?? "UTC")],
  ];
  facts.forEach(([k, v], i) => {
    const top = 79.9 + i * 14.97;
    text(k, { x: 15, mid: top, size: 8.5, font: F.r, color: C.slate, ls: 0.17 });
    text(v, { x: 15, mid: top + 5.55, size: 12, font: F.r, color: C.navy });
  });

  // QR code (verification link) on a white tile, certificate number below.
  rect(15, 159.8, 28, 28, C.white);
  const m = qrMatrix(d.verifyUrl), n = m.length, cell = 23 / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (m[r][c]) rect(17.5 + c * cell, 162.3 + r * cell, cell + 0.02, cell + 0.02, C.navy);
  }
  text(d.certificateNo, { x: 15, mid: 192, size: 8.5, font: F.r, color: C.slate, ls: 0.34 });

  // ---------- contour lines, top-right corner (owner-approved "flowing waves") ----------
  // Drawn in a 150 × 200 unit box, 0.68 mm per unit, anchored to the page's top-right corner.
  const wu = 0.68 * PT;
  for (let k = 0; k < 11; k++) {
    const o = k * 9;
    const p = `M${o} 0 C${25 + o} 30 ${55 + o * 0.6} 45 ${90 + o * 0.3} 55 S 140 ${70 + o * 0.6} 150 ${85 + o * 0.9}`;
    page.drawSvgPath(p, { x: X(195), y: Y(0), scale: wu, borderColor: C.wave, borderWidth: 0.6 });
  }

  // ---------- main text ----------
  const L = 116, R = 275, maxW = X(R) - X(L);
  text("CERTIFICATE OF COMPLETION", { x: L, mid: 55.4, size: 9.5, font: F.m, color: C.rose, ls: 1.9 });
  text("This certifies that", { x: L, mid: 68, size: 10.5, font: F.r, color: C.slate });
  // Name: 38 pt on one line, shrinking to 26 pt; longer names wrap onto two lines (down to 18 pt).
  let ns = 38;
  while (ns > 26 && tw(F.serif, d.name, ns) > maxW) ns -= 1;
  if (tw(F.serif, d.name, ns) <= maxW) {
    text(d.name, { x: L, mid: 80.3, size: ns, font: F.serif, color: C.navy });
  } else {
    const words = d.name.split(" ");
    let best: [string, string] = [d.name, ""], bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const pair: [string, string] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const w = Math.max(tw(F.serif, pair[0], 10), tw(F.serif, pair[1], 10));
      if (w < bestW) { bestW = w; best = pair; }
    }
    ns = 26;
    while (ns > 18 && Math.max(tw(F.serif, best[0], ns), tw(F.serif, best[1], ns)) > maxW) ns -= 1;
    const gap = (ns * 1.15) / PT;
    text(best[0], { x: L, mid: 82 - gap / 2, size: ns, font: F.serif, color: C.navy });
    text(best[1], { x: L, mid: 82 + gap / 2, size: ns, font: F.serif, color: C.navy });
  }
  page.drawLine({ start: { x: X(L), y: Y(94.2) }, end: { x: X(R), y: Y(94.2) }, thickness: 0.3 * PT, color: C.rule });
  text("has completed all modules and knowledge checks of the self-paced online course", { x: L, mid: 104.4, size: 11, font: F.r, color: C.body });
  let cs = 22;
  while (cs > 15 && tw(F.serif, d.courseTitle, cs) > maxW) cs -= 1;
  text(d.courseTitle, { x: L, mid: 115.4, size: cs, font: F.serif, color: C.navy });
  const sub = d.subtitle ?? SUBTITLES[d.courseTitle];
  if (sub) text(sub, { x: L, mid: 125, size: 9, font: F.r, color: C.slate, ls: 0.18 });

  // ---------- signatory block (centred on a 72 mm line) ----------
  const sx = L, sw = 72, cx = sx + sw / 2;
  if (sig) {
    const h = 20, w = (sig.width / sig.height) * h;
    page.drawImage(sig, { x: X(cx) - X(w) / 2, y: Y(162.3 + h), width: X(w), height: h * PT });
  }
  page.drawLine({ start: { x: X(sx), y: Y(182.1) }, end: { x: X(sx + sw), y: Y(182.1) }, thickness: 0.3 * PT, color: C.sigRule });
  text(d.signatoryName, { x: cx, mid: 187, size: 10.5, font: F.m, color: C.navy, align: "center" });
  text(d.signatoryTitle, { x: cx, mid: 192, size: 9, font: F.r, color: C.slate, align: "center" });

  text("Scan the QR code or verify at", { x: R, mid: 185.8, size: 9, font: F.r, color: C.slate, align: "right" });
  text("iparkar.com/verify", { x: R, mid: 191, size: 10, font: F.m, color: C.navy, align: "right" });

  return doc.save({ useObjectStreams: true });
}

function fmtNum(n: number) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}
