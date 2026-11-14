import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { courseCode, type StudyCourse } from "@/lib/study/types";
import { ProgressMeter } from "@/components/study/Progress";
import { NotEnrolled } from "@/components/study/NotEnrolled";
import { TrialNotice, accessLine, Paywall } from "@/components/study/Access";
import { studyBuyUrl } from "@/lib/study/buy";
import { BetaNotice, isBeta } from "@/components/study/BetaNotice";

export const metadata = { title: "Course overview" };
export const dynamic = "force-dynamic";

const PANELS = ["bg-marigold", "bg-sky-wash", "bg-coral", "bg-moss-green", "bg-saffron", "bg-mocha"];

export default async function CourseOverview({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course)) notFound();
  const { supabase, user } = await requireUser();
  const { data } = await supabase.rpc("get_study_course", { p_course_code: courseCode(course) });
  if (!data?.ok) return <NotEnrolled offer={data?.offer} />;
  const c = data as StudyCourse;
  const buy = studyBuyUrl(c.course.code, user);
  const sheets = new Map(c.resources.filter((r) => r.kind === "formula_sheet").map((r) => [r.domain, r]));
  const p = c.progress;
  const authored = c.domains.flatMap((d) => d.chapters).filter((ch) => ch.has_content).length;
  const resume = c.resume ? `/study/${course}/${c.resume.chapter}${c.resume.section ? `?s=${c.resume.section}` : ""}` : `/study/${course}/1.1`;

  return (
    <div className="space-y-12">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href="/learn" className="hover:text-ink">My learning</Link> / <span className="text-ink">{c.course.title}</span></nav>
      {isBeta(c.course.version) && <BetaNotice />}
      <TrialNotice access={c.access} buyHref={buy} />
      {!c.access.has_access && <Paywall access={c.access} buyHref={buy} courseTitle={c.course.title} done={p.completed_chapters} total={p.required_chapters} slug={course} />}
      <header className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <div>
          <p className="text-subheading text-graphite">{c.course.product}</p>
          <h1 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-[-1.2px] sm:text-display-sm">{c.course.title}</h1>
          <p className="lead mt-4 max-w-[640px]">Ninety-nine chapters across the nine ASP11 domains, taught from the {c.course.source_title ?? "study guide"} (Edition {c.course.source_edition}). Work through them in any order; we recommend the guide&apos;s order, starting with chapters 1.1 and 1.2.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {c.access.has_access && <Link href={resume} className="btn-primary">{c.resume ? `Continue: chapter ${c.resume.chapter}` : "Start with chapter 1.1"}</Link>}
          </div>
        </div>
        <div className="card space-y-4">
          <ProgressMeter done={p.completed_chapters} total={p.required_chapters} label="Chapters completed" />
          <p className="text-body-sm text-graphite">{p.domains_completed} of {p.domains_total} domains complete{c.course.completed_at ? ` · Course completed ${fmtDate(c.course.completed_at)}` : ""}</p>
          {c.course.completed_at && <Link className="btn-outline" href={`/learn/${course}/completion`}>View completion record</Link>}
          <p className="text-caption text-slate">Version {c.course.version}{c.course.is_pilot ? " · pilot enrollment in an unpublished version" : ""} · {authored} of {p.required_chapters} chapters available now</p>
          <p className="text-body-sm text-ink">{accessLine(c.access)}</p>
        </div>
      </header>

      <section aria-labelledby="how" className="grid gap-6 md:grid-cols-3">
        <h2 id="how" className="sr-only">How this course works</h2>
        <div className="card"><h3 className="text-heading-sm">Study each section</h3><p className="mt-2 text-body text-graphite">Chapters are split into short sections. Open each one, work through it, then mark it as studied.</p></div>
        <div className="card"><h3 className="text-heading-sm">Practise with feedback</h3><p className="mt-2 text-body text-graphite">Answer each activity, then read the explanation. Right or wrong, you can retry; there is no pass mark.</p></div>
        <div className="card"><h3 className="text-heading-sm">Finish chapters</h3><p className="mt-2 text-body text-graphite">Press Finish chapter when everything is done. The course completes when all {p.required_chapters} chapters are finished.</p></div>
      </section>

      <section aria-labelledby="domains" className="space-y-5">
        <div>
          <h2 id="domains" className="text-[32px] font-semibold tracking-[-0.8px]">Nine domains</h2>
          <p className="lead mt-2">Weights are the exam distribution the guide states for blueprint {c.course.stated_blueprint}. Every chapter counts equally towards completion.</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.domains.map((d, i) => {
            const done = d.chapters.filter((ch) => ch.status === "completed").length;
            return (
              <li key={d.number}>
                <Link href={`/learn/${course}/domain/${d.number}`} className="block h-full rounded-card border border-hairline bg-white transition-colors duration-200 hover:bg-paper">
                  <div className={`rounded-t-card px-5 py-4 text-ink ${PANELS[i % PANELS.length]}`}>
                    <p className="text-caption">Domain {d.number} · {d.weight}% of the exam</p>
                    <h3 className="mt-1 text-heading-sm">{d.title}</h3>
                  </div>
                  <div className="space-y-2 p-5">
                    <p className="text-body-sm text-graphite">{d.chapters.length} chapters</p>
                    <ProgressMeter size="sm" done={done} total={d.chapters.length} label="Completed" />
                  </div>
                </Link>
                {sheets.has(d.number) && c.access.has_access && (
                  <Link href={`/learn/${course}/formulas/${d.number}`} className="btn-outline mt-3 w-full">Domain {d.number} formula sheet</Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card max-w-[820px] space-y-2 text-body-sm text-graphite" aria-label="About this course">
        <p><span className="font-semibold text-ink">About completion.</span> A chapter is complete when you have opened and marked every section as studied, answered every required activity and read its feedback, then pressed Finish chapter. Opening or scrolling never completes a chapter. Completion records your participation; it isn&apos;t a predicted score or a certification.</p>
        <p><span className="font-semibold text-ink">Independence.</span> ASP® is a registered mark of the Board of Certified Safety Professionals (BCSP), which has not reviewed or endorsed this course. Check exam policies at bcsp.org. This study course is separate from iParkar&apos;s practice exams.</p>
      </section>
    </div>
  );
}
