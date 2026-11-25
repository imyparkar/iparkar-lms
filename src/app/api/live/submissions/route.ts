import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { certificateBucket } from "@/lib/certificates/issue";
import { PRACTICAL_ERRORS } from "@/lib/live/types";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
};
// Leading bytes of each accepted format: the extension and the declared type are not trusted on their own.
const MAGIC: Record<string, number[]> = { pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b, 0x03, 0x04], xlsx: [0x50, 0x4b, 0x03, 0x04], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff] };

const fail = (status: number, error: string, message?: string) =>
  NextResponse.json({ ok: false, error, message: message ?? PRACTICAL_ERRORS[error] ?? "Your submission couldn't be saved. Try again." }, { status });

/**
 * POST /api/live/submissions (multipart: course, practical, route, response, file?)
 * The database decides whether this learner may submit this practical now; the file is stored privately in R2 under
 * live-submissions/<user id>/… and only then is the submission recorded.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  let host: string | null = null;
  try { host = origin ? new URL(origin).host : null; } catch { host = "invalid"; }
  if (host && host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return fail(403, "forbidden", "Request refused.");
  const session = await getSession();
  if (!session || session.profile.status !== "active") return fail(401, "not_signed_in", "Your session has ended. Sign in again.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return fail(413, "too_large", "The file is larger than 10 MB.");

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(400, "bad_request", "The upload couldn't be read. Try again."); }
  const course = String(form.get("course") ?? "").toUpperCase();
  const practical = String(form.get("practical") ?? "").toUpperCase();
  const route = String(form.get("route") ?? "session");
  const response = String(form.get("response") ?? "").slice(0, 20000);
  const file = form.get("file");
  if (!/^[A-Z]{2,8}$/.test(course) || !/^P[0-9]{1,2}$/.test(practical)) return fail(400, "bad_request", "Something was missing. Refresh the page and try again.");

  const { data: can } = await session.supabase.rpc("live_practical_can_submit", { p_course_code: course, p_code: practical });
  if (!can?.ok) return fail(403, can?.error ?? "not_found");

  let key: string | null = null, name: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return fail(413, "too_large", "The file is larger than 10 MB.");
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const magic = MAGIC[ext];
    if (!TYPES[ext] || !magic || !magic.every((b, i) => bytes[i] === b)) {
      return fail(415, "bad_file", "Attach a PDF, Word (.docx), Excel (.xlsx), PNG or JPG file.");
    }
    const bucket = await certificateBucket();
    if (!bucket) return fail(503, "storage_unavailable", "File uploads aren't available just now. Paste your answer instead, or try again later.");
    key = `live-submissions/${session.user.id}/${practical}/${crypto.randomUUID()}.${ext}`;
    name = file.name.replace(/[^\w .()-]/g, "_").slice(0, 120) || `${practical}.${ext}`;
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: TYPES[ext][0] }, customMetadata: { user: session.user.id, practical } });
    } catch {
      return fail(503, "save_failed", "We couldn't save your file just now. Nothing was submitted. Try again in a minute.");
    }
  }
  const { data, error } = await session.supabase.rpc("live_submit_practical", {
    p_course_code: course, p_code: practical, p_response: response, p_file_key: key, p_file_name: name, p_route: route,
  });
  if (error || !data?.ok) return fail(400, data?.error ?? "save_failed");
  return NextResponse.json({ ok: true, id: data.id, attempt_no: data.attempt_no }, { headers: { "cache-control": "no-store" } });
}
