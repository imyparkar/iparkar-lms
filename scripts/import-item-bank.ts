/**
 * Import an item bank from the command line.
 *
 *   npm run import:bank -- --file imports/ASP11_item_bank.md --course ASP --status draft [--dry-run]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
 * Signs in as an administrator so every row passes the same database
 * validation and audit trail as the admin import screen.
 *
 * The Supabase URL and anon key are read from .env.local, exactly as `next dev`
 * reads them, so the script and the app always talk to the same project. Only
 * ADMIN_EMAIL and ADMIN_PASSWORD need to be supplied on the command line, and
 * anything already set in the environment wins over the file.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { chunk, parseItemBank } from "../src/lib/import/itemBank";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]);
    return acc;
  }, []),
);

async function main() {
  const file = args.file;
  const course = (args.course ?? "ASP").toUpperCase();
  const status = args.status ?? "draft";
  if (!file) throw new Error("--file is required");
  if (!["draft", "in_review", "published"].includes(status)) throw new Error("--status must be draft, in_review or published");

  const parsed = parseItemBank(file, readFileSync(file, "utf8"));
  const byDomain: Record<string, number> = {};
  parsed.items.forEach((i) => (byDomain[i.domain_code] = (byDomain[i.domain_code] ?? 0) + 1));
  console.log(`Parsed ${parsed.rowsSeen} rows → ${parsed.items.length} valid, ${parsed.issues.length} skipped`);
  console.log("By domain:", byDomain);
  parsed.issues.slice(0, 50).forEach((i) => console.log(`  line ${i.line} ${i.ref ?? ""}: ${i.message}`));
  if (args["dry-run"]) return;

  // Fail with something readable rather than deep inside supabase-js
  const missing = (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const)
    .filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")}.\n` +
      `  NEXT_PUBLIC_* are read from .env.local in ${process.cwd()} (Supabase → Settings → API Keys).\n` +
      `  ADMIN_EMAIL and ADMIN_PASSWORD are passed on the command line, e.g.\n` +
      `    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run import:bank -- --file … --course … --status …\n` +
      `  Use --dry-run to parse the file without needing any of these.`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  console.log(`Importing into ${url.replace(/^https:\/\//, "").split(".")[0]} as ${process.env.ADMIN_EMAIL}`);
  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! });
  if (authErr) throw new Error(`Admin sign-in failed: ${authErr.message}`);

  let accepted = 0, created = 0;
  const rejected: unknown[] = [];
  for (const [n, part] of chunk(parsed.items, 100).entries()) {
    const { data, error } = await supabase.rpc("admin_import_questions", { p_course_code: course, p_items: part, p_status: status, p_auto_create_tasks: true });
    if (error || !data?.ok) throw new Error(`Chunk ${n + 1} failed: ${error?.message ?? data?.error}`);
    accepted += data.accepted.length;
    created += data.accepted.filter((a: { created: boolean }) => a.created).length;
    rejected.push(...data.rejected);
    process.stdout.write(`\rImported ${Math.min((n + 1) * 100, parsed.items.length)} / ${parsed.items.length}`);
  }
  console.log(`\nAccepted ${accepted} (${created} new), rejected ${rejected.length}`);
  rejected.slice(0, 50).forEach((r) => console.log("  ", JSON.stringify(r)));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
