import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { certificateBucket } from "@/lib/certificates/issue";

export const dynamic = "force-dynamic";

const CODE = /^IPL-[A-Z]{2,8}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

/**
 * GET /api/certificates/IPL-PMP-XXXX-XXXX — the stored PDF, never a re-render. study_certificate_file only returns
 * the storage key to the certificate's owner (or an admin), so another account gets 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (!CODE.test(code)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/certificates")}`, req.nextUrl.origin));
  const { data } = await session.supabase.rpc("study_certificate_file", { p_code: code });
  if (!data?.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bucket = await certificateBucket();
  const obj = bucket ? await bucket.get(data.storage_key) : null;
  if (!obj) return NextResponse.json({ error: "The certificate file is temporarily unavailable. Try again in a minute." }, { status: 503 });
  return new NextResponse(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(obj.size),
      "content-disposition": `attachment; filename="iParkar-Learning-certificate-${code}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
