import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Public certificate verification, used by the iparkar.com/verify page (the QR code on every certificate points
 * there). Returns only what is printed on the certificate. No sign-in; CORS is limited to the iParkar sites.
 */
const ORIGINS = new Set(["https://iparkar.com", "https://www.iparkar.com"]);
const CODE = /^IPL-[A-Z]{2,8}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin");
  return o && ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Vary": "Origin" } : { "Vary": "Origin" };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: { ...cors(req), "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).trim().toUpperCase();
  const headers = { ...cors(req), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (!CODE.test(code)) return NextResponse.json({ found: false }, { headers });
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("study_verify_certificate", { p_code: code });
  if (error || !data?.ok) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  const body = { ...(data as Record<string, unknown>) };
  delete body.ok;
  return NextResponse.json(body, { headers });
}
