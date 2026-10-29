import Link from "next/link";
import type { CourseAnalytics, SubjectPerformance } from "@/lib/types";
import { recommend, trendDirection, levelFor } from "@/lib/analytics/recommendations";
import { fmtDate, fmtPct, modeLabel } from "@/lib/format";
import { formatDuration } from "@/lib/exam/clock";
import { StatTiles } from "./StatTiles";
import { TrendChart } from "./TrendChart";
import { DomainBars } from "./DomainBars";
import { SubjectBars } from "./SubjectBars";
import { LevelPill } from "./LevelPill";
import { Pill } from "@/components/ui/Pill";

export function CourseAnalyticsPanel({ a, subjects = [], courseCode, courseName }: {
  a: CourseAnalytics; subjects?: SubjectPerformance[]; courseCode: string; courseName: string;
}) {
  const ind = a.indicators;
  const attempted = a.domains.filter((d) => d.total > 0);
  const recs = recommend(a.domains.map((d) => ({ ...d, weight: Number(d.weight) })), ind);
  const ranked = [...attempted].sort((x, y) => Number(y.pct) - Number(x.pct));
  const strongest = ranked.filter((d) => levelFor(d.pct, ind) === "strong").slice(0, 3);
  const weakest = [...ranked].reverse().filter((d) => levelFor(d.pct, ind) !== "strong").slice(0, 3);
  const dir = trendDirection(a.trend.map((t) => Number(t.score_pct)));
  const empty = a.summary.completed === 0;

  return (
    <div className="space-y-6">
      <StatTiles s={a.summary} />

      {a.attempts_on_other_blueprints > 0 && (
        <p className="text-caption text-graphite">
          Showing exams on the current {courseCode} blueprint only. {a.attempts_on_other_blueprints} earlier exam
          {a.attempts_on_other_blueprints === 1 ? " was" : "s were"} taken on a previous blueprint version and {a.attempts_on_other_blueprints === 1 ? "is" : "are"} listed in your history.
        </p>
      )}

      {empty ? (
        <section className="card">
          <h3 className="text-heading-sm">No {courseCode} results yet</h3>
          <p className="mt-2 text-graphite">
            Finish a practice exam and your domain breakdown, trend and study priorities will appear here. A 20-question subject-area set is a quick way to get a baseline.
          </p>
          <Link href={`/courses/${courseCode}`} className="btn-primary mt-4">Start a {courseCode} practice exam</Link>
        </section>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
            <section className="card lg:col-span-3" aria-labelledby="trend-h">
              <div className="flex items-baseline justify-between">
                <h3 id="trend-h" className="text-heading-sm">Score trend</h3>
                {dir !== "insufficient" && (
                  <Pill tone={dir === "up" ? "strong" : dir === "down" ? "coral" : "neutral"}>
                    {dir === "up" ? "Improving" : dir === "down" ? "Slipping" : "Holding steady"}
                  </Pill>
                )}
              </div>
              <div className="mt-4"><TrendChart trend={a.trend} strong={ind.strong} developing={ind.developing} /></div>
            </section>
            <section className="card lg:col-span-2" aria-labelledby="focus-h">
              <h3 id="focus-h" className="text-heading-sm">Where to focus</h3>
              <div className="mt-4 space-y-4 text-body-sm">
                <div>
                  <p className="text-caption text-slate">Strongest domains</p>
                  {strongest.length ? strongest.map((d) => (
                    <p key={d.code} className="mt-1">{d.code} · {d.name} — {fmtPct(d.pct, 1)}</p>
                  )) : <p className="mt-1 text-graphite">None at the “strong” level yet.</p>}
                </div>
                <div>
                  <p className="text-caption text-slate">Needs improvement</p>
                  {weakest.length ? weakest.map((d) => (
                    <p key={d.code} className="mt-1">{d.code} · {d.name} — {fmtPct(d.pct, 1)}</p>
                  )) : <p className="mt-1 text-graphite">Every attempted domain is strong. Keep it up with mixed exams.</p>}
                </div>
                {a.missed_topics.length > 0 && (
                  <div>
                    <p className="text-caption text-slate">Repeatedly missed topics</p>
                    <ul className="mt-1 space-y-1">
                      {a.missed_topics.slice(0, 5).map((m) => (
                        <li key={m.label + m.domain_code}>{m.domain_code} · {m.label} <span className="text-slate">({m.misses} missed)</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="card" aria-labelledby="domains-h">
            <h3 id="domains-h" className="text-heading-sm">Domain performance — {courseName}</h3>
            <p className="mt-1 text-caption text-graphite">
              Study indicators: strong ≥ {ind.strong}%, developing {ind.developing}–{ind.strong - 1}%, priority below {ind.developing}%. These are iParkar study guides, not official passing standards.
            </p>
            <div className="mt-5"><DomainBars rows={a.domains.map((d) => ({ ...d, weight: Number(d.weight) }))} ind={ind} /></div>
          </section>

          {subjects.length > 0 && (
            <section className="card" aria-labelledby="subjects-h">
              <h3 id="subjects-h" className="text-heading-sm">Subject-area performance</h3>
              <p className="mt-1 text-caption text-graphite">
                Accuracy by BGC subject area, weakest first, across every {courseCode} exam you have finished.
                Subject areas cut across the blueprint domains, so this is where to aim revision; the domain
                breakdown above is how the examination itself is weighted.
              </p>
              <div className="mt-5"><SubjectBars rows={subjects} ind={ind} /></div>
            </section>
          )}

          <section className="card" aria-labelledby="recs-h">
            <h3 id="recs-h" className="text-heading-sm">Suggested revision priorities</h3>
            <ol className="mt-4 space-y-3">
              {recs.slice(0, 5).map((r, i) => (
                <li key={r.code} className="flex gap-3 text-body-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-paper text-caption">{i + 1}</span>
                  <div><LevelPill level={r.level} /> <span className="ml-1">{r.message}</span></div>
                </li>
              ))}
            </ol>
          </section>

          {a.tasks.length > 0 && (
            <section className="card overflow-x-auto" aria-labelledby="tasks-h">
              <h3 id="tasks-h" className="text-heading-sm">Task-level performance</h3>
              <p className="mt-1 text-caption text-graphite">
                Coverage within each domain. The blueprint weights domains only; tasks have no official weighting.
              </p>
              <table className="mt-4 w-full min-w-[560px]">
                <thead><tr><th className="table-head">Task</th><th className="table-head">Domain</th><th className="table-head text-right">Answered</th><th className="table-head text-right">Accuracy</th><th className="table-head">Indicator</th></tr></thead>
                <tbody>
                  {a.tasks.map((t) => (
                    <tr key={t.task_id}>
                      <td className="table-cell"><span className="font-medium">{t.code}</span>{!t.name.startsWith("Task ") && <span className="block text-caption text-graphite">{t.name}</span>}</td>
                      <td className="table-cell">{t.domain_code}</td>
                      <td className="table-cell text-right tabular-nums">{t.total}</td>
                      <td className="table-cell text-right tabular-nums">{fmtPct(t.pct, 1)}</td>
                      <td className="table-cell">{t.total < 5 ? <span className="text-caption text-slate">Too few to judge</span> : <LevelPill level={levelFor(t.pct, ind)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <HistoryTable history={a.history} />
    </div>
  );
}

export function HistoryTable({ history }: { history: CourseAnalytics["history"] }) {
  return (
    <section className="card overflow-x-auto" aria-labelledby="history-h">
      <h3 id="history-h" className="text-heading-sm">Exam history</h3>
      {history.length === 0 ? (
        <p className="mt-2 text-body-sm text-graphite">No exams yet.</p>
      ) : (
        <table className="mt-4 w-full min-w-[680px]">
          <thead>
            <tr>
              <th className="table-head">Completed</th><th className="table-head">Mode</th>
              <th className="table-head text-right">Score</th><th className="table-head text-right">Correct</th>
              <th className="table-head text-right">Time used</th><th className="table-head">Blueprint</th><th className="table-head"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.attempt_id}>
                <td className="table-cell">{h.status === "in_progress" ? <Pill tone="marigold">In progress</Pill> : fmtDate(h.submitted_at)}</td>
                <td className="table-cell">{modeLabel(h.mode)}{h.domain_name && <span className="block text-caption text-graphite">{h.domain_name}</span>}</td>
                <td className="table-cell text-right font-semibold tabular-nums">{fmtPct(h.score_pct, 1)}</td>
                <td className="table-cell text-right tabular-nums">{h.correct == null ? "—" : `${h.correct}/${h.question_count}`}</td>
                <td className="table-cell text-right tabular-nums">{formatDuration(h.time_used_seconds)}</td>
                <td className="table-cell text-caption text-graphite">{h.blueprint_version}</td>
                <td className="table-cell text-right">
                  {h.status === "in_progress" ? (
                    <Link className="link" href={`/exam/${h.attempt_id}`}>Resume</Link>
                  ) : (
                    <Link className="link" href={`/results/${h.attempt_id}`}>{h.review_available ? "Review" : "Results"}</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
