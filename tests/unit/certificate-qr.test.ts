import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { qrMatrix, verifyUrl } from "@/lib/certificates/qr";
import { renderCertificatePdf, type CertificateData } from "@/lib/certificates/pdf";
import { certificateAssets } from "@/lib/certificates/assets";

const base: CertificateData = {
  name: "Ann Lee", certificateNo: "IPL-OHBP-7Q2M-K9X4", completionDateISO: "2026-11-25T12:00:00Z",
  courseTitle: "Basic Principles in Occupational Hygiene", courseShortTitle: "Basic Principles in Occupational Hygiene",
  totalHours: 36, categories: { businessAcumen: 0, waysOfWorking: 0, powerSkills: 0 }, template: "course-a4-landscape-v1",
  statement: "Evidence of completion of an independent course by iParkar Learning.",
};

describe("certificate QR code", () => {
  it("links to the iparkar.com verification page for the certificate number", () => {
    expect(verifyUrl("IPL-OHBP-7Q2M-K9X4")).toBe("https://iparkar.com/verify/?id=IPL-OHBP-7Q2M-K9X4");
    const m = qrMatrix(verifyUrl("IPL-OHBP-7Q2M-K9X4"));
    expect(m.length).toBe(33);                       // version 4: large modules, easy to scan from print
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true); // finder pattern
  });

  it("renders on both templates as one A4 page", async () => {
    const assets = await certificateAssets();
    for (const t of ["course-a4-landscape-v1", "pmp-a4-landscape-v1"]) {
      const pdf = await renderCertificatePdf({ ...base, template: t, verifyUrl: verifyUrl(base.certificateNo) }, assets);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
      if (process.env.CERT_QR_OUT) (await import("node:fs")).writeFileSync(`${process.env.CERT_QR_OUT}/${t}.pdf`, pdf);
    }
  });
});
