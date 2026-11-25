/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DB, as, createDb, createUser, rpc } from "./harness";

/**
 * Live course OHBP: schedule, attendance and make-up, practicals, independent study, the server-timed final exam and
 * the three-condition certificate. Exam items are synthetic (the real bank is not in this public repository);
 * the key is always option index 1.
 */
let db: DB;
let admin: string, cohortId: string;
const C = "OHBP";
const sessions: string[] = [];

const dash = (uid: string) => rpc(db, uid, "live_course_dashboard", [C], ["text"]);
const start = (uid: string) => rpc(db, uid, "live_exam_start", [C], ["text"]);
const get = (uid: string, a: string) => rpc(db, uid, "live_exam_get", [a], ["uuid"]);
const save = (uid: string, a: string, item: string, choice: number | null, seq = Date.now()) =>
  rpc(db, uid, "live_exam_save", [a, item, choice, seq], ["uuid", "uuid", "int", "bigint"]);
const submit = (uid: string, a: string) => rpc(db, uid, "live_exam_submit", [a], ["uuid"]);
const claim = (uid: string, name = "Test Learner") => rpc(db, uid, "study_claim_certificate", [C, name], ["text", "text"]);
const certStatus = (uid: string) => rpc(db, uid, "study_certificate_status", [C], ["text"]);
const file = (uid: string, code: string) => rpc(db, uid, "study_certificate_file", [code], ["text"]);
const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
async function svc(sql: string, p: unknown[] = []) {
  await db.exec("set role service_role");
  try { return (await db.query<any>(sql, p)).rows[0]?.r; } finally { await db.exec("reset role"); }
}

function syntheticForms() {
  const per = [2, 6, 8, 8, 8, 8];
  return ["A", "B"].map((code) => ({
    code,
    items: per.flatMap((n, s) => Array.from({ length: n }, (_, i) => ({
      ref: `${code}-U${s + 1}-${String(i + 1).padStart(2, "0")}`, section: s + 1, syllabus_ref: "x", competency: "x",
      stem: `[TEST FIXTURE] form ${code} unit ${s + 1} item ${i + 1}?`, options: ["a", "b", "c", "d"], answer: 1,
      rationale: "fixture", source: "fixture",
    }))),
  }));
}

/** Pay with Razorpay: order created by the server, then a captured payment confirmed by the webhook. */
async function buy(uid: string, tag: string) {
  const sc = (await one(`select id from study_courses where code = 'OHBP'`)).id;
  await db.query(`insert into checkout_orders (provider_order_id, user_id, study_course_id, access_days, amount_minor, currency)
                  values ($1, $2, $3, 365, 10000, 'USD')`, [`order_${tag}`, uid, sc]);
  const r = await svc(`select public.service_fulfil_checkout_order($1, $2, 10000, 'USD', 'order.paid', '{}'::jsonb) r`, [`order_${tag}`, `pay_${tag}`]);
  expect(r.granted).toBe(true);
  return (await one(`select id from study_enrollments where user_id = $1`, [uid])).id as string;
}
async function learner(name: string, paid = true) {
  const uid = await createUser(db, { username: name });
  let enr: string;
  if (paid) enr = await buy(uid, name);
  else {
    // administrator-granted pilot access (no purchase)
    const v = await one(`select v.id, v.course_id from study_course_versions v join study_courses c on c.id = v.course_id where c.code = 'OHBP'`);
    enr = (await one(`insert into study_enrollments (user_id, course_id, version_id, access_source) values ($1, $2, $3, 'admin') returning id`,
      [uid, v.course_id, v.id])).id;
  }
  expect((await rpc(db, admin, "admin_live_assign", [enr, cohortId], ["uuid", "uuid"])).ok).toBe(true);
  return { uid, enr };
}
async function attendAll(enr: string, except: number[] = []) {
  for (let i = 0; i < sessions.length; i++) {
    const r = await rpc(db, admin, "admin_live_record_attendance",
      [sessions[i], JSON.stringify([{ enrollment: enr, status: except.includes(i) ? "absent" : "present", minutes: 120 }])], ["uuid", "jsonb"]);
    expect(r.ok).toBe(true);
  }
}
async function passPracticals(uid: string) {
  for (const p of ["P1", "P2", "P3", "P4", "P5"]) {
    const s = await rpc(db, uid, "live_submit_practical", [C, p, "My worked answer for the practical.", null, null, "session"],
      ["text", "text", "text", "text", "text", "text"]);
    expect(s.ok).toBe(true);
    expect((await rpc(db, admin, "admin_live_mark_practical", [s.id, 8, "Good work, clear reasoning."], ["uuid", "int", "text"])).passed).toBe(true);
  }
}
async function independent(uid: string) {
  for (let u = 1; u <= 6; u++) {
    await rpc(db, uid, "scorm_launch", ["ohbp-study", `unit-${u}`], ["text", "text"]);
    await rpc(db, uid, "scorm_commit", ["ohbp-study", `unit-${u}`, JSON.stringify({ lesson_status: "completed" }), true],
      ["text", "text", "jsonb", "boolean"]);
  }
}
async function completeActivities(uid: string, enr: string) {
  await attendAll(enr);
  await passPracticals(uid);
  await independent(uid);
}
/** Sit the exam and get exactly `correct` items right. */
async function sit(uid: string, correct: number) {
  const s = await start(uid);
  expect(s.ok).toBe(true);
  const g = await get(uid, s.attempt_id);
  for (let i = 0; i < g.items.length; i++) {
    expect((await save(uid, s.attempt_id, g.items[i].id, i < correct ? 1 : 2)).ok).toBe(true);
  }
  return { attempt: s.attempt_id as string, result: await submit(uid, s.attempt_id) };
}
async function finalizeCertificate(uid: string) {
  const c = await claim(uid);
  expect(c.ok).toBe(true);
  if (c.state === "issued") return c.certificate.certificate_code as string;
  const f = await svc(`select public.service_finalize_study_certificate($1::uuid, $2::uuid, 'certificates/x.pdf', $3, 100) r`,
    [c.certificate.id, c.claim_token, "a".repeat(64)]);
  expect(f.ok).toBe(true);
  return c.certificate.certificate_code as string;
}

