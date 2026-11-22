/* eslint-disable @typescript-eslint/no-explicit-any -- tests read untyped RPC JSON */
import { describe, expect, it } from "vitest";
import { loadPmpBank, payloadChunks } from "../../src/lib/import/pmpBank";
import { courseId, createDb, createUser, currentBlueprint, enableExams, grant, rpc } from "./harness";

/**
 * Loads the real PMP26 bank when PMP_BANK_DIR points at the export folder
 * (the bank is premium content and is never committed). Skipped otherwise.
 *
 *   PMP_BANK_DIR=imports/PMP26_Question_Bank npx vitest run tests/db/pmp-bank.test.ts
 */
const dir = process.env.PMP_BANK_DIR;

describe.skipIf(!dir)("PMP26 bank", () => {
  it("imports all 1,000 items, publishes them and runs full exams", async () => {
    const bank = loadPmpBank(dir!);
    expect(bank.items).toHaveLength(1000);
    const db = await createDb();
    const admin = await createUser(db, { username: "admin", role: "admin" });
    const kai = await createUser(db, { username: "kai" });
    for (const part of payloadChunks(bank, 100)) {
      const res = await rpc(db, admin, "admin_import_rich_questions", ["PMP", JSON.stringify(part), "published"], ["text", "jsonb", "text"]);
      expect(res.errors, JSON.stringify(res.errors).slice(0, 2000)).toEqual([]);
    }
    const counts = (await db.query<{ code: string; question_type: string; n: number }>(
      `select d.code, q.question_type, count(*)::int n from questions q join course_domains d on d.id = q.domain_id
        where q.status = 'published' group by 1, 2 order by 1, 2`)).rows;
    const byDomain: Record<string, number> = {};
    counts.forEach((r) => (byDomain[r.code] = (byDomain[r.code] ?? 0) + r.n));
    expect(byDomain).toEqual({ D1: 330, D2: 410, D3: 260 });
    expect((await db.query(`select 1 from question_cases`)).rows).toHaveLength(bank.cases.length);
    expect((await db.query(`select 1 from question_exhibits`)).rows).toHaveLength(bank.exhibits.length);

    const pmp = await courseId(db, "PMP"), bp = await currentBlueprint(db, "PMP");
    await enableExams(db, "PMP");
    await grant(db, kai, "PMP");
    for (let n = 0; n < 3; n++) {
      const s = await rpc(db, kai, "start_attempt", [pmp, bp, "mixed", null, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
      expect(s.ok).toBe(true);
      const got = await rpc(db, kai, "get_attempt", [s.attempt_id], ["uuid"]);
      expect(got.questions).toHaveLength(100);
      expect(JSON.stringify(got)).not.toMatch(/answer_key|correct_option|response_feedback/);
      expect((await rpc(db, kai, "submit_attempt", [s.attempt_id], ["uuid"])).ok).toBe(true);
      const r = await rpc(db, kai, "get_attempt_result", [s.attempt_id], ["uuid"]);
      expect(r.attempt.unanswered).toBe(100);
      expect(r.review).toHaveLength(100);
    }

    // answering every item with the reviewer key scores 100%; one wrong answer per item type does not
    const keyed = new Map(bank.items.map((i) => [i.external_ref, i]));
    const s = await rpc(db, kai, "start_attempt", [pmp, bp, "mixed", null, null], ["uuid", "uuid", "exam_mode", "uuid", "text"]);
    const got = await rpc(db, kai, "get_attempt", [s.attempt_id], ["uuid"]);
    const refs = new Map((await db.query<{ id: string; external_ref: string }>(`select id, external_ref from questions`)).rows.map((r) => [r.id, r.external_ref]));
    const optionId = async (qid: string, label: string) =>
      (await db.query<{ id: string }>(`select id from question_options where question_id = $1 and label = $2`, [qid, label])).rows[0].id;
    for (const q of got.questions) {
      const it = keyed.get(refs.get(q.question_id)!)!;
      let res;
      if (it.question_type === "single_best_answer" || it.question_type === "pulldown") {
        res = await rpc(db, kai, "save_answer", [s.attempt_id, q.question_id, await optionId(q.question_id, it.key!), 1], ["uuid", "uuid", "uuid", "bigint"]);
      } else {
        const k = it.answer_key as any;
        const response =
          it.question_type === "multiple_response" ? { selected: await Promise.all((k as string[]).map((l) => optionId(q.question_id, l))) }
          : it.question_type === "hotspot" ? { regions: k }
          : it.question_type === "matching" ? { pairs: k }
          : { placements: Object.fromEntries(Object.entries(k as Record<string, string[]>).filter(([, v]) => v[0] !== "UNPLACED").map(([d, v]) => [d, v[0]])) };
        res = await rpc(db, kai, "save_response", [s.attempt_id, q.question_id, JSON.stringify(response), 1], ["uuid", "uuid", "jsonb", "bigint"]);
      }
      expect(res.ok, `${it.external_ref} ${JSON.stringify(res)}`).toBe(true);
    }
    await rpc(db, kai, "submit_attempt", [s.attempt_id], ["uuid"]);
    const r = await rpc(db, kai, "get_attempt_result", [s.attempt_id], ["uuid"]);
    const wrong = r.review.filter((x: any) => !x.is_correct).map((x: any) => x.external_ref);
    expect(wrong).toEqual([]);
    expect(Number(r.attempt.score_pct)).toBe(100);

    // and the key grades correctly for every one of the 1,000 published snapshots
    const all = (await db.query<{ external_ref: string; s: any }>(
      `select q.external_ref, qv.snapshot s from questions q join question_versions qv on qv.question_id = q.id and qv.version = q.version`)).rows;
    const failures: string[] = [];
    for (const { external_ref, s: snap } of all) {
      const it = keyed.get(external_ref)!;
      const byLabel = (l: string) => snap.options.find((o: any) => o.label === l)?.id;
      const k = it.answer_key as any;
      const [sel, resp] =
        it.question_type === "single_best_answer" || it.question_type === "pulldown" ? [byLabel(it.key!), null]
        : it.question_type === "multiple_response" ? [null, { selected: (k as string[]).map(byLabel) }]
        : it.question_type === "hotspot" ? [null, { regions: k }]
        : it.question_type === "matching" ? [null, { pairs: k }]
        : [null, { placements: Object.fromEntries(Object.entries(k as Record<string, string[]>).filter(([, v]) => v[0] !== "UNPLACED").map(([d, v]) => [d, v[0]])) }];
      const ok = (await db.query<{ g: boolean; w: boolean }>(`select public.grade_answer($1, $2, $3) g, public.grade_answer($1, null, null) w`,
        [JSON.stringify(snap), sel, resp === null ? null : JSON.stringify(resp)])).rows[0];
      if (!ok.g || ok.w) failures.push(external_ref);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
