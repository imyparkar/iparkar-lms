/** Public env (safe in the browser). Server-only secrets live in server-env.ts. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://iparkar.com";
/** Cloudflare Turnstile site key (public). Empty = CAPTCHA widget not shown. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/**
 * Checkout page for a course. The URL may contain {user_id}, {email} and {days};
 * {days} is the access period the student chose on iparkar.com (90, 180 or 365).
 */
export function checkoutUrl(courseCode: string): string | null {
  const map: Record<string, string | undefined> = {
    ASP: process.env.NEXT_PUBLIC_CHECKOUT_URL_ASP,
    CSP: process.env.NEXT_PUBLIC_CHECKOUT_URL_CSP,
    CIH: process.env.NEXT_PUBLIC_CHECKOUT_URL_CIH,
    EPI: process.env.NEXT_PUBLIC_CHECKOUT_URL_EPI,
    QEP: process.env.NEXT_PUBLIC_CHECKOUT_URL_QEP,
    CIT: process.env.NEXT_PUBLIC_CHECKOUT_URL_CIT,
    // ASP Self Paced Study Course — a separate product from the ASP practice-exam package.
    "ASP-SPS": process.env.NEXT_PUBLIC_CHECKOUT_URL_ASP_SPS,
  };
  return map[courseCode] || null;
}

/** Access periods offered on iparkar.com; anything else in ?plan= is ignored. */
export const ACCESS_PERIODS = [90, 180, 365] as const;
export function accessPeriod(value: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (ACCESS_PERIODS as readonly number[]).includes(n) ? n : null;
}
