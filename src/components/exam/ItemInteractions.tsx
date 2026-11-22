"use client";
/**
 * Renderers for interactive item types (PMP-style): multiple response,
 * pull-down, matching, drag-and-drop onto an exhibit, and hotspot, plus case
 * briefs and exhibits. Every pointer interaction has a keyboard-operable
 * equivalent on the same question (checkboxes, selects, focusable regions),
 * and nothing here ever shows correctness during an exam.
 */
import { useId, useState } from "react";
import { BookOpen, ChevronDown, Table2 } from "lucide-react";
import type { AttemptQuestion, CaseBrief, Exhibit, Interaction, ItemResponse } from "@/lib/types";
import { letter } from "@/lib/format";
import { RichText } from "@/components/ui/RichText";

type Ix<T extends Interaction["type"]> = Extract<Interaction, { type: T }>;

export const UNPLACED = "UNPLACED";

/** Has the student given any answer? */
export function hasResponse(r: ItemResponse | null | undefined): boolean {
  if (!r) return false;
  return !!(r.selected?.length || r.regions?.length
    || (r.pairs && Object.values(r.pairs).some(Boolean))
    || (r.placements && Object.values(r.placements).some(Boolean)));
}

/** Drop empty parts so an untouched item is saved as "no answer". */
export function normalise(r: ItemResponse): ItemResponse | null {
  const out: ItemResponse = {};
  if (r.selected?.length) out.selected = r.selected;
  if (r.regions?.length) out.regions = r.regions;
  const clean = (o?: Record<string, string>) => {
    const e = Object.entries(o ?? {}).filter(([, v]) => !!v);
    return e.length ? Object.fromEntries(e) : undefined;
  };
  const pairs = clean(r.pairs), placements = clean(r.placements);
  if (pairs) out.pairs = pairs;
  if (placements) out.placements = placements;
  return hasResponse(out) ? out : null;
}

export const isInteractive = (q: Pick<AttemptQuestion, "type">) =>
  !!q.type && !["single_best_answer", "pulldown"].includes(q.type);

/** Short instruction shown under the stem when the item does not carry its own. */
export function defaultInstructions(q: AttemptQuestion): string | null {
  switch (q.type) {
    case "multiple_response": {
      const n = (q.interaction as Ix<"multiple_response"> | undefined)?.select_count;
      return n ? `Select ${n} answers.` : "Select all that apply.";
    }
    case "pulldown": return "Choose the option that completes the statement.";
    case "matching": return "Match each item on the left with an option on the right.";
    case "enhanced_matching": return "Drag each item to its place on the exhibit, or use the lists below it.";
    case "hotspot": return "Click the correct area of the exhibit.";
    default: return null;
  }
}

/** Exhibits of the item itself, leaving out any already shown with its case brief. */
export function ownExhibits(q: { exhibits?: Exhibit[] | null; case?: CaseBrief | null }): Exhibit[] {
  const inCase = new Set((q.case?.exhibits ?? []).map((e) => e.ref));
  return (q.exhibits ?? []).filter((e) => !inCase.has(e.ref));
}

