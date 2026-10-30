import { beforeAll, describe, expect, it } from "vitest";
import {
  DB, as, courseId, createDb, createUser, currentBlueprint, domainId, enableExams, grant, rpc, seedCourse,
  syntheticItems, importAndPublish,
} from "./harness";

const ASP = { D1: 10, D2: 25, D3: 8, D4: 12, D5: 10, D6: 12, D7: 7, D8: 11, D9: 5 };
const CSP = { D1: 25, D2: 25, D3: 15, D4: 9, D5: 6, D6: 10, D7: 10 };
const CIH = { I: 50, II: 35, III: 15 };
const CIH_TASKS = { I: ["I-T1", "I-T2", "I-T3", "I-T4"], II: ["II-T1", "II-T2", "II-T3"], III: ["III-T1", "III-T2"] };
// BGC subject areas cut across the blueprint domains. The fixture keeps each
// one inside a single domain so a subject draw can be checked against a domain.
const CIH_TOPICS = {
  I: ["Air Sampling and Instrumentation", "Toxicology"],
  II: ["Engineering Controls/Ventilation"],
  III: ["IH Program Management"],
};

let db: DB;
let admin: string, alice: string, bob: string, carol: string;
const ids: Record<string, string> = {};
const bps: Record<string, string> = {};

const start = (uid: string, course: string, mode: "mixed" | "domain" | "subject",
               domain: string | null = null, bp?: string, subject: string | null = null) =>
  rpc(db, uid, "start_attempt", [ids[course], bp ?? bps[course], mode, domain, subject],
      ["uuid", "uuid", "exam_mode", "uuid", "text"]);

async function attemptRows(attempt: string) {
  return (
    await db.query<{ course_code: string; domain_code: string; q_course: string; task_code: string | null }>(
      `select c.code course_code, d.code domain_code, qc.code q_course, t.code task_code
         from attempt_questions aq
         join courses c on c.id = aq.course_id
         join course_domains d on d.id = aq.domain_id
         join questions q on q.id = aq.question_id
         join courses qc on qc.id = q.course_id
         left join course_tasks t on t.id = aq.task_id
        where aq.attempt_id = $1`,
      [attempt],
    )
  ).rows;
}

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  alice = await createUser(db, { username: "alice" });
  bob = await createUser(db, { username: "bob" });
  carol = await createUser(db, { username: "carol" });
  for (const c of ["ASP", "CSP", "CIH"]) {
    ids[c] = await courseId(db, c);
    bps[c] = await currentBlueprint(db, c);
  }
  // 1.5× the mixed requirement per domain, and ≥ 24 so domain exams work
  const bank = (w: Record<string, number>) =>
    Object.fromEntries(Object.entries(w).map(([d, n]) => [d, Math.max(24, Math.ceil(n * 1.5))]));
  await seedCourse(db, admin, "ASP", bank(ASP));
  await seedCourse(db, admin, "CSP", bank(CSP));
  await seedCourse(db, admin, "CIH", bank(CIH), CIH_TASKS, CIH_TOPICS);
}, 120_000);

describe("blueprint allocation (largest remainder)", () => {
  it.each([
    ["ASP", ASP],
    ["CSP", CSP],
    ["CIH", CIH],
  ])("%s allocates exactly 100 questions by the configured weights", async (code, expected) => {
    const rows = (
      await db.query<{ code: string; n: number }>(
        `select d.code, a.question_count n from allocate_question_counts($1, 100) a join course_domains d on d.id = a.domain_id`,
        [bps[code as string]],
      )
    ).rows;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.n]))).toEqual(expected);
  });

  it("is deterministic and sums exactly with fractional weights", async () => {
    const res = await rpc(db, admin, "admin_create_blueprint_version",
      [ids.CIH, "TEST-thirds", "Thirds", "test", null,
       JSON.stringify([{ domain_code: "I", weight: 33.334 }, { domain_code: "II", weight: 33.333 }, { domain_code: "III", weight: 33.333 }])],
      ["uuid", "text", "text", "text", "date", "jsonb"]);
    expect(res.ok).toBe(true);
    const counts = async () =>
      (await db.query<{ n: number }>(`select question_count n from allocate_question_counts($1, 100)`, [res.blueprint_id]))
        .rows.map((r) => r.n);
    const a = await counts();
    expect(a.reduce((x, y) => x + y, 0)).toBe(100);
    expect(a).toEqual([34, 33, 33]);
    expect(await counts()).toEqual(a);
    expect((await db.query(`select is_current from blueprints where id = $1`, [res.blueprint_id])).rows[0]).toEqual({ is_current: false });
  });
});

