/**
 * Study indicators and recommendations from recorded performance.
 * Thresholds are internal study indicators (admin-configurable), NOT official
 * passing standards.
 */
export type Indicators = { strong: number; developing: number; min_questions: number };
export type DomainStat = {
  code: string;
  name: string;
  weight: number;
  total: number;
  correct: number;
  pct: number | null;
  recent_pct?: number | null;
};
export type Level = "strong" | "developing" | "priority" | "no-data";

export const DEFAULT_INDICATORS: Indicators = { strong: 80, developing: 60, min_questions: 20 };

export function levelFor(pct: number | null | undefined, ind: Indicators): Level {
  if (pct == null) return "no-data";
  if (pct >= ind.strong) return "strong";
  if (pct >= ind.developing) return "developing";
  return "priority";
}

export const LEVEL_LABEL: Record<Level, string> = {
  strong: "Strong",
  developing: "Developing",
  priority: "Priority for improvement",
  "no-data": "No data yet",
};

export type Recommendation = {
  domain: string;
  code: string;
  level: Level;
  limitedSample: boolean;
  message: string;
  score: number; // higher = more urgent
};

/**
 * Rank domains for revision. Urgency weighs the gap to the "strong"
 * threshold by the domain's blueprint weight, so a weak heavy domain ranks
 * above a weak light one.
 */
export function recommend(domains: DomainStat[], ind: Indicators = DEFAULT_INDICATORS): Recommendation[] {
  return domains
    .map((d) => {
      const level = levelFor(d.pct, ind);
      const limitedSample = d.total < ind.min_questions;
      const gap = d.pct == null ? ind.strong : Math.max(0, ind.strong - d.pct);
      const score = gap * d.weight;
      let message: string;
      if (level === "no-data") message = `No questions answered yet in ${d.name}. Try a domain practice exam to get a baseline.`;
      else if (level === "priority")
        message = `Make ${d.name} a revision priority — ${d.pct}% across ${d.total} questions.`;
      else if (level === "developing")
        message = `${d.name} is developing (${d.pct}%). Review missed explanations, then retake a domain exam.`;
      else message = `${d.name} is a strength (${d.pct}%). Keep it fresh with mixed practice.`;
      if (limitedSample && level !== "no-data")
        message += ` Based on only ${d.total} question${d.total === 1 ? "" : "s"}, so treat this as provisional.`;
      return { domain: d.name, code: d.code, level, limitedSample, message, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function trendDirection(scores: number[]): "up" | "down" | "flat" | "insufficient" {
  if (scores.length < 3) return "insufficient";
  const half = Math.floor(scores.length / 2);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const delta = avg(scores.slice(half)) - avg(scores.slice(0, half));
  if (delta > 3) return "up";
  if (delta < -3) return "down";
  return "flat";
}