const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** An exhibit shown as an image (scripts in SVG never run inside <img>), with an optional overlay and a text version. */
export function ExhibitView({ exhibit, children, label }: { exhibit: Exhibit; children?: React.ReactNode; label?: string }) {
  const ratio = exhibit.width && exhibit.height ? `${exhibit.width} / ${exhibit.height}` : undefined;
  return (
    <figure className="mt-5">
      {exhibit.title && <figcaption className="mb-2 text-caption font-semibold text-graphite">{label ? `${label}: ` : ""}{exhibit.title}</figcaption>}
      <div className="relative w-full max-w-[760px] select-none rounded-button border border-hairline bg-white" style={{ aspectRatio: ratio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgSrc(exhibit.svg)} alt={exhibit.alt} className="block h-full w-full" draggable={false} />
        {children}
      </div>
      {exhibit.data_table?.headers && (
        <details className="mt-2 max-w-[760px] text-caption">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-graphite hover:text-ink">
            <Table2 size={13} aria-hidden /> Text version of the exhibit
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead><tr>{exhibit.data_table.headers.map((h, i) => <th key={i} className="border border-hairline bg-paper px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {(exhibit.data_table.rows ?? []).map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="border border-hairline px-2 py-1">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}

/** Shared case brief for case-study questions; open by default, collapsible. */
export function CaseBriefPanel({ brief, seq }: { brief: CaseBrief; seq?: number }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="mb-5 rounded-button border border-sky-wash/50 bg-sky-tint/60 p-4" aria-labelledby={`${id}-h`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-b`}
        className="flex w-full items-center gap-2 text-left">
        <BookOpen size={16} aria-hidden />
        <span id={`${id}-h`} className="flex-1 text-body-sm font-semibold">
          Case study: {brief.title}{seq ? <span className="font-normal text-graphite"> · question {seq} of this case</span> : null}
        </span>
        <ChevronDown size={16} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={`${id}-b`} hidden={!open}>
        <p className="mt-3 whitespace-pre-line text-body-sm leading-relaxed text-ink"><RichText text={brief.brief} /></p>
        {(brief.exhibits ?? []).map((e, i) => <ExhibitView key={e.ref} exhibit={e} label={`Case exhibit ${i + 1}`} />)}
      </div>
    </section>
  );
}

/* ---------------- multiple response ---------------- */
export function MultipleResponse({ q, value, onChange, disabled }: {
  q: AttemptQuestion; value: ItemResponse | null; onChange: (r: ItemResponse) => void; disabled: boolean;
}) {
  const chosen = new Set(value?.selected ?? []);
  const need = (q.interaction as Ix<"multiple_response"> | undefined)?.select_count;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ selected: q.options.map((o) => o.id).filter((x) => next.has(x)) });
  };
  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="sr-only">Answer options{need ? `, select ${need}` : ""}</legend>
      <ul className="space-y-2.5">
        {q.options.map((o, i) => {
          const on = chosen.has(o.id);
          return (
            <li key={o.id}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-button border px-4 py-3 transition-colors duration-200
                ${on ? "border-midnight bg-sky-tint" : "border-ink-20 bg-white hover:bg-paper"}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(o.id)} />
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-small border text-body-sm font-semibold
                  ${on ? "border-midnight bg-midnight text-white" : "border-ink-20 bg-white text-ink"}`} aria-hidden>{letter(i)}</span>
                <span className="pt-0.5 text-body text-ink"><RichText text={o.body} /></span>
              </label>
            </li>
          );
        })}
      </ul>
      {need ? (
        <p className="mt-3 text-caption text-slate" aria-live="polite">
          {chosen.size} of {need} selected{chosen.size > need ? " — you have selected more than the question asks for" : ""}
        </p>
      ) : null}
    </fieldset>
  );
}

/* ---------------- pull-down ---------------- */
export function Pulldown({ q, selected, onChoose, disabled }: {
  q: AttemptQuestion; selected: string | null; onChoose: (optionId: string | null) => void; disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="mt-6">
      <label htmlFor={id} className="block text-body-sm font-semibold">Your answer for the blank</label>
      <select id={id} className="field-input mt-2 max-w-xl" value={selected ?? ""} disabled={disabled}
        onChange={(e) => onChoose(e.target.value || null)}>
        <option value="">Select an option…</option>
        {q.options.map((o) => <option key={o.id} value={o.id}>{o.body}</option>)}
      </select>
    </div>
  );
}

/** Stem with the pull-down blank shown as a gap (or as the chosen text). */
export function pulldownStem(stem: string, chosen: string | null) {
  return stem.replace(/\[\[F1\]\]/g, chosen ? `[ ${chosen} ]` : "______");
}

/* ---------------- matching ---------------- */
export function Matching({ q, value, onChange, disabled }: {
  q: AttemptQuestion; value: ItemResponse | null; onChange: (r: ItemResponse) => void; disabled: boolean;
}) {
  const ix = q.interaction as Ix<"matching">;
  const pairs = value?.pairs ?? {};
  const used = new Set(Object.values(pairs));
  const set = (left: string, right: string) => onChange({ pairs: { ...pairs, [left]: right } });
  return (
    <div className="mt-6 space-y-3">
      <p className="text-caption text-slate">
        {ix.options_reusable ? "Options can be used more than once." : "Each option can be used once."}
        {ix.right.length > ix.left.length ? " Some options are not used." : ""}
      </p>
      <ul className="space-y-2.5">
        {ix.left.map((l, i) => {
          const sid = `m-${q.question_id}-${l.id}`;
          return (
            <li key={l.id} className="grid gap-2 rounded-button border border-ink-20 bg-white px-4 py-3 sm:grid-cols-[1fr_minmax(220px,0.9fr)] sm:items-center">
              <label htmlFor={sid} className="text-body text-ink"><span className="mr-2 font-semibold">{i + 1}.</span><RichText text={l.text} /></label>
              <select id={sid} className="field-input" value={pairs[l.id] ?? ""} disabled={disabled} onChange={(e) => set(l.id, e.target.value)}>
                <option value="">{ix.right_title ? `Choose ${ix.right_title.toLowerCase()}…` : "Choose…"}</option>
                {ix.right.map((r) => (
                  <option key={r.id} value={r.id} disabled={!ix.options_reusable && used.has(r.id) && pairs[l.id] !== r.id}>{r.text}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- drag-and-drop onto an exhibit ---------------- */
export function DragDrop({ q, value, onChange, disabled }: {
  q: AttemptQuestion; value: ItemResponse | null; onChange: (r: ItemResponse) => void; disabled: boolean;
}) {
  const ix = q.interaction as Ix<"enhanced_matching">;
  const exhibit = q.exhibits?.[0];
  const placements = value?.placements ?? {};
  const [picked, setPicked] = useState<string | null>(null);
  const occupied = (t: string) => Object.entries(placements).filter(([, v]) => v === t).map(([d]) => d);
  const place = (d: string, t: string | null) => {
    const next = { ...placements };
    if (!t) delete next[d];
    else {
      if (!ix.targets_reusable) for (const other of occupied(t)) if (other !== d) delete next[other];
      next[d] = t;
    }
    setPicked(null);
    onChange({ placements: next });
  };
  const label = (d: string) => ix.draggables.find((x) => x.id === d)?.label ?? d;
  const unplaced = ix.draggables.filter((d) => !placements[d.id]);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2" aria-label="Items to place">
        {unplaced.map((d) => (
          <button key={d.id} type="button" disabled={disabled} draggable={!disabled}
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.id); setPicked(d.id); }}
            onClick={() => setPicked((p) => (p === d.id ? null : d.id))} aria-pressed={picked === d.id}
            className={`rounded-pill border px-3 py-1.5 text-body-sm ${picked === d.id ? "border-midnight bg-midnight text-white" : "border-ink-20 bg-white hover:bg-paper"}`}>
            {d.label}
          </button>
        ))}
        {unplaced.length === 0 && <p className="text-caption text-slate">All items placed. Use the lists below to move one.</p>}
      </div>
      {picked && <p className="mt-2 text-caption text-graphite" aria-live="polite">Now click where “{label(picked)}” belongs.</p>}
      {exhibit && (
        <ExhibitView exhibit={exhibit}>
          {ix.targets.map((t) => {
            const [x, y, w, h] = t.coords;
            const here = occupied(t.id);
            return (
              <button key={t.id} type="button" disabled={disabled || !picked} tabIndex={-1} aria-hidden
                onClick={() => picked && place(picked, t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const d = e.dataTransfer.getData("text/plain"); if (d) place(d, t.id); }}
                className={`absolute flex flex-wrap content-center items-center justify-center gap-1 rounded-small p-0.5
                  ${picked ? "border-2 border-dashed border-action/70 hover:bg-action/10" : "border border-transparent"}`}
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
                {here.map((d) => (
                  <span key={d} className="rounded-pill bg-midnight px-2 py-0.5 text-[11px] font-semibold leading-tight text-white shadow-nav">{label(d)}</span>
                ))}
              </button>
            );
          })}
        </ExhibitView>
      )}
      {/* keyboard / screen-reader equivalent: same question, same response */}
      <fieldset className="mt-4" disabled={disabled}>
        <legend className="text-body-sm font-semibold">Placements</legend>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {ix.draggables.map((d) => {
            const sid = `em-${q.question_id}-${d.id}`;
            return (
              <li key={d.id} className="flex items-center gap-2">
                <label htmlFor={sid} className="min-w-0 flex-1 truncate text-body-sm">{d.label}</label>
                <select id={sid} className="field-input max-w-[60%] py-1.5" value={placements[d.id] ?? ""} onChange={(e) => place(d.id, e.target.value || null)}>
                  <option value="">{ix.unplaced_allowed ? "Not placed" : "Choose a place…"}</option>
                  {ix.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
        {ix.unplaced_allowed && <p className="mt-2 text-caption text-slate">Not every item has to be placed.</p>}
      </fieldset>
    </div>
  );
}

/* ---------------- hotspot ---------------- */
export function Hotspot({ q, value, onChange, disabled }: {
  q: AttemptQuestion; value: ItemResponse | null; onChange: (r: ItemResponse) => void; disabled: boolean;
}) {
  const ix = q.interaction as Ix<"hotspot">;
  const exhibit = q.exhibits?.[0];
  const chosen = new Set(value?.regions ?? []);
  const single = (ix.select_count ?? 1) === 1;
  const toggle = (id: string) => {
    if (single) return onChange({ regions: chosen.has(id) ? [] : [id] });
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ regions: ix.regions.map((r) => r.id).filter((x) => next.has(x)) });
  };
  return (
    <div className="mt-5">
      {exhibit && (
        <ExhibitView exhibit={exhibit}>
          {ix.regions.map((r) => {
            const [x, y, w, h] = r.coords;
            const on = chosen.has(r.id);
            return (
              <button key={r.id} type="button" disabled={disabled} onClick={() => toggle(r.id)} aria-pressed={on}
                aria-label={`Select area: ${r.label}`}
                className={`absolute rounded-small transition-colors ${on ? "border-[3px] border-action bg-action/15" : "border-2 border-transparent hover:border-action/50 hover:bg-action/5 focus-visible:border-action"}`}
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
            );
          })}
        </ExhibitView>
      )}
      <p className="mt-2 text-caption text-slate" aria-live="polite">
        {single ? "Select one area." : `Select ${ix.select_count} areas (${chosen.size} selected).`} Tab moves between areas; Space or Enter selects.
      </p>
    </div>
  );
}
