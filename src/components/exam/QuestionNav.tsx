"use client";
import { Flag } from "lucide-react";
import type { AttemptQuestion } from "@/lib/types";

export type NavFilter = "all" | "flagged" | "unanswered";
type S = { selected: string | null; flagged: boolean };

/** Numbered navigator. States use fill, a tick/flag glyph and labels — not colour alone. */
export function QuestionNav({ questions, state, current, onGo, filter, setFilter }: {
  questions: AttemptQuestion[]; state: Record<string, S>; current: number; onGo: (i: number) => void;
  filter: NavFilter; setFilter: (f: NavFilter) => void;
}) {
  const list = questions.map((q, i) => ({ q, i, s: state[q.question_id] }))
    .filter(({ s }) => filter === "all" || (filter === "flagged" ? s.flagged : !s.selected));
  const flaggedCount = questions.filter((q) => state[q.question_id].flagged).length;
  const unanswered = questions.filter((q) => !state[q.question_id].selected).length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">Questions</h2>
        <span className="text-caption text-slate">{questions.length - unanswered}/{questions.length} answered</span>
      </div>
      <div className="mt-3 flex gap-1 rounded-button bg-paper p-1" role="tablist" aria-label="Filter questions">
        {([["all", "All"], ["flagged", `Flagged (${flaggedCount})`], ["unanswered", `Unanswered (${unanswered})`]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`flex-1 rounded-small px-2 py-1 text-caption ${filter === k ? "bg-white text-ink shadow-nav" : "text-graphite hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="mt-4 text-caption text-graphite">{filter === "flagged" ? "No flagged questions." : "Every question has an answer."}</p>
      ) : (
        <ol className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-6">
          {list.map(({ q, i, s }) => {
            const answered = !!s.selected;
            const label = `Question ${i + 1}: ${answered ? "answered" : "unanswered"}${s.flagged ? ", flagged" : ""}${i === current ? ", current" : ""}`;
            return (
              <li key={q.question_id}>
                <button type="button" onClick={() => onGo(i)} aria-label={label} aria-current={i === current ? "step" : undefined}
                  className={`relative flex h-9 w-full items-center justify-center rounded-small text-caption tabular-nums transition-colors
                    ${answered ? "bg-midnight text-white" : "border border-ink-20 bg-white text-ink hover:bg-paper"}
                    ${i === current ? "ring-2 ring-action ring-offset-1" : ""}`}>
                  {i + 1}
                  {s.flagged && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-pill bg-marigold text-ink" aria-hidden>
                      <Flag size={9} fill="currentColor" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <ul className="mt-4 grid grid-cols-2 gap-2 text-caption text-graphite" aria-label="Legend">
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-small bg-midnight" /> Answered</li>
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-small border border-ink-20 bg-white" /> Unanswered</li>
        <li className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-pill bg-marigold"><Flag size={9} fill="currentColor" /></span> Flagged</li>
        <li className="flex items-center gap-2"><span className="h-4 w-4 rounded-small ring-2 ring-action" /> Current</li>
      </ul>
    </div>
  );
}
