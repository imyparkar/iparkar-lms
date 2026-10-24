import { fmtPct } from "@/lib/format";
import type { CourseAnalytics } from "@/lib/types";

export function StatTiles({ s }: { s: CourseAnalytics["summary"] }) {
  const tiles = [
    { label: "Completed exams", value: String(s.completed) },
    { label: "Average score", value: fmtPct(s.average_score, 1) },
    { label: "Best score", value: fmtPct(s.best_score, 1) },
    { label: "Questions attempted", value: s.questions_attempted.toLocaleString("en-GB") },
    { label: "Overall accuracy", value: fmtPct(s.accuracy, 1) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="card p-4">
          <dt className="text-caption text-slate">{t.label}</dt>
          <dd className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.5px]">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
