"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/server";
import { EXAM_BLOCKED, MAKEUP_ERRORS, liveSlug } from "@/lib/live/types";

export type FormState = { ok?: boolean; error?: string };

const makeupSchema = z.object({ session: z.uuid(), course: z.string().regex(/^[a-z]{2,8}$/), response: z.string().max(8000), watched: z.boolean() });

/** Make-up for a missed session: the learner confirms they watched the recording and submits the task. */
export async function submitMakeup(_prev: FormState, form: FormData): Promise<FormState> {
  const p = makeupSchema.safeParse({
    session: form.get("session"), course: form.get("course"), response: String(form.get("response") ?? ""), watched: form.get("watched") === "on",
  });
  if (!p.success) return { error: "Something was missing. Refresh the page and try again." };
  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("live_submit_makeup", { p_session: p.data.session, p_response: p.data.response, p_watched: p.data.watched });
  if (error || !data) return { error: "We couldn't save your make-up task. Try again." };
  if (!data.ok) return { error: MAKEUP_ERRORS[data.error] ?? "We couldn't save your make-up task." };
  revalidatePath(`/live/${p.data.course}`);
  return { ok: true };
}

/** Start or resume the final examination; the database checks every rule. */
export async function startLiveExam(_prev: FormState, form: FormData): Promise<FormState> {
  const course = String(form.get("course") ?? "").toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(course)) return { error: "This examination couldn't be started." };
  if (form.get("confirm") !== "on") return { error: "Confirm that you have read the examination rules." };
  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("live_exam_start", { p_course_code: course });
  if (error || !data) return { error: "We couldn't start the examination. Try again." };
  if (!data.ok) return { error: EXAM_BLOCKED[data.error] ?? "The examination can't be started right now." };
  redirect(`/live/${liveSlug(course)}/exam/${data.attempt_id}`);
}
