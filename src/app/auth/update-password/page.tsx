import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui/AuthShell";
import { getServerClient } from "@/lib/supabase/server";
import { UpdateForm } from "./UpdateForm";

export const metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=link-expired");
  return (
    <AuthShell title="Choose a new password" lead="Use at least 10 characters.">
      <UpdateForm />
    </AuthShell>
  );
}
