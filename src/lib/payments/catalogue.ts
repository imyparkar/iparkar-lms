/**
 * Prices charged at checkout: practice-exam packages and Self Paced Study Courses.
 *
 * The server always decides the price: the browser only says which course and
 * access period. Prices MUST match what iparkar.com shows — keep this file in
 * step with `site-config.js` (US$ prices, which periods are on sale) and
 * `regional-prices.js` (country prices) in the iparkar-site repo.
 */

export type Money = { amount: number; currency: string; minor: number };

/** US$ prices per access period. */
const USD = {
  exam: { 90: 99, 180: 149, 365: 199 },
  cit: { 90: 49, 180: 79, 365: 99 },
  sps: { 90: 0, 180: 0, 365: 120 },
} as const;

/** Periods sold online (must match `available` in site-config.js). */
const ON_SALE: Record<string, readonly number[]> = {
  ASP: [90, 180, 365],
  CSP: [90, 180, 365],
  CIH: [90, 180, 365],
  EPI: [90, 180, 365],
  QEP: [90, 180, 365],
  CIT: [90, 180, 365],
  // PMP® practice exams: same exam tier and periods as ASP/CSP.
  PMP: [90, 180, 365],
  // Self Paced Study Courses: 365 days (build.mjs on iparkar.com).
  "ASP-SPS": [365],
  "CSP-SPS": [365],
  // PMP® Exam Prep Course (35-hour self-paced, certificate of course completion): own prices in COURSE_PRICES.
  "PMP-SPS": [365],
};

type Region = { currency: string; countries: string[]; exam: [number, number, number]; cit: [number, number, number]; sps: number };

/** Mirrors regional-prices.js: [90-day, 180-day, 365-day]. Other countries pay US$. */
const REGIONS: Region[] = [
  { currency: "INR", countries: ["IN"], exam: [7999, 12999, 16999], cit: [3999, 6999, 7999], sps: 9999 },
  { currency: "KWD", countries: ["KW"], exam: [30, 45, 60], cit: [15, 25, 30], sps: 35 },
  { currency: "AED", countries: ["AE"], exam: [365, 550, 730], cit: [180, 290, 365], sps: 440 },
  { currency: "SAR", countries: ["SA"], exam: [375, 560, 750], cit: [185, 300, 375], sps: 450 },
  { currency: "QAR", countries: ["QA"], exam: [360, 545, 725], cit: [180, 290, 360], sps: 440 },
  { currency: "BHD", countries: ["BH"], exam: [35, 55, 75], cit: [20, 30, 35], sps: 45 },
  { currency: "OMR", countries: ["OM"], exam: [40, 55, 75], cit: [20, 30, 40], sps: 45 },
  { currency: "GBP", countries: ["GB"], exam: [75, 112, 149], cit: [37, 59, 75], sps: 90 },
  { currency: "EUR", countries: ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"],
    exam: [85, 129, 169], cit: [42, 68, 85], sps: 105 },
];

/**
 * Course-specific 365-day prices that replace the shared SPS tier (owner, 21 Nov 2026).
 * Countries without an entry here pay the course's USD price, even where the shared table has a region
 * (for example Bahrain for PMP-SPS).
 */
const COURSE_PRICES: Record<string, { USD: number; byCurrency: Record<string, number> }> = {
  "PMP-SPS": { USD: 299, byCurrency: { KWD: 99, GBP: 240, EUR: 290, AED: 1150, SAR: 1200, QAR: 1160, OMR: 120, INR: 25000 } },
};

/** Decimal places Razorpay expects for each currency (amounts are sent in the smallest unit). */
const EXPONENT: Record<string, number> = { KWD: 3, BHD: 3, OMR: 3 };
export function exponent(currency: string): number {
  return EXPONENT[currency] ?? 2;
}

const PERIOD_INDEX: Record<number, 0 | 1 | 2> = { 90: 0, 180: 1, 365: 2 };

export function periodsOnSale(courseCode: string): readonly number[] {
  return ON_SALE[courseCode.toUpperCase()] ?? [];
}

export function isOnSale(courseCode: string, days: number): boolean {
  return periodsOnSale(courseCode).includes(days);
}

/** Price for a course and period in the buyer's country, or null if it isn't sold online. */
export function priceFor(courseCode: string, days: number, country: string | null | undefined): Money | null {
  const code = courseCode.toUpperCase();
  if (!isOnSale(code, days)) return null;
  const cc = (country ?? "").toUpperCase();
  const region = REGIONS.find((r) => r.countries.includes(cc));
  const own = COURSE_PRICES[code];
  if (own) {
    const local = region ? own.byCurrency[region.currency] : undefined;
    const currency = local !== undefined ? region!.currency : "USD";
    const amount = local ?? own.USD;
    return { amount, currency, minor: Math.round(amount * 10 ** exponent(currency)) };
  }
  const tier = code.endsWith("-SPS") ? "sps" : code === "CIT" ? "cit" : "exam";
  const amount = region ? (tier === "sps" ? region.sps : region[tier][PERIOD_INDEX[days]]) : USD[tier][days as 90 | 180 | 365];
  const currency = region ? region.currency : "USD";
  return { amount, currency, minor: Math.round(amount * 10 ** exponent(currency)) };
}

const SYMBOLS: Record<string, string> = { USD: "US$", INR: "₹", GBP: "£", EUR: "€" };

/** "US$99", "₹7,999", "KWD 30" — the same style as iparkar.com. */
export function formatMoney(m: Pick<Money, "amount" | "currency">): string {
  const num = new Intl.NumberFormat(m.currency === "INR" ? "en-IN" : "en", { maximumFractionDigits: 0 }).format(m.amount);
  const sym = SYMBOLS[m.currency];
  return sym ? `${sym}${num}` : `${m.currency} ${num}`;
}

export function periodLabel(days: number): string {
  return days === 365 ? "1 year" : `${days} days`;
}
