import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ProgressMeter } from "@/components/study/Progress";
import { GenerateCertificate } from "@/components/certificates/GenerateCertificate";
import { MakeupForm, PracticalSubmit } from "@/components/live/Forms";
import { EXAM_BLOCKED, type LiveDashboard, type LiveNotEnrolled } from "@/lib/live/types";
import { hoursMinutes, sessionWhen } from "@/lib/live/format";
import { razorpayReady, requestAccessUrl } from "@/lib/study/buy";
import { isOnSale } from "@/lib/payments/catalogue";
import { RazorpayButton } from "@/components/payments/RazorpayButton";

export const metadata = { title: "Live course" };
export const dynamic = "force-dynamic";

const Tick = ({ ok, label }: { ok: boolean; label: string }) => (
  <li className="flex items-start gap-2 text-body-sm">
    <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[12px] font-bold ${ok ? "bg-midnight text-white" : "bg-ink-20 text-ink"}`}>{ok ? "✓" : ""}</span>
    <span><span className="sr-only">{ok ? "Done: " : "Not yet: "}</span>{label}</span>
  </li>
);

const ATTEND: Record<string, string> = { present: "Attended", absent: "Missed" };
const MAKEUP: Record<string, string> = { open: "Make-up deadline extended", submitted: "Make-up submitted — awaiting review", approved: "Make-up approved", returned: "Make-up returned — please revise" };

/** Learner dashboard for a live instructor-led course: schedule and Teams links, attendance, practicals, independent study, exam, certificate. */
export default async function LiveCoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!/^[a-z]{2,8}$/.test(course)) notFound();
  const { supabase, user } = await requireUser();
  const { data } = await supabase.rpc("live_course_dashboard", { p_course_code: course.toUpperCase() });
  if (!data) notFound();
  if (!data.ok) {
    const d = data as LiveNotEnrolled;
    if (!d.course) notFound();
    return (
      <div className="card max-w-[720px] space-y-3">
        <p className="text-caption text-slate">iParkar Learning · Live online course</p>
        <h1 className="text-heading-sm">{d.course.title}</h1>
        {d.course.description && <p className="text-body text-charcoal">{d.course.description}</p>}
        <p className="text-body text-charcoal">Places are booked per cohort. Request a place and we&apos;ll confirm the next cohort&apos;s dates, the fee and how to pay.</p>
        <div className="flex flex-wrap gap-3">
          {razorpayReady() && isOnSale(d.course.code, 365) && (
            <RazorpayButton code={d.course.code} days={365} label="Buy a place" successHref={`/live/${course}?paid=1`} className="btn-primary" />
          )}
          <a className="btn-outline" href={requestAccessUrl(d.course.code, user)}>Request a place</a>
        </div>
      </div>
    );
  }
  const c = data as LiveDashboard;
  const tz = c.cohort?.time_zone ?? "Asia/Kuwait";
  const sDone = c.sessions.filter((s) => s.satisfied).length;
  const pDone = c.practicals.filter((p) => p.passed).length;
  const iDone = c.independent.filter((m) => m.done).length;
  const next = c.sessions.find((s) => s.ends_at && new Date(s.ends_at).getTime() > Date.now());
  const liveMinutes = c.sessions.reduce((s, x) => s + x.minutes, 0);
  const indMinutes = c.independent.reduce((s, x) => s + (x.minutes ?? 0), 0);
  const e = c.exam;

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href="/learn" className="hover:text-ink">My learning</Link> / <span className="text-ink">{c.course.title}</span></nav>

      <header className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <div>
          <p className="text-subheading text-graphite">iParkar Learning · Live online course</p>
          <h1 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-[-1.2px]">{c.course.title}</h1>
          <p className="lead mt-4 max-w-[640px]">
            {c.sessions.length} live sessions on Microsoft Teams ({hoursMinutes(liveMinutes)}), {c.practicals.length} practical assignments,
            {" "}{hoursMinutes(indMinutes)} of independent study and a 60-minute open-book course examination — {Number(c.course.designed_hours)} hours of study in all.
          </p>
          {c.cohort && <p className="mt-3 text-body-sm text-graphite">Your cohort: <span className="font-medium text-ink">{c.cohort.title}</span> · times shown in {tz}</p>}
          {next && c.links_visible && next.join_url && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href={next.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary">Join Session {next.no} on Teams</a>
              <span className="text-body-sm text-graphite">{sessionWhen(next.starts_at, next.ends_at, tz)}</span>
            </div>
          )}
        </div>
        <div className="card space-y-4">
          <ProgressMeter done={sDone} total={c.sessions.length} label="Live sessions attended or made up" />
          <ProgressMeter done={pDone} total={c.practicals.length} label="Practicals passed" />
          <ProgressMeter done={iDone} total={c.independent.length} label="Independent-study modules" />
          <p className="text-body-sm text-ink">{c.access.has_access ? (c.access.expires_at ? `Access until ${fmtDate(c.access.expires_at)}` : "Access · no time limit") : `Access ended ${fmtDate(c.access.expires_at)}`}</p>
        </div>
      </header>

      {!c.cohort && (
        <p role="status" className="rounded-button border border-[#e0a100]/40 bg-[#fff6dd] px-4 py-3 text-body-sm">
          <span className="font-semibold">You&apos;re enrolled.</span> Your instructor will place you in a cohort and the session dates and Teams links will appear here.
        </p>
      )}
      {c.cohort && !c.links_visible && (
        <p role="status" className="rounded-button border border-[#e0a100]/40 bg-[#fff6dd] px-4 py-3 text-body-sm">
          Teams joining links and recordings are shown once your payment is confirmed and while your access is open. Contact support@iparkar.com if you think this is wrong.
        </p>
      )}

      <section aria-labelledby="sched" className="space-y-4">
        <h2 id="sched" className="text-heading-sm">Live sessions</h2>
        <p className="text-body-sm text-graphite">Join each session on Microsoft Teams with your camera available for group work. If you miss one, watch the captioned recording and complete its make-up task within 14 days. All sessions must be attended or made up before the examination opens.</p>
        <ol className="space-y-3">
          {c.sessions.map((s) => {
            const upcoming = !s.ends_at || new Date(s.ends_at).getTime() > Date.now();
            return (
              <li key={s.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-caption text-slate">Session {s.no} · {hoursMinutes(s.minutes)}</p>
                    <h3 className="text-body font-semibold">{s.title}</h3>
                    <p className="text-body-sm text-graphite">{sessionWhen(s.starts_at, s.ends_at, tz)}{s.instructor ? ` · ${s.instructor}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.attendance && <span className={`pill ${s.satisfied ? "bg-midnight text-white" : "bg-marigold text-ink"}`}>{ATTEND[s.attendance]}</span>}
                    {s.makeup_status && <span className="pill bg-sky-tint text-ink">{MAKEUP[s.makeup_status]}</span>}
                    {upcoming && s.join_url && <a href={s.join_url} target="_blank" rel="noopener noreferrer" className="btn-outline">Join on Teams<span className="sr-only"> (Session {s.no}, opens in a new tab)</span></a>}
                    <Link href={`/scorm/${c.course.code.toLowerCase()}-slides/s${String(s.no).padStart(2, "0")}`} className="btn-text">Slides<span className="sr-only"> for Session {s.no}</span></Link>
                  </div>
                </div>
                {s.attendance === "absent" && !s.satisfied && (
                  <div className="mt-4 border-t border-hairline pt-4">
                    <p className="text-body-sm font-semibold">Make-up {s.makeup_deadline ? `— due ${fmtDateTime(s.makeup_deadline)}` : ""}</p>
                    {s.recording_url && <a href={s.recording_url} target="_blank" rel="noopener noreferrer" className="link text-body-sm">Watch the captioned recording<span className="sr-only"> (opens in a new tab)</span></a>}
                    {s.makeup_feedback && <p className="mt-2 text-body-sm"><span className="font-medium">Instructor feedback:</span> {s.makeup_feedback}</p>}
                    {s.makeup_status !== "submitted" && s.makeup_task && <MakeupForm course={course} session={s.id} task={s.makeup_task} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="prac" className="space-y-4">
        <h2 id="prac" className="text-heading-sm">Practical assignments</h2>
        <p className="text-body-sm text-graphite">Each practical is marked out of {c.practical_rules.max}; {c.practical_rules.pass} is a pass. You get written feedback within 7 days. If you don&apos;t pass, you can resubmit once within {c.practical_rules.resubmit_days} days, individually or in the make-up clinic. All practicals use fictional data — you never need to enter a hazardous area.</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {c.practicals.map((p) => {
            const last = p.submissions[p.submissions.length - 1];
            const canSubmit = c.access.has_access && !p.passed && (!last || (last.mark !== null && last.attempt_no < 2));
            return (
              <li key={p.code} className="card space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-caption text-slate">{p.code} · Session {p.session_no}</p>
                    <h3 className="text-body font-semibold">{p.title}</h3>
                  </div>
                  <span className={`pill ${p.passed ? "bg-midnight text-white" : last && last.mark === null ? "bg-sky-tint text-ink" : "bg-ink-20 text-ink"}`}>
                    {p.passed ? "Passed" : last ? (last.mark === null ? "Awaiting marking" : "Not yet passed") : "Not submitted"}
                  </span>
                </div>
                <a href={`/api/live/briefs/${course}/${p.code}`} className="link text-body-sm">Open the learner brief</a>
                {p.submissions.map((x) => (
                  <div key={x.id} className="rounded-button bg-sky-tint/50 px-3 py-2 text-body-sm">
                    <p>Attempt {x.attempt_no} · submitted {fmtDateTime(x.submitted_at)}{x.file_name && <> · <a className="link" href={`/api/live/submissions/${x.id}`}>{x.file_name}</a></>}</p>
                    {x.mark !== null && <p className="mt-1"><span className="font-semibold">Mark {x.mark}/{x.max}.</span> {x.feedback}</p>}
                  </div>
                ))}
                {canSubmit && (
                  <details className="group" open={!!last}>
                    <summary className="btn-outline cursor-pointer list-none">{last ? "Resubmit this practical" : "Submit your work"}<span className="sr-only"> for {p.code}</span></summary>
                    <PracticalSubmit course={course} code={p.code} attemptNo={last ? 2 : 1} />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="ind" className="space-y-4">
        <h2 id="ind" className="text-heading-sm">Independent study</h2>
        <p className="text-body-sm text-graphite">Six self-paced modules with retrieval practice, worked problems and exam preparation. Complete each one to the end.</p>
        <ul className="grid gap-3 md:grid-cols-3">
          {c.independent.map((m) => (
            <li key={m.module} className="card flex flex-col gap-2">
              <h3 className="text-body font-semibold">{m.title}</h3>
              <p className="text-body-sm text-graphite">{m.minutes ? hoursMinutes(m.minutes) : ""}{m.done && m.completed_at ? ` · completed ${fmtDate(m.completed_at)}` : ""}</p>
              {c.access.has_access && <Link href={`/scorm/${m.course}/${m.module}`} className={m.done ? "btn-outline mt-auto" : "btn-primary mt-auto"}>{m.done ? "Review" : m.status === "not attempted" ? "Start" : "Continue"}<span className="sr-only"> {m.title}</span></Link>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="exam" className="card space-y-4">
        <h2 id="exam" className="text-heading-sm">Final course examination</h2>
        <p className="text-body-sm text-charcoal">
          {e.items} single-best-answer questions, 1 mark each, in {e.minutes} minutes{e.extra_pct ? ` (${e.minutes_allowed} minutes with your approved extra time)` : ""}. Pass mark {e.pass_mark}/{e.items} ({Math.round((e.pass_mark / e.items) * 100)}%). Up to {e.max_attempts} attempts, with {e.cooldown_days} days between attempts. This is an internal iParkar Learning course examination; it is not the examination of a professional body.
        </p>
        {e.history.length > 0 && (
          <ul className="space-y-1 text-body-sm">
            {e.history.map((h) => (
              <li key={h.id}>Attempt {h.attempt_no}: {h.status === "in_progress" ? <Link className="link" href={`/live/${course}/exam/${h.id}`}>in progress — resume</Link>
                : <><Link className="link" href={`/live/${course}/exam/${h.id}/result`}>{h.score}/{h.max} — {h.passed ? "passed" : "not passed"}</Link> · {fmtDate(h.finished_at)}</>}</li>
            ))}
          </ul>
        )}
        {e.open_attempt ? <Link className="btn-primary" href={`/live/${course}/exam/${e.open_attempt}`}>Resume the examination</Link>
          : e.can_start ? <Link className="btn-primary" href={`/live/${course}/exam`}>Read the rules and start</Link>
          : e.blocked_reason && <p className="text-body-sm font-medium text-ink">{EXAM_BLOCKED[e.blocked_reason]}{e.blocked_reason === "cooldown" && e.next_allowed_at ? ` Next attempt from ${fmtDateTime(e.next_allowed_at)}.` : ""}</p>}
      </section>

      {c.certificate.offered && (
        <section aria-labelledby="cert" className="card space-y-4">
          <h2 id="cert" className="text-heading-sm">Certificate of completion</h2>
          <p className="text-body-sm text-charcoal">An iParkar Learning Certificate of Completion for {Number(c.course.designed_hours)} hours of designed study is issued when all three are true:</p>
          <ul className="space-y-2">
            <Tick ok={c.certificate.conditions.purchase} label="Your course purchase is confirmed (not a free preview, a pending payment or a refunded purchase)" />
            <Tick ok={c.certificate.conditions.activities} label="Every live session (or approved make-up), practical and independent-study module is complete" />
            <Tick ok={c.certificate.conditions.exam} label={`You scored ${e.pass_mark}/${e.items} or more in the final course examination`} />
          </ul>
          {(c.certificate.eligible || (c.certificate.issued && c.certificate.conditions.purchase)) ? (
            <GenerateCertificate course={c.course.code} suggestedName={c.certificate.suggested_name} issued={c.certificate.conditions.purchase ? c.certificate.issued : null}
                                 hint="for example as on your passport or ID" />
          ) : null}
        </section>
      )}
    </div>
  );
}
