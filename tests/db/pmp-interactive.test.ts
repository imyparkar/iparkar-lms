/* eslint-disable @typescript-eslint/no-explicit-any -- tests read untyped RPC JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { DB, courseId, createDb, createUser, currentBlueprint, domainId, enableExams, grant, rpc, seedCourse } from "./harness";

/**
 * PMP course and the interactive item types (multiple response, pull-down,
 * matching, drag-and-drop, hotspot) with case briefs and exhibits.
 * All items are synthetic test fixtures.
 */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#eee"/></svg>`;
const TYPES = ["single_best_answer", "multiple_response", "pulldown", "matching", "enhanced_matching", "hotspot"] as const;
const TASK: Record<string, string> = { D1: "I-1", D2: "II-1", D3: "III-1" };

function fixture(domain: string, i: number) {
  const type = TYPES[i % TYPES.length];
  const ref = `T-PMP-${domain}-${String(i + 1).padStart(4, "0")}`;
  const base = {
    external_ref: ref, domain_code: domain, task_code: TASK[domain], question_type: type,
    stem: `[TEST FIXTURE] ${domain} ${type} item ${i + 1}?`, explanation: "Fixture explanation.",
    reference: "Fixture", difficulty: 50, topic: "Hybrid", exhibit_refs: [] as string[],
    case_ref: i < 3 && domain === "D1" ? "CASE-T1" : undefined, case_seq: i < 3 && domain === "D1" ? i + 1 : undefined,
  };
  const four = ["A", "B", "C", "D"].map((l) => ({ label: l, body: `Option ${l}` }));
  switch (type) {
    case "single_best_answer":
      return { ...base, options: four, key: "B" };
    case "pulldown":
      return { ...base, stem: `[TEST FIXTURE] ${domain} item ${i + 1} is a(n) [[F1]].`, options: four, key: "B",
               interaction: { type: "pulldown", fields: [{ field_id: "F1", options: ["A", "B", "C", "D"] }] } };
    case "multiple_response":
      return { ...base, options: [...four, { label: "E", body: "Option E" }], answer_key: ["A", "C"],
               interaction: { type: "multiple_response", select_count: 2 },
               response_feedback: { A: "Correct.", B: "No.", C: "Correct.", D: "No.", E: "No." } };
    case "matching":
      return { ...base, answer_key: { L1: "R2", L2: "R1" },
               interaction: { type: "matching", left: [{ id: "L1", text: "Left 1" }, { id: "L2", text: "Left 2" }],
                              right: [{ id: "R1", text: "Right 1" }, { id: "R2", text: "Right 2" }, { id: "R3", text: "Right 3" }],
                              options_reusable: false } };
    case "enhanced_matching":
      return { ...base, exhibit_refs: ["EX-T1"], answer_key: { D1: ["t1"], D2: ["t2", "t3"], D3: ["UNPLACED"] },
               interaction: { type: "enhanced_matching",
                              draggables: [{ id: "D1", label: "Drag 1" }, { id: "D2", label: "Drag 2" }, { id: "D3", label: "Drag 3" }],
                              targets: ["t1", "t2", "t3"].map((id, n) => ({ id, label: id, shape: "rect", coords: [0.1 + n * 0.3, 0.1, 0.25, 0.5] })),
                              targets_reusable: false, unplaced_allowed: true } };
    case "hotspot":
      return { ...base, exhibit_refs: ["EX-T1"], answer_key: ["r2"],
               interaction: { type: "hotspot", select_count: 1,
                              regions: ["r1", "r2", "r3"].map((id, n) => ({ id, label: id, shape: "rect", coords: [0.1 + n * 0.3, 0.1, 0.25, 0.5] })) } };
  }
}

const PAYLOAD = {
  exhibits: [{ ref: "EX-T1", title: "Fixture exhibit", svg: SVG, alt_text: "Grey box", width: 100, height: 50 }],
  cases: [{ ref: "CASE-T1", title: "Fixture case", brief: "[TEST FIXTURE] A shared case brief.", exhibit_refs: ["EX-T1"] }],
  items: [
    ...Array.from({ length: 40 }, (_, i) => fixture("D1", i)),
    ...Array.from({ length: 48 }, (_, i) => fixture("D2", i)),
    ...Array.from({ length: 30 }, (_, i) => fixture("D3", i)),
  ],
};

let db: DB;
let admin: string, kai: string, lee: string;
let pmp: string, bp: string;

async function richImport(payload: unknown, status = "published") {
  return rpc(db, admin, "admin_import_rich_questions", ["PMP", JSON.stringify(payload), status], ["text", "jsonb", "text"]);
}

