/** Session times are shown in the cohort's time zone, with the zone named, so learners in other countries can convert. */
export function sessionWhen(startIso: string | null, endIso: string | null, timeZone = "Asia/Kuwait"): string {
  if (!startIso) return "Date to be confirmed";
  const d = new Date(startIso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
  const t = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${day}, ${t(startIso)}${endIso ? `–${t(endIso)}` : ""} ${zone}`;
}

export const hoursMinutes = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
};
