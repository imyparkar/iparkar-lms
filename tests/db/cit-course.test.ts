import { beforeAll, describe, expect, it } from "vitest";
import { DB, courseId, createDb, createUser, currentBlueprint, domainId, enableExams, grant, rpc, seedCourse } from "./harness";

// Published domain weights (BCSP CIT2 Examination Blueprint, V.2024.05.01)
const WEIGHTS = { D1: 18.6, D2: 13.8, D3: 14.4, D4: 15.6, D5: 15.7, D6: 11.9, D7: 10.0 };
// Largest remainder for 100 questions: floors 18/13/14/15/15/11/10 (96), then +1 to D6 (.9), D2 (.8),
// D5 (.7) and D1 (.6, ties with D4 on remainder but has the higher weight).
const MIXED = { D1: 19, D2: 14, D3: 14, D4: 15, D5: 16, D6: 12, D7: 10 };
const STATEMENTS = { D1: 10, D2: 13, D3: 14, D4: 11, D5: 11, D6: 7, D7: 8 };

let db: DB;
let admin: string, kai: string;
let cit: string, bp: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  kai = await createUser(db, { username: "kai" });
  cit = await courseId(db, "CIT");
  bp = await currentBlueprint(db, "CIT");
  // tasks already exist from the migration, so imported rows attach to them without auto-creating new ones
  const tasks = Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, [`${d}-K1`, `${d}-S1`]]));
  await seedCourse(db, admin, "CIT", Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, 25])), tasks);
}, 120_000);

describe("CIT course", () => {
  it("starts with exams disabled and sorts after QEP", async () => {
    const rows = (await db.query<{ code: string; exams_enabled: boolean }>(
      `select code, exams_enabled from courses where code in ('QEP','CIT') order by sort_order`)).rows;
    expect(rows.map((r) => r.code)).toEqual(["QEP", "CIT"]);
    expect(rows[1].exams_enabled).toBe(false);
  });

  it("has seven domains with the published weights totalling 100", async () => {
    const rows = (await db.query<{ code: string; weight: string }>(
      `select d.code, bd.weight from blueprint_domains bd join course_domains d on d.id = bd.domain_id where bd.blueprint_id = $1`, [bp])).rows;
    expect(Object.fromEntries(rows.map((r) => [r.code, Number(r.weight)]))).toEqual(WEIGHTS);
    expect(rows.reduce((s, r) => s + Number(r.weight), 0)).toBeCloseTo(100, 6);
  });

  it("defines all 74 knowledge and skill statements as named tasks in the current blueprint", async () => {
    const rows = (await db.query<{ code: string; n: number; unnamed: number }>(
      `select d.code, count(*)::int n, count(*) filter (where t.name like 'Task %')::int unnamed
         from blueprint_tasks bt join course_tasks t on t.id = bt.task_id join course_domains d on d.id = t.domain_id
        where bt.blueprint_id = $1 group by d.code`, [bp])).rows;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.n]))).toEqual(STATEMENTS);
    expect(rows.every((r) => r.unnamed === 0)).toBe(true);
    const total = await db.query<{ n: number }>(`select count(*)::int n from course_tasks where course_id = $1`, [cit]);
    expect(total.rows[0].n).toBe(74);
  });

  it("allocates a 100-question mixed exam by the published percentages", async () => {
    const rows = (await db.query<{ code: string; n: number }>(
      `select d.code, a.question_count n from allocate_question_counts($1, 100) a join course_domains d on d.id = a.domain_id`, [bp])).rows;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.n]))).toEqual(MIXED);
  });

  it("runs mixed and domain exams drawn only from CIT", async () => {
    await enableExams(db, "CIT");
    await grant(db, kai, "CIT");
    const mixed = await rpc(db, kai, "start_attempt", [cit, bp, "mixed", null, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(mixed.ok).toBe(true);
    const per = (await db.query<{ code: string; n: number; other: number }>(
      `select d.code, count(*)::int n, count(*) filter (where q.course_id <> $2)::int other
         from attempt_questions aq join course_domains d on d.id = aq.domain_id join questions q on q.id = aq.question_id
        where aq.attempt_id = $1 group by d.code`, [mixed.attempt_id, cit])).rows;
    expect(Object.fromEntries(per.map((r) => [r.code, r.n]))).toEqual(MIXED);
    expect(per.every((r) => r.other === 0)).toBe(true);
    expect((await rpc(db, kai, "submit_attempt", [mixed.attempt_id], ["uuid"])).ok).toBe(true);

    const d6 = await domainId(db, "CIT", "D6");
    const t = await rpc(db, kai, "start_attempt", [cit, bp, "domain", d6, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(t.ok).toBe(true);
    const rows = (await db.query<{ code: string }>(
      `select d.code from attempt_questions aq join course_domains d on d.id = aq.domain_id where aq.attempt_id = $1`, [t.attempt_id])).rows;
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.code))).toEqual(new Set(["D6"]));
  });
});
