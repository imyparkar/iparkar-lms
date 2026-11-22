/* eslint-disable @typescript-eslint/no-explicit-any -- reads JSON */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildPackage } from "@/lib/study/package";

/**
 * PMP® Exam Prep Course (PMP-SPS). The public manifest carries the curriculum structure; the lesson content is
 * git-ignored (imports/pmp-sps/chapters) and is validated here only when present on the machine.
 */
const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "content/pmp-sps/manifest.json"), "utf8"));
const register = readFileSync(join(root, "content/pmp-sps/content-register.csv"), "utf8").trim().split("\n");
const coverage = readFileSync(join(root, "content/pmp-sps/coverage.csv"), "utf8").trim().split("\n").slice(1);

const parseCsv = (line: string) => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1);

describe("PMP-SPS curriculum", () => {
  it("has nine modules with the 35-hour budget per module and 52 chapters", () => {
    expect(manifest.course.code).toBe("PMP-SPS");
    expect(manifest.domains.map((d: any) => d.weight)).toEqual([2, 4, 4, 4, 4, 5, 6, 4, 2]);
    expect(manifest.chapters).toHaveLength(52);
    expect(manifest.domains.map((d: any) => d.chapter_count)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => manifest.chapters.filter((c: any) => c.domain === n).length));
  });

  it("allocates exactly 2,100 minutes: Business Acumen 480, Ways of Working 1,140, Power Skills 480", () => {
    const head = parseCsv(register[0]);
    const rows = register.slice(1).map((l) => Object.fromEntries(parseCsv(l).map((v, i) => [head[i], v])));
    expect(rows).toHaveLength(52);
    const by = (cat: string) => rows.filter((r) => r.category === cat).reduce((s, r) => s + Number(r.minutes), 0);
    expect(by("Business Acumen")).toBe(480);
    expect(by("Ways of Working")).toBe(1140);
    expect(by("Power Skills")).toBe(480);
    for (const r of rows) {
      const parts = ["min_reading", "min_lesson", "min_example", "min_activity", "min_check"].reduce((s, k) => s + Number(r[k]), 0);
      expect(parts, r.chapter).toBe(Number(r.minutes));
      expect(Number(r.check_items), r.chapter).toBeGreaterThan(0);
    }
  });

  it("covers all 26 tasks of the July 2026 PMP ECO", () => {
    expect(coverage).toHaveLength(26);
    for (const line of coverage) expect(parseCsv(line)[3], line).not.toBe("");
  });

  it.runIf(existsSync(join(root, "imports/pmp-sps/chapters")))("lesson content validates against the study-engine schema", () => {
    const dir = join(root, "imports/pmp-sps/chapters");
    const raw = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]));
    const { pkg, issues, authored } = buildPackage(manifest, raw);
    expect(issues).toEqual([]);
    expect(authored).toHaveLength(52);
    for (const ch of pkg.chapters as any[]) {
      const kc = ch.sections.find((s: any) => s.code === "knowledge-check");
      expect(kc.activities.length, ch.id).toBeGreaterThan(0);
      expect(ch.sections.reduce((s: number, x: any) => s + x.est_minutes, 0)).toBe(ch.est_minutes);
      expect("pages" in ch).toBe(false);
    }
  });
});
