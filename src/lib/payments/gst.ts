/** GST helpers shared by checkout (browser) and server. Supplier: GSTIN 27ATAPP7789A1ZF, Maharashtra (27). */

/** GST state / UT codes for the place-of-supply picker (matches public.gst_states). */
export const GST_STATES: { code: string; name: string }[] = [
  { code: "35", name: "Andaman and Nicobar Islands" }, { code: "37", name: "Andhra Pradesh" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" }, { code: "10", name: "Bihar" }, { code: "04", name: "Chandigarh" }, { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" }, { code: "07", name: "Delhi" }, { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" }, { code: "06", name: "Haryana" }, { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" }, { code: "20", name: "Jharkhand" }, { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" }, { code: "38", name: "Ladakh" }, { code: "31", name: "Lakshadweep" }, { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" }, { code: "14", name: "Manipur" }, { code: "17", name: "Meghalaya" }, { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" }, { code: "21", name: "Odisha" }, { code: "34", name: "Puducherry" }, { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" }, { code: "11", name: "Sikkim" }, { code: "33", name: "Tamil Nadu" }, { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" }, { code: "09", name: "Uttar Pradesh" }, { code: "05", name: "Uttarakhand" }, { code: "19", name: "West Bengal" },
  { code: "97", name: "Other Territory" },
];
const STATE_CODES = new Set(GST_STATES.map((s) => s.code));
export const isGstState = (code: string) => STATE_CODES.has(code);

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** True for a well-formed GSTIN with a valid state code and check digit. */
export function isValidGstin(raw: string): boolean {
  const g = raw.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  if (!isGstState(g.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

export type BuyerTax = { state?: string; gstin?: string; business?: string };
