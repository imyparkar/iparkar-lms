import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import type { CourseAnalytics, MyCourse } from "@/lib/types";
import { fmtDate, fmtPct, modeLabel } from "@/lib/format";
import { Pill } from "@/components/ui/Pill";
import { Alert } from "@/components/ui/Alert";
import { CourseAnalyticsPanel } from "@/components/analytics/CourseAnalyticsPanel";

export const metadata = { title: "Dashboard" };

type Activity = { attempt_id: string; course_code: string; course_name: string; mode: string; status: string;
                  started_at: string; submitted_at: string | null; score_pct: number | null };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kuwait" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function accessLabel(c: MyCourse) {
  if (!c.has_access) return { tone: "neutral" as const, text: "Not enrolled" };
  if (!c.exams_enabled) return { tone: "sky" as const, text: "Enrolled · exams opening soon" };
  if (c.has_lifetime_access) return { tone: "strong" as const, text: "Active" };
  return { tone: "strong" as const, text: c.access_expires_at ? `Active until ${fmtDate(c.access_expires_at)}` : "Active" };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ course?: string; password?: string }> }) {
  const { profile, supabase } = await requireUser();
  const sp = await searchParams;
  const [{ data: coursesRaw }, { data: activityRaw }] = await Promise.all([
    supabase.rpc("get_my_courses"),
    supabase.rpc("get_recent_activity", { p_limit: 5 }),
  ]);
  const courses = (coursesRaw ?? []) as MyCourse[];
  const activity = (activityRaw ?? []) as Activity[];
  const enrolled = courses.filter((c) => c.has_access);
  const selected = courses.find((c) => c.code === sp.course?.toUpperCase()) ?? enrolled[0] ?? null;
  const ready = enrolled.find((c) => c.exams_enabled);
  const active = courses.find((c) => c.active_attempt_id);

  let analytics: CourseAnalytics | null = null;
  if (selected?.has_access) {
    const { data } = await supabase.rpc("get_course_analytics", { p_course: selected.id, p_blueprint: null });
    if (data?.ok) analytics = data as CourseAnalytics;
  }

  return (
    <div className="space-y-10">
      {sp.password === "updated" && <Alert tone="success">Your password was updated.</Alert>}

      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-subheading text-graphite">{greeting()},</p>
          <h1 className="mt-2 text-[40px] font-semibold leading-tight tracking-[-1px]">{profile.full_name || profile.username}</h1>
          <p className="lead mt-2">
            {enrolled.length
              ? `You’re enrolled in ${enrolled.map((c) => c.code).join(", ")}.`
              : "You’re not enrolled in a course yet — pick one below to get started."}
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
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {courses.map((c) => {
            const access = accessLabel(c);
            const isSel = selected?.code === c.code;
            return (
              <article key={c.id} className={`rounded-card p-6 ${c.has_access ? "bg-white border border-hairline" : "bg-paper border border-dashed border-ink-20"} ${isSel ? "ring-2 ring-midnight" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{c.code}</span>
                  <Pill tone={access.tone}>{access.text}</Pill>
                </div>
                <h3 className="mt-4 text-[18px] font-semibold leading-snug">{c.name}</h3>
                <p className="mt-1 text-body-sm text-graphite">
                  {c.has_access ? `${c.completed_attempts} exam${c.completed_attempts === 1 ? "" : "s"} completed${c.last_score != null ? ` · last ${fmtPct(c.last_score, 1)}` : ""}` : c.description}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href={`/courses/${c.code}`} className={c.has_access ? "btn-ghost" : "btn-outline"}>
                    {c.has_access ? "Open course" : "View access options"}
                  </Link>
                  {c.has_access && !isSel && (
                    <Link href={`/dashboard?course=${c.code}`} className="btn-text" scroll={false}>See analytics</Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
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
              <p className="text-body-sm text-graphite">Analytics are kept separate for each course — domains are never mixed across ASP, CSP and CIH.</p>
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
          <CourseAnalyticsPanel a={analytics} courseCode={selected.code} courseName={selected.name} />
        </section>
      )}
    </div>
  );
}
