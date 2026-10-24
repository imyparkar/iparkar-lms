"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import type { ImportItem } from "@/lib/import/itemBank";

/**
 * Admin server actions. requireAdmin() is a convenience check; every RPC
 * re-verifies is_admin() inside the database and writes an audit log.
 */
export type ActionResult = { ok: boolean; error?: string; message?: string; data?: unknown };

async function call(fn: string, args: Record<string, unknown>, paths: string[] = []): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  if (data && data.ok === false) return { ok: false, error: data.error ?? (data.errors ?? []).join("; "), data };
  paths.forEach((p) => revalidatePath(p));
  return { ok: true, data };
}

export async function updateCourse(form: FormData) {
  const res = await call("admin_update_course", {
    p_course: form.get("course_id"),
    p_is_visible: form.get("is_visible") === "on",
    p_exams_enabled: form.get("exams_enabled") === "on",
    p_description: String(form.get("description") ?? "") || null,
  }, ["/admin"]);
  redirect(`/admin?${res.ok ? "saved=course" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function importChunk(courseCode: string, items: ImportItem[], status: "draft" | "in_review" | "published") {
  return call("admin_import_questions", { p_course_code: courseCode, p_items: items, p_status: status, p_auto_create_tasks: true });
}

export async function setQuestionStatus(ids: string[], status: string) {
  return call("admin_set_question_status", { p_ids: ids, p_status: status }, ["/admin/questions"]);
}

export async function bulkStatusAction(form: FormData) {
  const ids = form.getAll("ids").map(String);
  const status = String(form.get("status"));
  const back = String(form.get("back") ?? "/admin/questions");
  if (!ids.length) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Select at least one question.")}`);
  const res = await setQuestionStatus(ids, status);
  const d = res.data as { updated?: number; failed?: { error: string }[] } | undefined;
  const msg = res.ok ? `${d?.updated ?? 0} updated${d?.failed?.length ? `, ${d.failed.length} failed: ${d.failed[0].error}` : ""}` : res.error;
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg ?? "")}`);
}

export async function saveQuestion(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const labels = ["A", "B", "C", "D", "E", "F"];
  const options = labels
    .map((l) => ({ label: l, body: String(form.get(`option_${l}`) ?? "").trim() }))
    .filter((o) => o.body !== "");
  const payload = {
    id: form.get("id") || undefined,
    course_code: form.get("course_code"),
    external_ref: String(form.get("external_ref") ?? "").trim() || undefined,
    domain_code: form.get("domain_code"),
    task_code: String(form.get("task_code") ?? "").trim() || undefined,
    topic: String(form.get("topic") ?? "").trim() || undefined,
    cognitive_level: form.get("cognitive_level") || undefined,
    stem: form.get("stem"),
    options,
    key: form.get("key"),
    explanation: form.get("explanation"),
    reference: form.get("reference"),
    difficulty: form.get("difficulty") || undefined,
    allow_option_shuffle: form.get("allow_option_shuffle") === "on",
    status: form.get("status"),
    change_note: form.get("change_note") || undefined,
    auto_create_task: form.get("auto_create_task") === "on",
  };
  const res = await call("admin_upsert_question", { p: payload }, ["/admin/questions"]);
  if (!res.ok) return res;
  const d = res.data as { id: string; version: number; created: boolean };
  if (d.created) redirect(`/admin/questions/${d.id}?saved=1`);
  return { ok: true, message: `Saved · version ${d.version}` };
}

export async function blueprintMeta(form: FormData) {
  const res = await call("admin_update_blueprint_meta", {
    p_blueprint: form.get("blueprint_id"),
    p_verification: form.get("verification_status"),
    p_last_reviewed: form.get("last_reviewed") || null,
    p_notes: form.get("notes") || null,
  }, ["/admin/blueprints"]);
  redirect(`/admin/blueprints?${res.ok ? "notice=Saved" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function createBlueprintVersion(form: FormData) {
  const domains = form.getAll("domain_id").map((id, i) => ({
    domain_id: String(id),
    weight: Number(form.getAll("weight")[i]),
    name: String(form.getAll("domain_name")[i] ?? ""),
  }));
  const res = await call("admin_create_blueprint_version", {
    p_course: form.get("course_id"),
    p_version: form.get("version"),
    p_name: form.get("name"),
    p_source: form.get("source"),
    p_effective: form.get("effective_date") || null,
    p_domains: domains,
    p_notes: form.get("notes") || null,
  }, ["/admin/blueprints"]);
  const sum = (res.data as { weight_sum?: number })?.weight_sum;
  redirect(`/admin/blueprints?${res.ok ? `notice=${encodeURIComponent(`Version created (weights total ${sum}%). Make it current when ready.`)}` : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function setCurrentBlueprint(form: FormData) {
  const res = await call("admin_set_current_blueprint", { p_blueprint: form.get("blueprint_id") }, ["/admin/blueprints", "/admin"]);
  redirect(`/admin/blueprints?${res.ok ? "notice=Current blueprint updated" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function updateWeights(form: FormData) {
  const domains = form.getAll("domain_id").map((id, i) => ({ domain_id: String(id), weight: Number(form.getAll("weight")[i]) }));
  const res = await call("admin_update_blueprint_weights", { p_blueprint: form.get("blueprint_id"), p_domains: domains }, ["/admin/blueprints"]);
  redirect(`/admin/blueprints?${res.ok ? `notice=${encodeURIComponent(`Weights saved (total ${(res.data as { weight_sum: number }).weight_sum}%)`)}` : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function grantEntitlement(form: FormData) {
  const days = Number(form.get("days") || 0);
  const res = await call("admin_grant_entitlement", {
    p_user: form.get("user_id"),
    p_course: form.get("course_id"),
    p_source: form.get("source") || "complimentary",
    p_expires_at: days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
    p_note: form.get("note") || null,
  }, ["/admin/students"]);
  redirect(`/admin/students?q=${encodeURIComponent(String(form.get("q") ?? ""))}&${res.ok ? "notice=Access granted" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function revokeEntitlement(form: FormData) {
  const res = await call("admin_revoke_entitlement", { p_entitlement: form.get("entitlement_id"), p_reason: form.get("reason") || "Revoked by admin" }, ["/admin/students"]);
  redirect(`/admin/students?q=${encodeURIComponent(String(form.get("q") ?? ""))}&${res.ok ? "notice=Access revoked" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function setUserStatus(form: FormData) {
  const res = await call("admin_set_user_status", { p_user: form.get("user_id"), p_status: form.get("status"), p_role: form.get("role") || null }, ["/admin/students"]);
  redirect(`/admin/students?q=${encodeURIComponent(String(form.get("q") ?? ""))}&${res.ok ? "notice=User updated" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function finalizeAttempt(form: FormData) {
  const res = await call("admin_finalize_attempt", { p_attempt: form.get("attempt_id") }, ["/admin/attempts"]);
  redirect(`/admin/attempts?${res.ok ? "notice=Attempt finalized" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function updateExamConfig(form: FormData) {
  const res = await call("admin_update_exam", {
    p_exam: form.get("exam_id"),
    p_question_count: Number(form.get("question_count")),
    p_duration_minutes: Number(form.get("duration_minutes")),
    p_feedback_policy: form.get("feedback_policy"),
    p_review_delay_hours: Number(form.get("review_delay_hours") || 0),
    p_shuffle_options: form.get("shuffle_options") === "on",
    p_is_active: form.get("is_active") === "on",
  }, ["/admin/settings"]);
  redirect(`/admin/settings?${res.ok ? "notice=Exam settings saved" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}

export async function updateIndicators(form: FormData) {
  const strong = Number(form.get("strong")), developing = Number(form.get("developing")), min = Number(form.get("min_questions"));
  if (!(strong > developing && developing > 0 && strong <= 100 && min >= 1)) redirect("/admin/settings?error=Thresholds must satisfy 0 < developing < strong ≤ 100");
  const res = await call("admin_update_setting", { p_key: "study_indicators", p_value: { strong, developing, min_questions: min } }, ["/admin/settings"]);
  redirect(`/admin/settings?${res.ok ? "notice=Study indicators saved" : `error=${encodeURIComponent(res.error ?? "")}`}`);
}
