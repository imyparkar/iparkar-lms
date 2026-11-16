/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DB, createDb, createUser, rpc } from "./harness";
import { buildPackage } from "../../src/lib/study/package";

/**
 * CSP Self Paced Study Course. The manifest is the real 60-chapter structure extracted from the
 * Reader edition; lesson content is synthetic here (one section + one activity per chapter) so the
 * completion rules run end to end without shipping guide content in this public repository.
 */
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/csp-sps/manifest.json"), "utf8"));
const aspManifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/asp-sps/manifest.json"), "utf8"));

/** BCSP CSP11 Examination Blueprint V.2024.04.24: objectives per domain (47 in all). */
const BLUEPRINT: Record<number, number> = { 1: 7, 2: 14, 3: 4, 4: 5, 5: 5, 6: 6, 7: 6 };

function synthetic(m: any, code: string, version = "9.9.9-test") {
  return {
    course: { code, title: m.course.title, version },
    source: m.source,
    domains: m.domains.map((d: any) => ({ domain: d.domain, title: d.title, weight: d.weight })),
    chapters: m.chapters.map((c: any, i: number) => ({
      id: c.id, domain: c.domain, sort_order: i + 1, title: c.title, objectives: c.objectives,
      prerequisite: c.prerequisite, pages: c.pages,
      sections: [{ code: "lesson", sort_order: 1, title: "[TEST] Lesson", blocks: [{ type: "text", md: "Synthetic fixture." }],
        activities: [{ code: "check", kind: "single_choice", spec: { prompt: "Pick b", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] },
          answer_key: { correct: "b" }, sample_response: { choice: "b" }, feedback: { explanation: "B is right." } }] }],
    })),
  };
}

describe("CSP curriculum manifest", () => {
  const ch = manifest.chapters as any[];
  it("has seven domains and 60 unique chapters with counts 11/14/5/5/5/14/6", () => {
    expect(manifest.domains).toHaveLength(7);
    expect(new Set(ch.map((c) => c.id)).size).toBe(60);
    const counts = [1, 2, 3, 4, 5, 6, 7].map((d) => ch.filter((c) => c.domain === d).length);
    expect(counts).toEqual([11, 14, 5, 5, 5, 14, 6]);
    expect(manifest.domains.map((d: any) => d.chapter_count)).toEqual(counts);
    expect(manifest.domains.reduce((s: number, d: any) => s + d.weight, 0)).toBe(100);
    expect(manifest.domains.map((d: any) => d.weight)).toEqual([25, 25, 15, 9, 6, 10, 10]);
    expect(manifest.validation.ok).toBe(true);
  });

  it("keeps the guide's chapter order and its non-sequential objective mapping", () => {
    const obj = (id: string) => ch.find((c) => c.id === id).objectives;
    expect(ch.map((c) => c.id).slice(0, 3)).toEqual(["1.1", "1.2", "1.3"]);
    expect(obj("2.1")).toEqual(["2.8"]);
    expect(obj("2.2")).toEqual(["2.1", "2.2"]);
    expect(obj("2.13")).toEqual(["2.14"]);
    expect(obj("2.14")).toEqual(["2.14"]);
    for (let n = 1; n <= 9; n++) expect(obj(`6.${n}`)).toEqual(["6.1"]);
    expect(obj("6.10")).toEqual(["6.3"]);
    expect(obj("6.11")).toEqual(["6.2"]);
    expect(["7.1", "7.2", "7.3", "7.4", "7.5", "7.6"].map((id) => obj(id)[0])).toEqual(["7.1", "7.6", "7.2", "7.5", "7.3", "7.4"]);
  });

  it("covers every one of the 47 blueprint objectives and maps nothing outside the blueprint", () => {
    const all = Object.entries(BLUEPRINT).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => `${d}.${i + 1}`));
    expect(all).toHaveLength(47);
    const mapped = new Set(ch.flatMap((c) => c.objectives));
    expect(all.filter((o) => !mapped.has(o))).toEqual([]);
    expect([...mapped].filter((o) => !all.includes(o))).toEqual([]);
  });

  it("marks the guide's primary-topic chapters and keeps cross-links without duplicating chapters", () => {
    expect(ch.filter((c) => c.primary_topic).map((c) => c.id)).toEqual(["1.1", "2.1", "2.7", "2.13", "3.1", "3.3", "4.3", "6.1"]);
    for (const c of ch) for (const x of c.cross_links) expect(ch.some((o) => o.id === x)).toBe(true);
    expect(ch.find((c) => c.id === "3.1").outline_note).toBe("pilot chapter, drafted below");
  });

  it("has contiguous, non-overlapping page ranges inside the 1,203-page guide", () => {
    expect(manifest.source.pdf_pages).toBe(1203);
    for (let i = 0; i < ch.length; i++) {
      const [a, b] = ch[i].pages;
      expect(a).toBeLessThanOrEqual(b);
      if (i) expect(a).toBeGreaterThan(ch[i - 1].pages[1]);
    }
    expect(ch[0].pages[0]).toBe(10);
    expect(ch[59].pages[1]).toBeLessThan(manifest.source.back_matter.glossary[0]);
  });

  it("is not the ASP curriculum", () => {
    expect(manifest.course.code).toBe("CSP-SPS");
    expect(manifest.source.stated_blueprint).toBe("CSP11 V.2024.04.24");
    expect(ch.map((c) => c.title)).not.toEqual(aspManifest.chapters.slice(0, 60).map((c: any) => c.title));
  });

  it("builds a valid import package (and validates any authored chapters present locally)", () => {
    const dir = join(import.meta.dirname, "../../imports/csp-sps/chapters");
    const raw = existsSync(dir) ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))])) : {};
    const { pkg, issues } = buildPackage(manifest, raw);
    expect(issues).toEqual([]);
    expect(pkg.chapters).toHaveLength(60);
    expect(pkg.domains).toHaveLength(7);
  });
});

