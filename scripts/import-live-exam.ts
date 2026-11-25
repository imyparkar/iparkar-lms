/**
 * Load the scored final-exam forms of a live course (assessor-only content: never commit it; this repo is public).
 *
 *   npm run import:live-exam -- --file imports/ohbp/ohbp-exam-forms.json [--dry-run]
 *
 * File shape: { "course": "OHBP", "forms": [{ "code": "A", "items": [{ "ref": "A-U1-01", "section": 1, "syllabus_ref": "1.0.1",
 *   "competency": "…", "level": "…", "difficulty": "…", "stem": "…", "options": ["…","…","…","…"], "answer": 0-3,
 *   "rationale": "…", "source": "…" }] }] }
 * Runs with the service role (SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL from .env.local). The database refuses
 * a form whose unit split does not match the blueprint and never changes a form that learners have already sat.
 * Imported forms stay closed until an administrator marks them reviewed and opens them (Admin → Live courses).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const raw of existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/) : []) {
  const m = raw.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? (process.argv[i + 1] ?? "true") : undefined; };
const file = arg("file");
if (!file || !existsSync(file)) { console.error("usage: npm run import:live-exam -- --file <forms.json> [--dry-run]"); process.exit(1); }

type Item = { ref: string; section: number; stem: string; options: string[]; answer: number; rationale: string; source: string };
const pkg = JSON.parse(readFileSync(file, "utf8")) as { course: string; forms: { code: string; items: Item[] }[] };
const problems: string[] = [];
for (const f of pkg.forms) {
  const refs = new Set<string>();
  for (const it of f.items) {
    if (!/^[A-Z]-U[0-9]-[0-9]{2}$/.test(it.ref) || !it.ref.startsWith(`${f.code}-`)) problems.push(`${it.ref}: bad ref`);
    if (refs.has(it.ref)) problems.push(`${it.ref}: duplicate`); refs.add(it.ref);
    if (!Array.isArray(it.options) || it.options.length !== 4 || new Set(it.options).size !== 4) problems.push(`${it.ref}: needs 4 distinct options`);
    if (!(it.answer >= 0 && it.answer <= 3)) problems.push(`${it.ref}: answer must be 0-3`);
    if (!it.rationale || !it.source) problems.push(`${it.ref}: rationale and source required`);
  }
  const keys = [0, 1, 2, 3].map((k) => f.items.filter((i) => i.answer === k).length);
  console.log(`Form ${f.code}: ${f.items.length} items · answer key spread A-D ${keys.join("/")}`);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
if (arg("dry-run")) { console.log("Dry run: valid, nothing imported."); process.exit(0); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.rpc("service_live_import_exam", { p: pkg });
if (error || !data?.ok) { console.error("Import refused:", error?.message ?? JSON.stringify(data)); process.exit(1); }
console.log(`Imported ${data.items} items. Open each form in Admin → Live courses after the technical review.`);
