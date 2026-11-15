/**
 * Per-course wording for the self-paced study engine. The engine, database and
 * completion rules are shared; only the examination name, blueprint label and
 * source description differ between courses. Unknown courses fall back to
 * neutral wording rather than another course's.
 */
export type StudyCourseProfile = {
  /** Study course code, e.g. "CSP-SPS". */
  code: string;
  /** Examination mark used in independence statements, e.g. "CSP®". */
  examMark: string;
  /** Blueprint label shown beside chapter objectives, e.g. "CSP11". */
  blueprint: string;
  /** How the source guide is named in provenance notes. */
  guideName: string;
  /** One-paragraph overview on the course page. */
  overview: (sourceTitle: string | null | undefined, sourceEdition: string | null | undefined) => string;
  /** Short note on what practice questions are. */
  practiceNote: string;
  /** Practice-exam products this course must be distinguished from. */
  separateFrom: string;
  /** Beta banner wording. */
  betaSource: string;
  /** Where a new learner should start (My learning). */
  startHint: string;
  /** Extra lead on the Domain 1 page, if any. */
  domainOneLead?: string;
};

const PROFILES: Record<string, StudyCourseProfile> = {
  "ASP-SPS": {
    code: "ASP-SPS",
    examMark: "ASP®",
    blueprint: "ASP11",
    guideName: "the iParkar ASP Exam Study Guide, Edition 1.0",
    overview: (t, e) =>
      `Ninety-nine chapters across the nine ASP11 domains, taught from the ${t ?? "study guide"} (Edition ${e ?? "1.0"}). Work through them in any order; we recommend the guide's order, starting with chapters 1.1 and 1.2.`,
    practiceNote: "Practice questions are original to this course and are not examination items.",
    separateFrom: "the ASP practice exams",
    betaSource: "the iParkar ASP Exam Study Guide",
    startHint: "Start with chapters 1.1 and 1.2; every calculation chapter relies on them.",
    domainOneLead: "Start with chapters 1.1 and 1.2. Every later calculation chapter assumes the unit habits and maths tools they teach.",
  },
  "CSP-SPS": {
    code: "CSP-SPS",
    examMark: "CSP®",
    blueprint: "CSP11",
    guideName: "the iParkar CSP Exam Study Guide, Reader edition (9 November 2026)",
    overview: (t) =>
      `Sixty chapters across the seven CSP11 domains, taught from the ${t ?? "iParkar CSP Exam Study Guide"}. Each chapter opens with a workplace decision, teaches the topic in short sections, works an application step by step and closes with CSP-style practice. Study the domains in any order; we recommend the guide's order, starting with chapter 1.1.`,
    practiceNote:
      "Practice questions are original CSP-style items written for the guide. They are not examination items, and your answers are formative practice, not a predicted score.",
    separateFrom: "the CSP practice exams",
    betaSource: "the iParkar CSP Exam Study Guide",
    startHint: "Start with chapter 1.1, or open any domain: chapters can be studied in any order.",
  },
};

const NEUTRAL: StudyCourseProfile = {
  code: "",
  examMark: "",
  blueprint: "Blueprint",
  guideName: "the course study guide",
  overview: (t) => `Chapters taught from the ${t ?? "course study guide"}. Work through them in any order; we recommend the guide's order.`,
  practiceNote: "Practice questions are study material, not examination items.",
  separateFrom: "iParkar's practice exams",
  betaSource: "the course study guide",
  startHint: "Start with the first chapter, or open any domain.",
};

export function courseProfile(codeOrSlug: string | null | undefined): StudyCourseProfile {
  const key = (codeOrSlug ?? "").toUpperCase();
  return PROFILES[key] ?? NEUTRAL;
}

/** Independence statement for a course, never implying BCSP review or endorsement. */
export function independenceStatement(p: StudyCourseProfile) {
  return p.examMark
    ? `${p.examMark} is a registered mark of the Board of Certified Safety Professionals (BCSP), which has not reviewed or endorsed this course.`
    : "The certification body named in this course has not reviewed or endorsed it.";
}
