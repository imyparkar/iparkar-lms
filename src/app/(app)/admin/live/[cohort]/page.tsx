import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { AdminForm } from "@/components/live/AdminForm";
import { extendMakeup, markPractical, recordAttendance, reviewMakeup, setAccommodation, updateSession } from "@/lib/live/adminActions";
import type { LiveExamStatus, LiveModule, LivePractical, LiveSession } from "@/lib/live/types";
import { sessionWhen } from "@/lib/live/format";

export const metadata = { title: "Cohort" };
export const dynamic = "force-dynamic";

type Learner = {
  enrollment: string; name: string; username: string; purchase_verified: boolean; access: { has_access: boolean; source: string };
  sessions: LiveSession[]; practicals: LivePractical[]; independent: LiveModule[]; activities_complete: boolean; exam: LiveExamStatus;
  makeups: { session: string; status: string; response: string; submitted_at: string }[]; certificate: string | null;
};
type Cohort = {
  ok: boolean; cohort: { id: string; code: string; title: string; status: string; time_zone: string };
  sessions: { id: string; no: number; title: string; minutes: number; starts_at: string | null; ends_at: string | null; join_url: string | null; recording_url: string | null; instructor: string | null }[];
  learners: Learner[];
};

/** "2027-01-10T09:00" in the cohort's zone, for a datetime-local input. */
function localValue(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Instructor workspace for one cohort: schedule and Teams links, attendance, make-ups, marking and accommodations. */
export default async function AdminCohort({ params }: { params: Promise<{ cohort: string }> }) {
  const { cohort } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(cohort)) notFound();
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_live_cohort", { p_cohort: cohort });
  if (!data?.ok) notFound();
  const c = data as Cohort;
  const tz = c.cohort.time_zone;
  const pending = c.learners.flatMap((l) => l.practicals.flatMap((p) => p.submissions.filter((s) => s.mark === null).map((s) => ({ l, p, s }))));
  const details = await Promise.all(pending.map(async (x) => (await supabase.rpc("admin_live_submission", { p_submission: x.s.id })).data));
  const makeups = c.learners.flatMap((l) => l.makeups.filter((m) => m.status === "submitted").map((m) => ({ l, m, s: c.sessions.find((s) => s.id === m.session) })));

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href="/admin/live" className="hover:text-ink">Live courses</Link> / <span className="text-ink">{c.cohort.code}</span></nav>
      <h1 className="text-heading-lg">{c.cohort.title} <span className="text-body text-graphite">({c.cohort.code} · {c.cohort.status} · times in {tz})</span></h1>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Schedule and Teams links</h2>
        <p className="text-body-sm text-graphite">Paste each session&apos;s Microsoft Teams meeting link (https://teams.microsoft.com/…). Learners see it only with a verified purchase. Add the captioned recording link after the session for make-ups.</p>
        {c.sessions.map((s) => (
          <details key={s.id} className="rounded-button border border-hairline p-3">
            <summary className="cursor-pointer text-body-sm"><span className="font-semibold">Session {s.no}: {s.title}</span> — {sessionWhen(s.starts_at, s.ends_at, tz)} {s.join_url ? "· Teams link set" : "· no Teams link"}{s.recording_url ? " · recording set" : ""}</summary>
            <AdminForm action={updateSession} submit="Save session" className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="session" value={s.id} /><input type="hidden" name="cohort" value={c.cohort.id} /><input type="hidden" name="tz" value={tz} />
              <div><label className="field-label" htmlFor={`st-${s.id}`}>Start ({tz})</label><input id={`st-${s.id}`} name="start" type="datetime-local" className="field-input" defaultValue={localValue(s.starts_at, tz)} /></div>
              <div><label className="field-label" htmlFor={`mn-${s.id}`}>Length (minutes)</label><input id={`mn-${s.id}`} name="minutes" type="number" min={10} max={600} className="field-input" defaultValue={s.starts_at && s.ends_at ? Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000) : s.minutes} /></div>
              <div className="sm:col-span-2"><label className="field-label" htmlFor={`jn-${s.id}`}>Teams meeting link</label><input id={`jn-${s.id}`} name="join" type="url" className="field-input" defaultValue={s.join_url ?? ""} placeholder="https://teams.microsoft.com/l/meetup-join/…" /></div>
              <div><label className="field-label" htmlFor={`rc-${s.id}`}>Captioned recording link</label><input id={`rc-${s.id}`} name="recording" type="url" className="field-input" defaultValue={s.recording_url ?? ""} /></div>
              <div><label className="field-label" htmlFor={`in-${s.id}`}>Instructor</label><input id={`in-${s.id}`} name="instructor" className="field-input" defaultValue={s.instructor ?? ""} /></div>
            </AdminForm>
          </details>
        ))}
      </section>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Attendance</h2>
        <p className="text-body-sm text-graphite">Record each session from the Teams attendance report. A learner marked as missed gets the recording and a make-up task (due 14 days after the session).</p>
        {c.sessions.map((s) => (
          <details key={s.id} className="rounded-button border border-hairline p-3">
            <summary className="cursor-pointer text-body-sm font-semibold">Session {s.no} — {c.learners.filter((l) => l.sessions.find((x) => x.id === s.id)?.attendance).length} of {c.learners.length} recorded</summary>
            <AdminForm action={recordAttendance} submit={`Save Session ${s.no} attendance`} className="mt-3">
              <input type="hidden" name="session" value={s.id} /><input type="hidden" name="cohort" value={c.cohort.id} />
              <table className="w-full">
                <thead><tr><th scope="col" className="table-head">Learner</th><th scope="col" className="table-head">Attendance</th><th scope="col" className="table-head">Minutes</th></tr></thead>
                <tbody>
                  {c.learners.map((l) => {
                    const a = l.sessions.find((x) => x.id === s.id)?.attendance ?? "";
                    return (
                      <tr key={l.enrollment}>
                        <th scope="row" className="table-cell text-left font-normal">{l.name}</th>
                        <td className="table-cell">
                          <fieldset className="flex gap-4"><legend className="sr-only">{l.name}</legend>
                            <label className="flex items-center gap-1"><input type="radio" name={`att:${l.enrollment}`} value="present" defaultChecked={a === "present"} /> Present</label>
                            <label className="flex items-center gap-1"><input type="radio" name={`att:${l.enrollment}`} value="absent" defaultChecked={a === "absent"} /> Missed</label>
                          </fieldset>
                        </td>
                        <td className="table-cell"><label className="sr-only" htmlFor={`m-${s.id}-${l.enrollment}`}>Minutes for {l.name}</label><input id={`m-${s.id}-${l.enrollment}`} name={`min:${l.enrollment}`} type="number" min={0} max={600} className="field-input w-24" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminForm>
          </details>
        ))}
      </section>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Make-up tasks to review ({makeups.length})</h2>
        {makeups.map(({ l, m, s }) => (
          <AdminForm key={`${m.session}-${l.enrollment}`} action={reviewMakeup} submit="Save review" className="rounded-button border border-hairline p-3">
            <p className="text-body-sm font-semibold">{l.name} · Session {s?.no}: {s?.title} · submitted {fmtDateTime(m.submitted_at)}</p>
            <p className="mt-2 whitespace-pre-wrap text-body-sm">{m.response}</p>
            <input type="hidden" name="session" value={m.session} /><input type="hidden" name="enrollment" value={l.enrollment} /><input type="hidden" name="cohort" value={c.cohort.id} />
            <div className="mt-2 flex flex-wrap gap-4 text-body-sm">
              <label className="flex items-center gap-1"><input type="radio" name="decision" value="approve" defaultChecked /> Approve</label>
              <label className="flex items-center gap-1"><input type="radio" name="decision" value="return" /> Return for revision</label>
            </div>
            <label className="field-label mt-2" htmlFor={`fb-${m.session}-${l.enrollment}`}>Feedback</label>
            <textarea id={`fb-${m.session}-${l.enrollment}`} name="feedback" rows={2} className="field-input" />
          </AdminForm>
        ))}
      </section>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Practicals to mark ({pending.length})</h2>
        <p className="text-body-sm text-graphite">Mark out of 10 against the rubric in the assessor pack (pass 6). Feedback is required and is shown to the learner.</p>
        {pending.map(({ l, p, s }, k) => {
          const d = details[k];
          return (
            <AdminForm key={s.id} action={markPractical} submit="Save mark" className="rounded-button border border-hairline p-3">
              <p className="text-body-sm font-semibold">{l.name} · {p.code} {p.title} · attempt {s.attempt_no} ({s.route}) · {fmtDateTime(s.submitted_at)}</p>
              {d?.response && <p className="mt-2 whitespace-pre-wrap text-body-sm">{d.response}</p>}
              {s.file_name && <a className="link text-body-sm" href={`/api/live/submissions/${s.id}`}>Download {s.file_name}</a>}
              <input type="hidden" name="submission" value={s.id} /><input type="hidden" name="cohort" value={c.cohort.id} />
              <div className="mt-2 grid gap-3 sm:grid-cols-[120px_1fr]">
                <div><label className="field-label" htmlFor={`mk-${s.id}`}>Mark /10</label><input id={`mk-${s.id}`} name="mark" type="number" min={0} max={10} className="field-input" required /></div>
                <div><label className="field-label" htmlFor={`fd-${s.id}`}>Feedback</label><textarea id={`fd-${s.id}`} name="feedback" rows={2} minLength={10} className="field-input" required /></div>
              </div>
            </AdminForm>
          );
        })}
      </section>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Learner progress</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr>
              <th scope="col" className="table-head">Learner</th><th scope="col" className="table-head">Purchase</th><th scope="col" className="table-head">Sessions</th>
              <th scope="col" className="table-head">Practicals</th><th scope="col" className="table-head">Independent</th><th scope="col" className="table-head">Exam</th>
              <th scope="col" className="table-head">Certificate</th><th scope="col" className="table-head">Extra time</th>
            </tr></thead>
            <tbody>
              {c.learners.map((l) => (
                <tr key={l.enrollment}>
                  <th scope="row" className="table-cell text-left font-normal">{l.name}<br /><span className="text-caption text-slate">{l.username}</span></th>
                  <td className="table-cell">{l.purchase_verified ? "Verified" : `Not verified (${l.access.source})`}</td>
                  <td className="table-cell">{l.sessions.filter((s) => s.satisfied).length}/{l.sessions.length}
                    {l.sessions.filter((s) => s.attendance === "absent" && !s.satisfied).map((s) => (
                      <AdminForm key={s.id} action={extendMakeup} submit={`Extend S${s.no}`} tone="btn-text" className="mt-1">
                        <input type="hidden" name="session" value={s.id} /><input type="hidden" name="enrollment" value={l.enrollment} /><input type="hidden" name="cohort" value={c.cohort.id} />
                        <input type="hidden" name="days" value="7" /><input name="reason" className="field-input w-36" placeholder="Reason (+7 days)" aria-label={`Reason for extending Session ${s.no} for ${l.name}`} />
                      </AdminForm>
                    ))}
                  </td>
                  <td className="table-cell">{l.practicals.filter((p) => p.passed).length}/{l.practicals.length}</td>
                  <td className="table-cell">{l.independent.filter((m) => m.done).length}/{l.independent.length}</td>
                  <td className="table-cell">{l.exam.best ? `${l.exam.best.score}/${l.exam.best.max} ${l.exam.passed ? "pass" : ""}` : "—"} · {l.exam.attempts_used}/{l.exam.max_attempts}</td>
                  <td className="table-cell">{l.certificate ?? "—"}</td>
                  <td className="table-cell">
                    <AdminForm action={setAccommodation} submit="Set" tone="btn-text" className="flex items-end gap-2">
                      <input type="hidden" name="enrollment" value={l.enrollment} /><input type="hidden" name="cohort" value={c.cohort.id} />
                      <label className="sr-only" htmlFor={`ac-${l.enrollment}`}>Extra time for {l.name}</label>
                      <select id={`ac-${l.enrollment}`} name="pct" className="field-input w-24" defaultValue={String(l.exam.extra_pct)}>
                        <option value="0">None</option><option value="25">+25%</option>
                      </select>
                      <input type="hidden" name="note" value="Approved accommodation" />
                    </AdminForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
