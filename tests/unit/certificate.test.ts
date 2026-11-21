/* eslint-disable @typescript-eslint/no-explicit-any -- mocks */
import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ getServiceClient: () => { throw new Error("service client must be injected in tests"); } }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: {} }) }));

import { certificateAssets } from "@/lib/certificates/assets";
import { formatCertificateDate, renderCertificatePdf, type CertificateData } from "@/lib/certificates/pdf";
import { normalizeName, validateCertificateName } from "@/lib/certificates/name";
import { issueCertificate } from "@/lib/certificates/issue";

const base: CertificateData = {
  name: "Heena Parkar", certificateNo: "IPL-PMP-7F3A-19C2", completionDateISO: "2026-11-21T09:30:00Z",
  courseTitle: "PMP® Exam Prep Course", courseShortTitle: "PMP® Exam Prep Course", totalHours: 35,
  categories: { businessAcumen: 8, waysOfWorking: 19, powerSkills: 8 }, mode: "hours", issuer: "iParkar Learning",
};

describe("certificate names", () => {
  it("accepts spaces, accents, apostrophes, hyphens and full stops; normalises to NFC", async () => {
    const font = (await certificateAssets()).fonts.serifSemiBold as Uint8Array;
    for (const n of ["Zoë O’Brien-Núñez", "Dée-Ann St. John", "Mary-Jane D'Souza", "José Ángel Pérez Álvarez", "Łukasz Żółć", "Jean-Luc Pétain-Bérénger"]) {
      expect(validateCertificateName(n, n, font), n).toEqual({ ok: true, value: n.normalize("NFC") });
    }
    expect(normalizeName("  Zoe\u0308   Smith \u200b")).toBe("Zoë Smith");
    expect(validateCertificateName("Zoe\u0308 Smith", "Zoë Smith", font).ok).toBe(true);
  });
  it("rejects digits, symbols, mismatches, too short/long names and characters the font can't print", async () => {
    const font = (await certificateAssets()).fonts.serifSemiBold as Uint8Array;
    const bad = ["", "A", "R2D2", "<b>Ann</b>", "Ann  ", "x".repeat(71), "Ann--Lee", "'Ann"];
    for (const n of bad) expect(validateCertificateName(n, n, font).ok, n).toBe(n === "Ann  ");
    expect(validateCertificateName("Ann Lee", "Ann Leigh", font)).toMatchObject({ ok: false, error: expect.stringMatching(/match/) });
    expect(validateCertificateName("王小明", "王小明", font)).toMatchObject({ ok: false, error: expect.stringMatching(/can't be printed/) });
  });
});

describe("certificate PDF", () => {
  it("is one A4 landscape page (297 × 210 mm) with the hours wording and issuer metadata", async () => {
    const pdf = await renderCertificatePdf({ ...base }, await certificateAssets());
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width / 72 * 25.4).toBeCloseTo(297, 0);
    expect(height / 72 * 25.4).toBeCloseTo(210, 0);
    expect(doc.getAuthor()).toBe("iParkar Learning");
    expect(doc.getTitle()).toMatch(/iParkar Learning certificate of course completion — IPL-PMP-7F3A-19C2/);
    if (process.env.CERTIFICATE_PREVIEW_DIR) writeFileSync(`${process.env.CERTIFICATE_PREVIEW_DIR}/certificate-sample.pdf`, pdf);
  });
  it("fits long names by shrinking, then balancing over two lines, without overflow", async () => {
    const assets = await certificateAssets();
    const short = { ...base }; await renderCertificatePdf(short, assets);
    expect(short._nameLayout).toEqual({ size: 52, lines: 1 });
    const mid = { ...base, name: "Alexandra Konstantinopoulou-Smith" }; await renderCertificatePdf(mid, assets);
    expect(mid._nameLayout!.lines).toBe(1);
    expect(mid._nameLayout!.size).toBeLessThanOrEqual(52);
    const long = { ...base, name: "Zoë O’Brien-Núñez Castellanos de la Vega y Montoya-Fitzgerald" };
    const pdf = await renderCertificatePdf(long, assets);
    expect(long._nameLayout!.lines).toBe(2);
    expect(long._nameLayout!.size).toBeGreaterThanOrEqual(26);
    if (process.env.CERTIFICATE_PREVIEW_DIR) writeFileSync(`${process.env.CERTIFICATE_PREVIEW_DIR}/certificate-long-name.pdf`, pdf);
  });
  it("prints the completion date in words, in UTC by default", () => {
    expect(formatCertificateDate("2026-11-21T23:30:00Z")).toBe("21 November 2026");
    expect(formatCertificateDate("2026-11-21T23:30:00Z", "Asia/Kuwait")).toBe("22 November 2026");
  });
});

describe("issueCertificate", () => {
  const claimed = {
    ok: true, state: "claimed", claim_token: "tok-1",
    certificate: { id: "c1", user_id: "u1", certificate_code: "IPL-PMP-AAAA-BBBB", name_on_certificate: "Ben Okafor",
      certificate_title: "PMP® Exam Prep Course", short_title: "PMP® Exam Prep Course", completed_at: "2026-11-21T09:30:00Z", hours: 35,
      categories: { businessAcumen: 8, waysOfWorking: 19, powerSkills: 8 }, wording: "hours", issuer: "iParkar Learning",
      signatory_name: "Imran Parkar, PMP, CSP", signatory_title: "Course instructor, iParkar Learning" },
  };
  const session = (r: any) => ({ rpc: vi.fn(async () => ({ data: r, error: null })) }) as any;

  it("stores the PDF before finalizing, and reports success only after finalize", async () => {
    const order: string[] = [];
    const bucket = { get: vi.fn(), put: vi.fn(async (k: string) => { order.push(`put:${k}`); }) };
    const service = { rpc: vi.fn(async (fn: string) => { order.push(fn); return { data: { ok: true }, error: null }; }) } as any;
    const r = await issueCertificate(session(claimed), "PMP-SPS", "Ben Okafor", "Ben Okafor", { bucket, service });
    expect(r).toEqual({ ok: true, certificate_code: "IPL-PMP-AAAA-BBBB", already: false });
    expect(order).toEqual(["put:certificates/u1/IPL-PMP-AAAA-BBBB.pdf", "service_finalize_study_certificate"]);
    const args = service.rpc.mock.calls[0][1];
    expect(args.p_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_bytes).toBeGreaterThan(10_000);
  });
  it("releases the claim and reports an actionable error when saving fails", async () => {
    const bucket = { get: vi.fn(), put: vi.fn(async () => { throw new Error("R2 down"); }) };
    const service = { rpc: vi.fn(async () => ({ data: { ok: true }, error: null })) } as any;
    const r = await issueCertificate(session(claimed), "PMP-SPS", "Ben Okafor", "Ben Okafor", { bucket, service });
    expect(r).toMatchObject({ ok: false, error: "save_failed", message: expect.stringMatching(/Nothing was issued/) });
    expect(service.rpc.mock.calls.map((c: any[]) => c[0])).toEqual(["service_release_study_certificate_claim"]);
  });
  it("never renders for an incomplete course and returns an already-issued certificate unchanged", async () => {
    const bucket = { get: vi.fn(), put: vi.fn() };
    const service = { rpc: vi.fn() } as any;
    const locked = await issueCertificate(session({ ok: false, error: "course_incomplete" }), "PMP-SPS", "Ben Okafor", "Ben Okafor", { bucket, service });
    expect(locked).toMatchObject({ ok: false, status: 403, error: "course_incomplete" });
    const again = await issueCertificate(session({ ok: true, state: "issued", certificate: { certificate_code: "IPL-PMP-AAAA-BBBB" } }),
      "PMP-SPS", "Ben Okafor", "Ben Okafor", { bucket, service });
    expect(again).toEqual({ ok: true, certificate_code: "IPL-PMP-AAAA-BBBB", already: true });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalled();
  });
  it("validates the name before touching the database", async () => {
    const s = session(claimed);
    const r = await issueCertificate(s, "PMP-SPS", "Ben Okafor", "Ben Okafur", { bucket: { get: vi.fn(), put: vi.fn() }, service: { rpc: vi.fn() } as any });
    expect(r).toMatchObject({ ok: false, error: "invalid_name" });
    expect(s.rpc).not.toHaveBeenCalled();
  });
});
