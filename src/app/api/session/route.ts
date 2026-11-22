import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";

/**
 * GET /api/session — tells iparkar.com whether this browser has a valid learner session,
 * so the public site can show "Dashboard" instead of "Sign in".
 *
 * The answer is a single boolean. No token, user id, name or email is returned, and the
 * session cookie stays on app.iparkar.com (it is sent because iparkar.com and app.iparkar.com
 * are the same site). The session is verified with Supabase Auth on every request, exactly as
 * the dashboard does; an expired, signed-out or suspended account answers false.
 *
 * Only the public site's origins may read the answer (CORS with credentials). Extra origins for
 * a staging or preview site can be added with PUBLIC_SITE_ORIGINS (comma-separated).
 */
const BASE_ORIGINS = ["https://iparkar.com", "https://www.iparkar.com"];

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const extra = (process.env.PUBLIC_SITE_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...BASE_ORIGINS, ...extra].includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Cache-Control": "private, no-store", Vary: "Origin, Cookie" };
  const ok = allowedOrigin(origin);
  if (ok) {
    h["Access-Control-Allow-Origin"] = ok;
    h["Access-Control-Allow-Credentials"] = "true";
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function GET(request: NextRequest) {
  let signedIn = false;
  try {
    const s = await getSession();
    signedIn = !!s && s.profile.status === "active";
  } catch {
    signedIn = false;
  }
  return NextResponse.json({ signedIn }, { headers: corsHeaders(request.headers.get("origin")) });
}
