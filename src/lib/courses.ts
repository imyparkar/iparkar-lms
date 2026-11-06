/**
 * Per-course presentation settings. Business rules stay in the database;
 * this only changes wording and which exam aids are offered.
 */
export type CourseUi = {
  /** Name of the exam as candidates know it, e.g. "GES/EPI". */
  label: string;
  /** What the blueprint calls a scored unit: "domain" (BCSP/CIH) or "topic" (BGC GES/QEP). */
  unit: "domain" | "topic";
};

const COURSES: Record<string, CourseUi> = {
  EPI: { label: "GES/EPI", unit: "topic" },
  QEP: { label: "QEP", unit: "topic" },
};

export function courseUi(code: string): CourseUi {
  return COURSES[code.toUpperCase()] ?? { label: code.toUpperCase(), unit: "domain" };
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
