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
 * Seeds: admin@example.test / learner@example.test / other@example.test (password "password123"),
 * the asp-sps manifest plus any authored chapters in imports/asp-sps/chapters, and pilot
 * enrollments for learner and other. Tokens are unsigned; auth is simulated, RLS and RPCs are real.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createDb, createUser, rpc } from "../db/harness";
import { buildPackage } from "../../src/lib/study/package";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const db = await createDb();
const users: Record<string, string> = {};
for (const u of ["admin", "learner", "other"]) {
  users[`${u}@example.test`] = await createUser(db, { username: u, role: u === "admin" ? "admin" : "student" });
}
await db.query(`update profiles set full_name = 'Heena Parkar' where username = 'learner'`);

const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "content/asp-sps/manifest.json"), "utf8"));
const dir = join(root, "imports/asp-sps/chapters");
const raw = existsSync(dir) ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))])) : {};
const { pkg, issues } = buildPackage(manifest, raw);
if (issues.length) throw new Error(JSON.stringify(issues));
const imp = await rpc(db, users["admin@example.test"], "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
for (const u of ["learner@example.test", "other@example.test"]) {
  await rpc(db, users["admin@example.test"], "admin_study_enroll", [users[u], imp.version_id, true], ["uuid", "uuid", "boolean"]);
}
console.log("seeded", imp.counts);

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
