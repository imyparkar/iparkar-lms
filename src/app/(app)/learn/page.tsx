import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { courseSlug, type MyStudyCourse } from "@/lib/study/types";
import { ProgressMeter, StatusPill } from "@/components/study/Progress";

export const metadata = { title: "My learning" };
export const dynamic = "force-dynamic";

export default async function MyLearning() {
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("get_my_study_courses");
  const courses = (Array.isArray(data) ? data : []) as MyStudyCourse[];

  return (
    <div className="space-y-10">
      <header className="max-w-[720px]">
        <h1 className="text-[40px] font-semibold leading-tight tracking-[-1px]">My learning</h1>
        <p className="lead mt-3">Self-paced study courses: read each chapter, practise, and pick up exactly where you left off on any device.</p>
      </header>

      {courses.length === 0 && (
        <section className="card max-w-[720px]">
          <h2 className="text-heading-sm">No study courses yet</h2>
          <p className="mt-2 text-body text-graphite">When you&apos;re enrolled in a self-paced study course it appears here. Study courses are separate from the practice exams on your <Link className="link" href="/dashboard">dashboard</Link>.</p>
        </section>
      )}

      {courses.map((c) => {
        const slug = courseSlug(c.code);
        const p = c.progress;
        const resumeHref = c.resume ? `/study/${slug}/${c.resume.chapter}${c.resume.section ? `?s=${c.resume.section}` : ""}` : `/study/${slug}/1.1`;
        return (
          <section key={c.code} aria-labelledby={`c-${c.code}`} className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="on-dark rounded-card bg-midnight p-6 text-white sm:p-8">
                <p className="text-caption text-marigold">iParkar Learning · Version {c.version}{c.is_pilot ? " · Pilot (unpublished)" : ""}</p>
                <h2 id={`c-${c.code}`} className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.6px]">{c.title}</h2>
                <p className="mt-2 font-serif text-lead text-white">
                  {c.completed_at ? `Completed on ${fmtDate(c.completed_at)}.` : c.resume ? `Pick up at chapter ${c.resume.chapter}: ${c.resume.chapter_title}.` : "Start with chapters 1.1 and 1.2; every calculation chapter relies on them."}
                </p>
                <div className="mt-6"><ProgressMeter dark done={p.completed_chapters} total={p.required_chapters} label="Chapters completed" /></div>
                <p className="mt-3 text-body-sm text-white">{p.domains_completed} of {p.domains_total} domains complete · Last activity {fmtDateTime(c.last_activity_at)}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link href={resumeHref} className="btn-primary">{c.resume ? "Continue learning" : "Start the course"}</Link>
                  <Link href={`/learn/${slug}`} className="btn rounded-button bg-white text-ink hover:bg-paper">Course overview</Link>
                  {c.completed_at && <Link href={`/learn/${slug}/completion`} className="btn rounded-button bg-white text-ink hover:bg-paper">Completion record</Link>}
                </div>
              </div>

              <div className="card">
                <h3 className="text-heading-sm">Domains</h3>
                <ul className="mt-4 space-y-3">
                  {p.domains.map((d) => (
                    <li key={d.number}>
                      <Link href={`/learn/${slug}/domain/${d.number}`} className="block rounded-button hover:bg-paper">
                        <ProgressMeter size="sm" done={d.completed} total={d.required} label={`${d.number}. ${d.title}`} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="card">
                <h3 className="text-heading-sm">Recent learning</h3>
                {c.recent.length === 0 ? <p className="mt-2 text-body text-graphite">Nothing yet. Your recently opened chapters show here.</p> : (
                  <ul className="mt-3 divide-y divide-hairline">
                    {c.recent.map((r) => (
                      <li key={r.chapter} className="flex items-center justify-between gap-3 py-2.5">
                        <Link href={`/study/${slug}/${r.chapter}`} className="text-body-sm text-ink hover:underline"><span className="font-semibold">{r.chapter}</span> {r.title}</Link>
                        <StatusPill status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card">
                <h3 className="text-heading-sm">Bookmarks</h3>
                {c.bookmarks.length === 0 ? <p className="mt-2 text-body text-graphite">Bookmark a section in the player to find it again here.</p> : (
                  <ul className="mt-3 divide-y divide-hairline">
                    {c.bookmarks.map((b) => (
                      <li key={`${b.chapter}-${b.section}`} className="py-2.5">
                        <Link href={`/study/${slug}/${b.chapter}?s=${b.section}`} className="text-body-sm text-ink hover:underline">
                          <span className="font-semibold">{b.chapter}</span> {b.section_title}
                        </Link>
                        <p className="text-caption text-slate">{b.chapter_title}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <p className="max-w-[720px] text-body-sm text-graphite">
        Study progress records participation and formative practice. It isn&apos;t a predicted exam score and completing a course isn&apos;t a certification. This study course is separate from the ASP, CSP and CIH practice exams.
      </p>
    </div>
  );
}
