import { levelFor, type Indicators } from "@/lib/analytics/recommendations";
import type { SubjectPerformance } from "@/lib/types";
import { LevelPill } from "./LevelPill";

const barColor = { strong: "bg-[#2f8f4e]", developing: "bg-marigold", priority: "bg-coral", "no-data": "bg-ink-20" } as const;

/**
 * Accuracy by BGC subject area, across every finalized attempt in the course.
 * Subject areas cut across the blueprint domains, so these bars answer a
 * different question from the domain bars: what to revise, rather than how the
 * examination is weighted.
 */
export function SubjectBars({ rows, ind }: { rows: SubjectPerformance[]; ind: Indicators }) {
  if (!rows.length) return null;
  return (
    <ul className="space-y-4">
      {rows.map((s) => {
        const level = levelFor(s.pct, ind);
        const small = s.total > 0 && s.total < ind.min_questions;
        return (
          <li key={s.subject_area}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-body-sm font-medium">{s.subject_area}</p>
              <div className="flex items-center gap-2">
                <span className="text-body-sm font-semibold tabular-nums">{s.pct == null ? "—" : `${s.pct}%`}</span>
                <LevelPill level={level} />
              </div>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-paper" role="presentation">
              <div className={`h-full rounded-pill ${barColor[level]}`} style={{ width: `${s.pct ?? 0}%` }} />
            </div>
            <p className="mt-1 text-caption text-slate">
              {s.correct} of {s.total} correct
              {small && " · small sample — provisional"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
