import { describe, expect, it } from "vitest";
import { CalcError, evaluate, formatFraction, formatNumber, tokenize } from "@/lib/calculator/engine";
import { clockLevel, createSync, formatClock, remainingMs } from "@/lib/exam/clock";
import { levelFor, recommend, trendDirection, DEFAULT_INDICATORS } from "@/lib/analytics/recommendations";

const deg = { angle: "DEG" as const, ans: 0, memory: 0 };
const rad = { angle: "RAD" as const, ans: 0, memory: 0 };
const ev = (s: string, ctx = deg) => evaluate(s, ctx);
const close = (s: string, v: number, ctx = deg) => expect(ev(s, ctx)).toBeCloseTo(v, 9);

describe("calculator: arithmetic and precedence", () => {
  it.each([
    ["2+3×4", 14],
    ["(2+3)×4", 20],
    ["10÷4", 2.5],
    ["2^3^2", 512],
    ["−2^2", -4],
    ["(−2)^2", 4],
    ["2×−3", -6],
    ["−−5", 5],
    ["3(4+5)", 27],
    ["2π", 2 * Math.PI],
    ["(1+1)(2+2)", 8],
    ["50%", 0.5],
    ["200×15%", 30],
    ["0.1+0.2", 0.30000000000000004],
    ["6.02E23÷2", 3.01e23],
    ["1.5E−3×2", 0.003],
    ["2×(3+4", 14],
  ])("%s = %s", (expr, v) => close(expr as string, v as number));

  it("supports powers, roots, reciprocal, abs and factorial", () => {
    close("√16", 4);
    close("sqrt(2)²", 2);
    close("5²", 25);
    close("2³", 8);
    close("∛27", 3);
    close("root(32,5)", 2);
    close("root(−27,3)", -3);
    close("4⁻¹", 0.25);
    close("abs(−7.5)", 7.5);
    close("5!", 120);
    close("0!", 1);
  });

  it("supports logs, e and π", () => {
    close("log(1000)", 3);
    close("ln(e)", 1);
    close("exp(1)", Math.E);
    close("10^−3", 0.001);
    expect(ev("16.61log(1.6)+90")).toBeCloseTo(93.39, 2);
  });

  it("supports trig in degree and radian modes, plus inverses", () => {
    close("sin(30)", 0.5);
    close("cos(90)", 0);
    close("tan(45)", 1);
    close("sin⁻¹(0.5)", 30);
    expect(ev("asin(0.667)")).toBeCloseTo(41.836, 2);
    close("sin(π÷2)", 1, rad);
    close("acos(0)", Math.PI / 2, rad);
    expect(ev("2000÷sin(45)")).toBeCloseTo(2828.427, 3);
  });

  it("uses Ans and memory", () => {
    expect(evaluate("Ans×2", { ...deg, ans: 21 })).toBe(42);
    expect(evaluate("M+1", { ...deg, memory: 9 })).toBe(10);
    expect(evaluate("2M", { ...deg, memory: 4 })).toBe(8);
  });

  it("reports errors instead of crashing", () => {
    const kind = (s: string) => {
      try {
        ev(s);
        return "none";
      } catch (e) {
        return (e as CalcError).kind;
      }
    };
    expect(kind("5÷0")).toBe("DIVIDE_BY_ZERO");
    expect(kind("√(−4)")).toBe("DOMAIN");
    expect(kind("log(0)")).toBe("DOMAIN");
    expect(kind("asin(2)")).toBe("DOMAIN");
    expect(kind("tan(90)")).toBe("DOMAIN");
    expect(kind("(−8)^0.5")).toBe("DOMAIN");
    expect(kind("2.5!")).toBe("DOMAIN");
    expect(kind("171!")).toBe("OVERFLOW");
    expect(kind("10^400")).toBe("OVERFLOW");
    expect(kind("2++")).toBe("SYNTAX");
    expect(kind("3)")).toBe("SYNTAX");
    expect(kind("")).toBe("SYNTAX");
  });

  it("rejects code injection — the input is never executed", () => {
    expect(() => tokenize("alert(1)")).toThrow(CalcError);
    expect(() => tokenize("constructor")).toThrow(CalcError);
    expect(() => tokenize("x=>x")).toThrow(CalcError);
  });

  it("formats results", () => {
    expect(formatNumber(1 / 3)).toBe("0.3333333333");
    expect(formatNumber(2828.4271247461903)).toBe("2828.427125");
    expect(formatNumber(6.02e23)).toBe("6.02E23");
    expect(formatNumber(1.5e-12)).toBe("1.5E-12");
    expect(formatNumber(-0)).toBe("0");
    expect(formatFraction(0.75)).toBe("3/4");
    expect(formatFraction(7 / 3, true)).toBe("2 1/3");
    expect(formatFraction(Math.PI)).toBeNull();
    expect(formatFraction(4)).toBeNull();
  });
});

