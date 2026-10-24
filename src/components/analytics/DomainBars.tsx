import { levelFor, type Indicators } from "@/lib/analytics/recommendations";
import { LevelPill } from "./LevelPill";

type Row = { code: string; name: string; weight: number; total: number; correct: number; pct: number | null };

const barColor = { strong: "bg-[#2f8f4e]", developing: "bg-marigold", priority: "bg-coral", "no-data": "bg-ink-20" } as const;

/** One bar per domain of ONE course/blueprint. Level is shown in words, not colour alone. */
export function DomainBars({ rows, ind, showWeight = true }: { rows: Row[]; ind: Indicators; showWeight?: boolean }) {
  return (
    <ul className="space-y-4">
      {rows.map((d) => {
        const level = levelFor(d.pct, ind);
        const small = d.total > 0 && d.total < ind.min_questions;
        return (
          <li key={d.code}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-body-sm font-medium">
                <span className="text-slate">{d.code}</span> · {d.name}
                {showWeight && <span className="ml-2 text-caption text-slate">{Number(d.weight)}% of blueprint</span>}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-body-sm font-semibold tabular-nums">{d.pct == null ? "—" : `${d.pct}%`}</span>
                <LevelPill level={level} />
              </div>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-paper" role="presentation">
              <div className={`h-full rounded-pill ${barColor[level]}`} style={{ width: `${d.pct ?? 0}%` }} />
            </div>
            <p className="mt-1 text-caption text-slate">
              {d.total ? `${d.correct} of ${d.total} correct` : "Not attempted yet"}
              {small && " · small sample — provisional"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
