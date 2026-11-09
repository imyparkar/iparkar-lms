/** Free study guides for signed-in users. PDFs live in the private `study-guides` storage bucket. */
export type StudyGuide = {
  code: string;
  title: string;
  edition?: string;
  summary?: string;
  stats?: [string, string][];
  /** folder = storage folder in the `study-guides` bucket; the newest PDF in it is served. */
  file?: { folder: string; downloadName: string; label: string };
};

export const STUDY_GUIDES: StudyGuide[] = [
  {
    code: "CSP",
    title: "CSP® Exam Study Guide",
    edition: "Reader edition · BCSP CSP11 blueprint",
    summary:
      "Our main study material for the CSP exam. Work each domain chapter by chapter: an opening scenario, core teaching and figures, a worked application, then practice questions with answer explanations. Back matter includes a formula register, glossary and blueprint-to-chapter index.",
    stats: [["47", "blueprint objectives"], ["60", "chapters · 7 domains"], ["1,203", "pages"]],
    file: { folder: "csp", downloadName: "iParkar-CSP-Exam-Study-Guide.pdf", label: "PDF · 1,203 pages · 23 MB" },
  },
  { code: "ASP", title: "ASP® Exam Study Guide" },
  { code: "CIH", title: "CIH® Exam Study Guide" },
  { code: "CFPS", title: "CFPS® Exam Study Guide" },
  { code: "QEP", title: "QEP® Exam Study Guide" },
];

export function findGuide(code: string | null | undefined) {
  return STUDY_GUIDES.find((g) => g.code === code?.toUpperCase() && g.file);
}
