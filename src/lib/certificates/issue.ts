import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/admin";
import { certificateAssets } from "./assets";
import { validateCertificateName } from "./name";
import { renderCertificatePdf } from "./pdf";

/** Private R2 object store: certificates live under certificates/<user id>/<certificate code>.pdf in the study-guides bucket. */
export type CertificateBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; sha256?: string }): Promise<unknown>;
};
export const CERT_PREFIX = "certificates/";

export async function certificateBucket(): Promise<CertificateBucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const b = (env as unknown as { STUDY_GUIDES?: CertificateBucket }).STUDY_GUIDES;
    if (b) return b;
  } catch {
    /* not running on Cloudflare */
  }
  return process.env.NODE_ENV === "development" ? devBucket() : null;
}

/** `next dev` only (no R2 there): an in-memory bucket so the certificate journey can be tried locally. */
function devBucket(): CertificateBucket {
  const g = globalThis as unknown as { __iplDevCertificates?: Map<string, Uint8Array> };
  const store = (g.__iplDevCertificates ??= new Map());
  return {
    async get(key) {
      const v = store.get(key);
      return v ? { body: new Response(v as Uint8Array<ArrayBuffer>).body!, size: v.byteLength } : null;
    },
    async put(key, value) { store.set(key, value); },
  };
}

type Claimed = {
  id: string; user_id: string; certificate_code: string; name_on_certificate: string; certificate_title: string; short_title: string;
  completed_at: string; hours: number; categories: { businessAcumen: number; waysOfWorking: number; powerSkills: number };
  wording: "hours" | "pdu"; issuer: string; signatory_name: string; signatory_title: string;
};
export type IssueResult =
  | { ok: true; certificate_code: string; already: boolean }
  | { ok: false; status: number; error: string; message: string };

const MESSAGES: Record<string, [number, string]> = {
  not_signed_in: [401, "Your session has ended. Sign in again, then generate your certificate."],
  not_offered: [404, "This course doesn't offer a certificate."],
  not_enrolled: [403, "You're not enrolled in this course, so a certificate can't be generated."],
  course_incomplete: [403, "Finish every required chapter first. The certificate unlocks when the whole course is complete."],
  in_progress: [409, "Your certificate is already being generated. Wait a few seconds, then refresh this page."],
  invalid_name: [400, "Use letters, spaces, apostrophes, hyphens and full stops only."],
  storage_unavailable: [503, "We couldn't save your certificate just now. Nothing was issued. Try again in a minute."],
  render_failed: [500, "We couldn't create the certificate PDF. Nothing was issued. Try again, or contact support@iparkar.com if it keeps happening."],
  save_failed: [503, "We couldn't save your certificate just now. Nothing was issued. Try again in a minute."],
};
const fail = (error: string, message?: string): IssueResult => {
  const [status, m] = MESSAGES[error] ?? [500, "Something went wrong. Try again."];
  return { ok: false, status, error, message: message ?? m };
};

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate and store a learner's certificate. Eligibility, de-duplication and the certificate code come from the
 * database (study_claim_certificate, run with the learner's own session); the PDF is stored privately before the
 * service role marks it issued, so success is only reported for a saved file. Safe to retry.
 */
export async function issueCertificate(
  supabase: SupabaseClient, courseCode: string, name: unknown, confirm: unknown,
  deps: { bucket?: CertificateBucket | null; service?: Pick<SupabaseClient, "rpc"> } = {},
): Promise<IssueResult> {
  const assets = await certificateAssets();
  const check = validateCertificateName(name, confirm, assets.fonts.serifSemiBold as Uint8Array);
  if (!check.ok) return fail("invalid_name", check.error);

  const bucket = deps.bucket !== undefined ? deps.bucket : await certificateBucket();
  if (!bucket) return fail("storage_unavailable");

  const { data: claim, error } = await supabase.rpc("study_claim_certificate", { p_course_code: courseCode, p_name: check.value });
  if (error || !claim) return fail("save_failed");
  if (!claim.ok) return fail(claim.error);
  if (claim.state === "issued") return { ok: true, certificate_code: claim.certificate.certificate_code, already: true };

  const c = claim.certificate as Claimed;
  const service = deps.service ?? getServiceClient();
  const release = () => service.rpc("service_release_study_certificate_claim", { p_certificate: c.id, p_claim_token: claim.claim_token });
  let pdf: Uint8Array;
  try {
    pdf = await renderCertificatePdf({
      name: c.name_on_certificate, certificateNo: c.certificate_code, completionDateISO: c.completed_at,
      issuedAtISO: c.completed_at, courseTitle: c.certificate_title, courseShortTitle: c.short_title,
      totalHours: Number(c.hours), categories: c.categories, mode: c.wording, issuer: c.issuer,
      instructorName: c.signatory_name, instructorTitle: c.signatory_title, siteLabel: "iparkar.com", timeZone: "UTC",
    }, assets);
  } catch {
    await release();
    return fail("render_failed");
  }
  const key = `${CERT_PREFIX}${c.user_id}/${c.certificate_code}.pdf`;
  const sha = await sha256Hex(pdf);
  try {
    await bucket.put(key, pdf, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { certificate: c.certificate_code }, sha256: sha });
  } catch {
    await release();
    return fail("save_failed");
  }
  const { data: fin, error: finErr } = await service.rpc("service_finalize_study_certificate", {
    p_certificate: c.id, p_claim_token: claim.claim_token, p_storage_key: key, p_sha256: sha, p_bytes: pdf.byteLength,
  });
  if (finErr || !fin?.ok) {
    if (!fin || fin.error !== "claim_lost") await release();
    return fail("save_failed");
  }
  return { ok: true, certificate_code: c.certificate_code, already: false };
}
