/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB, createDb, createUser, rpc } from "./harness";

/**
 * Certificates of course completion (PMP-SPS). The manifest is the real 52-chapter structure; lesson content is
 * synthetic (one section + one activity per chapter) because the course content is not in this public repository.
 */
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/pmp-sps/manifest.json"), "utf8"));
const SHA = "a".repeat(64);

function synthetic(m: any) {
  return {
    course: { code: "PMP-SPS", title: m.course.title, version: "9.9.9-test" },
    source: m.source,
    domains: m.domains.map((d: any) => ({ domain: d.domain, title: d.title, weight: d.weight })),
    chapters: m.chapters.map((c: any, i: number) => ({
      id: c.id, domain: c.domain, sort_order: i + 1, title: c.title, objectives: c.objectives, prerequisite: false,
      sections: [{ code: "knowledge-check", sort_order: 1, title: "[TEST] Check", blocks: [{ type: "text", md: "Synthetic fixture." }],
        activities: [{ code: "kc-1", kind: "single_choice", spec: { prompt: "Pick b", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] },
          answer_key: { correct: "b" }, sample_response: { choice: "b" }, feedback: { explanation: "B is right." } }] }],
    })),
  };
}

let db: DB;
let admin: string, ana: string, ben: string, cal: string, dee: string;
let versionId: string;

async function chapterId(code: string) {
  return (await db.query<{ id: string }>(`select id from study_chapters where version_id = $1 and code = $2`, [versionId, code])).rows[0].id;
}
async function study(uid: string, code: string) {
  const c = await rpc(db, uid, "get_study_chapter", ["PMP-SPS", code], ["text", "text"]);
  for (const s of c.sections) {
    await rpc(db, uid, "study_open_section", [s.id], ["uuid"]);
    await rpc(db, uid, "study_ack_section", [s.id], ["uuid"]);
    for (const a of s.activities) {
      // A wrong answer still counts: submission is the completion criterion, there is no pass mark.
      const r = await rpc(db, uid, "study_submit_activity", [a.id, JSON.stringify({ choice: "a" }), randomUUID()], ["uuid", "jsonb", "uuid"]);
      await rpc(db, uid, "study_ack_feedback", [r.attempt_id], ["uuid"]);
    }
  }
  return rpc(db, uid, "study_finish_chapter", [await chapterId(code)], ["uuid"]);
}
async function completeAll(uid: string) {
  let last: any;
  for (const c of manifest.chapters) last = await study(uid, c.id);
  return last;
}
const status = (uid: string) => rpc(db, uid, "study_certificate_status", ["PMP-SPS"], ["text"]);
const claim = (uid: string, name: string) => rpc(db, uid, "study_claim_certificate", ["PMP-SPS", name], ["text", "text"]);
async function asService<T = any>(sql: string, params: unknown[] = []) {
  await db.exec("set role service_role");
  try { return (await db.query<{ r: T }>(sql, params)).rows[0].r; } finally { await db.exec("reset role"); }
}
const finalize = (id: string, token: string, key = `certificates/x/${id}.pdf`, sha = SHA) =>
  asService(`select public.service_finalize_study_certificate($1::uuid, $2::uuid, $3, $4, 1234) as r`, [id, token, key, sha]);
const release = (id: string, token: string) =>
  asService(`select public.service_release_study_certificate_claim($1::uuid, $2::uuid) as r`, [id, token]);

