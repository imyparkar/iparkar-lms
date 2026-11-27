import { beforeAll, describe, expect, it } from "vitest";
import { DB, createDb, createUser, rpc } from "./harness";

/** Certificates of completion for free SCORM courses (SAT): eligibility from module results, issue once, verify. */
let db: DB;
let ana: string, ben: string, cat: string, sus: string;
const SHA = "a".repeat(64);
const MODS = ["overview", "analysis", "design", "development", "implementation", "evaluation"];

async function asService(sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  await db.exec("set role service_role");
  try { return (await db.query<{ r: Record<string, unknown> }>(sql, params)).rows[0].r; } finally { await db.exec("reset role"); }
}
const finalize = (id: string, token: string) =>
  asService(`select public.service_finalize_study_certificate($1::uuid, $2::uuid, $3, $4, 1234) as r`, [id, token, `certificates/${id}.pdf`, SHA]);
const status = (uid: string) => rpc(db, uid, "scorm_certificate_status", ["sat"], ["text"]);
const claim = (uid: string, name: string) => rpc(db, uid, "scorm_claim_certificate", ["SAT", name], ["text", "text"]);
async function pass(uid: string, mods: string[], s = "passed", score = 90) {
  for (const m of mods) {
    await rpc(db, uid, "scorm_launch", ["sat", m], ["text", "text"]);
    await rpc(db, uid, "scorm_commit", ["sat", m, JSON.stringify({ lesson_status: s, score_raw: score }), true], ["text", "text", "jsonb", "boolean"]);
  }
}

beforeAll(async () => {
  db = await createDb();
  ana = await createUser(db, { username: "ana" });
  ben = await createUser(db, { username: "ben" });
  cat = await createUser(db, { username: "cat" });
  sus = await createUser(db, { username: "sus" });
  await db.query(`update public.profiles set full_name = 'Ana María Ortiz' where id = $1`, [ana]);
}, 120_000);

describe("eligibility", () => {
  it("offers the SAT certificate, locked until every module is passed", async () => {
    await pass(ana, MODS.slice(0, 5));
    const s = await status(ana);
    expect(s).toMatchObject({ ok: true, offered: true, course_code: "SAT", completed: false, certificate: null, suggested_name: "Ana María Ortiz" });
    expect(Number(s.hours)).toBe(2);
    expect(await claim(ana, "Ana María Ortiz")).toMatchObject({ ok: false, error: "course_incomplete" });
  });
  it("does not count a failed knowledge check", async () => {
    await pass(ben, MODS.slice(0, 5));
    await pass(ben, ["evaluation"], "failed", 60);
    expect((await status(ben)).completed).toBe(false);
    expect(await claim(ben, "Ben Okafor")).toMatchObject({ ok: false, error: "course_incomplete" });
  });
  it("unlocks when the last module is passed", async () => {
    await pass(ana, ["evaluation"]);
    const s = await status(ana);
    expect(s).toMatchObject({ completed: true, eligible: true });
    expect(s.completed_at).toBeTruthy();
  });
  it("refuses suspended users and unknown programmes", async () => {
    await db.query(`update public.profiles set status = 'suspended' where id = $1`, [sus]);
    expect(await claim(sus, "Sue Smith")).toMatchObject({ ok: false, error: "not_signed_in" });
    expect(await rpc(db, ana, "scorm_claim_certificate", ["XYZ", "Ana"], ["text", "text"])).toMatchObject({ ok: false, error: "not_offered" });
  });
});

