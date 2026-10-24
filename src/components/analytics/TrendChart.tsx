import { fmtDate, fmtPct } from "@/lib/format";
import type { CourseAnalytics } from "@/lib/types";

/** Score trend, oldest → newest, with the study-indicator thresholds. */
export function TrendChart({ trend, strong, developing }: { trend: CourseAnalytics["trend"]; strong: number; developing: number }) {
  if (trend.length < 2) {
    return <p className="text-body-sm text-graphite">Complete two or more exams to see a trend.</p>;
  }
  const W = 640, H = 200, P = { l: 36, r: 12, t: 12, b: 28 };
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (trend.length - 1);
  const y = (v: number) => P.t + ((100 - v) * (H - P.t - P.b)) / 100;
  const path = trend.map((t, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(t.score_pct)).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Score trend over ${trend.length} exams, latest ${fmtPct(trend[trend.length - 1].score_pct, 1)}`}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={P.l} x2={W - P.r} y1={y(g)} y2={y(g)} stroke="rgba(0,0,0,0.08)" />
            <text x={P.l - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#696969">{g}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(strong)} y2={y(strong)} stroke="#2f8f4e" strokeDasharray="4 4" />
        <line x1={P.l} x2={W - P.r} y1={y(developing)} y2={y(developing)} stroke="#e89d01" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke="#0075de" strokeWidth="2.5" strokeLinejoin="round" />
        {trend.map((t, i) => (
          <circle key={t.attempt_id} cx={x(i)} cy={y(Number(t.score_pct))} r="4" fill="#fff" stroke="#0075de" strokeWidth="2">
            <title>{`${fmtDate(t.submitted_at)} · ${t.mode === "mixed" ? "Mixed" : "Domain"} · ${fmtPct(t.score_pct, 1)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-caption text-graphite">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-action" /> Score</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-[#2f8f4e]" /> Strong ({strong}%)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-saffron" /> Developing ({developing}%)</span>
      </figcaption>
    </figure>
  );
}
