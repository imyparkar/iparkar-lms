import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  "signed-out": "You’re signed out.",
  idle: "You were signed out after 10 minutes without activity. Sign in to continue where you left off.",
  suspended: "This account is suspended. Contact support@iparkar.com.",
  "link-expired": "That link has expired or was already used. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const sp = await searchParams;
  // Already signed in (e.g. arriving from iparkar.com's Sign in link): go straight on, no second sign-in.
  // Not after an explicit sign-out or idle notice, and never for a suspended account, so there is no loop.
  if (!sp.error && !sp.notice) {
    const s = await getSession();
    if (s && s.profile.status === "active") redirect(safeNext(sp.next));
  }
  const next = sp.next ? safeNext(sp.next, "") || undefined : undefined;
  return (
    <AuthShell title="Sign in" lead="Pick up your practice where you left off."
      footer={<>New to iParkar Learning? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="link">Create an account</Link></>}>
      <LoginForm next={next} notice={NOTICES[sp.error ?? sp.notice ?? ""]} />
    </AuthShell>
  );
}
