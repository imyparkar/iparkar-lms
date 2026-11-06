import { beforeAll, describe, expect, it } from "vitest";
import { DB, courseId, createDb, createUser, currentBlueprint, domainId, enableExams, grant, rpc, seedCourse } from "./harness";

// Published topic weights (GES/EPI blueprint July 2023; QEP blueprint April 2023)
const EPI = { "1.1": 16, "1.2": 6, "1.3": 6, "1.4": 6, "1.5": 6, "2.1": 5, "2.2": 3, "2.3": 2,
              "3.1": 5, "3.2": 11, "3.3": 3, "3.4": 7, "3.5": 4, "3.6": 13, "3.7": 4, "4.0": 3 };
const QEP = { "1.1": 7, "1.2": 5, "1.3": 7, "1.4": 6, "2.1": 7, "2.2": 2, "2.3": 6, "2.4": 1,
              "3.1": 11, "3.2": 10, "3.3": 8, "3.4": 7, "3.5": 6, "3.6": 5, "3.7": 5, "4.0": 7 };

let db: DB;
let admin: string, dana: string;
const ids: Record<string, string> = {};
const bps: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  dana = await createUser(db, { username: "dana" });
  for (const c of ["EPI", "QEP"]) {
    ids[c] = await courseId(db, c);
    bps[c] = await currentBlueprint(db, c);
  }
  // the real banks hold 50 per topic; 25 is enough for both exam modes
  const bank = (w: Record<string, number>) => Object.fromEntries(Object.keys(w).map((d) => [d, 25]));
  await seedCourse(db, admin, "EPI", bank(EPI));
  await seedCourse(db, admin, "QEP", bank(QEP));
}, 120_000);

describe("GES/EPI and QEP courses", () => {
  it.each([["EPI", EPI], ["QEP", QEP]])("%s blueprint has 16 topics totalling 100 and is current", async (code, w) => {
    const rows = (await db.query<{ code: string; weight: string }>(
      `select d.code, bd.weight from blueprint_domains bd join course_domains d on d.id = bd.domain_id where bd.blueprint_id = $1`,
      [bps[code as string]])).rows;
    expect(rows).toHaveLength(16);
    expect(Object.fromEntries(rows.map((r) => [r.code, Number(r.weight)]))).toEqual(w);
  });

  it.each([["EPI", EPI], ["QEP", QEP]])("%s mixed exam takes exactly the published percentage from each topic", async (code, w) => {
    const rows = (await db.query<{ code: string; n: number }>(
      `select d.code, a.question_count n from allocate_question_counts($1, 100) a join course_domains d on d.id = a.domain_id`,
      [bps[code as string]])).rows;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.n]))).toEqual(w);
  });

  it("has a 100-question / 150-minute mixed exam and a 20-question / 30-minute topic exam", async () => {
    const rows = (await db.query<{ code: string; mode: string; question_count: number; duration_minutes: number; feedback_policy: string }>(
      `select c.code, e.mode::text, e.question_count, e.duration_minutes, e.feedback_policy::text
         from exams e join courses c on c.id = e.course_id where c.code in ('EPI','QEP') order by 1, 2`)).rows;
    expect(rows).toEqual([
      { code: "EPI", mode: "domain", question_count: 20, duration_minutes: 30, feedback_policy: "after_submit" },
      { code: "EPI", mode: "mixed", question_count: 100, duration_minutes: 150, feedback_policy: "after_submit" },
      { code: "QEP", mode: "domain", question_count: 20, duration_minutes: 30, feedback_policy: "after_submit" },
      { code: "QEP", mode: "mixed", question_count: 100, duration_minutes: 150, feedback_policy: "after_submit" },
    ]);
  });

  it("runs a full mixed exam and a single-topic exam drawn only from that course and topic", async () => {
    await enableExams(db, "EPI");
    await enableExams(db, "QEP");
    await grant(db, dana, "EPI");
    await grant(db, dana, "QEP");

    const mixed = await rpc(db, dana, "start_attempt", [ids.EPI, bps.EPI, "mixed", null, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(mixed.ok).toBe(true);
    const per = (await db.query<{ code: string; n: number; other: number }>(
      `select d.code, count(*)::int n, count(*) filter (where q.course_id <> $2)::int other
         from attempt_questions aq join course_domains d on d.id = aq.domain_id join questions q on q.id = aq.question_id
        where aq.attempt_id = $1 group by d.code`, [mixed.attempt_id, ids.EPI])).rows;
    expect(Object.fromEntries(per.map((r) => [r.code, r.n]))).toEqual(EPI);
    expect(per.every((r) => r.other === 0)).toBe(true);
    expect((await rpc(db, dana, "submit_attempt", [mixed.attempt_id], ["uuid"])).ok).toBe(true);

    const topic = await domainId(db, "QEP", "3.7");
    const t = await rpc(db, dana, "start_attempt", [ids.QEP, bps.QEP, "domain", topic, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(t.ok).toBe(true);
    const rows = (await db.query<{ code: string }>(
      `select d.code from attempt_questions aq join course_domains d on d.id = aq.domain_id where aq.attempt_id = $1`, [t.attempt_id])).rows;
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.code))).toEqual(new Set(["3.7"]));
  });

  it("keeps the older domain codes valid after allowing dots", async () => {
    const bad = await db.query(`select count(*)::int n from course_domains where code !~ '^[A-Za-z0-9.-]{1,12}$'`);
    expect(bad.rows[0]).toEqual({ n: 0 });
  });
});
