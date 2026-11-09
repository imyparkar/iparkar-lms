import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/admin";
import { findGuide } from "@/lib/studyGuides";

export const dynamic = "force-dynamic";

type R2Obj = { key: string; uploaded: Date; size: number };
type R2Bucket = {
  list(o?: { cursor?: string; limit?: number }): Promise<{ objects: R2Obj[]; truncated: boolean; cursor?: string }>;
  get(key: string): Promise<(R2Obj & { body: ReadableStream }) | null>;
};

/** Newest PDF whose key contains the guide code as a word (e.g. "csp/…", "iParkar_CSP_Exam…pdf"). */
async function latestPdf(bucket: R2Bucket, code: string) {
  const word = new RegExp(`(^|[^a-z])${code.toLowerCase()}([^a-z]|$)`);
  let best: R2Obj | null = null;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const o of page.objects) {
      const k = o.key.toLowerCase();
      if (k.endsWith(".pdf") && word.test(k) && (!best || o.uploaded > best.uploaded)) best = o;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return best;
}

/**
 * Signed-in download of a study guide: verifies the session, logs the download,
 * and streams the PDF from the private R2 bucket as an attachment.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const origin = request.nextUrl.origin;
  const guide = findGuide(code);
  if (!guide?.file) return NextResponse.redirect(new URL("/study-guides", origin));

  const session = await getSession();
  if (!session) {
    const next = `/study-guides?download=${guide.code.toLowerCase()}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, origin));
  }
  if (session.profile.status !== "active") return NextResponse.redirect(new URL("/login?error=suspended", origin));

  const unavailable = () => NextResponse.redirect(new URL("/study-guides?error=unavailable", origin));
  let bucket: R2Bucket | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    bucket = (env as unknown as { STUDY_GUIDES?: R2Bucket }).STUDY_GUIDES;
  } catch {
    bucket = undefined;
  }
  if (!bucket) return unavailable();

  const latest = await latestPdf(bucket, guide.code);
  const obj = latest ? await bucket.get(latest.key) : null;
  if (!obj) return unavailable();

  // Best-effort audit log; never blocks the download.
  try {
    await getServiceClient().from("study_guide_downloads").insert({ user_id: session.user.id, guide: guide.code });
  } catch { /* ignore */ }

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(obj.size),
      "Content-Disposition": `attachment; filename="${guide.file.downloadName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
