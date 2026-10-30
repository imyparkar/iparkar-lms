"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/format";

export type StartState = {
  error?: string;
  code?: string;
  attemptId?: string;
  shortages?: { domain_code: string; domain_name: string; required: number; available: number }[];
};

const schema = z.object({
  course_id: z.uuid(),
  blueprint_id: z.uuid(),
  mode: z.enum(["mixed", "domain", "subject"]),
  domain_id: z.uuid().optional(),
  subject_area: z.string().min(1).max(120).optional(),
});

/** Starts an exam. All checks (entitlement, course/domain/blueprint match, bank size) run in the database. */
export async function startExam(_prev: StartState, form: FormData): Promise<StartState> {
  const parsed = schema.safeParse({
    course_id: form.get("course_id"),
    blueprint_id: form.get("blueprint_id"),
    mode: form.get("mode"),
    domain_id: form.get("domain_id") || undefined,
    subject_area: form.get("subject_area") || undefined,
  });
  if (!parsed.success) return { error: "This exam couldn’t be started. Refresh the page and try again.", code: "INVALID" };
  const { course_id, blueprint_id, mode, domain_id, subject_area } = parsed.data;
  if (mode === "domain" && !domain_id) return { error: "Choose a domain first." };
  if (mode === "subject" && !subject_area) return { error: "Choose a subject area first." };

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("start_attempt", {
    p_course_id: course_id, p_blueprint_id: blueprint_id, p_mode: mode,
    p_domain_id: domain_id ?? null, p_subject: subject_area ?? null,
  });
  if (error) return { error: "We couldn’t start the exam. Please try again." };
  if (!data?.ok) {
    return { error: rpcMessage(data?.error), code: data?.error, attemptId: data?.attempt_id, shortages: data?.shortages };
  }
  redirect(`/exam/${data.attempt_id}`);
}
