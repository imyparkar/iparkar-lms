import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { SignupForm } from "./SignupForm";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" lead="Free to create. Unlock a course bank when you’re ready."
      footer={<>Already registered? <Link href="/login" className="link">Sign in</Link></>}>
      <SignupForm />
    </AuthShell>
  );
}
