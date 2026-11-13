import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode, type StudyCourse } from "@/lib/study/types";
import { ProgressMeter, StatusPill } from "@/components/study/Progress";
import { NotEnrolled } from "@/components/study/NotEnrolled";

export const dynamic = "force-dynamic";
export const metadata = { title: "Domain" };

export default async function DomainPage({ params }: { params: Promise<{ course: string; n: string }> }) {
  const { course, n } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course) || !/^\d{1,2}$/.test(n)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("get_study_course", { p_course_code: courseCode(course) });
  if (!data?.ok) return <NotEnrolled />;
  const c = data as StudyCourse;
  const d = c.domains.find((x) => x.number === Number(n));
  if (!d) notFound();
  const done = d.chapters.filter((ch) => ch.status === "completed").length;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite">
        <Link href="/learn" className="hover:text-ink">My learning</Link> / <Link href={`/learn/${course}`} className="hover:text-ink">{c.course.title}</Link> / <span className="text-ink">Domain {d.number}</span>
      </nav>
      <header className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="text-subheading text-graphite">Domain {d.number} · {d.weight}% of the exam (as stated by the guide)</p>
          <h1 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-[-1.2px]">{d.title}</h1>
          {d.intro && <p className="lead mt-3">{d.intro}</p>}
          {d.number === 1 && <p className="lead mt-3">Start with chapters 1.1 and 1.2. Every later calculation chapter assumes the unit habits and maths tools they teach.</p>}
        </div>
        <div className="card"><ProgressMeter done={done} total={d.chapters.length} label="Chapters completed in this domain" />
          <p className="mt-3 text-body-sm text-graphite">{done === d.chapters.length ? "Domain complete." : "The domain completes when every chapter in it is finished."}</p></div>
      </header>

      <ol className="space-y-3">
        {d.chapters.map((ch) => (
          <li key={ch.code} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-caption text-slate">
                Chapter {ch.code}{ch.objectives.length ? ` · Objective ${ch.objectives.join(", ")}` : " · Prerequisite"}
                {ch.source_pages ? ` · Guide pp. ${ch.source_pages[0]}–${ch.source_pages[1]}` : ""}
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-snug">{ch.title}</h2>
              <p className="mt-1 text-body-sm text-graphite">
                {ch.has_content ? `${ch.sections} sections${ch.est_minutes ? ` · about ${ch.est_minutes} min` : ""}` : "In preparation: lessons are being written and reviewed."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {ch.has_content ? <StatusPill status={ch.status} /> : <span className="pill border border-hairline bg-paper text-ink">In preparation</span>}
              {ch.has_content && <Link className="btn-outline" href={`/study/${course}/${ch.code}`}>{ch.status === "not_started" ? "Start" : ch.status === "completed" ? "Review" : "Continue"}<span className="sr-only"> chapter {ch.code}</span></Link>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
