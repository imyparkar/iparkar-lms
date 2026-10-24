import { requireAdmin } from "@/lib/auth/session";
import { blueprintMeta, createBlueprintVersion, setCurrentBlueprint, updateWeights } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { Pill } from "@/components/ui/Pill";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Blueprints" };

type BP = { id: string; course_id: string; name: string; source: string; version: string; effective_date: string | null;
  verification_status: string; last_reviewed: string | null; is_current: boolean; notes: string | null; created_at: string;
  blueprint_domains: { domain_id: string; domain_name: string; weight: number; sort_order: number }[];
  blueprint_tasks: { task_id: string; task_name: string; sort_order: number }[] };

export default async function BlueprintsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: courses }, { data: bps }, { data: domains }, { data: tasks }, { data: used }] = await Promise.all([
    supabase.from("courses").select("id, code, name").order("sort_order"),
    supabase.from("blueprints").select("*, blueprint_domains(domain_id, domain_name, weight, sort_order), blueprint_tasks(task_id, task_name, sort_order)").order("created_at", { ascending: false }),
    supabase.from("course_domains").select("id, course_id, code, number, name").order("number"),
    supabase.from("course_tasks").select("id, domain_id, code").order("code"),
    supabase.from("exam_attempts").select("blueprint_id").limit(10000),
  ]);
  const usedSet = new Set((used ?? []).map((u) => u.blueprint_id));
  const dById = new Map((domains ?? []).map((d) => [d.id, d]));
  const tById = new Map((tasks ?? []).map((t) => [t.id, t]));

  return (
    <div className="space-y-6">
      <Flash sp={sp} />
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Blueprints</h1>
      <p className="lead">Each course keeps its own versioned blueprint. A version that has been used by any exam attempt is locked — change weights by creating a new version.</p>

      {(courses ?? []).map((c) => {
        const list = ((bps ?? []) as BP[]).filter((b) => b.course_id === c.id);
        const current = list.find((b) => b.is_current);
        const cDomains = (domains ?? []).filter((d) => d.course_id === c.id);
        return (
          <section key={c.id} className="card space-y-5">
            <h2 className="text-heading-sm">{c.code} · {c.name}</h2>
            {list.map((b) => {
              const locked = usedSet.has(b.id);
              const sum = b.blueprint_domains.reduce((s, d) => s + Number(d.weight), 0);
              const sorted = [...b.blueprint_domains].sort((x, y) => x.sort_order - y.sort_order);
              return (
                <article key={b.id} className={`rounded-button border p-4 ${b.is_current ? "border-midnight" : "border-hairline"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{b.name} <span className="text-graphite">· {b.version}</span></p>
                      <p className="mt-1 text-caption text-graphite">{b.source}</p>
                      <p className="mt-1 text-caption text-graphite">Effective {fmtDate(b.effective_date)} · created {fmtDate(b.created_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {b.is_current && <Pill tone="dark">Current</Pill>}
                      <Pill tone={b.verification_status === "verified" ? "strong" : "marigold"}>{b.verification_status}</Pill>
                      {locked && <Pill>Locked · in use</Pill>}
                      <Pill tone={Math.abs(sum - 100) < 0.001 ? "neutral" : "coral"}>Total {sum}%</Pill>
                    </div>
                  </div>
                  {b.notes && <p className="mt-2 text-body-sm text-graphite">{b.notes}</p>}

                  <form action={updateWeights} className="mt-4">
                    <input type="hidden" name="blueprint_id" value={b.id} />
                    <table className="w-full">
                      <thead><tr><th className="table-head">Domain</th><th className="table-head">Name in this version</th><th className="table-head w-28 text-right">Weight %</th></tr></thead>
                      <tbody>
                        {sorted.map((d) => (
                          <tr key={d.domain_id}>
                            <td className="table-cell font-medium">{dById.get(d.domain_id)?.code}</td>
                            <td className="table-cell">{d.domain_name}
                              {b.blueprint_tasks.filter((t) => tById.get(t.task_id)?.domain_id === d.domain_id).sort((x, y) => x.sort_order - y.sort_order).map((t) => (
                                <span key={t.task_id} className="mt-1 block text-caption text-graphite"><span className="font-semibold">{tById.get(t.task_id)?.code}</span> {t.task_name}</span>
                              ))}
                            </td>
                            <td className="table-cell text-right">
                              <input type="hidden" name="domain_id" value={d.domain_id} />
                              <input name="weight" type="number" step="0.001" min="0.001" max="100" defaultValue={Number(d.weight)} disabled={locked}
                                     aria-label={`Weight for ${dById.get(d.domain_id)?.code}`} className="field-input w-24 py-1.5 text-right disabled:bg-paper" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!locked && <button className="btn-outline mt-3" type="submit">Save weights</button>}
                  </form>

                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
                    <form action={blueprintMeta} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="blueprint_id" value={b.id} />
                      <div><label className="field-label" htmlFor={`v-${b.id}`}>Verification</label>
                        <select id={`v-${b.id}`} name="verification_status" defaultValue={b.verification_status} className="field-input py-1.5">
                          <option value="unverified">Unverified</option><option value="verified">Verified against official blueprint</option>
                        </select></div>
                      <div><label className="field-label" htmlFor={`r-${b.id}`}>Last reviewed</label>
                        <input id={`r-${b.id}`} type="date" name="last_reviewed" defaultValue={b.last_reviewed ?? ""} className="field-input py-1.5" /></div>
                      <div className="min-w-[220px] flex-1"><label className="field-label" htmlFor={`n-${b.id}`}>Notes</label>
                        <input id={`n-${b.id}`} name="notes" defaultValue={b.notes ?? ""} className="field-input py-1.5" /></div>
                      <button className="btn-outline" type="submit">Save details</button>
                    </form>
                    {!b.is_current && (
                      <form action={setCurrentBlueprint}>
                        <input type="hidden" name="blueprint_id" value={b.id} />
                        <button className="btn-dark" type="submit">Make current</button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}

            <details className="rounded-button border border-dashed border-ink-20 p-4">
              <summary className="cursor-pointer text-body-sm font-medium">Create a new {c.code} blueprint version</summary>
              <form action={createBlueprintVersion} className="mt-4 space-y-4">
                <input type="hidden" name="course_id" value={c.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><label className="field-label">Version label</label><input name="version" required className="field-input" placeholder={`${c.code}-2027`} /></div>
                  <div><label className="field-label">Name</label><input name="name" required className="field-input" defaultValue={current?.name} /></div>
                  <div><label className="field-label">Effective date</label><input name="effective_date" type="date" className="field-input" /></div>
                </div>
                <div><label className="field-label">Source</label><input name="source" required className="field-input" placeholder="Official blueprint document title and URL" /></div>
                <table className="w-full">
                  <thead><tr><th className="table-head">Domain</th><th className="table-head">Name</th><th className="table-head w-28 text-right">Weight %</th></tr></thead>
                  <tbody>
                    {cDomains.map((d) => {
                      const cur = current?.blueprint_domains.find((x) => x.domain_id === d.id);
                      return (
                        <tr key={d.id}>
                          <td className="table-cell font-medium">{d.code}<input type="hidden" name="domain_id" value={d.id} /></td>
                          <td className="table-cell"><input name="domain_name" className="field-input py-1.5" defaultValue={cur?.domain_name ?? d.name} /></td>
                          <td className="table-cell"><input name="weight" type="number" step="0.001" min="0.001" max="100" required className="field-input py-1.5 text-right" defaultValue={cur ? Number(cur.weight) : ""} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div><label className="field-label">Notes</label><input name="notes" className="field-input" /></div>
                <button className="btn-primary" type="submit">Create version</button>
                <p className="text-caption text-graphite">The new version is not used until you make it current. Weights must total 100%.</p>
              </form>
            </details>
          </section>
        );
      })}
    </div>
  );
}
