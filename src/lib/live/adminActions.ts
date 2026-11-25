"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";

/** Administrator actions for live courses. Every RPC re-checks is_admin() in the database. */
export type AdminState = { ok?: boolean; error?: string; message?: string };

const msg = (d: { ok?: boolean; error?: string; message?: string } | null, okText = "Saved.") =>
  d?.ok ? { ok: true, message: okText } : { error: d?.message ?? (d?.error ? `Not saved: ${d.error.replace(/_/g, " ")}.` : "Not saved. Try again.") };

/** Convert a datetime-local value entered in the cohort's time zone to an ISO instant. */
function zonedToIso(local: string, timeZone: string): string | null {
  if (!local) return null;
  const [d, t] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  const asZone = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZone - guess)).toISOString();
}

export async function createCohort(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const code = String(f.get("code") ?? "").toUpperCase().trim();
  const title = String(f.get("title") ?? "").trim();
  if (!/^[A-Z0-9-]{3,30}$/.test(code) || title.length < 3) return { error: "Use a code like OHBP-2027-01 and a title." };
  const { data } = await supabase.rpc("admin_live_create_cohort", { p_course_code: String(f.get("course")), p_code: code, p_title: title, p_time_zone: String(f.get("tz") || "Asia/Kuwait") });
  revalidatePath("/admin/live");
  return msg(data, "Cohort created with its 12 sessions. Add dates and Teams links next.");
}

export async function assignLearner(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const p = z.object({ e: z.uuid(), c: z.uuid() }).safeParse({ e: f.get("enrollment"), c: f.get("cohort") });
  if (!p.success) return { error: "Choose a cohort." };
  const { data } = await supabase.rpc("admin_live_assign", { p_enrollment: p.data.e, p_cohort: p.data.c });
  revalidatePath("/admin/live");
  return msg(data, "Assigned.");
}

export async function updateSession(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const tz = String(f.get("tz") || "Asia/Kuwait");
  const start = zonedToIso(String(f.get("start") ?? ""), tz);
  const mins = Number(f.get("minutes") ?? 0);
  const end = start ? new Date(Date.parse(start) + mins * 60_000).toISOString() : null;
  const { data } = await supabase.rpc("admin_live_update_session", {
    p_session: String(f.get("session")), p_starts_at: start, p_ends_at: end,
    p_join_url: String(f.get("join") ?? ""), p_recording_url: String(f.get("recording") ?? ""), p_instructor: String(f.get("instructor") ?? ""),
  });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data);
}

export async function recordAttendance(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const rows = [...f.entries()].filter(([k]) => k.startsWith("att:")).map(([k, v]) => ({
    enrollment: k.slice(4), status: String(v), minutes: Number(f.get(`min:${k.slice(4)}`) || 0) || null,
  })).filter((r) => r.status === "present" || r.status === "absent");
  const { data } = await supabase.rpc("admin_live_record_attendance", { p_session: String(f.get("session")), p_rows: rows });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data, `Attendance saved for ${rows.length} learners.`);
}

export async function reviewMakeup(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_live_review_makeup", {
    p_session: String(f.get("session")), p_enrollment: String(f.get("enrollment")), p_approve: f.get("decision") === "approve",
    p_feedback: String(f.get("feedback") ?? ""), p_deadline_override: null,
  });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data, "Make-up reviewed.");
}

export async function extendMakeup(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const days = Number(f.get("days") ?? 7);
  if (!(days >= 1 && days <= 30)) return { error: "Extend by 1 to 30 days." };
  // An extension is recorded as a deadline override on the learner's make-up row (created if needed).
  const { data } = await supabase.rpc("admin_live_extend_makeup", {
    p_session: String(f.get("session")), p_enrollment: String(f.get("enrollment")), p_days: days, p_reason: String(f.get("reason") ?? ""),
  });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data, "Deadline extended.");
}

export async function markPractical(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_live_mark_practical", {
    p_submission: String(f.get("submission")), p_mark: Number(f.get("mark")), p_feedback: String(f.get("feedback") ?? ""),
  });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data, data?.passed ? "Marked: pass." : "Marked: not yet passed. The learner can resubmit once.");
}

export async function setAccommodation(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const pct = Number(f.get("pct") ?? 0);
  const { data } = await supabase.rpc("admin_live_set_accommodation", { p_enrollment: String(f.get("enrollment")), p_extra_pct: pct, p_note: String(f.get("note") ?? "") });
  revalidatePath(`/admin/live/${f.get("cohort")}`);
  return msg(data, pct ? `Extra time set to ${pct}%.` : "Extra time removed.");
}

export async function recordPurchase(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const amount = Number(f.get("amount"));
  const currency = String(f.get("currency") ?? "").toUpperCase();
  const exp = currency === "KWD" || currency === "BHD" || currency === "OMR" ? 3 : 2;
  const q = String(f.get("user") ?? "").trim().toLowerCase();
  const { data: found } = await supabase.rpc("admin_search_users", { p_query: q, p_limit: 20 });
  const list = ((found?.users ?? []) as { id: string; username: string; email: string | null }[])
    .filter((u) => u.username.toLowerCase() === q || (u.email ?? "").toLowerCase() === q);
  if (!q || list.length !== 1) return { error: "Enter the learner's exact username or email (one account must match)." };
  const { data } = await supabase.rpc("admin_live_record_purchase", {
    p_user: list[0].id, p_course_code: String(f.get("course")), p_reference: String(f.get("reference") ?? ""),
    p_amount_minor: Math.round(amount * 10 ** exp), p_currency: currency, p_days: Number(f.get("days") ?? 365),
  });
  revalidatePath("/admin/live");
  return msg(data, "Payment recorded and access granted. Assign the learner to a cohort.");
}

export async function setForm(_p: AdminState, f: FormData): Promise<AdminState> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.rpc("admin_live_set_form", {
    p_course_code: String(f.get("course")), p_form: String(f.get("form")), p_active: f.get("active") === "on", p_reviewed: f.get("reviewed") === "on",
  });
  revalidatePath("/admin/live");
  return msg(data);
}