describe("access control", () => {
  it("blocks students without an entitlement", async () => {
    await enableExams(db, "ASP");
    expect((await start(alice, "ASP", "mixed")).error).toBe("NO_ENTITLEMENT");
  });

  it("blocks courses whose exams are not yet enabled", async () => {
    await grant(db, alice, "CSP");
    expect((await start(alice, "CSP", "mixed")).error).toBe("EXAMS_NOT_ENABLED");
  });

  it("rejects expired and revoked entitlements", async () => {
    await grant(db, bob, "ASP", new Date(Date.now() - 1000 * 60).toISOString());
    expect((await start(bob, "ASP", "mixed")).error).toBe("NO_ENTITLEMENT");
    await grant(db, carol, "ASP");
    await db.query(`update course_entitlements set revoked_at = now() where user_id = $1`, [carol]);
    expect((await start(carol, "ASP", "mixed")).error).toBe("NO_ENTITLEMENT");
  });

  it("denies anonymous callers at the grant level", async () => {
    await expect(as(db, null, `select public.get_my_courses()`)).rejects.toThrow(/permission denied/);
  });

  it("students cannot read the question bank, keys or snapshots directly", async () => {
    await grant(db, alice, "ASP");
    for (const t of ["questions", "question_options", "question_keys", "question_versions"]) {
      expect(await as(db, alice, `select * from public.${t} limit 5`)).toEqual([]);
    }
    expect((await as(db, admin, `select count(*)::int n from public.questions`))[0].n).toBeGreaterThan(0);
  });

  it("students cannot write tables directly or call admin RPCs", async () => {
    await expect(as(db, alice, `update public.profiles set role = 'admin' where id = auth.uid()`)).rejects.toThrow(/permission denied/);
    await expect(as(db, alice, `insert into public.course_entitlements (user_id, course_id, source) values (auth.uid(), '${ids.CIH}', 'admin_grant')`)).rejects.toThrow(/permission denied/);
    expect((await rpc(db, alice, "admin_grant_entitlement", [alice, ids.CIH, "admin_grant", null, "x"],
      ["uuid", "uuid", "text", "timestamptz", "text"])).error).toBe("FORBIDDEN");
    await expect(as(db, alice, `select public.service_apply_purchase('${alice}', '${ids.CIH}', 30, null, 'purchase')`)).rejects.toThrow(/permission denied/);
    await expect(as(db, alice, `select public.resolve_login_email('admin')`)).rejects.toThrow(/permission denied/);
  });
});

