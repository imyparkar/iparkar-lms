import { checkoutUrl } from "@/lib/env";

/** Checkout link for a study course, or null when no checkout page is configured yet. */
export function studyBuyUrl(code: string, user: { id: string; email?: string | null }): string | null {
  const url = checkoutUrl(code);
  if (!url) return null;
  return url.replace("{user_id}", encodeURIComponent(user.id)).replace("{email}", encodeURIComponent(user.email ?? ""))
    .replace("{days}", "");
}
