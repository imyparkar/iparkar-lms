export const ACCESS_PLANS = [
  { days: 90, amount: "9900", name: "Exam Ready", badge: "Focused prep" },
  { days: 180, amount: "14900", name: "Extended Prep", badge: "Recommended" },
  { days: 365, amount: "19900", name: "Full-Year Prep", badge: "Best value" },
] as const;
export type AccessDays = (typeof ACCESS_PLANS)[number]["days"];
export function accessPlan(days: unknown) {
  return ACCESS_PLANS.find(plan => plan.days === days);
}
