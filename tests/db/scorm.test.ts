import { beforeAll, describe, expect, it } from "vitest";
import { DB, as, createDb, createUser, rpc } from "./harness";

/** SCORM 1.2 courses: catalogue, launch/resume, commit validation, privacy and access. */
let db: DB;
let admin: string, ana: string, ben: string, sus: string;

const commit = (uid: string, mod: string, data: object, finish = false) =>
  rpc(db, uid, "scorm_commit", ["sat", mod, JSON.stringify(data), finish], ["text", "text", "jsonb", "boolean"]);
const launch = (uid: string, mod: string) => rpc(db, uid, "scorm_launch", ["sat", mod], ["text", "text"]);
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  ana = await createUser(db, { username: "ana" });
  ben = await createUser(db, { username: "ben" });
  sus = await createUser(db, { username: "sus" });
  await db.query(`update public.profiles set status = 'suspended' where id = $1`, [sus]);
}, 120_000);

describe("catalogue", () => {
  it("seeds the free SAT course with six modules in order", async () => {
    const c = await rpc(db, ana, "scorm_get_course", ["sat"], ["text"]);
    expect(c.title).toMatch(/Systematic Approach to Training/);
    expect(c.modules.map((m: { code: string }) => m.code)).toEqual(["overview", "analysis", "design", "development", "implementation", "evaluation"]);
    expect(c.modules.every((m: { status: string }) => m.status === "not attempted")).toBe(true);
  });
  it("lists the course for any signed-in learner, not started", async () => {
    const list = await rpc(db, ben, "scorm_my_courses");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: "sat", modules_total: 6, modules_done: 0, started: false });
  });
  it("refuses anonymous and suspended users", async () => {
    expect(await err(rpc(db, null, "scorm_get_course", ["sat"], ["text"]))).toMatch(/permission denied/);
    expect(await rpc(db, sus, "scorm_get_course", ["sat"], ["text"])).toBeNull();
    expect(await err(launch(sus, "overview"))).toMatch(/course_unavailable/);
    expect(await rpc(db, sus, "scorm_can_view", ["sat", "overview"], ["text", "text"])).toBe(false);
  });
  it("hides draft courses from learners but not admins", async () => {
    await db.query(`update scorm_courses set status = 'draft' where code = 'sat'`);
    expect(await rpc(db, ana, "scorm_get_course", ["sat"], ["text"])).toBeNull();
    expect(await rpc(db, ana, "scorm_can_view", ["sat", "overview"], ["text", "text"])).toBe(false);
    expect((await rpc(db, admin, "scorm_get_course", ["sat"], ["text"])).code).toBe("sat");
    await db.query(`update scorm_courses set status = 'published' where code = 'sat'`);
    expect(await rpc(db, ana, "scorm_can_view", ["sat", "overview"], ["text", "text"])).toBe(true);
  });
});

describe("launch, commit and resume", () => {
  it("starts ab-initio with the learner's name", async () => {
    const r = await launch(ana, "overview");
    expect(r.cmi).toMatchObject({ student_id: "ana", lesson_status: "not attempted", entry: "ab-initio", suspend_data: "", mastery_score: "80" });
    expect(r.module.launch_path).toBe("index.html");
  });
  it("refuses commits before launch and for unknown modules", async () => {
    expect(await err(commit(ben, "analysis", { lesson_status: "incomplete" }))).toMatch(/not_launched/);
    expect(await err(launch(ana, "nope"))).toMatch(/module_not_found/);
  });
  it("saves progress and resumes from it", async () => {
    await commit(ana, "overview", { lesson_status: "incomplete", lesson_location: "4", suspend_data: '{"cur":4}' });
    const r = await launch(ana, "overview");
    expect(r.cmi).toMatchObject({ lesson_status: "incomplete", lesson_location: "4", suspend_data: '{"cur":4}', entry: "resume" });
  });
  it("validates every value", async () => {
    expect(await err(commit(ana, "overview", { lesson_status: "done" }))).toMatch(/invalid_lesson_status/);
    expect(await err(commit(ana, "overview", { score_raw: "101" }))).toMatch(/invalid_score/);
    expect(await err(commit(ana, "overview", { score_raw: "-5" }))).toMatch(/invalid_score/);
    expect(await err(commit(ana, "overview", { suspend_data: "x".repeat(4097) }))).toMatch(/suspend_data_too_long/);
    expect(await err(commit(ana, "overview", { lesson_location: "x".repeat(256) }))).toMatch(/lesson_location_too_long/);
    expect(await err(commit(ana, "overview", { session_time: "1 hour" }, true))).toMatch(/invalid_session_time/);
  });
  it("records a pass once, keeps the best score and never goes backwards", async () => {
    await commit(ana, "overview", { lesson_status: "passed", score_raw: "100", session_time: "0000:12:30" }, true);
    await commit(ana, "overview", { lesson_status: "failed", score_raw: "40" });
    await commit(ana, "overview", { lesson_status: "incomplete" });
    const c = await rpc(db, ana, "scorm_get_course", ["sat"], ["text"]);
    expect(c.modules[0]).toMatchObject({ status: "passed", score: 100 });
    const row = (await db.query<{ total_time: string; score_raw: string }>(
      `select total_time::text, score_raw::text from scorm_attempts a join scorm_modules m on m.id = a.module_id where a.user_id = $1 and m.code = 'overview'`, [ana])).rows[0];
    expect(row.total_time).toBe("00:12:30");
    expect(row.score_raw).toBe("40.00");
    const audits = await db.query(`select 1 from audit_logs where action = 'scorm.module_completed' and actor_id = $1`, [ana]);
    expect(audits.rows).toHaveLength(1);
    const list = await rpc(db, ana, "scorm_my_courses");
    expect(list[0]).toMatchObject({ modules_done: 1, started: true });
  });
});

describe("privacy", () => {
  it("keeps each learner's data to themselves", async () => {
    const r = await launch(ben, "overview");
    expect(r.cmi).toMatchObject({ student_id: "ben", lesson_status: "not attempted", suspend_data: "", entry: "ab-initio" });
    const c = await rpc(db, ben, "scorm_get_course", ["sat"], ["text"]);
    expect(c.modules[0].status).toBe("not attempted");
  });
  it("gives learners no direct table access", async () => {
    for (const t of ["scorm_courses", "scorm_modules", "scorm_attempts"]) {
      expect(await err(as(db, ana, `select * from public.${t}`))).toMatch(/permission denied/);
      expect(await err(as(db, ana, `update public.${t} set code = code`).catch((e) => { throw e; }))).toMatch(/permission denied|column/);
    }
    expect(await err(as(db, ana, `insert into public.scorm_attempts (user_id, module_id, lesson_status) select $1, id, 'passed' from scorm_modules`, [ben]))).toMatch(/permission denied/);
  });
});
