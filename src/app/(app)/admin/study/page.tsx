import { requireAdmin } from "@/lib/auth/session";
import { enrollLearner, revokeLearner, setStudyVersionStatus } from "@/lib/study/adminActions";
import { Flash } from "@/components/ui/Flash";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Study courses" };
export const dynamic = "force-dynamic";

type V = { id: string; course: string; title: string; version: string; status: string; is_default: boolean; enrollment_policy: string;
  chapters: number; chapters_with_content: number; by_review: Record<string, number>; enrollments: number; completions: number;
  learners: { enrollment_id: string; username: string; name: string | null; pilot: boolean; last_activity_at: string | null; completed_at: string | null; chapters_completed: number }[] };

export default async function StudyAdmin({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_study_overview");
  const versions = (data?.versions ?? []) as V[];

  return (
    <div className="space-y-6">
      <Flash sp={sp} />
      <div>
        <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Study courses</h1>
        <p className="mt-1 text-body-sm text-graphite">Load content with <code>npm run import:study</code>. A version can be published only when every required chapter has lesson content and an approved review status. Pilot enrollments let named reviewers use an unpublished version; they are labelled as pilots everywhere.</p>
      </div>
      {versions.length === 0 && <div className="card text-body text-graphite">No study course versions yet.</div>}
      {versions.map((v) => (
        <section key={v.id} className="card space-y-5" aria-label={`${v.course} ${v.version}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-heading-sm">{v.title} · {v.version}</h2>
              <p className="text-body-sm text-graphite">{v.course} · status <strong>{v.status}</strong>{v.is_default ? " · default for self-enrolment" : ""} · enrolment policy {v.enrollment_policy}</p>
            </div>
            <form action={setStudyVersionStatus} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="version_id" value={v.id} />
              <label className="sr-only" htmlFor={`st-${v.id}`}>Status</label>
              <select id={`st-${v.id}`} name="status" defaultValue={v.status} className="field-input w-auto py-2">
                {["draft", "in_review", "approved", "published", "archived"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <button className="btn-outline" type="submit">Set status</button>
            </form>
          </div>
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-caption text-slate">Chapters with content</dt><dd className="text-body font-semibold">{v.chapters_with_content} of {v.chapters}</dd></div>
            <div><dt className="text-caption text-slate">Review status</dt><dd className="text-body-sm">{Object.entries(v.by_review).map(([k, n]) => `${k} ${n}`).join(" · ")}</dd></div>
            <div><dt className="text-caption text-slate">Active enrollments</dt><dd className="text-body font-semibold">{v.enrollments}</dd></div>
            <div><dt className="text-caption text-slate">Completions</dt><dd className="text-body font-semibold">{v.completions}</dd></div>
          </dl>
          <form action={enrollLearner} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="version_id" value={v.id} />
            <div><label className="field-label" htmlFor={`u-${v.id}`}>Enrol by username</label>
              <input id={`u-${v.id}`} name="username" required className="field-input w-56" /></div>
            {v.status !== "published" && <label className="flex items-center gap-2 pb-2.5 text-body-sm"><input type="checkbox" name="pilot" required /> Pilot (unpublished version)</label>}
            <button className="btn-outline" type="submit">Enrol</button>
          </form>
          {v.learners.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead><tr><th className="table-head">Learner</th><th className="table-head">Chapters</th><th className="table-head">Last activity</th><th className="table-head">Completed</th><th className="table-head"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {v.learners.map((l) => (
                    <tr key={l.enrollment_id}>
                      <td className="table-cell">{l.name ?? l.username} <span className="text-graphite">@{l.username}</span>{l.pilot ? " · pilot" : ""}</td>
                      <td className="table-cell">{l.chapters_completed} / {v.chapters}</td>
                      <td className="table-cell">{fmtDateTime(l.last_activity_at)}</td>
                      <td className="table-cell">{l.completed_at ? fmtDateTime(l.completed_at) : "—"}</td>
                      <td className="table-cell">
                        <form action={revokeLearner} className="flex gap-2">
                          <input type="hidden" name="enrollment_id" value={l.enrollment_id} />
                          <input name="reason" placeholder="Reason" required aria-label={`Reason to revoke ${l.username}`} className="field-input w-36 py-1.5" />
                          <button className="btn-text" type="submit">Revoke</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
