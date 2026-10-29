/**
 * Test harness: runs the real Supabase migrations inside PGlite (Postgres
 * compiled to WASM) with a minimal stand-in for Supabase's `auth` schema and
 * roles, so RLS, grants and RPCs are exercised exactly as written.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MIGRATIONS = join(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export type DB = PGlite;

export async function createDb(): Promise<DB> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(`grant all on all tables in schema public to service_role;
                 grant all on all sequences in schema public to service_role;`);
  return db;
}

export async function createUser(db: DB, opts: { username: string; role?: "student" | "admin" }) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${opts.username}@example.test`,
    JSON.stringify({ username: opts.username }),
  ]);
  if (opts.role === "admin") await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);
  return id;
}

/** Run a query as a signed-in user (role `authenticated`, auth.uid() = uid). */
export async function as<T = any>(db: DB, uid: string | null, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Call a jsonb-returning RPC as a user and return the parsed result. */
export async function rpc(db: DB, uid: string | null, fn: string, args: unknown[] = [], casts: string[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ""}`).join(", ");
  const rows = await as<{ r: any }>(db, uid, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}

export async function courseId(db: DB, code: string): Promise<string> {
  return (await db.query<{ id: string }>(`select id from public.courses where code = $1`, [code])).rows[0].id;
}

export async function currentBlueprint(db: DB, code: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `select b.id from public.blueprints b join public.courses c on c.id = b.course_id where c.code = $1 and b.is_current`,
      [code],
    )
  ).rows[0].id;
}

export async function domainId(db: DB, course: string, code: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `select d.id from public.course_domains d join public.courses c on c.id = d.course_id where c.code = $1 and d.code = $2`,
      [course, code],
    )
  ).rows[0].id;
}

/**
 * Synthetic, clearly-labelled fixture items (test-only, never shipped).
 * Key is always B so tests can answer deterministically.
 */
export function syntheticItems(course: string, domain: string, count: number, taskCodes: string[] = [],
                               topics: string[] = []) {
  return Array.from({ length: count }, (_, i) => ({
    external_ref: `T-${course}-${domain}-${String(i + 1).padStart(4, "0")}`,
    domain_code: domain,
    task_code: taskCodes.length ? taskCodes[i % taskCodes.length] : undefined,
    topic: topics.length ? topics[i % topics.length] : undefined,
    cognitive_level: "Recall",
    stem: `[TEST FIXTURE] ${course} ${domain} synthetic item ${i + 1}?`,
    options: [
      { label: "A", body: "Distractor A" },
      { label: "B", body: "Correct B" },
      { label: "C", body: "Distractor C" },
      { label: "D", body: "Distractor D" },
    ],
    key: "B",
    explanation: "Fixture explanation.",
    reference: "Fixture",
    difficulty: 50,
  }));
}

export async function importAndPublish(db: DB, adminId: string, course: string, items: unknown[]) {
  const res = await rpc(db, adminId, "admin_import_questions", [course, JSON.stringify(items), "published", true], [
    "text",
    "jsonb",
    "text",
    "boolean",
  ]);
  if (!res.ok || res.rejected.length) throw new Error(`import failed: ${JSON.stringify(res).slice(0, 600)}`);
  return res;
}

export async function seedCourse(db: DB, adminId: string, course: string, perDomain: Record<string, number>,
                                 tasks: Record<string, string[]> = {},
                                 topics: Record<string, string[]> = {}) {
  for (const [domain, n] of Object.entries(perDomain)) {
    await importAndPublish(db, adminId, course,
      syntheticItems(course, domain, n, tasks[domain] ?? [], topics[domain] ?? []));
  }
}

export async function enableExams(db: DB, course: string) {
  await db.query(`update public.courses set exams_enabled = true where code = $1`, [course]);
}

export async function grant(db: DB, userId: string, course: string, expires: string | null = null) {
  await db.query(
    `insert into public.course_entitlements (user_id, course_id, source, starts_at, expires_at)
     values ($1, (select id from public.courses where code = $2), 'complimentary',
             least(now(), coalesce($3::timestamptz, now()) - interval '30 days'), $3)`,
    [userId, course, expires],
  );
}
