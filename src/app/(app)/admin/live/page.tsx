import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { AdminForm } from "@/components/live/AdminForm";
import { assignLearner, createCohort, recordPurchase, setForm } from "@/lib/live/adminActions";

export const metadata = { title: "Live courses" };
export const dynamic = "force-dynamic";

type Overview = {
  ok: boolean;
  cohorts: { id: string; code: string; title: string; status: string; learners: number; first_session: string | null }[];
  unassigned: { enrollment: string; name: string; username: string; source: string }[];
  pending_marking: number; pending_makeups: number;
  forms: { code: string; active: boolean; reviewed: boolean; items: number }[];
};

const COURSE = "OHBP";

/** Live course administration: cohorts, learners waiting for a cohort, offline payments and exam forms. */
export default async function AdminLive() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_live_overview", { p_course_code: COURSE });
  const o = data as Overview;
  if (!o?.ok) return <p className="text-body">Not available.</p>;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-heading-lg">Basic Principles in Occupational Hygiene</h1>
        <p className="text-body text-graphite">Live online course ({COURSE}) · {o.pending_marking} practical submissions to mark · {o.pending_makeups} make-up tasks to review</p>
      </header>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Cohorts</h2>
        <table className="w-full">
          <thead><tr><th scope="col" className="table-head">Cohort</th><th scope="col" className="table-head">Status</th><th scope="col" className="table-head">Learners</th><th scope="col" className="table-head">First session</th></tr></thead>
          <tbody>
            {o.cohorts.map((c) => (
              <tr key={c.id}>
                <td className="table-cell"><Link className="link" href={`/admin/live/${c.id}`}>{c.code}</Link> — {c.title}</td>
                <td className="table-cell">{c.status}</td><td className="table-cell">{c.learners}</td><td className="table-cell">{fmtDate(c.first_session)}</td>
              </tr>
            ))}
            {!o.cohorts.length && <tr><td className="table-cell" colSpan={4}>No cohorts yet.</td></tr>}
          </tbody>
        </table>
        <AdminForm action={createCohort} submit="Create cohort" className="grid gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
          <input type="hidden" name="course" value={COURSE} />
          <div><label className="field-label" htmlFor="cc">Code</label><input id="cc" name="code" className="field-input" placeholder="OHBP-2027-01" required /></div>
          <div><label className="field-label" htmlFor="ct">Title</label><input id="ct" name="title" className="field-input" placeholder="January 2027 cohort" required /></div>
          <div><label className="field-label" htmlFor="tz">Time zone</label><input id="tz" name="tz" className="field-input" defaultValue="Asia/Kuwait" /></div>
        </AdminForm>
      </section>

      <section className="card space-y-4">
        <h2 className="text-heading-sm">Learners waiting for a cohort</h2>
        {o.unassigned.length === 0 && <p className="text-body-sm text-graphite">Everyone is assigned.</p>}
        <ul className="space-y-2">
          {o.unassigned.map((u) => (
            <li key={u.enrollment}>
              <AdminForm action={assignLearner} submit="Assign" tone="btn-outline" className="flex flex-wrap items-end gap-3">
                <span className="text-body-sm">{u.name} <span className="text-graphite">({u.username} · {u.source})</span></span>
                <input type="hidden" name="enrollment" value={u.enrollment} />
                <label className="sr-only" htmlFor={`co-${u.enrollment}`}>Cohort for {u.name}</label>
                <select id={`co-${u.enrollment}`} name="cohort" className="field-input w-auto">
                  {o.cohorts.filter((c) => c.status !== "closed").map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </AdminForm>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-heading-sm">Record an offline payment</h2>
        <p className="text-body-sm text-graphite">For bank transfers and invoices. This counts as a verified purchase for the certificate; recording a refund later withdraws it. Online Razorpay payments are recorded automatically.</p>
        <AdminForm action={recordPurchase} submit="Record payment and grant access" className="grid gap-3 sm:grid-cols-5">
          <input type="hidden" name="course" value={COURSE} />
          <div className="sm:col-span-2"><label className="field-label" htmlFor="pu">Learner username or email</label><input id="pu" name="user" className="field-input" required /></div>
          <div><label className="field-label" htmlFor="pr">Payment reference</label><input id="pr" name="reference" className="field-input" required minLength={4} /></div>
          <div><label className="field-label" htmlFor="pa">Amount</label><input id="pa" name="amount" type="number" step="0.001" min="0.001" className="field-input" required /></div>
          <div><label className="field-label" htmlFor="pc">Currency</label><input id="pc" name="currency" className="field-input" defaultValue="KWD" pattern="[A-Za-z]{3}" required /></div>
          <input type="hidden" name="days" value="365" />
        </AdminForm>
      </section>

      <section className="card space-y-3">
        <h2 className="text-heading-sm">Examination forms</h2>
        <p className="text-body-sm text-graphite">Import forms with <code>npm run import:live-exam</code>. A form opens to learners only after the occupational hygiene reviewer has checked it. Retakes draw the form the learner has not yet seen.</p>
        {o.forms.map((f) => (
          <AdminForm key={f.code} action={setForm} submit="Save" tone="btn-outline" className="flex flex-wrap items-center gap-4">
            <input type="hidden" name="course" value={COURSE} /><input type="hidden" name="form" value={f.code} />
            <span className="text-body font-semibold">Form {f.code}</span><span className="text-body-sm text-graphite">{f.items} items</span>
            <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" name="reviewed" defaultChecked={f.reviewed} /> Technical review complete</label>
            <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" name="active" defaultChecked={f.active} /> Open to learners</label>
          </AdminForm>
        ))}
        {!o.forms.length && <p className="text-body-sm">No forms imported yet.</p>}
      </section>
    </div>
  );
}