/** The keyed response for an item in an attempt. */
async function correctAnswer(questionId: string): Promise<{ option?: string; response?: unknown }> {
  const q = (await db.query<{ question_type: string; answer_key: any }>(
    `select question_type, answer_key from questions where id = $1`, [questionId])).rows[0];
  const opt = async (label: string) => (await db.query<{ id: string }>(
    `select id from question_options where question_id = $1 and label = $2`, [questionId, label])).rows[0].id;
  switch (q.question_type) {
    case "single_best_answer": case "pulldown": return { option: await opt("B") };
    case "multiple_response": return { response: { selected: [await opt("C"), await opt("A")] } };
    case "matching": return { response: { pairs: q.answer_key } };
    case "enhanced_matching": return { response: { placements: { D1: "t1", D2: "t3" } } };
    case "hotspot": return { response: { regions: ["r2"] } };
  }
  throw new Error(q.question_type);
}

async function answer(attempt: string, qid: string, a: { option?: string; response?: unknown }, seq = 1) {
  if (a.option !== undefined)
    return rpc(db, kai, "save_answer", [attempt, qid, a.option, seq], ["uuid", "uuid", "uuid", "bigint"]);
  return rpc(db, kai, "save_response", [attempt, qid, JSON.stringify(a.response), seq], ["uuid", "uuid", "jsonb", "bigint"]);
}

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  kai = await createUser(db, { username: "kai" });
  lee = await createUser(db, { username: "lee" });
  pmp = await courseId(db, "PMP");
  bp = await currentBlueprint(db, "PMP");
  await seedCourse(db, admin, "ASP", { D1: 3 });
}, 120_000);

describe("PMP course", () => {
  it("starts hidden with exams disabled and no calculator; other courses keep theirs", async () => {
    const rows = (await db.query<{ code: string; is_visible: boolean; exams_enabled: boolean; calculator_enabled: boolean }>(
      `select code, is_visible, exams_enabled, calculator_enabled from courses order by sort_order`)).rows;
    const p = rows.find((r) => r.code === "PMP")!;
    expect(p).toMatchObject({ is_visible: false, exams_enabled: false, calculator_enabled: false });
    expect(rows.filter((r) => r.code !== "PMP").every((r) => r.calculator_enabled)).toBe(true);
  });

  it("has the ECO domain weights and all 26 tasks", async () => {
    const w = (await db.query<{ code: string; weight: string }>(
      `select d.code, bd.weight from blueprint_domains bd join course_domains d on d.id = bd.domain_id where bd.blueprint_id = $1`, [bp])).rows;
    expect(Object.fromEntries(w.map((r) => [r.code, Number(r.weight)]))).toEqual({ D1: 33, D2: 41, D3: 26 });
    const t = (await db.query<{ code: string; n: number }>(
      `select d.code, count(*)::int n from blueprint_tasks bt join course_tasks t on t.id = bt.task_id
         join course_domains d on d.id = t.domain_id where bt.blueprint_id = $1 group by d.code`, [bp])).rows;
    expect(Object.fromEntries(t.map((r) => [r.code, r.n]))).toEqual({ D1: 8, D2: 10, D3: 8 });
    const a = (await db.query<{ code: string; n: number }>(
      `select d.code, a.question_count n from allocate_question_counts($1, 100) a join course_domains d on d.id = a.domain_id`, [bp])).rows;
    expect(Object.fromEntries(a.map((r) => [r.code, r.n]))).toEqual({ D1: 33, D2: 41, D3: 26 });
  });
});

