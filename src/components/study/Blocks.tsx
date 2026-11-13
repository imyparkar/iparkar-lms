import type { Block } from "@/lib/study/schema";
import { StudyText, TexBlock } from "./StudyText";

const CALLOUT: Record<string, { card: string; label: string }> = {
  source_note: { card: "bg-sky-tint", label: "Source note" },
  editorial: { card: "bg-sky-tint", label: "Course note" },
  exam_tip: { card: "bg-marigold", label: "Exam tip" },
  common_error: { card: "bg-coral", label: "Watch out" },
  regional: { card: "bg-moss-green", label: "Regional example" },
};

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-body-sm font-medium text-ink">{children}</p>;
}

/**
 * Renders one lesson block. `renderActivity` places interactive activities
 * (client components) where the author put them.
 */
export function StudyBlock({ block, renderActivity }: { block: Block; renderActivity: (code: string) => React.ReactNode }) {
  switch (block.type) {
    case "heading":
      return <h3 className="pt-4 text-heading-sm text-ink">{block.text}</h3>;
    case "text":
      return <p className="text-body text-charcoal"><StudyText md={block.md} /></p>;
    case "list": {
      const L = block.ordered ? "ol" : "ul";
      return (
        <L className={`space-y-2 pl-6 text-body text-charcoal ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((it, i) => <li key={i}><StudyText md={it} /></li>)}
        </L>
      );
    }
    case "table":
      return (
        <figure className="my-2">
          <div className="overflow-x-auto rounded-card border border-hairline bg-white" tabIndex={0} role="region" aria-label={block.caption}>
            <table className="w-full min-w-[520px] border-collapse">
              <caption className="px-4 pt-4 text-left text-body-sm font-semibold text-ink">{block.caption}</caption>
              <thead>
                <tr>{block.columns.map((c) => <th key={c} scope="col" className="table-head">{c}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => j === 0
                      ? <th key={j} scope="row" className="table-cell text-left font-medium text-ink">{cell}</th>
                      : <td key={j} className="table-cell text-charcoal">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note && <figcaption className="mt-2 text-body-sm text-graphite">{block.note}</figcaption>}
        </figure>
      );
    case "equation":
      return (
        <figure className="rounded-card border border-hairline bg-white p-5">
          <Caption>{block.label}</Caption>
          <TexBlock tex={block.tex} />
          <figcaption className="mt-3 space-y-1 text-body-sm text-graphite">
            {block.note && <p>{block.note}</p>}
            <details>
              <summary className="cursor-pointer text-ink-95">Equation in words</summary>
              <p className="mt-1">{block.alt}</p>
            </details>
          </figcaption>
        </figure>
      );
    case "steps":
      return (
        <figure>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {block.items.map((s, i) => (
              <li key={i} className={`rounded-button border p-3 ${s.emphasis ? "border-transparent bg-marigold" : "border-hairline bg-white"}`}>
                <p className="text-caption text-ink">Step {i + 1}{s.emphasis ? " · key check" : ""}</p>
                <p className="mt-1 text-body-sm font-semibold text-ink">{s.label}</p>
                <p className="text-body-sm text-ink-95">{s.text}</p>
              </li>
            ))}
          </ol>
          <figcaption className="mt-2 text-body-sm text-graphite">{block.caption}</figcaption>
        </figure>
      );
    case "worked_example":
      return (
        <section className="rounded-card border border-hairline bg-white" aria-label={`${block.label}: ${block.title}`}>
          <header className="border-b border-hairline px-5 py-4">
            <p className="text-caption text-slate">{block.label}{block.context ? ` · ${block.context}` : ""}</p>
            <h4 className="mt-1 text-[18px] font-semibold leading-snug text-ink">{block.title}</h4>
          </header>
          <dl className="divide-y divide-hairline">
            {[{ label: "Given", md: block.given }, { label: "Find", md: block.find }, ...block.steps].map((st, i) => (
              <div key={i} className="grid gap-1 px-5 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
                <dt className="text-body-sm font-semibold text-ink">{st.label}</dt>
                <dd className="text-body text-charcoal">
                  {"tex" in st && st.tex ? <TexBlock tex={st.tex} /> : <StudyText md={st.md} />}
                </dd>
              </div>
            ))}
            <div className="grid gap-1 rounded-b-card bg-sky-tint px-5 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
              <dt className="text-body-sm font-semibold text-ink">Answer</dt>
              <dd className="text-body text-ink"><StudyText md={block.answer} /></dd>
            </div>
          </dl>
        </section>
      );
    case "scenario":
      return (
        <section className="on-dark rounded-card bg-midnight p-6 text-white" aria-label={block.title}>
          <p className="text-caption text-marigold">{block.title}</p>
          <p className="mt-3 text-body"><StudyText md={block.body} /></p>
          <p className="mt-4 font-serif text-lead"><StudyText md={block.decision} /></p>
        </section>
      );
    case "callout": {
      const c = CALLOUT[block.variant];
      return (
        <aside className={`rounded-card p-5 text-ink ${c.card}`} aria-label={block.title}>
          <p className="text-body-sm font-semibold">{block.title}</p>
          {block.md && <p className="mt-2 text-body"><StudyText md={block.md} /></p>}
          {block.items && <ul className="mt-2 list-disc space-y-1 pl-6 text-body">{block.items.map((it, i) => <li key={i}><StudyText md={it} /></li>)}</ul>}
        </aside>
      );
    }
    case "summary":
      return (
        <section className="rounded-card border border-hairline bg-white p-5" aria-label="Summary">
          <h4 className="text-heading-sm text-ink">Summary</h4>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-body text-charcoal">{block.items.map((it, i) => <li key={i}><StudyText md={it} /></li>)}</ul>
        </section>
      );
    case "glossary":
      return (
        <section aria-label="Key terms">
          <h4 className="text-heading-sm text-ink">Key terms</h4>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {block.terms.map((t) => (
              <div key={t.term} className="rounded-button border border-hairline bg-white p-3">
                <dt className="text-body-sm font-semibold text-ink">{t.term}</dt>
                <dd className="mt-1 text-body-sm text-charcoal"><StudyText md={t.definition} /></dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "related":
      return (
        <section aria-label="Related chapters">
          <h4 className="text-heading-sm text-ink">Related chapters</h4>
          <ul className="mt-3 flex flex-wrap gap-2">
            {block.chapters.map((c) => (
              <li key={c.code}><a className="inline-flex rounded-button border border-hairline bg-white px-3 py-2 text-body-sm text-ink hover:bg-sky-tint" href={`./${c.code}`}>
                <span className="font-semibold">{c.code}</span>&nbsp;{c.title}</a></li>
            ))}
          </ul>
        </section>
      );
    case "references":
      return (
        <section aria-label="Chapter sources">
          <h4 className="text-heading-sm text-ink">Chapter sources</h4>
          <ul className="mt-3 space-y-2 text-body-sm text-graphite">{block.items.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </section>
      );
    case "activity":
      return <>{renderActivity(block.code)}</>;
  }
}

/** Plain-language provenance line for a section. */
export function provenance(blocks: Block[]) {
  const pages = blocks.flatMap((b) => ("origin" in b && b.origin === "source" && b.pages ? b.pages : []));
  if (!pages.length) return null;
  const lo = Math.min(...pages), hi = Math.max(...pages);
  return lo === hi ? `p. ${lo}` : `pp. ${lo}–${hi}`;
}
