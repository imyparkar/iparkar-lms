import { requireAdmin } from "@/lib/auth/session";
import { grantEntitlement, grantStudyAccess, revokeEntitlement, revokeStudyAccess, setUserStatus } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { Pill } from "@/components/ui/Pill";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Students & access" };

type U = { id: string; username: string; full_name: string | null; email: string; role: string; status: string; created_at: string; attempts: number;
  entitlements: { id: string; course_code: string; source: string; starts_at: string; expires_at: string | null; revoked_at: string | null; active: boolean }[] };

type StudyRow = { id: string; user_id: string; status: string; access_source: string; enrolled_at: string;
  access_expires_at: string | null; revoked_at: string | null; study_courses: { code: string } | { code: string }[] | null };

const studyCode = (r: StudyRow) => (Array.isArray(r.study_courses) ? r.study_courses[0]?.code : r.study_courses?.code) ?? "?";
const studyActive = (r: StudyRow) => r.status === "active" && (!r.access_expires_at || new Date(r.access_expires_at) > new Date());
const SOURCE: Record<string, string> = { trial: "free trial", purchase: "purchase", admin: "admin grant", pilot: "pilot", self: "self enrol" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireAdmin();
  const [{ data }, { data: courses }] = await Promise.all([
    supabase.rpc("admin_search_users", { p_query: sp.q ?? "", p_limit: 50 }),
    supabase.from("courses").select("id, code").order("sort_order"),
  ]);
  const users = (data?.users ?? []) as U[];
  // Study courses (My learning) are a separate catalogue from the practice-exam packages.
  const [{ data: studyCourses }, { data: studyRaw }] = await Promise.all([
    supabase.from("study_courses").select("code, title").order("code"),
    users.length
      ? supabase.from("study_enrollments").select("id, user_id, status, access_source, enrolled_at, access_expires_at, revoked_at, study_courses(code)")
          .in("user_id", users.map((u) => u.id))
      : Promise.resolve({ data: [] as StudyRow[] }),
  ]);
  const study = (studyRaw ?? []) as StudyRow[];
  const q = sp.q ?? "";

  return (
    <div className="space-y-5">
      <Flash sp={sp} />
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Students & access</h1>
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, username or email" className="field-input max-w-md" aria-label="Search students" />
        <button className="btn-outline" type="submit">Search</button>
      </form>
      <p className="text-caption text-graphite">Paid access is granted automatically by the payment webhook. Use these controls for complimentary access, corrections and revocations — every change is audited.</p>

      <ul className="space-y-3">
        {users.map((u) => (
          <li key={u.id} className="card space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{u.full_name ?? u.username} <span className="font-normal text-graphite">@{u.username}</span></p>
                <p className="text-body-sm text-graphite">{u.email} · joined {fmtDate(u.created_at)} · {u.attempts} attempt{u.attempts === 1 ? "" : "s"}</p>
              </div>
              <div className="flex items-center gap-2">
                {u.role === "admin" && <Pill tone="dark">Admin</Pill>}
                <Pill tone={u.status === "active" ? "strong" : "coral"}>{u.status}</Pill>
                {u.id !== profile.id && (
                  <form action={setUserStatus}>
                    <input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="q" value={q} />
                    <input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
                    <button className="btn-text py-1 text-caption" type="submit">{u.status === "active" ? "Suspend" : "Reactivate"}</button>
                  </form>
                )}
              </div>
            </div>

            <h3 className="border-t border-hairline pt-4 text-body font-semibold">Exam packages</h3>
            {u.entitlements.length > 0 && (
              <table className="w-full">
                <thead><tr><th className="table-head">Course</th><th className="table-head">Source</th><th className="table-head">From</th><th className="table-head">Until</th><th className="table-head">Status</th><th className="table-head" /></tr></thead>
                <tbody>
                  {u.entitlements.map((e) => (
                    <tr key={e.id}>
                      <td className="table-cell font-medium">{e.course_code}</td>
                      <td className="table-cell">{e.source.replace("_", " ")}</td>
                      <td className="table-cell">{fmtDate(e.starts_at)}</td>
                      <td className="table-cell">{e.expires_at ? fmtDate(e.expires_at) : "No expiry"}</td>
                      <td className="table-cell"><Pill tone={e.active ? "strong" : "neutral"}>{e.revoked_at ? "Revoked" : e.active ? "Active" : "Expired"}</Pill></td>
                      <td className="table-cell text-right">
                        {e.active && (
                          <form action={revokeEntitlement} className="inline-flex gap-2">
                            <input type="hidden" name="entitlement_id" value={e.id} /><input type="hidden" name="q" value={q} />
                            <input name="reason" placeholder="Reason" className="field-input w-36 py-1 text-caption" aria-label="Revocation reason" />
                            <button className="btn-text py-1 text-caption" type="submit">Revoke</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form action={grantEntitlement} className="flex flex-wrap items-end gap-2 text-body-sm">
              <input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="q" value={q} />
              <div><label className="field-label" htmlFor={`c-${u.id}`}>Grant exam package</label>
                <select id={`c-${u.id}`} name="course_id" className="field-input py-1.5">{courses?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>
              <div><label className="field-label" htmlFor={`s-${u.id}`}>Type</label>
                <select id={`s-${u.id}`} name="source" className="field-input py-1.5"><option value="complimentary">Complimentary</option><option value="admin_grant">Admin grant</option><option value="purchase">Manual purchase record</option></select></div>
              <div><label className="field-label" htmlFor={`d-${u.id}`}>Days (0 = no expiry)</label>
                <input id={`d-${u.id}`} name="days" type="number" min={0} defaultValue={90} className="field-input w-28 py-1.5" /></div>
              <div className="min-w-[160px] flex-1"><label className="field-label" htmlFor={`n-${u.id}`}>Note</label><input id={`n-${u.id}`} name="note" className="field-input py-1.5" /></div>
              <button className="btn-outline" type="submit">Grant access</button>
            </form>
            <div className="space-y-3 border-t border-hairline pt-4">
              <h3 className="text-body font-semibold">My learning (study courses)</h3>
              {study.filter((r) => r.user_id === u.id).length > 0 && (
                <table className="w-full">
                  <thead><tr><th className="table-head">Course</th><th className="table-head">Source</th><th className="table-head">Enrolled</th><th className="table-head">Until</th><th className="table-head">Status</th><th className="table-head" /></tr></thead>
                  <tbody>
                    {study.filter((r) => r.user_id === u.id).map((r) => {
                      const active = studyActive(r);
                      return (
                        <tr key={r.id}>
                          <td className="table-cell font-medium">{studyCode(r)}</td>
                          <td className="table-cell">{SOURCE[r.access_source] ?? r.access_source}</td>
                          <td className="table-cell">{fmtDate(r.enrolled_at)}</td>
                          <td className="table-cell">{r.access_expires_at ? fmtDate(r.access_expires_at) : "No expiry"}</td>
                          <td className="table-cell"><Pill tone={active ? "strong" : "neutral"}>{r.status === "revoked" ? "Revoked" : active ? "Active" : r.access_source === "trial" ? "Trial ended" : "Expired"}</Pill></td>
                          <td className="table-cell text-right">
                            {r.status === "active" && (
                              <form action={revokeStudyAccess} className="inline-flex gap-2">
                                <input type="hidden" name="enrollment_id" value={r.id} /><input type="hidden" name="q" value={q} />
                                <input name="reason" placeholder="Reason" className="field-input w-36 py-1 text-caption" aria-label="Revocation reason" />
                                <button className="btn-text py-1 text-caption" type="submit">Revoke</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {studyCourses && studyCourses.length > 0 && (
                <form action={grantStudyAccess} className="flex flex-wrap items-end gap-2 text-body-sm">
                  <input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="q" value={q} />
                  <div><label className="field-label" htmlFor={`sc-${u.id}`}>Study course</label>
                    <select id={`sc-${u.id}`} name="course_code" className="field-input py-1.5">{studyCourses.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title}</option>)}</select></div>
                  <div><label className="field-label" htmlFor={`sd-${u.id}`}>Days from today (0 = no expiry)</label>
                    <input id={`sd-${u.id}`} name="days" type="number" min={0} max={3650} defaultValue={30} className="field-input w-28 py-1.5" /></div>
                  <div className="min-w-[160px] flex-1"><label className="field-label" htmlFor={`sn-${u.id}`}>Note</label><input id={`sn-${u.id}`} name="note" className="field-input py-1.5" /></div>
                  <button className="btn-outline" type="submit">Grant study access</button>
                </form>
              )}
              <p className="text-caption text-graphite">Granting keeps the learner&apos;s progress, notes and bookmarks, and replaces any ended trial or lapsed access.</p>
            </div>

          </li>
        ))}
        {!users.length && <li className="card text-graphite">No users found.</li>}
      </ul>
    </div>
  );
}
