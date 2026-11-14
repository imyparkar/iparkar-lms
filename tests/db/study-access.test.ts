/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB, as, createDb, createUser, rpc } from "./harness";

/**
 * Study-course access: 7-day trial for every signed-in learner, paid 365-day access,
 * refunds, protected drawings and formula-sheet resources. Synthetic lessons only.
 */
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/asp-sps/manifest.json"), "utf8"));

function pkg(version: string) {
  return {
    course: { code: "ASP-SPS", title: manifest.course.title, version },
    source: manifest.source,
    domains: manifest.domains.map((d: any) => ({ domain: d.domain, title: d.title, weight: d.weight })),
    chapters: manifest.chapters.map((c: any, i: number) => ({
      id: c.id, domain: c.domain, sort_order: i + 1, title: c.title, objectives: c.objectives, prerequisite: c.prerequisite, pages: c.pages,
      sections: [{ code: "lesson", sort_order: 1, title: "[TEST] Lesson", blocks: [{ type: "text", md: "Synthetic fixture." }], activities: [] }],
    })),
  };
}

let db: DB;
let admin: string, tia: string, pat: string, ref: string, nob: string;
let courseUuid: string;

const days = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;
async function enrollment(uid: string) {
  return (await db.query<any>(`select * from study_enrollments where user_id = $1`, [uid])).rows[0];
}
async function payment() {
  return (await db.query<{ id: string }>(
    `insert into payments (provider, provider_event_id, event_type, status) values ('paddle', $1, 'transaction.completed', 'completed') returning id`,
    [randomUUID()])).rows[0].id;
}
async function purchase(uid: string, pay: string | null, d = 365) {
  return (await db.query<{ r: any }>(`select public.service_apply_study_purchase($1, $2, $3, $4) r`, [uid, courseUuid, d, pay])).rows[0].r;
}
async function expire(uid: string) {
  await db.query(`update study_enrollments set access_expires_at = now() - interval '1 minute' where user_id = $1`, [uid]);
}

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  tia = await createUser(db, { username: "tia" });
  pat = await createUser(db, { username: "pat" });
  ref = await createUser(db, { username: "ref" });
  nob = await createUser(db, { username: "nob" });
  const res = await rpc(db, admin, "admin_study_import", [JSON.stringify(pkg("1.0.0"))], ["jsonb"]);
  expect(res.ok).toBe(true);
  await db.query(`update study_chapters set review_status = 'approved' where version_id = $1`, [res.version_id]); // fixture stands in for SME review
  expect((await rpc(db, admin, "admin_study_set_version_status", [res.version_id, "published", true], ["uuid", "text", "boolean"])).ok).toBe(true);
  expect((await rpc(db, admin, "admin_study_set_course_access", ["ASP-SPS", "self", 7, 365, "US$120"], ["text", "text", "int", "int", "text"])).ok).toBe(true);
  courseUuid = (await db.query<{ id: string }>(`select id from study_courses where code = 'ASP-SPS'`)).rows[0].id;
  const imp = await rpc(db, admin, "admin_study_import_resources", [JSON.stringify({
    course: "ASP-SPS", version: "1.0.0",
    resources: [{ code: "formulas-1", kind: "formula_sheet", domain: 1, title: "Part 1 formula sheet", pages: [150, 159],
                  blocks: [{ type: "equation", label: "Eq. 1.1-2", tex: "K = C + 273.15", alt: "Kelvin" }] }],
  })], ["jsonb"]);
  expect(imp).toMatchObject({ ok: true, resources: 1 });
}, 120_000);

