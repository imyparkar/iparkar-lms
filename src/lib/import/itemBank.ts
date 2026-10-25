/**
 * Question-bank import parsers.
 *
 * 1. Markdown item bank (ASP11_item_bank.md format):
 *    | ID | Domain-Task | Level | Stem | A | B | C | D | Key | Rationale | Reference | Est. Diff. |
 * 2. CSV with headers:
 *    external_ref,domain_code,task_code,cognitive_level,topic,stem,option_a,option_b,option_c,option_d,
 *    option_e,option_f,key,explanation,reference,difficulty
 *
 * Both produce ImportItem[] for the `admin_import_questions` RPC. The course is
 * NEVER read from the file: it is the import target chosen by the admin.
 * Parsing is pure (no I/O) so it runs in the browser, on the server and in tests.
 */

export type ImportItem = {
  external_ref: string;
  domain_code: string;
  task_code?: string;
  cognitive_level?: "Recall" | "Application" | "Analysis";
  topic?: string;
  stem: string;
  options: { label: string; body: string }[];
  key: string;
  explanation: string;
  reference?: string;
  difficulty?: number;
};

export type ParseIssue = { line: number; ref?: string; message: string };
export type ParseResult = { items: ImportItem[]; issues: ParseIssue[]; rowsSeen: number };

const LEVELS = new Set(["Recall", "Application", "Analysis"]);

/** Split a markdown table row, honouring escaped pipes (\|). */
export function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** Derive a study topic from a reference such as "Yates, 4th ed., Ch. 10 Noise, ..." */
export function topicFromReference(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const yates = ref.match(/Ch\.\s*(\d+)\s+([A-Z][A-Za-z&' -]+?)(?=[,;(]|$)/);
  if (yates) return `Ch. ${yates[1]} ${yates[2].trim()}`;
  const ch = ref.match(/Ch\.\s*(\d+)/);
  if (ch) return `Ch. ${ch[1]}`;
  const osha = ref.match(/^(OSHA\s*\d+[^,]*)/);
  if (osha) return osha[1].trim();
  return undefined;
}

function validateItem(item: ImportItem, line: number, issues: ParseIssue[]): boolean {
  const before = issues.length;
  const push = (message: string) => issues.push({ line, ref: item.external_ref, message });
  if (!item.external_ref) push("missing ID");
  if (!/^[A-Za-z0-9-]{1,12}$/.test(item.domain_code)) push(`invalid domain code "${item.domain_code}"`);
  if (item.task_code && !item.task_code.startsWith(item.domain_code + "-"))
    push(`task "${item.task_code}" does not belong to domain ${item.domain_code}`);
  if (item.stem.length < 10) push("stem is missing or too short");
  if (item.options.length < 2) push("needs at least 2 options");
  item.options.forEach((o) => !o.body && push(`option ${o.label} is empty`));
  if (!item.options.some((o) => o.label === item.key)) push(`key "${item.key}" does not match an option`);
  if (!item.explanation) push("missing rationale/explanation");
  if (item.cognitive_level && !LEVELS.has(item.cognitive_level)) push(`unknown level "${item.cognitive_level}"`);
  if (item.difficulty !== undefined && (Number.isNaN(item.difficulty) || item.difficulty < 0 || item.difficulty > 100))
    push("difficulty must be 0–100");
  return issues.length === before;
}

export function parseMarkdownItemBank(md: string): ParseResult {
  const items: ImportItem[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  let rowsSeen = 0;
  const lines = md.split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim().startsWith("|")) return;
    const cells = splitMarkdownRow(raw);
    const id = cells[0];
    if (!/^[A-Z]+\d+-\d{3,5}$/.test(id)) return; // header, separator or other table
    rowsSeen++;
    if (cells.length !== 12) {
      issues.push({ line, ref: id, message: `expected 12 columns, found ${cells.length}` });
      return;
    }
    const [ref, domainTask, level, stem, a, b, c, d, key, rationale, reference, diff] = cells;
    const domain = ref.split("-")[0];
    const task = domainTask && domainTask !== domain ? domainTask : undefined;
    if (task && !task.startsWith(domain + "-")) {
      issues.push({ line, ref, message: `Domain-Task "${domainTask}" does not match ID domain ${domain}` });
      return;
    }
    if (seen.has(ref)) {
      issues.push({ line, ref, message: "duplicate ID in file" });
      return;
    }
    const item: ImportItem = {
      external_ref: ref,
      domain_code: domain,
      task_code: task,
      cognitive_level: (level || undefined) as ImportItem["cognitive_level"],
      topic: topicFromReference(reference),
      stem,
      options: [
        { label: "A", body: a },
        { label: "B", body: b },
        { label: "C", body: c },
        { label: "D", body: d },
      ],
      key: key.toUpperCase(),
      explanation: rationale,
      reference: reference || undefined,
      difficulty: diff === "" ? undefined : Number(diff),
    };
    if (validateItem(item, line, issues)) {
      seen.add(ref);
      items.push(item);
    }
  });
  return { items, issues, rowsSeen };
}

/** RFC 4180 CSV parser (quotes, escaped quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCsvItemBank(csv: string): ParseResult {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const issues: ParseIssue[] = [];
  const items: ImportItem[] = [];
  if (!rows.length) return { items, issues: [{ line: 1, message: "file is empty" }], rowsSeen: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const required = ["external_ref", "domain_code", "stem", "option_a", "option_b", "key", "explanation"];
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length) return { items, issues: [{ line: 1, message: `missing columns: ${missing.join(", ")}` }], rowsSeen: 0 };
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const options = ["a", "b", "c", "d", "e", "f"]
      .map((l) => ({ label: l.toUpperCase(), body: col(r, `option_${l}`) }))
      .filter((o, idx) => idx < 2 || o.body !== "");
    const diff = col(r, "difficulty");
    const item: ImportItem = {
      external_ref: col(r, "external_ref"),
      domain_code: col(r, "domain_code"),
      task_code: col(r, "task_code") || undefined,
      cognitive_level: (col(r, "cognitive_level") || undefined) as ImportItem["cognitive_level"],
      topic: col(r, "topic") || topicFromReference(col(r, "reference")),
      stem: col(r, "stem"),
      options,
      key: col(r, "key").toUpperCase(),
      explanation: col(r, "explanation"),
      reference: col(r, "reference") || undefined,
      difficulty: diff === "" ? undefined : Number(diff),
    };
    if (seen.has(item.external_ref)) {
      issues.push({ line, ref: item.external_ref, message: "duplicate external_ref in file" });
      return;
    }
    if (validateItem(item, line, issues)) {
      seen.add(item.external_ref);
      items.push(item);
    }
  });
  return { items, issues, rowsSeen: rows.length - 1 };
}

export function parseItemBank(fileName: string, text: string): ParseResult {
  return fileName.toLowerCase().endsWith(".csv") ? parseCsvItemBank(text) : parseMarkdownItemBank(text);
}

/** Split into chunks so each RPC call stays small. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
