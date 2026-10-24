import { requireAdmin } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  let q = supabase.from("audit_logs").select("id, actor_id, action, entity, entity_id, details, created_at").order("created_at", { ascending: false }).limit(200);
  if (sp.action) q = q.eq("action", sp.action);
  const [{ data: logs }, { data: profiles }] = await Promise.all([q, supabase.from("profiles").select("id, username")]);
  const who = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Audit log</h1>
      <form method="get" className="flex gap-2">
        <select name="action" defaultValue={sp.action ?? ""} className="field-input max-w-xs" aria-label="Filter by action">
          <option value="">All actions</option>
          {["exam.started", "exam.finalized", "exam.generation_blocked", "questions.import", "questions.status", "blueprint.created", "blueprint.set_current", "blueprint.meta", "blueprint.weights", "entitlement.granted", "entitlement.revoked", "entitlement.purchase", "entitlement.revoked_by_payment", "user.status", "course.updated", "exam.config_updated", "settings.updated"]
            .map((a) => <option key={a}>{a}</option>)}
        </select>
        <button className="btn-outline" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead><tr><th className="table-head">When</th><th className="table-head">Who</th><th className="table-head">Action</th><th className="table-head">Entity</th><th className="table-head">Details</th></tr></thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id}>
                <td className="table-cell whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                <td className="table-cell">{l.actor_id ? who.get(l.actor_id) ?? l.actor_id.slice(0, 8) : "system"}</td>
                <td className="table-cell font-medium">{l.action}</td>
                <td className="table-cell text-caption">{l.entity} {l.entity_id?.slice(0, 8)}</td>
                <td className="table-cell max-w-[360px] break-words font-mono text-[11px] text-graphite">{JSON.stringify(l.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
