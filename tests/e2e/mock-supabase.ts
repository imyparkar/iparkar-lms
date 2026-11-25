/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
/**
 * DEV/QA ONLY — never deploy. A tiny stand-in for Supabase Auth + PostgREST that runs
 * the real migrations in PGlite (via the DB test harness), so the Next.js app can be
 * exercised end to end in a browser without a Supabase project.
 *
 *   npx tsx tests/e2e/mock-supabase.ts            # listens on :54321
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon \
 *   SUPABASE_SERVICE_ROLE_KEY=service npm run dev
 *
 * Seeds (password "password123" for all):
 *   admin@example.test   — administrator (sees drawings and the admin screens)
 *   learner@example.test — pilot enrollment, no time limit
 *   other@example.test   — pilot enrollment, no time limit
 *   trial@example.test   — free access, 7 days left
 *   expired@example.test — free access that ended yesterday (paywall)
 *   new@example.test     — signed in, not started (sees "Start 7-day free access")
 * the asp-sps (or MOCK_COURSE) manifest, authored chapters in imports/asp-sps/chapters, the formula sheets in
 * imports/asp-sps/resources.json and content/asp-sps/access.json. So that the trial journey can be
 * previewed, the mock marks the chapters approved and publishes the version (MOCK_PUBLISH=0 to
 * keep it a draft). Tokens are unsigned; auth is simulated, RLS and RPCs are real.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createDb, createUser, rpc } from "../db/harness";
import { buildPackage } from "../../src/lib/study/package";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const db = await createDb();
const users: Record<string, string> = {};
for (const u of ["admin", "learner", "other", "trial", "expired", "new"]) {
  users[`${u}@example.test`] = await createUser(db, { username: u, role: u === "admin" ? "admin" : "student" });
}
await db.query(`update profiles set full_name = 'Heena Parkar' where username = 'learner'`);

const root = join(import.meta.dirname, "../..");
const COURSE = process.env.MOCK_COURSE ?? "asp-sps"; // MOCK_COURSE=csp-sps serves the CSP course
const manifest = JSON.parse(readFileSync(join(root, `content/${COURSE}/manifest.json`), "utf8"));
const dir = join(root, `imports/${COURSE}/chapters`);
const raw = existsSync(dir) ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))])) : {};
const { pkg, issues } = buildPackage(manifest, raw);
if (issues.length) throw new Error(JSON.stringify(issues));
const imp = await rpc(db, users["admin@example.test"], "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
for (const u of ["learner@example.test", "other@example.test"]) {
  await rpc(db, users["admin@example.test"], "admin_study_enroll", [users[u], imp.version_id, true], ["uuid", "uuid", "boolean"]);
}
const adminId = users["admin@example.test"];
const resFile = join(root, `imports/${COURSE}/resources.json`);
if (existsSync(resFile)) {
  const resources = JSON.parse(readFileSync(resFile, "utf8")).resources;
  console.log("resources", (await rpc(db, adminId, "admin_study_import_resources", [JSON.stringify({ course: pkg.course.code, version: pkg.course.version, resources })], ["jsonb"])));
}
const access = JSON.parse(readFileSync(join(root, `content/${COURSE}/access.json`), "utf8"));
await rpc(db, adminId, "admin_study_set_course_access", [pkg.course.code, access.enrollment_policy, access.trial_days, access.access_days, access.price_label],
          ["text", "text", "int", "int", "text"]);
if (process.env.MOCK_PUBLISH !== "0") {
  await db.query(`update study_chapters set review_status = 'approved' where version_id = $1`, [imp.version_id]); // [mock] preview only
  console.log("publish", await rpc(db, adminId, "admin_study_set_version_status", [imp.version_id, "published", true], ["uuid", "text", "boolean"]));
  for (const [u, sql] of [["trial", "now() + interval '7 days' - interval '1 minute'"], ["expired", "now() - interval '1 day'"]]) {
    await rpc(db, users[`${u}@example.test`], "study_self_enroll", [pkg.course.code], ["text"]);
    await db.query(`update study_enrollments set access_expires_at = ${sql}, trial_started_at = ${sql} - interval '7 days' where user_id = $1`, [users[`${u}@example.test`]]);
  }
}
console.log("seeded", imp.counts);

// MOCK_PMP_DIR=imports/PMP26_Question_Bank also loads the PMP bank, opens the PMP course and enrols learner@
if (process.env.MOCK_PMP_DIR) {
  const { loadPmpBank, payloadChunks } = await import("../../src/lib/import/pmpBank");
  for (const part of payloadChunks(loadPmpBank(process.env.MOCK_PMP_DIR), 100)) {
    const r = await rpc(db, adminId, "admin_import_rich_questions", ["PMP", JSON.stringify(part), "published"], ["text", "jsonb", "text"]);
    if (r.errors?.length) throw new Error(JSON.stringify(r.errors).slice(0, 1000));
  }
  await db.query(`update courses set is_visible = true, exams_enabled = true where code = 'PMP'`);
  await db.query(`insert into course_entitlements (user_id, course_id, source, starts_at) values ($1, (select id from courses where code = 'PMP'), 'complimentary', now() - interval '1 day')`,
                 [users["learner@example.test"]]);
  console.log("PMP bank loaded");
}

// MOCK_LIVE=1 seeds the live course OHBP: learner@ has paid, is in a cohort with dates and Teams links, attended
// sessions 1 and 3, missed session 2 (make-up due), and has P1 marked; exam forms come from imports/ohbp (or are synthetic).
if (process.env.MOCK_LIVE === "1") {
  const L = users["learner@example.test"];
  const sc = (await db.query<any>(`select id from study_courses where code = 'OHBP'`)).rows[0].id;
  await db.query(`insert into checkout_orders (provider_order_id, user_id, study_course_id, access_days, amount_minor, currency) values ('order_mock', $1, $2, 365, 99000, 'KWD')`, [L, sc]);
  await db.query(`select public.service_fulfil_checkout_order('order_mock', 'pay_mock', 99000, 'KWD', 'order.paid', '{}'::jsonb)`);
  await db.query(`update scorm_courses set status = 'published' where code in ('ohbp-study', 'ohbp-slides')`);
  const co = await rpc(db, adminId, "admin_live_create_cohort", ["OHBP", "OHBP-2027-01", "January 2027 cohort", "Asia/Kuwait"], ["text", "text", "text", "text"]);
  const ses = (await db.query<any>(`select s.id, p.session_no, p.minutes from live_sessions s join live_session_plan p on p.id = s.plan_id where s.cohort_id = $1 order by p.session_no`, [co.cohort_id])).rows;
  for (const s of ses) {
    const start = new Date(Date.now() + (s.session_no - 4) * 3 * 86400_000 + 3600_000);
    await rpc(db, adminId, "admin_live_update_session", [s.id, start.toISOString(), new Date(start.getTime() + s.minutes * 60_000).toISOString(),
      `https://teams.microsoft.com/l/meetup-join/mock-${s.session_no}`, `https://iparkar.sharepoint.com/recording/${s.session_no}`, "Imran Parkar"],
      ["uuid", "timestamptz", "timestamptz", "text", "text", "text"]);
  }
  const enr = (await db.query<any>(`select id from study_enrollments where user_id = $1 and course_id = $2`, [L, sc])).rows[0].id;
  await rpc(db, adminId, "admin_live_assign", [enr, co.cohort_id], ["uuid", "uuid"]);
  for (const [i, st] of [[0, "present"], [1, "absent"], [2, "present"]] as const) {
    await rpc(db, adminId, "admin_live_record_attendance", [ses[i].id, JSON.stringify([{ enrollment: enr, status: st, minutes: 120 }])], ["uuid", "jsonb"]);
  }
  const sub = await rpc(db, L, "live_submit_practical", ["OHBP", "P1", "Hazard review of the fictional solvent SDS: …", null, null, "session"], ["text", "text", "text", "text", "text", "text"]);
  await rpc(db, adminId, "admin_live_mark_practical", [sub.id, 8, "Clear extraction of hazards; give the route of entry for the vapour too."], ["uuid", "int", "text"]);
  const forms = existsSync(join(root, "imports/ohbp/ohbp-exam-forms.json")) ? readFileSync(join(root, "imports/ohbp/ohbp-exam-forms.json"), "utf8")
    : JSON.stringify({ course: "OHBP", forms: ["A", "B"].map((code) => ({ code, items: [2, 6, 8, 8, 8, 8].flatMap((n, u) => Array.from({ length: n }, (_, k) => ({
        ref: `${code}-U${u + 1}-${String(k + 1).padStart(2, "0")}`, section: u + 1, syllabus_ref: "x", competency: "x",
        stem: `[MOCK] Form ${code}, unit ${u + 1}, question ${k + 1}?`, options: ["First", "Second", "Third", "Fourth"], answer: 1, rationale: "x", source: "x" }))) })) });
  await db.query(`select public.service_live_import_exam($1::jsonb)`, [forms]);
  await db.query(`update live_exam_forms set is_active = true, reviewed = true`);
  // other@ has finished everything, so the examination can be tried.
  const O = users["other@example.test"];
  await db.query(`insert into checkout_orders (provider_order_id, user_id, study_course_id, access_days, amount_minor, currency) values ('order_mock2', $1, $2, 365, 99000, 'KWD')`, [O, sc]);
  await db.query(`select public.service_fulfil_checkout_order('order_mock2', 'pay_mock2', 99000, 'KWD', 'order.paid', '{}'::jsonb)`);
  const enr2 = (await db.query<any>(`select id from study_enrollments where user_id = $1 and course_id = $2`, [O, sc])).rows[0].id;
  await rpc(db, adminId, "admin_live_assign", [enr2, co.cohort_id], ["uuid", "uuid"]);
  for (const s of ses) await rpc(db, adminId, "admin_live_record_attendance", [s.id, JSON.stringify([{ enrollment: enr2, status: "present" }])], ["uuid", "jsonb"]);
  for (const code of ["P1", "P2", "P3", "P4", "P5"]) {
    const x = await rpc(db, O, "live_submit_practical", ["OHBP", code, "Mock answer", null, null, "session"], ["text", "text", "text", "text", "text", "text"]);
    await rpc(db, adminId, "admin_live_mark_practical", [x.id, 7, "Mock feedback for preview."], ["uuid", "int", "text"]);
  }
  await db.query(`insert into scorm_attempts (user_id, module_id, lesson_status, completed_at)
                  select $1, m.id, 'completed', now() from scorm_modules m join scorm_courses c on c.id = m.course_id where c.code = 'ohbp-study'`, [O]);
  console.log("live course OHBP seeded for learner@ (in progress) and other@ (ready for the examination)");
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 * 24, iat: Math.floor(Date.now() / 1000) })}.mock`;
const subOf = (token: string | undefined) => {
  if (!token) return null;
  const t = token.replace(/^Bearer\s+/i, "");
  if (t === "service") return "service";
  try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub as string; } catch { return null; }
};
const userJson = (id: string) => {
  const email = Object.entries(users).find(([, v]) => v === id)?.[0];
  return { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
};
const session = (id: string) => ({ access_token: jwt(id), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `refresh-${id}`, user: userJson(id) });

let chain = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = chain.then(f);
  chain = p.then(() => undefined, () => undefined);
  return p;
}
async function asRole<T>(sub: string | null, f: () => Promise<T>) {
  return serial(async () => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub && sub !== "service" ? sub : ""]);
    await db.exec(sub === "service" ? "set role service_role" : sub ? "set role authenticated" : "set role anon");
    try { return await f(); } finally { await db.exec("reset role"); }
  });
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}
function send(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sub = subOf(req.headers.authorization as string | undefined);

    if (url.pathname === "/auth/v1/token") {
      const b = await body(req);
      if (url.searchParams.get("grant_type") === "password") {
        const id = users[String(b.email).toLowerCase()];
        if (!id || b.password !== "password123") return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials" });
        return send(res, 200, session(id));
      }
      const id = String(b.refresh_token ?? "").replace("refresh-", "");
      return Object.values(users).includes(id) ? send(res, 200, session(id)) : send(res, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/auth/v1/user") return sub && sub !== "service" ? send(res, 200, userJson(sub)) : send(res, 401, { message: "invalid JWT" });
    if (url.pathname === "/auth/v1/logout") return send(res, 204);

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpcMatch) {
      const b = await body(req);
      const keys = Object.keys(b);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const vals = keys.map((k) => (b[k] !== null && typeof b[k] === "object" ? JSON.stringify(b[k]) : b[k]));
      try {
        const rows = await asRole(sub, async () => (await db.query<{ r: unknown }>(`select public.${rpcMatch[1]}(${args}) as r`, vals)).rows);
        return send(res, 200, rows[0]?.r ?? null);
      } catch (e) {
        return send(res, 400, { code: "P0001", message: (e as Error).message });
      }
    }

    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (table && req.method === "GET") {
      const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => c.trim()).filter((c) => /^[a-z_*]+$/.test(c));
      const where: string[] = []; const vals: unknown[] = [];
      for (const [k, v] of url.searchParams) {
        if (k === "select" || k === "order" || k === "limit" || !/^[a-z_]+$/.test(k)) continue;
        const [op, ...rest] = v.split("."); const val = rest.join(".");
        vals.push(val);
        where.push(op === "ilike" ? `${k}::text ilike $${vals.length}` : `${k}::text = $${vals.length}`);
      }
      const sql = `select ${cols.join(", ")} from public.${table[1]}${where.length ? ` where ${where.join(" and ")}` : ""}`;
      try {
        const rows = await asRole(sub, async () => (await db.query(sql, vals)).rows);
        if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "not one row" });
        return send(res, 200, rows);
      } catch (e) { return send(res, 400, { message: (e as Error).message }); }
    }
    send(res, 404, { message: `mock: ${req.method} ${url.pathname} not implemented` });
  } catch (e) {
    send(res, 500, { message: (e as Error).message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock supabase on :${PORT}`));
