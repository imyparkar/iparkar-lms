import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { bulkStatusAction } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { Pill } from "@/components/ui/Pill";
import { SelectAll } from "@/components/ui/SelectAll";

export const metadata = { title: "Questions" };
const PAGE = 50;
const STATUSES = ["draft", "in_review", "published", "archived"] as const;

type SP = { course?: string; domain?: string; status?: string; q?: string; page?: string; notice?: string; error?: string };

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: courses } = await supabase.from("courses").select("id, code").order("sort_order");
  const course = courses?.find((c) => c.code === (sp.course ?? "ASP")) ?? courses?.[0];
  const { data: domains } = await supabase.from("course_domains").select("id, code, name").eq("course_id", course?.id ?? "").order("number");
  const { data: tasks } = await supabase.from("course_tasks").select("id, code").eq("course_id", course?.id ?? "");
  const page = Math.max(1, Number(sp.page ?? 1));

  let query = supabase.from("questions")
    .select("id, external_ref, stem, status, version, domain_id, task_id, cognitive_level, updated_at", { count: "exact" })
    .eq("course_id", course?.id ?? "")
    .order("external_ref", { ascending: true, nullsFirst: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const dom = domains?.find((d) => d.code === sp.domain);
  if (dom) query = query.eq("domain_id", dom.id);
  if (sp.status && STATUSES.includes(sp.status as never)) query = query.eq("status", sp.status);
  if (sp.q) query = query.or(`stem.ilike.%${sp.q.replace(/[%,()]/g, " ")}%,external_ref.ilike.%${sp.q.replace(/[%,()]/g, " ")}%`);
  const { data: rows, count } = await query;

  const dMap = new Map((domains ?? []).map((d) => [d.id, d.code]));
  const tMap = new Map((tasks ?? []).map((t) => [t.id, t.code]));
  const qs = (o: Partial<SP>) => {
    const p = new URLSearchParams({ course: course?.code ?? "", ...(sp.domain && { domain: sp.domain }), ...(sp.status && { status: sp.status }), ...(sp.q && { q: sp.q }), ...o } as Record<string, string>);
    return `/admin/questions?${p}`;
  };
  const back = qs({ page: String(page) });
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <div className="space-y-5">
      <Flash sp={sp} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Question bank</h1>
        <div className="flex gap-2">
          <Link href={`/admin/questions/new?course=${course?.code}`} className="btn-outline">New question</Link>
          <Link href="/admin/questions/import" className="btn-primary">Import</Link>
        </div>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div><label className="field-label" htmlFor="course">Course</label>
          <select id="course" name="course" defaultValue={course?.code} className="field-input">{courses?.map((c) => <option key={c.id}>{c.code}</option>)}</select></div>
        <div><label className="field-label" htmlFor="domain">Domain</label>
          <select id="domain" name="domain" defaultValue={sp.domain ?? ""} className="field-input"><option value="">All</option>{domains?.map((d) => <option key={d.id} value={d.code}>{d.code} {d.name}</option>)}</select></div>
        <div><label className="field-label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className="field-input"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
        <div className="min-w-[200px] flex-1"><label className="field-label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="ID or text" className="field-input" /></div>
        <button className="btn-outline" type="submit">Filter</button>
      </form>

      <form id="bulk" action={bulkStatusAction} className="flex flex-wrap items-center gap-2 text-body-sm">
        <input type="hidden" name="back" value={back} />
        <span className="text-graphite">{count ?? 0} question{count === 1 ? "" : "s"} · with selected:</span>
        <select name="status" className="field-input w-auto py-1.5" defaultValue="published">
          <option value="published">Publish</option><option value="in_review">Send to review</option>
          <option value="draft">Move to draft</option><option value="archived">Archive</option>
        </select>
        <button className="btn-outline py-1.5" type="submit">Apply</button>
        <span className="text-caption text-slate">Publishing checks each item has options, a key and an explanation.</span>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead><tr>
            <th className="table-head w-10"><SelectAll form="bulk" /></th>
            <th className="table-head">ID</th><th className="table-head">Domain / task</th><th className="table-head">Stem</th>
            <th className="table-head">Level</th><th className="table-head">Status</th><th className="table-head text-right">v</th>
          </tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="hover:bg-paper">
                <td className="table-cell"><input type="checkbox" form="bulk" name="ids" value={r.id} className="h-4 w-4 accent-[#02093a]" aria-label={`Select ${r.external_ref ?? r.id}`} /></td>
                <td className="table-cell font-medium"><Link className="link" href={`/admin/questions/${r.id}`}>{r.external_ref ?? r.id.slice(0, 8)}</Link></td>
                <td className="table-cell">{dMap.get(r.domain_id)}{r.task_id && <span className="block text-caption text-slate">{tMap.get(r.task_id)}</span>}</td>
                <td className="table-cell max-w-[440px]"><span className="line-clamp-2">{r.stem}</span></td>
                <td className="table-cell text-caption">{r.cognitive_level ?? "—"}</td>
                <td className="table-cell"><Pill tone={r.status === "published" ? "strong" : r.status === "archived" ? "neutral" : r.status === "in_review" ? "sky" : "marigold"}>{r.status.replace("_", " ")}</Pill></td>
                <td className="table-cell text-right tabular-nums">{r.version}</td>
              </tr>
            ))}
            {!rows?.length && <tr><td colSpan={7} className="table-cell text-center text-graphite">No questions match. Import the {course?.code} bank to get started.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-2 text-body-sm">
          {page > 1 && <Link className="btn-outline py-1.5" href={qs({ page: String(page - 1) })}>Previous</Link>}
          <span className="text-graphite">Page {page} of {pages}</span>
          {page < pages && <Link className="btn-outline py-1.5" href={qs({ page: String(page + 1) })}>Next</Link>}
        </nav>
      )}
    </div>
  );
}
