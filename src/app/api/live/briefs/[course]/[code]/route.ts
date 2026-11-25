import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { certificateBucket } from "@/lib/certificates/issue";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/briefs/<course>/<P1…> — a practical's learner brief (HTML), for enrolled learners with access.
 * Briefs are course content, kept in the private bucket (lms-assets/live/<course>/briefs/<code>.html), not in this
 * public repository. Model answers are never stored there.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string; code: string }> }) {
  const { course, code } = await params;
  if (!/^[a-z]{2,8}$/.test(course) || !/^P[0-9]{1,2}$/i.test(code)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/live/${course}`)}`, req.nextUrl.origin));
  const { data } = await session.supabase.rpc("live_course_dashboard", { p_course_code: course.toUpperCase() });
  if (!data?.ok || !data.access?.has_access) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bucket = await certificateBucket();
  const obj = bucket ? await bucket.get(`lms-assets/live/${course}/briefs/${code.toUpperCase()}.html`) : null;
  if (!obj) return NextResponse.json({ error: "This brief isn't available yet." }, { status: 404 });
  return new NextResponse(obj.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox allow-same-origin allow-popups allow-modals; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    },
  });
}
