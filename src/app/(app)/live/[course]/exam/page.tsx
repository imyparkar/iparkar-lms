import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { StartExamForm } from "@/components/live/Forms";
import { EXAM_BLOCKED, type LiveDashboard } from "@/lib/live/types";

export const metadata = { title: "Final course examination" };
export const dynamic = "force-dynamic";

/** Rules and permitted aids, stated before the learner begins. */
export default async function LiveExamRules({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!/^[a-z]{2,8}$/.test(course)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("live_course_dashboard", { p_course_code: course.toUpperCase() });
  if (!data?.ok) redirect(`/live/${course}`);
  const c = data as LiveDashboard;
  const e = c.exam;
  if (e.open_attempt) redirect(`/live/${course}/exam/${e.open_attempt}`);
  const next = e.attempts_used + 1;

  return (
    <div className="max-w-[760px] space-y-6">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href={`/live/${course}`} className="hover:text-ink">{c.course.title}</Link> / <span className="text-ink">Final examination</span></nav>
      <h1 className="text-heading-lg">Final course examination</h1>
      <section className="card space-y-3">
        <h2 className="text-body font-semibold">Format</h2>
        <ul className="list-disc space-y-1 pl-5 text-body">
          <li>{e.items} single-best-answer multiple-choice questions, 1 mark each (maximum {e.items}).</li>
          <li>Time allowed: {e.minutes_allowed} minutes{e.extra_pct ? ` (includes your approved ${e.extra_pct}% extra time)` : ""}. The timer runs on our server and keeps running if you close the page or lose your connection.</li>
          <li>Pass mark: {e.pass_mark} correct answers ({Math.round((e.pass_mark / e.items) * 100)}%). Wrong and unanswered questions score zero, so answer every question.</li>
          <li>Your answers save as you go. When time runs out, the answers saved so far are submitted automatically.</li>
          <li>This is attempt {next} of {e.max_attempts}. After an unsuccessful attempt you can retake it after {e.cooldown_days} days; a retake uses a different set of questions.</li>
        </ul>
      </section>
      <section className="card space-y-3">
        <h2 className="text-body font-semibold">Permitted aids (open book)</h2>
        <ul className="list-disc space-y-1 pl-5 text-body">
          <li>Your own course notes, the session slides, the independent-study modules and the course glossary.</li>
          <li>Printed or online reference documents, such as HSE guidance and EH40, and a calculator.</li>
          <li>Not permitted: help from another person, sharing or copying the questions, or using someone else&apos;s account.</li>
        </ul>
        <p className="text-body-sm text-graphite">This is an internal iParkar Learning course examination. It does not lead to a professional body qualification; if you want the official qualification, contact the awarding body or one of its approved training providers.</p>
      </section>
      {e.can_start ? <StartExamForm course={c.course.code} label={`Start attempt ${next}`} />
        : <p className="text-body font-medium">{e.blocked_reason ? EXAM_BLOCKED[e.blocked_reason] : ""}{e.blocked_reason === "cooldown" && e.next_allowed_at ? ` Next attempt from ${fmtDateTime(e.next_allowed_at)}.` : ""}</p>}
    </div>
  );
}
