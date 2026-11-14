import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  "signed-out": "You’re signed out.",
  idle: "You were signed out after 10 minutes without activity. Sign in to continue where you left off.",
  suspended: "This account is suspended. Contact support@iparkar.com.",
  "link-expired": "That link has expired or was already used. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Sign in" lead="Pick up your practice where you left off."
      footer={<>New to iParkar Learning? <Link href={sp.next ? `/signup?next=${encodeURIComponent(sp.next)}` : "/signup"} className="link">Create an account</Link></>}>
      <LoginForm next={sp.next} notice={NOTICES[sp.error ?? sp.notice ?? ""]} />
    </AuthShell>
  );
}
