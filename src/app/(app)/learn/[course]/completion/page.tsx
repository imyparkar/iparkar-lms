import { courseProfile, independenceStatement } from "@/lib/study/courseProfile";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { courseCode } from "@/lib/study/types";
import { PrintButton } from "@/components/study/PrintButton";
import { GenerateCertificate } from "@/components/certificates/GenerateCertificate";

export const metadata = { title: "Completion record" };
export const dynamic = "force-dynamic";

type CertStatus = { ok: boolean; offered: boolean; eligible: boolean; suggested_name: string | null;
  certificate: { certificate_code: string; status: "pending" | "issued"; name_on_certificate: string; issued_at: string | null } | null };
type Completion = { ok: true; learner_name: string; course_title: string; product: string; version: string; completed_at: string; record_code: string; chapters_completed: number };

export default async function CompletionPage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course)) notFound();
  const { supabase } = await requireUser();
  const [{ data }, { data: cert }] = await Promise.all([
    supabase.rpc("get_study_completion", { p_course_code: courseCode(course) }),
    supabase.rpc("study_certificate_status", { p_course_code: courseCode(course) }),
  ]);
  const cs = cert as CertStatus | null;
  const profile = courseProfile(course);
  if (!data?.ok) {
    return (
      <div className="card max-w-[720px]">
        <h1 className="text-heading-sm">No completion record yet</h1>
        <p className="mt-2 text-body text-graphite">A completion record is created automatically when every required chapter is finished.{cs?.offered ? " Your certificate of course completion unlocks at the same time." : ""}</p>
        <Link className="btn-primary mt-4" href={`/learn/${course}`}>Back to the course</Link>
      </div>
    );
  }
  const c = data as Completion;
  const issued = cs?.certificate?.status === "issued" ? cs.certificate : null;
  return (
    <div className="space-y-6">
      {cs?.offered && (
        <section className="no-print card mx-auto max-w-[900px] space-y-4" aria-labelledby="cert-h">
          <div>
            <p className="text-subheading text-graphite">Course complete</p>
            <h2 id="cert-h" className="mt-1 text-heading-sm">Your iParkar Learning certificate of course completion</h2>
          </div>
          {cs.eligible || issued
            ? <GenerateCertificate course={courseCode(course)} suggestedName={cs.suggested_name ?? c.learner_name} issued={issued} />
            : <p className="text-body text-graphite">Your enrollment is no longer active, so a certificate can&apos;t be generated. Contact support@iparkar.com if you think this is wrong.</p>}
        </section>
      )}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/learn/${course}`} className="btn-text">Back to the course</Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[900px] overflow-hidden rounded-card border border-hairline bg-white print:border-0" aria-label="Course completion record">
        <div className="on-dark flex items-center gap-3 bg-midnight px-8 py-6 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iparkar-mark-reversed.svg" width={40} height={40} alt="" />
          <span className="text-[18px] font-semibold">iParkar Learning</span>
        </div>
        <div className="space-y-6 px-8 py-10 sm:px-12">
          <p className="text-subheading text-graphite">Course completion record</p>
          <h1 className="text-[40px] font-semibold leading-tight tracking-[-1px]">{c.learner_name}</h1>
          <p className="font-serif text-[24px] leading-snug text-ink">Completed the {c.product} {c.course_title}.</p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-caption text-slate">Completion date</dt><dd className="text-body font-semibold">{fmtDate(c.completed_at)}</dd></div>
            <div><dt className="text-caption text-slate">Course version</dt><dd className="text-body font-semibold">{c.version}</dd></div>
            <div><dt className="text-caption text-slate">Required chapters completed</dt><dd className="text-body font-semibold">{c.chapters_completed}</dd></div>
            <div><dt className="text-caption text-slate">Record ID</dt><dd className="font-mono text-body font-semibold">{c.record_code}</dd></div>
          </dl>
          <p className="border-t border-hairline pt-6 text-body-sm text-graphite">
            This record confirms completion of a self-paced study course from verified course records. It is not a certification, licence or professional authorization, and it does not predict or guarantee an examination result. It is not accredited or approved for continuing-education credit. {independenceStatement(profile)} {profile.markOwnerShort} does not issue this record.
          </p>
        </div>
      </article>
    </div>
  );
}
