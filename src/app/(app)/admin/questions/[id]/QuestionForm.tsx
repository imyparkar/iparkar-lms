"use client";
import { useActionState } from "react";
import { saveQuestion, type ActionResult } from "@/lib/admin/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";

export type QuestionFormData = {
  id?: string; course_code: string; external_ref?: string | null; domain_code?: string; task_code?: string | null;
  topic?: string | null; cognitive_level?: string | null; stem?: string; options: { label: string; body: string }[];
  key?: string; explanation?: string | null; reference?: string | null; difficulty?: number | null;
  allow_option_shuffle?: boolean; status?: string;
};

export function QuestionForm({ q, domains, tasks }: { q: QuestionFormData; domains: { code: string; name: string }[]; tasks: { code: string; name: string }[] }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveQuestion, { ok: true });
  const opt = (l: string) => q.options.find((o) => o.label === l)?.body ?? "";
  return (
    <form action={action} className="space-y-5">
      {state.error && <Alert tone="error" title="Not saved">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}
      {q.id && <input type="hidden" name="id" value={q.id} />}
      <input type="hidden" name="course_code" value={q.course_code} />
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label className="field-label" htmlFor="external_ref">ID</label><input id="external_ref" name="external_ref" className="field-input" defaultValue={q.external_ref ?? ""} placeholder="e.g. D1-0101" /></div>
        <div><label className="field-label" htmlFor="domain_code">Domain</label>
          <select id="domain_code" name="domain_code" className="field-input" defaultValue={q.domain_code} required>
            {domains.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.name}</option>)}
          </select></div>
        <div><label className="field-label" htmlFor="task_code">Task (optional)</label>
          <input id="task_code" name="task_code" list="tasks" className="field-input" defaultValue={q.task_code ?? ""} />
          <datalist id="tasks">{tasks.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</datalist></div>
        <div><label className="field-label" htmlFor="cognitive_level">Level</label>
          <select id="cognitive_level" name="cognitive_level" className="field-input" defaultValue={q.cognitive_level ?? ""}>
            <option value="">—</option><option>Recall</option><option>Application</option><option>Analysis</option>
          </select></div>
      </div>
      <div><label className="field-label" htmlFor="stem">Question stem</label>
        <textarea id="stem" name="stem" rows={4} className="field-input" defaultValue={q.stem} required minLength={10} /></div>
      <fieldset className="space-y-2">
        <legend className="field-label">Options and key</legend>
        {["A", "B", "C", "D", "E", "F"].map((l) => (
          <div key={l} className="flex items-center gap-3">
            <label className="flex w-16 items-center gap-1.5 text-body-sm"><input type="radio" name="key" value={l} defaultChecked={q.key === l} className="accent-[#02093a]" required /> {l}</label>
            <input name={`option_${l}`} aria-label={`Option ${l}`} className="field-input" defaultValue={opt(l)} placeholder={l > "D" ? "Optional" : ""} />
          </div>
        ))}
        <p className="text-caption text-slate">Select the radio button of the correct option. Leave E/F empty for four-option items.</p>
      </fieldset>
      <div><label className="field-label" htmlFor="explanation">Explanation / rationale</label>
        <textarea id="explanation" name="explanation" rows={4} className="field-input" defaultValue={q.explanation ?? ""} /></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2"><label className="field-label" htmlFor="reference">Reference</label><input id="reference" name="reference" className="field-input" defaultValue={q.reference ?? ""} /></div>
        <div><label className="field-label" htmlFor="topic">Topic</label><input id="topic" name="topic" className="field-input" defaultValue={q.topic ?? ""} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label className="field-label" htmlFor="difficulty">Est. difficulty (0–100)</label><input id="difficulty" name="difficulty" type="number" min={0} max={100} className="field-input" defaultValue={q.difficulty ?? ""} /></div>
        <div><label className="field-label" htmlFor="status">Status</label>
          <select id="status" name="status" className="field-input" defaultValue={q.status ?? "draft"}>
            <option value="draft">Draft</option><option value="in_review">In review</option><option value="published">Published</option><option value="archived">Archived</option>
          </select></div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="change_note">Change note</label><input id="change_note" name="change_note" className="field-input" placeholder="Why this edit?" /></div>
      </div>
      <div className="flex flex-wrap gap-6 text-body-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="allow_option_shuffle" defaultChecked={q.allow_option_shuffle} className="h-4 w-4 accent-[#02093a]" /> Options may be shuffled (only if the rationale doesn’t refer to letters)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="auto_create_task" className="h-4 w-4 accent-[#02093a]" /> Create the task code if it’s new</label>
      </div>
      <SubmitButton className="btn-primary" pendingText="Saving…">Save question</SubmitButton>
    </form>
  );
}
