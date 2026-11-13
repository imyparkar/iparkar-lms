/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DB, as, createDb, createUser, rpc } from "./harness";

/**
 * Study-course engine. Uses the real 99-chapter manifest for structure and a
 * clearly-labelled synthetic lesson (one section + one activity) per chapter,
 * so completion rules can be exercised end to end without shipping content.
 */
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../content/asp-sps/manifest.json"), "utf8"));

function syntheticPackage(version = "9.9.9-test", opts: { withContent?: (code: string) => boolean; extraSection?: boolean } = {}) {
  const withContent = opts.withContent ?? (() => true);
  return {
    course: { code: "ASP-SPS", title: manifest.course.title, version },
    source: manifest.source,
    domains: manifest.domains.map((d: any) => ({ domain: d.domain, title: d.title, weight: d.weight })),
    chapters: manifest.chapters.map((c: any, i: number) => ({
      id: c.id, domain: c.domain, sort_order: i + 1, title: c.title, objectives: c.objectives,
      prerequisite: c.prerequisite, pages: c.pages,
      ...(withContent(c.id) ? {
        sections: [
          { code: "lesson", sort_order: 1, title: "[TEST] Lesson", blocks: [{ type: "text", md: "Synthetic fixture." }],
            activities: [{ code: "check", kind: "single_choice", spec: { prompt: "Pick b", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] },
                           answer_key: { correct: "b" }, sample_response: { choice: "b" }, feedback: { explanation: "B is right." } }] },
          ...(opts.extraSection ? [{ code: "extra", sort_order: 2, title: "[TEST] Extra", blocks: [] }] : []),
        ],
      } : {}),
    })),
  };
}

let db: DB;
let admin: string, ana: string, ben: string, cal: string;
let versionId: string;

async function chapter(uid: string, code: string) {
  return rpc(db, uid, "get_study_chapter", ["ASP-SPS", code], ["text", "text"]);
}
async function chapterId(code: string) {
  return (await db.query<{ id: string }>(`select id from study_chapters where version_id = $1 and code = $2`, [versionId, code])).rows[0].id;
}
/** Do everything a learner must do for one chapter, then press Finish. */
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

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { username: "admin", role: "admin" });
  ana = await createUser(db, { username: "ana" });
  ben = await createUser(db, { username: "ben" });
  cal = await createUser(db, { username: "cal" });
  const res = await rpc(db, admin, "admin_study_import", [JSON.stringify(syntheticPackage())], ["jsonb"]);
  expect(res.ok).toBe(true);
  versionId = res.version_id;
}, 120_000);

describe("manifest", () => {
  it("has nine domains and 99 unique chapters with the guide's counts", () => {
    const ids = manifest.chapters.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(99);
    const per = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => manifest.chapters.filter((c: any) => c.domain === d).length);
    expect(per).toEqual([17, 24, 7, 12, 6, 11, 8, 7, 7]);
    expect(manifest.domains.map((d: any) => d.weight).reduce((a: number, b: number) => a + b, 0)).toBe(100);
    expect(manifest.chapters.find((c: any) => c.id === "1.2")).toMatchObject({ title: "Algebra, geometry and trigonometry toolkit", prerequisite: true });
  });

  it("maps every chapter except the prerequisite to objectives, 84 top-level in all", () => {
    expect(manifest.chapters.filter((c: any) => c.objectives.length === 0).map((c: any) => c.id)).toEqual(["1.2"]);
    expect(manifest.objective_counts.top_level_objectives).toBe(84);
  });

  it("has contiguous, non-overlapping source page ranges inside the 1,268-page guide", () => {
    for (const d of manifest.domains) {
      const chs = manifest.chapters.filter((c: any) => c.domain === d.domain);
      expect(chs[0].pages[0]).toBe(d.pages.contents[1] + 1);
      for (let i = 0; i < chs.length; i++) {
        expect(chs[i].pages[1]).toBeGreaterThanOrEqual(chs[i].pages[0]);
        if (i > 0) expect(chs[i].pages[0]).toBe(chs[i - 1].pages[1] + 1);
      }
      expect(chs.at(-1).pages[1]).toBe(d.pages.closing_divider - 1);
    }
    expect(manifest.chapters[0].pages).toEqual([9, 17]);
    expect(manifest.domains[8].pages.glossary[1]).toBe(1268);
  });
});

