import { type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/lib/auth/session";
import { SLUG } from "@/lib/scorm/types";

export const dynamic = "force-dynamic";

/**
 * SCORM package files: GET /api/scorm/content/<course>/<module>/<path>
 *
 * The database decides who may open them (scorm_can_view: active signed-in learners
 * for published courses, admins for any). Files live in the private R2 bucket under
 * lms-assets/scorm/<course>/<module>/ (upload: scripts/upload-scorm.sh) and have no
 * public URL. This path may be framed by the app itself only (see next.config.ts).
 *
 * Local preview (`next dev`, empty simulated R2): files are read from
 * imports/scorm/<course>/<module>/, or SCORM_ASSETS_DIR when set.
 */
const PREFIX = "lms-assets/scorm/";
const FILE = /^[A-Za-z0-9._-]+$/;
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", xml: "application/xml", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  woff: "font/woff", woff2: "font/woff2", mp3: "audio/mpeg", mp4: "video/mp4", vtt: "text/vtt", txt: "text/plain; charset=utf-8",
};

type R2Bucket = { get(key: string): Promise<{ body: ReadableStream; size: number; httpEtag?: string } | null> };
const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ course: string; module: string; path: string[] }> }) {
  const { course, module, path } = await params;
  if (!SLUG.test(course) || !SLUG.test(module) || !path?.length || path.length > 8) return deny(404);
  if (!path.every((p) => FILE.test(p) && p !== "." && p !== "..")) return deny(404);
  const rel = path.join("/");
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) return deny(404);

  const session = await getSession();
  if (!session || session.profile.status !== "active") return deny(401);
  const { data: allowed } = await session.supabase.rpc("scorm_can_view", { p_course: course, p_module: module });
  if (allowed !== true) return deny(403);

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": ext === "html" ? "private, no-cache" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  let bucket: R2Bucket | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    bucket = (env as unknown as { STUDY_GUIDES?: R2Bucket }).STUDY_GUIDES;
  } catch {
    bucket = undefined;
  }
  if (bucket) {
    const obj = await bucket.get(`${PREFIX}${course}/${module}/${rel}`);
    if (obj) return new Response(obj.body, { headers: { ...headers, "Content-Length": String(obj.size) } });
  }

  if (process.env.NODE_ENV !== "production" || process.env.SCORM_ASSETS_DIR) {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const root = process.env.SCORM_ASSETS_DIR ?? join(process.cwd(), "imports", "scorm");
      const buf = await readFile(join(root, course, module, ...path));
      return new Response(new Uint8Array(buf), { headers });
    } catch {
      return deny(404);
    }
  }
  return deny(404);
}
