/** Upgrade path: build the database as production stands today (pre-subject
 *  migrations), populate it with published questions and finished attempts,
 *  THEN apply the two new migrations and check nothing was lost or broken. */
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createUser, rpc, courseId, currentBlueprint, seedCourse, enableExams, grant, type DB } from "../../tests/db/harness";

const MIG = join(import.meta.dirname, "../../supabase/migrations");
const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;`;

let db: DB, admin: string, carol: string, cih: string, bp: string, oldAttempt: string;

describe("upgrading a populated production database", () => {
  beforeAll(async () => {
    db = new PGlite() as unknown as DB;
    await (db as any).exec(STUB);
    const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
    const before = files.filter((f) => f < "20261027");
    const after = files.filter((f) => f >= "20261027");
    for (const f of before) await (db as any).exec(readFileSync(join(MIG, f), "utf8"));
    await (db as any).exec(`grant all on all tables in schema public to service_role;
                            grant all on all sequences in schema public to service_role;`);

    admin = await createUser(db, { username: "admin", role: "admin" });
    carol = await createUser(db, { username: "carol" });
    cih = await courseId(db, "CIH"); bp = await currentBlueprint(db, "CIH");
    await seedCourse(db, admin, "CIH", { I: 75, II: 53, III: 24 },
      { I: ["I-T1","I-T2"], II: ["II-T1"], III: ["III-T1"] },
      { I: ["Toxicology"], II: ["Engineering Controls/Ventilation"], III: ["IH Program Management"] });
    await enableExams(db, "CIH"); await grant(db, carol, "CIH");

    // a finished attempt on the OLD schema, in the mode that is about to retire
    const dII = (await (db as any).query(`select cd.id from course_domains cd join courses c on c.id=cd.course_id
                                          where c.code='CIH' and cd.code='II'`)).rows[0].id;
    const r = await rpc(db, carol, "start_attempt", [cih, bp, "domain", dII], ["uuid","uuid","exam_mode","uuid"]);
    expect(r.ok).toBe(true);
    oldAttempt = r.attempt_id;
    await rpc(db, carol, "submit_attempt", [oldAttempt], ["uuid"]);

    // now upgrade
    for (const f of after) await (db as any).exec(readFileSync(join(MIG, f), "utf8"));
    await (db as any).exec(`grant all on all tables in schema public to service_role;`);
  }, 180_000);

  it("keeps the historical domain attempt and its score", async () => {
    const res = await rpc(db, carol, "get_attempt_result", [oldAttempt], ["uuid"]);
    expect(res.error).toBeUndefined();
    const row = (await (db as any).query(`select mode, subject_area, score_pct, question_count
                                          from exam_attempts where id=$1`, [oldAttempt])).rows[0];
    expect(row.mode).toBe("domain");
    expect(row.subject_area).toBeNull();
    expect(Number(row.question_count)).toBe(20);
  });

  it("retires CIH domain practice and offers subject practice instead", async () => {
    const dII = (await (db as any).query(`select cd.id from course_domains cd join courses c on c.id=cd.course_id
                                          where c.code='CIH' and cd.code='II'`)).rows[0].id;
    const d = await rpc(db, carol, "start_attempt", [cih, bp, "domain", dII, null], ["uuid","uuid","exam_mode","uuid","text"]);
    expect(d.error).toBe("MODE_NOT_AVAILABLE");
    const s = await rpc(db, carol, "start_attempt", [cih, bp, "subject", null, "Engineering Controls/Ventilation"],
                        ["uuid","uuid","exam_mode","uuid","text"]);
    expect(s.ok).toBe(true);
    const n = (await (db as any).query(`select count(*) c from attempt_questions where attempt_id=$1`, [s.attempt_id])).rows[0];
    expect(Number(n.c)).toBe(20);
    await rpc(db, carol, "submit_attempt", [s.attempt_id], ["uuid"]);
  });

  it("lists subject areas and reports subject performance including the pre-upgrade attempt", async () => {
    const areas = await rpc(db, carol, "get_subject_areas", [cih], ["uuid"]);
    expect(areas.map((a: any) => a.subject_area).sort())
      .toEqual(["Engineering Controls/Ventilation", "IH Program Management", "Toxicology"]);
    const perf = await rpc(db, carol, "get_course_subject_analytics", [cih], ["uuid"]);
    const eng = perf.find((p: any) => p.subject_area === "Engineering Controls/Ventilation");
    expect(eng).toBeTruthy();
    // 20 from the retired domain attempt + 20 from the new subject attempt
    expect(Number(eng.total)).toBe(40);
  });

  it("is safe to re-run end to end", async () => {
    const after = readdirSync(MIG).filter((f) => f.endsWith(".sql") && f >= "20261027").sort();
    for (const f of after) await (db as any).exec(readFileSync(join(MIG, f), "utf8"));
    const n = (await (db as any).query(`select count(*) c from exams ex join courses c on c.id=ex.course_id
                                        where c.code='CIH' and ex.mode='subject'`)).rows[0];
    expect(Number(n.c)).toBe(1);
  });
});
