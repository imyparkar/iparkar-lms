import { requireAdmin } from "@/lib/auth/session";
import { grantEntitlement, revokeEntitlement, setUserStatus } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { Pill } from "@/components/ui/Pill";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Students & access" };

type U = { id: string; username: string; full_name: string | null; email: string; role: string; status: string; created_at: string; attempts: number;
  entitlements: { id: string; course_code: string; source: string; starts_at: string; expires_at: string | null; revoked_at: string | null; active: boolean }[] };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireAdmin();
  const [{ data }, { data: courses }] = await Promise.all([
    supabase.rpc("admin_search_users", { p_query: sp.q ?? "", p_limit: 50 }),
    supabase.from("courses").select("id, code").order("sort_order"),
  ]);
  const users = (data?.users ?? []) as U[];
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

            <form action={grantEntitlement} className="flex flex-wrap items-end gap-2 border-t border-hairline pt-4 text-body-sm">
              <input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="q" value={q} />
              <div><label className="field-label" htmlFor={`c-${u.id}`}>Grant course</label>
                <select id={`c-${u.id}`} name="course_id" className="field-input py-1.5">{courses?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>
              <div><label className="field-label" htmlFor={`s-${u.id}`}>Type</label>
                <select id={`s-${u.id}`} name="source" className="field-input py-1.5"><option value="complimentary">Complimentary</option><option value="admin_grant">Admin grant</option><option value="purchase">Manual purchase record</option></select></div>
              <div><label className="field-label" htmlFor={`d-${u.id}`}>Days (0 = no expiry)</label>
                <input id={`d-${u.id}`} name="days" type="number" min={0} defaultValue={90} className="field-input w-28 py-1.5" /></div>
              <div className="min-w-[160px] flex-1"><label className="field-label" htmlFor={`n-${u.id}`}>Note</label><input id={`n-${u.id}`} name="note" className="field-input py-1.5" /></div>
              <button className="btn-outline" type="submit">Grant access</button>
            </form>
          </li>
        ))}
        {!users.length && <li className="card text-graphite">No users found.</li>}
      </ul>
    </div>
  );
}
