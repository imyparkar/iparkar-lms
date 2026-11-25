import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { EXAM_BLOCKED, type LiveExamStatus } from "@/lib/live/types";

export const metadata = { title: "Examination result" };
export const dynamic = "force-dynamic";

type Section = { section: number; title: string | null; correct: number; total: number };

/** Score, pass or fail, and revision guidance by unit. Correct answers are not shown, so the question bank stays fair for retakes. */
export default async function LiveExamResult({ params }: { params: Promise<{ course: string; attemptId: string }> }) {
  const { course, attemptId } = await params;
  if (!/^[a-z]{2,8}$/.test(course) || !/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("live_exam_result", { p_attempt: attemptId });
  if (!data?.ok) {
    if (data?.error === "IN_PROGRESS") redirect(`/live/${course}/exam/${attemptId}`);
    notFound();
  }
  const sections = (data.sections ?? []) as Section[];
  const revise = new Set<number>(data.revise ?? []);
  const exam = data.exam as LiveExamStatus;

  return (
    <div className="max-w-[760px] space-y-6">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href={`/live/${course}`} className="hover:text-ink">Course</Link> / <span className="text-ink">Examination result</span></nav>
      <section className={`rounded-card p-6 ${data.passed ? "bg-midnight text-white" : "bg-sky-tint text-ink"}`} aria-live="polite">
        <p className="text-caption opacity-80">Attempt {data.attempt_no} · {data.status === "expired" ? "submitted automatically when time ran out" : "submitted"} {fmtDateTime(data.finished_at)}</p>
        <h1 className="mt-2 text-[40px] font-semibold tracking-[-1px]">{data.score} / {data.max}</h1>
        <p className="mt-1 text-body font-semibold">{data.passed ? "Pass" : "Not passed"} · pass mark {data.pass_mark}/{data.max} · {data.answered} answered</p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-body font-semibold">Results by unit</h2>
        <table className="w-full text-body-sm">
          <thead><tr><th scope="col" className="table-head text-left">Unit</th><th scope="col" className="table-head text-right">Correct</th><th scope="col" className="table-head text-left">Guidance</th></tr></thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.section}>
                <th scope="row" className="table-cell text-left font-normal">{s.title ?? `Unit ${s.section}`}</th>
                <td className="table-cell text-right">{s.correct}/{s.total}</td>
                <td className="table-cell">{revise.has(s.section) ? "Revise this unit: re-read its slides and redo its independent-study module." : "Secure"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {!data.passed && (
        <section className="card space-y-2">
          <h2 className="text-body font-semibold">Next steps</h2>
          <p className="text-body">
            Focus your revision on the units marked above, then use the practice questions in the independent-study modules.
            {exam.can_start ? " You can start your next attempt now." : exam.blocked_reason ? ` ${EXAM_BLOCKED[exam.blocked_reason]}` : ""}
            {exam.next_allowed_at && !exam.can_start ? ` Next attempt from ${fmtDateTime(exam.next_allowed_at)}.` : ""}
            {" "}Attempts used: {exam.attempts_used} of {exam.max_attempts}.
          </p>
        </section>
      )}
      <Link href={`/live/${course}`} className="btn-primary">Back to the course</Link>
    </div>
  );
}
