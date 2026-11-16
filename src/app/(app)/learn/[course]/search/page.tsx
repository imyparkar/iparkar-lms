import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode } from "@/lib/study/types";
import { NotEnrolled } from "@/components/study/NotEnrolled";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search the course", robots: { index: false } };

type Hit = { chapter: string; chapter_title: string; domain: number; section: string; section_title: string; snippet: string };
type Gloss = { term: string; definition: string };
type ResHit = { code: string; kind: "formula_sheet" | "glossary" | "bibliography"; domain: number | null; title: string; snippet: string };

/** Snippets mark matches as [[term]]; render them as <mark> without interpreting any other markup. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[[\s\S]*?\]\])/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith("[[") && p.endsWith("]]")
        ? <mark key={i} className="rounded-sm bg-marigold px-0.5 text-ink">{p.slice(2, -2)}</mark>
        : <span key={i}>{p}</span>)}
    </>
  );
}

export default async function CourseSearch({ params, searchParams }: {
  params: Promise<{ course: string }>; searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { course } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course)) notFound();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").slice(0, 200);
  const { supabase } = await requireUser();
  const { data: course_ } = await supabase.rpc("get_study_course", { p_course_code: courseCode(course) });
  if (!course_?.ok && course_?.error === "not_enrolled") return <NotEnrolled offer={course_?.offer} />;
  const title: string = course_?.course?.title ?? "Study course";
  const res = q.trim().length >= 2 ? (await supabase.rpc("study_search", { p_course_code: courseCode(course), p_query: q })).data : null;
  const hits: Hit[] = res?.ok ? res.results : [];
  const resHits: ResHit[] = res?.ok ? res.resources : [];
  const gloss: Gloss[] = res?.ok ? res.glossary ?? [] : [];
  const expired = res?.error === "access_expired" || (course_?.ok && course_.access && !course_.access.has_access);
  const resHref = (r: ResHit) => r.kind === "formula_sheet" ? `/learn/${course}/formulas/${r.domain}` : `/learn/${course}/resources/${r.code}`;

  return (
    <div className="max-w-reading space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite">
        <Link href="/learn" className="hover:text-ink">My learning</Link> / <Link href={`/learn/${course}`} className="hover:text-ink">{title}</Link> / <span className="text-ink">Search</span>
      </nav>
      <header>
        <h1 className="text-[36px] font-semibold leading-tight tracking-[-1px]">Search the course</h1>
        <p className="mt-2 text-body text-graphite">Searches every chapter section, the glossary, the bibliography and the formula sheets of your course version. Practice questions are not searched.</p>
      </header>
      <form role="search" action={`/learn/${course}/search`} method="get" className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="q" className="sr-only">Search terms</label>
        <input id="q" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off" placeholder="e.g. confined space, LD50, RACI"
               className="field-input flex-1" />
        <button type="submit" className="btn-primary">Search</button>
      </form>

      {expired && <p className="card text-body text-ink">Your access to this course has ended, so search is unavailable. <Link className="underline underline-offset-2" href={`/learn/${course}`}>Course overview</Link></p>}

      {q.trim().length >= 2 && !expired && (
        <section aria-labelledby="results-title" className="space-y-4">
          <h2 id="results-title" className="text-heading-sm" role="status">
            {hits.length + resHits.length === 0 ? `No results for “${q}”` : `${hits.length} section${hits.length === 1 ? "" : "s"}${resHits.length ? ` and ${resHits.length} reference page${resHits.length === 1 ? "" : "s"}` : ""} for “${q}”`}
          </h2>
          {hits.length + resHits.length === 0 && <p className="text-body text-graphite">Try fewer or different words, or a single key term.</p>}
          {gloss.length > 0 && (
            <div className="rounded-card border border-hairline bg-white p-4">
              <h3 className="text-body font-semibold text-ink">Glossary</h3>
              <dl className="mt-2 space-y-2">
                {gloss.map((g) => (
                  <div key={g.term}><dt className="text-body-sm font-semibold text-ink">{g.term}</dt><dd className="text-body-sm text-charcoal">{g.definition}</dd></div>
                ))}
              </dl>
              <Link href={`/learn/${course}/resources/glossary`} className="mt-3 inline-block text-body-sm text-ink underline underline-offset-2 hover:text-action">Open the full glossary</Link>
            </div>
          )}
          <ol className="space-y-3">
            {hits.map((h) => (
              <li key={`${h.chapter}/${h.section}`} className="rounded-card border border-hairline bg-white p-4">
                <p className="text-caption text-slate">Domain {h.domain} · Chapter {h.chapter} {h.chapter_title}</p>
                <Link href={`/study/${course}/${h.chapter}?s=${h.section}`} className="mt-1 inline-block text-body font-semibold text-ink underline underline-offset-2 hover:text-action">{h.section_title}</Link>
                <p className="mt-1 text-body-sm text-charcoal"><Snippet text={h.snippet} /></p>
              </li>
            ))}
          </ol>
          {resHits.length > 0 && (
            <><h3 className="text-heading-sm">Reference pages</h3><ul className="space-y-3">
              {resHits.map((r) => (
                <li key={r.code} className="rounded-card border border-hairline bg-white p-4">
                  <Link href={resHref(r)} className="text-body font-semibold text-ink underline underline-offset-2 hover:text-action">{r.title}</Link>
                  <p className="mt-1 text-body-sm text-charcoal"><Snippet text={r.snippet} /></p>
                </li>
              ))}
            </ul></>
          )}
          {hits.length === 40 && <p className="text-body-sm text-graphite">Showing the 40 best matches. Add a word to narrow the search.</p>}
        </section>
      )}
    </div>
  );
}
