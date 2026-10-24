import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvItemBank, parseMarkdownItemBank, splitMarkdownRow, topicFromReference } from "@/lib/import/itemBank";
import { createDb, createUser, rpc } from "../db/harness";

const sample = readFileSync(join(import.meta.dirname, "../fixtures/asp-sample.md"), "utf8");

describe("markdown item-bank parser", () => {
  const res = parseMarkdownItemBank(sample);

  it("parses valid rows and reports broken ones with line numbers", () => {
    expect(res.items.map((i) => i.external_ref)).toEqual(["D1-0001", "D1-0023", "D2-0005", "D2-0018", "D2-0011", "D9-0025"]);
    expect(res.rowsSeen).toBe(10);
    const msgs = res.issues.map((i) => `${i.ref}: ${i.message}`);
    expect(msgs).toEqual([
      'D3-0001: Domain-Task "D4-T1" does not match ID domain D3',
      'D3-0002: key "E" does not match an option',
      "D3-0003: expected 12 columns, found 10",
      "D1-0001: duplicate ID in file",
    ]);
    expect(res.issues.every((i) => i.line > 0)).toBe(true);
  });

  it("maps every field", () => {
    const q = res.items.find((i) => i.external_ref === "D2-0018")!;
    expect(q).toMatchObject({
      domain_code: "D2",
      task_code: "D2-T8a",
      cognitive_level: "Application",
      key: "B",
      difficulty: 75,
      topic: "Ch. 25 Construction Safety",
    });
    expect(q.options.map((o) => o.body)).toEqual(["10 ft", "25 ft", "35 ft", "50 ft"]);
    expect(q.explanation).toMatch(/^Trenches 4 ft/);
  });

  it("keeps symbols and quotes intact", () => {
    expect(res.items[0].stem).toContain("gal/ft³");
    expect(res.items.find((i) => i.external_ref === "D9-0025")!.options[3].body).toBe('Enter "privacy case" in place of the name');
  });

  it("handles escaped pipes", () => {
    expect(splitMarkdownRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("derives study topics from references", () => {
    expect(topicFromReference("Yates, 4th ed., Ch. 10 Noise, Converting Noise Dosage into TWA, p. 324")).toBe("Ch. 10 Noise");
    expect(topicFromReference("Yates, 4th ed., Ch. 3, Calculating Total Case Incident Rates")).toBe("Ch. 3");
    expect(topicFromReference("OSHA 3071, Job Hazard Analysis, Step 5")).toBe("OSHA 3071");
    expect(topicFromReference(undefined)).toBeUndefined();
  });
});

describe("CSV parser", () => {
  it("parses quoted fields, extra options and reports missing data", () => {
    const csv = [
      "external_ref,domain_code,task_code,cognitive_level,stem,option_a,option_b,option_c,option_d,option_e,key,explanation,reference,difficulty",
      'Q-1,I,I-T3,Recall,"Which instrument, used for gases, reads ""ppm"" directly?",PID,Pitot,Rotameter,Anemometer,Sling psychrometer,A,"PIDs read VOCs.",,60',
      "Q-2,II,,Recall,Short stem but fine here?,a,b,,,,C,expl,,",
      "Q-1,I,,Recall,Duplicate ref here please?,a,b,,,,A,expl,,",
    ].join("\n");
    const res = parseCsvItemBank(csv);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].options).toHaveLength(5);
    expect(res.items[0].stem).toBe('Which instrument, used for gases, reads "ppm" directly?');
    expect(res.issues.map((i) => i.message)).toEqual(['key "C" does not match an option', "duplicate external_ref in file"]);
  });

  it("rejects files with missing columns", () => {
    expect(parseCsvItemBank("external_ref,stem\nx,y").issues[0].message).toMatch(/missing columns/);
  });
});

describe("end-to-end import into the database", () => {
  it("imports the parsed ASP sample as drafts, then publishes", async () => {
    const db = await createDb();
    const admin = await createUser(db, { username: "admin", role: "admin" });
    const { items } = parseMarkdownItemBank(sample);
    const res = await rpc(db, admin, "admin_import_questions", ["ASP", JSON.stringify(items), "draft", true],
      ["text", "jsonb", "text", "boolean"]);
    expect(res.rejected).toEqual([]);
    expect(res.accepted).toHaveLength(6);
    const tasks = await db.query(`select t.code, t.name from course_tasks t join courses c on c.id = t.course_id where c.code = 'ASP' order by t.code`);
    expect(tasks.rows.map((r: any) => r.code)).toEqual(["D1-T1", "D1-T14", "D2-T2", "D2-T3", "D2-T8a", "D9-T4"]);
    // the same file into CIH is rejected row by row (ASP domains don't exist there)
    const cross = await rpc(db, admin, "admin_import_questions", ["CIH", JSON.stringify(items), "draft", true],
      ["text", "jsonb", "text", "boolean"]);
    expect(cross.accepted).toEqual([]);
    expect(cross.rejected).toHaveLength(6);
    // re-import is an update, not a duplicate
    const again = await rpc(db, admin, "admin_import_questions", ["ASP", JSON.stringify(items), "draft", true],
      ["text", "jsonb", "text", "boolean"]);
    expect(again.accepted.every((a: any) => a.created === false)).toBe(true);
    const ids = (await db.query<{ id: string }>(`select id from questions`)).rows.map((r) => r.id);
    const pub = await rpc(db, admin, "admin_set_question_status", [ids, "published"], ["uuid[]", "text"]);
    expect(pub).toMatchObject({ ok: true, updated: 6, failed: [] });
  }, 60_000);
});
