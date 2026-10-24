import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import type { AttemptResult } from "@/lib/types";
import { fmtDateTime, fmtPct, modeLabel } from "@/lib/format";
import { formatDuration } from "@/lib/exam/clock";
import { DEFAULT_INDICATORS, levelFor } from "@/lib/analytics/recommendations";
import { DomainBars } from "@/components/analytics/DomainBars";
import { LevelPill } from "@/components/analytics/LevelPill";
import { Alert } from "@/components/ui/Alert";
import { ReviewList } from "./ReviewList";

export const metadata = { title: "Results" };
export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("get_attempt_result", { p_attempt: attemptId });
  if (!data?.ok) {
    if (data?.error === "NOT_FINALIZED") redirect(`/exam/${attemptId}`);
    notFound();
  }
  const r = data as AttemptResult;
  const { data: settings } = await supabase.from("app_settings").select("value").eq("key", "study_indicators").maybeSingle();
  const ind = { ...DEFAULT_INDICATORS, ...(settings?.value ?? {}) };
  const a = r.attempt;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite no-print">
        <Link href="/dashboard" className="link">Dashboard</Link> / <Link href={`/courses/${a.course.code}`} className="link">{a.course.code}</Link> / Results
      </nav>

      <section className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-subheading text-graphite">{a.course.code} · {modeLabel(a.mode)}{a.domain ? ` — ${a.domain.code} ${a.domain.name}` : ""}</p>
          <h1 className="mt-2 text-[56px] font-semibold leading-none tracking-[-2px] tabular-nums">{fmtPct(a.score_pct, 1)}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-body-sm text-graphite">
            <LevelPill level={levelFor(a.score_pct, ind)} />
            {a.correct} correct · {a.incorrect} incorrect · {a.unanswered} unanswered of {a.question_count}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm">
          <dt className="text-slate">Submitted</dt><dd>{fmtDateTime(a.submitted_at)}</dd>
          <dt className="text-slate">Time used</dt><dd>{formatDuration(a.time_used_seconds)}</dd>
          <dt className="text-slate">Finished by</dt><dd>{a.finalized_reason === "timeout" ? "Time limit" : a.finalized_reason === "admin" ? "Administrator" : "You"}</dd>
          <dt className="text-slate">Blueprint</dt><dd>{a.blueprint.version}</dd>
        </dl>
      </section>

      <p className="text-caption text-graphite">
        Score = correct ÷ total questions × 100; unanswered questions count as incorrect. Practice scores are a study aid and do not predict official results.
      </p>

      <section className="card" aria-labelledby="dom-h">
        <h2 id="dom-h" className="text-heading-sm">Domain breakdown</h2>
        <div className="mt-5"><DomainBars rows={r.domains} ind={{ ...ind, min_questions: 5 }} /></div>
      </section>

      <div className="flex flex-wrap gap-2 no-print">
        <Link href={`/courses/${a.course.code}`} className="btn-primary">Start another {a.course.code} exam</Link>
        <Link href={`/dashboard?course=${a.course.code}`} className="btn-ghost">View {a.course.code} analytics</Link>
      </div>

      {r.review_allowed ? (
        <ReviewList items={r.review} />
      ) : a.feedback_policy === "delayed" && a.review_available_at ? (
        <Alert tone="info" title="Question review unlocks later">Explanations become available on {fmtDateTime(a.review_available_at)}.</Alert>
      ) : (
        <Alert tone="info" title="Question review isn’t available for this exam">Your score and domain breakdown are shown above.</Alert>
      )}
    </div>
  );
}
