import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Reset password" };

export default function ResetPage() {
  return (
    <AuthShell title="Reset your password" lead="We’ll email you a secure link."
      footer={<Link href="/login" className="link">Back to sign in</Link>}>
      <ResetForm />
    </AuthShell>
  );
}
