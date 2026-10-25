/** Public env (safe in the browser). Server-only secrets live in server-env.ts. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://iparkar.com";
/** Cloudflare Turnstile site key (public). Empty = CAPTCHA widget not shown. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function checkoutUrl(courseCode: string): string | null {
  const map: Record<string, string | undefined> = {
    ASP: process.env.NEXT_PUBLIC_CHECKOUT_URL_ASP,
    CSP: process.env.NEXT_PUBLIC_CHECKOUT_URL_CSP,
    CIH: process.env.NEXT_PUBLIC_CHECKOUT_URL_CIH,
  };
  return map[courseCode] || null;
}
