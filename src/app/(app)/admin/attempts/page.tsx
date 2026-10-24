import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { finalizeAttempt } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { Pill } from "@/components/ui/Pill";
import { fmtDateTime, fmtPct, modeLabel } from "@/lib/format";

export const metadata = { title: "Attempts" };

export default async function AttemptsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: open }, { data: recent }, { data: profiles }, { data: courses }] = await Promise.all([
    supabase.from("exam_attempts").select("id, user_id, course_id, mode, started_at, expires_at").eq("status", "in_progress").order("started_at", { ascending: false }).limit(100),
    supabase.from("exam_attempts").select("id, user_id, course_id, mode, status, finalized_reason, submitted_at, score_pct, question_count, unanswered_count").neq("status", "in_progress").order("submitted_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, username"),
    supabase.from("courses").select("id, code"),
  ]);
  const user = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const course = new Map((courses ?? []).map((c) => [c.id, c.code]));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <Flash sp={sp} />
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Attempts</h1>
      <section className="card overflow-x-auto">
        <h2 className="text-heading-sm">In progress</h2>
        <p className="mt-1 text-caption text-graphite">Expired attempts are finalized automatically (scheduled job and on next access). Use “Finalize now” for exceptions; unanswered questions score as incorrect.</p>
        <table className="mt-4 w-full min-w-[640px]">
          <thead><tr><th className="table-head">Student</th><th className="table-head">Course</th><th className="table-head">Mode</th><th className="table-head">Started</th><th className="table-head">Expires</th><th className="table-head" /></tr></thead>
          <tbody>
            {(open ?? []).map((a) => {
              const overdue = Date.parse(a.expires_at) < now;
              return (
                <tr key={a.id}>
                  <td className="table-cell">{user.get(a.user_id)}</td><td className="table-cell">{course.get(a.course_id)}</td>
                  <td className="table-cell">{modeLabel(a.mode)}</td><td className="table-cell">{fmtDateTime(a.started_at)}</td>
                  <td className="table-cell">{fmtDateTime(a.expires_at)} {overdue && <Pill tone="coral">Overdue</Pill>}</td>
                  <td className="table-cell text-right">
                    <form action={finalizeAttempt}><input type="hidden" name="attempt_id" value={a.id} /><button className="btn-text py-1 text-caption" type="submit">Finalize now</button></form>
                  </td>
                </tr>
              );
            })}
            {!open?.length && <tr><td colSpan={6} className="table-cell text-graphite">None.</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="text-heading-sm">Recently finished</h2>
        <table className="mt-4 w-full min-w-[640px]">
          <thead><tr><th className="table-head">Student</th><th className="table-head">Course</th><th className="table-head">Mode</th><th className="table-head">Finished</th><th className="table-head">How</th><th className="table-head text-right">Score</th><th className="table-head" /></tr></thead>
          <tbody>
            {(recent ?? []).map((a) => (
              <tr key={a.id}>
                <td className="table-cell">{user.get(a.user_id)}</td><td className="table-cell">{course.get(a.course_id)}</td>
                <td className="table-cell">{modeLabel(a.mode)}</td><td className="table-cell">{fmtDateTime(a.submitted_at)}</td>
                <td className="table-cell">{a.finalized_reason === "timeout" ? <Pill tone="marigold">Timed out</Pill> : a.finalized_reason === "admin" ? <Pill tone="coral">Admin</Pill> : "Submitted"}
                  {a.unanswered_count === a.question_count && <span className="ml-1 text-caption text-vermillion">no answers</span>}</td>
                <td className="table-cell text-right tabular-nums">{fmtPct(a.score_pct, 1)}</td>
                <td className="table-cell text-right"><Link className="link text-caption" href={`/results/${a.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