describe("exam clock", () => {
  it("derives remaining time from the server clock and monotonic time only", () => {
    const sync = createSync("2026-10-24T12:30:00Z", "2026-10-24T10:00:00Z", 1000);
    expect(remainingMs(sync, 1000)).toBe(150 * 60 * 1000);
    expect(remainingMs(sync, 1000 + 60_000)).toBe(149 * 60 * 1000);
    expect(remainingMs(sync, 1000 + 200 * 60_000)).toBe(0);
  });

  it("is unaffected by the device wall clock", () => {
    const sync = createSync("2026-10-24T12:30:00Z", "2026-10-24T10:00:00Z", 5000);
    const realDateNow = Date.now;
    Date.now = () => Date.parse("2020-01-01T00:00:00Z"); // user winds the clock back
    try {
      expect(remainingMs(sync, 5000 + 10_000)).toBe(150 * 60 * 1000 - 10_000);
    } finally {
      Date.now = realDateNow;
    }
  });

  it("formats and grades the countdown", () => {
    expect(formatClock(150 * 60 * 1000)).toBe("2:30:00");
    expect(formatClock(29 * 60 * 1000 + 59_001)).toBe("30:00");
    expect(formatClock(0)).toBe("00:00");
    expect(clockLevel(20 * 60 * 1000, 9000)).toBe("normal");
    expect(clockLevel(14 * 60 * 1000, 9000)).toBe("warning");
    expect(clockLevel(4 * 60 * 1000, 9000)).toBe("critical");
  });
});

describe("study indicators", () => {
  it("applies the configured thresholds", () => {
    expect(levelFor(80, DEFAULT_INDICATORS)).toBe("strong");
    expect(levelFor(79.9, DEFAULT_INDICATORS)).toBe("developing");
    expect(levelFor(60, DEFAULT_INDICATORS)).toBe("developing");
    expect(levelFor(59, DEFAULT_INDICATORS)).toBe("priority");
    expect(levelFor(null, DEFAULT_INDICATORS)).toBe("no-data");
    expect(levelFor(70, { strong: 70, developing: 50, min_questions: 5 })).toBe("strong");
  });

  it("ranks weak, heavily weighted domains first and flags small samples", () => {
    const recs = recommend([
      { code: "D1", name: "Math", weight: 10, total: 40, correct: 20, pct: 50 },
      { code: "D2", name: "Programs", weight: 25, total: 50, correct: 25, pct: 50 },
      { code: "D9", name: "Legal", weight: 5, total: 4, correct: 4, pct: 100 },
    ]);
    expect(recs.map((r) => r.code)).toEqual(["D2", "D1", "D9"]);
    expect(recs[2].limitedSample).toBe(true);
    expect(recs[2].message).toMatch(/provisional/);
  });

  it("describes trends only with enough data", () => {
    expect(trendDirection([50, 60])).toBe("insufficient");
    expect(trendDirection([50, 55, 70, 75])).toBe("up");
    expect(trendDirection([80, 78, 60, 55])).toBe("down");
    expect(trendDirection([60, 61, 60, 62])).toBe("flat");
  });
});

import { allocate } from "@/lib/exam/allocation";
describe("TypeScript allocation mirror", () => {
  it("matches the database results", () => {
    expect(allocate([10, 25, 8, 12, 10, 12, 7, 11, 5].map((w, i) => ({ number: i + 1, weight: w })), 100)).toEqual([10, 25, 8, 12, 10, 12, 7, 11, 5]);
    expect(allocate([50, 35, 15].map((w, i) => ({ number: i + 1, weight: w })), 100)).toEqual([50, 35, 15]);
    expect(allocate([33.334, 33.333, 33.333].map((w, i) => ({ number: i + 1, weight: w })), 100)).toEqual([34, 33, 33]);
    expect(allocate([10, 25, 8, 12, 10, 12, 7, 11, 5].map((w, i) => ({ number: i + 1, weight: w })), 20).reduce((a, b) => a + b)).toBe(20);
  });
});
