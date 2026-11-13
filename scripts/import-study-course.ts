/**
 * Validate and load a self-paced study course version.
 *
 *   npm run import:study -- --course asp-sps [--version 1.0.0-draft] [--dry-run] [--out pkg.json]
 *
 * Reads content/<course>/manifest.json (public structure: titles, objectives, page ranges)
 * and imports/<course>/chapters/*.json (lesson content: git-ignored because this repo is public).
 * Signs in as an administrator (ADMIN_EMAIL / ADMIN_PASSWORD; URL and anon key from .env.local)
 * so the import passes the same database checks and audit trail as any admin action.
 * Re-importing is safe: ids are keyed by chapter/section/activity codes, so learner progress
 * survives wording fixes. Structural changes to a version that has learners are refused.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildPackage } from "../src/lib/study/package";

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
  const course = (args.course ?? "asp-sps").toLowerCase();
  const manifest = JSON.parse(readFileSync(join("content", course, "manifest.json"), "utf8"));
  const dir = join("imports", course, "chapters");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const raw = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]));
  const { pkg, issues, authored } = buildPackage(manifest, raw, { version: args.version });

  console.log(`Manifest: ${pkg.chapters.length} chapters in ${pkg.domains.length} domains · version ${pkg.course.version}`);
  console.log(`Authored chapters (${authored.length}): ${authored.join(", ") || "none"}`);
  console.log(`In preparation: ${pkg.chapters.length - authored.length}`);
  issues.forEach((i) => console.log(`  ✗ ${i.chapter ?? ""} ${i.message}`));
  if (issues.length) process.exit(1);
  if (args.out) writeFileSync(args.out, JSON.stringify(pkg));
  if (args["dry-run"]) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Supabase URL/anon key (.env.local) and ADMIN_EMAIL/ADMIN_PASSWORD are required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error: authError } = await supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  if (authError) throw authError;
  const { data, error } = await supabase.rpc("admin_study_import", { p: pkg });
  if (error) throw error;
  console.log("Imported:", JSON.stringify(data));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
