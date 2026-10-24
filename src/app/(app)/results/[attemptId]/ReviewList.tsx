"use client";
import { useState } from "react";
import { Flag } from "lucide-react";
import type { ReviewItem } from "@/lib/types";
import { letter } from "@/lib/format";

type F = "all" | "incorrect" | "flagged";

export function ReviewList({ items }: { items: ReviewItem[] }) {
  const [filter, setFilter] = useState<F>("incorrect");
  const shown = items.filter((i) => filter === "all" || (filter === "incorrect" ? !i.is_correct : i.flagged));
  const counts = { all: items.length, incorrect: items.filter((i) => !i.is_correct).length, flagged: items.filter((i) => i.flagged).length };
  return (
    <section aria-labelledby="review-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-h" className="text-heading-sm">Review answers</h2>
        <div className="flex gap-1 rounded-button border border-hairline bg-white p-1 no-print" role="tablist">
          {(["incorrect", "flagged", "all"] as F[]).map((k) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} type="button"
              className={`rounded-small px-3 py-1.5 text-body-sm ${filter === k ? "bg-midnight text-white" : "text-ink-54 hover:text-ink"}`}>
              {k === "incorrect" ? "Incorrect & unanswered" : k === "flagged" ? "Flagged" : "All"} ({counts[k]})
            </button>
          ))}
          <button type="button" onClick={() => window.print()} className="rounded-small px-3 py-1.5 text-body-sm text-ink-54 hover:text-ink">Print</button>
        </div>
      </div>
      {shown.length === 0 && <p className="text-body-sm text-graphite">Nothing to show for this filter.</p>}
      <ol className="space-y-4">
        {shown.map((it) => (
          <li key={it.position} className="card">
            <div className="flex flex-wrap items-center gap-2 text-caption text-slate">
              <span>Question {it.position}</span><span>·</span><span>Domain {it.domain_code}{it.task_code ? ` · ${it.task_code}` : ""}</span>
              {it.external_ref && <><span>·</span><span>{it.external_ref}</span></>}
              <span className={`pill ml-auto ${it.is_correct ? "bg-[#dff3e4] text-[#14532d]" : it.selected_option_id ? "bg-coral text-ink" : "bg-paper text-graphite border border-hairline"}`}>
                {it.is_correct ? "Correct" : it.selected_option_id ? "Incorrect" : "Unanswered"}
              </span>
              {it.flagged && <span className="pill bg-marigold text-ink"><Flag size={11} fill="currentColor" aria-hidden /> Flagged</span>}
            </div>
            <p className="mt-3 whitespace-pre-line text-body font-medium">{it.stem}</p>
            <ul className="mt-4 space-y-2">
              {it.options.map((o, i) => {
                const correct = o.id === it.correct_option_id;
                const picked = o.id === it.selected_option_id;
                return (
                  <li key={o.id} className={`flex items-start gap-3 rounded-button border px-3 py-2 text-body-sm
                    ${correct ? "border-[#2f8f4e] bg-[#e3f4e8]" : picked ? "border-coral bg-[#fde8e5]" : "border-hairline"}`}>
                    <span className="font-semibold">{letter(i)}</span>
                    <span className="flex-1">{o.body}</span>
                    {correct && <span className="text-caption font-semibold text-[#14532d]">Correct answer</span>}
                    {picked && !correct && <span className="text-caption font-semibold">Your answer</span>}
                  </li>
                );
              })}
            </ul>
            {it.explanation && (
              <div className="mt-4 rounded-button bg-paper p-4 text-body-sm">
                <p className="font-semibold">Explanation</p>
                <p className="mt-1 text-graphite">{it.explanation}</p>
                {it.reference && <p className="mt-2 text-caption text-slate">Reference: {it.reference}</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
