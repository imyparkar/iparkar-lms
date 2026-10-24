import { requireAdmin } from "@/lib/auth/session";
import { Importer } from "./Importer";

export const metadata = { title: "Import questions" };

export default async function ImportPage() {
  const { supabase } = await requireAdmin();
  const { data: courses } = await supabase.from("courses").select("id, code, name, course_domains(code)").order("sort_order");
  const list = (courses ?? []).map((c: { code: string; name: string; course_domains: { code: string }[] }) => ({
    code: c.code, name: c.name, domains: c.course_domains.map((d) => d.code),
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Import questions</h1>
      <p className="lead">Upload the item-bank Markdown (ID · Domain-Task · Level · Stem · A–D · Key · Rationale · Reference · Est. Diff.) or a CSV. Re-importing an ID updates it and creates a new version.</p>
      <details className="card p-4 text-body-sm">
        <summary className="cursor-pointer font-medium">CSV columns</summary>
        <p className="mt-2 font-mono text-caption">external_ref, domain_code, task_code, cognitive_level, topic, stem, option_a … option_f, key, explanation, reference, difficulty</p>
        <p className="mt-2 text-graphite">Required: external_ref, domain_code, stem, option_a, option_b, key, explanation. Domain codes: ASP D1–D9, CSP D1–D7, CIH I, II, III. CIH task codes: I-T1 … III-T2.</p>
      </details>
      <Importer courses={list} />
    </div>
  );
}
