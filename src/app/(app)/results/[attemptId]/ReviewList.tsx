"use client";
import { useState } from "react";
import { Flag } from "lucide-react";
import type { Interaction, ReviewItem } from "@/lib/types";
import { letter } from "@/lib/format";
import { RichText } from "@/components/ui/RichText";
import { CaseBriefPanel, ExhibitView, UNPLACED, hasResponse, ownExhibits } from "@/components/exam/ItemInteractions";

type F = "all" | "incorrect" | "flagged";
type Ix<T extends Interaction["type"]> = Extract<Interaction, { type: T }>;

const answeredItem = (it: ReviewItem) => !!it.selected_option_id || hasResponse(it.response);
const GOOD = "border-[#2f8f4e] bg-[#e3f4e8]";
const BAD = "border-coral bg-[#fde8e5]";

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
        {shown.map((it) => {
          const answered = answeredItem(it);
          const type = it.type ?? "single_best_answer";
          return (
            <li key={it.position} className="card">
              <div className="flex flex-wrap items-center gap-2 text-caption text-slate">
                <span>Question {it.position}</span><span>·</span><span>Domain {it.domain_code}{it.task_code ? ` · ${it.task_code}` : ""}</span>
                {it.external_ref && <><span>·</span><span>{it.external_ref}</span></>}
                <span className={`pill ml-auto ${it.is_correct ? "bg-[#dff3e4] text-[#14532d]" : answered ? "bg-coral text-ink" : "bg-paper text-graphite border border-hairline"}`}>
                  {it.is_correct ? "Correct" : answered ? "Incorrect" : "Unanswered"}
                </span>
                {it.flagged && <span className="pill bg-marigold text-ink"><Flag size={11} fill="currentColor" aria-hidden /> Flagged</span>}
              </div>
              {it.case && <div className="mt-3"><CaseBriefPanel brief={it.case} seq={it.case_seq} /></div>}
              <p className="mt-3 whitespace-pre-line text-body font-medium"><RichText text={type === "pulldown" ? it.stem.replace(/\[\[F1\]\]/g, "______") : it.stem} /></p>
              {it.instructions && <p className="mt-1 text-caption text-slate">{it.instructions}</p>}
              {type !== "enhanced_matching" && type !== "hotspot" && ownExhibits(it).map((e) => <ExhibitView key={e.ref} exhibit={e} />)}
              {(type === "single_best_answer" || type === "pulldown" || type === "multiple_response") && <OptionList it={it} />}
              {type === "matching" && <MatchingReview it={it} />}
              {type === "enhanced_matching" && <DragDropReview it={it} />}
              {type === "hotspot" && <HotspotReview it={it} />}
              {it.explanation && (
                <div className="mt-4 rounded-button bg-paper p-4 text-body-sm">
                  <p className="font-semibold">Explanation</p>
                  <p className="mt-1 whitespace-pre-line text-graphite"><RichText text={it.explanation} /></p>
                  {it.reference && <p className="mt-2 text-caption text-slate">Reference: {it.reference}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OptionList({ it }: { it: ReviewItem }) {
  const correctIds = new Set(it.type === "multiple_response" ? it.correct_option_ids ?? [] : [it.correct_option_id]);
  const picked = new Set(it.type === "multiple_response" ? it.response?.selected ?? [] : [it.selected_option_id]);
  return (
    <ul className="mt-4 space-y-2">
      {it.options.map((o, i) => {
        const correct = correctIds.has(o.id);
        const mine = picked.has(o.id);
        const note = it.response_feedback?.[letter(i)];
        return (
          <li key={o.id} className={`rounded-button border px-3 py-2 text-body-sm ${correct ? GOOD : mine ? BAD : "border-hairline"}`}>
            <div className="flex items-start gap-3">
              <span className="font-semibold">{letter(i)}</span>
              <span className="flex-1"><RichText text={o.body} /></span>
              {correct && <span className="text-caption font-semibold text-[#14532d]">{mine ? "Your answer · correct" : "Correct answer"}</span>}
              {mine && !correct && <span className="text-caption font-semibold">Your answer</span>}
            </div>
            {note && <p className="mt-1 pl-6 text-caption text-graphite">{note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function PairTable({ head, rows }: { head: [string, string, string]; rows: { item: string; mine: string; right: string; ok: boolean; note?: string }[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-body-sm">
        <thead><tr>{head.map((h) => <th key={h} className="border-b border-hairline px-2 py-1.5 text-caption font-semibold text-graphite">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="border-b border-hairline px-2 py-2"><RichText text={r.item} />{r.note && <p className="mt-1 text-caption text-graphite">{r.note}</p>}</td>
              <td className={`border-b border-hairline px-2 py-2 ${r.ok ? "text-[#14532d]" : "text-vermillion"}`}>{r.mine}{r.ok ? " ✓" : " ✗"}</td>
              <td className="border-b border-hairline px-2 py-2">{r.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchingReview({ it }: { it: ReviewItem }) {
  const ix = it.interaction as Ix<"matching">;
  const key = (it.answer_key ?? {}) as Record<string, string>;
  const text = (id?: string) => ix.right.find((r) => r.id === id)?.text ?? "—";
  return (
    <PairTable head={[ix.left_title ?? "Item", "Your answer", "Correct answer"]}
      rows={ix.left.map((l) => {
        const mine = it.response?.pairs?.[l.id];
        return { item: l.text, mine: text(mine), right: text(key[l.id]), ok: mine === key[l.id], note: it.response_feedback?.[l.id] };
      })} />
  );
}

function DragDropReview({ it }: { it: ReviewItem }) {
  const ix = it.interaction as Ix<"enhanced_matching">;
  const key = (it.answer_key ?? {}) as Record<string, string[]>;
  const name = (id?: string) => (!id || id === UNPLACED ? "Not placed" : ix.targets.find((t) => t.id === id)?.label ?? id);
  const exhibit = it.exhibits?.[0];
  return (
    <>
      {exhibit && (
        <ExhibitView exhibit={exhibit}>
          {ix.targets.map((t) => {
            const [x, y, w, h] = t.coords;
            const here = ix.draggables.filter((d) => (key[d.id] ?? [])[0] === t.id);
            return (
              <div key={t.id} aria-hidden className="absolute flex flex-wrap content-center items-center justify-center gap-1"
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
                {here.map((d) => <span key={d.id} className="rounded-pill bg-[#2f8f4e] px-2 py-0.5 text-[11px] font-semibold text-white">{d.label}</span>)}
              </div>
            );
          })}
        </ExhibitView>
      )}
      <PairTable head={["Item", "Your placement", "Correct placement"]}
        rows={ix.draggables.map((d) => {
          const mine = it.response?.placements?.[d.id] ?? UNPLACED;
          const ok = (key[d.id] ?? []).includes(mine);
          return { item: d.label, mine: name(mine), right: (key[d.id] ?? []).map(name).join(" or "), ok, note: it.response_feedback?.[d.id] };
        })} />
    </>
  );
}

function HotspotReview({ it }: { it: ReviewItem }) {
  const ix = it.interaction as Ix<"hotspot">;
  const key = new Set((it.answer_key ?? []) as string[]);
  const mine = new Set(it.response?.regions ?? []);
  const exhibit = it.exhibits?.[0];
  return (
    <>
      {exhibit && (
        <ExhibitView exhibit={exhibit}>
          {ix.regions.filter((r) => key.has(r.id) || mine.has(r.id)).map((r) => {
            const [x, y, w, h] = r.coords;
            return (
              <div key={r.id} aria-hidden className={`absolute rounded-small border-[3px] ${key.has(r.id) ? "border-[#2f8f4e] bg-[#2f8f4e]/10" : "border-coral bg-coral/10"}`}
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
            );
          })}
        </ExhibitView>
      )}
      <ul className="mt-3 space-y-1.5 text-body-sm">
        {ix.regions.filter((r) => key.has(r.id) || mine.has(r.id)).map((r) => (
          <li key={r.id} className={`rounded-button border px-3 py-2 ${key.has(r.id) ? GOOD : BAD}`}>
            <span className="font-semibold">{r.label}</span>
            <span className="ml-2 text-caption">{key.has(r.id) ? (mine.has(r.id) ? "Your answer · correct area" : "Correct area") : "Your answer"}</span>
            {it.response_feedback?.[r.id] && <p className="mt-1 text-caption text-graphite">{it.response_feedback[r.id]}</p>}
          </li>
        ))}
        {mine.size === 0 && <li className="text-caption text-slate">You did not select an area.</li>}
      </ul>
    </>
  );
}
