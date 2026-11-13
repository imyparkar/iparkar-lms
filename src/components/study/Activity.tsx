"use client";
import { useId, useState } from "react";
import type { ActivityFeedback, StudyActivity } from "@/lib/study/types";
import { StudyText } from "./StudyText";

type Result = { attempt_id: string; is_correct: boolean; feedback: ActivityFeedback; correct: Record<string, unknown>; attempts: number; response: Record<string, unknown> };

const KIND_LABEL = { single_choice: "Choose one", multi_choice: "Choose all that apply", numeric: "Calculate", ordering: "Put in order" } as const;

function correctText(a: StudyActivity, correct: Record<string, unknown>) {
  if (a.kind === "numeric") return `${correct.value} ${a.spec.unit ?? ""}`.trim();
  const label = (id: string) => (a.spec.options ?? a.spec.items ?? []).find((o) => o.id === id)?.text ?? id;
  if (a.kind === "single_choice") return label(String(correct.correct));
  if (a.kind === "multi_choice") return (correct.correct as string[]).map(label).join("; ");
  return (correct.order as string[]).map((id, i) => `${i + 1}. ${label(id)}`).join("  ");
}

/**
 * One formative activity. The answer is captured and submitted before any feedback
 * is shown (progressive disclosure). Feedback is acknowledged with an explicit
 * button, which is what the server counts for chapter completion. Wrong answers
 * get an explanation, a link back to the lesson and a retry; there is no score gate.
 */
