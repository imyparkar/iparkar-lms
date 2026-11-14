/**
 * Content schema for self-paced study chapters.
 *
 * Chapters are authored as JSON (git-ignored under imports/, because this repo is
 * public), validated here, merged with content/<course>/manifest.json and loaded
 * into the database with `npm run import:study`. Students only ever receive
 * content through the get_study_chapter RPC.
 *
 * Text fields ("md") accept a deliberately small markup: **bold**, *italic*,
 * \( inline TeX \) and line breaks. Nothing else is interpreted, and nothing is
 * rendered as HTML except KaTeX output (which escapes its input).
 */
import { z } from "zod";

const Origin = z.object({
  /** source = guide content (structured/paraphrased); editorial = course note; original = new teaching item */
  origin: z.enum(["source", "editorial", "original"]),
  /** Guide PDF pages the block is drawn from; required for source blocks. */
  pages: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
});

const md = z.string().min(1).max(12000);

const Blocks = [
  z.object({ type: z.literal("heading"), text: z.string().min(1).max(200), level: z.number().int().min(2).max(4).optional() }),
  Origin.extend({ type: z.literal("text"), md }),
  Origin.extend({ type: z.literal("list"), ordered: z.boolean(), items: z.array(md).min(1) }),
  Origin.extend({
    type: z.literal("table"), caption: z.string().min(1), columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1), note: z.string().optional(),
  }),
  Origin.extend({
    type: z.literal("equation"), label: z.string().min(1), tex: z.string().min(1).max(2000),
    alt: z.string().min(1).max(1000), note: z.string().optional(),
  }),
  Origin.extend({
    type: z.literal("steps"), caption: z.string().min(1),
    items: z.array(z.object({ label: z.string(), text: z.string(), emphasis: z.boolean().optional() })).min(2),
  }),
  Origin.extend({
    type: z.literal("worked_example"), label: z.string(), title: z.string(), context: z.string().optional(),
    given_label: z.string().optional(), given: md, find: md.optional(),
    steps: z.array(z.object({
      label: z.string(), md: md.optional(), tex: z.string().optional(),
      table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
    }).refine((s) => !!s.md || !!s.tex || !!s.table, "step needs md, tex or table")).min(1),
    answer: md.optional(),
  }),
  Origin.extend({
    type: z.literal("figure"), label: z.string(), caption: z.string().min(1), description: z.string().min(1).max(10000),
  }),
  Origin.extend({ type: z.literal("scenario"), title: z.string(), body: md, decision: md }),
  Origin.extend({
    type: z.literal("callout"), variant: z.enum(["source_note", "common_error", "exam_tip", "editorial", "regional"]),
    title: z.string(), md: md.optional(), items: z.array(md).optional(),
  }),
  Origin.extend({ type: z.literal("summary"), items: z.array(md).min(1) }),
  Origin.extend({ type: z.literal("glossary"), terms: z.array(z.object({ term: z.string(), definition: md })).min(1) }),
  Origin.extend({ type: z.literal("related"), chapters: z.array(z.object({ code: z.string().regex(/^\d+\.\d+$/), title: z.string() })).min(1) }),
  Origin.extend({ type: z.literal("references"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("activity"), code: z.string() }),
] as const;

export const BlockSchema = z.discriminatedUnion("type", Blocks).superRefine((b, ctx) => {
  if ("origin" in b && b.origin === "source" && !b.pages) ctx.addIssue({ code: "custom", message: "source block needs pages" });
});
export type Block = z.infer<typeof BlockSchema>;

const Option = z.object({ id: z.string().regex(/^[a-z0-9-]{1,20}$/), text: z.string().min(1) });
const Feedback = z.object({
  explanation: md,
  options: z.record(z.string(), z.string()).optional(),
  review_section: z.string().optional(),
});
const ActivityBase = z.object({
  code: z.string().regex(/^[a-z0-9-]{1,40}$/),
  sort_order: z.number().int().optional(),
  required: z.boolean().default(true),
  provenance: z.enum(["source", "original"]).default("original"),
  feedback: Feedback,
});