describe("free trial", () => {
  it("offers the course to a signed-in learner who has not started it", async () => {
    const offers = await rpc(db, nob, "get_study_offers");
    expect(offers).toEqual([expect.objectContaining({ code: "ASP-SPS", self_enroll: true, trial_days: 7, access_days: 365, price_label: "US$120" })]);
    const c = await rpc(db, nob, "get_study_course", ["ASP-SPS"], ["text"]);
    expect(c).toMatchObject({ ok: false, error: "not_enrolled", offer: { trial_days: 7 } });
  });

  it("starting the course gives seven days of access, once", async () => {
    expect(await rpc(db, tia, "study_self_enroll", ["ASP-SPS"], ["text"])).toMatchObject({ ok: true, started: true });
    const e = await enrollment(tia);
    expect(e.access_source).toBe("trial");
    expect(days(e.access_expires_at)).toBeGreaterThan(6.99);
    expect(days(e.access_expires_at)).toBeLessThanOrEqual(7.0001);
    const ch = await rpc(db, tia, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"]);
    expect(ch.ok).toBe(true);
    expect(ch.access).toMatchObject({ has_access: true, source: "trial", days_left: 7 });
    expect(await rpc(db, tia, "get_study_offers")).toEqual([]);

    await expire(tia);
    expect(await rpc(db, tia, "study_self_enroll", ["ASP-SPS"], ["text"])).toMatchObject({ ok: true, started: false });
    expect(new Date((await enrollment(tia)).access_expires_at).getTime()).toBeLessThan(Date.now());
  });

  it("after the trial, chapters, activities, resources and drawings are refused but progress stays visible", async () => {
    const ch = await rpc(db, tia, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"]);
    expect(ch).toMatchObject({ ok: false, error: "access_expired", access: { has_access: false, days_left: 0, price_label: "US$120" } });
    expect(ch.sections).toBeUndefined();
    const course = await rpc(db, tia, "get_study_course", ["ASP-SPS"], ["text"]);
    expect(course.ok).toBe(true);
    expect(course.access.has_access).toBe(false);
    expect(course.progress.required_chapters).toBe(99);
    const sec = (await db.query<{ id: string }>(`select s.id from study_sections s join study_chapters c on c.id = s.chapter_id where c.code = '1.1' limit 1`)).rows[0].id;
    expect(await rpc(db, tia, "study_ack_section", [sec], ["uuid"])).toMatchObject({ ok: false });
    expect(await rpc(db, tia, "get_study_resource", ["ASP-SPS", "formulas-1"], ["text", "text"])).toMatchObject({ ok: false, error: "access_expired" });
    expect(await rpc(db, tia, "study_can_view_asset", ["asp-sps/fig-1.4-1-abc.webp"], ["text"])).toBe(false);
    const mine = await rpc(db, tia, "get_my_study_courses");
    expect(mine[0].access.has_access).toBe(false);
  });
});

describe("paid access", () => {
  it("a verified purchase replaces the trial with 365 days from now", async () => {
    await rpc(db, pat, "study_self_enroll", ["ASP-SPS"], ["text"]);
    const r = await purchase(pat, await payment());
    expect(r.ok).toBe(true);
    const e = await enrollment(pat);
    expect(e.access_source).toBe("purchase");
    expect(days(e.access_expires_at)).toBeGreaterThan(364.99);
    expect(days(e.access_expires_at)).toBeLessThan(365.01);
    expect((await rpc(db, pat, "get_study_chapter", ["ASP-SPS", "2.1"], ["text", "text"])).ok).toBe(true);
    expect(await rpc(db, pat, "get_study_resource", ["ASP-SPS", "formulas-1"], ["text", "text"])).toMatchObject({ ok: true, resource: { title: "Part 1 formula sheet" } });
    expect(await rpc(db, pat, "study_can_view_asset", ["asp-sps/fig-1.4-1-abc.webp"], ["text"])).toBe(true);
    expect(await rpc(db, pat, "study_can_view_asset", ["../secret.webp"], ["text"])).toBe(false);
    expect(await rpc(db, pat, "study_can_view_asset", ["other-course/x.webp"], ["text"])).toBe(false);
  });

  it("is idempotent per payment and a renewal extends unexpired paid time", async () => {
    const pay = await payment();
    const before = new Date((await enrollment(pat)).access_expires_at).getTime();
    expect((await purchase(pat, pay)).ok).toBe(true);
    expect(await purchase(pat, pay)).toMatchObject({ ok: true, duplicate: true });
    const after = new Date((await enrollment(pat)).access_expires_at).getTime();
    expect(Math.round((after - before) / 86_400_000)).toBe(365);
  });

  it("buying without starting the trial enrols into the published version", async () => {
    const buyer = await createUser(db, { username: "buyer" });
    expect((await purchase(buyer, await payment())).ok).toBe(true);
    expect((await enrollment(buyer)).access_source).toBe("purchase");
  });

  it("a refund takes back that payment's days but keeps progress", async () => {
    await rpc(db, ref, "study_self_enroll", ["ASP-SPS"], ["text"]);
    const pay = await payment();
    await purchase(ref, pay);
    await rpc(db, ref, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"]);
    const r = (await db.query<{ r: any }>(`select public.service_revoke_study_purchase($1, 'Refunded') r`, [pay])).rows[0].r;
    expect(r.ok).toBe(true);
    const e = await enrollment(ref);
    expect(days(e.access_expires_at)).toBeLessThan(0.01);
    expect((await rpc(db, ref, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"])).error).toBe("access_expired");
    expect((await db.query(`select 1 from study_chapter_progress where enrollment_id = $1`, [e.id])).rows.length).toBe(1);
  });

  it("does not touch practice-exam entitlements, and learners cannot call the service functions", async () => {
    expect((await db.query(`select 1 from course_entitlements where user_id = $1`, [pat])).rows.length).toBe(0);
    await expect(as(db, nob, `select public.service_apply_study_purchase('${nob}', '${courseUuid}', 365, null)`)).rejects.toThrow(/permission denied/);
    await expect(as(db, nob, `select * from study_products`)).resolves.toEqual([]);
  });
});

describe("administration", () => {
  it("admin and pilot enrollments have no time limit; admins can set access by hand", async () => {
    const staff = await createUser(db, { username: "staff" });
    const v = (await db.query<{ id: string }>(`select id from study_course_versions where version = '1.0.0'`)).rows[0].id;
    const r = await rpc(db, admin, "admin_study_enroll", [staff, v, false], ["uuid", "uuid", "boolean"]);
    expect(r.ok).toBe(true);
    const e = await enrollment(staff);
    expect(e.access_expires_at).toBeNull();
    expect((await rpc(db, staff, "get_study_chapter", ["ASP-SPS", "9.7"], ["text", "text"])).access.has_access).toBe(true);
    expect((await rpc(db, admin, "admin_study_set_access", [e.id, null, ""], ["uuid", "timestamptz", "text"])).error).toBe("reason_required");
    const t = (await enrollment(tia)).id;
    expect((await rpc(db, admin, "admin_study_set_access", [t, new Date(Date.now() + 3 * 86_400_000).toISOString(), "Support extension"], ["uuid", "timestamptz", "text"])).ok).toBe(true);
    expect((await rpc(db, tia, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"])).ok).toBe(true);
    expect((await rpc(db, tia, "admin_study_set_access", [t, null, "x"], ["uuid", "timestamptz", "text"])).error).toBe("forbidden");
    expect(await rpc(db, admin, "study_can_view_asset", ["asp-sps/fig-1.4-1-abc.webp"], ["text"])).toBe(true);
  });
});
