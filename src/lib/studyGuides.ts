/**
 * Exam study guides. Each guide's PDF is part of its Self Paced Study Course: it can be
 * downloaded only while the learner has access to that course (free trial or purchase). PDFs live in the private R2 bucket `iparkar-study-guides`.
 * The newest PDF whose name contains the guide code (e.g. "CSP") is served, so a revised guide
 * only needs uploading in the Cloudflare dashboard — any filename, any folder.
 */
export type StudyGuide = {
  code: string;
  title: string;
  edition?: string;
  summary?: string;
  stats?: [string, string][];
  file?: { downloadName: string; label: string };
  /** Study course whose access unlocks the PDF, e.g. "ASP-SPS". */
  studyCourse?: string;
};

export const STUDY_GUIDES: StudyGuide[] = [
  {
    code: "CSP",
    title: "CSP® Exam Study Guide",
    edition: "Reader edition · BCSP CSP11 blueprint",
    summary:
      "Our main study material for the CSP exam. Work each domain chapter by chapter: an opening scenario, core teaching and figures, a worked application, then practice questions with answer explanations. Back matter includes a formula register, glossary and blueprint-to-chapter index.",
    stats: [["47", "blueprint objectives"], ["60", "chapters · 7 domains"], ["1,203", "pages"]],
    file: { downloadName: "iParkar-CSP-Exam-Study-Guide.pdf", label: "PDF · 1,203 pages · 23 MB" },
    studyCourse: "CSP-SPS",
  },
  {
    code: "ASP",
    title: "ASP® Exam Study Guide",
    edition: "Edition 1.0 · BCSP ASP11 blueprint",
    summary:
      "Our main study material for the ASP exam. Each chapter opens with a workplace scenario, teaches the topic with original figures and equation boxes, then works the calculations step by step before Try it questions with worked solutions. Front matter includes a study plan, guide outline and blueprint-to-chapter index; each part ends with a formula sheet; the back matter holds the glossary and full bibliography.",
    stats: [["84", "blueprint objectives"], ["99", "chapters · 9 domains"], ["1,301", "pages"]],
    file: { downloadName: "iParkar-ASP-Exam-Study-Guide.pdf", label: "PDF · 1,301 pages · 24 MB" },
    studyCourse: "ASP-SPS",
  },
  { code: "CIH", title: "CIH® Exam Study Guide" },
  { code: "CFPS", title: "CFPS® Exam Study Guide" },
  { code: "QEP", title: "QEP® Exam Study Guide" },
];

export function findGuide(code: string | null | undefined) {
  return STUDY_GUIDES.find((g) => g.code === code?.toUpperCase() && g.file);
}

/** The downloadable guide that comes with a study course, if any. */
export function guideForStudyCourse(studyCode: string) {
  return STUDY_GUIDES.find((g) => g.file && g.studyCourse === studyCode.toUpperCase());
}

/** Study-course codes the signed-in learner can currently use (trial, purchase or admin grant). */
export async function studyAccessCodes(supabase: { rpc: (fn: string) => PromiseLike<{ data: unknown }> }): Promise<Set<string>> {
  const { data } = await supabase.rpc("get_my_study_courses");
  const rows = (Array.isArray(data) ? data : []) as { code: string; access?: { has_access?: boolean } }[];
  return new Set(rows.filter((r) => r.access?.has_access).map((r) => r.code.toUpperCase()));
}

export function canDownload(guide: StudyGuide, access: Set<string>, isAdmin: boolean) {
  return isAdmin || (!!guide.studyCourse && access.has(guide.studyCourse));
}
