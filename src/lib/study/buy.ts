import { checkoutUrl } from "@/lib/env";
import { courseSlug } from "@/lib/study/types";
import { isOnSale } from "@/lib/payments/catalogue";
import { isLiveCourse } from "@/lib/live/types";

const SUPPORT = "support@iparkar.com";

/**
 * Where the learner goes to get paid access: the app's Razorpay buy page when Razorpay keys
 * are set; otherwise the checkout page when
 * NEXT_PUBLIC_CHECKOUT_URL_<CODE> is set, otherwise an access request email to support
 * (subject and body identify the course and the account, so support can grant access).
 */
export function studyBuyUrl(code: string, user: { id: string; email?: string | null }): string {
  // Razorpay checkout lives on the app's own buy page.
  if (razorpayReady() && isOnSale(code, 365)) return `/learn/${courseSlug(code)}/buy`;
  const url = checkoutUrl(code);
  if (url) {
    return url.replace("{user_id}", encodeURIComponent(user.id)).replace("{email}", encodeURIComponent(user.email ?? ""))
      .replace("{days}", "");
  }
  return requestAccessUrl(code, user);
}

export function requestAccessUrl(code: string, user: { id: string; email?: string | null }): string {
  const what = isLiveCourse(code) ? "Basic Principles in Occupational Hygiene (live online course)" : `${code} Self Paced Study Course`;
  const subject = isLiveCourse(code) ? `Request for a place: ${what}` : `Request for Access: ${what}`;
  const body = [
    "Hello iParkar Learning,",
    "",
    isLiveCourse(code) ? `I would like a place on the next cohort of ${what}. Please send me the dates, fee and how to pay.` : `I would like 12 months of access to the ${what}.`,
    "",
    `Account email: ${user.email ?? ""}`,
    `Account reference: ${user.id}`,
  ].join("\n");
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const isAccessRequest = (href: string) => href.startsWith("mailto:");

/** True when Razorpay keys are configured (server-side env). */
export function razorpayReady(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
