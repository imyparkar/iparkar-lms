import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import type { CourseAnalytics, MyCourse, SubjectPerformance } from "@/lib/types";
import { fmtDate, fmtPct, modeLabel } from "@/lib/format";
import { Pill } from "@/components/ui/Pill";
import { Alert } from "@/components/ui/Alert";
import { CourseAnalyticsPanel } from "@/components/analytics/CourseAnalyticsPanel";
import { ProgressMeter } from "@/components/study/Progress";
import { accessLine } from "@/components/study/Access";
import { courseSlug, type MyStudyCourse } from "@/lib/study/types";

const PRICING_URL = "https://iparkar.com/practice-exams/";

export const metadata = { title: "Dashboard" };

type Activity = { attempt_id: string; course_code: string; course_name: string; mode: string; status: string;
                  started_at: string; submitted_at: string | null; score_pct: number | null };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kuwait" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function accessLabel(c: MyCourse) {
  if (!c.has_access) return { tone: "coral" as const, text: "Access ended" };
  if (!c.exams_enabled) return { tone: "sky" as const, text: "Enrolled · exams opening soon" };
  if (c.has_lifetime_access) return { tone: "strong" as const, text: "Active" };
  return { tone: "strong" as const, text: c.access_expires_at ? `Active until ${fmtDate(c.access_expires_at)}` : "Active" };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ course?: string; password?: string }> }) {
  const { profile, supabase } = await requireUser();
  const sp = await searchParams;
  const [{ data: coursesRaw }, { data: activityRaw }, { data: studyRaw }] = await Promise.all([
    supabase.rpc("get_my_courses"),
    supabase.rpc("get_recent_activity", { p_limit: 5 }),
    supabase.rpc("get_my_study_courses"),
  ]);
  // Only what the learner has requested or bought: practice-exam packages with access
  // (or past access, so history stays reachable) and study courses they have started.
  const courses = ((coursesRaw ?? []) as MyCourse[])
    .filter((c) => c.has_access || c.completed_attempts > 0 || c.active_attempt_id);
  const study = (Array.isArray(studyRaw) ? studyRaw : []) as MyStudyCourse[];
  const activity = (activityRaw ?? []) as Activity[];
  const enrolled = courses.filter((c) => c.has_access);
  const selected = courses.find((c) => c.code === sp.course?.toUpperCase()) ?? enrolled[0] ?? null;
  const ready = enrolled.find((c) => c.exams_enabled);
  const active = courses.find((c) => c.active_attempt_id);

  let analytics: CourseAnalytics | null = null;
  let subjects: SubjectPerformance[] = [];
  if (selected?.has_access) {
    const [{ data }, { data: subjectData }] = await Promise.all([
      supabase.rpc("get_course_analytics", { p_course: selected.id, p_blueprint: null }),
      supabase.rpc("get_course_subject_analytics", { p_course: selected.id }),
    ]);
    if (data?.ok) analytics = data as CourseAnalytics;
    if (Array.isArray(subjectData)) subjects = subjectData as SubjectPerformance[];
  }

  return (
    <div className="space-y-10">
      {sp.password === "updated" && <Alert tone="success">Your password was updated.</Alert>}

      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-subheading text-graphite">{greeting()},</p>
          <h1 className="mt-2 text-[40px] font-semibold leading-tight tracking-[-1px]">{profile.full_name || profile.username}</h1>
          <p className="lead mt-2">
            {study.length || courses.length
              ? "Here are the courses and exam packages you have access to."
              : "You don’t have any courses or exam packages yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Link href={`/exam/${active.active_attempt_id}`} className="btn-primary text-body">Resume {active.code} exam</Link>
          ) : ready ? (
            <Link href={`/courses/${ready.code}`} className="btn-primary text-body">Start practice exam</Link>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="courses-h">
        <h2 id="courses-h" className="text-heading-sm">Your courses</h2>
        {study.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-ink-20 bg-paper p-6">
            <p className="text-body text-graphite">You haven’t started a self-paced study course yet.</p>
            <Link href="/learn" className="btn-outline mt-4 inline-flex">Browse study courses</Link>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {study.map((c) => {
              const slug = courseSlug(c.code);
              const resumeHref = c.resume ? `/study/${slug}/${c.resume.chapter}${c.resume.section ? `?s=${c.resume.section}` : ""}` : `/study/${slug}/1.1`;
              return (
                <article key={c.code} className="rounded-card border border-hairline bg-white p-6">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{c.code}</span>
                    <Pill tone={!c.access.has_access ? "coral" : c.access.source === "trial" ? "sky" : "strong"}>
                      {!c.access.has_access ? "Access ended" : c.access.source === "trial" ? "Free trial" : "Active"}
                    </Pill>
                  </div>
                  <h3 className="mt-4 text-[18px] font-semibold leading-snug">{c.title}</h3>
                  <p className="mt-1 text-body-sm text-graphite">{accessLine(c.access)}</p>
                  <div className="mt-4"><ProgressMeter size="sm" done={c.progress.completed_chapters} total={c.progress.required_chapters} label="Chapters completed" /></div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {c.access.has_access
                      ? <Link href={resumeHref} className="btn-ghost">{c.resume ? "Continue learning" : "Start the course"}</Link>
                      : <Link href="/learn" className="btn-outline">Renew access</Link>}
                    <Link href={`/learn/${slug}`} className="btn-text">Course overview</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="packages-h">
        <h2 id="packages-h" className="text-heading-sm">Exam packages</h2>
        {courses.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-ink-20 bg-paper p-6">
            <p className="text-body text-graphite">You don’t have a practice-exam package yet.</p>
            <a href={PRICING_URL} className="btn-outline mt-4 inline-flex">View practice exam packages</a>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {courses.map((c) => {
              const access = accessLabel(c);
              const isSel = selected?.code === c.code;
              return (
                <article key={c.id} className={`rounded-card border border-hairline bg-white p-6 ${isSel ? "ring-2 ring-midnight" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{c.code}</span>
                    <Pill tone={access.tone}>{access.text}</Pill>
                  </div>
                  <h3 className="mt-4 text-[18px] font-semibold leading-snug">{c.name}</h3>
                  <p className="mt-1 text-body-sm text-graphite">
                    {`${c.completed_attempts} exam${c.completed_attempts === 1 ? "" : "s"} completed${c.last_score != null ? ` · last ${fmtPct(c.last_score, 1)}` : ""}`}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link href={`/courses/${c.code}`} className={c.has_access ? "btn-ghost" : "btn-outline"}>
                      {c.has_access ? "Open exams" : "Renew access"}
                    </Link>
                    {c.has_access && !isSel && (
                      <Link href={`/dashboard?course=${c.code}`} className="btn-text" scroll={false}>See analytics</Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {activity.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-heading-sm">Recent activity</h2>
          <ul className="mt-3 divide-y divide-hairline rounded-card border border-hairline bg-white">
            {activity.map((a) => (
              <li key={a.attempt_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-body-sm">
                <span><span className="font-semibold">{a.course_code}</span> · {modeLabel(a.mode)} · {fmtDate(a.submitted_at ?? a.started_at)}</span>
                <span className="flex items-center gap-3">
                  {a.status === "in_progress" ? <Pill tone="marigold">In progress</Pill> : <span className="font-semibold tabular-nums">{fmtPct(a.score_pct, 1)}</span>}
                  <Link href={a.status === "in_progress" ? `/exam/${a.attempt_id}` : `/results/${a.attempt_id}`} className="link">
                    {a.status === "in_progress" ? "Resume" : "View"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected?.has_access && analytics && (
        <section aria-labelledby="perf-h" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="perf-h" className="text-heading-sm">{selected.code} performance</h2>
              <p className="text-body-sm text-graphite">Analytics are kept separate for each course — domains are never mixed between courses.</p>
            </div>
            {enrolled.length > 1 && (
              <nav aria-label="Choose course analytics" className="flex gap-1 rounded-button bg-white p-1 border border-hairline">
                {enrolled.map((c) => (
                  <Link key={c.code} href={`/dashboard?course=${c.code}`} scroll={false} aria-current={c.code === selected.code ? "true" : undefined}
                    className={`rounded-small px-3 py-1.5 text-body-sm font-medium ${c.code === selected.code ? "bg-midnight text-white" : "text-ink-54 hover:text-ink"}`}>
                    {c.code}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          <CourseAnalyticsPanel a={analytics} subjects={subjects} courseCode={selected.code} courseName={selected.name} />
        </section>
      )}
    </div>
  );
}