describe("rich import", () => {
  it("is refused to students", async () => {
    const res = await rpc(db, kai, "admin_import_rich_questions", ["PMP", JSON.stringify(PAYLOAD), "published"], ["text", "jsonb", "text"]);
    expect(res).toMatchObject({ ok: false, error: "FORBIDDEN" });
  });

  it("imports and publishes every type with cases and exhibits", async () => {
    const res = await richImport(PAYLOAD);
    expect(res.errors).toEqual([]);
    expect(res).toMatchObject({ ok: true, created: 118, updated: 0 });
    const by = (await db.query<{ question_type: string; n: number }>(
      `select question_type, count(*)::int n from questions where course_id = $1 and status = 'published' group by 1`, [pmp])).rows;
    expect(by.reduce((s, r) => s + r.n, 0)).toBe(118);
    expect(new Set(by.map((r) => r.question_type))).toEqual(new Set(TYPES));
    const snap = (await db.query<{ s: any }>(
      `select qv.snapshot s from questions q join question_versions qv on qv.question_id = q.id and qv.version = q.version
        where q.external_ref = 'T-PMP-D1-0002'`)).rows[0].s;
    expect(snap.question_type).toBe("multiple_response");
    expect(snap.correct_option_ids).toHaveLength(2);
    expect(snap.case.brief).toContain("shared case brief");
    expect(snap.case.exhibits[0].ref).toBe("EX-T1");
  });

  it("leaves unchanged items alone and versions changed ones", async () => {
    expect(await richImport(PAYLOAD)).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 118 });
    const changed = { ...PAYLOAD, exhibits: [], cases: [], items: [{ ...PAYLOAD.items[3], answer_key: { L1: "R3", L2: "R1" } }] };
    expect(await richImport(changed)).toMatchObject({ ok: true, updated: 1 });
    const v = (await db.query<{ version: number }>(`select version from questions where external_ref = $1`, [PAYLOAD.items[3].external_ref])).rows[0];
    expect(v.version).toBe(2);
    expect(await richImport({ ...changed, items: [PAYLOAD.items[3]] })).toMatchObject({ ok: true, updated: 1 });
  });

  it("reports invalid items one by one", async () => {
    const bad = {
      exhibits: [], cases: [],
      items: [
        { ...PAYLOAD.items[1], external_ref: "T-BAD-1", answer_key: ["A", "Z"] },
        { ...PAYLOAD.items[3], external_ref: "T-BAD-2", answer_key: { L1: "R9", L2: "R1" } },
        { ...PAYLOAD.items[5], external_ref: "T-BAD-3", exhibit_refs: ["EX-NONE"] },
        { ...PAYLOAD.items[0], external_ref: "T-BAD-4", task_code: "III-1" },
        { ...PAYLOAD.items[0], question_type: "matching" },
      ],
    };
    const res = await richImport(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e: { ref: string }) => e.ref)).toEqual(["T-BAD-1", "T-BAD-2", "T-BAD-3", "T-BAD-4", PAYLOAD.items[0].external_ref]);
    expect((await db.query(`select 1 from questions where external_ref like 'T-BAD-%'`)).rows).toHaveLength(0);
  });

  it("keeps interactive items out of the single-question editor", async () => {
    const m = await rpc(db, admin, "admin_upsert_question", [JSON.stringify({
      course_code: "PMP", external_ref: PAYLOAD.items[3].external_ref, domain_code: "D1", stem: "Edited stem text",
      options: [{ label: "A", body: "x" }, { label: "B", body: "y" }], key: "A", explanation: "e" })], ["jsonb"]);
    expect(m.ok).toBe(false);
    expect(m.errors[0]).toMatch(/re-importing/);
    const p = await rpc(db, admin, "admin_upsert_question", [JSON.stringify({
      course_code: "PMP", external_ref: PAYLOAD.items[2].external_ref, domain_code: "D1", task_code: "I-1",
      stem: PAYLOAD.items[2].stem, options: PAYLOAD.items[2].options, key: "B", explanation: "Fixture explanation.", status: "published" })], ["jsonb"]);
    expect(p.ok).toBe(true);
  });
});

