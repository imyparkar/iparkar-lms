import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/admin";
import { findGuide } from "@/lib/studyGuides";

export const dynamic = "force-dynamic";

/**
 * Signed-in download of a study guide. Verifies the session, logs the download,
 * then redirects to a 60-second signed URL that forces a file download.
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

  const svc = getServiceClient();
  const bucket = svc.storage.from("study-guides");
  // Serve the most recently uploaded PDF in the guide's folder, so a revised guide
  // only needs uploading — no code change or exact filename required.
  const { data: files } = await bucket.list(guide.file.folder, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
  const latest = files?.find((f) => f.id && f.name.toLowerCase().endsWith(".pdf"));
  if (!latest) return NextResponse.redirect(new URL(`/study-guides?error=unavailable`, origin));
  const { data, error } = await bucket.createSignedUrl(`${guide.file.folder}/${latest.name}`, 60, { download: guide.file.downloadName });
  if (error || !data?.signedUrl) {
    return NextResponse.redirect(new URL(`/study-guides?error=unavailable`, origin));
  }
  await svc.from("study_guide_downloads").insert({ user_id: session.user.id, guide: guide.code });

  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