describe("mandatory course-isolation tests", () => {
  let aspAttempt: string;

  it("1. an ASP exam contains only ASP questions, in blueprint proportions", async () => {
    const r = await start(alice, "ASP", "mixed");
    expect(r.ok).toBe(true);
    aspAttempt = r.attempt_id;
    const rows = await attemptRows(aspAttempt);
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((x) => x.course_code))).toEqual(new Set(["ASP"]));
    expect(new Set(rows.map((x) => x.q_course))).toEqual(new Set(["ASP"]));
    const byDomain: Record<string, number> = {};
    rows.forEach((x) => (byDomain[x.domain_code] = (byDomain[x.domain_code] ?? 0) + 1));
    expect(byDomain).toEqual(ASP);
    const unique = await db.query(`select count(distinct question_id)::int n from attempt_questions where attempt_id = $1`, [aspAttempt]);
    expect(unique.rows[0]).toEqual({ n: 100 });
  });

  it("2. a CSP exam contains only CSP questions", async () => {
    await enableExams(db, "CSP");
    await grant(db, bob, "CSP");
    const r = await start(bob, "CSP", "mixed");
    expect(r.ok).toBe(true);
    const rows = await attemptRows(r.attempt_id);
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((x) => x.q_course))).toEqual(new Set(["CSP"]));
    const byDomain: Record<string, number> = {};
    rows.forEach((x) => (byDomain[x.domain_code] = (byDomain[x.domain_code] ?? 0) + 1));
    expect(byDomain).toEqual(CSP);
  });

  it("3. a CIH exam contains only CIH questions with the 50/35/15 allocation", async () => {
    await enableExams(db, "CIH");
    await grant(db, carol, "CIH");
    const r = await start(carol, "CIH", "mixed");
    expect(r.ok).toBe(true);
    const rows = await attemptRows(r.attempt_id);
    expect(new Set(rows.map((x) => x.q_course))).toEqual(new Set(["CIH"]));
    const byDomain: Record<string, number> = {};
    rows.forEach((x) => (byDomain[x.domain_code] = (byDomain[x.domain_code] ?? 0) + 1));
    expect(byDomain).toEqual(CIH);
    await rpc(db, carol, "submit_attempt", [r.attempt_id], ["uuid"]);
  });

  it("4. requesting another course's question is denied", async () => {
    const cihQ = (await db.query<{ id: string }>(`select id from questions where course_id = $1 limit 1`, [ids.CIH])).rows[0].id;
    const res = await rpc(db, alice, "save_answer", [aspAttempt, cihQ, null, 1], ["uuid", "uuid", "uuid", "bigint"]);
    expect(res.error).toBe("QUESTION_NOT_IN_ATTEMPT");
    // alice (ASP only) cannot start a CIH exam by changing the course parameter
    expect((await start(alice, "CIH", "mixed")).error).toBe("NO_ENTITLEMENT");
    // nor pass a CIH domain or blueprint into an ASP request
    expect((await start(alice, "ASP", "domain", await domainId(db, "CIH", "I"))).error).toMatch(/INVALID_DOMAIN|ACTIVE_ATTEMPT/);
    expect((await start(alice, "ASP", "mixed", null, bps.CIH)).error).toMatch(/INVALID_BLUEPRINT|ACTIVE_ATTEMPT/);
    // the database itself refuses a cross-course attempt row
    const aspCourseAttempt = (await db.query<{ id: string }>(`select id from exam_attempts where id = $1`, [aspAttempt])).rows[0].id;
    await expect(db.query(
      `insert into attempt_questions (attempt_id, position, question_id, question_version, course_id, domain_id, option_order)
       select $1, 999, q.id, q.version, $2, q.domain_id, '{}' from questions q where q.id = $3`,
      [aspCourseAttempt, ids.ASP, cihQ])).rejects.toThrow(/foreign key/);
    // and another student's attempt is invisible
    expect((await rpc(db, bob, "get_attempt", [aspAttempt], ["uuid"])).error).toBe("NOT_FOUND");
  });

  it("5. CIH subject-area practice draws only from the selected subject area", async () => {
    // domain practice is retired for CIH; subject-area practice replaces it
    expect((await start(carol, "CIH", "domain", await domainId(db, "CIH", "II"))).error)
      .toBe("MODE_NOT_AVAILABLE");

    const r = await start(carol, "CIH", "subject", null, undefined, "Engineering Controls/Ventilation");
    expect(r.ok).toBe(true);
    const rows = await attemptRows(r.attempt_id);
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((x) => x.q_course))).toEqual(new Set(["CIH"]));
    // every drawn question carries the subject that was asked for
    const topics = (await db.query<{ topic: string }>(
      `select distinct q.topic from attempt_questions aq
         join questions q on q.id = aq.question_id where aq.attempt_id = $1`, [r.attempt_id])).rows;
    expect(topics.map((t) => t.topic)).toEqual(["Engineering Controls/Ventilation"]);
    // the fixture keeps that subject inside domain II, so the draw stays there
    expect(new Set(rows.map((x) => x.domain_code))).toEqual(new Set(["II"]));
    await rpc(db, carol, "submit_attempt", [r.attempt_id], ["uuid"]);
  });

  it("5b. a subject area with fewer questions than the exam length serves what it has", async () => {
    await importAndPublish(db, admin, "CIH",
      syntheticItems("CIH", "III", 6, ["III-T1"], ["Analytical Chemistry"]));
    const r = await start(carol, "CIH", "subject", null, undefined, "Analytical Chemistry");
    expect(r.ok).toBe(true);
    expect(await attemptRows(r.attempt_id)).toHaveLength(6);
    await rpc(db, carol, "submit_attempt", [r.attempt_id], ["uuid"]);
  });

  it("5c. an unknown or empty subject area is refused", async () => {
    expect((await start(carol, "CIH", "subject", null, undefined, "Nonexistent Area")).error)
      .toBe("INSUFFICIENT_QUESTIONS");
    expect((await start(carol, "CIH", "subject")).error).toBe("INVALID_SUBJECT");
    // a subject area cannot be smuggled into a mixed exam
    expect((await start(carol, "CIH", "mixed", null, undefined, "Toxicology")).error).toBe("INVALID_DOMAIN");
  });

  it("rejects a domain exam for a domain outside the course", async () => {
    await grant(db, carol, "ASP");
    expect((await start(carol, "ASP", "domain", await domainId(db, "CIH", "III"))).error).toBe("INVALID_DOMAIN");
  });

  it("7. analytics never combine courses", async () => {
    const asp = await rpc(db, carol, "get_course_analytics", [ids.ASP, null], ["uuid", "uuid"]);
    const cih = await rpc(db, carol, "get_course_analytics", [ids.CIH, null], ["uuid", "uuid"]);
    expect(asp.summary.completed).toBe(0);
    expect(cih.summary.completed).toBe(3);
    expect(asp.domains.map((d: any) => d.code)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);
    expect(cih.domains.map((d: any) => d.code)).toEqual(["I", "II", "III"]);
    expect(cih.domains.find((d: any) => d.code === "II").total).toBe(35 + 20);  // mixed + subject draw, both in II
    expect(cih.tasks.every((t: any) => t.code.match(/^(I|II|III)-T\d$/))).toBe(true);
  });
});

