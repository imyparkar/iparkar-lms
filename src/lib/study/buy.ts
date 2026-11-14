import { checkoutUrl } from "@/lib/env";

const SUPPORT = "support@iparkar.com";

/**
 * Where the learner goes to get paid access: the checkout page when
 * NEXT_PUBLIC_CHECKOUT_URL_<CODE> is set, otherwise an access request email to support
 * (subject and body identify the course and the account, so support can grant access).
 */
export function studyBuyUrl(code: string, user: { id: string; email?: string | null }): string {
  const url = checkoutUrl(code);
  if (url) {
    return url.replace("{user_id}", encodeURIComponent(user.id)).replace("{email}", encodeURIComponent(user.email ?? ""))
      .replace("{days}", "");
  }
  return requestAccessUrl(code, user);
}

export function requestAccessUrl(code: string, user: { id: string; email?: string | null }): string {
  const subject = `Request for Access: ${code} Self Paced Study Course`;
  const body = [
    "Hello iParkar Learning,",
    "",
    `I would like 12 months of access to the ${code} Self Paced Study Course.`,
    "",
    `Account email: ${user.email ?? ""}`,
    `Account reference: ${user.id}`,
  ].join("\n");
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const isAccessRequest = (href: string) => href.startsWith("mailto:");
