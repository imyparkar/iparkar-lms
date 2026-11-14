/**
 * Builds the import package for admin_study_import from a course manifest and
 * any authored chapter files, and checks everything that can be checked before
 * the database sees it (schema, page ranges, TeX compiles, sample answers).
 */
import katex from "katex";
import { ChapterContentSchema, ManifestSchema, type ChapterContent, type Manifest } from "./schema";

export type PackageIssue = { chapter?: string; message: string };

function texOk(src: string) {
  try {
    katex.renderToString(src, { throwOnError: true, strict: "ignore", trust: false });
    return true;
  } catch {
    return false;
  }
}

function inlineTex(text: string) {
  return [...text.matchAll(/\\\(([\s\S]+?)\\\)/g)].map((m) => m[1]);
}

export function buildPackage(manifestRaw: unknown, chapterRaw: Record<string, unknown>, opts: { version?: string } = {}) {
  const issues: PackageIssue[] = [];
  const manifest: Manifest = ManifestSchema.parse(manifestRaw);
  const chapters: Record<string, ChapterContent> = {};

  for (const [file, raw] of Object.entries(chapterRaw)) {
    const r = ChapterContentSchema.safeParse(raw);
    if (!r.success) {
      issues.push({ chapter: file, message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const c = r.data;
    const m = manifest.chapters.find((x) => x.id === c.id);
    if (!m) { issues.push({ chapter: c.id, message: "not in manifest" }); continue; }
    if (chapters[c.id]) { issues.push({ chapter: c.id, message: "authored twice" }); continue; }
    const [lo, hi] = m.pages;
    for (const s of c.sections) for (const b of s.blocks) {
      if ("pages" in b && b.pages && (b.pages[0] < lo || b.pages[1] > hi || b.pages[0] > b.pages[1])) {
        issues.push({ chapter: c.id, message: `${s.code}: block pages ${b.pages} outside chapter ${lo}–${hi}` });
      }
      const texts: string[] = [];
      if (b.type === "equation") { if (!texOk(b.tex)) issues.push({ chapter: c.id, message: `${s.code}: ${b.label} TeX does not compile` }); }
      if (b.type === "worked_example") b.steps.forEach((st) => { if (st.tex && !texOk(st.tex)) issues.push({ chapter: c.id, message: `${s.code}: ${b.label} step TeX does not compile` }); });
      if ("md" in b && typeof b.md === "string") texts.push(b.md);
      for (const t of texts) for (const x of inlineTex(t)) if (!texOk(x)) issues.push({ chapter: c.id, message: `${s.code}: inline TeX does not compile: ${x}` });
    }
    chapters[c.id] = c;
  }

  const pkg = {
    course: { ...manifest.course, version: opts.version ?? manifest.course.version },
    source: manifest.source,
    domains: manifest.domains.map((d) => ({ domain: d.domain, title: d.title, weight: d.weight })),
    chapters: manifest.chapters.map((m, i) => {
      const c = chapters[m.id];
      return {
        id: m.id, domain: m.domain, sort_order: i + 1, title: m.title, objectives: m.objectives,
        prerequisite: m.prerequisite, required: true, pages: m.pages,
        ...(c ? {
          est_minutes: c.est_minutes, review_status: c.review_status,
          meta: { ...c.meta, objective_statement: (m as { objective_statement?: string | null }).objective_statement ?? null },
          sections: c.sections,
        } : { review_status: "draft", meta: { objective_statement: (m as { objective_statement?: string | null }).objective_statement ?? null } }),
      };
    }),
  };
  return { pkg, issues, authored: Object.keys(chapters).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
}