describe("exam engine: navigation, scoring, timing", () => {
  it("never exposes answer keys while in progress", async () => {
    const [{ id }] = (await db.query<{ id: string }>(
      `select id from exam_attempts where user_id = $1 and status = 'in_progress'`, [alice])).rows;
    const res = await rpc(db, alice, "get_attempt", [id], ["uuid"]);
    expect(res.ok).toBe(true);
    expect(res.questions).toHaveLength(100);
    const text = JSON.stringify(res.questions);
    expect(text).not.toMatch(/correct_option|explanation|is_correct|reference/);
    expect(res.questions[0].options).toHaveLength(4);
    expect(Object.keys(res.questions[0].options[0]).sort()).toEqual(["body", "id"]);
  });

  it("refuses a second active attempt in the same course", async () => {
    const r = await start(alice, "ASP", "mixed");
    expect(r.error).toBe("ACTIVE_ATTEMPT");
    expect(r.attempt_id).toBeTruthy();
  });

  it("saves answers and flags, scores on the server, and finalizes exactly once", async () => {
    const [{ id }] = (await db.query<{ id: string }>(
      `select id from exam_attempts where user_id = $1 and status = 'in_progress'`, [alice])).rows;
    const att = await rpc(db, alice, "get_attempt", [id], ["uuid"]);
    // first 60: correct (body "Correct B"); next 25: wrong; last 15: unanswered
    for (const q of att.questions.slice(0, 85)) {
      const pick = q.position <= 60 ? q.options.find((o: any) => o.body === "Correct B") : q.options.find((o: any) => o.body === "Distractor A");
      const res = await rpc(db, alice, "save_answer", [id, q.question_id, pick.id, 1], ["uuid", "uuid", "uuid", "bigint"]);
      expect(res.ok).toBe(true);
    }
    // stale out-of-order write is ignored
    const q1 = att.questions[0];
    const stale = await rpc(db, alice, "save_answer", [id, q1.question_id, q1.options[0].id, 0], ["uuid", "uuid", "uuid", "bigint"]);
    expect(stale.stale).toBe(true);
    // option from another question is rejected
    const bad = await rpc(db, alice, "save_answer", [id, q1.question_id, att.questions[1].options[0].id, 5], ["uuid", "uuid", "uuid", "bigint"]);
    expect(bad.error).toBe("OPTION_NOT_IN_QUESTION");
    expect((await rpc(db, alice, "set_flag", [id, att.questions[3].question_id, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);

    const reread = await rpc(db, alice, "get_attempt", [id], ["uuid"]);
    expect(reread.questions[3].flagged).toBe(true);
    expect(reread.questions.filter((q: any) => q.selected_option_id).length).toBe(85);

    const [first, second] = await Promise.all([
      rpc(db, alice, "submit_attempt", [id], ["uuid"]),
      rpc(db, alice, "submit_attempt", [id], ["uuid"]),
    ]);
    expect([first.already_finalized, second.already_finalized].sort()).toEqual([false, true]);

    const result = await rpc(db, alice, "get_attempt_result", [id], ["uuid"]);
    expect(result.attempt).toMatchObject({ correct: 60, incorrect: 25, unanswered: 15, score_pct: 60, status: "submitted" });
    expect(result.domains.reduce((s: number, d: any) => s + d.total, 0)).toBe(100);
    expect(result.domains.reduce((s: number, d: any) => s + d.correct, 0)).toBe(60);
    expect(result.review_allowed).toBe(true);
    expect(result.review[0].correct_option_id).toBeTruthy();
    const finals = await db.query(`select count(*)::int n from audit_logs where action = 'exam.finalized' and entity_id = $1`, [id]);
    expect(finals.rows[0]).toEqual({ n: 1 });

    // answers are frozen after finalization
    expect((await rpc(db, alice, "save_answer", [id, q1.question_id, q1.options[1].id, 9], ["uuid", "uuid", "uuid", "bigint"])).error).toBe("ATTEMPT_CLOSED");
    await expect(db.query(`update attempt_answers set selected_option_id = null where attempt_id = $1`, [id])).rejects.toThrow(/finalized/);
  });

  it("auto-finalizes on expiry and ignores the client clock", async () => {
    const r = await start(alice, "ASP", "domain", await domainId(db, "ASP", "D2"));
    expect(r.ok).toBe(true);
    const att = await rpc(db, alice, "get_attempt", [r.attempt_id], ["uuid"]);
    expect(att.questions).toHaveLength(20);
    expect(new Date(att.attempt.expires_at).getTime() - new Date(att.attempt.started_at).getTime()).toBe(30 * 60 * 1000);
    // simulate time running out on the server
    await db.query(`update exam_attempts set started_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' where id = $1`, [r.attempt_id]);
    const q = att.questions[0];
    const late = await rpc(db, alice, "save_answer", [r.attempt_id, q.question_id, q.options[1].id, 1], ["uuid", "uuid", "uuid", "bigint"]);
    expect(late.error).toBe("ATTEMPT_EXPIRED");
    const res = await rpc(db, alice, "get_attempt_result", [r.attempt_id], ["uuid"]);
    expect(res.attempt).toMatchObject({ status: "expired", finalized_reason: "timeout", unanswered: 20, score_pct: 0 });
    expect(res.attempt.time_used_seconds).toBe(30 * 60);
    expect((await rpc(db, alice, "submit_attempt", [r.attempt_id], ["uuid"])).already_finalized).toBe(true);
  });

  it("the cron sweeper finalizes abandoned attempts", async () => {
    const r = await start(bob, "ASP", "mixed").catch(() => null);
    // bob has no ASP access, so use carol (ASP granted above)
    const s = await start(carol, "ASP", "mixed");
    expect(s.ok).toBe(true);
    await db.query(`update exam_attempts set started_at = now() - interval '3 hours', expires_at = now() - interval '30 minutes' where id = $1`, [s.attempt_id]);
    const n = (await db.query<{ n: number }>(`select public.finalize_expired_attempts() n`)).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await db.query(`select status from exam_attempts where id = $1`, [s.attempt_id])).rows[0]).toEqual({ status: "expired" });
    expect(r?.error).toBe("NO_ENTITLEMENT");
  });

  it("immediate-feedback policy locks each answer and returns the explanation", async () => {
    await db.query(`update exams set feedback_policy = 'immediate' where course_id = $1 and mode = 'domain'`, [ids.CSP]);
    const r = await start(bob, "CSP", "domain", await domainId(db, "CSP", "D3"));
    // bob still has the CSP mixed attempt open from test 2
    expect(r.error).toBe("ACTIVE_ATTEMPT");
    await rpc(db, bob, "submit_attempt", [r.attempt_id], ["uuid"]);
    const s = await start(bob, "CSP", "domain", await domainId(db, "CSP", "D3"));
    expect(s.ok).toBe(true);
    const att = await rpc(db, bob, "get_attempt", [s.attempt_id], ["uuid"]);
    const q = att.questions[0];
    const right = q.options.find((o: any) => o.body === "Correct B");
    const res = await rpc(db, bob, "save_answer", [s.attempt_id, q.question_id, right.id, 1], ["uuid", "uuid", "uuid", "bigint"]);
    expect(res.feedback).toMatchObject({ is_correct: true, explanation: "Fixture explanation." });
    const again = await rpc(db, bob, "save_answer", [s.attempt_id, q.question_id, q.options[0].id, 2], ["uuid", "uuid", "uuid", "bigint"]);
    expect(again.error).toBe("ANSWER_LOCKED");
    await db.query(`update exams set feedback_policy = 'after_submit' where course_id = $1`, [ids.CSP]);
  });

  it("restricted policy hides the review", async () => {
    await db.query(`update exams set feedback_policy = 'restricted' where course_id = $1 and mode = 'domain'`, [ids.ASP]);
    const r = await start(alice, "ASP", "domain", await domainId(db, "ASP", "D1"));
    await rpc(db, alice, "submit_attempt", [r.attempt_id], ["uuid"]);
    const res = await rpc(db, alice, "get_attempt_result", [r.attempt_id], ["uuid"]);
    expect(res.review_allowed).toBe(false);
    expect(res.review).toEqual([]);
    expect(res.domains).toHaveLength(1);
    await db.query(`update exams set feedback_policy = 'after_submit' where course_id = $1`, [ids.ASP]);
  });
});

describe("question bank integrity", () => {
  it("import reports accepted and rejected rows with actionable errors", async () => {
    const items = [
      ...syntheticItems("ASP", "D9", 1).map((x) => ({ ...x, external_ref: "IMP-OK" })),
      { ...syntheticItems("ASP", "D9", 1)[0], external_ref: "IMP-BADDOMAIN", domain_code: "II" },
      { ...syntheticItems("ASP", "D9", 1)[0], external_ref: "IMP-BADKEY", key: "E" },
      { ...syntheticItems("ASP", "D9", 1)[0], external_ref: "IMP-BADTASK", task_code: "D1-T1" },
      { ...syntheticItems("ASP", "D9", 1)[0], external_ref: "IMP-SHORT", stem: "Too?" },
      { ...syntheticItems("ASP", "D9", 1)[0], external_ref: "IMP-COURSE", course_id: ids.CIH },
    ];
    const res = await rpc(db, admin, "admin_import_questions", ["ASP", JSON.stringify(items), "draft", true],
      ["text", "jsonb", "text", "boolean"]);
    expect(res.accepted.map((x: any) => x.external_ref).sort()).toEqual(["IMP-COURSE", "IMP-OK"]);
    const rejected = Object.fromEntries(res.rejected.map((x: any) => [x.external_ref, x.errors.join(" | ")]));
    expect(rejected["IMP-BADDOMAIN"]).toMatch(/does not belong to course ASP/);
    expect(rejected["IMP-BADKEY"]).toMatch(/answer key "E"/);
    expect(rejected["IMP-BADTASK"]).toMatch(/task "D1-T1"/);
    expect(rejected["IMP-SHORT"]).toMatch(/stem/);
    // the course always comes from the import target
    const c = await db.query(`select c.code from questions q join courses c on c.id = q.course_id where q.external_ref = 'IMP-COURSE'`);
    expect(c.rows[0]).toEqual({ code: "ASP" });
  });

  it("refuses to publish an item without an explanation", async () => {
    const [item] = syntheticItems("ASP", "D9", 1);
    const res = await rpc(db, admin, "admin_upsert_question",
      [JSON.stringify({ ...item, external_ref: "NO-EXPL", explanation: "", course_code: "ASP", status: "published" })], ["jsonb"]);
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/missing explanation/);
  });

  it("drafts and archived items are never selected", async () => {
    await db.query(`update questions set status = 'archived' where external_ref like 'T-ASP-D9-%'`);
    // only IMP-OK/IMP-COURSE drafts remain in D9 → mixed exam must be blocked, never back-filled
    await grant(db, bob, "ASP");
    const r = await start(bob, "ASP", "mixed");
    expect(r.error).toBe("INSUFFICIENT_QUESTIONS");
    expect(r.shortages).toEqual([expect.objectContaining({ domain_code: "D9", required: 5, available: 0 })]);
    const logged = await db.query(`select count(*)::int n from audit_logs where action = 'exam.generation_blocked'`);
    expect(logged.rows[0].n).toBeGreaterThanOrEqual(1);
    await db.query(`update questions set status = 'published' where external_ref like 'T-ASP-D9-%'`);
  });

  it("editing a question creates a new version and leaves attempt snapshots untouched", async () => {
    const [q] = (await db.query<{ id: string; external_ref: string; version: number }>(
      `select q.id, q.external_ref, q.version from attempt_questions aq join questions q on q.id = aq.question_id
        join exam_attempts a on a.id = aq.attempt_id where a.user_id = $1 and a.status = 'submitted' limit 1`, [alice])).rows;
    const item = { ...syntheticItems("ASP", "D1", 1)[0], external_ref: q.external_ref, course_code: "ASP",
      domain_code: (await db.query(`select d.code from questions q join course_domains d on d.id = q.domain_id where q.id = $1`, [q.id])).rows[0].code,
      stem: "[TEST FIXTURE] Edited stem after attempts?", status: "published" };
    const res = await rpc(db, admin, "admin_upsert_question", [JSON.stringify(item)], ["jsonb"]);
    expect(res.ok).toBe(true);
    expect(res.version).toBe(q.version + 1);
    const used = await db.query(`select question_version from attempt_questions where question_id = $1 limit 1`, [q.id]);
    expect(used.rows[0]).toEqual({ question_version: q.version });
  });
});

