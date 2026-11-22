import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Certificates" };
export const dynamic = "force-dynamic";

type Cert = { certificate_code: string; name_on_certificate: string; course_code: string; certificate_title: string;
  completed_at: string; issued_at: string; hours: number; version: string };

/** Signed-in learner's issued certificates. Each download streams the stored PDF after an ownership check. */
export default async function CertificatesPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("study_my_certificates");
  const certs = (data ?? []) as Cert[];
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-1.2px]">Certificates</h1>
        <p className="lead mt-3 max-w-reading">Certificates of course completion issued by iParkar Learning. They&apos;re private to your account; download a copy whenever you need one.</p>
      </header>
      {certs.length === 0 ? (
        <div className="card max-w-[720px]">
          <h2 className="text-heading-sm">No certificates yet</h2>
          <p className="mt-2 text-body text-graphite">When you finish every required chapter of a course that offers a certificate, you can generate it from the course&apos;s completion page.</p>
          <Link href="/learn" className="btn-primary mt-4">Go to My learning</Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {certs.map((c) => (
            <li key={c.certificate_code} className="card flex flex-col gap-4">
              <div>
                <p className="text-caption text-slate">Certificate no. <span className="font-mono">{c.certificate_code}</span></p>
                <h2 className="mt-1 text-heading-sm">{c.certificate_title}</h2>
                <p className="mt-1 font-serif text-[20px] text-ink">{c.name_on_certificate}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-body-sm">
                <div><dt className="text-slate">Completed</dt><dd className="font-medium">{fmtDate(c.completed_at)}</dd></div>
                <div><dt className="text-slate">Contact hours</dt><dd className="font-medium">{Number(c.hours)}</dd></div>
                <div><dt className="text-slate">Issued</dt><dd className="font-medium">{fmtDate(c.issued_at)}</dd></div>
                <div><dt className="text-slate">Course version</dt><dd className="font-medium">{c.version}</dd></div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-3">
                <a className="btn-primary" href={`/api/certificates/${c.certificate_code}`} download>
                  Download Certificate<span className="sr-only"> {c.certificate_code} (PDF)</span>
                </a>
                <Link className="btn-outline" href={`/learn/${c.course_code.toLowerCase()}/completion`}>Completion record</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
