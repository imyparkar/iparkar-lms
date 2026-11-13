"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";

/** Study-course admin actions. Every RPC re-checks is_admin() and writes the audit log. */
async function call(fn: string, args: Record<string, unknown>) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false as const, error: error.message };
  if (data?.ok === false) {
    const problems = Array.isArray(data.problems) ? `: ${data.problem_count} chapter(s) not ready, e.g. ${data.problems.slice(0, 3).join("; ")}` : "";
    return { ok: false as const, error: `${data.error}${problems}` };
  }
  revalidatePath("/admin/study");
  return { ok: true as const, data };
}
const back = (r: { ok: boolean; error?: string }, notice: string) =>
  redirect(`/admin/study?${r.ok ? `notice=${encodeURIComponent(notice)}` : `error=${encodeURIComponent(r.error ?? "Failed")}`}`);

export async function setStudyVersionStatus(form: FormData) {
  const def = form.get("default");
  const r = await call("admin_study_set_version_status", {
    p_version: form.get("version_id"), p_status: form.get("status"), p_default: def === null ? null : def === "true",
  });
  back(r, "Version updated");
}

export async function enrollLearner(form: FormData) {
  const { supabase } = await requireAdmin();
  const username = String(form.get("username") ?? "").trim();
  const { data: profile } = await supabase.from("profiles").select("id").ilike("username", username).maybeSingle();
  if (!profile) back({ ok: false, error: `No user named ${username}` }, "");
  const r = await call("admin_study_enroll", { p_user: profile!.id, p_version: form.get("version_id"), p_pilot: form.get("pilot") === "on" });
  back(r, `Enrolled ${username}`);
}

export async function revokeLearner(form: FormData) {
  const r = await call("admin_study_revoke", { p_enrollment: form.get("enrollment_id"), p_reason: form.get("reason") || "Revoked by admin" });
  back(r, "Enrollment revoked");
}