export const ActivitySchema = z.discriminatedUnion("kind", [
  ActivityBase.extend({
    kind: z.literal("single_choice"),
    spec: z.object({ prompt: md, options: z.array(Option).min(2) }),
    answer_key: z.object({ correct: z.string() }),
    sample_response: z.object({ choice: z.string() }),
  }),
  ActivityBase.extend({
    kind: z.literal("multi_choice"),
    spec: z.object({ prompt: md, options: z.array(Option).min(2) }),
    answer_key: z.object({ correct: z.array(z.string()).min(1) }),
    sample_response: z.object({ choices: z.array(z.string()) }),
  }),
  ActivityBase.extend({
    kind: z.literal("numeric"),
    spec: z.object({ prompt: md, unit: z.string().min(1), hint: z.string().nullable().optional(), tolerance_note: z.string() }),
    answer_key: z.union([
      z.object({ value: z.number(), abs_tol: z.number().nonnegative() }),
      z.object({ value: z.number(), rel_tol: z.number().nonnegative() }),
    ]),
    sample_response: z.object({ value: z.number() }),
  }),
  ActivityBase.extend({
    kind: z.literal("self_check"),
    spec: z.object({ prompt: md }),
    answer_key: z.object({}),
    sample_response: z.object({ text: z.string().min(1) }),
  }),
  ActivityBase.extend({
    kind: z.literal("ordering"),
    spec: z.object({ prompt: md, items: z.array(Option).min(2) }),
    answer_key: z.object({ order: z.array(z.string()).min(2) }),
    sample_response: z.object({ order: z.array(z.string()) }),
  }),
]).superRefine((a, ctx) => {
  const ids = a.kind === "self_check" ? [] : "options" in a.spec ? a.spec.options.map((o) => o.id) : "items" in a.spec ? a.spec.items.map((o) => o.id) : [];
  if (a.kind === "single_choice" && !ids.includes(a.answer_key.correct)) ctx.addIssue({ code: "custom", message: `${a.code}: key not an option` });
  if (a.kind === "multi_choice" && a.answer_key.correct.some((c) => !ids.includes(c))) ctx.addIssue({ code: "custom", message: `${a.code}: key not an option` });
  if (a.kind === "ordering" && [...a.answer_key.order].sort().join() !== [...ids].sort().join()) ctx.addIssue({ code: "custom", message: `${a.code}: order must use every item once` });
  if (a.kind === "single_choice" || a.kind === "multi_choice") {
    for (const k of Object.keys(a.feedback.options ?? {})) if (!ids.includes(k)) ctx.addIssue({ code: "custom", message: `${a.code}: feedback for unknown option ${k}` });
  }
});
export type Activity = z.infer<typeof ActivitySchema>;

export const SectionSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{1,40}$/),
  sort_order: z.number().int().positive(),
  title: z.string().min(1).max(200),
  est_minutes: z.number().int().min(1).max(120).optional(),
  required: z.boolean().default(true),
  blocks: z.array(BlockSchema).min(1),
  activities: z.array(ActivitySchema).default([]),
}).superRefine((s, ctx) => {
  const placed = s.blocks.filter((b) => b.type === "activity").map((b) => (b as { code: string }).code).sort();
  const defined = s.activities.map((a) => a.code).sort();
  if (placed.join() !== defined.join()) ctx.addIssue({ code: "custom", message: `section ${s.code}: activity blocks ${placed} ≠ activities ${defined}` });
});

export const ChapterContentSchema = z.object({
  id: z.string().regex(/^\d+\.\d+$/),
  est_minutes: z.number().int().positive().optional(),
  review_status: z.enum(["draft", "in_review", "approved", "published", "archived"]),
  meta: z.object({
    summary: z.string().optional(),
    outcomes: z.array(z.string()).optional(),
    source: z.object({ edition: z.string(), pages: z.tuple([z.number(), z.number()]) }).passthrough(),
  }).passthrough(),
  sections: z.array(SectionSchema).min(1),
}).superRefine((c, ctx) => {
  const codes = c.sections.map((s) => s.code);
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: "custom", message: "duplicate section codes" });
  const acts = c.sections.flatMap((s) => s.activities.map((a) => a.code));
  if (new Set(acts).size !== acts.length) ctx.addIssue({ code: "custom", message: "duplicate activity codes" });
  for (const s of c.sections) for (const a of s.activities) {
    const r = a.feedback.review_section;
    if (r && !codes.includes(r)) ctx.addIssue({ code: "custom", message: `${a.code}: review_section ${r} not in chapter` });
  }
});
export type ChapterContent = z.infer<typeof ChapterContentSchema>;

export const ManifestSchema = z.object({
  course: z.object({ code: z.string(), title: z.string(), product: z.string(), version: z.string() }).passthrough(),
  source: z.object({ title: z.string(), edition: z.string(), stated_blueprint: z.string(), blueprint_note: z.string() }).passthrough(),
  domains: z.array(z.object({ domain: z.number(), title: z.string(), weight: z.number(), chapter_count: z.number() }).passthrough()).length(9),
  chapters: z.array(z.object({
    id: z.string(), domain: z.number(), title: z.string(), objectives: z.array(z.string()),
    prerequisite: z.boolean(), pages: z.tuple([z.number(), z.number()]),
  }).passthrough()),
}).passthrough();
export type Manifest = z.infer<typeof ManifestSchema>;
