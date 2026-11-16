import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { SLUG } from "@/lib/scorm/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/scorm/commit — saves SCORM 1.2 run-time data for the signed-in learner.
 * Body (JSON; also accepted as text/plain so navigator.sendBeacon works on page exit):
 *   { course, module, finish?, data: { lesson_status?, lesson_location?, suspend_data?, score_raw?, session_time? } }
 * All validation and the "never go backwards" rules live in scorm_commit (SQL).
 */
const KEYS = ["lesson_status", "lesson_location", "suspend_data", "score_raw", "session_time"] as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.profile.status !== "active") return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 16_000) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const b = body as { course?: unknown; module?: unknown; finish?: unknown; data?: Record<string, unknown> };
  if (typeof b.course !== "string" || typeof b.module !== "string" || !SLUG.test(b.course) || !SLUG.test(b.module) || typeof b.data !== "object" || !b.data) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const data: Record<string, string> = {};
  for (const k of KEYS) {
    const v = b.data[k];
    if (typeof v === "string") data[k] = v;
  }

  const { data: res, error } = await session.supabase.rpc("scorm_commit", {
    p_course: b.course, p_module: b.module, p_data: data, p_finish: b.finish === true,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
  return NextResponse.json(res);
}
