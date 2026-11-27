import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { ProgressMeter } from "@/components/study/Progress";
import { SLUG, isDone, nextModule, statusLabel, type ScormCourse } from "@/lib/scorm/types";
import { GenerateCertificate } from "@/components/certificates/GenerateCertificate";

type CertStatus = {
  ok: boolean; offered: boolean; course_code?: string; hours?: number; completed?: boolean; completed_at?: string | null;
  suggested_name?: string; certificate?: { certificate_code: string; status: string; name_on_certificate: string; issued_at: string | null } | null;
};

export const metadata = { title: "Free course" };
export const dynamic = "force-dynamic";

/** Overview of a free SCORM course: progress, then every module with its status. */
export default async function FreeCoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!SLUG.test(course)) notFound();
  const { supabase } = await requireUser();
  const [{ data }, { data: certData }] = await Promise.all([
    supabase.rpc("scorm_get_course", { p_course: course }),
    supabase.rpc("scorm_certificate_status", { p_course: course }),
  ]);
  if (!data) notFound();
  const cert = (certData ?? null) as CertStatus | null;
  const issued = cert?.certificate?.status === "issued" ? cert.certificate : null;
  const c = data as ScormCourse;
  const done = c.modules.filter((m) => isDone(m.status)).length;
  const started = c.modules.some((m) => m.status !== "not attempted");
  const next = nextModule(c.modules);
  const allDone = done === c.modules.length && c.modules.length > 0;
  const minutes = c.modules.reduce((s, m) => s + (m.minutes ?? 0), 0);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite">
        <Link href="/learn" className="link">My learning</Link> <span aria-hidden="true">/</span> Free course
      </nav>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="on-dark rounded-card bg-midnight p-6 text-white sm:p-8">
          <p className="text-caption text-marigold">iParkar Learning · Free course{c.status !== "published" ? ` · ${c.status} (admins only)` : ""}</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.8px]">{c.title}</h1>
          {c.summary && <p className="mt-3 font-serif text-lead text-white">{c.summary}</p>}
          <div className="mt-6"><ProgressMeter dark done={done} total={c.modules.length} label="Modules completed" /></div>
          <p className="mt-3 text-body-sm text-white">{c.modules.length} modules · about {Math.round(minutes / 5) * 5} minutes in total · free with your iParkar account</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {next && (
              <Link href={`/scorm/${c.code}/${next.code}`} className="btn-primary">
                {allDone ? "Review the course" : started ? `Continue: ${next.title}` : "Start the course"}
              </Link>
            )}
          </div>
        </div>
        <div className="card">
          <h2 className="text-heading-sm">How it works</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-body text-graphite">
            <li>Work through the modules in order — each takes 15 to 25 minutes.</li>
            <li>Every module ends with knowledge checks. Score 80% or more to pass it.</li>
            <li>Your place is saved automatically, so you can stop and pick up again on any device.</li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="mods-h">
        <h2 id="mods-h" className="text-heading-sm">Modules</h2>
        <ol className="mt-4 grid gap-3">
          {c.modules.map((m, i) => {
            const s = statusLabel(m.status);
            return (
              <li key={m.code} className="card flex flex-col gap-4 sm:flex-row sm:items-center">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-tint text-body-sm font-semibold text-midnight">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[18px] font-semibold leading-snug">{m.title}</h3>
                  {m.summary && <p className="mt-1 text-body-sm text-graphite">{m.summary}</p>}
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-slate">
                    <span className={`pill ${s.tone}`}>{s.label}</span>
                    {m.minutes && <span>About {m.minutes} min</span>}
                    {m.score !== null && <span>Best score {Math.round(Number(m.score))}%</span>}
                    {m.completed_at && <span>Completed {fmtDate(m.completed_at)}</span>}
                  </p>
                </div>
                <Link href={`/scorm/${c.code}/${m.code}`} className={isDone(m.status) ? "btn-outline" : "btn-primary"}>
                  {isDone(m.status) ? "Review" : m.status === "not attempted" ? "Start" : "Continue"}
                  <span className="sr-only"> {m.title}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {cert?.ok && cert.offered && (
        <section aria-labelledby="cert-h" className="card">
          <h2 id="cert-h" className="text-heading-sm">Certificate of completion</h2>
          {cert.completed ? (
            <div className="mt-3">
              <GenerateCertificate course={cert.course_code ?? course.toUpperCase()} suggestedName={cert.suggested_name ?? ""}
                                   issued={issued ? { certificate_code: issued.certificate_code, name_on_certificate: issued.name_on_certificate, issued_at: issued.issued_at } : null}
                                   hint="for example as on your ID" />
            </div>
          ) : (
            <p className="mt-2 text-body text-graphite">
              Pass all {c.modules.length} modules, scoring 80% or more in each module&apos;s knowledge checks, to unlock your certificate:
              {" "}{Number(cert.hours)} contact hours ({Number(cert.hours) / 10} CEU), self-paced online, with a QR code anyone can use to verify it. You&apos;ve passed {done} of {c.modules.length}.
            </p>
          )}
        </section>
      )}

      <p className="max-w-[720px] text-body-sm text-graphite">
        This free course is general professional development. The certificate of completion is issued by iParkar Learning and its contact hours and CEU are provider-issued; it isn&apos;t a certification and doesn&apos;t count towards any BCSP credential.
      </p>
    </div>
  );
}
