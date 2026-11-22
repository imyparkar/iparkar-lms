/**
 * Converts the iParkar PMP26 bank export (reviewer JSONL + case briefs + exhibit
 * manifest + SVG files) into payloads for `admin_import_rich_questions`.
 *
 * The bank itself is premium content and never enters this repository: keep it
 * in imports/ (git-ignored) and point scripts/import-pmp-bank.ts at the folder.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type BankOption = { id: string; text: string };
export type BankRecord = {
  item_id: string;
  domain: "People" | "Process" | "Business Environment";
  eco_task: string;
  response_mode: "single" | "multiple" | "pulldown" | "matching" | "enhanced_matching" | "hotspot";
  difficulty: "Easy" | "Medium" | "Hard";
  case_id: string | null;
  case_seq: number | null;
  exhibit_ids: string[];
  stem: string;
  options?: BankOption[];
  interaction?: Record<string, unknown>;
  answer_key: string[] | Record<string, string | string[]>;
  select_count?: number;
  instructions?: string;
  rationale: string;
  response_feedback?: Record<string, string>;
  references?: { citation: string; verified: boolean }[];
  approach?: string;
  enablers?: { id: string; text: string }[];
};
export type BankCase = { case_id: string; title: string; brief: string; exhibit_ids?: string[] };
export type BankExhibit = { exhibit_id: string; title?: string; file: string; width?: number; height?: number; alt_text: string; data_table?: unknown };

export type RichItem = {
  external_ref: string;
  domain_code: string;
  task_code: string;
  question_type: string;
  stem: string;
  instructions?: string;
  options?: { label: string; body: string }[];
  key?: string;
  answer_key?: unknown;
  interaction?: unknown;
  response_feedback?: Record<string, string>;
  explanation: string;
  reference?: string;
  difficulty: number;
  topic?: string;
  case_ref?: string;
  case_seq?: number;
  exhibit_refs: string[];
};
export type RichPayload = {
  exhibits: { ref: string; title?: string; svg: string; alt_text: string; data_table?: unknown; width?: number; height?: number }[];
  cases: { ref: string; title: string; brief: string; exhibit_refs: string[] }[];
  items: RichItem[];
};

const DOMAIN: Record<BankRecord["domain"], string> = { People: "D1", Process: "D2", "Business Environment": "D3" };
const TYPE: Record<BankRecord["response_mode"], string> = {
  single: "single_best_answer",
  multiple: "multiple_response",
  pulldown: "pulldown",
  matching: "matching",
  enhanced_matching: "enhanced_matching",
  hotspot: "hotspot",
};
/** Editorial difficulty → the 0–100 scale the bank tables use. */
const DIFFICULTY: Record<BankRecord["difficulty"], number> = { Easy: 30, Medium: 50, Hard: 70 };

export function convertRecord(r: BankRecord): RichItem {
  const type = TYPE[r.response_mode];
  if (!type) throw new Error(`${r.item_id}: unknown response mode ${r.response_mode}`);
  const domain_code = DOMAIN[r.domain];
  if (!domain_code) throw new Error(`${r.item_id}: unknown domain ${r.domain}`);
  const item: RichItem = {
    external_ref: r.item_id,
    domain_code,
    task_code: r.eco_task.replace(".", "-"),
    question_type: type,
    stem: r.stem,
    instructions: r.instructions,
    explanation: r.rationale,
    response_feedback: r.response_feedback,
    reference: (r.references ?? []).map((x) => x.citation + (x.verified ? "" : " (to be verified)")).join("; ") || undefined,
    difficulty: DIFFICULTY[r.difficulty] ?? 50,
    topic: r.approach,
    case_ref: r.case_id ?? undefined,
    case_seq: r.case_seq ?? undefined,
    exhibit_refs: r.exhibit_ids ?? [],
  };
  if (type === "single_best_answer" || type === "pulldown" || type === "multiple_response") {
    item.options = (r.options ?? []).map((o) => ({ label: o.id, body: o.text }));
  }
  if (type === "single_best_answer") {
    const k = r.answer_key as string[];
    if (!Array.isArray(k) || k.length !== 1) throw new Error(`${r.item_id}: single answer needs one key`);
    item.key = k[0];
  } else if (type === "pulldown") {
    item.key = (r.answer_key as Record<string, string>).F1;
    item.interaction = r.interaction;
  } else if (type === "multiple_response") {
    item.answer_key = r.answer_key;
    item.interaction = { type: "multiple_response", select_count: r.select_count ?? (r.answer_key as string[]).length };
  } else {
    item.answer_key = r.answer_key;
    item.interaction = r.interaction;
  }
  return item;
}

export function loadPmpBank(dir: string): RichPayload {
  const file = (...names: string[]) => names.map((n) => join(dir, n)).find((p) => existsSync(p));
  const reviewer = file("PMP26_bank_reviewer.jsonl", "bank_reviewer.jsonl");
  const cases = file("PMP26_case_briefs.json", "case_briefs.json");
  const manifest = file("PMP26_exhibit_manifest.json", "exhibit_manifest.json");
  if (!reviewer || !cases || !manifest) throw new Error(`${dir} must contain the reviewer JSONL, case briefs and exhibit manifest`);

  const records = readFileSync(reviewer, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as BankRecord);
  const exhibits = (JSON.parse(readFileSync(manifest, "utf8")) as BankExhibit[]).map((e) => ({
    ref: e.exhibit_id,
    title: e.title,
    svg: readFileSync(join(dir, e.file), "utf8"),
    alt_text: e.alt_text,
    data_table: e.data_table,
    width: e.width,
    height: e.height,
  }));
  const briefs = (JSON.parse(readFileSync(cases, "utf8")) as BankCase[]).map((c) => ({
    ref: c.case_id, title: c.title, brief: c.brief, exhibit_refs: c.exhibit_ids ?? [],
  }));
  return { exhibits, cases: briefs, items: records.map(convertRecord) };
}

/** Exhibits and cases first (items refer to them), then items in batches. */
export function payloadChunks(p: RichPayload, size = 50): RichPayload[] {
  const out: RichPayload[] = [{ exhibits: p.exhibits, cases: p.cases, items: [] }];
  for (let i = 0; i < p.items.length; i += size) out.push({ exhibits: [], cases: [], items: p.items.slice(i, i + size) });
  return out;
}
