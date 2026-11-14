import { type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Protected course drawings: GET /api/study/asset?k=<course-slug>/<file>.webp
 *
 * The database decides (study_can_view_asset): administrators, and learners whose
 * enrollment in that course is active with unexpired access. Files live in the
 * private R2 bucket under ASSET_PREFIX and are never given a public URL.
 * Responses are private and uncacheable by shared caches.
 *
 * Local preview (`next dev`, whose simulated R2 bucket is empty): files are read from
 * imports/<course>/assets, or from STUDY_ASSETS_DIR when set.
 */
const KEY = /^[a-z0-9-]+\/[A-Za-z0-9._-]+\.(webp|png)$/;
const ASSET_PREFIX = "lms-assets/";

type R2Bucket = { get(key: string): Promise<{ body: ReadableStream; size: number; httpEtag?: string } | null> };

const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("k") ?? "";
  if (!KEY.test(key)) return deny(404);

  const session = await getSession();
  if (!session || session.profile.status !== "active") return deny(401);
  const { data: allowed } = await session.supabase.rpc("study_can_view_asset", { p_key: key });
  if (allowed !== true) return deny(403);

  const headers = {
    "Content-Type": key.endsWith(".png") ? "image/png" : "image/webp",
    // Keys carry a content hash, so the browser may keep its private copy for an hour.
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
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
    const obj = await bucket.get(ASSET_PREFIX + key);
    if (obj) return new Response(obj.body, { headers: { ...headers, "Content-Length": String(obj.size) } });
  }

  if (process.env.NODE_ENV !== "production" || process.env.STUDY_ASSETS_DIR) {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const [course, file] = key.split("/");
      const root = process.env.STUDY_ASSETS_DIR ?? join(process.cwd(), "imports", course, "assets");
      const buf = await readFile(join(root, course, file));
      return new Response(new Uint8Array(buf), { headers });
    } catch {
      return deny(404);
    }
  }
  return deny(503);
}