describe("PMP exams with interactive items", () => {
  let attempt: string;
  let questions: any[];

  it("serves types, cases and exhibits without keys, and hides the calculator", async () => {
    await enableExams(db, "PMP");
    await grant(db, kai, "PMP");
    const start = await rpc(db, kai, "start_attempt", [pmp, bp, "mixed", null, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(start.ok).toBe(true);
    attempt = start.attempt_id;
    const got = await rpc(db, kai, "get_attempt", [attempt], ["uuid"]);
    expect(got.attempt.course.calculator_enabled).toBe(false);
    questions = got.questions;
    expect(questions).toHaveLength(100);
    expect(new Set(questions.map((q) => q.type))).toEqual(new Set(TYPES));
    const text = JSON.stringify(got);
    for (const leak of ["answer_key", "correct_option", "response_feedback", "Fixture explanation", "is_correct"]) expect(text).not.toContain(leak);
    const em = questions.find((q) => q.type === "enhanced_matching");
    expect(em.options).toEqual([]);
    expect(em.interaction.targets).toHaveLength(3);
    expect(em.exhibits[0].svg).toContain("<svg");
    expect(questions.find((q) => q.type === "multiple_response").options).toHaveLength(5);
  });

  it("validates interactive responses", async () => {
    const by = (t: string) => questions.find((q) => q.type === t);
    const err = async (qid: string, r: unknown) => (await answer(attempt, qid, { response: r })).error;
    expect(await err(by("single_best_answer").question_id, { selected: [] })).toBe("USE_SAVE_ANSWER");
    expect(await err(by("multiple_response").question_id, { selected: ["00000000-0000-0000-0000-000000000000"] })).toBe("OPTION_NOT_IN_QUESTION");
    expect(await err(by("matching").question_id, { pairs: { L1: "R1", L2: "R1" } })).toBe("OPTION_REUSED");
    expect(await err(by("matching").question_id, { pairs: { L9: "R1" } })).toBe("OPTION_NOT_IN_QUESTION");
    expect(await err(by("hotspot").question_id, { regions: "r2" })).toBe("INVALID_RESPONSE");
    expect(await err(by("enhanced_matching").question_id, { placements: { D1: "t9" } })).toBe("OPTION_NOT_IN_QUESTION");
    const other = await rpc(db, lee, "save_response", [attempt, by("hotspot").question_id, JSON.stringify({ regions: ["r2"] }), 1], ["uuid", "uuid", "jsonb", "bigint"]);
    expect(other.error).toBe("NOT_FOUND");
    // clearing an answer stores nothing
    const cleared = await answer(attempt, by("hotspot").question_id, { response: { regions: [] } }, 1);
    expect(cleared).toMatchObject({ ok: true, response: null });
  });

  it("grades every type: keyed answers score, others do not, blanks count as unanswered", async () => {
    // all correct except: the first two of each type answered wrongly, the third left blank
    const seen: Record<string, number> = {};
    let expectCorrect = 0, expectBlank = 0;
    for (const q of questions) {
      const n = (seen[q.type] = (seen[q.type] ?? 0) + 1);
      if (n === 3) { expectBlank++; continue; }
      const good = await correctAnswer(q.question_id);
      let a = good;
      if (n <= 2) {
        a = q.type === "single_best_answer" || q.type === "pulldown" ? { option: q.options.find((o: any) => o.id !== good.option).id }
          : q.type === "multiple_response" ? { response: { selected: [(good.response as any).selected[0]] } }
          : q.type === "matching" ? { response: { pairs: { L1: "R3" } } }
          : q.type === "enhanced_matching" ? { response: { placements: { D1: "t1", D2: "t2", D3: "t3" } } }
          : { response: { regions: ["r1", "r2"] } };
      } else expectCorrect++;
      const res = await answer(attempt, q.question_id, a, 5);
      expect(res.ok, JSON.stringify(res)).toBe(true);
    }
    expect((await rpc(db, kai, "submit_attempt", [attempt], ["uuid"])).ok).toBe(true);
    const r = await rpc(db, kai, "get_attempt_result", [attempt], ["uuid"]);
    expect(r.attempt.correct).toBe(expectCorrect);
    expect(r.attempt.unanswered).toBe(expectBlank);
    expect(r.attempt.incorrect).toBe(100 - expectCorrect - expectBlank);
    expect(r.domains.reduce((s: number, d: any) => s + d.answered, 0)).toBe(100 - expectBlank);
    // approach (predictive / agile / hybrid) is the subject breakdown; one fixture lost its tag in the editor test
    expect(r.subjects.map((x: any) => x.subject_area)).toEqual(["Hybrid"]);
    expect(r.subjects[0].total).toBeGreaterThanOrEqual(99);

    const em = r.review.filter((x: any) => x.type === "enhanced_matching");
    expect(em.some((x: any) => x.is_correct && x.response.placements.D2 === "t3")).toBe(true);
    expect(em[0].answer_key.D2).toEqual(["t2", "t3"]);
    const mr = r.review.find((x: any) => x.type === "multiple_response");
    expect(mr.correct_option_ids).toHaveLength(2);
    expect(mr.response_feedback.A).toBe("Correct.");
    const cased = r.review.filter((x: any) => x.case);
    for (const c of cased) expect(c.case.title).toBe("Fixture case");
  });

  it("locks interactive answers once the attempt is finalized", async () => {
    const q = questions.find((x) => x.type === "hotspot");
    expect((await answer(attempt, q.question_id, { response: { regions: ["r3"] } }, 9)).error).toBe("ATTEMPT_CLOSED");
    await expect(db.query(`update attempt_answers set response = '{"regions":["r3"]}' where attempt_id = $1 and question_id = $2`,
      [attempt, q.question_id])).rejects.toThrow(/finalized/);
  });

  it("runs a 20-question domain exam", async () => {
    const d3 = await domainId(db, "PMP", "D3");
    const t = await rpc(db, kai, "start_attempt", [pmp, bp, "domain", d3, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    expect(t.ok).toBe(true);
    const got = await rpc(db, kai, "get_attempt", [t.attempt_id], ["uuid"]);
    expect(got.questions).toHaveLength(20);
    expect((await rpc(db, kai, "submit_attempt", [t.attempt_id], ["uuid"])).ok).toBe(true);
  });
});

describe("single-answer courses are unchanged", () => {
  it("do not gain interactive keys in their snapshots or attempts", async () => {
    const snap = (await db.query<{ s: any }>(`select public.build_question_snapshot(id) s from questions where course_id <> $1`, [pmp])).rows;
    expect(snap).toHaveLength(3);
    for (const row of snap) {
      for (const k of ["question_type", "interaction", "answer_key", "case", "exhibits"]) expect(row.s).not.toHaveProperty(k);
    }
  });
});
