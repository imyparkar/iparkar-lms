import { STATUS_LABEL, pct, type ProgressStatus } from "@/lib/study/types";

/** Status is carried by the word; colour follows the design-system pill variants. */
const PILL: Record<ProgressStatus, string> = {
  not_started: "bg-sky-tint text-ink",
  in_progress: "bg-marigold text-ink",
  completed: "bg-midnight text-white",
};

export function StatusPill({ status, className = "" }: { status: ProgressStatus; className?: string }) {
  return <span className={`pill ${PILL[status]} ${className}`}>{STATUS_LABEL[status]}</span>;
}

/** Accessible progress meter: the visible text is the source of truth, the bar is decoration. */
export function ProgressMeter({ done, total, label, dark = false, size = "md" }:
  { done: number; total: number; label: string; dark?: boolean; size?: "sm" | "md" }) {
  const p = pct(done, total);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-body-sm ${dark ? "text-white" : "text-graphite"}`}>{label}</span>
        <span className={`text-body-sm font-semibold ${dark ? "text-white" : "text-ink"}`}>{done} of {total} · {p}%</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
           aria-valuetext={`${done} of ${total} chapters, ${p} percent`}
           className={`mt-2 overflow-hidden rounded-pill ${size === "sm" ? "h-1.5" : "h-2"} ${dark ? "bg-white/25" : "bg-ink-20"}`}>
        <div className={`h-full rounded-pill ${dark ? "bg-marigold" : "bg-action"}`} style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
      </div>
    </div>
  );
}
