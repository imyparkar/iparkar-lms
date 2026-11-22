/**
 * Return destinations after sign-in, sign-up, email links and idle sign-out.
 *
 * Only same-origin paths under the app's own learner routes are accepted. Anything else —
 * another origin, a protocol-relative or backslash path ("//x", "/\x"), control characters,
 * or an unknown route — falls back to the dashboard, so a crafted ?next= can never send a
 * learner off-site after they sign in.
 */
const APPROVED = [
  "/dashboard", "/learn", "/courses", "/free", "/study", "/study-guides", "/certificates",
  "/results", "/exam", "/scorm", "/account", "/admin", "/auth/update-password",
];

export const DEFAULT_NEXT = "/dashboard";

export function safeNext(next: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, "https://app.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://app.invalid") return fallback;
  const path = url.pathname;
  if (!APPROVED.some((p) => path === p || path.startsWith(p + "/"))) return fallback;
  return path + url.search + url.hash;
}
