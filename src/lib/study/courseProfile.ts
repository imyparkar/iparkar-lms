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
  /** Body that owns the examination mark, e.g. "the Board of Certified Safety Professionals (BCSP)". */
  markOwner: string;
  /** Short name of that body, used in "X does not issue this record". */
  markOwnerShort: string;
  /** Where learners check exam policies, e.g. "bcsp.org". */
  policySite: string;
  /** What a top-level group is called: "Domain" (exam domains) or "Module" (course modules). */
  unit: "Domain" | "Module";
  /** Caption for a group's weight, e.g. "12% of the exam" or "4 hours". */
  weightLabel: (weight: number | string | null) => string;
  /** Lead under the group list on the course page. */
  weightsLead: (statedBlueprint: string | null | undefined) => string;
  /** Prefix for a chapter's objective codes on the domain page, e.g. "Objective" or "ECO tasks". */
  objectiveLabel: string;
  /** True when learners can generate an iParkar Learning certificate of course completion (PDF). */
  certificate?: boolean;
  /** False when the course has no glossary resource, so the player hides its Glossary link. Defaults to true. */
  glossary?: boolean;
};

const BCSP = {
  markOwner: "the Board of Certified Safety Professionals (BCSP)",
  markOwnerShort: "BCSP",
  policySite: "bcsp.org",
  unit: "Domain" as const,
  weightLabel: (w: number | string | null) => `${Number(w)}% of the exam`,
  weightsLead: (b: string | null | undefined) => `Weights are the exam distribution the guide states for blueprint ${b ?? ""}. Every chapter counts equally towards completion.`,
  objectiveLabel: "Objective",
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
    ...BCSP,
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
    ...BCSP,
  },
  "PMP-SPS": {
    code: "PMP-SPS",
    examMark: "PMP®",
    blueprint: "ECO",
    guideName: "original iParkar Learning lessons referencing the PMBOK® Guide, 8th edition",
    overview: () =>
      "Thirty-five hours of self-paced study in nine modules and fifty-two chapters, mapped to every task in the PMP® Examination Content Outline (July 2026). Each chapter teaches one topic, works an example from a different industry across predictive, adaptive and hybrid delivery, asks you to apply it, recaps, and ends with a knowledge check. Study in any order; we recommend starting with module 1.",
    practiceNote: "Knowledge-check questions are original to this course and are not PMI examination items.",
    separateFrom: "PMI's own courses and examination",
    betaSource: "the iParkar Learning PMP® Exam Prep Course",
    startHint: "Start with chapter 1.1, or open any module: chapters can be studied in any order.",
    markOwner: "the Project Management Institute, Inc. (PMI)",
    markOwnerShort: "PMI",
    policySite: "pmi.org",
    glossary: false,
    unit: "Module",
    weightLabel: (w) => `${Number(w)} hour${Number(w) === 1 ? "" : "s"}`,
    weightsLead: () =>
      "Module hours are the course's 35-hour learning budget (Business Acumen 8 h, Ways of Working 19 h, Power Skills 8 h), including reading, examples, activities and knowledge checks. Every chapter counts equally towards completion.",
    objectiveLabel: "ECO",
    certificate: true,
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
  markOwner: "the certification body named in this course",
  markOwnerShort: "The certification body",
  policySite: "the certification body's website",
  unit: "Domain",
  weightLabel: (w) => `${Number(w)}% of the exam`,
  weightsLead: () => "Every chapter counts equally towards completion.",
  objectiveLabel: "Objective",
};

export function courseProfile(codeOrSlug: string | null | undefined): StudyCourseProfile {
  const key = (codeOrSlug ?? "").toUpperCase();
  return PROFILES[key] ?? NEUTRAL;
}

/** Independence statement for a course, never implying review or endorsement by the mark owner. */
export function independenceStatement(p: StudyCourseProfile) {
  return p.examMark
    ? `${p.examMark} is a registered mark of ${p.markOwner}, which has not reviewed or endorsed this course.`
    : "The certification body named in this course has not reviewed or endorsed it.";
}