describe("6. blueprint versioning keeps history intact", () => {
  it("locks used blueprints and preserves the version on historical attempts", async () => {
    const res = await rpc(db, admin, "admin_update_blueprint_weights",
      [bps.ASP, JSON.stringify([{ domain_id: await domainId(db, "ASP", "D1"), weight: 11 }])], ["uuid", "jsonb"]);
    expect(res.error).toBe("BLUEPRINT_IN_USE");
    await expect(db.query(`delete from blueprint_domains where blueprint_id = $1`, [bps.ASP])).rejects.toThrow(/used by exam attempts/);

    const weights = Object.entries(ASP).map(([code, w]) => ({ domain_code: code, weight: code === "D1" ? w + 1 : code === "D2" ? w - 1 : w }));
    const nv = await rpc(db, admin, "admin_create_blueprint_version",
      [ids.ASP, "ASP-test-v2", "ASP v2", "test", "2027-01-01", JSON.stringify(weights)], ["uuid", "text", "text", "text", "date", "jsonb"]);
    expect(nv.ok).toBe(true);
    expect((await rpc(db, admin, "admin_set_current_blueprint", [nv.blueprint_id], ["uuid"])).ok).toBe(true);

    // old attempt still reports its original blueprint version and weights
    const [{ id }] = (await db.query<{ id: string }>(
      `select id from exam_attempts where user_id = $1 and mode = 'mixed' and course_id = $2`, [alice, ids.ASP])).rows;
    const result = await rpc(db, alice, "get_attempt_result", [id], ["uuid"]);
    expect(result.attempt.blueprint.version).toBe("ASP-initial-2026.10");
    expect(result.domains.find((d: any) => d.code === "D1").weight).toBe(10);

    // a stale client asking for the old version is refused
    expect((await start(alice, "ASP", "mixed", null, bps.ASP)).error).toBe("INVALID_BLUEPRINT");
    const fresh = await start(alice, "ASP", "mixed", null, nv.blueprint_id);
    expect(fresh.ok).toBe(true);
    const counts = await db.query<{ code: string; n: number }>(
      `select d.code, count(*)::int n from attempt_questions aq join course_domains d on d.id = aq.domain_id
        where aq.attempt_id = $1 group by d.code`, [fresh.attempt_id]);
    expect(Object.fromEntries(counts.rows.map((r) => [r.code, r.n]))).toMatchObject({ D1: 11, D2: 24 });

    // analytics default to the current version only, and say older attempts exist
    const a = await rpc(db, alice, "get_course_analytics", [ids.ASP, null], ["uuid", "uuid"]);
    expect(a.summary.completed).toBe(0);
    expect(a.attempts_on_other_blueprints).toBeGreaterThan(0);
    const old = await rpc(db, alice, "get_course_analytics", [ids.ASP, bps.ASP], ["uuid", "uuid"]);
    expect(old.summary.completed).toBeGreaterThan(0);
    // a CIH blueprint id can't be used to read ASP analytics
    expect((await rpc(db, alice, "get_course_analytics", [ids.ASP, bps.CIH], ["uuid", "uuid"])).error).toBe("INVALID_BLUEPRINT");
  });

  it("refuses to make a blueprint current unless weights total 100", async () => {
    const nv = await rpc(db, admin, "admin_create_blueprint_version",
      [ids.CSP, "CSP-bad", "bad", "test", null, JSON.stringify([{ domain_code: "D1", weight: 50 }])],
      ["uuid", "text", "text", "text", "date", "jsonb"]);
    expect((await rpc(db, admin, "admin_set_current_blueprint", [nv.blueprint_id], ["uuid"])).error).toBe("WEIGHTS_MUST_TOTAL_100");
  });
});

