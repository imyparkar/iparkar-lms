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
import { buildPackage } from "../src/lib/study/package";
import { BlockSchema } from "../src/lib/study/schema";

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

  // Per-domain resources (formula sheets) and commercial settings.
  const resFile = join("imports", course, "resources.json");
  const resources = existsSync(resFile) ? JSON.parse(readFileSync(resFile, "utf8")).resources ?? [] : [];
  for (const r of resources) {
    r.blocks.forEach((b: unknown, i: number) => {
      const v = BlockSchema.safeParse(b);
      if (!v.success) issues.push({ chapter: r.code, message: `block ${i}: ${v.error.issues[0]?.message}` });
    });
  }
  console.log(`Resources: ${resources.map((r: { code: string }) => r.code).join(", ") || "none"}`);
  const accessFile = join("content", course, "access.json");
  const access = existsSync(accessFile) ? JSON.parse(readFileSync(accessFile, "utf8")) : null;
  if (access) console.log(`Access: ${access.enrollment_policy} enrollment · ${access.trial_days ?? "no"}-day trial · ${access.access_days} days for ${access.price_label}`);
  if (issues.length) {
    issues.forEach((i) => console.log(`  ✗ ${i.chapter ?? ""} ${i.message}`));
    console.log(`${issues.length} problem(s); nothing was imported.`);
    process.exit(1);
  }
  if (args.out) writeFileSync(args.out, JSON.stringify(pkg));
  if (args["dry-run"]) { console.log("Dry run OK: everything validated. Nothing was imported."); return; }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Supabase URL/anon key (.env.local) and ADMIN_EMAIL/ADMIN_PASSWORD are required");
  console.log(`Signing in to ${url} as ${process.env.ADMIN_EMAIL} …`);
  // Plain HTTPS calls (no auth client state), so failures are always reported.
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  const session = await auth.json().catch(() => ({}));
  if (!auth.ok || !session.access_token) {
    throw new Error(`Sign-in failed (HTTP ${auth.status}): ${session.error_description ?? session.msg ?? session.error ?? "no details"}`);
  }
  const rpc = async (fn: string, body: unknown) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST", body: JSON.stringify(body),
      headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn} failed (HTTP ${r.status}): ${text.slice(0, 500)}`);
    return JSON.parse(text);
  };
  console.log("Signed in. Importing (this can take a minute) …");

  const data = await rpc("admin_study_import", { p: pkg });
  console.log("Imported:", JSON.stringify(data));
  if (data?.ok === false) process.exit(1);
  if (resources.length) {
    console.log("Resources:", JSON.stringify(await rpc("admin_study_import_resources", { p: { course: pkg.course.code, version: pkg.course.version, resources } })));
  }
  if (access) {
    console.log("Access settings:", JSON.stringify(await rpc("admin_study_set_course_access", {
      p_course_code: pkg.course.code, p_policy: access.enrollment_policy, p_trial_days: access.trial_days,
      p_access_days: access.access_days, p_price_label: access.price_label,
    })));
  }
}

let finished = false;
process.on("exit", (code) => { if (!finished && code === 0) console.error("Stopped before finishing (no result received). Please send this output to support."); });
main().then(() => { finished = true; }).catch((e) => {
  finished = true;
  console.error("Error:", e?.message || JSON.stringify(e) || String(e));
  process.exit(1);
});