let db: DB;
let admin: string, ana: string, ben: string, cal: string;
let versionId: string;

async function chapter(uid: string, code: string) {
  return rpc(db, uid, "get_study_chapter", ["CSP-SPS", code], ["text", "text"]);
}
async function chapterId(code: string) {
  return (await db.query<{ id: string }>(`select id from study_chapters where version_id = $1 and code = $2`, [versionId, code])).rows[0].id;
}
async function study(uid: string, code: string) {
  const c = await chapter(uid, code);
  for (const s of c.sections) {
    await rpc(db, uid, "study_open_section", [s.id], ["uuid"]);
    await rpc(db, uid, "study_ack_section", [s.id], ["uuid"]);
    for (const a of s.activities) {
      const r = await rpc(db, uid, "study_submit_activity", [a.id, JSON.stringify({ choice: "a" }), randomUUID()], ["uuid", "jsonb", "uuid"]);
      await rpc(db, uid, "study_ack_feedback", [r.attempt_id], ["uuid"]);
    }
  }
  return rpc(db, uid, "study_finish_chapter", [await chapterId(code)], ["uuid"]);
}

describe("CSP course in the study engine", () => {
  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, { username: "admin", role: "admin" });
    ana = await createUser(db, { username: "ana" });
    ben = await createUser(db, { username: "ben" });
    cal = await createUser(db, { username: "cal" });
    const res = await rpc(db, admin, "admin_study_import", [JSON.stringify(synthetic(manifest, "CSP-SPS"))], ["jsonb"]);
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ domains: 7, chapters: 60, chapters_with_content: 60 });
    versionId = res.version_id;
    for (const u of [ben, cal]) expect((await rpc(db, admin, "admin_study_enroll", [u, versionId, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
  }, 120_000);

  it("refuses content to learners who are not enrolled", async () => {
    expect((await chapter(ana, "1.1")).error).toBe("not_enrolled");
  });

  it("does not complete a chapter on opening, and finishes only after every requirement", async () => {
    const c = await chapter(ben, "1.1");
    expect(c.chapter.status).not.toBe("completed");
    const early = await rpc(db, ben, "study_finish_chapter", [await chapterId("1.1")], ["uuid"]);
    expect(early.ok).toBe(false);
    expect((await study(ben, "1.1")).ok).toBe(true);
  });

  it("stays incomplete at 59 of 60 and completes exactly once at 60 of 60", async () => {
    const codes = manifest.chapters.map((c: any) => c.id);
    for (const code of codes.slice(1, 59)) expect((await study(ben, code)).ok).toBe(true);
    const at59 = await rpc(db, ben, "get_study_course", ["CSP-SPS"], ["text"]);
    expect(at59.progress).toMatchObject({ required_chapters: 60, completed_chapters: 59, domains_total: 7, domains_completed: 6 });
    expect(at59.course.completed_at).toBeNull();

    const last = codes[59];
    const c = await chapter(ben, last);
    await rpc(db, ben, "study_open_section", [c.sections[0].id], ["uuid"]);
    await rpc(db, ben, "study_ack_section", [c.sections[0].id], ["uuid"]);
    const r = await rpc(db, ben, "study_submit_activity", [c.sections[0].activities[0].id, JSON.stringify({ choice: "a" }), randomUUID()], ["uuid", "jsonb", "uuid"]);
    await rpc(db, ben, "study_ack_feedback", [r.attempt_id], ["uuid"]);
    const id = await chapterId(last);
    const results = await Promise.all([1, 2, 3].map(() => rpc(db, ben, "study_finish_chapter", [id], ["uuid"])));
    expect(results.every((x) => x.ok && x.course_completed)).toBe(true);
    expect(results.filter((x) => x.chapter_newly_completed)).toHaveLength(1);
    const n = (await db.query<{ n: number }>(`select count(*)::int n from study_course_completions where user_id = $1`, [ben])).rows[0].n;
    expect(n).toBe(1);
    const cert = await rpc(db, ben, "get_study_completion", ["CSP-SPS"], ["text"]);
    expect(cert).toMatchObject({ ok: true, course_title: "CSP Self Paced Study Course", chapters_completed: 60 });
    expect((await rpc(db, cal, "get_study_completion", ["CSP-SPS"], ["text"])).ok).toBe(false);
  }, 180_000);

  it("keeps CSP and ASP study progress separate", async () => {
    const asp = await rpc(db, admin, "admin_study_import", [JSON.stringify(synthetic(aspManifest, "ASP-SPS"))], ["jsonb"]);
    expect(asp.ok).toBe(true);
    // ben completed CSP but is not enrolled in ASP
    expect((await rpc(db, ben, "get_study_chapter", ["ASP-SPS", "1.1"], ["text", "text"])).error).toBe("not_enrolled");
    expect((await rpc(db, admin, "admin_study_enroll", [ben, asp.version_id, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
    const aspCourse = await rpc(db, ben, "get_study_course", ["ASP-SPS"], ["text"]);
    expect(aspCourse.progress).toMatchObject({ required_chapters: 99, completed_chapters: 0 });
    expect(aspCourse.course.completed_at).toBeNull();
  }, 120_000);

  it("stores the glossary and bibliography as protected resources", async () => {
    const r = await rpc(db, admin, "admin_study_import_resources", [JSON.stringify({ course: "CSP-SPS", version: "9.9.9-test", resources: [
      { code: "glossary", kind: "glossary", title: "Glossary", pages: [1117, 1177], blocks: [{ type: "glossary", terms: [{ term: "[TEST]", definition: "Fixture." }] }] },
      { code: "bibliography", kind: "bibliography", title: "Bibliography", pages: [1178, 1203], blocks: [{ type: "references", items: ["[TEST] Fixture."] }] },
    ] })], ["jsonb"]);
    expect(r).toMatchObject({ ok: true, resources: 2 });
    expect((await rpc(db, cal, "get_study_resource", ["CSP-SPS", "glossary"], ["text", "text"])).ok).toBe(true);
    expect((await rpc(db, ana, "get_study_resource", ["CSP-SPS", "glossary"], ["text", "text"])).ok).toBe(false);
  });
});

const CONTENT_DIR = join(import.meta.dirname, "../../imports/csp-sps/chapters");
describe.skipIf(!existsSync(CONTENT_DIR))("authored CSP chapters (local, private content)", () => {
  it("imports all authored chapters, renders them through the RPC and completes each with its sample answers", async () => {
    const raw = Object.fromEntries(readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"))
      .map((f) => [f, JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf8"))]));
    const { pkg, issues, authored } = buildPackage(manifest, raw, { version: "1.0.0-local" });
    expect(issues).toEqual([]);
    const imp = await rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
    expect(imp.ok).toBe(true);
    const dan = await createUser(db, { username: "dan" });
    expect((await rpc(db, admin, "admin_study_enroll", [dan, imp.version_id, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
    for (const code of authored) {
      const c = await rpc(db, dan, "get_study_chapter", ["CSP-SPS", code], ["text", "text"]);
      expect(c.ok, code).toBe(true);
      const src = pkg.chapters.find((x: any) => x.id === code)!;
      for (const s of c.sections) {
        // nothing in the payload may reveal a key before an attempt
        expect(JSON.stringify(s.activities)).not.toContain("answer_key");
        await rpc(db, dan, "study_open_section", [s.id], ["uuid"]);
        await rpc(db, dan, "study_ack_section", [s.id], ["uuid"]);
        for (const a of s.activities) {
          if (!a.is_required) continue;
          const def = (src as any).sections.find((x: any) => x.code === s.code).activities.find((x: any) => x.code === a.code);
          const r = await rpc(db, dan, "study_submit_activity", [a.id, JSON.stringify(def.sample_response), randomUUID()], ["uuid", "jsonb", "uuid"]);
          if (a.kind !== "self_check") expect(r.is_correct, `${code}/${a.code}`).toBe(true);
          await rpc(db, dan, "study_ack_feedback", [r.attempt_id], ["uuid"]);
        }
      }
      const id = (await db.query<{ id: string }>(`select id from study_chapters where version_id = $1 and code = $2`, [imp.version_id, code])).rows[0].id;
      expect((await rpc(db, dan, "study_finish_chapter", [id], ["uuid"])).ok, code).toBe(true);
    }
    const done = await rpc(db, dan, "get_study_course", ["CSP-SPS"], ["text"]);
    expect(done.progress.completed_chapters).toBe(authored.length);
    if (authored.length === 60) expect(done.course.completed_at).not.toBeNull();
    for (const q of ["permit-required confined space", "LD50", "noise dose", "meshing hypothesis", "RACI"]) {
      const t0 = Date.now();
      const r = await rpc(db, dan, "study_search", ["CSP-SPS", q], ["text", "text"]);
      console.log(`search "${q}": ${r.results.length} sections, ${r.resources.length} resources, ${Date.now() - t0} ms; top ${r.results[0]?.chapter} ${r.results[0]?.section_title}`);
      expect(r.results.length).toBeGreaterThan(0);
    }
  }, 600_000);
});

describe("course-wide search", () => {
  it("finds lesson text in the learner's own version, never activities, and respects enrollment", async () => {
    const db2 = await createDb();
    const adm = await createUser(db2, { username: "adm", role: "admin" });
    const lea = await createUser(db2, { username: "lea" });
    const out = await createUser(db2, { username: "out" });
    const pkg = synthetic(manifest, "CSP-SPS", "9.9.8-search");
    pkg.chapters[0].sections[0].blocks = [{ type: "text", md: "**Prevention through Design** removes hazards on the drawing board." } as any,
      { type: "activity", code: "check" } as any];
    pkg.chapters[0].sections[0].activities[0].spec.prompt = "Secretkeyword in a prompt";
    const imp = await rpc(db2, adm, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
    expect(imp.ok).toBe(true);
    await rpc(db2, adm, "admin_study_import_resources", [JSON.stringify({ course: "CSP-SPS", version: "9.9.8-search", resources: [
      { code: "glossary", kind: "glossary", title: "Glossary", blocks: [{ type: "text", md: "Intro." }, { type: "heading", text: "A" },
        { type: "glossary", terms: [{ term: "Avoidance", definition: "Keeping a hazard out at the design stage" }] }] }] })], ["jsonb"]);
    expect((await rpc(db2, adm, "admin_study_enroll", [lea, imp.version_id, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);

    const hit = await rpc(db2, lea, "study_search", ["CSP-SPS", "drawing board"], ["text", "text"]);
    expect(hit.ok).toBe(true);
    expect(hit.results).toHaveLength(1);
    expect(hit.results[0]).toMatchObject({ chapter: "1.1", section: "lesson" });
    expect(hit.results[0].snippet).toContain("[[");
    expect(hit.results[0].snippet).not.toContain("**");
    const g = await rpc(db2, lea, "study_search", ["CSP-SPS", "design stage"], ["text", "text"]);
    expect(g.ok).toBe(true);
    expect(g.resources[0].code).toBe("glossary");
    expect(g.glossary).toEqual([{ term: "Avoidance", definition: "Keeping a hazard out at the design stage" }]);
    expect((await rpc(db2, lea, "study_search", ["CSP-SPS", "Secretkeyword"], ["text", "text"])).results).toHaveLength(0);
    expect((await rpc(db2, lea, "study_search", ["CSP-SPS", "x"], ["text", "text"])).results).toEqual([]);
    expect((await rpc(db2, lea, "study_search", ["CSP-SPS", "100%_'; drop"], ["text", "text"])).ok).toBe(true);
    expect((await rpc(db2, out, "study_search", ["CSP-SPS", "drawing board"], ["text", "text"])).error).toBe("not_enrolled");
    await db2.query(`update study_enrollments set access_expires_at = now() - interval '1 day' where user_id = $1`, [lea]);
    expect((await rpc(db2, lea, "study_search", ["CSP-SPS", "drawing board"], ["text", "text"])).error).toBe("access_expired");
  }, 120_000);
});