describe("live course OHBP", () => {
  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, { username: "admin", role: "admin" });
    await db.query(`update scorm_courses set status = 'published' where code in ('ohbp-study', 'ohbp-slides')`);
    const r = await rpc(db, admin, "admin_live_create_cohort", [C, "OHBP-2027-01", "January 2027 cohort", "Asia/Kuwait"], ["text", "text", "text", "text"]);
    cohortId = r.cohort_id;
    const rows = (await db.query<any>(`select s.id from live_sessions s join live_session_plan p on p.id = s.plan_id where s.cohort_id = $1 order by p.session_no`, [cohortId])).rows;
    for (const [i, row] of rows.entries()) {
      sessions.push(row.id);
      const start = new Date(Date.now() - (40 - i) * 86400_000);
      const u = await rpc(db, admin, "admin_live_update_session",
        [row.id, start.toISOString(), new Date(start.getTime() + 2.5 * 3600_000).toISOString(),
         `https://teams.microsoft.com/l/meetup-join/test-${i}`, `https://iparkar.sharepoint.com/rec/${i}`, "Instructor"],
        ["uuid", "timestamptz", "timestamptz", "text", "text", "text"]);
      expect(u.ok).toBe(true);
    }
    const imp = await svc(`select public.service_live_import_exam($1::jsonb) r`, [JSON.stringify({ course: C, forms: syntheticForms() })]);
    expect(imp.items).toBe(80);
    for (const f of ["A", "B"]) expect((await rpc(db, admin, "admin_live_set_form", [C, f, true, true], ["text", "text", "boolean", "boolean"])).ok).toBe(true);
  });

  it("seeds 12 sessions totalling 1,740 live minutes, 5 practicals, 6 independent modules and a 36-hour certificate", async () => {
    expect(sessions.length).toBe(12);
    expect(Number((await one(`select sum(minutes) s from live_session_plan`)).s)).toBe(1740);
    expect(Number((await one(`select count(*) n from live_practicals`)).n)).toBe(5);
    expect(Number((await one(`select sum(m.minutes) s from scorm_modules m join scorm_courses c on c.id = m.course_id where c.code = 'ohbp-study'`)).s)).toBe(360);
    expect((await one(`select hours, completion_rule from study_certificate_programs where course_code = 'OHBP'`))).toMatchObject({ hours: "36.00", completion_rule: "live" });
  });

  it("refuses a non-Teams joining link and a form that has not been reviewed", async () => {
    const r = await rpc(db, admin, "admin_live_update_session", [sessions[0], null, null, "https://evil.example.com/x", null, null],
      ["uuid", "timestamptz", "timestamptz", "text", "text", "text"]);
    expect(r.error).toBe("invalid");
    expect((await rpc(db, admin, "admin_live_set_form", [C, "A", true, false], ["text", "text", "boolean", "boolean"])).error).toBe("review_first");
  });

  it("shows joining links only to enrolled learners with a verified purchase", async () => {
    const stranger = await createUser(db, { username: "stranger" });
    expect((await dash(stranger)).error).toBe("not_enrolled");
    const { uid } = await learner("paid1");
    await db.query(`update live_sessions set starts_at = now() + interval '1 day', ends_at = now() + interval '1 day 2 hours' where id = $1`, [sessions[11]]);
    const d = await dash(uid);
    expect(d.purchase_verified).toBe(true);
    expect(d.sessions[11].join_url).toMatch(/^https:\/\/teams\.microsoft\.com/);
    expect(d.sessions[0].join_url).toBeNull();                 // past sessions: recording instead of a link
    const pilot = await learner("pilotlinks", false);
    expect((await dash(pilot.uid)).sessions[11].join_url).toMatch(/^https:/);   // administrator access also sees links
    await db.query(`update live_sessions set starts_at = now() - interval '29 days', ends_at = now() - interval '29 days' + interval '150 minutes' where id = $1`, [sessions[11]]);
    // learners can never read the tables directly
    await expect(as(db, uid, `select * from live_sessions`)).rejects.toThrow();
    await expect(as(db, uid, `select * from live_exam_keys`)).rejects.toThrow();
  });

  it("locks independent-study modules to learners with access", async () => {
    const outsider = await createUser(db, { username: "outsider" });
    expect(await rpc(db, outsider, "scorm_can_view", ["ohbp-study", "unit-1"], ["text", "text"])).toBe(false);
    const { uid } = await learner("paid2");
    expect(await rpc(db, uid, "scorm_can_view", ["ohbp-study", "unit-1"], ["text", "text"])).toBe(true);
    const mine = await rpc(db, uid, "scorm_my_courses");
    expect(mine.some((c: any) => c.code.startsWith("ohbp"))).toBe(false);
  });

  it("keeps the exam locked until every live session, practical and independent module is complete", async () => {
    const { uid, enr } = await learner("partial");
    expect((await start(uid)).error).toBe("activities_incomplete");
    await attendAll(enr, [3]);                       // missed session 4
    await passPracticals(uid);
    await independent(uid);
    expect((await dash(uid)).activities_complete).toBe(false);
    expect((await start(uid)).error).toBe("activities_incomplete");

    // make-up: recording + task, then instructor approval
    expect((await rpc(db, uid, "live_submit_makeup", [sessions[3], "short", true], ["uuid", "text", "boolean"])).error).toBe("too_short");
    expect((await rpc(db, uid, "live_submit_makeup", [sessions[3], "A full reflection on what I learned from the recording.", false], ["uuid", "text", "boolean"])).error).toBe("watch_recording");
    // session 4 ended about 36 days ago: past the 14-day window
    expect((await rpc(db, uid, "live_submit_makeup", [sessions[3], "A full reflection on what I learned from the recording.", true], ["uuid", "text", "boolean"])).error).toBe("deadline_passed");
    await db.query(`insert into live_makeups (session_id, enrollment_id, response, deadline_override) values ($1, $2, 'placeholder text for override', now() + interval '3 days')`, [sessions[3], enr]);
    expect((await rpc(db, uid, "live_submit_makeup", [sessions[3], "A full reflection on what I learned from the recording.", true], ["uuid", "text", "boolean"])).ok).toBe(true);
    expect((await dash(uid)).activities_complete).toBe(false);   // submitted, not yet approved
    expect((await rpc(db, admin, "admin_live_review_makeup", [sessions[3], enr, true, "Thank you.", null], ["uuid", "uuid", "boolean", "text", "timestamptz"])).ok).toBe(true);
    expect((await dash(uid)).activities_complete).toBe(true);
    expect((await start(uid)).ok).toBe(true);
  });

  it("allows one resubmission of a failed practical, and none after a pass", async () => {
    const { uid } = await learner("resub");
    const s1 = await rpc(db, uid, "live_submit_practical", [C, "P2", "First try", null, null, "session"], ["text", "text", "text", "text", "text", "text"]);
    expect((await rpc(db, uid, "live_submit_practical", [C, "P2", "Again", null, null, "session"], ["text", "text", "text", "text", "text", "text"])).error).toBe("awaiting_marking");
    await rpc(db, admin, "admin_live_mark_practical", [s1.id, 5, "Units missing in step 2."], ["uuid", "int", "text"]);
    const s2 = await rpc(db, uid, "live_submit_practical", [C, "P2", "Second try", null, null, "individual"], ["text", "text", "text", "text", "text", "text"]);
    expect(s2.attempt_no).toBe(2);
    await rpc(db, admin, "admin_live_mark_practical", [s2.id, 4, "Still incorrect; book a clinic."], ["uuid", "int", "text"]);
    expect((await rpc(db, uid, "live_submit_practical", [C, "P2", "Third", null, null, "clinic"], ["text", "text", "text", "text", "text", "text"])).error).toBe("no_resubmissions_left");
    // a file key outside the learner's own folder is refused
    expect((await rpc(db, uid, "live_submit_practical", [C, "P3", null, `live-submissions/${admin}/x.pdf`, "x.pdf", "session"], ["text", "text", "text", "text", "text", "text"])).error).toBe("bad_file");
  });

  it("scores 23/40 as a fail and 24/40 as a pass; repeat submissions return the same result", async () => {
    const { uid, enr } = await learner("scorer");
    await completeActivities(uid, enr);
    const fail = await sit(uid, 23);
    expect(fail.result).toMatchObject({ ok: true, score: 23, max: 40, passed: false, status: "submitted" });
    expect(fail.result.revise.length).toBeGreaterThan(0);
    expect(await submit(uid, fail.attempt)).toMatchObject({ score: 23, passed: false });
    expect((await save(uid, fail.attempt, (await one(`select item_ids[1] i from live_exam_attempts where id = $1`, [fail.attempt])).i, 1)).error).toBe("ATTEMPT_CLOSED");

    // 7-day cooldown, then the unseen form
    expect((await start(uid)).error).toBe("cooldown");
    await db.query(`update live_exam_attempts set finished_at = now() - interval '8 days' where id = $1`, [fail.attempt]);
    const pass = await sit(uid, 24);
    expect(pass.result).toMatchObject({ score: 24, passed: true });
    const forms = (await db.query<any>(`select f.code from live_exam_attempts a join live_exam_forms f on f.id = a.form_id where a.enrollment_id = $1 order by a.attempt_no`, [enr])).rows;
    expect(forms.map((f: any) => f.code)).toEqual(["A", "B"]);
    expect((await start(uid)).error).toBe("passed");
  });

  it("keeps the deadline across reconnects and submits saved answers on expiry", async () => {
    const { uid, enr } = await learner("timer");
    await completeActivities(uid, enr);
    const s = await start(uid);
    const g1 = await get(uid, s.attempt_id);
    for (let i = 0; i < 30; i++) await save(uid, s.attempt_id, g1.items[i].id, 1);
    // reconnect: start again resumes the same attempt with the original deadline and saved answers
    const again = await start(uid);
    expect(again).toMatchObject({ ok: true, resumed: true, attempt_id: s.attempt_id });
    const g2 = await get(uid, s.attempt_id);
    expect(g2.attempt.deadline_at).toBe(g1.attempt.deadline_at);
    expect(g2.items.filter((i: any) => i.choice === 1).length).toBe(30);
    // stale write ignored
    await save(uid, s.attempt_id, g1.items[0].id, 3, 1);
    expect((await get(uid, s.attempt_id)).items.find((i: any) => i.id === g1.items[0].id).choice).toBe(1);
    // time runs out
    await db.query(`update live_exam_attempts set deadline_at = now() - interval '10 seconds' where id = $1`, [s.attempt_id]);
    expect((await save(uid, s.attempt_id, g1.items[35].id, 1)).error).toBe("ATTEMPT_EXPIRED");
    const r = await rpc(db, uid, "live_exam_result", [s.attempt_id], ["uuid"]);
    expect(r).toMatchObject({ status: "expired", score: 30, passed: true });
  });

  it("closes abandoned attempts with the background job", async () => {
    const { uid, enr } = await learner("abandon");
    await completeActivities(uid, enr);
    const s = await start(uid);
    await db.query(`update live_exam_attempts set deadline_at = now() - interval '5 minutes' where id = $1`, [s.attempt_id]);
    expect(await svc(`select public.live_exam_finalize_expired() r`)).toBeGreaterThanOrEqual(1);
    expect((await one(`select status, score from live_exam_attempts where id = $1`, [s.attempt_id]))).toMatchObject({ status: "expired", score: 0 });
  });

  it("gives approved accommodations 25% more time and stops after the third attempt", async () => {
    const { uid, enr } = await learner("access");
    await completeActivities(uid, enr);
    await rpc(db, admin, "admin_live_set_accommodation", [enr, 25, "Approved"], ["uuid", "int", "text"]);
    for (let n = 0; n < 3; n++) {
      const { attempt } = await sit(uid, 10);
      if (n === 0) expect((await one(`select minutes from live_exam_attempts where id = $1`, [attempt])).minutes).toBe(75);
      await db.query(`update live_exam_attempts set finished_at = now() - interval '8 days' where id = $1`, [attempt]);
    }
    expect((await start(uid)).error).toBe("no_attempts_left");
  });

  it("issues a certificate only when access, activities and exam all hold — once, to the owner", async () => {
    const { uid, enr } = await learner("winner");
    expect((await claim(uid)).error).toBe("course_incomplete");
    await completeActivities(uid, enr);
    expect((await claim(uid)).error).toBe("exam_not_passed");
    await sit(uid, 24);
    expect((await certStatus(uid)).eligible).toBe(true);
    const code = await finalizeCertificate(uid);
    expect(code).toMatch(/^IPL-OHBP-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // repeat requests return the same certificate
    const again = await claim(uid, "Another Name");
    expect(again).toMatchObject({ ok: true, state: "issued" });
    expect(again.certificate.certificate_code).toBe(code);
    expect(Number((await one(`select count(*) n from study_certificates where enrollment_id = $1`, [enr])).n)).toBe(1);
    // download: owner yes, another learner no
    expect((await file(uid, code)).ok).toBe(true);
    const other = await createUser(db, { username: "nosy" });
    expect((await file(other, code)).ok).toBe(false);
    expect((await file(admin, code)).ok).toBe(true);
    // public verification (no sign-in): only what is printed on the certificate
    const v = await rpc(db, null, "study_verify_certificate", [code.toLowerCase()]);
    expect(v).toMatchObject({ ok: true, found: true, valid: true, certificate_code: code, course_title: expect.any(String), issuer: "iParkar Learning" });
    expect(Object.keys(v).sort()).toEqual(["certificate_code", "completed_on", "course_title", "found", "hours", "issued_on", "issuer", "name", "ok", "valid"]);
    expect((await rpc(db, null, "study_verify_certificate", ["IPL-OHBP-0000-0000"])).found).toBe(false);
    expect((await rpc(db, null, "study_verify_certificate", ["not a code"])).found).toBe(false);
  });

  it("issues on administrator-granted access without a payment (access itself needs a purchase or an admin)", async () => {
    const { uid, enr } = await learner("nopay", false);
    await completeActivities(uid, enr);
    expect((await sit(uid, 24)).result.passed).toBe(true);
    expect((await certStatus(uid)).eligible).toBe(true);
    expect(await finalizeCertificate(uid)).toMatch(/^IPL-OHBP-/);
  });

  it("never issues on pilot access, even after passing", async () => {
    const { uid, enr } = await learner("pilot1", false);
    await db.query(`update study_enrollments set is_pilot = true where id = $1`, [enr]);
    await completeActivities(uid, enr);
    expect((await sit(uid, 40)).result.passed).toBe(true);
    expect((await claim(uid)).error).toBe("purchase_required");
    expect((await dash(uid)).certificate.eligible).toBe(false);
  });

  it("blocks a pending (unpaid) order", async () => {
    const uid = await createUser(db, { username: "pending" });
    const sc = (await one(`select id from study_courses where code = 'OHBP'`)).id;
    await db.query(`insert into checkout_orders (provider_order_id, user_id, study_course_id, access_days, amount_minor, currency)
                    values ('order_pending', $1, $2, 365, 10000, 'USD')`, [uid, sc]);
    expect((await dash(uid)).error).toBe("not_enrolled");
    expect((await start(uid)).error).toBe("not_enrolled");
    expect((await claim(uid)).error).toBe("not_enrolled");
  });

  it("a refund or an open dispute withdraws eligibility, including downloads of an issued certificate", async () => {
    const { uid, enr } = await learner("refunded");
    await completeActivities(uid, enr);
    await sit(uid, 30);
    const code = await finalizeCertificate(uid);
    expect((await file(uid, code)).ok).toBe(true);

    await svc(`select public.service_record_payment_dispute('pay_refunded', 'disp_1', 'created', 10000) r`);
    expect((await file(uid, code)).ok).toBe(false);
    expect((await claim(uid)).error).toBe("purchase_required");
    await svc(`select public.service_record_payment_dispute('pay_refunded', 'disp_1', 'won', 10000) r`);
    expect((await file(uid, code)).ok).toBe(true);

    const r = await svc(`select public.service_refund_checkout_payment('pay_refunded', 'rfnd_1', 10000, '{}'::jsonb) r`);
    expect(r.revoked).toBe(true);
    expect((await file(uid, code)).ok).toBe(false);
    expect((await claim(uid)).error).toBe("purchase_required");
    expect((await certStatus(uid)).certificate).toBeNull();
    expect((await rpc(db, null, "study_verify_certificate", [code])).valid).toBe(false);   // refunded: no longer valid
    expect((await file(admin, code)).ok).toBe(true);       // audit copy stays available to administrators
  });

  it("a partial refund also blocks issuance until an administrator reviews it", async () => {
    const { uid, enr } = await learner("partref");
    await completeActivities(uid, enr);
    await sit(uid, 30);
    await svc(`select public.service_refund_checkout_payment('pay_partref', 'rfnd_2', 2000, '{}'::jsonb) r`);
    expect((await claim(uid)).error).toBe("purchase_required");
  });

  it("an offline payment recorded by an administrator counts; its refund does not", async () => {
    const uid = await createUser(db, { username: "offline" });
    const r = await rpc(db, admin, "admin_live_record_purchase", [uid, C, "BANK-123", 3500, "KWD", 365], ["uuid", "text", "text", "bigint", "text", "int"]);
    expect(r.ok).toBe(true);
    expect((await rpc(db, admin, "admin_live_record_purchase", [uid, C, "BANK-123", 3500, "KWD", 365], ["uuid", "text", "text", "bigint", "text", "int"])).error).toBe("duplicate_reference");
    const enr = r.enrollment_id;
    await rpc(db, admin, "admin_live_assign", [enr, cohortId], ["uuid", "uuid"]);
    await completeActivities(uid, enr);
    await sit(uid, 24);
    expect((await certStatus(uid)).eligible).toBe(true);
    await rpc(db, admin, "admin_live_record_refund", ["BANK-123", 3500], ["text", "bigint"]);
    expect((await certStatus(uid)).eligible).toBe(false);
    // learners cannot call admin functions
    expect((await rpc(db, uid, "admin_live_record_purchase", [uid, C, "SELF-1", 1, "USD", 365], ["uuid", "text", "text", "bigint", "text", "int"])).error).toBe("forbidden");
  });

  it("never changes a form that learners have already sat", async () => {
    const r = await db.query<any>(`select public.service_live_import_exam($1::jsonb) r`, [JSON.stringify({ course: C, forms: syntheticForms() })]).catch((e) => e);
    expect(r.rows?.[0]?.r?.error ?? "").toBe("form_in_use");
  });

  it("does not change the PMP certificate rule", async () => {
    expect((await one(`select completion_rule from study_certificate_programs where course_code = 'PMP-SPS'`)).completion_rule).toBe("chapters");
  });
});

// Local check of the real (git-ignored) exam forms, when present: they must load and match the blueprint.
const REAL = "imports/ohbp/ohbp-exam-forms.json";
describe.skipIf(!existsSync(REAL))("real OHBP exam forms (local only)", () => {
  it("import cleanly with 40 items each in the 2/6/8/8/8/8 split", async () => {
    const fresh = await createDb();
    await fresh.exec("set role service_role");
    const r = (await fresh.query<any>(`select public.service_live_import_exam($1::jsonb) r`, [readFileSync(REAL, "utf8")])).rows[0].r;
    await fresh.exec("reset role");
    expect(r).toMatchObject({ ok: true, items: 80 });
    const split = (await fresh.query<any>(`select f.code, string_agg(n::text, '/' order by section) s from (
      select form_id, section, count(*) n from live_exam_items group by 1, 2) x join live_exam_forms f on f.id = x.form_id group by f.code order by f.code`)).rows;
    expect(split).toEqual([{ code: "A", s: "2/6/8/8/8/8" }, { code: "B", s: "2/6/8/8/8/8" }]);
  });
});
