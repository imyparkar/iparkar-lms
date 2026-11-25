"use client";
import { useActionState, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitMakeup, startLiveExam, type FormState } from "@/lib/live/actions";

/** Make-up task for one missed session. */
export function MakeupForm({ course, session, task }: { course: string; session: string; task: string }) {
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(submitMakeup, {});
  if (state.ok) return <p role="status" className="text-body-sm font-medium text-ink">Make-up submitted. Your instructor will review it.</p>;
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="course" value={course} />
      <p className="text-body-sm text-charcoal">{task}</p>
      <label className="flex items-start gap-2 text-body-sm">
        <input type="checkbox" name="watched" className="mt-1" required /> I watched the full captioned recording of this session.
      </label>
      <div>
        <label htmlFor={`${id}-r`} className="field-label">Your make-up response</label>
        <textarea id={`${id}-r`} name="response" rows={5} maxLength={8000} required className="field-input"
                  aria-invalid={!!state.error} aria-describedby={state.error ? `${id}-e` : undefined} />
      </div>
      {state.error && <p id={`${id}-e`} role="alert" className="text-body-sm text-[#b3261e]">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Submitting…" : "Submit make-up task"}</button>
    </form>
  );
}

const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg";
const MAX_BYTES = 10 * 1024 * 1024;

/** Practical submission: typed answer and/or one file (PDF, Word, Excel or image, up to 10 MB). */
export function PracticalSubmit({ course, code, attemptNo }: { course: string; code: string; attemptNo: number }) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    if (file && file.size > MAX_BYTES) return setError("The file is larger than 10 MB. Save it as a PDF or compress it, then try again.");
    if (!String(fd.get("response") ?? "").trim() && !(file && file.size)) return setError("Add your answer or attach a file.");
    if (file && !file.size) fd.delete("file");
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const res = await fetch("/api/live/submissions", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({ ok: false, message: "We couldn't reach the server. Try again." }));
      if (!body.ok) return setError(body.message ?? "Your submission couldn't be saved. Try again.");
      setDone(true);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again. Nothing was submitted.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  if (done) return <p role="status" className="text-body-sm font-medium text-ink">Submitted. Feedback and your mark will appear here within 7 days.</p>;
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
      <input type="hidden" name="course" value={course} />
      <input type="hidden" name="practical" value={code} />
      <div>
        <label htmlFor={`${id}-route`} className="field-label">How you completed it</label>
        <select id={`${id}-route`} name="route" className="field-input" defaultValue={attemptNo > 1 ? "individual" : "session"}>
          <option value="session">In the live session</option>
          <option value="clinic">In the make-up clinic</option>
          <option value="individual">Individually</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-r`} className="field-label">Your answer (optional if you attach a file)</label>
        <textarea id={`${id}-r`} name="response" rows={6} maxLength={20000} className="field-input" />
      </div>
      <div>
        <label htmlFor={`${id}-f`} className="field-label">Attach your completed sheet (PDF, Word, Excel or image, up to 10 MB)</label>
        <input id={`${id}-f`} name="file" type="file" accept={ACCEPT} className="block text-body-sm" />
      </div>
      {error && <p role="alert" className="text-body-sm text-[#b3261e]">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Submitting…" : attemptNo > 1 ? "Submit resubmission" : "Submit practical"}</button>
    </form>
  );
}

/** Final-exam start: the learner confirms the rules first. */
export function StartExamForm({ course, label }: { course: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startLiveExam, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="course" value={course} />
      <label className="flex items-start gap-2 text-body-sm">
        <input type="checkbox" name="confirm" className="mt-1" required /> I have read the examination rules and permitted aids above.
      </label>
      {state.error && <p role="alert" className="text-body-sm text-[#b3261e]">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Opening…" : label}</button>
    </form>
  );
}
