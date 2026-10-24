import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";

export type Profile = { id: string; username: string; full_name: string | null; role: "student" | "admin"; status: "active" | "suspended" };

/** The verified user + profile for this request (cached per request). */
export const getSession = cache(async () => {
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getUser(); // verifies the JWT with Supabase Auth
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, status")
    .eq("id", data.user.id)
    .single<Profile>();
  if (!profile) return null;
  return { user: data.user, profile, supabase };
});

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile.status !== "active") redirect("/login?error=suspended");
  return s;
}

/** UI guard only — every admin RPC re-checks is_admin() in the database. */
export async function requireAdmin() {
  const s = await requireUser();
  if (s.profile.role !== "admin") redirect("/dashboard");
  return s;
}