describe("study certificates (PMP-SPS)", () => {
  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, { username: "admin", role: "admin" });
    ana = await createUser(db, { username: "ana" });
    ben = await createUser(db, { username: "ben" });
    cal = await createUser(db, { username: "cal" });
    dee = await createUser(db, { username: "dee" });
    const res = await rpc(db, admin, "admin_study_import", [JSON.stringify(synthetic(manifest))], ["jsonb"]);
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ domains: 9, chapters: 52, chapters_with_content: 52 });
    versionId = res.version_id;
    for (const u of [ana, ben, cal, dee]) expect((await rpc(db, admin, "admin_study_enroll", [u, versionId, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
    await db.query(`update profiles set full_name = 'Ben Okafor' where id = $1`, [ben]);
  }, 300_000);

  it("seeds the PMP programme: 35 hours, 8/19/8, hours wording", async () => {
    const p = (await db.query<any>(`select * from study_certificate_programs where course_code = 'PMP-SPS'`)).rows[0];
    expect(Number(p.hours)).toBe(35);
    expect(p.categories).toEqual({ businessAcumen: 8, waysOfWorking: 19, powerSkills: 8 });
    expect(p.wording).toBe("hours");
    expect(p.issuer).toBe("iParkar Learning");
    const sum = manifest.domains.reduce((s: number, d: any) => s + d.weight, 0);
    expect(sum).toBe(35);
  });

  it("locks the certificate until every required chapter is finished, even after the second-to-last one", async () => {
    const s0 = await status(ana);
    expect(s0).toMatchObject({ ok: true, offered: true, enrolled: true, completed: false, eligible: false, certificate: null });
    expect((await claim(ana, "Ana Silva")).error).toBe("course_incomplete");
    const chapters = manifest.chapters.map((c: any) => c.id);
    for (const c of chapters.slice(0, -1)) await study(ana, c);
    expect((await status(ana)).eligible).toBe(false);
    expect((await claim(ana, "Ana Silva")).error).toBe("course_incomplete");
    const last = await study(ana, chapters.at(-1));
    expect(last.course_completed).toBe(true);
    expect((await status(ana))).toMatchObject({ completed: true, eligible: true, suggested_name: "ana" });
  }, 300_000);

  it("rejects learners who are not signed in, not enrolled or revoked", async () => {
    await expect(rpc(db, null, "study_certificate_status", ["PMP-SPS"], ["text"])).rejects.toThrow(/permission denied/);
    await expect(rpc(db, null, "study_claim_certificate", ["PMP-SPS", "Ana Silva"], ["text", "text"])).rejects.toThrow(/permission denied/);
    const outsider = await createUser(db, { username: "eve" });
    expect((await claim(outsider, "Eve Adams")).error).toBe("not_enrolled");
    expect((await rpc(db, outsider, "study_certificate_file", ["IPL-PMP-0000-0000"], ["text"])).error).toBe("not_found");
    // Ana completed the course; once her enrollment is revoked she cannot generate a certificate.
    const enr = (await db.query<{ id: string }>(`select id from study_enrollments where user_id = $1`, [ana])).rows[0].id;
    expect((await rpc(db, admin, "admin_study_revoke", [enr, "test"], ["uuid", "text"])).ok).toBe(true);
    expect((await status(ana))).toMatchObject({ completed: true, eligible: false });
    expect((await claim(ana, "Ana Silva")).error).toBe("not_enrolled");
  });

  it("issues exactly one certificate under concurrent clicks and stores it before reporting issued", async () => {
    await completeAll(ben);
    const results = await Promise.all([1, 2, 3, 4].map(() => claim(ben, "Ben  Okafor ")));
    const claimed = results.filter((r) => r.state === "claimed");
    expect(claimed).toHaveLength(1);
    expect(results.filter((r) => r.error === "in_progress")).toHaveLength(3);
    const c = claimed[0];
    expect(c.certificate.name_on_certificate).toBe("Ben Okafor");
    expect(c.certificate.certificate_code).toMatch(/^IPL-PMP-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(c.certificate).toMatchObject({ hours: 35, categories: { businessAcumen: 8, waysOfWorking: 19, powerSkills: 8 }, wording: "hours" });
    // Still pending: nothing to download, and the status shows it is not issued yet.
    expect((await status(ben)).certificate.status).toBe("pending");
    expect((await rpc(db, ben, "study_certificate_file", [c.certificate.certificate_code], ["text"])).ok).toBe(false);
    // A stale or forged token cannot finalize.
    expect((await finalize(c.certificate.id, randomUUID())).error).toBe("claim_lost");
    const f = await finalize(c.certificate.id, c.claim_token, `certificates/${ben}/${c.certificate.certificate_code}.pdf`);
    expect(f).toMatchObject({ ok: true, state: "issued" });
    expect((await rpc(db, ben, "study_my_certificates")).map((x: any) => x.certificate_code)).toEqual([c.certificate.certificate_code]);
    // Retrying after success returns the same certificate, never a second one or a new name.
    const again = await claim(ben, "Benjamin Okafor");
    expect(again).toMatchObject({ ok: true, state: "issued" });
    expect(again.certificate.certificate_code).toBe(c.certificate.certificate_code);
    expect(again.certificate.name_on_certificate).toBe("Ben Okafor");
    expect((await db.query(`select count(*)::int n from study_certificates where user_id = $1`, [ben])).rows[0]).toEqual({ n: 1 });
  }, 300_000);

  it("keeps the same certificate code after a failed save and lets the learner retry at once", async () => {
    await completeAll(cal);
    const first = await claim(cal, "Zoë O'Brien-Núñez");
    expect(first.state).toBe("claimed");
    expect((await release(first.certificate.id, first.claim_token)).ok).toBe(true);
    const retry = await claim(cal, "Zoë O’Brien-Núñez Castellanos de la Vega y Montoya-Fitzgerald");
    expect(retry.state).toBe("claimed");
    expect(retry.certificate.certificate_code).toBe(first.certificate.certificate_code);
    expect(retry.certificate.name_on_certificate).toBe("Zoë O’Brien-Núñez Castellanos de la Vega y Montoya-Fitzgerald");
    expect((await finalize(retry.certificate.id, retry.claim_token)).ok).toBe(true);
    const row = (await db.query<any>(`select attempts, status from study_certificates where id = $1`, [retry.certificate.id])).rows[0];
    expect(row).toEqual({ attempts: 2, status: "issued" });
  }, 300_000);

  it("validates names on the server", async () => {
    await completeAll(dee);
    for (const bad of ["", "A", "R2-D2", "Dee <script>", "x".repeat(71), "Dee  Jones\u0007"]) {
      expect((await claim(dee, bad)).error, bad).toBe("invalid_name");
    }
    expect((await claim(dee, "Dée-Ann St. John")).state).toBe("claimed");
  }, 300_000);

  it("lets only the owner or an admin download, and only service code can finalize", async () => {
    const code = (await rpc(db, ben, "study_my_certificates"))[0].certificate_code;
    const own = await rpc(db, ben, "study_certificate_file", [code.toLowerCase()], ["text"]);
    expect(own).toMatchObject({ ok: true, storage_key: `certificates/${ben}/${code}.pdf`, sha256: SHA });
    expect((await rpc(db, cal, "study_certificate_file", [code], ["text"])).error).toBe("not_found");
    expect((await rpc(db, admin, "study_certificate_file", [code], ["text"])).ok).toBe(true);
    const id = (await db.query<{ id: string }>(`select id from study_certificates where certificate_code = $1`, [code])).rows[0].id;
    await expect(rpc(db, ben, "service_finalize_study_certificate", [id, randomUUID(), "k", SHA, 1], ["uuid", "uuid", "text", "text", "int"]))
      .rejects.toThrow(/permission denied/);
    await expect(rpc(db, ben, "service_release_study_certificate_claim", [id, randomUUID()], ["uuid", "uuid"])).rejects.toThrow(/permission denied/);
  });

  it("keeps issued certificates immutable; a profile rename changes nothing", async () => {
    await db.query(`update profiles set full_name = 'Someone Else' where id = $1`, [ben]);
    expect((await status(ben)).certificate.name_on_certificate).toBe("Ben Okafor");
    await expect(db.query(`update study_certificates set name_on_certificate = 'Changed' where user_id = $1`, [ben])).rejects.toThrow(/immutable/);
    await expect(db.query(`delete from study_certificates where user_id = $1`, [ben])).rejects.toThrow(/cannot be deleted/);
    // A later course version does not touch the completion snapshot the certificate was issued from.
    const c = (await db.query<any>(`select version_label, completed_at from study_certificates where user_id = $1`, [ben])).rows[0];
    expect(c.version_label).toBe("9.9.9-test");
  });

  it("gives learners no direct table access", async () => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ben]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query(`select * from study_certificates`)).rows).toEqual([]);
      await expect(db.query(`update study_certificates set status = 'pending'`)).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
});