describe("enrollment and access", () => {
  it("refuses content to learners who are not enrolled", async () => {
    expect((await chapter(ana, "1.1")).error).toBe("not_enrolled");
    expect((await rpc(db, ana, "get_study_course", ["ASP-SPS"], ["text"])).error).toBe("not_enrolled");
  });

  it("blocks direct table reads of content, keys and progress", async () => {
    await expect(as(db, ana, `select answer_key from study_activities`)).rejects.toThrow(/permission denied/);
    await expect(as(db, ana, `select * from study_sections`)).rejects.toThrow(/permission denied/);
    await expect(as(db, ana, `insert into study_chapter_progress values (gen_random_uuid(), gen_random_uuid())`)).rejects.toThrow(/permission denied/);
  });

  it("keeps unpublished versions closed except for explicit pilot enrollment", async () => {
    expect((await rpc(db, admin, "admin_study_enroll", [ana, versionId, false], ["uuid", "uuid", "boolean"])).error).toBe("version_not_published");
    expect((await rpc(db, ana, "admin_study_enroll", [ana, versionId, true], ["uuid", "uuid", "boolean"])).error).toBe("forbidden");
    for (const u of [ana, ben, cal]) {
      expect((await rpc(db, admin, "admin_study_enroll", [u, versionId, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
    }
    expect((await rpc(db, ana, "study_self_enroll", ["ASP-SPS"], ["text"])).error).toBe("enrollment_closed");
  });

  it("will not publish a version whose chapters are unreviewed", async () => {
    const r = await rpc(db, admin, "admin_study_set_version_status", [versionId, "published", true], ["uuid", "text", "boolean"]);
    expect(r.error).toBe("not_ready");
    expect(r.problem_count).toBe(99);
  });

  it("never returns answer keys before an attempt", async () => {
    const c = await chapter(ana, "1.1");
    expect(c.ok).toBe(true);
    expect(JSON.stringify(c.sections)).not.toContain("answer_key");
    expect(c.sections[0].activities[0].last).toBeNull();
    expect(JSON.stringify(c.sections[0].activities[0])).not.toContain('"correct"');
  });
});

describe("chapter completion", () => {
  it("does not complete on opening, and explains what is missing", async () => {
    const id = await chapterId("1.3");
    await chapter(ana, "1.3");
    const r = await rpc(db, ana, "study_finish_chapter", [id], ["uuid"]);
    expect(r.error).toBe("requirements_incomplete");
    expect(r.missing.sections[0]).toMatchObject({ code: "lesson", state: "not_opened" });
    expect(r.missing.activities[0]).toMatchObject({ code: "check", state: "not_attempted" });
    expect((await chapter(ana, "1.3")).chapter.status).toBe("in_progress");
  });

  it("cannot acknowledge a section that was never opened", async () => {
    const c = await chapter(ana, "1.4");
    expect((await rpc(db, ana, "study_ack_section", [c.sections[0].id], ["uuid"])).error).toBe("section_not_opened");
  });

  it("grades on the server, keeps a wrong answer as formative, and needs feedback viewed", async () => {
    const c = await chapter(ana, "1.5");
    const s = c.sections[0];
    await rpc(db, ana, "study_open_section", [s.id], ["uuid"]);
    await rpc(db, ana, "study_ack_section", [s.id], ["uuid"]);
    const client = randomUUID();
    const wrong = await rpc(db, ana, "study_submit_activity", [s.activities[0].id, JSON.stringify({ choice: "a" }), client], ["uuid", "jsonb", "uuid"]);
    expect(wrong).toMatchObject({ ok: true, is_correct: false, attempts: 1 });
    expect(wrong.feedback.explanation).toBe("B is right.");
    // a replay of the same submission is not a second attempt
    const replay = await rpc(db, ana, "study_submit_activity", [s.activities[0].id, JSON.stringify({ choice: "b" }), client], ["uuid", "jsonb", "uuid"]);
    expect(replay).toMatchObject({ attempt_id: wrong.attempt_id, is_correct: false, attempts: 1 });
    const id = await chapterId("1.5");
    expect((await rpc(db, ana, "study_finish_chapter", [id], ["uuid"])).missing.activities[0].state).toBe("feedback_not_viewed");
    // ben cannot acknowledge ana's feedback
    expect((await rpc(db, ben, "study_ack_feedback", [wrong.attempt_id], ["uuid"])).ok).toBe(false);
    await rpc(db, ana, "study_ack_feedback", [wrong.attempt_id], ["uuid"]);
    const done = await rpc(db, ana, "study_finish_chapter", [id], ["uuid"]);
    expect(done).toMatchObject({ ok: true, chapter_newly_completed: true, course_completed: false });
    expect(done.progress.completed_chapters).toBe(1);
    expect((await rpc(db, ana, "study_finish_chapter", [id], ["uuid"])).chapter_newly_completed).toBe(false);
  });

  it("rejects malformed responses without recording an attempt", async () => {
    const c = await chapter(ana, "1.5");
    const r = await rpc(db, ana, "study_submit_activity", [c.sections[0].activities[0].id, JSON.stringify({ value: "x" }), randomUUID()], ["uuid", "jsonb", "uuid"]);
    expect(r.error).toBe("invalid_response");
  });
});

describe("course completion", () => {
  it("stays incomplete at 98 of 99 and completes once at 99 of 99", async () => {
    const codes = manifest.chapters.map((c: any) => c.id);
    for (const code of codes.slice(0, 98)) expect((await study(ben, code)).ok).toBe(true);
    const at98 = await rpc(db, ben, "get_study_course", ["ASP-SPS"], ["text"]);
    expect(at98.progress).toMatchObject({ required_chapters: 99, completed_chapters: 98, domains_completed: 8 });
    expect(at98.course.completed_at).toBeNull();
    expect((await rpc(db, ben, "get_study_completion", ["ASP-SPS"], ["text"])).error).toBe("not_completed");

    // The final chapter, finished from three "tabs" at once plus a replay.
    const last = codes[98];
    const c = await chapter(ben, last);
    await rpc(db, ben, "study_open_section", [c.sections[0].id], ["uuid"]);
    await rpc(db, ben, "study_ack_section", [c.sections[0].id], ["uuid"]);
    const r = await rpc(db, ben, "study_submit_activity", [c.sections[0].activities[0].id, JSON.stringify({ choice: "b" }), randomUUID()], ["uuid", "jsonb", "uuid"]);
    await rpc(db, ben, "study_ack_feedback", [r.attempt_id], ["uuid"]);
    const id = await chapterId(last);
    const results = await Promise.all([1, 2, 3].map(() => rpc(db, ben, "study_finish_chapter", [id], ["uuid"])));
    expect(results.every((x) => x.ok && x.course_completed)).toBe(true);
    expect(results.filter((x) => x.chapter_newly_completed)).toHaveLength(1);
    await rpc(db, ben, "study_finish_chapter", [id], ["uuid"]);

    const rows = (await db.query<{ n: number }>(`select count(*)::int n from study_course_completions where user_id = $1`, [ben])).rows;
    expect(rows[0].n).toBe(1);
    const audits = (await db.query<{ n: number }>(`select count(*)::int n from audit_logs where action = 'study_course_completed'`)).rows;
    expect(audits[0].n).toBe(1);
    const cert = await rpc(db, ben, "get_study_completion", ["ASP-SPS"], ["text"]);
    expect(cert).toMatchObject({ ok: true, course_title: "ASP Self Paced Study Course", version: "9.9.9-test", chapters_completed: 99 });
    expect(cert.record_code).toMatch(/^IPL-[0-9A-F]{12}$/);
    // nobody else can read ben's record
    expect((await rpc(db, cal, "get_study_completion", ["ASP-SPS"], ["text"])).ok).toBe(false);
  }, 120_000);
});

describe("resume, notes, bookmarks", () => {
  it("ignores stale resume writes from an older tab", async () => {
    const c13 = await chapterId("1.3"), c14 = await chapterId("1.4");
    expect((await rpc(db, cal, "study_save_resume", [c14, null, 2000], ["uuid", "uuid", "bigint"])).applied).toBe(true);
    expect((await rpc(db, cal, "study_save_resume", [c13, null, 1000], ["uuid", "uuid", "bigint"])).applied).toBe(false);
    const course = await rpc(db, cal, "get_study_course", ["ASP-SPS"], ["text"]);
    expect(course.resume.chapter).toBe("1.4");
  });

  it("keeps notes and bookmarks private to their owner", async () => {
    const c = await chapter(cal, "2.1");
    const id = await chapterId("2.1");
    await rpc(db, cal, "study_save_note", [id, "Cal's private note"], ["uuid", "text"]);
    await rpc(db, cal, "study_set_bookmark", [c.sections[0].id, true], ["uuid", "boolean"]);
    expect((await chapter(cal, "2.1")).chapter.note).toBe("Cal's private note");
    expect((await chapter(ana, "2.1")).chapter.note).toBeNull();
    expect((await chapter(ana, "2.1")).sections[0].bookmarked).toBe(false);
    const dash = await rpc(db, cal, "get_my_study_courses");
    expect(dash[0].bookmarks[0]).toMatchObject({ chapter: "2.1", section: "lesson" });
    await expect(as(db, ana, `select * from study_notes`)).rejects.toThrow(/permission denied/);
  });
});

describe("versioning", () => {
  it("accepts a wording correction on a version with learners and keeps progress", async () => {
    const pkg = syntheticPackage();
    pkg.chapters[4].sections![0].title = "[TEST] Lesson (typo fixed)";
    expect((await rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"])).ok).toBe(true);
    expect((await chapter(ana, "1.5")).chapter.status).toBe("completed");
  });

  it("rejects a material change to a version with learners", async () => {
    const pkg = syntheticPackage("9.9.9-test", { extraSection: true });
    await expect(rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"])).rejects.toThrow(/material change/);
    expect((await chapter(ana, "1.5")).sections).toHaveLength(1);
  });

  it("treats a chapter without lesson content as in preparation", async () => {
    const pkg = syntheticPackage("9.9.10-test", { withContent: (c) => c !== "9.7" });
    const r = await rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
    expect(r.counts).toMatchObject({ chapters: 99, chapters_with_content: 98 });
  });

  it("rejects an activity whose key does not accept its own sample answer", async () => {
    const pkg = syntheticPackage("9.9.11-test");
    (pkg.chapters[0].sections![0].activities[0] as any).sample_response = { choice: "a" };
    await expect(rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"])).rejects.toThrow(/sample_response/);
  });
});

describe("grading", () => {
  it("handles numeric tolerance, multi-select and ordering", async () => {
    const g = async (kind: string, key: unknown, resp: unknown) =>
      (await db.query<{ r: boolean | null }>(`select public.study_grade($1::study_activity_kind, $2::jsonb, $3::jsonb) r`,
        [kind, JSON.stringify(key), JSON.stringify(resp)])).rows[0].r;
    expect(await g("numeric", { value: 2.36, abs_tol: 0.01 }, { value: "2.355" })).toBe(true);
    expect(await g("numeric", { value: 2.36, abs_tol: 0.01 }, { value: 2.5 })).toBe(false);
    expect(await g("numeric", { value: 9.46, rel_tol: 0.01 }, { value: 9.5 })).toBe(true);
    expect(await g("numeric", { value: 1 }, { value: "abc" })).toBeNull();
    expect(await g("multi_choice", { correct: ["a", "c"] }, { choices: ["c", "a"] })).toBe(true);
    expect(await g("multi_choice", { correct: ["a", "c"] }, { choices: ["a"] })).toBe(false);
    expect(await g("ordering", { order: ["x", "y", "z"] }, { order: ["x", "y", "z"] })).toBe(true);
    expect(await g("ordering", { order: ["x", "y", "z"] }, { order: ["y", "x", "z"] })).toBe(false);
  });
});

// Real authored content lives in git-ignored imports/. When present, prove it loads and is completable.
const CONTENT_DIR = join(import.meta.dirname, "../../imports/asp-sps/chapters");
describe.skipIf(!existsSync(CONTENT_DIR))("authored content (local only)", () => {
  it("imports, renders through the RPC and completes every authored chapter with its sample answers", async () => {
    const { buildPackage } = await import("../../src/lib/study/package");
    const raw = Object.fromEntries(readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"))
      .map((f) => [f, JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf8"))]));
    const { pkg, issues, authored } = buildPackage(manifest, raw, { version: "1.0.0-local" });
    expect(issues).toEqual([]);
    const imp = await rpc(db, admin, "admin_study_import", [JSON.stringify(pkg)], ["jsonb"]);
    expect(imp.ok).toBe(true);
    const dan = await createUser(db, { username: "dan" });
    expect((await rpc(db, admin, "admin_study_enroll", [dan, imp.version_id, true], ["uuid", "uuid", "boolean"])).ok).toBe(true);
    for (const code of authored) {
      const c = await rpc(db, dan, "get_study_chapter", ["ASP-SPS", code], ["text", "text"]);
      const src = pkg.chapters.find((x: any) => x.id === code)!;
      for (const s of c.sections) {
        await rpc(db, dan, "study_open_section", [s.id], ["uuid"]);
        await rpc(db, dan, "study_ack_section", [s.id], ["uuid"]);
        for (const a of s.activities) {
          const def = (src as any).sections.find((x: any) => x.code === s.code).activities.find((x: any) => x.code === a.code);
          const r = await rpc(db, dan, "study_submit_activity", [a.id, JSON.stringify(def.sample_response), randomUUID()], ["uuid", "jsonb", "uuid"]);
          expect(r.is_correct, `${code}/${a.code}`).toBe(true);
          await rpc(db, dan, "study_ack_feedback", [r.attempt_id], ["uuid"]);
        }
      }
      const id = (await db.query<{ id: string }>(`select id from study_chapters where version_id = $1 and code = $2`, [imp.version_id, code])).rows[0].id;
      expect((await rpc(db, dan, "study_finish_chapter", [id], ["uuid"])).ok).toBe(true);
    }
  });
});