describe("issue, download and verify", () => {
  let id = "", code = "";
  it("validates the name, then claims with a stable IPL-SAT code", async () => {
    expect(await claim(ana, "Ana 123")).toMatchObject({ ok: false, error: "invalid_name" });
    const c = await claim(ana, "Ana María Ortiz");
    expect(c).toMatchObject({ ok: true, state: "claimed" });
    expect(c.certificate).toMatchObject({ template: "nordic-a4-landscape-v1", signatory_name: "Imran Parkar",
      signatory_title: "Course director, iParkar Learning", certificate_title: "Systematic Approach to Training (SAT)" });
    expect(c.certificate.certificate_code).toMatch(/^IPL-SAT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    id = c.certificate.id; code = c.certificate.certificate_code;
    expect(await claim(ana, "Ana María Ortiz")).toMatchObject({ ok: false, error: "in_progress" });
    expect((await finalize(id, c.claim_token)).ok).toBe(true);
  });
  it("returns the issued certificate on later claims and in status", async () => {
    expect(await claim(ana, "Someone Else")).toMatchObject({ ok: true, state: "issued", certificate: { certificate_code: code, name_on_certificate: "Ana María Ortiz" } });
    expect((await status(ana)).certificate).toMatchObject({ certificate_code: code, status: "issued" });
    const n = await db.query(`select count(*)::int n from study_certificates where user_id = $1`, [ana]);
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });
  it("lists it under Certificates and lets only the owner download it", async () => {
    expect(await rpc(db, ana, "study_my_certificates")).toEqual([expect.objectContaining({ certificate_code: code, course_code: "SAT" })]);
    expect(await rpc(db, ana, "study_certificate_file", [code], ["text"])).toMatchObject({ ok: true, storage_key: `certificates/${id}.pdf` });
    expect(await rpc(db, ben, "study_certificate_file", [code], ["text"])).toMatchObject({ ok: false, error: "not_found" });
  });
  it("verifies publicly as valid, showing only what is printed", async () => {
    const v = await rpc(db, null, "study_verify_certificate", [code], ["text"]);
    expect(v).toMatchObject({ ok: true, found: true, valid: true, name: "Ana María Ortiz", course_title: "Systematic Approach to Training (SAT)", issuer: "iParkar Learning" });
    expect(Number(v.hours)).toBe(2);
    expect(await rpc(db, null, "study_verify_certificate", ["IPL-SAT-0000-0000"], ["text"])).toMatchObject({ found: false });
  });
  it("keeps issued certificates immutable and learners off the tables", async () => {
    await expect(db.query(`update study_certificates set name_on_certificate = 'X Y' where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(rpc(db, cat, "scorm_course_completed_at", [cat, id], ["uuid", "uuid"])).rejects.toThrow(/permission denied/);
  });
});

describe("study courses use the same design", () => {
  it("switches PMP and turns on ASP and CSP with the owner's hours and signatories", async () => {
    const r = await db.query(`select course_code, template, hours::float8 h, signatory_name, signatory_title, completion_rule, categories
                                from study_certificate_programs where course_code in ('PMP-SPS','ASP-SPS','CSP-SPS','SAT') order by 1`);
    const by = Object.fromEntries((r.rows as { course_code: string }[]).map((x) => [x.course_code, x]));
    expect(by["PMP-SPS"]).toMatchObject({ template: "nordic-a4-landscape-v1", h: 35, signatory_name: "Imran Parkar, PMP, CIT", signatory_title: "Course director, iParkar Learning", completion_rule: "chapters" });
    expect((by["PMP-SPS"] as unknown as { categories: object }).categories).toEqual({ businessAcumen: 8, waysOfWorking: 19, powerSkills: 8 });
    expect(by["ASP-SPS"]).toMatchObject({ template: "nordic-a4-landscape-v1", h: 63, signatory_name: "Imran Parkar, CSP, CIT", completion_rule: "chapters" });
    expect(by["CSP-SPS"]).toMatchObject({ template: "nordic-a4-landscape-v1", h: 50, signatory_name: "Imran Parkar, CSP, CIT", completion_rule: "chapters" });
    expect(by.SAT).toMatchObject({ template: "nordic-a4-landscape-v1", h: 2, signatory_name: "Imran Parkar", completion_rule: "scorm" });
  });
});