export function ActivityCard({ activity, sectionOpen, onSubmit, onFeedbackRead, onReview }: {
  activity: StudyActivity;
  sectionOpen: boolean;
  onSubmit: (a: StudyActivity, response: Record<string, unknown>) => Promise<Result>;
  onFeedbackRead: (attemptId: string) => Promise<void>;
  onReview: (sectionCode: string) => void;
}) {
  const a = activity;
  const uid = useId();
  const initial: Result | null = a.last ? { attempt_id: a.last.id, is_correct: a.last.is_correct, feedback: a.last.feedback, correct: a.last.correct, attempts: a.last.attempts, response: a.last.response } : null;
  const [result, setResult] = useState<Result | null>(initial);
  const [viewed, setViewed] = useState(a.last?.feedback_viewed ?? false);
  const [retrying, setRetrying] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const [choices, setChoices] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const [order, setOrder] = useState<string[]>(() => (a.spec.items ?? []).map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showForm = !result || retrying;
  const response = (): Record<string, unknown> | null => {
    if (a.kind === "single_choice") return choice ? { choice } : null;
    if (a.kind === "multi_choice") return choices.length ? { choices } : null;
    if (a.kind === "numeric") {
      const n = Number(value.replace(/,/g, "").trim());
      return value.trim() && Number.isFinite(n) ? { value: n } : null;
    }
    return { order };
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = response();
    if (!r) { setError(a.kind === "numeric" ? "Enter a number (digits, optional decimal point)." : "Choose an answer first."); return; }
    setBusy(true); setError(null);
    try {
      const res = await onSubmit(a, r);
      setResult({ ...res, response: r });
      setRetrying(false);
      setViewed(false);
    } catch {
      setError("Your answer wasn't saved. Check your connection and submit again.");
    } finally { setBusy(false); }
  }

  async function markRead() {
    if (!result) return;
    setBusy(true);
    try { await onFeedbackRead(result.attempt_id); setViewed(true); } catch { setError("Couldn't record that. Try again."); } finally { setBusy(false); }
  }

  function move(i: number, d: -1 | 1) {
    setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }

  const label = (id: string) => (a.spec.items ?? []).find((x) => x.id === id)?.text ?? id;
  const chosen = result?.response;

  return (
    <section className="rounded-card border border-hairline bg-white" aria-labelledby={`${uid}-q`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3">
        <p className="text-caption text-slate">{KIND_LABEL[a.kind]} · Original practice {a.is_required ? "· Required activity" : "· Optional"}</p>
        {result && <span className={`pill ${viewed ? "bg-midnight text-white" : "bg-marigold text-ink"}`}>{viewed ? "Feedback read" : "Read the feedback"}</span>}
      </div>
      <div className="space-y-4 px-5 py-4">
        <p id={`${uid}-q`} className="text-body font-medium text-ink"><StudyText md={a.spec.prompt} /></p>

        {showForm && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {(a.kind === "single_choice" || a.kind === "multi_choice") && (
              <fieldset>
                <legend className="sr-only">Answer options</legend>
                <div className="space-y-2">
                  {(a.spec.options ?? []).map((o) => {
                    const multi = a.kind === "multi_choice";
                    const checked = multi ? choices.includes(o.id) : choice === o.id;
                    return (
                      <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-button border px-3 py-2.5 transition-colors duration-200 ${checked ? "border-midnight bg-sky-tint" : "border-ink-20 hover:bg-paper"}`}>
                        <input type={multi ? "checkbox" : "radio"} name={`${uid}-opt`} value={o.id} checked={checked}
                          className="mt-1 h-4 w-4 accent-[#02093a]"
                          onChange={() => multi ? setChoices((c) => c.includes(o.id) ? c.filter((x) => x !== o.id) : [...c, o.id]) : setChoice(o.id)} />
                        <span className="text-body text-charcoal"><StudyText md={o.text} /></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {a.kind === "numeric" && (
              <div>
                <label htmlFor={`${uid}-n`} className="field-label">Your answer ({a.spec.unit})</label>
                <div className="flex max-w-xs items-center gap-2">
                  <input id={`${uid}-n`} inputMode="decimal" autoComplete="off" className="field-input" value={value}
                    onChange={(e) => setValue(e.target.value)} aria-describedby={`${uid}-tol`} />
                  <span className="text-body text-ink">{a.spec.unit}</span>
                </div>
                <p id={`${uid}-tol`} className="mt-1 text-body-sm text-graphite">{a.spec.tolerance_note} Enter the number only.{a.spec.hint ? ` Hint: ${a.spec.hint}` : ""}</p>
              </div>
            )}
            {a.kind === "ordering" && (
              <ol className="space-y-2" aria-label="Current order">
                {order.map((id, i) => (
                  <li key={id} className="flex items-center justify-between gap-2 rounded-button border border-ink-20 bg-white px-3 py-2">
                    <span className="text-body text-ink"><span className="mr-2 font-semibold">{i + 1}.</span>{label(id)}</span>
                    <span className="flex gap-1">
                      <button type="button" className="btn-text px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label(id)} up`}>Move up</button>
                      <button type="button" className="btn-text px-2 py-1" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${label(id)} down`}>Move down</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn-outline" disabled={busy || !sectionOpen}>{busy ? "Checking…" : "Check answer"}</button>
              {retrying && <button type="button" className="btn-text" onClick={() => setRetrying(false)}>Cancel</button>}
            </div>
          </form>
        )}

        {result && !retrying && (
          <div role="status" aria-live="polite" className={`rounded-button p-4 ${result.is_correct ? "bg-sky-tint" : "bg-paper"}`}>
            <p className="text-body font-semibold text-ink">{result.is_correct ? "Correct." : "Not quite."} <span className="font-normal text-graphite">Attempt {result.attempts}.</span></p>
            {chosen && a.kind === "numeric" && <p className="mt-1 text-body-sm text-graphite">You answered {String(chosen.value)} {a.spec.unit}.</p>}
            {!result.is_correct && <p className="mt-1 text-body-sm text-ink">Expected answer: <strong>{correctText(a, result.correct)}</strong></p>}
            <p className="mt-2 text-body text-charcoal"><StudyText md={result.feedback.explanation} /></p>
            {!result.is_correct && chosen && "choice" in chosen && result.feedback.options?.[String(chosen.choice)] && (
              <p className="mt-2 text-body text-charcoal"><span className="font-semibold text-ink">About your choice: </span><StudyText md={result.feedback.options[String(chosen.choice)]} /></p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!viewed && <button type="button" className="btn-outline" onClick={markRead} disabled={busy}>I&apos;ve read the feedback</button>}
              <button type="button" className="btn-text" onClick={() => { setRetrying(true); setError(null); }}>Try again</button>
              {!result.is_correct && result.feedback.review_section && (
                <button type="button" className="btn-text" onClick={() => onReview(result.feedback.review_section!)}>Review the lesson</button>
              )}
            </div>
          </div>
        )}
        {!sectionOpen && <p className="text-body-sm text-graphite">Open this section to answer.</p>}
        {error && <p role="alert" className="text-body-sm text-ink"><span className="font-semibold">Not saved. </span>{error}</p>}
      </div>
    </section>
  );
}
