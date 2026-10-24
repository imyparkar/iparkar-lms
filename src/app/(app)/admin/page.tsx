import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { updateCourse } from "@/lib/admin/actions";
import { Pill } from "@/components/ui/Pill";
import { Flash } from "@/components/ui/Flash";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Admin" };

type Overview = {
  id: string; code: string; name: string; exams_enabled: boolean; is_visible: boolean;
  blueprint: { id: string; version: string; verification_status: string; last_reviewed: string | null } | null;
  questions: Record<string, number> | null;
  published_by_domain: { code: string; name: string; published: number; required_mixed: number }[] | null;
  active_entitlements: number; attempts: number; avg_score: number | null;
};

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_course_overview");
  const courses = (data?.courses ?? []) as Overview[];
  const { data: blocked } = await supabase.from("audit_logs").select("id, created_at, details, entity_id")
    .eq("action", "exam.generation_blocked").order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-6">
      <Flash sp={sp} />
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Courses</h1>
      <div className="space-y-4">
        {courses.map((c) => {
          const domains = c.published_by_domain ?? [];
          const ready = domains.every((d) => d.published >= Math.max(d.required_mixed ?? 0, 20));
          return (
            <section key={c.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-heading-sm">{c.code} · {c.name}</h2>
                  <p className="mt-1 text-body-sm text-graphite">
                    Blueprint {c.blueprint?.version ?? "—"} · <Pill tone={c.blueprint?.verification_status === "verified" ? "strong" : "marigold"}>{c.blueprint?.verification_status ?? "none"}</Pill>
                    {c.blueprint?.last_reviewed && <> · reviewed {fmtDate(c.blueprint.last_reviewed)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-body-sm">
                  {Object.entries(c.questions ?? {}).map(([s, n]) => <Pill key={s} tone={s === "published" ? "strong" : "neutral"}>{n} {s.replace("_", " ")}</Pill>)}
                  {!c.questions && <Pill>No questions</Pill>}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead><tr><th className="table-head">Domain</th><th className="table-head text-right">Published</th><th className="table-head text-right">Needed (mixed)</th><th className="table-head text-right">Needed (domain exam)</th><th className="table-head">Status</th></tr></thead>
                  <tbody>
                    {domains.map((d) => {
                      const ok = d.published >= Math.max(d.required_mixed ?? 0, 20);
                      return (
                        <tr key={d.code}>
                          <td className="table-cell"><span className="font-medium">{d.code}</span> {d.name}</td>
                          <td className="table-cell text-right tabular-nums">{d.published}</td>
                          <td className="table-cell text-right tabular-nums">{d.required_mixed ?? "—"}</td>
                          <td className="table-cell text-right tabular-nums">20</td>
                          <td className="table-cell">{ok ? <Pill tone="strong">Ready</Pill> : <Pill tone="coral">Short by {Math.max(d.required_mixed ?? 0, 20) - d.published}</Pill>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <p className="text-body-sm text-graphite">{c.active_entitlements} active students · {c.attempts} finished attempts · average {c.avg_score ?? "—"}%</p>
                <form action={updateCourse} className="flex flex-wrap items-center gap-4 text-body-sm">
                  <input type="hidden" name="course_id" value={c.id} />
                  <label className="flex items-center gap-2"><input type="checkbox" name="is_visible" defaultChecked={c.is_visible} className="h-4 w-4 accent-[#02093a]" /> Visible to students</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="exams_enabled" defaultChecked={c.exams_enabled} className="h-4 w-4 accent-[#02093a]" /> Exams enabled</label>
                  <button className="btn-outline" type="submit">Save</button>
                </form>
              </div>
              {!ready && c.exams_enabled && (
                <p className="text-caption text-vermillion">Exams are enabled but some domains are short: students will see an “insufficient questions” message until more items are published.</p>
              )}
            </section>
          );
        })}
      </div>

      <section className="card">
        <h2 className="text-heading-sm">Blocked exam generation</h2>
        {!blocked?.length ? <p className="mt-2 text-body-sm text-graphite">No blocked exams.</p> : (
          <ul className="mt-3 space-y-2 text-body-sm">
            {blocked.map((b) => (
              <li key={b.id}>{fmtDate(b.created_at)} — {(b.details as { shortages?: { domain_code: string; required: number; available: number }[] }).shortages?.map((s) => `${s.domain_code} needs ${s.required}, has ${s.available}`).join("; ")}</li>
            ))}
          </ul>
        )}
        <Link href="/admin/audit?action=exam.generation_blocked" className="link mt-3 inline-block text-body-sm">All events</Link>
      </section>
    </div>
  );
}
