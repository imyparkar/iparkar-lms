import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { STUDY_GUIDES, canDownload, findGuide, studyAccessCodes } from "@/lib/studyGuides";
import { courseSlug, type MyStudyCourse, type StudyOffer } from "@/lib/study/types";
import { startStudyCourse } from "@/lib/study/accessActions";
import { fmtDate } from "@/lib/format";
import { Alert } from "@/components/ui/Alert";
import { Pill } from "@/components/ui/Pill";
import { AutoDownload } from "./AutoDownload";

export const metadata = { title: "Study guides" };
export const dynamic = "force-dynamic";

export default async function StudyGuidesPage({ searchParams }: { searchParams: Promise<{ download?: string; error?: string; guide?: string }> }) {
  const { supabase, profile } = await requireUser();
  const sp = await searchParams;
  const isAdmin = profile.role === "admin";
  const [access, { data: mine }, { data: offerData }] = await Promise.all([
    studyAccessCodes(supabase),
    supabase.rpc("get_my_study_courses"),
    supabase.rpc("get_study_offers"),
  ]);
  const enrolled = new Map(((Array.isArray(mine) ? mine : []) as MyStudyCourse[]).map((c) => [c.code.toUpperCase(), c]));
  const offers = new Map(((Array.isArray(offerData) ? offerData : []) as StudyOffer[]).map((o) => [o.code.toUpperCase(), o]));

  const requested = sp.error ? undefined : findGuide(sp.download);
  const auto = requested && canDownload(requested, access, isAdmin) ? requested : undefined;
  const lockedGuide = findGuide(sp.guide) ?? (requested && !auto ? requested : undefined);
  const href = (code: string) => `/api/study-guides/${code.toLowerCase()}`;

  return (
    <div className="space-y-8">
      <header>
        <Pill tone="marigold">Included with each Self Paced Study Course</Pill>
        <h1 className="mt-3 text-[40px] font-semibold leading-tight tracking-[-1px]">Exam study guides</h1>
        <p className="lead mt-2 max-w-[680px]">Each study guide PDF comes with its Self Paced Study Course. Download it during your 7-day free trial or once you’ve bought the course.</p>
      </header>

      {sp.error === "unavailable" && (
        <Alert tone="error">That study guide isn’t available right now. Please try again later or contact support@iparkar.com.</Alert>
      )}
      {lockedGuide && (
        <Alert tone="info" title={`The ${lockedGuide.code} study guide comes with the ${lockedGuide.code} Self Paced Study Course`}>
          Start the free trial or buy the course below to download the PDF.
        </Alert>
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
        {STUDY_GUIDES.filter((g) => g.file).map((g) => {
          const code = g.studyCourse ?? "";
          const slug = courseSlug(code);
          const course = enrolled.get(code);
          const offer = offers.get(code);
          const open = canDownload(g, access, isAdmin);
          return (
            <article key={g.code} className="grid gap-6 rounded-card bg-sky-tint p-6 sm:p-8 md:grid-cols-[1.5fr_1fr] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{g.code}</span>
                  {open ? <Pill tone="strong">Unlocked</Pill> : <Pill tone="neutral">Included with the {g.code} study course</Pill>}
                </div>
                <h2 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-.6px]">{g.title}</h2>
                {g.edition && <p className="mt-1 text-body-sm font-semibold text-graphite">{g.edition}</p>}
                {g.summary && <p className="mt-3 text-body leading-relaxed">{g.summary}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {open ? (
                    <>
                      <a href={href(g.code)} className="btn-primary text-body">↓ Download PDF</a>
                      <span className="text-caption text-graphite">{g.file!.label}</span>
                    </>
                  ) : course ? (
                    <>
                      <p className="w-full text-body-sm text-graphite">Your access to the {g.code} Self Paced Study Course ended {course.access.expires_at ? fmtDate(course.access.expires_at) : ""}. Buy the course to download the guide again.</p>
                      <Link href={`/learn/${slug}/buy`} className="btn-primary text-body">Buy the course</Link>
                    </>
                  ) : offer ? (
                    <>
                      {offer.self_enroll && (
                        <form action={startStudyCourse}>
                          <input type="hidden" name="course" value={slug} />
                          <button type="submit" className="btn-primary text-body">{offer.trial_days ? `Start ${offer.trial_days}-day free trial` : "Start the course"}</button>
                        </form>
                      )}
                      <Link href={`/learn/${slug}/buy`} className="btn-outline">Buy{offer.price_label ? ` · ${offer.price_label}` : ""}</Link>
                    </>
                  ) : (
                    <p className="text-body-sm text-graphite">Coming soon with the {g.code} Self Paced Study Course.</p>
                  )}
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
          );
        })}
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

      <p className="text-caption text-graphite">ASP® and CSP® are registered marks of the Board of Certified Safety Professionals (BCSP), which has not reviewed or endorsed these guides. Practice questions are original items in the style of each exam, not actual exam items. For personal study only — please don’t redistribute.</p>
    </div>
  );
}
