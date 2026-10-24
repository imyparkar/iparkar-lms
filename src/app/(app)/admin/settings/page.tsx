import { requireAdmin } from "@/lib/auth/session";
import { updateExamConfig, updateIndicators } from "@/lib/admin/actions";
import { Flash } from "@/components/ui/Flash";
import { DEFAULT_INDICATORS } from "@/lib/analytics/recommendations";

export const metadata = { title: "Exam settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: exams }, { data: courses }, { data: ind }] = await Promise.all([
    supabase.from("exams").select("*").order("mode"),
    supabase.from("courses").select("id, code").order("sort_order"),
    supabase.from("app_settings").select("value").eq("key", "study_indicators").maybeSingle(),
  ]);
  const indicators = { ...DEFAULT_INDICATORS, ...(ind?.value ?? {}) };
  return (
    <div className="space-y-6">
      <Flash sp={sp} />
      <h1 className="text-[32px] font-semibold tracking-[-0.6px]">Exam settings</h1>
      {(courses ?? []).map((c) => (
        <section key={c.id} className="card space-y-4">
          <h2 className="text-heading-sm">{c.code}</h2>
          {(exams ?? []).filter((e) => e.course_id === c.id).map((e) => (
            <form key={e.id} action={updateExamConfig} className="grid items-end gap-3 rounded-button border border-hairline p-4 sm:grid-cols-7">
              <input type="hidden" name="exam_id" value={e.id} />
              <p className="font-medium sm:col-span-7">{e.title} <span className="text-caption text-slate">({e.mode})</span></p>
              <div><label className="field-label">Questions</label><input name="question_count" type="number" min={1} max={300} defaultValue={e.question_count} className="field-input py-1.5" /></div>
              <div><label className="field-label">Minutes</label><input name="duration_minutes" type="number" min={1} max={600} defaultValue={e.duration_minutes} className="field-input py-1.5" /></div>
              <div className="sm:col-span-2"><label className="field-label">Feedback</label>
                <select name="feedback_policy" defaultValue={e.feedback_policy} className="field-input py-1.5">
                  <option value="after_submit">Full review after submit</option><option value="immediate">Immediate (per question, locks answer)</option>
                  <option value="delayed">Delayed review</option><option value="restricted">Restricted (score only)</option>
                </select></div>
              <div><label className="field-label">Delay (h)</label><input name="review_delay_hours" type="number" min={0} max={720} defaultValue={e.review_delay_hours} className="field-input py-1.5" /></div>
              <div className="space-y-1 text-caption">
                <label className="flex items-center gap-2"><input type="checkbox" name="shuffle_options" defaultChecked={e.shuffle_options} className="accent-[#02093a]" /> Shuffle options*</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={e.is_active} className="accent-[#02093a]" /> Active</label>
              </div>
              <button className="btn-outline" type="submit">Save</button>
            </form>
          ))}
        </section>
      ))}
      <p className="text-caption text-graphite">*Options are only shuffled for questions marked “options may be shuffled”, because many rationales refer to option letters.</p>

      <section className="card">
        <h2 className="text-heading-sm">Study indicators</h2>
        <p className="mt-1 text-body-sm text-graphite">Internal study guides shown on dashboards — not official passing standards.</p>
        <form action={updateIndicators} className="mt-4 flex flex-wrap items-end gap-3">
          <div><label className="field-label">Strong at or above (%)</label><input name="strong" type="number" min={1} max={100} defaultValue={indicators.strong} className="field-input w-32" /></div>
          <div><label className="field-label">Developing at or above (%)</label><input name="developing" type="number" min={1} max={99} defaultValue={indicators.developing} className="field-input w-32" /></div>
          <div><label className="field-label">Flag samples below (questions)</label><input name="min_questions" type="number" min={1} defaultValue={indicators.min_questions} className="field-input w-32" /></div>
          <button className="btn-outline" type="submit">Save</button>
        </form>
      </section>
    </div>
  );
}
