import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { certificateBucket } from "@/lib/certificates/issue";

export const dynamic = "force-dynamic";

/** GET /api/live/submissions/<id> — the submitted file, to its submitter or an administrator only; always as a download. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  const { data } = await session.supabase.rpc("live_submission_file", { p_submission: id });
  if (!data?.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bucket = await certificateBucket();
  const obj = bucket ? await bucket.get(data.file_key) : null;
  if (!obj) return NextResponse.json({ error: "The file is temporarily unavailable." }, { status: 503 });
  return new NextResponse(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(obj.size),
      "content-disposition": `attachment; filename="${String(data.file_name).replace(/["\\\r\n]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
