import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { SignupForm } from "./SignupForm";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const guide = next?.startsWith("/study-guides");
  return (
    <AuthShell title="Create your account" lead={guide ? "Free to create. Your study guide download starts after you confirm your email and sign in." : "Free to create. Unlock a course bank when you’re ready."}
      footer={<>Already registered? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="link">Sign in</Link></>}>
      <SignupForm next={next} />
    </AuthShell>
  );
}
