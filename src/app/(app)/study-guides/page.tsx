import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { STUDY_GUIDES, findGuide } from "@/lib/studyGuides";
import { Alert } from "@/components/ui/Alert";
import { Pill } from "@/components/ui/Pill";
import { AutoDownload } from "./AutoDownload";

export const metadata = { title: "Study guides" };

export default async function StudyGuidesPage({ searchParams }: { searchParams: Promise<{ download?: string; error?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const auto = sp.error ? undefined : findGuide(sp.download);
  const href = (code: string) => `/api/study-guides/${code.toLowerCase()}`;

  return (
    <div className="space-y-8">
      <header>
        <Pill tone="marigold">Free with your iParkar account</Pill>
        <h1 className="mt-3 text-[40px] font-semibold leading-tight tracking-[-1px]">Exam study guides</h1>
        <p className="lead mt-2 max-w-[640px]">Complete, blueprint-aligned study guides written by iParkar Learning. Download and keep them for your exam preparation.</p>
      </header>

      {sp.error === "unavailable" && (
        <Alert tone="error">That study guide isn’t available right now. Please try again later or contact support@iparkar.com.</Alert>
      )}
      {auto && (
        <>
          <Alert tone="success" title="Your download is starting">
            If it doesn’t start in a few seconds, <a className="link" href={href(auto.code)}>download the {auto.code} guide here</a>.
          </Alert>
          <AutoDownload href={href(auto.code)} />
        </>
      )}

      <div className="space-y-4">
        {STUDY_GUIDES.filter((g) => g.file).map((g) => (
          <article key={g.code} className="grid gap-6 rounded-card bg-sky-tint p-6 sm:p-8 md:grid-cols-[1.5fr_1fr] md:items-center">
            <div>
              <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{g.code}</span>
              <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-.6px]">{g.title}</h2>
              {g.edition && <p className="mt-1 text-body-sm font-semibold text-graphite">{g.edition}</p>}
              {g.summary && <p className="mt-3 text-body leading-relaxed">{g.summary}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href={href(g.code)} className="btn-primary text-body">↓ Download PDF</a>
                <span className="text-caption text-graphite">{g.file!.label}</span>
              </div>
            </div>
            {g.stats && (
              <ul className="grid gap-2.5">
                {g.stats.map(([n, l]) => (
                  <li key={l} className="flex items-baseline gap-3 rounded-card bg-white px-5 py-3.5">
                    <strong className="min-w-[72px] text-[28px] font-semibold tabular-nums tracking-[-1px] text-midnight">{n}</strong>
                    <span className="text-body-sm font-medium">{l}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <section aria-labelledby="soon-h">
        <h2 id="soon-h" className="text-heading-sm">Coming soon</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {STUDY_GUIDES.filter((g) => !g.file).map((g) => (
            <li key={g.code} className="rounded-card border border-dashed border-ink-20 bg-paper px-4 py-2 text-body-sm"><strong>{g.code}</strong> <span className="text-graphite">study guide</span></li>
          ))}
        </ul>
        <p className="mt-3 text-body-sm text-graphite">Meanwhile, practise with the <Link className="link" href="/dashboard">course practice exams</Link>.</p>
      </section>

      <p className="text-caption text-graphite">CSP® is a registered mark of the Board of Certified Safety Professionals (BCSP), which has not reviewed or endorsed this guide. Practice questions are original CSP-style items, not actual exam items. For personal study only — please don’t redistribute.</p>
    </div>
  );
}
