/**
 * Course-specific wording for the "nordic-a4-landscape-v1" certificate (owner decisions, 27 Nov 2026).
 * Hours, title and signatory come from study_certificate_programs; these lines are presentation only.
 */
const PROVIDER = "Contact hours and CEU are provider-issued by iParkar Learning.";
const STUDY_BODY = "has completed every required chapter of the self-paced online course";

export type CourseText = { bodyLine: string; subtitle?: string; breakdownLabel?: string; breakdownNames?: Record<string, string>; footnote: string };

export const COURSE_TEXT: Record<string, CourseText> = {
  SAT: {
    bodyLine: "has completed all modules and knowledge checks of the self-paced online course",
    subtitle: "Analysis · Design · Development · Implementation · Evaluation",
    footnote: PROVIDER,
  },
  "PMP-SPS": {
    bodyLine: STUDY_BODY,
    subtitle: "35 contact hours of project management education across the PMI Talent Triangle®",
    breakdownLabel: "PMI Talent Triangle®",
    breakdownNames: { businessAcumen: "Business Acumen", waysOfWorking: "Ways of Working", powerSkills: "Power Skills" },
    footnote: `${PROVIDER} PMI, PMP and the PMI Talent Triangle are registered marks of the Project Management Institute, Inc., which does not endorse or issue this certificate.`,
  },
  "ASP-SPS": {
    bodyLine: STUDY_BODY,
    subtitle: "Study course for the BCSP Associate Safety Professional (ASP®) examination",
    footnote: `${PROVIDER} ASP® is a registered mark of the Board of Certified Safety Professionals (BCSP), which does not endorse or issue this certificate.`,
  },
  "CSP-SPS": {
    bodyLine: STUDY_BODY,
    subtitle: "Study course for the BCSP Certified Safety Professional (CSP®) examination",
    footnote: `${PROVIDER} CSP® is a registered mark of the Board of Certified Safety Professionals (BCSP), which does not endorse or issue this certificate.`,
  },
};

export function courseText(code: string): CourseText {
  return COURSE_TEXT[code.toUpperCase()] ?? { bodyLine: STUDY_BODY, footnote: PROVIDER };
}

/** Breakdown rows from the programme's categories (e.g. PMP Talent Triangle hours), in the order given above. */
export function breakdown(code: string, categories: Record<string, number> | null | undefined) {
  const t = courseText(code);
  if (!t.breakdownLabel || !t.breakdownNames || !categories) return undefined;
  const items = Object.entries(t.breakdownNames)
    .filter(([k]) => Number(categories[k]) > 0)
    .map(([k, label]) => [label, Number(categories[k])] as [string, number]);
  return items.length ? { label: t.breakdownLabel, items } : undefined;
}
