/**
 * Load the iParkar PMP26 bank (1,000 items: single, multiple response,
 * pull-down, matching, drag-and-drop and hotspot, with case briefs and
 * exhibits) into the PMP course.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run import:pmp -- --dir imports/PMP26_Question_Bank --status draft [--dry-run]
 *
 * The folder is the bank export: PMP26_bank_reviewer.jsonl, PMP26_case_briefs.json,
 * PMP26_exhibit_manifest.json and exhibits/*.svg. Keep it in imports/ — premium
 * banks never enter this repository.
 *
 * Signs in as an administrator and calls admin_import_rich_questions, which
 * validates every item, versions changed items and reports failures per item.
 * Re-running is safe: unchanged items are left alone.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadPmpBank, payloadChunks } from "../src/lib/import/pmpBank";

function loadEnvLocal(file = ".env.local") {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnvLocal();

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]);
    return acc;
  }, []),
);

async function main() {
  const dir = args.dir;
  const course = (args.course ?? "PMP").toUpperCase();
  const status = args.status ?? "draft";
  if (!dir) throw new Error("--dir is required");
  if (!["draft", "in_review", "published"].includes(status)) throw new Error("--status must be draft, in_review or published");

  const bank = loadPmpBank(dir);
  const byType: Record<string, number> = {};
  bank.items.forEach((i) => (byType[i.question_type] = (byType[i.question_type] ?? 0) + 1));
  console.log(`Read ${bank.items.length} items, ${bank.cases.length} case briefs, ${bank.exhibits.length} exhibits`);
  console.log("By type:", byType);
  if (args["dry-run"]) {
    if (args.out) writeFileSync(args.out, JSON.stringify(bank));
    return;
  }

  const missing = (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const)
    .filter((k) => !process.env[k]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(", ")} (see scripts/import-item-bank.ts for setup).`);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! });
  if (authErr) throw new Error(`Admin sign-in failed: ${authErr.message}`);

  let created = 0, updated = 0, unchanged = 0;
  const errors: unknown[] = [];
  const parts = payloadChunks(bank, 50);
  for (const [n, part] of parts.entries()) {
    const { data, error } = await supabase.rpc("admin_import_rich_questions", { p_course_code: course, p_payload: part, p_status: status });
    if (error || data?.error) throw new Error(`Chunk ${n + 1} failed: ${error?.message ?? data?.error}`);
    created += data.created; updated += data.updated; unchanged += data.unchanged;
    errors.push(...data.errors);
    process.stdout.write(`\rChunk ${n + 1} / ${parts.length}`);
  }
  console.log(`\nCreated ${created}, updated ${updated}, unchanged ${unchanged}, failed ${errors.length}`);
  errors.slice(0, 50).forEach((e) => console.log("  ", JSON.stringify(e)));
  if (errors.length) process.exit(2);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
