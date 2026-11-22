import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/Alert";
import { QuestionForm, type QuestionFormData } from "./QuestionForm";

export const metadata = { title: "Edit question" };

export default async function QuestionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ course?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const isNew = id === "new";
  let form: QuestionFormData;
  let courseId: string;
  let versions: { version: number; created_at: string; change_note: string | null }[] = [];
  let usedIn = 0;
  let readOnly: { type: string; interaction: unknown; answer_key: unknown; case_id: string | null; exhibit_refs: string[] } | null = null;

  if (isNew) {
    const { data: c } = await supabase.from("courses").select("id, code").eq("code", (sp.course ?? "ASP").toUpperCase()).single();
    if (!c) notFound();
    courseId = c.id;
    form = { course_code: c.code, options: [], status: "draft" };
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data: q } = await supabase.from("questions").select("*, courses(code)").eq("id", id).single();
    if (!q) notFound();
    courseId = q.course_id;
    const [{ data: opts }, { data: key }, { data: dom }, { data: task }, { data: vers }, { count }] = await Promise.all([
      supabase.from("question_options").select("id, label, body").eq("question_id", id).order("sort_order"),
      supabase.from("question_keys").select("correct_option_id").eq("question_id", id).maybeSingle(),
      supabase.from("course_domains").select("code").eq("id", q.domain_id).single(),
      q.task_id ? supabase.from("course_tasks").select("code").eq("id", q.task_id).single() : Promise.resolve({ data: null }),
      supabase.from("question_versions").select("version, created_at, change_note").eq("question_id", id).order("version", { ascending: false }),
      supabase.from("attempt_questions").select("attempt_id", { count: "exact", head: true }).eq("question_id", id),
    ]);
    versions = vers ?? [];
    if (q.question_type !== "single_best_answer" && q.question_type !== "pulldown") {
      readOnly = { type: q.question_type, interaction: q.interaction, answer_key: q.answer_key, case_id: q.case_id, exhibit_refs: q.exhibit_refs ?? [] };
    }
    usedIn = count ?? 0;
    form = {
      id: q.id, course_code: (q.courses as { code: string }).code, external_ref: q.external_ref, domain_code: dom?.code,
      task_code: (task as { code: string } | null)?.code ?? null, topic: q.topic, cognitive_level: q.cognitive_level, stem: q.stem,
      options: (opts ?? []).map((o) => ({ label: o.label, body: o.body })),
      key: opts?.find((o) => o.id === key?.correct_option_id)?.label, explanation: q.explanation, reference: q.reference_text,
      difficulty: q.difficulty, allow_option_shuffle: q.allow_option_shuffle, status: q.status,
    };
  }
  const [{ data: domains }, { data: tasks }] = await Promise.all([
    supabase.from("course_domains").select("code, name").eq("course_id", courseId).order("number"),
    supabase.from("course_tasks").select("code, name").eq("course_id", courseId).order("code"),
  ]);

  return (
    <div className="space-y-5">
      <nav className="text-body-sm text-graphite"><Link className="link" href={`/admin/questions?course=${form.course_code}`}>Questions</Link> / {isNew ? "New" : form.external_ref ?? "Edit"}</nav>
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">{isNew ? `New ${form.course_code} question` : `${form.course_code} · ${form.external_ref ?? "Question"}`}</h1>
      {sp.saved && <Alert tone="success">Question created.</Alert>}
      {usedIn > 0 && <Alert tone="info">Used in {usedIn} exam attempt{usedIn === 1 ? "" : "s"}. Edits create a new version; past attempts keep the version they were given.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {readOnly ? (
          <section className="card space-y-4">
            <Alert tone="info">
              This is a {readOnly.type.replace(/_/g, " ")} item. Its interaction and key can’t be edited here; change the bank file and
              re-import it (npm run import:pmp). Re-importing creates a new version; past attempts keep theirs.
            </Alert>
            <p className="whitespace-pre-line text-body font-medium">{form.stem}</p>
            {form.options.length > 0 && <ul className="space-y-1 text-body-sm">{form.options.map((o) => <li key={o.label}><b>{o.label}.</b> {o.body}</li>)}</ul>}
            <details className="text-caption"><summary className="cursor-pointer">Interaction and answer key</summary>
              <pre className="mt-2 overflow-x-auto rounded-button bg-paper p-3">{JSON.stringify({ interaction: readOnly.interaction, answer_key: readOnly.answer_key, exhibits: readOnly.exhibit_refs }, null, 2)}</pre>
            </details>
            {form.explanation && <p className="text-body-sm text-graphite"><b>Explanation:</b> {form.explanation}</p>}
          </section>
        ) : (
          <section className="card"><QuestionForm q={form} domains={domains ?? []} tasks={tasks ?? []} /></section>
        )}
        {!isNew && (
          <aside className="card h-fit">
            <h2 className="text-body-sm font-semibold">Version history</h2>
            <ol className="mt-3 space-y-2 text-caption">
              {versions.map((v) => <li key={v.version}><span className="font-semibold">v{v.version}</span> · {fmtDateTime(v.created_at)}{v.change_note && <span className="block text-graphite">{v.change_note}</span>}</li>)}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
}
