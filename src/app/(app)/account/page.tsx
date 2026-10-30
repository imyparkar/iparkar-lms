import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { Pill } from "@/components/ui/Pill";

export const metadata = { title: "Account" };

type Ent = { id: string; source: string; starts_at: string; expires_at: string | null; revoked_at: string | null; courses: { code: string; name: string } | null };

export default async function AccountPage() {
  const { profile, user, supabase } = await requireUser();
  const { data } = await supabase
    .from("course_entitlements")
    .select("id, source, starts_at, expires_at, revoked_at, courses(code, name)")
    .order("starts_at", { ascending: false })
    .returns<Ent[]>();
  const now = Date.now();
  return (
    <div className="space-y-8">
      <h1 className="text-[36px] font-semibold tracking-[-0.8px]">Account</h1>
      <section className="card grid gap-3 sm:grid-cols-[160px_1fr]">
        <span className="text-slate text-body-sm">Name</span><span>{profile.full_name ?? "—"}</span>
        <span className="text-slate text-body-sm">Username</span><span>{profile.username}</span>
        <span className="text-slate text-body-sm">Email</span><span>{user.email}</span>
        <span className="text-slate text-body-sm">Password</span><Link href="/reset-password" className="link">Send a reset link</Link>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="text-heading-sm">Course access</h2>
        {!data?.length ? <p className="mt-2 text-body-sm text-graphite">No course access yet.</p> : (
          <table className="mt-4 w-full min-w-[520px]">
            <thead><tr><th className="table-head">Course</th><th className="table-head">Type</th><th className="table-head">From</th><th className="table-head">Until</th><th className="table-head">Status</th></tr></thead>
            <tbody>
              {data.map((e) => {
                const active = !e.revoked_at && Date.parse(e.starts_at) <= now && (!e.expires_at || Date.parse(e.expires_at) > now);
                return (
                  <tr key={e.id}>
                    <td className="table-cell font-medium">{e.courses?.code} · {e.courses?.name}</td>
                    <td className="table-cell capitalize">{e.source.replace("_", " ")}</td>
                    <td className="table-cell">{fmtDate(e.starts_at)}</td>
                    <td className="table-cell">{e.expires_at ? fmtDate(e.expires_at) : "No expiry"}</td>
                    <td className="table-cell"><Pill tone={active ? "strong" : "neutral"}>{e.revoked_at ? "Revoked" : active ? "Active" : "Expired"}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-body-sm text-graphite">To delete your account and data, email <a className="link" href="mailto:support@iparkar.com">support@iparkar.com</a>.</p>
    </div>
  );
}