describe("payments → entitlements", () => {
  it("extends an active purchase instead of stacking", async () => {
    const dave = await createUser(db, { username: "dave" });
    await db.exec(`set role service_role`);
    try {
      const a = (await db.query<{ r: any }>(`select public.service_apply_purchase($1, $2, 90, null, 'purchase') r`, [dave, ids.ASP])).rows[0].r;
      const b = (await db.query<{ r: any }>(`select public.service_apply_purchase($1, $2, 90, null, 'purchase') r`, [dave, ids.ASP])).rows[0].r;
      expect(a.id).toBe(b.id);
    } finally {
      await db.exec(`reset role`);
    }
    const e = await db.query<{ days: number }>(
      `select round(extract(epoch from (expires_at - now())) / 86400)::int days from course_entitlements where user_id = $1`, [dave]);
    expect(e.rows).toEqual([{ days: 180 }]);
    const courses = await rpc(db, dave, "get_my_courses");
    expect(courses.find((c: any) => c.code === "ASP").has_access).toBe(true);
    expect(courses.find((c: any) => c.code === "CIH").has_access).toBe(false);
  });
});

describe("admin user search", () => {
  it("is admin-only and includes emails and entitlements", async () => {
    expect((await rpc(db, alice, "admin_search_users", ["", 10], ["text", "int"])).error).toBe("FORBIDDEN");
    const res = await rpc(db, admin, "admin_search_users", ["alice", 10], ["text", "int"]);
    expect(res.users).toHaveLength(1);
    expect(res.users[0]).toMatchObject({ username: "alice", email: "alice@example.test" });
    expect(res.users[0].entitlements.map((e: any) => e.course_code).sort()).toEqual(["ASP", "CSP"]);
  });
});
