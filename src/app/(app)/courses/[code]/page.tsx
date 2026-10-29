import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import type { MyCourse } from "@/lib/types";
import { checkoutUrl } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { allocate } from "@/lib/exam/allocation";
import { Pill } from "@/components/ui/Pill";
import { Alert } from "@/components/ui/Alert";
import { StartDomain, StartMixed, StartSubject } from "./StartExam";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: (await params).code.toUpperCase() };
}

const POLICY: Record<string, string> = {
  after_submit: "Answers and explanations are shown after you submit.",
  immediate: "Each answer is checked as you go and then locked.",
  delayed: "Explanations unlock a set time after you submit.",
  restricted: "You’ll see your score and domain breakdown; question review is not available.",
};

export default async function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase, user } = await requireUser();
  const { data } = await supabase.rpc("get_my_courses");
  const course = ((data ?? []) as MyCourse[]).find((c) => c.code === code.toUpperCase());
  if (!course) notFound();

  const bp = course.blueprint;
  const mixed = course.exams?.find((e) => e.mode === "mixed");
  const domainExam = course.exams?.find((e) => e.mode === "domain");
  const subjectExam = course.exams?.find((e) => e.mode === "subject");
  const subjects = course.subject_areas ?? [];
  const alloc = mixed && bp?.domains ? allocate(bp.domains.map((d) => ({ number: d.number, weight: Number(d.weight) })), mixed.question_count) : [];
  const buy = checkoutUrl(course.code)?.replace("{user_id}", encodeURIComponent(user.id)).replace("{email}", encodeURIComponent(user.email ?? ""));

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href="/dashboard" className="link">Dashboard</Link> / {course.code}</nav>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="rounded-button bg-midnight px-2.5 py-1 text-body-sm font-semibold text-white">{course.code}</span>
          <h1 className="mt-3 text-[36px] font-semibold leading-tight tracking-[-0.8px]">{course.name}</h1>
          {course.description && <p className="lead mt-1">{course.description}</p>}
        </div>
        {course.has_access && (
          <Pill tone="strong">{course.has_lifetime_access || !course.access_expires_at ? "Access active" : `Access until ${fmtDate(course.access_expires_at)}`}</Pill>
        )}
      </header>

      {!course.has_access ? (
        <section className="rounded-card bg-marigold p-8">
          <h2 className="text-heading-sm">Unlock the {course.code} question bank</h2>
          <p className="mt-2 max-w-2xl">Full bank access includes the timed mixed exam, subject-area practice sets, the on-screen calculator, explanations and course analytics.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {buy ? (
              <a href={buy} className="btn-dark">Get {course.code} access</a>
            ) : (
              <a href={`mailto:imran@iparkar.com?subject=${encodeURIComponent(course.code + " premium access")}`} className="btn-dark">Ask about {course.code} access</a>
            )}
          </div>
          <p className="mt-4 text-caption">Access is granted automatically once the payment provider confirms your payment.</p>
        </section>
      ) : !course.exams_enabled ? (
        <Alert tone="info" title={`${course.code} practice exams are being prepared`}>
          You’re enrolled. Exams open once the {course.code} question bank has been reviewed and published — you’ll see them here.
        </Alert>
      ) : course.active_attempt_id ? (
        <Alert tone="warning" title="You have an exam in progress">
          <Link className="link" href={`/exam/${course.active_attempt_id}`}>Resume it</Link> — the timer keeps running on the server while you’re away.
        </Alert>
      ) : null}

      {course.has_access && course.exams_enabled && bp && (
        <div className="grid gap-4 md:grid-cols-2">
          {mixed && (
            <section className="card flex flex-col">
              <h2 className="text-heading-sm">{mixed.title}</h2>
              <ul className="mt-3 space-y-1 text-body-sm text-graphite">
                <li>{mixed.question_count} questions, weighted to the {course.code} blueprint</li>
                <li>{mixed.duration_minutes}-minute countdown; submits automatically at zero</li>
                <li>{POLICY[mixed.feedback_policy]}</li>
              </ul>
              <div className="mt-auto pt-6">
                <StartMixed courseId={course.id} blueprintId={bp.id} count={mixed.question_count} minutes={mixed.duration_minutes} />
              </div>
            </section>
          )}
          {subjectExam && (
            <section className="card flex flex-col">
              <h2 className="text-heading-sm">{subjectExam.title}</h2>
              <ul className="mt-3 space-y-1 text-body-sm text-graphite">
                <li>{subjectExam.question_count} questions from one BGC subject area</li>
                <li>{subjectExam.duration_minutes}-minute countdown</li>
                <li>{POLICY[subjectExam.feedback_policy]}</li>
              </ul>
              <div className="mt-auto pt-6">
                {subjects.length > 0 ? (
                  <StartSubject courseId={course.id} blueprintId={bp.id} subjects={subjects}
                                count={subjectExam.question_count} minutes={subjectExam.duration_minutes} />
                ) : (
                  <Alert tone="info" title="No subject areas published yet">
                    Subject-area practice opens once questions carrying a subject area are published.
                  </Alert>
                )}
              </div>
            </section>
          )}
          {domainExam && (
            <section className="card flex flex-col">
              <h2 className="text-heading-sm">{domainExam.title}</h2>
              <ul className="mt-3 space-y-1 text-body-sm text-graphite">
                <li>{domainExam.question_count} questions from one {course.code} domain</li>
                <li>{domainExam.duration_minutes}-minute countdown</li>
                <li>{POLICY[domainExam.feedback_policy]}</li>
              </ul>
              <div className="mt-auto pt-6">
                <StartDomain courseId={course.id} blueprintId={bp.id} domains={bp.domains ?? []}
                             count={domainExam.question_count} minutes={domainExam.duration_minutes} />
              </div>
            </section>
          )}
        </div>
      )}

      {bp && (
        <section className="card overflow-x-auto" aria-labelledby="bp-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="bp-h" className="text-heading-sm">Blueprint</h2>
            <span className="text-caption text-graphite">{bp.name} · version {bp.version}</span>
          </div>
          {bp.verification_status !== "verified" && (
            <p className="mt-2 text-caption text-graphite">Domain weightings are an initial configuration pending verification against the official blueprint.</p>
          )}
          <table className="mt-4 w-full min-w-[420px]">
            <thead><tr><th className="table-head">Domain</th><th className="table-head">Name</th><th className="table-head text-right">Weight</th>{mixed && <th className="table-head text-right">Questions in a mixed exam</th>}</tr></thead>
            <tbody>
              {(bp.domains ?? []).map((d, i) => (
                <tr key={d.id}>
                  <td className="table-cell font-medium">{d.code}</td>
                  <td className="table-cell">{d.name}</td>
                  <td className="table-cell text-right tabular-nums">{Number(d.weight)}%</td>
                  {mixed && <td className="table-cell text-right tabular-nums">{alloc[i]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {course.has_access && <p className="text-body-sm"><Link className="link" href={`/dashboard?course=${course.code}`}>See your {course.code} analytics and history</Link></p>}
    </div>
  );
}
