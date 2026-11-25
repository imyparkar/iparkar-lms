import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { certificateBucket } from "@/lib/certificates/issue";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/briefs/<course>/<P1…> — a practical's learner brief (HTML), for enrolled learners with access.
 * Briefs are course content, kept in the private bucket (lms-assets/live/<course>/briefs/<code>.html), not in this
 * public repository. Model answers are never stored there. A bar is added at the top of the page with a link back to the
 * course page, where the work is submitted.
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
  const html = await new Response(obj.body).text();
  const P = code.toUpperCase();
  const bar = `<div style="position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;`
    + `padding:10px 16px;background:#fff;border-bottom:1px solid rgba(0,0,0,.12);font:500 15px/1.4 Inter,system-ui,sans-serif;color:#000">`
    + `<a href="/live/${course}#prac" style="color:#0a5ad4;text-decoration:none;font-weight:600">&larr; Back to the course</a>`
    + `<span style="color:#615d59">Work through this brief, then submit your answer on the course page under ${P} &rarr; <strong style="color:#000">Submit your work</strong>.</span></div>`;
  const page = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + bar) : bar + html;
  return new NextResponse(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    },
  });
}
