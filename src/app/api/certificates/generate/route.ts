import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { issueCertificate } from "@/lib/certificates/issue";

export const dynamic = "force-dynamic";

const COURSE = /^[A-Z]{2,8}(-[A-Z]{2,8})?$/;

/**
 * POST /api/certificates/generate  { course: "PMP-SPS", name, confirm }
 * Re-checks enrollment and completion on the server (study_claim_certificate), renders the A4 landscape PDF,
 * stores it privately and only then reports success. Repeated or concurrent requests return the same certificate.
 */
export async function POST(req: NextRequest) {
  // Same-site requests only (session cookies are SameSite=Lax as well). Compare hosts: behind the Worker proxy
  // req.nextUrl.origin can differ from the browser's origin.
  const origin = req.headers.get("origin");
  let host: string | null = null;
  try { host = origin ? new URL(origin).host : null; } catch { host = "invalid"; }
  if (host && host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 415 });
  const session = await getSession();
  if (!session || session.profile.status !== "active") {
    return NextResponse.json({ ok: false, error: "not_signed_in", message: "Your session has ended. Sign in again, then generate your certificate." }, { status: 401 });
  }
  let b: { course?: unknown; name?: unknown; confirm?: unknown };
  try {
    const text = await req.text();
    if (text.length > 2_000) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
    b = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const course = typeof b.course === "string" ? b.course.toUpperCase() : "";
  if (!COURSE.test(course)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const r = await issueCertificate(session.supabase, course, b.name, b.confirm);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json({ ok: true, certificate_code: r.certificate_code, already_issued: r.already,
    download_url: `/api/certificates/${r.certificate_code}` }, { headers: { "cache-control": "no-store" } });
}
