"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { courseCode, courseSlug } from "./types";

/** Start a self-enrol study course: begins the free trial (once per learner, never restarted). */
export async function startStudyCourse(form: FormData) {
  const slug = String(form.get("course") ?? "");
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(slug)) redirect("/learn");
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("study_self_enroll", { p_course_code: courseCode(slug) });
  revalidatePath("/learn");
  if (!data?.ok) redirect(`/learn?error=${encodeURIComponent(data?.error ?? "enrollment_closed")}`);
  redirect(`/study/${courseSlug(courseCode(slug))}/1.1`);
}
